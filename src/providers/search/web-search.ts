/**
 * Independent web-search providers backed by a dedicated search API
 * (Tavily / Brave) — web search that does not depend on an AI model's native
 * grounding. Third sibling of createDisabledSearchProvider() and
 * createNativeSearchProvider().
 *
 * Contract shared with the other search providers:
 *   - `available: false` plus a Chinese `reason` when the provider cannot search.
 *   - `search()` returns [] for every failure mode (no key, network error,
 *     non-2xx, malformed body, abort). It never throws at its callers and never
 *     fabricates results.
 *   - The API key never appears in a message, a log or the provider object.
 */

import type { SearchProvider, SearchResult } from '../../types/provider';
import type { SearchServiceId } from '../../types/model';
import { isAbortError } from '../ai/sse';
import { isSafeHttpUrl } from '../../services/url-guard';

/**
 * Services with a real implementation: the persisted `SearchServiceId` union
 * minus `'none'`, which means "no dedicated service". Deriving it keeps the
 * settings dropdown and this module's switch in step — adding a service in one
 * place without the other is a type error.
 */
export type ExternalSearchService = Exclude<SearchServiceId, 'none'>;

export interface ExternalSearchConfig {
  service: ExternalSearchService;
  apiKey: string;
}

const TAVILY_SEARCH_ENDPOINT = 'https://api.tavily.com/search';
const BRAVE_SEARCH_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';

/** Result cap per request; these APIs bill per request, so keep it small. */
const MAX_RESULTS = 5;
const REQUEST_TIMEOUT_MS = 10_000;

/** User-visible (Chinese) explanation shown while a service has no API key. */
const MISSING_KEY_REASON: Record<ExternalSearchService, string> = {
  tavily:
    '未配置 Tavily API Key，无法使用独立联网搜索。请在设置中填入 Tavily API Key。',
  brave:
    '未配置 Brave Search API Key，无法使用独立联网搜索。请在设置中填入 Brave Search API Key。',
};

/** Display names for the settings dropdown and the capability summary. */
export const EXTERNAL_SEARCH_SERVICE_LABEL: Record<ExternalSearchService, string> = {
  tavily: 'Tavily',
  brave: 'Brave Search',
};

/* ------------------------------- HTTP helpers ------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A usable non-blank string, or undefined for anything else. */
function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** True for a timer-driven abort (`AbortSignal.timeout` throws TimeoutError). */
function isTimeoutError(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'TimeoutError';
}

/** Caller signal merged with the 10s deadline; either one aborts the request. */
function withTimeout(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/**
 * Guarded request returning a parsed JSON body, or null for every failure
 * mode: unsafe endpoint, network error, non-2xx or unparsable body. Callers
 * turn null into an empty result list — this module never throws at its callers
 * and never fabricates results.
 */
async function fetchJson(
  endpoint: string,
  init: RequestInit,
  callerSignal?: AbortSignal,
): Promise<unknown | null> {
  // Defense in depth: the endpoints are constants, but a request into loopback
  // / private / reserved space must never leave the extension.
  if (!isSafeHttpUrl(endpoint)) return null;

  try {
    const response = await fetch(endpoint, {
      ...init,
      signal: withTimeout(callerSignal),
    });
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch (e) {
    // A caller abort or the 10s deadline is an expected, silent outcome.
    if (isAbortError(e) || isTimeoutError(e)) return null;
    // Network and parse failures are equally non-fatal: no results, no throw.
    return null;
  }
}

/* ----------------------------- response parsing ----------------------------- */

/**
 * Map API items into SearchResult[]. Entries without a usable URL are dropped,
 * a missing/blank title falls back to the URL, and a missing snippet is simply
 * omitted.
 */
function toSearchResults(
  items: unknown[],
  snippetKey: 'content' | 'description',
): SearchResult[] {
  const results: SearchResult[] = [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    const url = nonEmptyString(item.url);
    if (!url) continue;
    const title = nonEmptyString(item.title) ?? url;
    const snippet = nonEmptyString(item[snippetKey]);
    results.push(
      snippet === undefined ? { title, url } : { title, url, snippet },
    );
  }
  return results;
}

/** `{ results: [{ title, url, content }] }` */
function parseTavilyResults(raw: unknown): SearchResult[] {
  if (!isRecord(raw)) return [];
  const results = raw.results;
  return Array.isArray(results) ? toSearchResults(results, 'content') : [];
}

/** `{ web: { results: [{ title, url, description }] } }` */
function parseBraveResults(raw: unknown): SearchResult[] {
  if (!isRecord(raw)) return [];
  const web = raw.web;
  if (!isRecord(web)) return [];
  const results = web.results;
  return Array.isArray(results) ? toSearchResults(results, 'description') : [];
}

/* --------------------------------- providers --------------------------------- */

interface ExternalRequest {
  url: string;
  init: RequestInit;
}

interface ExternalServiceSpec {
  /** Endpoint used in production; never user-controlled. */
  defaultEndpoint: string;
  /** GET/POST setup for one query. */
  buildRequest(query: string, apiKey: string, endpoint: string): ExternalRequest;
  /** Narrow a parsed body into results; [] for anything unexpected. */
  parseResults(raw: unknown): SearchResult[];
}

const EXTERNAL_SERVICES: Record<ExternalSearchService, ExternalServiceSpec> = {
  tavily: {
    defaultEndpoint: TAVILY_SEARCH_ENDPOINT,
    buildRequest(query, apiKey, endpoint) {
      return {
        url: endpoint,
        init: {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            query,
            max_results: MAX_RESULTS,
            search_depth: 'basic',
          }),
        },
      };
    },
    parseResults: parseTavilyResults,
  },
  brave: {
    defaultEndpoint: BRAVE_SEARCH_ENDPOINT,
    buildRequest(query, apiKey, endpoint) {
      return {
        url: `${endpoint}?q=${encodeURIComponent(query)}&count=${MAX_RESULTS}`,
        init: {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'X-Subscription-Token': apiKey,
          },
        },
      };
    },
    parseResults: parseBraveResults,
  },
};

/** Honest fallback for a persisted config naming a service we do not know. */
function createUnknownServiceProvider(): SearchProvider {
  return {
    id: 'external:unknown',
    available: false,
    reason:
      '联网搜索服务配置无法识别。请在设置中重新选择搜索服务，并填入对应的 API Key。',
    async search(): Promise<SearchResult[]> {
      return [];
    },
  };
}

function createExternalProvider(
  service: ExternalSearchService,
  apiKey: string,
  endpointOverride?: string,
): SearchProvider {
  const spec = EXTERNAL_SERVICES[service];
  const endpoint = endpointOverride ?? spec.defaultEndpoint;
  const key = apiKey.trim();
  const available = key !== '';

  return {
    id: `external:${service}`,
    available,
    reason: available ? undefined : MISSING_KEY_REASON[service],
    async search(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
      // No key: honest "cannot search", and no request is attempted at all.
      if (!available) return [];
      // Already cancelled: do not spend a billable request on it.
      if (signal?.aborted) return [];
      const { url, init } = spec.buildRequest(query, key, endpoint);
      return spec.parseResults(await fetchJson(url, init, signal));
    },
  };
}

/**
 * Tavily search provider (`POST https://api.tavily.com/search`).
 *
 * @param endpointOverride Test-only seam for the endpoint URL guard; production
 *   callers omit it and get the constant endpoint above.
 */
export function createTavilySearchProvider(
  apiKey: string,
  endpointOverride?: string,
): SearchProvider {
  return createExternalProvider('tavily', apiKey, endpointOverride);
}

/**
 * Brave Search API provider
 * (`GET https://api.search.brave.com/res/v1/web/search?q=…&count=5`).
 *
 * @param endpointOverride Test-only seam for the endpoint URL guard; production
 *   callers omit it and get the constant endpoint above.
 */
export function createBraveSearchProvider(
  apiKey: string,
  endpointOverride?: string,
): SearchProvider {
  return createExternalProvider('brave', apiKey, endpointOverride);
}

/** Build the search provider for the service selected in settings. */
export function createExternalSearchProvider(
  config: ExternalSearchConfig,
): SearchProvider {
  switch (config.service) {
    case 'tavily':
      return createTavilySearchProvider(config.apiKey);
    case 'brave':
      return createBraveSearchProvider(config.apiKey);
    default:
      // Config is persisted in storage, so an unknown service is possible.
      return createUnknownServiceProvider();
  }
}