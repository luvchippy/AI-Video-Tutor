import { describe, it, expect } from 'vitest';
import { resolveCapabilities, eligibleRoles } from './capability-resolver';
import type { ModelCapabilities } from '../types/model';

const TEXT_ONLY: ModelCapabilities = {
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

const FULL: ModelCapabilities = {
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

describe('resolveCapabilities', () => {
  it('uses registry for known deepseek model', () => {
    const result = resolveCapabilities('deepseek', 'deepseek-v4-flash');
    expect(result.source).toBe('registry');
    expect(result.capabilities.textInput).toBe(true);
    expect(result.capabilities.imageInput).toBe(false);
  });

  it('uses registry for known gemini model', () => {
    const result = resolveCapabilities('gemini', 'gemini-2.5-flash');
    expect(result.source).toBe('registry');
    expect(result.capabilities.imageInput).toBe(true);
    expect(result.capabilities.nativeWebSearch).toBe(true);
  });

  it('falls back to protocol default for unknown model', () => {
    const result = resolveCapabilities('deepseek', 'some-unknown-model');
    expect(result.source).toBe('protocol-default');
    expect(result.capabilities.textInput).toBe(true);
  });

  it('uses manual override when provided', () => {
    const result = resolveCapabilities('openai-compatible', 'unknown', FULL);
    expect(result.source).toBe('manual');
    expect(result.capabilities.textInput).toBe(true);
  });

  it('merges manual override with registry when both exist', () => {
    const manual: ModelCapabilities = { ...TEXT_ONLY, imageInput: true };
    const result = resolveCapabilities('deepseek', 'deepseek-v4-flash', manual);
    expect(result.source).toBe('mixed');
    expect(result.capabilities.imageInput).toBe(true);
  });

  it('applies protocol limits: openai-compatible cannot have audio/video', () => {
    const manual: ModelCapabilities = {
      ...FULL,
      audioInput: true,
      videoInput: true,
      videoFileUpload: true,
    };
    const result = resolveCapabilities('openai-compatible', 'unknown', manual);
    // Even though manual says true, protocol limits force false
    expect(result.capabilities.audioInput).toBe(false);
    expect(result.capabilities.videoInput).toBe(false);
    expect(result.capabilities.videoFileUpload).toBe(false);
    expect(result.capabilities.nativeWebSearch).toBe(false);
  });

  it('gemini protocol preserves audio/video/web-search capabilities', () => {
    const result = resolveCapabilities('gemini', 'gemini-2.5-flash');
    expect(result.capabilities.audioInput).toBe(true);
    expect(result.capabilities.videoInput).toBe(true);
    expect(result.capabilities.nativeWebSearch).toBe(true);
  });

  it('dots-openai protocol resolves dots3-note-prev from local overrides', () => {
    const result = resolveCapabilities('dots-openai', 'dots3-note-prev');
    expect(result.source).toBe('local-override');
    expect(result.capabilities.textInput).toBe(true);
    expect(result.capabilities.imageInput).toBe(true);
    expect(result.capabilities.videoInput).toBe(true);
    expect(result.capabilities.audioInput).toBe(true);
    expect(result.capabilities.functionCalling).toBe(true);
    expect(result.capabilities.nativeWebSearch).toBe(false);
    expect(result.capabilities.contextWindow).toBe(524288);
  });

  it('dots-openai falls back to protocol defaults for unknown model', () => {
    const result = resolveCapabilities('dots-openai', 'unknown-model');
    expect(result.source).toBe('protocol-default');
    expect(result.capabilities.textInput).toBe(true);
  });

  it('openai-compatible protocol does NOT restrict dots model capabilities', () => {
    // This verifies that openai-compatible and dots-openai are separate protocols
    // and don't interfere with each other
    const dotsResult = resolveCapabilities('dots-openai', 'dots3-note-prev');
    const openaiResult = resolveCapabilities('openai-compatible', 'dots3-note-prev');
    // dots-openai should have full capabilities; openai-compatible should limit them
    expect(dotsResult.capabilities.audioInput).toBe(true);
    expect(dotsResult.capabilities.videoInput).toBe(true);
    // openai-compatible limits audio/video to false (protocol can't transmit them)
    expect(openaiResult.capabilities.audioInput).toBe(false);
    expect(openaiResult.capabilities.videoInput).toBe(false);
  });

  it('mock protocol works', () => {
    const result = resolveCapabilities('mock', 'mock-tutor');
    expect(result.source).toBe('registry');
    expect(result.capabilities.textInput).toBe(true);
  });
});

describe('eligibleRoles', () => {
  it('text-only model has only tutor role', () => {
    const roles = eligibleRoles(TEXT_ONLY);
    expect(roles.tutor).toBe(true);
    expect(roles.vision).toBe(false);
    expect(roles.video).toBe(false);
    expect(roles.audio).toBe(false);
    expect(roles.search).toBe(false);
  });

  it('full model has all roles', () => {
    const roles = eligibleRoles(FULL);
    expect(roles.tutor).toBe(true);
    expect(roles.vision).toBe(true);
    expect(roles.video).toBe(true);
    expect(roles.audio).toBe(true);
    expect(roles.search).toBe(true);
  });
});
