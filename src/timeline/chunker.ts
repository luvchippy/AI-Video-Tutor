import type { KnowledgeChunk } from '../types/knowledge';
import type { SubtitleSegment } from '../types/playback';

export interface ChunkOptions {
  videoId: string;
  /** Close a chunk once it reaches this length AND a sentence ends. */
  minDuration?: number;
  /** Hard cap: force-close a chunk at this length even mid-sentence. */
  maxDuration?: number;
}

const DEFAULT_MIN = 30;
const DEFAULT_MAX = 90;

/** A segment whose text ends with sentence-ending punctuation. */
const SENTENCE_END = /[.!?。！？；;…]\s*$/;

export function isSentenceEnd(text: string): boolean {
  return SENTENCE_END.test(text.trim());
}

function buildChunk(
  segments: SubtitleSegment[],
  startTime: number,
  videoId: string,
  index: number,
): KnowledgeChunk {
  const endTime = segments[segments.length - 1]?.end ?? startTime;
  const transcript = segments
    .map((s) => s.text.trim())
    .join(' ')
    .replace(/\s+/g, ' ');
  return {
    id: `${videoId}#${index}`,
    videoId,
    startTime,
    endTime,
    transcript,
  };
}

/**
 * Group subtitle segments into 30–90s knowledge chunks.
 * Prefers closing on a sentence boundary; never splits a sentence unless a
 * chunk blows past `maxDuration` without any punctuation.
 */
export function chunkSubtitles(
  segments: SubtitleSegment[],
  opts: ChunkOptions,
): KnowledgeChunk[] {
  const minDuration = opts.minDuration ?? DEFAULT_MIN;
  const maxDuration = opts.maxDuration ?? DEFAULT_MAX;
  const videoId = opts.videoId;

  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const chunks: KnowledgeChunk[] = [];
  let current: SubtitleSegment[] = [];
  let chunkStart = 0;

  const close = () => {
    if (current.length === 0) return;
    chunks.push(buildChunk(current, chunkStart, videoId, chunks.length));
    current = [];
  };

  for (const seg of sorted) {
    if (current.length === 0) chunkStart = seg.start;
    current.push(seg);
    const dur = seg.end - chunkStart;
    const sentenceEnd = isSentenceEnd(seg.text);

    if (sentenceEnd && dur >= minDuration) {
      close();
    } else if (dur >= maxDuration) {
      // Hard cap: prevent unbounded chunks (e.g. auto-captions without punctuation).
      close();
    }
  }
  close();

  return chunks;
}
