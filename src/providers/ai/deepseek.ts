import type { ProviderConfig } from '../../types/provider';
import { OpenAICompatibleProvider, TEXT_ONLY_CAPABILITIES } from './openai-compatible';

export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

export const DEEPSEEK_CAPABILITIES = TEXT_ONLY_CAPABILITIES;

/**
 * DeepSeek is fully OpenAI-compatible (baseUrl https://api.deepseek.com).
 * Text-only: no image/video/audio input, no hosted web search.
 */
export class DeepSeekProvider extends OpenAICompatibleProvider {
  constructor(config: ProviderConfig) {
    super(
      {
        ...config,
        provider: 'deepseek',
        baseUrl: config.baseUrl ?? DEEPSEEK_BASE_URL,
      },
      DEEPSEEK_CAPABILITIES,
    );
  }
}
