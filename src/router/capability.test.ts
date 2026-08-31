import { describe, it, expect } from 'vitest';
import {
  roleCapabilities,
  mergeCapabilities,
  disabledReason,
  EMPTY_CAPABILITIES,
} from './capability';
import type { ModelCapabilities } from '../types/model';

const textOnly: ModelCapabilities = {
  textInput: true,
  imageInput: false,
  audioInput: false,
  videoInput: false,
  videoFileUpload: false,
  directVideoUrl: false,
  youtubeUrl: false,
  nativeWebSearch: false,
  functionCalling: true,
  structuredOutput: false,
  streaming: true,
};

const gemini: ModelCapabilities = {
  textInput: true,
  imageInput: true,
  audioInput: true,
  videoInput: true,
  videoFileUpload: true,
  directVideoUrl: true,
  youtubeUrl: true,
  nativeWebSearch: true,
  functionCalling: true,
  structuredOutput: true,
  streaming: true,
};

describe('roleCapabilities', () => {
  it('text-only model has only tutor role', () => {
    expect(roleCapabilities(textOnly)).toEqual({
      tutor: true,
      vision: false,
      video: false,
      audio: false,
      search: false,
    });
  });

  it('gemini has all roles', () => {
    expect(roleCapabilities(gemini)).toEqual({
      tutor: true,
      vision: true,
      video: true,
      audio: true,
      search: true,
    });
  });
});

describe('mergeCapabilities', () => {
  it('unions text-only tutor + vision model into vision-capable config', () => {
    const merged = mergeCapabilities(textOnly, gemini);
    expect(merged.textInput).toBe(true);
    expect(merged.imageInput).toBe(true);
    expect(merged.videoInput).toBe(true);
    expect(merged.nativeWebSearch).toBe(true);
  });

  it('returns all-false for empty input', () => {
    expect(mergeCapabilities()).toEqual(EMPTY_CAPABILITIES);
  });
});

describe('disabledReason', () => {
  it('returns null when enabled', () => {
    expect(disabledReason('vision', gemini)).toBeNull();
    expect(disabledReason('search', gemini)).toBeNull();
  });
  it('returns a reason when disabled', () => {
    expect(disabledReason('vision', textOnly)).toContain('不支持图片');
    expect(disabledReason('search', textOnly)).toContain('联网搜索');
  });
});
