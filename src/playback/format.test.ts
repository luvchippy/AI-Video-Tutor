import { describe, it, expect } from 'vitest';
import { formatTime, formatClock } from './format';

describe('formatTime', () => {
  it('formats zero', () => {
    expect(formatTime(0)).toBe('00:00');
  });
  it('formats 155 seconds as 02:35', () => {
    expect(formatTime(155)).toBe('02:35');
  });
  it('formats 3723 seconds as 1:02:03', () => {
    expect(formatTime(3723)).toBe('1:02:03');
  });
  it('clamps negatives to 00:00', () => {
    expect(formatTime(-5)).toBe('00:00');
  });
  it('clamps NaN to 00:00', () => {
    expect(formatTime(Number.NaN)).toBe('00:00');
  });
});

describe('formatClock', () => {
  it('formats current / duration', () => {
    expect(formatClock(523, 1452)).toBe('08:43 / 24:12');
  });
  it('handles nulls as zero', () => {
    expect(formatClock(null, null)).toBe('00:00 / 00:00');
  });
});
