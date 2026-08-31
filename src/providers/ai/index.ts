import type { AiProvider, ProviderConfig } from '../../types/provider';
import type { ModelCapabilities } from '../../types/model';
import { GeminiProvider, GEMINI_CAPABILITIES } from './gemini';
import {
  OpenAICompatibleProvider,
  OPENAI_DEFAULT_CAPABILITIES,
} from './openai-compatible';
import { DeepSeekProvider, DEEPSEEK_CAPABILITIES } from './deepseek';
import { QwenProvider, QWEN_CAPABILITIES } from './qwen';
import { DotsProvider, DOTS_CAPABILITIES } from './dots';
import { MockProvider, MOCK_CAPABILITIES } from './mock';

export { GeminiProvider, GEMINI_CAPABILITIES } from './gemini';
export {
  OpenAICompatibleProvider,
  OPENAI_DEFAULT_CAPABILITIES,
  TEXT_ONLY_CAPABILITIES,
} from './openai-compatible';
export { DeepSeekProvider, DEEPSEEK_CAPABILITIES } from './deepseek';
export { QwenProvider, QWEN_CAPABILITIES } from './qwen';
export { DotsProvider, DOTS_CAPABILITIES, DOTS_BASE_URL, DOTS_AUTH_PROFILE } from './dots';
export { MockProvider, MOCK_CAPABILITIES } from './mock';
export { iterateSse, isAbortError } from './sse';

/** Default capabilities per provider kind (used when the registry/override has none). */
export function capabilitiesFor(
  provider: string,
  _modelId: string,
  override?: ModelCapabilities,
): ModelCapabilities {
  if (override) return override;
  switch (provider) {
    case 'gemini':
      return GEMINI_CAPABILITIES;
    case 'deepseek':
      return DEEPSEEK_CAPABILITIES;
    case 'qwen':
      return QWEN_CAPABILITIES;
    case 'dots':
    case 'dots-openai':
      return DOTS_CAPABILITIES;
    case 'mock':
      return MOCK_CAPABILITIES;
    default:
      return OPENAI_DEFAULT_CAPABILITIES;
  }
}

/**
 * Factory: build a concrete AiProvider from a runtime config (apiKey only in
 * the background service worker, never sent to content scripts).
 */
export function buildProvider(config: ProviderConfig): AiProvider {
  switch (config.provider) {
    case 'mock':
      return new MockProvider(config);
    case 'gemini':
      return new GeminiProvider(config);
    case 'deepseek':
      return new DeepSeekProvider(config);
    case 'qwen':
      return new QwenProvider(config);
    case 'dots':
    case 'dots-openai':
      return new DotsProvider(config);
    case 'openai':
      return new OpenAICompatibleProvider({ ...config, provider: 'openai' });
    case 'custom':
    case 'openai-compatible':
    default:
      return new OpenAICompatibleProvider(config);
  }
}
