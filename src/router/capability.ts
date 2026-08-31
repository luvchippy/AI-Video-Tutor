import type { ModelCapabilities } from '../types/model';

/**
 * Capability Router — the single source of truth for "can the current
 * configuration do X?". Business code must gate on `capabilities`, never on
 * model name strings like `model.includes("gemini")`.
 */

export function canText(c: ModelCapabilities): boolean {
  return c.textInput;
}
export function canVisualQuestion(c: ModelCapabilities): boolean {
  return c.imageInput;
}
export function canAnalyzeVideo(c: ModelCapabilities): boolean {
  return c.videoInput;
}
export function canVideoFileUpload(c: ModelCapabilities): boolean {
  return c.videoFileUpload;
}
export function canDirectVideoUrl(c: ModelCapabilities): boolean {
  return c.directVideoUrl;
}
export function canFactCheck(c: ModelCapabilities): boolean {
  return c.nativeWebSearch;
}
export function canCurrentInfo(c: ModelCapabilities): boolean {
  return c.nativeWebSearch;
}
export function canStructuredOutput(c: ModelCapabilities): boolean {
  return c.structuredOutput;
}
export function canStreaming(c: ModelCapabilities): boolean {
  return c.streaming;
}

export interface RoleCapabilities {
  tutor: boolean;
  vision: boolean;
  video: boolean;
  audio: boolean;
  search: boolean;
}

export function roleCapabilities(c: ModelCapabilities): RoleCapabilities {
  return {
    tutor: c.textInput,
    vision: c.imageInput,
    video: c.videoInput,
    audio: c.audioInput,
    search: c.nativeWebSearch,
  };
}

export const EMPTY_CAPABILITIES: ModelCapabilities = {
  textInput: false,
  imageInput: false,
  audioInput: false,
  videoInput: false,
  videoFileUpload: false,
  directVideoUrl: false,
  youtubeUrl: false,
  nativeWebSearch: false,
  functionCalling: false,
  structuredOutput: false,
  streaming: false,
};

/**
 * Merge capabilities across multiple configured models (tutor + vision + video
 * + search). The effective capability of the whole config is the union.
 */
export function mergeCapabilities(
  ...list: Array<ModelCapabilities | null | undefined>
): ModelCapabilities {
  const out: ModelCapabilities = { ...EMPTY_CAPABILITIES };
  for (const c of list) {
    if (!c) continue;
    out.textInput ||= c.textInput;
    out.imageInput ||= c.imageInput;
    out.audioInput ||= c.audioInput;
    out.videoInput ||= c.videoInput;
    out.videoFileUpload ||= c.videoFileUpload;
    out.directVideoUrl ||= c.directVideoUrl;
    out.youtubeUrl ||= c.youtubeUrl;
    out.nativeWebSearch ||= c.nativeWebSearch;
    out.functionCalling ||= c.functionCalling;
    out.structuredOutput ||= c.structuredOutput;
    out.streaming ||= c.streaming;
    if (c.contextWindow && (out.contextWindow ?? 0) < c.contextWindow) {
      out.contextWindow = c.contextWindow;
    }
  }
  return out;
}

export type FeatureId = 'vision' | 'video' | 'audio' | 'search' | 'video-file';

const REASONS: Record<FeatureId, string> = {
  vision: '当前模型不支持图片输入，无法分析画面。',
  video: '当前模型不支持视频输入，无法分析完整视频。',
  audio: '当前模型不支持音频输入，无法分析音频。',
  search: '当前配置没有联网搜索能力。',
  'video-file': '当前模型不支持上传视频文件。',
};

/** Returns null when enabled, otherwise a human-readable disabled reason. */
export function disabledReason(
  feature: FeatureId,
  c: ModelCapabilities,
): string | null {
  switch (feature) {
    case 'vision':
      return canVisualQuestion(c) ? null : REASONS.vision;
    case 'video':
      return canAnalyzeVideo(c) ? null : REASONS.video;
    case 'audio':
      return c.audioInput ? null : REASONS.audio;
    case 'search':
      return canFactCheck(c) ? null : REASONS.search;
    case 'video-file':
      return canVideoFileUpload(c) ? null : REASONS['video-file'];
  }
}
