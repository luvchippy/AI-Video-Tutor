import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DotsProvider, DOTS_BASE_URL, DOTS_CAPABILITIES } from './dots';

function mockJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mockSseResponse(chunks: string[]): Response {
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

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('DotsProvider', () => {
  it('uses /v1/chat/completions endpoint (not /chat/completions)', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        return mockJsonResponse({
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        });
      }),
    );
    const provider = new DotsProvider({
      provider: 'dots',
      modelId: 'dots3-note-prev',
      apiKey: 'test-key',
    });
    await provider.chat({
      model: 'dots3-note-prev',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(calls[0]).toBe('https://note3-prev-api.askdiandian.com/v1/chat/completions');
  });

  it('sends api-key header (not Authorization Bearer)', async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push(init);
        return mockJsonResponse({
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        });
      }),
    );
    const provider = new DotsProvider({
      provider: 'dots',
      modelId: 'dots3-note-prev',
      apiKey: 'my-secret-key',
    });
    await provider.chat({
      model: 'dots3-note-prev',
      messages: [{ role: 'user', content: 'hi' }],
    });
    const headers = calls[0]!.headers as Record<string, string>;
    expect(headers['api-key']).toBe('my-secret-key');
    expect(headers['Authorization']).toBeUndefined();
  });

  it('does not send Authorization header at all', async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push(init);
        return mockJsonResponse({
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        });
      }),
    );
    const provider = new DotsProvider({
      provider: 'dots',
      modelId: 'dots3-note-prev',
      apiKey: 'k',
    });
    await provider.chat({
      model: 'dots3-note-prev',
      messages: [{ role: 'user', content: 'hi' }],
    });
    const headers = calls[0]!.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  it('handles text chat request with JSON response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        mockJsonResponse({
          choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
        }),
      ),
    );
    const provider = new DotsProvider({
      provider: 'dots',
      modelId: 'dots3-note-prev',
      apiKey: 'k',
    });
    const result = await provider.chat({
      model: 'dots3-note-prev',
      messages: [{ role: 'user', content: 'Reply exactly with: OK' }],
      maxTokens: 32,
    });
    expect(result.text).toBe('OK');
    expect(result.usage?.totalTokens).toBe(6);
  });

  it('serializes image_url content part', async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push(init);
        return mockJsonResponse({
          choices: [{ message: { content: 'seen' }, finish_reason: 'stop' }],
        });
      }),
    );
    const provider = new DotsProvider({
      provider: 'dots',
      modelId: 'dots3-note-prev',
      apiKey: 'k',
    });
    await provider.chat({
      model: 'dots3-note-prev',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'what is this' },
            { type: 'image_url', image_url: { url: 'https://example.com/img.png' } },
          ],
        },
      ],
    });
    const body = JSON.parse(String(calls[0]!.body));
    const parts = body.messages[0].content;
    expect(parts[1].type).toBe('image_url');
    expect(parts[1].image_url.url).toBe('https://example.com/img.png');
  });

  it('serializes video_url content part as native video_url (not text fallback)', async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push(init);
        return mockJsonResponse({
          choices: [{ message: { content: 'seen' }, finish_reason: 'stop' }],
        });
      }),
    );
    const provider = new DotsProvider({
      provider: 'dots',
      modelId: 'dots3-note-prev',
      apiKey: 'k',
    });
    await provider.chat({
      model: 'dots3-note-prev',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'analyze' },
            { type: 'video_url', video_url: { url: 'https://example.com/video.mp4' } },
          ],
        },
      ],
    });
    const body = JSON.parse(String(calls[0]!.body));
    const parts = body.messages[0].content;
    expect(parts[1].type).toBe('video_url');
    expect(parts[1].video_url.url).toBe('https://example.com/video.mp4');
  });

  it('serializes audio content part as audio_url', async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push(init);
        return mockJsonResponse({
          choices: [{ message: { content: 'heard' }, finish_reason: 'stop' }],
        });
      }),
    );
    const provider = new DotsProvider({
      provider: 'dots',
      modelId: 'dots3-note-prev',
      apiKey: 'k',
    });
    // The ContentPart type doesn't have audio_url yet, so we use a cast
    await provider.chat({
      model: 'dots3-note-prev',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'listen' },
            { type: 'audio_url' as never, audio_url: { url: 'https://example.com/audio.mp3' } } as never,
          ],
        },
      ],
    });
    const body = JSON.parse(String(calls[0]!.body));
    const parts = body.messages[0].content;
    expect(parts[1].type).toBe('audio_url');
    expect(parts[1].audio_url.url).toBe('https://example.com/audio.mp3');
  });

  it('handles SSE response despite stream:false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        mockSseResponse([
          'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      ),
    );
    const provider = new DotsProvider({
      provider: 'dots',
      modelId: 'dots3-note-prev',
      apiKey: 'k',
    });
    const result = await provider.chat({
      model: 'dots3-note-prev',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result.text).toBe('OK');
  });

  it('allows custom baseUrl override', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        return mockJsonResponse({
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        });
      }),
    );
    const provider = new DotsProvider({
      provider: 'dots',
      modelId: 'dots3-note-prev',
      apiKey: 'k',
      baseUrl: 'https://custom-proxy.example.com',
    });
    await provider.chat({
      model: 'dots3-note-prev',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(calls[0]).toBe('https://custom-proxy.example.com/v1/chat/completions');
  });

  it('exports correct DOTS_CAPABILITIES', () => {
    expect(DOTS_CAPABILITIES.textInput).toBe(true);
    expect(DOTS_CAPABILITIES.imageInput).toBe(true);
    expect(DOTS_CAPABILITIES.videoInput).toBe(true);
    expect(DOTS_CAPABILITIES.audioInput).toBe(true);
    expect(DOTS_CAPABILITIES.functionCalling).toBe(true);
    expect(DOTS_CAPABILITIES.streaming).toBe(true);
    expect(DOTS_CAPABILITIES.nativeWebSearch).toBe(false);
    expect(DOTS_CAPABILITIES.contextWindow).toBe(524288);
  });

  it('exports correct DOTS_BASE_URL', () => {
    expect(DOTS_BASE_URL).toBe('https://note3-prev-api.askdiandian.com');
  });
});
