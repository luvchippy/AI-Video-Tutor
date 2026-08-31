/**
 * Typed messaging contracts.
 *
 * Three channels:
 *  1. Background  -> Content script  (via browser.tabs.sendMessage)
 *  2. Side panel  -> Background      (via browser.runtime.sendMessage)
 *  3. Side panel <-> Background chat stream (via browser.runtime.connect Port)
 */

import type { PageContext, Rect } from './page-context';
import type { PlaybackSnapshot, SubtitleSegment } from './playback';
import type {
  KnowledgeChunk,
  Conversation,
  Message,
  VideoRecord,
} from './knowledge';
import type { Settings, ModelSlot, SavedModel, ProviderProtocol } from './model';
import type { QuestionIntent } from './intent';

/* ------------------------------------------------------------------ */
/* Background -> Content script                                         */
/* ------------------------------------------------------------------ */

export type ContentRequest =
  | { type: 'GET_PAGE_CONTEXT' }
  | { type: 'GET_PLAYBACK' }
  | { type: 'GET_SUBTITLES' }
  | { type: 'GET_VIDEO_RECT' }
  | { type: 'CAPTURE_FRAME_CANVAS' }
  | { type: 'SEEK'; time: number };

export type ContentResponse =
  | { type: 'PAGE_CONTEXT'; context: PageContext }
  | { type: 'PLAYBACK'; snapshot: PlaybackSnapshot }
  | { type: 'SUBTITLES'; segments: SubtitleSegment[] }
  | { type: 'VIDEO_RECT'; rect: Rect | null; viewport: { width: number; height: number } }
  | { type: 'FRAME_DATA_URL'; dataUrl: string | null }
  | { type: 'SEEK_ACK'; ok: boolean }
  | { type: 'ERROR'; error: string };

/* ------------------------------------------------------------------ */
/* Side panel -> Background                                             */
/* ------------------------------------------------------------------ */

export interface CapabilityStatus {
  tutor: boolean;
  vision: boolean;
  video: boolean;
  audio: boolean;
  search: boolean;
  tutorModel: string | null;
  visionModel: string | null;
  videoModel: string | null;
  audioModel: string | null;
  searchModel: string | null;
  isMock: boolean;
}

export interface RuntimeContext {
  pageContext: PageContext | null;
  playback: PlaybackSnapshot | null;
  subtitles: SubtitleSegment[];
  hasVideo: boolean;
  videoId: string | null;
  videoTitle: string | null;
  capabilityStatus: CapabilityStatus;
}

export interface ChatStartPayload {
  conversationId: string;
  question: string;
  intentHint?: QuestionIntent;
  currentTime: number | null;
  videoId: string | null;
  videoTitle: string | null;
  isLocalVideo: boolean;
  frameDataUrl?: string | null;
}

export interface ChatTurnResult {
  conversationId: string;
  userMessage: Message;
  assistantMessage: Message;
}

export interface FrameCaptureResult {
  dataUrl: string | null;
  rect: Rect | null;
  limitation: string | null;
}

export type BackgroundRequest =
  | { type: 'GET_RUNTIME_CONTEXT' }
  | { type: 'SEEK'; time: number }
  | { type: 'GET_SETTINGS' }
  | { type: 'SET_SETTINGS'; settings: Settings }
  | { type: 'SAVE_API_KEY'; provider: string; baseUrl: string | null; key: string }
  | { type: 'GET_API_KEY_STATUS' }
  | { type: 'TEST_PROVIDER'; slot: ModelSlot }
  | { type: 'SAVE_MODEL'; model: SavedModel; apiKey?: string }
  | { type: 'DELETE_MODEL'; modelId: string }
  | { type: 'GET_MODEL_KEY_STATUS'; models: { protocol: string; baseUrl?: string }[] }
  | { type: 'DETECT_CAPABILITIES'; protocol: ProviderProtocol; baseUrl?: string; modelId: string }
  | { type: 'GET_TIMELINE'; videoId: string }
  | { type: 'BUILD_INDEX'; videoId: string; externalSubtitles?: SubtitleSegment[] }
  | { type: 'CAPTURE_FRAME' }
  | { type: 'ANALYZE_FRAME'; videoId: string; timestamp: number; dataUrl: string }
  | { type: 'REGISTER_LOCAL_VIDEO'; videoId: string; title: string; duration: number }
  | { type: 'LIST_CONVERSATIONS' }
  | { type: 'GET_CONVERSATION'; conversationId: string }
  | { type: 'NEW_CONVERSATION'; videoId: string | null };

export interface ProviderTestResult {
  ok: boolean;
  errorType?: string;
  errorMessage?: string;
  statusCode?: number;
  endpoint?: string;
  /** Detected capabilities (only when detection was performed). */
  detectedCapabilities?: { textInput: boolean; imageInput: boolean; functionCalling: boolean };
}

export type BackgroundResponse =
  | { type: 'RUNTIME_CONTEXT'; context: RuntimeContext }
  | { type: 'SEEK_ACK'; ok: boolean }
  | { type: 'SETTINGS'; settings: Settings }
  | { type: 'SETTINGS_SAVED'; ok: boolean }
  | { type: 'API_KEY_STATUS'; entries: Record<string, boolean> }
  | { type: 'TEST_RESULT'; ok: boolean; error?: string; testResult?: ProviderTestResult }
  | { type: 'MODEL_SAVED'; ok: boolean }
  | { type: 'MODEL_DELETED'; ok: boolean }
  | { type: 'MODEL_KEY_STATUS'; entries: Record<string, boolean> }
  | { type: 'CAPABILITIES_DETECTED'; ok: boolean; capabilities?: { textInput: boolean; imageInput: boolean; functionCalling: boolean }; error?: string }
  | { type: 'TIMELINE'; chunks: KnowledgeChunk[] }
  | { type: 'INDEX_RESULT'; ok: boolean; chunkCount: number; error?: string }
  | { type: 'FRAME_CAPTURED'; frame: FrameCaptureResult }
  | { type: 'ANALYZE_FRAME_RESULT'; ok: boolean; error?: string }
  | { type: 'LOCAL_VIDEO_REGISTERED'; ok: boolean }
  | { type: 'CONVERSATIONS'; conversations: Conversation[] }
  | { type: 'CONVERSATION'; messages: Message[]; video: VideoRecord | null }
  | { type: 'CONVERSATION_CREATED'; conversation: Conversation }
  | { type: 'ERROR'; error: string };

/* ------------------------------------------------------------------ */
/* Chat streaming Port protocol                                         */
/* ------------------------------------------------------------------ */

export type ChatPortMessage =
  | { type: 'CHAT_START'; payload: ChatStartPayload }
  | { type: 'CHAT_ABORT' }
  | { type: 'CHAT_DELTA'; text: string }
  | { type: 'CHAT_REASONING'; text: string }
  | { type: 'CHAT_SOURCES'; sources: { url: string; title: string }[] }
  | { type: 'CHAT_META'; meta: { intent: QuestionIntent; currentTime: number | null; usedModels: string[]; factChecked: boolean } }
  | { type: 'CHAT_DONE'; result: ChatTurnResult }
  | { type: 'CHAT_ERROR'; error: string };
