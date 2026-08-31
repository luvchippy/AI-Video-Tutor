/**
 * Zod schemas for persisted user settings.
 */

import { z } from 'zod';

export const LearnerLevelSchema = z.enum([
  'quick',
  'beginner',
  'college',
  'professional',
]);

export const ModelCapabilitiesSchema = z.object({
  textInput: z.boolean(),
  imageInput: z.boolean(),
  audioInput: z.boolean(),
  videoInput: z.boolean(),
  videoFileUpload: z.boolean(),
  directVideoUrl: z.boolean(),
  youtubeUrl: z.boolean(),
  nativeWebSearch: z.boolean(),
  functionCalling: z.boolean(),
  structuredOutput: z.boolean(),
  streaming: z.boolean(),
  contextWindow: z.number().optional(),
});

export const ProviderProtocolSchema = z.enum([
  'gemini',
  'openai-compatible',
  'deepseek',
  'qwen',
  'dots-openai',
  'mock',
]);

export const SavedModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  protocol: ProviderProtocolSchema,
  baseUrl: z.string().optional(),
  modelId: z.string(),
  capabilities: ModelCapabilitiesSchema,
  connectionStatus: z.enum(['connected', 'failed', 'untested']),
  capabilitySource: z.enum(['registry', 'remote-registry', 'local-override', 'protocol-default', 'manual', 'mixed']),
});

export const ModelAssignmentSchema = z.object({
  modelId: z.string(),
});

export const ModelConfigSchema = z.object({
  tutor: ModelAssignmentSchema,
  vision: ModelAssignmentSchema.nullable(),
  video: ModelAssignmentSchema.nullable(),
  audio: ModelAssignmentSchema.nullable(),
  search: ModelAssignmentSchema.nullable(),
});

export const SettingsSchema = z.object({
  learnerLevel: LearnerLevelSchema,
  learnerBackground: z.string(),
  savedModels: z.array(SavedModelSchema),
  modelConfig: ModelConfigSchema,
  activePreset: z.string().nullable(),
});

export type SettingsSchema = z.infer<typeof SettingsSchema>;
export type SavedModelSchema = z.infer<typeof SavedModelSchema>;
export type ModelConfigSchema = z.infer<typeof ModelConfigSchema>;
