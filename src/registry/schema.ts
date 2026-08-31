/**
 * Zod schemas for the model registry (src/data/model-registry.json).
 */

import { z } from 'zod';

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

export const ModelDefinitionSchema = z.object({
  provider: z.string(),
  id: z.string(),
  displayName: z.string(),
  capabilities: ModelCapabilitiesSchema,
  roles: z.object({
    tutor: z.boolean(),
    vision: z.boolean(),
    video: z.boolean(),
    search: z.boolean(),
  }),
  lastVerified: z.string().optional(),
});

export const ModelRegistrySchema = z.array(ModelDefinitionSchema);

export type ModelCapabilitiesSchema = z.infer<typeof ModelCapabilitiesSchema>;
export type ModelDefinitionSchema = z.infer<typeof ModelDefinitionSchema>;
