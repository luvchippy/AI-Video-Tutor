import type { AiProvider, SearchProvider, SearchResult } from '../../types/provider';

/**
 * Honest "no web search" messaging. Never pretend we searched the web.
 */
export const NO_WEB_SEARCH_MESSAGE =
  '当前配置没有联网搜索能力。回答将仅根据：当前视频、本地知识索引、模型自身知识生成。';

export const NOT_VERIFIED_TAG = '未联网核实';

/** Always-available disabled provider — returns [] and marks itself disabled. */
export function createDisabledSearchProvider(): SearchProvider {
  return {
    id: 'disabled',
    available: false,
    reason: NO_WEB_SEARCH_MESSAGE,
    async search(): Promise<SearchResult[]> {
      return [];
    },
  };
}

/**
 * Wraps an AI provider's native web-search grounding (e.g. Gemini google_search).
 * Unavailable when the provider lacks `nativeWebSearch`.
 */
export function createNativeSearchProvider(provider: AiProvider): SearchProvider {
  const available = provider.capabilities.nativeWebSearch;
  return {
    id: `native:${provider.id}`,
    available,
    reason: available ? undefined : NO_WEB_SEARCH_MESSAGE,
    async search(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
      if (!available) return [];
      return provider.search(query, signal);
    },
  };
}
