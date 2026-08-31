import { describe, it, expect } from 'vitest';
import { iterateSse } from './sse';

function mockResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

async function collect(response: Response): Promise<string[]> {
  const out: string[] = [];
  for await (const payload of iterateSse(response)) out.push(payload);
  return out;
}

describe('iterateSse', () => {
  it('parses LF-delimited data lines', async () => {
    const res = mockResponse([
      'data: hello\n\ndata: world\n\n',
    ]);
    expect(await collect(res)).toEqual(['hello', 'world']);
  });

  it('parses CRLF-delimited data lines (real-world SSE)', async () => {
    const res = mockResponse([
      'data: hello\r\n\r\ndata: world\r\n\r\n',
    ]);
    expect(await collect(res)).toEqual(['hello', 'world']);
  });

  it('handles a [DONE] sentinel', async () => {
    const res = mockResponse([
      'data: {"text":"hi"}\n\ndata: [DONE]\n\n',
    ]);
    expect(await collect(res)).toEqual(['{"text":"hi"}', '[DONE]']);
  });

  it('flushes a final line without trailing newline', async () => {
    const res = mockResponse(['data: tail-no-newline']);
    expect(await collect(res)).toEqual(['tail-no-newline']);
  });

  it('handles partial chunks split across reads', async () => {
    // Each read delivers half a line; the parser must accumulate.
    const res = mockResponse([
      'data: part',
      '1\n\ndata: part2\n\n',
    ]);
    expect(await collect(res)).toEqual(['part1', 'part2']);
  });

  it('ignores non-data lines (event, id, comments)', async () => {
    const res = mockResponse([
      ': comment\n',
      'event: ping\n',
      'id: 42\n',
      'data: payload\n\n',
    ]);
    expect(await collect(res)).toEqual(['payload']);
  });

  it('handles empty response body', async () => {
    const res = new Response(null, { status: 200 });
    expect(await collect(res)).toEqual([]);
  });
});
