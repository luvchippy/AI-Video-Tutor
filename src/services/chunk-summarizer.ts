import type { AiProvider, ChatMessage } from '../types/provider';
import type { KnowledgeChunk } from '../types/knowledge';
import {
  buildChunkSummaryPrompt,
  type SummaryBatchItem,
} from '../prompts/chunk-summary';
import { extractJson } from '../timeline/sparse-analysis';
import { formatTime } from '../playback/format';

/**
 * Chunk Summarizer — the tutor model fills summary / keywords / concepts /
 * claims for already-chunked transcript segments, replacing the local
 * transcript-truncation fallback.
 *
 * Batches run strictly serially (never in parallel) to avoid rate limits, and
 * a failing batch only costs its own chunks. This module must stay free of
 * browser APIs so it can run in the node test environment.
 */

const DEFAULT_BATCH_SIZE = 6;
const DEFAULT_MAX_CHUNKS = 120;
const DEFAULT_TRANSCRIPT_LIMIT = 800;
const REQUEST_TEMPERATURE = 0.2;

/** AI-produced fields for one chunk. Absent key = the model said nothing. */
export interface ChunkAiFields {
  summary?: string;
  keywords?: string[];
  concepts?: string[];
  claims?: string[];
}

export interface SummarizeOptions {
  /** Chunks per model call. Default 6. */
  batchSize?: number;
  /** Hard cap on how many chunks are summarized in one run. Default 120. */
  maxChunks?: number;
  /** Per-chunk transcript truncation before it goes into the prompt. Default 800. */
  transcriptLimit?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export interface SummarizeResult {
  chunks: KnowledgeChunk[];
  batches: number;
  failedBatches: number;
}

/* ------------------------------------------------------------------ */
/* Parsing                                                              */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Trimmed non-empty string, otherwise undefined (blank = not provided). */
function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Strings only, trimmed, blanks dropped; undefined when not an array. */
function cleanStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    const text = cleanString(item);
    if (text !== undefined) out.push(text);
  }
  return out;
}

function toChunkFields(element: Record<string, unknown>): ChunkAiFields {
  const fields: ChunkAiFields = {};
  const summary = cleanString(element.summary);
  if (summary !== undefined) fields.summary = summary;
  const keywords = cleanStringArray(element.keywords);
  if (keywords !== undefined) fields.keywords = keywords;
  const concepts = cleanStringArray(element.concepts);
  if (concepts !== undefined) fields.concepts = concepts;
  const claims = cleanStringArray(element.claims);
  if (claims !== undefined) fields.claims = claims;
  return fields;
}

/**
 * Pull a JSON array out of a model reply. `extractJson` already handles plain
 * JSON and ```json fences (a top-level array round-trips through it), so the
 * only extra case is an array buried in prose: wrap the bracket span in an
 * object and let `extractJson` parse that.
 */
function extractSummaryArray(text: string): unknown[] | null {
  const direct = extractJson(text);
  if (Array.isArray(direct)) return direct;

  const trimmed = text.trim();
  const openBracket = trimmed.indexOf('[');
  const openBrace = trimmed.indexOf('{');
  const startsWithArray =
    openBracket >= 0 && (openBrace < 0 || openBracket < openBrace);
  if (startsWithArray) {
    const bracket = trimmed.match(/\[[\s\S]*\]/)?.[0];
    if (bracket !== undefined) {
      const items = extractJson(`{"items":${bracket}}`)?.items;
      if (Array.isArray(items)) return items;
    }
  }
  return null;
}

/**
 * Parse a model reply into fields keyed by batch index.
 * Returns null when the reply is not a JSON array of objects; entries whose
 * `index` is missing / not an integer / outside `[0, expectedCount)` are dropped.
 */
export function parseChunkSummaryResponse(
  text: string,
  expectedCount: number,
): Map<number, ChunkAiFields> | null {
  const raw = extractSummaryArray(text);
  if (raw === null) return null;

  const result = new Map<number, ChunkAiFields>();
  for (const element of raw) {
    // A non-object element means the reply is broken as a whole: discard all of
    // it rather than partially trusting it.
    if (!isRecord(element)) return null;

    const index = element.index;
    if (typeof index !== 'number' || !Number.isInteger(index)) continue;
    if (index < 0 || index >= expectedCount) continue;

    result.set(index, toChunkFields(element));
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Summarization                                                        */
/* ------------------------------------------------------------------ */

/** Coerce a caller-supplied number to an integer; absent/NaN -> fallback. */
function intOr(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.floor(value);
}

function truncateTranscript(text: string, limit: number): string {
  const trimmed = text.trim();
  return trimmed.length <= limit ? trimmed : trimmed.slice(0, limit);
}

/** Copy the model's fields onto a new chunk; never write undefined. */
function applyAiFields(
  chunk: KnowledgeChunk,
  fields: ChunkAiFields,
): KnowledgeChunk {
  const next: KnowledgeChunk = { ...chunk };
  if (fields.summary !== undefined) next.summary = fields.summary;
  if (fields.keywords !== undefined) next.keywords = fields.keywords;
  if (fields.concepts !== undefined) next.concepts = fields.concepts;
  if (fields.claims !== undefined) next.claims = fields.claims;
  return next;
}

/**
 * Summarize chunks in serial batches. Never throws: failures are isolated per
 * batch (`failedBatches`) and aborted runs return whatever finished already.
 */
export async function summarizeChunks(
  provider: AiProvider,
  chunks: KnowledgeChunk[],
  opts: SummarizeOptions = {},
): Promise<SummarizeResult> {
  const batchSize = Math.max(1, intOr(opts.batchSize, DEFAULT_BATCH_SIZE));
  const maxChunks = Math.max(0, intOr(opts.maxChunks, DEFAULT_MAX_CHUNKS));
  const transcriptLimit = Math.max(
    0,
    intOr(opts.transcriptLimit, DEFAULT_TRANSCRIPT_LIMIT),
  );
  const signal = opts.signal;

  // Fresh array; everything is copied, chunks keep their identity by reference.
  const result: KnowledgeChunk[] = [...chunks];
  const scheduled = chunks.slice(0, maxChunks);
  if (scheduled.length === 0) {
    return { chunks: result, batches: 0, failedBatches: 0 };
  }

  let batches = 0;
  let failedBatches = 0;
  let done = 0;

  for (let start = 0; start < scheduled.length; start += batchSize) {
    if (signal?.aborted) break;

    const slice = scheduled.slice(start, start + batchSize);
    const items: SummaryBatchItem[] = slice.map((chunk, index) => ({
      index,
      range: `${formatTime(chunk.startTime)}–${formatTime(chunk.endTime)}`,
      transcript: truncateTranscript(chunk.transcript, transcriptLimit),
    }));
    const messages: ChatMessage[] = [
      { role: 'user', content: buildChunkSummaryPrompt(items) },
    ];

    let fields: Map<number, ChunkAiFields> | null = null;
    try {
      const reply = await provider.chat(
        {
          model: provider.modelId,
          messages,
          temperature: REQUEST_TEMPERATURE,
          responseJson: true,
        },
        signal,
      );
      fields = parseChunkSummaryResponse(reply.text, items.length);
    } catch {
      // Failure isolation: `fields` stays null, so the chunks in this batch
      // keep their current values.
    }

    // An aborted call is not a parse failure: stop quietly with what we have.
    if (fields === null && signal?.aborted) break;

    batches += 1;
    if (fields === null) {
      failedBatches += 1;
    } else {
      for (let offset = 0; offset < slice.length; offset += 1) {
        const chunk = slice[offset];
        const ai = fields.get(offset);
        if (chunk === undefined || ai === undefined) continue;
        result[start + offset] = applyAiFields(chunk, ai);
      }
    }

    done += slice.length;
    opts.onProgress?.(done, scheduled.length);
  }

  return { chunks: result, batches, failedBatches };
}