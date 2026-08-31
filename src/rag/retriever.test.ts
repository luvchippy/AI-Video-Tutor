import { describe, it, expect } from 'vitest';
import { retrieve, tokenize } from './retriever';
import type { KnowledgeChunk } from '../types/knowledge';

function chunk(
  id: string,
  startTime: number,
  endTime: number,
  transcript: string,
  summary?: string,
): KnowledgeChunk {
  return { id, videoId: 'v1', startTime, endTime, transcript, summary };
}

function makeChunks(): KnowledgeChunk[] {
  return [
    chunk('c0', 0, 30, 'introduction to lithography basics', 'What is lithography'),
    chunk('c1', 30, 60, 'explaining wavelength limits of light', 'Wavelength limits'),
    chunk('c2', 60, 90, 'EUV lithography overview', 'EUV lithography'),
    chunk('c3', 90, 120, 'numerical aperture NA explanation', 'Numerical aperture'),
  ];
}

describe('retrieve', () => {
  it('ranks the chunk nearest currentTime first', () => {
    const chunks = makeChunks();
    // query with no distinctive keyword -> time proximity dominates
    const result = retrieve(chunks, 'explain this', 95, { topK: 1 });
    expect(result.topChunks[0]?.id).toBe('c3');
  });

  it('can surface a far chunk via keyword match', () => {
    const chunks = makeChunks();
    const result = retrieve(chunks, 'what is EUV', 0, { topK: 3 });
    const ids = result.topChunks.map((c) => c.id);
    // EUV chunk (far from time 0) should appear in top 3
    expect(ids).toContain('c2');
  });

  it('never returns the full transcript (only topK chunks)', () => {
    const chunks = makeChunks();
    const result = retrieve(chunks, 'tell me everything', 50, { topK: 2 });
    expect(result.topChunks.length).toBe(2);
    expect(result.topChunks.length).toBeLessThan(chunks.length);
  });

  it('builds overall + chapter summaries', () => {
    const chunks = makeChunks();
    const result = retrieve(chunks, 'x', 75, {});
    expect(result.overallSummary).toContain('lithography');
    expect(result.chapterSummary).toBe('EUV lithography');
  });

  it('handles empty chunk list', () => {
    const result = retrieve([], 'x', 10, {});
    expect(result.topChunks).toEqual([]);
    expect(result.overallSummary).toBe('');
    expect(result.chapterSummary).toBe('');
  });
});

describe('tokenize', () => {
  it('splits latin words and lowercases', () => {
    expect(tokenize('EUV Lithography')).toEqual(['euv', 'lithography']);
  });
  it('produces CJK bigrams', () => {
    expect(tokenize('光刻机')).toEqual(['光刻', '刻机']);
  });
});
