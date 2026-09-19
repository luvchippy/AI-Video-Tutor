import { describe, it, expect } from 'vitest';
import {
  boundaryFor,
  nextSampleTime,
  atSampleLimit,
  MAX_SAMPLED_FRAMES,
} from './sampling';

describe('boundaryFor', () => {
  it('snaps a position down to its 10s boundary', () => {
    expect(boundaryFor(0)).toBe(0);
    expect(boundaryFor(9.99)).toBe(0);
    expect(boundaryFor(10)).toBe(10);
    expect(boundaryFor(37.5)).toBe(30);
  });

  it('rejects an unknown, negative or non-finite position', () => {
    expect(boundaryFor(null)).toBeNull();
    expect(boundaryFor(-1)).toBeNull();
    expect(boundaryFor(Number.NaN)).toBeNull();
    expect(boundaryFor(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('honours a custom interval and rejects a nonsense one', () => {
    expect(boundaryFor(37, 5)).toBe(35);
    expect(boundaryFor(37, 0)).toBeNull();
    expect(boundaryFor(37, -10)).toBeNull();
  });
});

describe('nextSampleTime', () => {
  const none: ReadonlySet<number> = new Set();

  it('returns the boundary the position falls into', () => {
    expect(nextSampleTime(23.4, 600, none)).toBe(20);
  });

  it('returns the same boundary for every tick inside one bucket', () => {
    // This is the property that turns sixty 1s ticks into one capture.
    expect(nextSampleTime(20.0, 600, none)).toBe(20);
    expect(nextSampleTime(25.0, 600, none)).toBe(20);
    expect(nextSampleTime(29.9, 600, none)).toBe(20);
  });

  it('skips a boundary that is already captured', () => {
    expect(nextSampleTime(23.4, 600, new Set([20]))).toBeNull();
  });

  it('still samples a new boundary after a seek forward', () => {
    const captured = new Set([0, 10, 20]);
    expect(nextSampleTime(305, 600, captured)).toBe(300);
  });

  it('does not re-sample a boundary after seeking backwards', () => {
    const captured = new Set([0, 10, 20, 30]);
    expect(nextSampleTime(12, 600, captured)).toBeNull();
  });

  it('refuses a boundary at or past the end of the video', () => {
    expect(nextSampleTime(599, 600, none)).toBe(590);
    // Candidate times stop before duration, so this one must not be sampled.
    expect(nextSampleTime(600, 600, none)).toBeNull();
    expect(nextSampleTime(650, 600, none)).toBeNull();
  });

  it('samples when the duration is unknown', () => {
    expect(nextSampleTime(23.4, null, none)).toBe(20);
  });

  it('does nothing without a playback position', () => {
    expect(nextSampleTime(null, 600, none)).toBeNull();
  });

  it('treats a zero or invalid duration as unknown rather than as the end', () => {
    expect(nextSampleTime(23.4, 0, none)).toBe(20);
    expect(nextSampleTime(23.4, Number.NaN, none)).toBe(20);
    expect(nextSampleTime(23.4, -5, none)).toBe(20);
  });
});

describe('atSampleLimit', () => {
  it('reports false below the bound and true at it', () => {
    const under = new Set(Array.from({ length: 5 }, (_, i) => i * 10));
    expect(atSampleLimit(under)).toBe(false);

    const atLimit = new Set(
      Array.from({ length: MAX_SAMPLED_FRAMES }, (_, i) => i * 10),
    );
    expect(atSampleLimit(atLimit)).toBe(true);
    expect(atSampleLimit(atLimit, 3)).toBe(true);
  });
});