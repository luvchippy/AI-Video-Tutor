import { z } from 'zod';
import type { ModelCapabilities, ModelDefinition } from '../types/model';
import { ModelRegistrySchema } from './schema';
import rawOverrides from '../data/model-overrides.json';

const REMOTE_URL = 'https://models.dev/catalog.json';
const CACHE_KEY = 'remote-model-registry';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * models.dev catalog schema (Zod).
 * The catalog is a record of provider_id → provider object, where each
 * provider has a `models` record of model_id → model object.
 *
 * We only extract the fields we need for capability mapping.
 */

const RemoteModalitySchema = z.array(z.string());

const RemoteModelSchema = z.object({
  name: z.string().optional(),
  tool_call: z.boolean().optional().default(false),
  reasoning: z.boolean().optional().default(false),
  structured_output: z.boolean().optional().default(false),
  attachment: z.boolean().optional().default(false),
  limit: z.object({
    context: z.number().optional(),
    input: z.number().optional(),
    output: z.number().optional(),
  }).optional(),
  modalities: z.object({
    input: RemoteModalitySchema.optional(),
    output: RemoteModalitySchema.optional(),
  }).optional(),
  status: z.string().optional(),
});

const RemoteProviderSchema = z.object({
  name: z.string().optional(),
  api: z.string().optional(),
  npm: z.string().optional(),
  models: z.record(z.string(), RemoteModelSchema).optional(),
});

const RemoteCatalogSchema = z.record(z.string(), RemoteProviderSchema);

export type RemoteCatalog = z.infer<typeof RemoteCatalogSchema>;

/**
 * Map models.dev modalities + flags to our ModelCapabilities.
 *
 * modalities.input ["text"]  → textInput
 * modalities.input ["image"] → imageInput
 * modalities.input ["audio"] → audioInput
 * modalities.input ["video"] → videoInput
 * tool_call → functionCalling
 */
export function mapRemoteModelToCapabilities(
  model: {
    tool_call?: boolean;
    reasoning?: boolean;
    structured_output?: boolean;
    attachment?: boolean;
    limit?: { context?: number; input?: number; output?: number };
    modalities?: { input?: string[]; output?: string[] };
    status?: string;
  },
): ModelCapabilities {
  const inputs = model.modalities?.input ?? [];
  const has = (m: string) => inputs.includes(m);

  return {
    textInput: has('text') || has('pdf') || true, // text is assumed if any modality exists
    imageInput: has('image'),
    audioInput: has('audio'),
    videoInput: has('video'),
    videoFileUpload: false, // models.dev doesn't distinguish file upload vs URL
    directVideoUrl: has('video'),
    youtubeUrl: false, // models.dev doesn't track YouTube specifically
    nativeWebSearch: false, // models.dev doesn't track web search; must be manually confirmed
    functionCalling: model.tool_call ?? false,
    structuredOutput: model.structured_output ?? false,
    streaming: true, // Most modern models support streaming
    contextWindow: model.limit?.context,
  };
}

/**
 * Convert a remote models.dev catalog entry into our ModelDefinition[].
 * Iterates all providers and their models.
 */
export function convertRemoteCatalog(catalog: RemoteCatalog): ModelDefinition[] {
  const out: ModelDefinition[] = [];
  for (const [providerId, provider] of Object.entries(catalog)) {
    if (!provider.models) continue;
    for (const [modelId, model] of Object.entries(provider.models)) {
      if (model.status === 'deprecated') continue;
      const caps = mapRemoteModelToCapabilities(model);
      const roles = {
        tutor: caps.textInput,
        vision: caps.imageInput,
        video: caps.videoInput,
        search: caps.nativeWebSearch,
      };
      out.push({
        provider: providerId,
        id: modelId,
        displayName: model.name ?? modelId,
        capabilities: caps,
        roles,
        lastVerified: undefined,
      });
    }
  }
  return out;
}

/**
 * Convert a raw (unvalidated) catalog object. Used by tests and by
 * the remote fetch path after Zod validation.
 */
export function convertRawCatalog(raw: Record<string, unknown>): ModelDefinition[] {
  const parsed = RemoteCatalogSchema.safeParse(raw);
  if (!parsed.success) return [];
  return convertRemoteCatalog(parsed.data);
}

/**
 * Load local overrides from model-overrides.json.
 * These take priority over both remote and built-in registry.
 */
const localOverrides: ModelDefinition[] = ModelRegistrySchema.parse(rawOverrides);

export function getLocalOverrides(): ModelDefinition[] {
  return localOverrides;
}

/**
 * Look up a model in the local overrides by provider + id.
 */
export function getLocalOverride(
  provider: string,
  id: string,
): ModelDefinition | undefined {
  return localOverrides.find((m) => m.provider === provider && m.id === id);
}

interface CachedRegistry {
  models: ModelDefinition[];
  fetchedAt: number;
}

/**
 * Fetch the remote models.dev catalog, validate it, and convert to our format.
 * Returns null on any failure — callers must handle the fallback.
 */
async function fetchRemoteCatalog(): Promise<ModelDefinition[] | null> {
  try {
    const response = await fetch(REMOTE_URL, {
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    const raw = await response.json();
    const parsed = RemoteCatalogSchema.safeParse(raw);
    if (!parsed.success) return null;
    return convertRemoteCatalog(parsed.data);
  } catch {
    return null;
  }
}

/**
 * Load the effective model registry with caching:
 *   1. Try local cache (if not expired)
 *   2. If expired, try remote fetch + update cache
 *   3. If fetch fails, use stale cache if available
 *   4. If no cache at all, fall back to local overrides only
 *
 * Local overrides always take priority over remote data.
 */
export async function loadEffectiveRegistry(): Promise<{
  models: ModelDefinition[];
  source: 'cache' | 'remote' | 'fallback';
}> {
  // 1. Try local cache
  let cached: CachedRegistry | null = null;
  try {
    const raw = await browser.storage.local.get(CACHE_KEY);
    cached = raw[CACHE_KEY] as CachedRegistry | undefined ?? null;
  } catch {
    // storage not available (e.g. in tests)
  }

  const now = Date.now();
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return { models: mergeRegistries(cached.models, localOverrides), source: 'cache' };
  }

  // 2. Try remote fetch
  const remote = await fetchRemoteCatalog();
  if (remote && remote.length > 0) {
    const newCache: CachedRegistry = { models: remote, fetchedAt: now };
    try {
      await browser.storage.local.set({ [CACHE_KEY]: newCache });
    } catch {
      // storage not available — in-memory only
    }
    return { models: mergeRegistries(remote, localOverrides), source: 'remote' };
  }

  // 3. Fall back to stale cache if available
  if (cached) {
    return { models: mergeRegistries(cached.models, localOverrides), source: 'cache' };
  }

  // 4. No cache at all — use local overrides + built-in registry
  return { models: localOverrides, source: 'fallback' };
}

/**
 * Merge two registries. Entries in `overrides` take priority over `base`
 * for the same (provider, id) pair.
 */
function mergeRegistries(
  base: ModelDefinition[],
  overrides: ModelDefinition[],
): ModelDefinition[] {
  const overrideKeys = new Set(overrides.map((m) => `${m.provider}:${m.id}`));
  const filtered = base.filter((m) => !overrideKeys.has(`${m.provider}:${m.id}`));
  return [...filtered, ...overrides];
}

/**
 * Synchronous lookup using local overrides only.
 * Used by the capability resolver when we can't await a remote fetch.
 */
export function findModelInOverrides(
  provider: string,
  id: string,
): ModelDefinition | undefined {
  return getLocalOverride(provider, id);
}

/**
 * Look up a model in a given list (e.g. from the effective registry).
 */
export function findModelInList(
  models: ModelDefinition[],
  provider: string,
  id: string,
): ModelDefinition | undefined {
  return models.find((m) => m.provider === provider && m.id === id);
}

export type { ModelDefinition };
