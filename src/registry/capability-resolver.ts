import type { ModelCapabilities, ProviderProtocol } from '../types/model';
import { capabilitiesOf } from '../registry/model-registry';
import { findModelInOverrides } from '../registry/remote-model-registry';
import { GEMINI_CAPABILITIES } from '../providers/ai/gemini';
import { DEEPSEEK_CAPABILITIES } from '../providers/ai/deepseek';
import { QWEN_CAPABILITIES } from '../providers/ai/qwen';
import { DOTS_CAPABILITIES } from '../providers/ai/dots';
import { OPENAI_DEFAULT_CAPABILITIES, TEXT_ONLY_CAPABILITIES } from '../providers/ai/openai-compatible';
import { MOCK_CAPABILITIES } from '../providers/ai/mock';

export type CapabilitySource = 'registry' | 'remote-registry' | 'local-override' | 'protocol-default' | 'manual' | 'mixed' | 'detected';

export interface ResolvedCapabilities {
  capabilities: ModelCapabilities;
  source: CapabilitySource;
}

/**
 * Default capabilities per protocol. Used when the model is not in the
 * registry and no manual override is provided.
 */
const PROTOCOL_DEFAULTS: Record<ProviderProtocol, ModelCapabilities> = {
  gemini: GEMINI_CAPABILITIES,
  'openai-compatible': OPENAI_DEFAULT_CAPABILITIES,
  deepseek: DEEPSEEK_CAPABILITIES,
  qwen: QWEN_CAPABILITIES,
  'dots-openai': DOTS_CAPABILITIES,
  mock: MOCK_CAPABILITIES,
};

/**
 * Capabilities no protocol can deliver through this plugin today. Nothing in
 * the pipeline ever builds a video or audio content part — `TutorEngine` sends
 * text plus at most one image (see services/tutor-engine.ts `answer()`), so
 * even a provider that does implement native video_url serialization (dots)
 * never receives one. Drop entries here in the same change that starts sending
 * those parts; until then the UI must not advertise them.
 */
const UNWIRED_CAPABILITIES: Partial<ModelCapabilities> = {
  audioInput: false,
  videoInput: false,
  videoFileUpload: false,
  directVideoUrl: false,
  youtubeUrl: false,
};

/**
 * Protocol capability limits — what the protocol can actually support,
 * regardless of what the model claims. Effective capability = model cap AND
 * plugin cap (UNWIRED_CAPABILITIES) AND protocol cap.
 */
const PROTOCOL_CAPABILITY_LIMITS: Partial<Record<ProviderProtocol, Partial<ModelCapabilities>>> = {
  'openai-compatible': {
    // Standard OpenAI chat/completions endpoint cannot transmit audio/video
    // or do native web search. Image input IS supported via image_url parts.
    audioInput: false,
    videoInput: false,
    videoFileUpload: false,
    directVideoUrl: false,
    youtubeUrl: false,
    nativeWebSearch: false,
  },
  deepseek: {
    // DeepSeek API is text-only at the protocol level
    audioInput: false,
    videoInput: false,
    videoFileUpload: false,
    directVideoUrl: false,
    youtubeUrl: false,
    nativeWebSearch: false,
  },
  qwen: {
    // DashScope's OpenAI-compatible mode exposes no grounding tool; native web
    // search needs the DashScope-native request shape, which is not wired.
    nativeWebSearch: false,
  },
};

/**
 * Apply plugin and protocol capability limits. Even if a model claims
 * audioInput, the effective capability is false unless the pipeline can
 * actually send that content. This prevents the UI from showing "available"
 * for a capability nothing implements.
 */
function applyProtocolLimits(
  caps: ModelCapabilities,
  protocol: ProviderProtocol,
): ModelCapabilities {
  const limits = { ...UNWIRED_CAPABILITIES, ...PROTOCOL_CAPABILITY_LIMITS[protocol] };
  return {
    ...caps,
    ...Object.fromEntries(
      Object.entries(limits).map(([key, value]) => [
        key,
        value === false ? false : caps[key as keyof ModelCapabilities],
      ]),
    ),
  };
}

/**
 * Resolve capabilities for a model by priority:
 *   1. Local overrides (model-overrides.json) — highest, user/maintainer curated
 *   2. Built-in registry (model-registry.json) — shipped with plugin
 *   3. Protocol defaults (unknown models)
 *   4. Manual override (user-declared at runtime)
 *
 * Resolution is fully synchronous and offline — the remote catalog
 * (models.dev) is never fetched. See ROADMAP.md.
 *
 * The result is then filtered by plugin and protocol capability limits to
 * ensure we never show a capability the pipeline can't actually deliver.
 */
export function resolveCapabilities(
  protocol: ProviderProtocol,
  modelId: string,
  manualOverride?: ModelCapabilities,
): ResolvedCapabilities {
  const providerStr = protocolToProvider(protocol);

  // 1. Try local overrides first (highest priority for known curated models)
  const overrideCaps = findModelInOverrides(providerStr, modelId)?.capabilities;

  // 2. Try built-in registry
  const registryCaps = capabilitiesOf(providerStr, modelId);

  // Use the first found: local override > built-in registry
  const knownCaps = overrideCaps ?? registryCaps;
  const knownSource = overrideCaps ? 'local-override' : registryCaps ? 'registry' : null;

  if (knownCaps && !manualOverride) {
    return {
      capabilities: applyProtocolLimits(knownCaps, protocol),
      source: knownSource!,
    };
  }

  // 3. Manual override takes precedence over protocol default
  if (manualOverride) {
    if (knownCaps) {
      // Merge: manual override on top of known, then apply protocol limits
      const merged = { ...knownCaps, ...manualOverride };
      return {
        capabilities: applyProtocolLimits(merged, protocol),
        source: 'mixed',
      };
    }
    return {
      capabilities: applyProtocolLimits(manualOverride, protocol),
      source: 'manual',
    };
  }

  // 4. Fall back to protocol defaults
  const defaults = PROTOCOL_DEFAULTS[protocol] ?? TEXT_ONLY_CAPABILITIES;
  return {
    capabilities: applyProtocolLimits(defaults, protocol),
    source: 'protocol-default',
  };
}

/** Map protocol to provider string used in the registry. */
function protocolToProvider(protocol: ProviderProtocol): string {
  switch (protocol) {
    case 'gemini':
      return 'gemini';
    case 'deepseek':
      return 'deepseek';
    case 'qwen':
      return 'qwen';
    case 'dots-openai':
      return 'dots';
    case 'mock':
      return 'mock';
    case 'openai-compatible':
      return 'openai';
  }
}

/**
 * Determine which roles a model can serve based on its capabilities.
 * Used to filter the role assignment dropdowns.
 */
export function eligibleRoles(caps: ModelCapabilities): {
  tutor: boolean;
  vision: boolean;
  video: boolean;
  audio: boolean;
  search: boolean;
} {
  return {
    tutor: caps.textInput,
    vision: caps.imageInput,
    video: caps.videoInput,
    audio: caps.audioInput,
    search: caps.nativeWebSearch,
  };
}

/**
 * Capabilities a cheap probe request can actually determine — see
 * providers/ai/capability-probe.ts. Everything else falls back to the registry
 * or protocol defaults, because probing it would need a full billable request
 * (web search) or could not be sent at all today (audio/video: nothing in the
 * pipeline builds those content parts).
 *
 * functionCalling is absent on purpose: ChatRequest has no `tools` field, so
 * there is no request shape that could probe it.
 */
export const DETECTABLE_CAPS = {
  textInput: true,
  imageInput: true,
} as const;

/**
 * Status indicators for capability display.
 */
export type CapabilityStatus =
  | 'verified' // ✓ 已验证 (tested or registry-confirmed)
  | 'registry' // ◐ Registry 已知
  | 'untested' // ? 未测试
  | 'unsupported'; // × 不支持

export function capabilityDisplayStatus(
  capValue: boolean,
  source: CapabilitySource,
  wasTested: boolean,
): CapabilityStatus {
  if (!capValue) return 'unsupported';
  if (wasTested) return 'verified';
  if (source === 'registry') return 'registry';
  return 'untested';
}
