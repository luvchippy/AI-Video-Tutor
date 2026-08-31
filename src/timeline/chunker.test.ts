import { describe, it, expect } from 'vitest';
import { chunkSubtitles, isSentenceEnd } from './chunker';
import type { SubtitleSegment } from '../types/playback';

function makeSegments(totalSeconds: number, step = 3): SubtitleSegment[] {
  const segs: SubtitleSegment[] = [];
  for (let t = 0; t < totalSeconds; t += step) {
    const end = t + step;
    const sentenceEvery = 10; // sentence boundary every 10 segments (30s)
    const isSentence = Math.round(t / step) % sentenceEvery === sentenceEvery - 1;
    const text = isSentence ? `Point ending at ${end}.` : `words at ${t}`;
    segs.push({ start: t, end, text, source: 'html-track' });
  }
  return segs;
}

describe('isSentenceEnd', () => {
  it('detects sentence-ending punctuation', () => {
    expect(isSentenceEnd('hello world.')).toBe(true);
    expect(isSentenceEnd('真的吗？')).toBe(true);
    expect(isSentenceEnd('no punctuation')).toBe(false);
  });
});

describe('chunkSubtitles', () => {
  it('produces one chunk for a short video', () => {
    const segs = [{ start: 0, end: 10, text: 'Hello.', source: 'html-track' as const }];
    const chunks = chunkSubtitles(segs, { videoId: 'v1' });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.startTime).toBe(0);
    expect(chunks[0]?.endTime).toBe(10);
  });

  it('splits a 3-minute video into ~30s chunks at sentence boundaries', () => {
    const chunks = chunkSubtitles(makeSegments(180), { videoId: 'v1' });
    expect(chunks.length).toBe(6);
    for (const c of chunks) {
      const dur = c.endTime - c.startTime;
      expect(dur).toBeGreaterThanOrEqual(30);
      expect(dur).toBeLessThanOrEqual(90);
      // sentences are not cut: every chunk ends with punctuation
      expect(c.transcript.trim().endsWith('.')).toBe(true);
    }
  });

  it('does not split mid-sentence when there is no punctuation', () => {
    const segs = makeSegments(60).map((s, i) =>
      i === 19 ? { ...s, text: 'final words.' } : { ...s, text: `words ${i}` },
    );
    const chunks = chunkSubtitles(segs, { videoId: 'v1' });
    // 60s with no intermediate sentence boundary -> a single chunk
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.endTime).toBe(60);
  });

  it('merges adjacent segments into a continuous transcript', () => {
    const segs: SubtitleSegment[] = [
      { start: 0, end: 2, text: 'Light', source: 'html-track' },
      { start: 2, end: 4, text: 'is', source: 'html-track' },
      { start: 4, end: 6, text: 'electromagnetic.', source: 'html-track' },
    ];
    const chunks = chunkSubtitles(segs, { videoId: 'v1' });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.transcript).toBe('Light is electromagnetic.');
  });
});
