import { describe, it, expect, vi } from 'vitest';
import type {
  AiProvider,
  ChatRequest,
  ChatResult,
  StreamChunk,
} from '../types/provider';
import type { KnowledgeChunk } from '../types/knowledge';
import {
  parseChunkSummaryResponse,
  summarizeChunks,
} from './chunk-summarizer';

/* ------------------------------------------------------------------ */
/* Test doubles                                                         */
/* ------------------------------------------------------------------ */

function fakeProvider(chat: AiProvider['chat']): AiProvider {
  return {
    id: 'fake',
    provider: 'fake',
    modelId: 'fake-tutor',
    displayName: 'Fake Tutor',
    capabilities: {
      textInput: true,
      imageInput: false,
      audioInput: false,
      videoInput: false,
      videoFileUpload: false,
      directVideoUrl: false,
      youtubeUrl: false,
      nativeWebSearch: false,
      functionCalling: false,
      structuredOutput: false,
      streaming: false,
    },
    streamChat: async function* (): AsyncGenerator<StreamChunk> {
      yield { text: '', done: true, finishReason: 'stop' };
    },
    chat,
    analyzeImage: async () => '',
    search: async () => [],
  };
}

/** Text of the (single) prompt message the summarizer sends. */
function promptText(req: ChatRequest | undefined): string {
  const content = req?.messages[0]?.content;
  return typeof content === 'string' ? content : '';
}

/**
 * Batch-local indexes found in the prompt. Depends on the prompt format
 * `buildChunkSummaryPrompt` produces — which is part of what we assert there.
 */
function promptIndexes(req: ChatRequest): number[] {
  return [...promptText(req).matchAll(/\[index=(\d+)\]/g)].map((m) =>
    Number(m[1] ?? ''),
  );
}

/** A well-formed reply covering exactly the indexes found in the prompt. */
function replyForIndexes(indexes: number[]): string {
  return JSON.stringify(
    indexes.map((index) => ({
      index,
      summary: `AI 摘要 ${index}`,
      keywords: [`关键词${index}`],
      concepts: [`概念${index}`],
      claims: [`论断${index}`],
    })),
  );
}

function makeChunk(id: number, overrides: Partial<KnowledgeChunk> = {}): KnowledgeChunk {
  return {
    id: `v#${id}`,
    videoId: 'v',
    startTime: id * 30,
    endTime: id * 30 + 25,
    transcript: `片段 ${id} 的字幕内容`,
    ...overrides,
  };
}

function makeChunks(count: number): KnowledgeChunk[] {
  return Array.from({ length: count }, (_, i) => makeChunk(i));
}

/* ------------------------------------------------------------------ */
/* parseChunkSummaryResponse                                            */
/* ------------------------------------------------------------------ */

describe('parseChunkSummaryResponse', () => {
  it('parses a plain JSON array', () => {
    const text = JSON.stringify([
      { index: 0, summary: '摘要', keywords: ['a'], concepts: [], claims: [] },
    ]);
    expect(parseChunkSummaryResponse(text, 1)?.get(0)).toEqual({
      summary: '摘要',
      keywords: ['a'],
      concepts: [],
      claims: [],
    });
  });

  it('parses an array inside a ```json fence', () => {
    const text = '```json\n[{"index":0,"summary":"围栏摘要"}]\n```';
    expect(parseChunkSummaryResponse(text, 1)?.get(0)).toEqual({
      summary: '围栏摘要',
    });
  });

  it('parses an array surrounded by prose', () => {
    const text = '好的，结果如下：\n[{"index":1,"summary":"第二段"}]\n以上。';
    expect(parseChunkSummaryResponse(text, 2)?.get(1)).toEqual({
      summary: '第二段',
    });
  });

  it('drops entries whose index is out of range, missing or not an integer', () => {
    const text = JSON.stringify([
      { index: 0, summary: 'ok' },
      { index: 9, summary: 'out of range' },
      { index: -1, summary: 'negative' },
      { index: 1.5, summary: 'fractional' },
      { index: '2', summary: 'string index' },
      { summary: 'no index at all' },
    ]);
    const parsed = parseChunkSummaryResponse(text, 3);
    expect(parsed).not.toBeNull();
    expect([...(parsed?.keys() ?? [])]).toEqual([0]);
  });

  it('accepts entries with missing fields', () => {
    const text = JSON.stringify([{ index: 1, keywords: ['k'] }, { index: 0 }]);
    const parsed = parseChunkSummaryResponse(text, 2);
    expect(parsed?.get(1)).toEqual({ keywords: ['k'] });
    expect(parsed?.get(0)).toEqual({});
  });

  it('returns null when the payload is not an array', () => {
    expect(parseChunkSummaryResponse('{"index":0,"summary":"x"}', 1)).toBeNull();
    expect(parseChunkSummaryResponse('抱歉，我无法完成这个任务。', 1)).toBeNull();
    expect(
      parseChunkSummaryResponse('{"results":[{"index":0}]}', 1),
    ).toBeNull();
  });

  it('returns null when an element is not an object', () => {
    expect(parseChunkSummaryResponse('["a","b"]', 2)).toBeNull();
    expect(parseChunkSummaryResponse('[{"index":0}, 3]', 2)).toBeNull();
    expect(parseChunkSummaryResponse('[null]', 1)).toBeNull();
    expect(parseChunkSummaryResponse('[[{"index":0}]]', 1)).toBeNull();
  });

  it('trims strings and treats blank strings as not provided', () => {
    const text = JSON.stringify([
      { index: 0, summary: '   ', concepts: ['  概念  '] },
    ]);
    const fields = parseChunkSummaryResponse(text, 1)?.get(0);
    expect(fields).toEqual({ concepts: ['概念'] });
    expect(fields?.summary).toBeUndefined();
  });

  it('filters non-string and blank items out of arrays', () => {
    const text = JSON.stringify([
      { index: 0, keywords: [' a ', 7, null, '', '  ', 'b', { x: 1 }] },
    ]);
    expect(parseChunkSummaryResponse(text, 1)?.get(0)).toEqual({
      keywords: ['a', 'b'],
    });
  });

  it('omits array fields that are not arrays', () => {
    const text = JSON.stringify([{ index: 0, keywords: 'a,b' }]);
    expect(parseChunkSummaryResponse(text, 1)?.get(0)).toEqual({});
  });

  it('returns an empty map for an empty array', () => {
    const parsed = parseChunkSummaryResponse('[]', 3);
    expect(parsed).not.toBeNull();
    expect(parsed?.size).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* summarizeChunks                                                      */
/* ------------------------------------------------------------------ */

describe('summarizeChunks', () => {
  it('summarizes in serial batches and writes all four fields', async () => {
    const chunks = makeChunks(13);
    const calls: ChatRequest[] = [];
    const provider = fakeProvider(async (req) => {
      calls.push(req);
      return { text: replyForIndexes(promptIndexes(req)), finishReason: 'stop' };
    });

    const result = await summarizeChunks(provider, chunks, { batchSize: 6 });

    // 13 chunks / 6 per batch -> 3 serial calls.
    expect(calls.length).toBe(3);
    expect(result.batches).toBe(3);
    expect(result.failedBatches).toBe(0);
    expect(result.chunks.length).toBe(13);
    // Indexes are batch-local: batch 3 holds a single chunk re-indexed as 0.
    expect(result.chunks.map((c) => c.summary)).toEqual([
      'AI 摘要 0',
      'AI 摘要 1',
      'AI 摘要 2',
      'AI 摘要 3',
      'AI 摘要 4',
      'AI 摘要 5',
      'AI 摘要 0',
      'AI 摘要 1',
      'AI 摘要 2',
      'AI 摘要 3',
      'AI 摘要 4',
      'AI 摘要 5',
      'AI 摘要 0',
    ]);
    expect(result.chunks[0]?.keywords).toEqual(['关键词0']);
    expect(result.chunks[0]?.concepts).toEqual(['概念0']);
    expect(result.chunks[0]?.claims).toEqual(['论断0']);
    expect(result.chunks.map((c) => c.id)).toEqual(chunks.map((c) => c.id));

    // Request shape: tutor model, JSON mode, serial.
    expect(calls[0]?.model).toBe('fake-tutor');
    expect(calls[0]?.responseJson).toBe(true);
    expect(calls.map((c) => promptIndexes(c).length)).toEqual([6, 6, 1]);
  });

  it('does not mutate the input chunks or array', async () => {
    const chunks = makeChunks(4).map((c) => ({ ...c, summary: `本地摘要 ${c.id}` }));
    const snapshot = JSON.stringify(chunks);
    const provider = fakeProvider(async (req) => ({
      text: replyForIndexes(promptIndexes(req)),
      finishReason: 'stop',
    }));

    const result = await summarizeChunks(provider, chunks, { batchSize: 2 });

    expect(JSON.stringify(chunks)).toBe(snapshot);
    expect(result.chunks).not.toBe(chunks);
    expect(result.chunks[0]?.summary).toBe('AI 摘要 0');
    expect(result.chunks[2]?.summary).toBe('AI 摘要 0');
  });

  it('isolates a failing batch and keeps the caller fallback values', async () => {
    const chunks = makeChunks(13).map((c) => ({
      ...c,
      summary: `本地摘要 ${c.id}`,
    }));
    const calls: ChatRequest[] = [];
    const provider = fakeProvider(async (req) => {
      calls.push(req);
      if (calls.length === 2) throw new Error('429 rate limited');
      return { text: replyForIndexes(promptIndexes(req)), finishReason: 'stop' };
    });

    const result = await summarizeChunks(provider, chunks, { batchSize: 6 });

    expect(calls.length).toBe(3);
    expect(result.batches).toBe(3);
    expect(result.failedBatches).toBe(1);
    // Batch 2 (chunks 6-11) keeps the local fallback and gains no AI fields.
    for (const i of [6, 7, 8, 9, 10, 11]) {
      expect(result.chunks[i]?.summary).toBe(chunks[i]?.summary);
      expect(result.chunks[i]?.keywords).toBeUndefined();
    }
    // Other batches were still processed.
    expect(result.chunks[0]?.summary).toBe('AI 摘要 0');
    expect(result.chunks[12]?.summary).toBe('AI 摘要 0');
  });

  it('counts an unparseable reply as a failed batch', async () => {
    const calls: ChatRequest[] = [];
    const provider = fakeProvider(async (req) => {
      calls.push(req);
      const text =
        calls.length === 1 ? '抱歉，我无法完成。' : replyForIndexes(promptIndexes(req));
      return { text, finishReason: 'stop' };
    });

    const result = await summarizeChunks(provider, makeChunks(4), { batchSize: 2 });

    expect(result.batches).toBe(2);
    expect(result.failedBatches).toBe(1);
    expect(result.chunks[0]?.summary).toBeUndefined();
    expect(result.chunks[2]?.summary).toBe('AI 摘要 0');
  });

  it('never overwrites existing values with undefined', async () => {
    const chunk = makeChunk(0, { summary: '本地截断摘要', keywords: ['旧关键词'] });
    const provider = fakeProvider(async () => ({
      text: JSON.stringify([
        { index: 0, concepts: ['注意力机制'], keywords: [] },
      ]),
      finishReason: 'stop',
    }));

    const result = await summarizeChunks(provider, [chunk]);

    expect(result.chunks[0]?.summary).toBe('本地截断摘要');
    expect(result.chunks[0]?.concepts).toEqual(['注意力机制']);
    // An explicit empty array is a real result: "there are no keywords".
    expect(result.chunks[0]?.keywords).toEqual([]);
    // A missing field is not written at all.
    expect(Object.keys(result.chunks[0] ?? {})).not.toContain('claims');
  });

  it('truncates to maxChunks and passes the rest through untouched', async () => {
    const chunks = makeChunks(5).map((c) => ({ ...c, summary: `${c.id} 回退` }));
    const calls: ChatRequest[] = [];
    const provider = fakeProvider(async (req) => {
      calls.push(req);
      return { text: replyForIndexes(promptIndexes(req)), finishReason: 'stop' };
    });

    const result = await summarizeChunks(provider, chunks, {
      maxChunks: 3,
      batchSize: 2,
    });

    expect(calls.length).toBe(2);
    expect(result.batches).toBe(2);
    expect(result.chunks.length).toBe(5);
    expect(result.chunks.map((c) => c.summary)).toEqual([
      'AI 摘要 0',
      'AI 摘要 1',
      'AI 摘要 0',
      'v#3 回退',
      'v#4 回退',
    ]);
  });

  it('returns immediately for an empty chunk list', async () => {
    const calls: ChatRequest[] = [];
    const provider = fakeProvider(async (req) => {
      calls.push(req);
      return { text: '[]', finishReason: 'stop' };
    });

    const result = await summarizeChunks(provider, []);

    expect(result).toEqual({ chunks: [], batches: 0, failedBatches: 0 });
    expect(calls.length).toBe(0);
  });

  it('reports progress once per finished batch, including failed ones', async () => {
    const calls: ChatRequest[] = [];
    const provider = fakeProvider(async (req) => {
      calls.push(req);
      if (calls.length === 2) throw new Error('boom');
      return { text: replyForIndexes(promptIndexes(req)), finishReason: 'stop' };
    });
    const onProgress = vi.fn();

    const result = await summarizeChunks(provider, makeChunks(7), {
      batchSize: 3,
      onProgress,
    });

    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenNthCalledWith(1, 3, 7);
    expect(onProgress).toHaveBeenNthCalledWith(2, 6, 7);
    expect(onProgress).toHaveBeenNthCalledWith(3, 7, 7);
    expect(result.batches).toBe(3);
    expect(result.failedBatches).toBe(1);
  });

  it('returns quietly when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const calls: ChatRequest[] = [];
    const provider = fakeProvider(async (req) => {
      calls.push(req);
      return { text: '[]', finishReason: 'stop' };
    });

    const result = await summarizeChunks(provider, makeChunks(4), {
      batchSize: 2,
      signal: controller.signal,
    });

    expect(calls.length).toBe(0);
    expect(result.batches).toBe(0);
    expect(result.failedBatches).toBe(0);
    expect(result.chunks.length).toBe(4);
  });

  it('stops quietly when aborted mid-run and keeps finished work', async () => {
    const controller = new AbortController();
    const calls: ChatRequest[] = [];
    const provider = fakeProvider(async (req) => {
      calls.push(req);
      controller.abort();
      if (calls.length > 1) throw new Error('aborted');
      return { text: replyForIndexes(promptIndexes(req)), finishReason: 'stop' };
    });

    const result = await summarizeChunks(provider, makeChunks(6), {
      batchSize: 3,
      signal: controller.signal,
    });

    expect(calls.length).toBe(1);
    expect(result.batches).toBe(1);
    expect(result.failedBatches).toBe(0);
    expect(result.chunks.map((c) => c.summary)).toEqual([
      'AI 摘要 0',
      'AI 摘要 1',
      'AI 摘要 2',
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('treats an abort that throws mid-call as a stop, not a failure', async () => {
    const controller = new AbortController();
    const provider = fakeProvider(async () => {
      controller.abort();
      throw new Error('The operation was aborted.');
    });

    const result = await summarizeChunks(provider, makeChunks(3), {
      batchSize: 2,
      signal: controller.signal,
    });

    expect(result.batches).toBe(0);
    expect(result.failedBatches).toBe(0);
    expect(result.chunks.length).toBe(3);
  });

  it('puts index, time range and the truncated transcript in the prompt', async () => {
    const chunk = makeChunk(0, {
      startTime: 90,
      endTime: 135,
      transcript: 'x'.repeat(50),
    });
    const calls: ChatRequest[] = [];
    const provider = fakeProvider(async (req) => {
      calls.push(req);
      return { text: replyForIndexes(promptIndexes(req)), finishReason: 'stop' };
    });

    await summarizeChunks(provider, [chunk], { transcriptLimit: 10 });

    const text = promptText(calls[0]);
    expect(text).toContain('[index=0]');
    expect(text).toContain('01:30–02:15');
    expect(text).toContain('x'.repeat(10));
    expect(text).not.toContain('x'.repeat(11));
    // The prompt must forbid made-up content and non-JSON chatter.
    expect(text).toContain('JSON');
  });

  it('uses one batch by default and keeps chunk order', async () => {
    const calls: ChatRequest[] = [];
    const provider = fakeProvider(async (req: ChatRequest): Promise<ChatResult> => {
      calls.push(req);
      return { text: replyForIndexes(promptIndexes(req)), finishReason: 'stop' };
    });

    const result = await summarizeChunks(provider, makeChunks(6));

    expect(calls.length).toBe(1);
    expect(promptIndexes(calls[0] as ChatRequest)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(result.chunks.map((c) => c.id)).toEqual(makeChunks(6).map((c) => c.id));
  });
});