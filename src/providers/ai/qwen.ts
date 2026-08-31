import type { ProviderConfig } from '../../types/provider';
import { OpenAICompatibleProvider } from './openai-compatible';

export const QWEN_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

export const QWEN_CAPABILITIES = {
  textInput: true,
  imageInput: true,
  audioInput: false,
  videoInput: true, // Qwen-VL supports video_url; not wired into our content mapping yet
  videoFileUpload: true,
  directVideoUrl: true,
  youtubeUrl: false,
  nativeWebSearch: false,
  functionCalling: false,
  structuredOutput: false,
  streaming: true,
};

/**
 * Qwen (DashScope) uses an OpenAI-compatible endpoint. video_url / Omni audio
 * (modalities + audio fields) are NOT implemented yet — see TODO below.
 */
export class QwenProvider extends OpenAICompatibleProvider {
  constructor(config: ProviderConfig) {
    super(
      {
        ...config,
        provider: 'qwen',
        baseUrl: config.baseUrl ?? QWEN_BASE_URL,
      },
      QWEN_CAPABILITIES,
    );
  }
}

// TODO: Qwen-specific extensions not yet wired:
//  - video_url content part: { type: 'video_url', video_url: { url }, fps }
//  - Qwen-Omni audio output: { modalities: ['text','audio'], audio: { voice, format } }
//  - note: Qwen forbids `tools` combined with `stream: true`.
