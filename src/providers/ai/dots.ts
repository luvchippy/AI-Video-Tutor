import type { ModelCapabilities } from '../../types/model';
import type { AuthProfile } from '../../types/provider';
import { OpenAICompatibleProvider } from './openai-compatible';

export const DOTS_BASE_URL = 'https://note3-prev-api.askdiandian.com';

export const DOTS_CAPABILITIES: ModelCapabilities = {
  textInput: true,
  imageInput: true,
  audioInput: true,
  videoInput: true,
  videoFileUpload: false,
  directVideoUrl: true,
  youtubeUrl: false,
  nativeWebSearch: false,
  functionCalling: true,
  structuredOutput: false,
  streaming: true,
  contextWindow: 524288,
};

/**
 * Dots API auth profile: uses `api-key` header instead of `Authorization: Bearer`,
 * and `/v1/chat/completions` endpoint path instead of `/chat/completions`.
 */
export const DOTS_AUTH_PROFILE: AuthProfile = {
  authHeader: 'api-key',
  authScheme: '',
  endpointPath: '/v1/chat/completions',
};

/**
 * Dots API provider.
 *
 * Uses the OpenAI chat/completions request body format (same JSON structure),
 * but differs in:
 *   1. Authentication: `api-key: <key>` header (NOT `Authorization: Bearer <key>`)
 *   2. Endpoint path: `/v1/chat/completions` (base URL has no `/v1` suffix)
 *   3. Multimodal: natively supports `video_url` and `audio_url` content parts
 *
 * This class extends OpenAICompatibleProvider, reusing all SSE parsing,
 * error handling, and response parsing — only overriding the auth profile
 * (via constructor) and content part serialization (via serializePart).
 */
export class DotsProvider extends OpenAICompatibleProvider {
  constructor(config: {
    provider?: string;
    modelId: string;
    baseUrl?: string;
    apiKey?: string;
    displayName?: string;
    capabilities?: ModelCapabilities;
  }) {
    super(
      {
        provider: 'dots',
        modelId: config.modelId,
        baseUrl: config.baseUrl ?? DOTS_BASE_URL,
        apiKey: config.apiKey,
        displayName: config.displayName ?? config.modelId,
        capabilities: config.capabilities ?? DOTS_CAPABILITIES,
        authProfile: DOTS_AUTH_PROFILE,
      },
      DOTS_CAPABILITIES,
    );
  }

  /**
   * Override serializePart to support native video_url and audio_url content
   * parts (Dots supports these natively, unlike standard OpenAI-compatible).
   */
  protected override serializePart(part: {
    type: string;
    text?: string;
    image_url?: { url: string; detail?: 'low' | 'high' | 'auto' };
    inline_image?: { mimeType: string; data: string };
    video_url?: { url: string };
    audio_url?: { url: string };
  }) {
    switch (part.type) {
      case 'text':
        return { type: 'text' as const, text: part.text ?? '' };
      case 'image_url':
        return {
          type: 'image_url' as const,
          image_url: {
            url: part.image_url?.url ?? '',
            detail: part.image_url?.detail,
          },
        };
      case 'inline_image':
        return {
          type: 'image_url' as const,
          image_url: {
            url: `data:${part.inline_image?.mimeType};base64,${part.inline_image?.data}`,
          },
        };
      case 'video_url':
        return {
          type: 'video_url' as const,
          video_url: { url: part.video_url?.url ?? '' },
        };
      case 'audio_url':
        return {
          type: 'audio_url' as const,
          audio_url: { url: part.audio_url?.url ?? '' },
        };
      default:
        return { type: 'text' as const, text: `[unknown content type: ${part.type}]` };
    }
  }
}
