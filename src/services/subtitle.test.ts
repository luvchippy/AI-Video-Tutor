import { describe, it, expect } from 'vitest';
import { cueToSegment, NO_SUBTITLES_MESSAGE } from './subtitle';

describe('cueToSegment', () => {
  it('maps a valid cue', () => {
    expect(cueToSegment({ startTime: 1, endTime: 2.5, text: ' hello ' })).toEqual({
      start: 1,
      end: 2.5,
      text: 'hello',
      source: 'html-track',
    });
  });

  it('returns null for empty text', () => {
    expect(cueToSegment({ startTime: 1, endTime: 2, text: '   ' })).toBeNull();
  });

  it('returns null for invalid times', () => {
    expect(cueToSegment({ startTime: 2, endTime: 1, text: 'x' })).toBeNull();
    expect(cueToSegment({ startTime: Number.NaN, endTime: 2, text: 'x' })).toBeNull();
  });
});

describe('NO_SUBTITLES_MESSAGE', () => {
  it('is the honest empty state', () => {
    expect(NO_SUBTITLES_MESSAGE).toContain('字幕');
  });
});
