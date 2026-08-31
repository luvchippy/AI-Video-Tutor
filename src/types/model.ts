/**
 * Model Registry + configuration types.
 */

export interface ModelCapabilities {
  textInput: boolean;
  imageInput: boolean;
  audioInput: boolean;
  videoInput: boolean;

  videoFileUpload: boolean;
  directVideoUrl: boolean;
  youtubeUrl: boolean;

  nativeWebSearch: boolean;
  functionCalling: boolean;
  structuredOutput: boolean;
  streaming: boolean;

  contextWindow?: number;
}

export type ModelRole = 'tutor' | 'vision' | 'video' | 'audio' | 'search';

/** Protocol determines how we talk to a provider and what defaults apply. */
export type ProviderProtocol =
  | 'gemini'
  | 'openai-compatible'
  | 'deepseek'
  | 'qwen'
  | 'dots-openai'
  | 'mock';

export interface ModelDefinition {
  provider: string;
  id: string;
  displayName: string;
  capabilities: ModelCapabilities;
  roles: {
    tutor: boolean;
    vision: boolean;
    video: boolean;
    search: boolean;
  };
  lastVerified?: string;
}

/** How detailed should explanations be? */
export type LearnerLevel = 'quick' | 'beginner' | 'college' | 'professional';

/**
 * A user-saved model. API Key is NOT stored here — it lives in extension
 * trusted storage keyed by `protocol::baseUrl`. The `id` is a stable UUID
 * used to reference this model in role assignments.
 */
export interface SavedModel {
  id: string;
  name: string;
  protocol: ProviderProtocol;
  baseUrl?: string;
  modelId: string;
  capabilities: ModelCapabilities;
  /** Whether the last connection test succeeded. */
  connectionStatus: 'connected' | 'failed' | 'untested';
  /** How capabilities were determined. */
  capabilitySource: 'registry' | 'remote-registry' | 'local-override' | 'protocol-default' | 'manual' | 'mixed';
}

/** A reference to a saved model by id, for role assignment. */
export interface ModelAssignment {
  modelId: string; // references SavedModel.id
}

/** The assembled active configuration: which model serves which role. */
export interface ModelConfig {
  tutor: ModelAssignment;
  vision: ModelAssignment | null;
  video: ModelAssignment | null;
  audio: ModelAssignment | null;
  search: ModelAssignment | null;
}

export interface Settings {
  learnerLevel: LearnerLevel;
  learnerBackground: string;
  savedModels: SavedModel[];
  modelConfig: ModelConfig;
  activePreset: string | null;
}

/** A recommended preset shown in Settings. */
export interface PresetConfig {
  id: string;
  name: string;
  description: string;
  suitableFor: string;
  tutor: { protocol: ProviderProtocol; modelId: string };
  vision: { protocol: ProviderProtocol; modelId: string } | null;
  video: { protocol: ProviderProtocol; modelId: string } | null;
  search: { protocol: ProviderProtocol; modelId: string } | null;
}

/**
 * Legacy ModelSlot — still used by buildSlotProvider internally.
 * Kept for backward compatibility with the provider assembly layer.
 */
export interface ModelSlot {
  provider: string;
  modelId: string;
  baseUrl?: string;
  displayName?: string;
  capabilities?: ModelCapabilities;
}
