import { describe, it, expect } from 'vitest';
import { candidateTimes, parseSparseResult, extractJson } from './sparse-analysis';

describe('candidateTimes', () => {
  it('yields 0,10,20,... for a 60s video', () => {
    expect(candidateTimes(60)).toEqual([0, 10, 20, 30, 40, 50]);
  });
  it('returns empty for zero/NaN duration', () => {
    expect(candidateTimes(0)).toEqual([]);
    expect(candidateTimes(Number.NaN)).toEqual([]);
  });
});

describe('extractJson', () => {
  it('parses a plain JSON object', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });
  it('extracts JSON from a code fence', () => {
    expect(extractJson('here:\n```json\n{"a":2}\n```\ndone')).toEqual({ a: 2 });
  });
  it('returns null for non-JSON', () => {
    expect(extractJson('no json here')).toBeNull();
  });
});

describe('parseSparseResult', () => {
  it('maps sparse JSON keys to SparseFrameResult', () => {
    const out = parseSparseResult(
      JSON.stringify({
        visual_summary: 'a diagram',
        visible_text: ['EUV', 'NA'],
        technical_terms: ['光刻'],
        diagram_type: '结构图',
        important_objects: ['lens'],
        importance: 0.8,
      }),
    );
    expect(out).toEqual({
      visualSummary: 'a diagram',
      ocr: ['EUV', 'NA'],
      technicalTerms: ['光刻'],
      diagramType: '结构图',
      importantObjects: ['lens'],
      importance: 0.8,
    });
  });
  it('returns null for non-JSON text', () => {
    expect(parseSparseResult('not json')).toBeNull();
  });
});
