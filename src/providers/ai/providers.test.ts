import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockProvider } from './mock';
import { GeminiProvider } from './gemini';
import { OpenAICompatibleProvider } from './openai-compatible';
import type { ChatRequest } from '../../types/provider';

function mockResponse(body: string, chunks: string[], done = true): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      if (done) controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function mockJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('MockProvider', () => {
  it('streams non-empty labelled text', async () => {
    const provider = new MockProvider();
    const req: ChatRequest = {
      model: 'mock-tutor',
      messages: [{ role: 'user', content: '这里是什么意思？' }],
    };
    let acc = '';
    for await (const chunk of provider.streamChat(req)) {
      acc += chunk.text;
    }
    expect(acc.length).toBeGreaterThan(0);
    expect(acc).toContain('[DEMO/MOCK]');
  });

  it('returns mock search results', async () => {
    const provider = new MockProvider();
    const results = await provider.search('test');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.url).toContain('example.com');
  });
});

describe('GeminiProvider', () => {
  it('builds a body with inline_data for an image part', async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push(init);
        return mockJsonResponse({
          candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
        });
      }),
    );
    const provider = new GeminiProvider({
      provider: 'gemini',
      modelId: 'gemini-2.5-flash',
      apiKey: 'fake',
    });
    const req: ChatRequest = {
      model: 'gemini-2.5-flash',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'what is this' },
            {
              type: 'inline_image',
              inline_image: { mimeType: 'image/png', data: 'QUJD' },
            },
          ],
        },
      ],
    };
    const result = await provider.chat(req);
    expect(result.text).toBe('ok');
    expect(calls.length).toBe(1);
    const body = JSON.parse(String(calls[0]!.body));
    const part = body.contents[0].parts[1];
    expect(part.inline_data.mime_type).toBe('image/png');
    expect(part.inline_data.data).toBe('QUJD');
  });
});

describe('OpenAICompatibleProvider', () => {
  it('streams 3 data chunks + [DONE] and concatenates text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        mockResponse('', [
          'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"!"},"finish_reason":"stop"}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      ),
    );
    const provider = new OpenAICompatibleProvider({
      provider: 'openai',
      modelId: 'gpt-4o-mini',
      apiKey: 'fake',
    });
    const req: ChatRequest = {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
    };
    let acc = '';
    let finished = false;
    for await (const chunk of provider.streamChat(req)) {
      acc += chunk.text;
      if (chunk.done) finished = true;
    }
    expect(acc).toBe('Hello!');
    expect(finished).toBe(true);
  });

  it('search returns [] (no hosted web search)', async () => {
    const provider = new OpenAICompatibleProvider({
      provider: 'openai',
      modelId: 'gpt-4o-mini',
      apiKey: 'fake',
    });
    expect(await provider.search('anything')).toEqual([]);
  });

  it('skips malformed SSE data lines without crashing the stream', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        mockResponse('', [
          'data: not-json\n\n',
          'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
          'data: {broken\n\n',
          'data: [DONE]\n\n',
        ]),
      ),
    );
    const provider = new OpenAICompatibleProvider({
      provider: 'openai',
      modelId: 'gpt-4o-mini',
      apiKey: 'fake',
    });
    const req: ChatRequest = {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
    };
    let acc = '';
    for await (const chunk of provider.streamChat(req)) {
      acc += chunk.text;
    }
    expect(acc).toBe('ok');
  });

  it('handles CRLF line endings in SSE stream', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        mockResponse('', [
          'data: {"choices":[{"delta":{"content":"A"}}]}\r\n\r\n',
          'data: {"choices":[{"delta":{"content":"B"}}]}\r\n\r\n',
          'data: [DONE]\r\n\r\n',
        ]),
      ),
    );
    const provider = new OpenAICompatibleProvider({
      provider: 'openai',
      modelId: 'gpt-4o-mini',
      apiKey: 'fake',
    });
    const req: ChatRequest = {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
    };
    let acc = '';
    for await (const chunk of provider.streamChat(req)) {
      acc += chunk.text;
    }
    expect(acc).toBe('AB');
  });

  it('throws a descriptive error on HTTP 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        mockJsonResponse({ error: { message: 'Invalid API key' } }, 401),
      ),
    );
    const provider = new OpenAICompatibleProvider({
      provider: 'openai',
      modelId: 'gpt-4o-mini',
      apiKey: 'bad',
    });
    const req: ChatRequest = {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
    };
    await expect(provider.chat(req)).rejects.toThrow('Invalid API key');
  });

  it('strips /chat/completions if user pasted full endpoint URL', async () => {
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
    const provider = new OpenAICompatibleProvider({
      provider: 'custom',
      modelId: 'test-model',
      apiKey: 'fake',
      baseUrl: 'https://api.example.com/v1/chat/completions',
    });
    await provider.chat({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(calls[0]).toBe('https://api.example.com/v1/chat/completions');
  });

  it('strips trailing slash from baseUrl', async () => {
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
    const provider = new OpenAICompatibleProvider({
      provider: 'custom',
      modelId: 'test-model',
      apiKey: 'fake',
      baseUrl: 'https://api.example.com/v1/',
    });
    await provider.chat({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(calls[0]).toBe('https://api.example.com/v1/chat/completions');
  });

  it('sends Authorization header with the API key', async () => {
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
    const provider = new OpenAICompatibleProvider({
      provider: 'custom',
      modelId: 'test-model',
      apiKey: 'sk-test-123',
      baseUrl: 'https://api.example.com/v1',
    });
    await provider.chat({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hi' }],
    });
    const headers = calls[0]!.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-test-123');
  });

  // --- SSE response handling for non-streaming chat() ---

  it('chat() handles SSE response when server returns text/event-stream despite stream:false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        mockResponse('', [
          'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      ),
    );
    const provider = new OpenAICompatibleProvider({
      provider: 'custom',
      modelId: 'test-model',
      apiKey: 'fake',
      baseUrl: 'https://api.example.com/v1',
    });
    const result = await provider.chat({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result.text).toBe('OK');
  });

  it('chat() handles SSE with content spread across multiple chunks', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        mockResponse('', [
          'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"!"},"finish_reason":"stop"}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      ),
    );
    const provider = new OpenAICompatibleProvider({
      provider: 'custom',
      modelId: 'test-model',
      apiKey: 'fake',
    });
    const result = await provider.chat({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result.text).toBe('Hello!');
  });

  it('chat() handles SSE with non-delta choices (message field)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        mockResponse('', [
          'data: {"choices":[{"message":{"content":"OK"},"finish_reason":"stop"}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      ),
    );
    const provider = new OpenAICompatibleProvider({
      provider: 'custom',
      modelId: 'test-model',
      apiKey: 'fake',
    });
    const result = await provider.chat({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result.text).toBe('OK');
  });

  it('chat() returns empty text when SSE stream contains only [DONE]', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        mockResponse('', [
          'data: [DONE]\n\n',
        ]),
      ),
    );
    const provider = new OpenAICompatibleProvider({
      provider: 'custom',
      modelId: 'test-model',
      apiKey: 'fake',
    });
    const result = await provider.chat({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result.text).toBe('');
  });

  it('chat() skips malformed SSE data lines without crashing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        mockResponse('', [
          'data: not-json\n\n',
          'data: {broken\n\n',
          'data: {"choices":[{"message":{"content":"OK"},"finish_reason":"stop"}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      ),
    );
    const provider = new OpenAICompatibleProvider({
      provider: 'custom',
      modelId: 'test-model',
      apiKey: 'fake',
    });
    const result = await provider.chat({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result.text).toBe('OK');
  });

  it('chat() still works with normal JSON response (application/json)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        mockJsonResponse({
          choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }],
        }),
      ),
    );
    const provider = new OpenAICompatibleProvider({
      provider: 'custom',
      modelId: 'test-model',
      apiKey: 'fake',
    });
    const result = await provider.chat({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result.text).toBe('OK');
  });
});
