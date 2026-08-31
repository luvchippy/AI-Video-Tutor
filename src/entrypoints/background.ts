import { buildProvider } from '@/providers/ai';
import { MockProvider } from '@/providers/ai/mock';
import { classifyTestError } from '@/providers/ai/test-errors';
import type { AiProvider, ProviderConfig, SearchProvider } from '@/types/provider';
import {
  createDisabledSearchProvider,
  createNativeSearchProvider,
} from '@/providers/search';
import {
  loadSettings,
  saveSettings,
  getApiKey,
  saveApiKey,
  getApiKeyStatus,
  saveSavedModel,
  deleteSavedModel,
} from '@/storage/settings';
import { capabilitiesOf } from '@/registry/model-registry';
import { resolveCapabilities } from '@/registry/capability-resolver';
import * as repo from '@/storage/repositories';
import { TutorEngine, dataUrlToImageInput } from '@/services/tutor-engine';
import { classifyIntent } from '@/router/intent';
import { chunkSubtitles } from '@/timeline/chunker';
import { analyzeFrame } from '@/timeline/sparse-analysis';
import { cropDataUrl, NO_FRAME_MESSAGE } from '@/services/frame-capture';
import { resolveSubtitles } from '@/services/subtitle-resolver';
import { platformLabel } from '@/adapters/platform/registry';
import type { VideoInfo } from '@/services/context-assembly';
import type {
  BackgroundRequest,
  BackgroundResponse,
  ChatPortMessage,
  ChatStartPayload,
  CapabilityStatus,
  RuntimeContext,
  FrameCaptureResult,
  ContentRequest,
  ContentResponse,
} from '@/types/messaging';
import type { Settings, SavedModel, ModelAssignment } from '@/types/model';
import type { PageContext } from '@/types/page-context';
import type { KnowledgeChunk, Message, VideoRecord } from '@/types/knowledge';
import type { QuestionIntent } from '@/types/intent';
import type { SubtitleSegment } from '@/types/playback';

interface ChatPort {
  postMessage(message: ChatPortMessage): void;
}

/** Safely post to a port that may have been disconnected. */
function safePost(port: ChatPort, message: ChatPortMessage): void {
  try {
    port.postMessage(message);
  } catch {
    // Port disconnected — the receiving side is gone. Swallow to avoid
    // surfacing an unhandled exception in the service worker.
  }
}

/* ------------------------------------------------------------------ */
/* Content-script bridge                                                */
/* ------------------------------------------------------------------ */

async function getActiveTabId(): Promise<number | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

async function sendToContent(req: ContentRequest): Promise<ContentResponse> {
  const tabId = await getActiveTabId();
  if (tabId == null) return { type: 'ERROR', error: 'no active tab' };
  try {
    return (await browser.tabs.sendMessage(tabId, req)) as ContentResponse;
  } catch {
    return { type: 'ERROR', error: 'content script not responding' };
  }
}

/* ------------------------------------------------------------------ */
/* Provider assembly                                                    */
/* ------------------------------------------------------------------ */

interface ProviderSet {
  tutor: AiProvider;
  vision: AiProvider | null;
  video: AiProvider | null;
  audio: AiProvider | null;
  search: SearchProvider;
  searchModelName: string | null;
}

/**
 * Build an AiProvider from a SavedModel by looking up its saved API key.
 */
async function buildProviderFromSavedModel(model: SavedModel): Promise<AiProvider> {
  const apiKey = await getApiKey(model.protocol, model.baseUrl);
  return buildProvider({
    provider: model.protocol,
    modelId: model.modelId,
    baseUrl: model.baseUrl,
    apiKey: apiKey ?? undefined,
    displayName: model.name,
    capabilities: model.capabilities,
  } satisfies ProviderConfig);
}

/**
 * Resolve a ModelAssignment to a SavedModel, then to an AiProvider.
 * Returns null if the model is not found or not eligible.
 */
async function resolveAssignment(
  assignment: ModelAssignment | null,
  savedModels: SavedModel[],
): Promise<AiProvider | null> {
  if (!assignment) return null;
  const model = savedModels.find((m) => m.id === assignment.modelId);
  if (!model) return null;
  return buildProviderFromSavedModel(model);
}

/** Return the chat endpoint URL for a provider (for display in test results). */
function providerEndpoint(provider: AiProvider): string | undefined {
  // OpenAICompatibleProvider exposes baseUrl as a public readonly field.
  if ('baseUrl' in provider && typeof (provider as { baseUrl?: unknown }).baseUrl === 'string') {
    const p = provider as { baseUrl: string; authProfile?: { endpointPath: string } };
    const path = p.authProfile?.endpointPath ?? '/chat/completions';
    return `${p.baseUrl}${path}`;
  }
  // GeminiProvider uses a different URL pattern; show the model name instead.
  return undefined;
}

async function buildProviderSet(settings: Settings): Promise<ProviderSet> {
  const { savedModels, modelConfig } = settings;

  // Find the tutor model by assignment, or fall back to the first saved model.
  // If there are no saved models at all, use a Mock provider so the extension
  // doesn't crash — the UI will show "no models configured" guidance.
  const tutorModel = savedModels.find((m) => m.id === modelConfig.tutor.modelId);
  const fallbackModel = tutorModel ?? savedModels[0] ?? null;

  const tutor: AiProvider = fallbackModel
    ? await buildProviderFromSavedModel(fallbackModel)
    : new MockProvider({ provider: 'mock', modelId: 'mock-tutor' });

  const vision = await resolveAssignment(modelConfig.vision, savedModels);
  const video = await resolveAssignment(modelConfig.video, savedModels);
  const audio = await resolveAssignment(modelConfig.audio, savedModels);

  let searchBacker: AiProvider | null = null;
  const searchAssignment = modelConfig.search;
  if (searchAssignment) {
    searchBacker = await resolveAssignment(searchAssignment, savedModels);
  } else if (vision?.capabilities.nativeWebSearch) {
    searchBacker = vision;
  } else if (audio?.capabilities.nativeWebSearch) {
    searchBacker = audio;
  } else if (tutor.capabilities.nativeWebSearch) {
    searchBacker = tutor;
  }
  const search: SearchProvider = searchBacker
    ? createNativeSearchProvider(searchBacker)
    : createDisabledSearchProvider();

  return {
    tutor,
    vision,
    video,
    audio,
    search,
    searchModelName: searchBacker?.displayName ?? null,
  };
}

function computeCapabilityStatus(set: ProviderSet): CapabilityStatus {
  return {
    tutor: set.tutor.capabilities.textInput,
    vision:
      (set.vision?.capabilities.imageInput ?? false) ||
      set.tutor.capabilities.imageInput,
    video:
      (set.video?.capabilities.videoInput ?? false) ||
      set.tutor.capabilities.videoInput,
    audio:
      (set.audio?.capabilities.audioInput ?? false) ||
      set.tutor.capabilities.audioInput,
    search: set.search.available,
    tutorModel: set.tutor.displayName,
    visionModel:
      set.vision?.displayName ??
      (set.tutor.capabilities.imageInput ? set.tutor.displayName : null),
    videoModel:
      set.video?.displayName ??
      (set.tutor.capabilities.videoInput ? set.tutor.displayName : null),
    audioModel:
      set.audio?.displayName ??
      (set.tutor.capabilities.audioInput ? set.tutor.displayName : null),
    searchModel: set.searchModelName,
    isMock: set.tutor.provider === 'mock',
  };
}

/* ------------------------------------------------------------------ */
/* Frame capture (page video)                                           */
/* ------------------------------------------------------------------ */

async function capturePageFrame(): Promise<FrameCaptureResult> {
  const canvasResp = await sendToContent({ type: 'CAPTURE_FRAME_CANVAS' });
  if (canvasResp.type === 'FRAME_DATA_URL' && canvasResp.dataUrl) {
    return { dataUrl: canvasResp.dataUrl, rect: null, limitation: null };
  }

  const rectResp = await sendToContent({ type: 'GET_VIDEO_RECT' });
  if (rectResp.type !== 'VIDEO_RECT' || !rectResp.rect) {
    return { dataUrl: null, rect: null, limitation: NO_FRAME_MESSAGE };
  }

  const tabId = await getActiveTabId();
  if (tabId == null) {
    return { dataUrl: null, rect: rectResp.rect, limitation: NO_FRAME_MESSAGE };
  }

  try {
    const full = await browser.tabs.captureVisibleTab(tabId, {
      format: 'jpeg',
      quality: 80,
    });
    const cropped = await cropDataUrl(
      full,
      rectResp.rect,
      rectResp.viewport.width,
      rectResp.viewport.height,
    );
    return { dataUrl: cropped, rect: rectResp.rect, limitation: null };
  } catch {
    return { dataUrl: null, rect: rectResp.rect, limitation: NO_FRAME_MESSAGE };
  }
}

/* ------------------------------------------------------------------ */
/* Runtime context                                                      */
/* ------------------------------------------------------------------ */

async function buildRuntimeContext(settings: Settings): Promise<RuntimeContext> {
  const [pageResp, playbackResp, subtitleResp] = await Promise.all([
    sendToContent({ type: 'GET_PAGE_CONTEXT' }),
    sendToContent({ type: 'GET_PLAYBACK' }),
    sendToContent({ type: 'GET_SUBTITLES' }),
  ]);

  const pageContext: PageContext | null =
    pageResp.type === 'PAGE_CONTEXT' ? pageResp.context : null;
  const snapshot =
    playbackResp.type === 'PLAYBACK' ? playbackResp.snapshot : null;
  const subtitles =
    subtitleResp.type === 'SUBTITLES' ? subtitleResp.segments : [];
  const hasVideo = snapshot != null && snapshot.state !== 'unknown';

  const set = await buildProviderSet(settings);

  return {
    pageContext,
    playback: snapshot,
    subtitles,
    hasVideo,
    videoId: hasVideo && pageContext ? `page:${pageContext.url}` : null,
    videoTitle: pageContext?.title ?? null,
    capabilityStatus: computeCapabilityStatus(set),
  };
}

/* ------------------------------------------------------------------ */
/* Index building                                                       */
/* ------------------------------------------------------------------ */

function deriveSummary(transcript: string): string {
  const first = transcript.match(/^[^.!?。！？]{0,120}[.!?。！？]?/)?.[0]?.trim();
  return first && first.length > 0 ? first : transcript.slice(0, 120);
}

async function buildIndex(
  videoId: string,
  externalSubtitles?: SubtitleSegment[],
): Promise<{ ok: boolean; chunkCount: number; error?: string }> {
  // For local videos (videoId starts with "local:"), there is no page <video>
  // to read textTracks from. External subtitles are the primary source.
  // For page videos, we still try HTML textTracks as a fallback.
  const isLocal = videoId.startsWith('local:');

  let segments: SubtitleSegment[];

  if (isLocal) {
    // Local video: only external subtitles are available (no page <video>)
    segments = externalSubtitles ?? [];
  } else {
    // Page video: resolve from external (if provided) or HTML textTracks
    const subtitleResp = await sendToContent({ type: 'GET_SUBTITLES' });
    const htmlSegments =
      subtitleResp.type === 'SUBTITLES' ? subtitleResp.segments : [];
    const resolved = resolveSubtitles({
      htmlTrackVideo: null, // content script already extracted these
      externalSegments: externalSubtitles ?? null,
    });
    // If external subtitles provided, use them; otherwise use html tracks
    segments = externalSubtitles && externalSubtitles.length > 0
      ? externalSubtitles
      : htmlSegments;
    void resolved; // resolved used for label clarity in UI path
  }

  if (segments.length === 0) {
    return {
      ok: false,
      chunkCount: 0,
      error: '当前视频没有发现可读取字幕，无法建立时间轴索引。可使用「加载字幕」选择 .srt / .vtt 文件。',
    };
  }

  const chunks = chunkSubtitles(segments, { videoId }).map((c) => ({
    ...c,
    summary: c.summary ?? deriveSummary(c.transcript),
  }));
  await repo.putChunks(chunks);

  const existing = await repo.getVideo(videoId);
  const record: VideoRecord = {
    id: videoId,
    url: videoId.startsWith('page:') ? videoId.slice(5) : existing?.url,
    title: existing?.title,
    platformId: existing?.platformId,
    duration: existing?.duration,
    hasTranscript: true,
    hasVisualIndex: existing?.hasVisualIndex ?? false,
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  };
  await repo.upsertVideo(record);

  return { ok: true, chunkCount: chunks.length };
}

/* ------------------------------------------------------------------ */
/* Chat streaming                                                       */
/* ------------------------------------------------------------------ */

async function runChat(
  port: ChatPort,
  payload: ChatStartPayload,
  signal: AbortSignal,
): Promise<void> {
  const settings = await loadSettings();
  const set = await buildProviderSet(settings);

  let video: VideoInfo | null = null;
  let chunks: KnowledgeChunk[] = [];

  if (payload.videoId) {
    chunks = await repo.listChunks(payload.videoId);
  }

  if (payload.isLocalVideo) {
    video = {
      videoId: payload.videoId,
      title: payload.videoTitle,
      platformLabel: 'Local',
      duration: null,
    };
  } else {
    const pageResp = await sendToContent({ type: 'GET_PAGE_CONTEXT' });
    const pageContext =
      pageResp.type === 'PAGE_CONTEXT' ? pageResp.context : null;
    if (pageContext) {
      video = {
        videoId: `page:${pageContext.url}`,
        title: pageContext.title,
        platformLabel: platformLabel(pageContext.platformId),
        duration: null,
      };
    }
  }

  const intent =
    payload.intentHint ??
    classifyIntent(payload.question, { hasVideo: video != null });

  let frameDataUrl: string | null = payload.frameDataUrl ?? null;
  if (intent === 'VISUAL_QUESTION' && !payload.isLocalVideo && !frameDataUrl) {
    const frame = await capturePageFrame();
    frameDataUrl = frame.dataUrl;
  }

  const engine = new TutorEngine(set.tutor, set.vision, set.search, settings);

  const userMessage: Message = {
    id: repo.newId(),
    conversationId: payload.conversationId,
    role: 'user',
    content: payload.question,
    createdAt: Date.now(),
    meta: { intent, currentTime: payload.currentTime ?? undefined },
  };
  await repo.appendMessage(userMessage);

  let acc = '';
  let meta: {
    intent: QuestionIntent;
    currentTime: number | null;
    usedModels: string[];
    factChecked: boolean;
  } | null = null;

  try {
    for await (const ev of engine.answer(
      {
        question: payload.question,
        video,
        chunks,
        currentTime: payload.currentTime,
        frameDataUrl,
        intentHint: payload.intentHint,
      },
      signal,
    )) {
      switch (ev.type) {
        case 'delta':
          acc += ev.text;
          safePost(port, { type: 'CHAT_DELTA', text: ev.text });
          break;
        case 'sources':
          safePost(port, {
            type: 'CHAT_SOURCES',
            sources: ev.sources.map((s) => ({ url: s.url, title: s.title })),
          });
          break;
        case 'done':
          meta = ev.meta;
          break;
        case 'error':
          throw new Error(ev.error);
      }
    }

    const assistantMessage: Message = {
      id: repo.newId(),
      conversationId: payload.conversationId,
      role: 'assistant',
      content: acc,
      createdAt: Date.now(),
      meta: meta
        ? {
            intent: meta.intent,
            currentTime: meta.currentTime,
            usedModels: meta.usedModels,
            factChecked: meta.factChecked,
          }
        : undefined,
    };
    await repo.appendMessage(assistantMessage);

    safePost(port, {
      type: 'CHAT_META',
      meta:
        meta ?? {
          intent,
          currentTime: payload.currentTime,
          usedModels: [set.tutor.id],
          factChecked: false,
        },
    });
    safePost(port, {
      type: 'CHAT_DONE',
      result: {
        conversationId: payload.conversationId,
        userMessage,
        assistantMessage,
      },
    });
  } catch (e) {
    safePost(port, {
      type: 'CHAT_ERROR',
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/* ------------------------------------------------------------------ */
/* Message router                                                       */
/* ------------------------------------------------------------------ */

async function handleMessage(msg: BackgroundRequest): Promise<BackgroundResponse> {
  switch (msg.type) {
    case 'GET_RUNTIME_CONTEXT': {
      const settings = await loadSettings();
      return {
        type: 'RUNTIME_CONTEXT',
        context: await buildRuntimeContext(settings),
      };
    }

    case 'SEEK': {
      const resp = await sendToContent({ type: 'SEEK', time: msg.time });
      return { type: 'SEEK_ACK', ok: resp.type === 'SEEK_ACK' ? resp.ok : false };
    }

    case 'GET_SETTINGS':
      return { type: 'SETTINGS', settings: await loadSettings() };

    case 'SET_SETTINGS':
      await saveSettings(msg.settings);
      return { type: 'SETTINGS_SAVED', ok: true };

    case 'SAVE_API_KEY':
      await saveApiKey(msg.provider, msg.baseUrl, msg.key);
      return { type: 'SETTINGS_SAVED', ok: true };

    case 'GET_API_KEY_STATUS':
      return { type: 'API_KEY_STATUS', entries: await getApiKeyStatus() };

    case 'TEST_PROVIDER': {
      try {
        const apiKey = await getApiKey(msg.slot.provider, msg.slot.baseUrl);
        if (!apiKey) {
          return {
            type: 'TEST_RESULT',
            ok: false,
            error: '未配置 API Key',
            testResult: {
              ok: false,
              errorType: 'NO_API_KEY',
              errorMessage: '未配置 API Key。请先填写并保存 API Key。',
            },
          };
        }
        const caps = msg.slot.capabilities ?? capabilitiesOf(msg.slot.provider, msg.slot.modelId);
        const provider = buildProvider({
          provider: msg.slot.provider,
          modelId: msg.slot.modelId,
          baseUrl: msg.slot.baseUrl,
          apiKey,
          displayName: msg.slot.displayName,
          capabilities: caps,
        } satisfies ProviderConfig);
        const endpoint = providerEndpoint(provider);
        try {
          await provider.chat({
            model: provider.modelId,
            messages: [{ role: 'user', content: 'Reply exactly with: OK' }],
            maxTokens: 8,
          });
          return { type: 'TEST_RESULT', ok: true, testResult: { ok: true, endpoint } };
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          const statusMatch = /HTTP (\d+)/.exec(errMsg) ?? /\((\d+)\)/.exec(errMsg);
          const statusCode = statusMatch ? parseInt(statusMatch[1] ?? '0', 10) : undefined;
          const testResult = classifyTestError(e, statusCode, endpoint);
          return { type: 'TEST_RESULT', ok: false, error: testResult.errorMessage, testResult };
        }
      } catch (e) {
        const testResult = classifyTestError(e, undefined, msg.slot.baseUrl);
        return { type: 'TEST_RESULT', ok: false, error: testResult.errorMessage, testResult };
      }
    }

    case 'SAVE_MODEL': {
      try {
        await saveSavedModel(msg.model, msg.apiKey);
        return { type: 'MODEL_SAVED', ok: true };
      } catch (e) {
        return { type: 'ERROR', error: e instanceof Error ? e.message : String(e) };
      }
    }

    case 'DELETE_MODEL': {
      try {
        await deleteSavedModel(msg.modelId);
        return { type: 'MODEL_DELETED', ok: true };
      } catch (e) {
        return { type: 'ERROR', error: e instanceof Error ? e.message : String(e) };
      }
    }

    case 'GET_MODEL_KEY_STATUS': {
      const out: Record<string, boolean> = {};
      for (const m of msg.models) {
        const storageKey = m.baseUrl ? `${m.protocol}::${m.baseUrl}` : m.protocol;
        const apiKey = await getApiKey(m.protocol, m.baseUrl);
        out[storageKey] = apiKey !== null;
      }
      return { type: 'MODEL_KEY_STATUS', entries: out };
    }

    case 'DETECT_CAPABILITIES': {
      try {
        const apiKey = await getApiKey(msg.protocol, msg.baseUrl);
        if (!apiKey) {
          return {
            type: 'CAPABILITIES_DETECTED',
            ok: false,
            error: '未配置 API Key，无法检测能力。',
          };
        }
        const resolved = resolveCapabilities(msg.protocol, msg.modelId);
        const provider = buildProvider({
          provider: msg.protocol,
          modelId: msg.modelId,
          baseUrl: msg.baseUrl,
          apiKey,
          capabilities: resolved.capabilities,
        } satisfies ProviderConfig);

        // Test text input — a minimal chat request
        let textInput = false;
        try {
          await provider.chat({
            model: msg.modelId,
            messages: [{ role: 'user', content: 'Reply exactly with: OK' }],
            maxTokens: 8,
          });
          textInput = true;
        } catch {
          textInput = false;
        }

        // Image input: only test if the protocol/registry says it might work.
        // We do NOT auto-test audio/video/web-search (cost concerns).
        const registryCaps = resolved.capabilities;
        const detected = {
          textInput,
          imageInput: registryCaps.imageInput, // trust registry/protocol, don't auto-test
          functionCalling: registryCaps.functionCalling,
        };

        return { type: 'CAPABILITIES_DETECTED', ok: true, capabilities: detected };
      } catch (e) {
        return {
          type: 'CAPABILITIES_DETECTED',
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }

    case 'GET_TIMELINE':
      return { type: 'TIMELINE', chunks: await repo.listChunks(msg.videoId) };

    case 'BUILD_INDEX':
      return { type: 'INDEX_RESULT', ...(await buildIndex(msg.videoId, msg.externalSubtitles)) };

    case 'CAPTURE_FRAME':
      return { type: 'FRAME_CAPTURED', frame: await capturePageFrame() };

    case 'ANALYZE_FRAME': {
      const settings = await loadSettings();
      const set = await buildProviderSet(settings);
      if (!set.vision) {
        return { type: 'ANALYZE_FRAME_RESULT', ok: false, error: '当前配置没有视觉模型' };
      }
      const image = dataUrlToImageInput(msg.dataUrl);
      if (!image) {
        return { type: 'ANALYZE_FRAME_RESULT', ok: false, error: '无效的图片数据' };
      }
      const kf = await analyzeFrame(set.vision, image, msg.videoId, msg.timestamp);
      if (kf) {
        await repo.putKeyframe(kf);
        return { type: 'ANALYZE_FRAME_RESULT', ok: true };
      }
      return { type: 'ANALYZE_FRAME_RESULT', ok: false, error: '视觉分析失败' };
    }

    case 'REGISTER_LOCAL_VIDEO': {
      const existing = await repo.getVideo(msg.videoId);
      await repo.upsertVideo({
        id: msg.videoId,
        title: msg.title,
        platformId: 'local',
        duration: msg.duration,
        hasTranscript: existing?.hasTranscript ?? false,
        hasVisualIndex: existing?.hasVisualIndex ?? false,
        createdAt: existing?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      });
      return { type: 'LOCAL_VIDEO_REGISTERED', ok: true };
    }

    case 'LIST_CONVERSATIONS':
      return { type: 'CONVERSATIONS', conversations: await repo.listConversations() };

    case 'GET_CONVERSATION': {
      const messages = await repo.listMessages(msg.conversationId);
      const conv = await repo.getConversation(msg.conversationId);
      const video = conv?.videoId
        ? ((await repo.getVideo(conv.videoId)) ?? null)
        : null;
      return { type: 'CONVERSATION', messages, video };
    }

    case 'NEW_CONVERSATION': {
      const conv = await repo.createConversation(msg.videoId);
      return { type: 'CONVERSATION_CREATED', conversation: conv };
    }

    default:
      return { type: 'ERROR', error: 'unknown message type' };
  }
}

/* ------------------------------------------------------------------ */
/* Entrypoint                                                           */
/* ------------------------------------------------------------------ */

export default defineBackground(() => {
  browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {});

  const abortControllers = new Map<string, AbortController>();

  browser.runtime.onMessage.addListener(
    (message: BackgroundRequest, _sender, sendResponse) => {
      handleMessage(message)
        .then(sendResponse)
        .catch((e: unknown) =>
          sendResponse({
            type: 'ERROR',
            error: e instanceof Error ? e.message : String(e),
          } satisfies BackgroundResponse),
        );
      return true; // async response
    },
  );

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== 'chat') return;

    // Use a unique key per connection so reopening the side panel (or a
    // second connect before the old port disconnects) does not overwrite
    // the previous AbortController without aborting it.
    const portKey = `chat:${crypto.randomUUID()}`;
    let activeController: AbortController | null = null;

    port.onMessage.addListener((message: ChatPortMessage) => {
      if (message.type === 'CHAT_START') {
        // If a previous stream is still running on this port, abort it first.
        activeController?.abort();
        const ac = new AbortController();
        activeController = ac;
        abortControllers.set(portKey, ac);
        void runChat(port, message.payload, ac.signal);
      } else if (message.type === 'CHAT_ABORT') {
        activeController?.abort();
        activeController = null;
        abortControllers.delete(portKey);
      }
    });

    port.onDisconnect.addListener(() => {
      // Side panel closed or connection dropped — abort any in-flight stream
      // so provider fetch/SSE does not continue needlessly.
      activeController?.abort();
      abortControllers.delete(portKey);
    });
  });
});
