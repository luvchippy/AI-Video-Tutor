/**
 * AI Provider + Search Provider Layer types.
 */

import type { ModelCapabilities } from './model';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } }
  | { type: 'inline_image'; inline_image: { mimeType: string; data: string } }
  | { type: 'video_url'; video_url: { url: string } };

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Ask the provider to use native web-search grounding (best effort). */
  webSearch?: boolean;
  /** Ask the model to return JSON (best effort; may be ignored). */
  responseJson?: boolean;
}

export interface Usage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface GroundingSource {
  url: string;
  title: string;
}

export interface GroundingMetadata {
  webSearchQueries: string[];
  sources: GroundingSource[];
}

export interface StreamChunk {
  text: string;
  reasoning?: string;
  done: boolean;
  finishReason: string | null;
  usage?: Usage;
  grounding?: GroundingMetadata;
}

export interface ChatResult {
  text: string;
  reasoning?: string;
  finishReason: string | null;
  usage?: Usage;
  grounding?: GroundingMetadata;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
}

/** A base64 image handed to a vision-capable provider. */
export interface ImageInput {
  mimeType: string;
  data: string;
}

/**
 * A concrete AI provider. `search` returns [] when the provider has no native
 * web-search capability (never fabricate results).
 */
export interface AiProvider {
  id: string;
  provider: string;
  modelId: string;
  displayName: string;
  capabilities: ModelCapabilities;
  streamChat(req: ChatRequest, signal?: AbortSignal): AsyncGenerator<StreamChunk>;
  chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResult>;
  analyzeImage(
    image: ImageInput,
    prompt: string,
    signal?: AbortSignal,
  ): Promise<string>;
  search(query: string, signal?: AbortSignal): Promise<SearchResult[]>;
}

export interface SearchProvider {
  id: string;
  available: boolean;
  reason?: string;
  search(query: string, signal?: AbortSignal): Promise<SearchResult[]>;
}

/**
 * Auth + endpoint profile. Allows providers that use the OpenAI chat/completions
 * request body format but differ in authentication or endpoint path.
 */
export interface AuthProfile {
  /** Header name for the API key. Default: 'Authorization' */
  authHeader: string;
  /** Header value prefix. Default: 'Bearer ' (trailing space included). */
  authScheme: string;
  /** Path appended to baseUrl. Default: '/chat/completions' */
  endpointPath: string;
}

export const DEFAULT_AUTH_PROFILE: AuthProfile = {
  authHeader: 'Authorization',
  authScheme: 'Bearer ',
  endpointPath: '/chat/completions',
};

/** Runtime config a provider factory consumes (apiKey only in background). */
export interface ProviderConfig {
  provider: string;
  modelId: string;
  baseUrl?: string;
  apiKey?: string;
  displayName?: string;
  capabilities?: ModelCapabilities;
  /** Auth + endpoint profile. Defaults to standard OpenAI (Authorization: Bearer). */
  authProfile?: AuthProfile;
}
