import type {
  AiProvider,
  ChatMessage,
  ChatRequest,
  ChatResult,
  ContentPart,
  GroundingMetadata,
  ImageInput,
  SearchResult,
  StreamChunk,
  Usage,
} from '../../types/provider';
import type { ModelCapabilities } from '../../types/model';
import type { ProviderConfig, AuthProfile } from '../../types/provider';
import { DEFAULT_AUTH_PROFILE } from '../../types/provider';
import { iterateSse, isAbortError } from './sse';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

export const OPENAI_DEFAULT_CAPABILITIES: ModelCapabilities = {
  textInput: true,
  imageInput: true,
  audioInput: false,
  videoInput: false,
  videoFileUpload: false,
  directVideoUrl: false,
  youtubeUrl: false,
  nativeWebSearch: false,
  functionCalling: true,
  structuredOutput: true,
  streaming: true,
  contextWindow: 128000,
};

export const TEXT_ONLY_CAPABILITIES: ModelCapabilities = {
  textInput: true,
  imageInput: false,
  audioInput: false,
  videoInput: false,
  videoFileUpload: false,
  directVideoUrl: false,
  youtubeUrl: false,
  nativeWebSearch: false,
  functionCalling: true,
  structuredOutput: false,
  streaming: true,
  contextWindow: 65536,
};

interface OpenAiContentPart {
  type: 'text' | 'image_url' | 'video_url' | 'audio_url';
  text?: string;
  image_url?: { url: string; detail?: 'low' | 'high' | 'auto' };
  video_url?: { url: string };
  audio_url?: { url: string };
  [key: string]: unknown;
}

interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | OpenAiContentPart[];
}

interface OpenAiRequestBody {
  model: string;
  messages: OpenAiMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  stream_options?: { include_usage: boolean };
}

interface OpenAiDelta {
  role?: string;
  content?: string | null;
  reasoning_content?: string | null;
}
interface OpenAiChoice {
  delta?: OpenAiDelta;
  finish_reason?: string | null;
}
interface OpenAiStreamChunk {
  choices: OpenAiChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}
interface OpenAiResponse {
  choices?: {
    message?: { content?: string; reasoning_content?: string };
    finish_reason?: string;
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}
interface OpenAiErrorBody {
  error?: { message?: string };
}

/**
 * Convert a ContentPart to the OpenAI-compatible content part format.
 * Overridable by subclasses to support provider-specific multimodal types.
 */
function toOpenAiPart(part: ContentPart): OpenAiContentPart {
  switch (part.type) {
    case 'text':
      return { type: 'text', text: part.text };
    case 'image_url':
      return {
        type: 'image_url',
        image_url: {
          url: part.image_url.url,
          detail: part.image_url.detail,
        },
      };
    case 'inline_image':
      return {
        type: 'image_url',
        image_url: {
          url: `data:${part.inline_image.mimeType};base64,${part.inline_image.data}`,
        },
      };
    case 'video_url':
      // Standard OpenAI-compatible endpoints have no native video part.
      // Fall back to text so the request still succeeds for text models.
      return { type: 'text', text: `[video url: ${part.video_url.url}]` };
  }
}

function usageFrom(u?: {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}): Usage | undefined {
  if (!u) return undefined;
  const usage: Usage = {};
  if (u.prompt_tokens !== undefined) usage.promptTokens = u.prompt_tokens;
  if (u.completion_tokens !== undefined)
    usage.completionTokens = u.completion_tokens;
  if (u.total_tokens !== undefined) usage.totalTokens = u.total_tokens;
  return usage;
}

function normalizeBaseUrl(baseUrl?: string, endpointPath: string = '/chat/completions'): string {
  let url = (baseUrl ?? DEFAULT_BASE_URL).trim();
  // If the user pasted the full endpoint (e.g. https://api.example.com/v1/chat/completions),
  // strip the endpoint suffix — we append it ourselves in request().
  if (url.endsWith(endpointPath)) {
    url = url.slice(0, -endpointPath.length);
  }
  // Also strip a bare /chat/completions if the endpointPath is different
  // (e.g. dots endpointPath is /v1/chat/completions but user pasted .../chat/completions)
  const chatSuffix = '/chat/completions';
  if (endpointPath !== chatSuffix && url.endsWith(chatSuffix)) {
    url = url.slice(0, -chatSuffix.length);
  }
  // If the endpointPath starts with a path segment (e.g. /v1/chat/completions)
  // and the baseUrl ends with that same segment, strip it to avoid duplication.
  const pathParts = endpointPath.split('/').filter(Boolean); // ['v1', 'chat', 'completions']
  if (pathParts.length > 1) {
    const firstSegment = `/${pathParts[0]}`; // '/v1'
    if (url.endsWith(firstSegment)) {
      url = url.slice(0, -firstSegment.length);
    }
  }
  // Strip trailing slash for consistent concatenation.
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export class OpenAICompatibleProvider implements AiProvider {
  readonly id: string;
  readonly provider: string;
  readonly modelId: string;
  readonly displayName: string;
  readonly capabilities: ModelCapabilities;
  private readonly apiKey: string;
  readonly baseUrl: string;
  protected readonly authProfile: AuthProfile;

  constructor(config: ProviderConfig, defaultCaps: ModelCapabilities = OPENAI_DEFAULT_CAPABILITIES) {
    this.provider = config.provider || 'openai';
    this.modelId = config.modelId;
    this.apiKey = config.apiKey ?? '';
    this.authProfile = config.authProfile ?? DEFAULT_AUTH_PROFILE;
    this.baseUrl = normalizeBaseUrl(config.baseUrl, this.authProfile.endpointPath);
    this.displayName = config.displayName ?? config.modelId;
    this.capabilities = config.capabilities ?? defaultCaps;
    this.id = `${this.provider}:${config.modelId}`;
  }

  /** Override this to change how content parts are serialized. */
  protected serializePart(part: ContentPart): OpenAiContentPart {
    return toOpenAiPart(part);
  }

  private buildBody(req: ChatRequest, stream: boolean): OpenAiRequestBody {
    const messages: OpenAiMessage[] = req.messages.map((m) => ({
      role: m.role,
      content: typeof m.content === 'string'
        ? m.content
        : m.content.map((p) => this.serializePart(p)),
    }));
    const body: OpenAiRequestBody = {
      model: req.model || this.modelId,
      messages,
    };
    if (stream) {
      body.stream = true;
      body.stream_options = { include_usage: true };
    }
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
    return body;
  }

  private async request(
    body: OpenAiRequestBody,
    signal?: AbortSignal,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    headers[this.authProfile.authHeader] = `${this.authProfile.authScheme}${this.apiKey}`;
    try {
      return await fetch(`${this.baseUrl}${this.authProfile.endpointPath}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      if (isAbortError(e)) throw new Error('aborted', { cause: e });
      throw e;
    }
  }

  private async throwOnError(response: Response): Promise<never> {
    let message = `OpenAI API error (${response.status})`;
    try {
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('text/event-stream')) {
        // Error response is SSE — read text, try to extract error from first data line
        const text = await response.text();
        const firstData = /data:\s*(.*)/m.exec(text)?.[1] ?? '';
        if (firstData) {
          try {
            const parsed = JSON.parse(firstData) as OpenAiErrorBody;
            if (parsed.error?.message) message = `OpenAI API error: ${parsed.error.message}`;
          } catch {
            // Non-JSON error body, use generic message with status
          }
        }
      } else {
        const body: OpenAiErrorBody = await response.json();
        if (body.error?.message) message = `OpenAI API error: ${body.error.message}`;
      }
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  async *streamChat(
    req: ChatRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamChunk> {
    const response = await this.request(this.buildBody(req, true), signal);
    if (!response.ok) await this.throwOnError(response);

    try {
      for await (const payload of iterateSse(response)) {
        if (payload.trim() === '[DONE]') break;
        let data: OpenAiStreamChunk;
        try {
          data = JSON.parse(payload) as OpenAiStreamChunk;
        } catch {
          continue;
        }
        const choice = data.choices[0];
        const delta = choice?.delta;
        const finishReason = choice?.finish_reason ?? null;
        if (!choice && data.usage) {
          // usage-only final chunk
          yield {
            text: '',
            done: true,
            finishReason: 'stop',
            usage: usageFrom(data.usage),
          };
          continue;
        }
        yield {
          text: delta?.content ?? '',
          reasoning: delta?.reasoning_content ?? undefined,
          done: finishReason === 'stop',
          finishReason,
          usage: usageFrom(data.usage),
        };
      }
    } catch (e) {
      if (isAbortError(e)) throw new Error('aborted', { cause: e });
      throw e;
    }
  }

  async chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResult> {
    const response = await this.request(this.buildBody(req, false), signal);
    if (!response.ok) await this.throwOnError(response);

    // Some relay/proxy servers return SSE (text/event-stream) even when
    // stream:false was requested. Detect by Content-Type and handle both.
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('text/event-stream')) {
      return this.parseSseAsChatResult(response);
    }

    const data: OpenAiResponse = await response.json();
    const choice = data.choices?.[0];
    return {
      text: choice?.message?.content ?? '',
      reasoning: choice?.message?.reasoning_content,
      finishReason: choice?.finish_reason ?? null,
      usage: usageFrom(data.usage),
    };
  }

  /**
   * Parse an SSE response as a single ChatResult. Handles the case where a
   * relay returns `text/event-stream` despite `stream: false` being requested.
   * Concatenates all delta content and extracts the finish_reason + usage.
   */
  private async parseSseAsChatResult(response: Response): Promise<ChatResult> {
    let text = '';
    let reasoning: string | undefined;
    let finishReason: string | null = null;
    let usage: Usage | undefined;

    for await (const payload of iterateSse(response)) {
      if (payload.trim() === '[DONE]') break;
      let data: OpenAiStreamChunk;
      try {
        data = JSON.parse(payload) as OpenAiStreamChunk;
      } catch {
        continue;
      }
      const choice = data.choices?.[0];
      const delta = choice?.delta;
      if (delta?.content) text += delta.content;
      if (delta?.reasoning_content) reasoning = (reasoning ?? '') + delta.reasoning_content;
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (data.usage) usage = usageFrom(data.usage);

      // Also handle non-streaming format inside SSE (message field)
      if (!delta && choice) {
        const msg = (choice as unknown as { message?: { content?: string; reasoning_content?: string } }).message;
        if (msg?.content) text += msg.content;
        if (msg?.reasoning_content) reasoning = (reasoning ?? '') + msg.reasoning_content;
        if (choice.finish_reason) finishReason = choice.finish_reason;
      }
    }

    return { text, reasoning, finishReason, usage };
  }

  async analyzeImage(
    image: ImageInput,
    prompt: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const result = await this.chat(
      {
        model: this.modelId,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${image.mimeType};base64,${image.data}`,
                },
              },
            ],
          },
        ],
      },
      signal,
    );
    return result.text;
  }

  async search(
    _query: string,
    _signal?: AbortSignal,
  ): Promise<SearchResult[]> {
    // OpenAI-compatible providers (incl. DeepSeek/Qwen) have no hosted web
    // search via /chat/completions. Never fabricate results.
    return [];
  }
}

export type { GroundingMetadata, ChatMessage };
