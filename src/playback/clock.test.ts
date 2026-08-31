import { describe, it, expect } from 'vitest';
import { derivePlaybackState, deriveConfidence } from './clock';

describe('derivePlaybackState', () => {
  it('reports playing when not paused and time is known', () => {
    expect(
      derivePlaybackState({
        paused: false,
        ended: false,
        seeking: false,
        currentTime: 12,
        duration: 60,
      }),
    ).toBe('playing');
  });

  it('reports paused', () => {
    expect(
      derivePlaybackState({
        paused: true,
        ended: false,
        seeking: false,
        currentTime: 12,
        duration: 60,
      }),
    ).toBe('paused');
  });

  it('reports seeking over paused', () => {
    expect(
      derivePlaybackState({
        paused: true,
        ended: false,
        seeking: true,
        currentTime: 12,
        duration: 60,
      }),
    ).toBe('seeking');
  });

  it('reports ended', () => {
    expect(
      derivePlaybackState({
        paused: true,
        ended: true,
        seeking: false,
        currentTime: 60,
        duration: 60,
      }),
    ).toBe('ended');
  });

  it('reports unknown when currentTime is null', () => {
    expect(
      derivePlaybackState({
        paused: true,
        ended: false,
        seeking: false,
        currentTime: null,
        duration: null,
      }),
    ).toBe('unknown');
  });
});

describe('deriveConfidence', () => {
  it('is exact for a finite positive duration', () => {
    expect(deriveConfidence(120)).toBe('exact');
  });
  it('is estimated for a finite but zero/negative duration', () => {
    expect(deriveConfidence(0)).toBe('estimated');
  });
  it('is unknown for null/undefined/NaN', () => {
    expect(deriveConfidence(null)).toBe('unknown');
    expect(deriveConfidence(undefined)).toBe('unknown');
    expect(deriveConfidence(Number.NaN)).toBe('unknown');
  });
});
