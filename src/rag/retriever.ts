import type { KnowledgeChunk } from '../types/knowledge';

export interface RetrieveOptions {
  /** Weight of time proximity (default 0.7). */
  timeWeight?: number;
  /** Weight of keyword relevance (default 0.3). */
  keywordWeight?: number;
  /** +/- window (seconds) for "near current time" (default 60). */
  timeWindow?: number;
  /** Number of top chunks to return (default 5). */
  topK?: number;
}

export interface RetrievalResult {
  /** Concatenation of all chunk summaries (the "video-level" context). */
  overallSummary: string;
  /** Summary of the chunk nearest to currentTime. */
  chapterSummary: string;
  topChunks: KnowledgeChunk[];
}

/** Tokenize for keyword matching: latin words + CJK bigrams. */
export function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const runs = lower.match(/[a-z0-9]+|[\u4e00-\u9fff]+/g) ?? [];
  const tokens: string[] = [];
  for (const run of runs) {
    if (/^[a-z0-9]+$/.test(run)) {
      tokens.push(run);
    } else if (run.length === 1) {
      tokens.push(run);
    } else {
      for (let i = 0; i < run.length - 1; i++) tokens.push(run.slice(i, i + 2));
    }
  }
  return tokens;
}

function chunkCenter(chunk: KnowledgeChunk): number {
  return (chunk.startTime + chunk.endTime) / 2;
}

function timeProximityScore(
  chunk: KnowledgeChunk,
  currentTime: number | null,
  window: number,
): number {
  if (currentTime === null) return 0.5; // neutral when position unknown
  const dist = Math.abs(chunkCenter(chunk) - currentTime);
  // smooth decay: 1.0 at dist 0, ~0.37 at one window, ~0.14 at two windows.
  return Math.exp(-dist / window);
}

function chunkText(chunk: KnowledgeChunk): string {
  return [
    chunk.transcript,
    chunk.summary ?? '',
    (chunk.keywords ?? []).join(' '),
    (chunk.concepts ?? []).join(' '),
    (chunk.technicalTerms ?? []).join(' '),
  ].join(' ');
}

function keywordScore(chunk: KnowledgeChunk, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0.5; // neutral when no keywords
  const haystack = tokenize(chunkText(chunk));
  const hit = queryTokens.filter((t) => haystack.includes(t)).length;
  return hit / queryTokens.length;
}

/**
 * Minimal Video RAG: rank chunks by 70% time proximity + 30% keyword match.
 * Returns only the top chunks — never the full transcript.
 */
export function retrieve(
  chunks: KnowledgeChunk[],
  query: string,
  currentTime: number | null,
  opts: RetrieveOptions = {},
): RetrievalResult {
  const timeWeight = opts.timeWeight ?? 0.7;
  const keywordWeight = opts.keywordWeight ?? 0.3;
  const timeWindow = opts.timeWindow ?? 60;
  const topK = opts.topK ?? 5;

  const queryTokens = tokenize(query);

  const scored = chunks.map((chunk) => {
    const t = timeProximityScore(chunk, currentTime, timeWindow);
    const k = keywordScore(chunk, queryTokens);
    return { chunk, score: timeWeight * t + keywordWeight * k };
  });

  scored.sort((a, b) => b.score - a.score);
  const topChunks = scored.slice(0, topK).map((s) => s.chunk);

  const overallSummary = chunks
    .map((c) => c.summary)
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .join('\n');

  // chapter summary = summary of the chunk nearest currentTime
  let nearest = chunks[0] ?? null;
  if (currentTime !== null) {
    let bestDist = Number.POSITIVE_INFINITY;
    for (const c of chunks) {
      const d = Math.abs(chunkCenter(c) - currentTime);
      if (d < bestDist) {
        bestDist = d;
        nearest = c;
      }
    }
  }
  const chapterSummary = nearest?.summary ?? '';

  return { overallSummary, chapterSummary, topChunks };
}
