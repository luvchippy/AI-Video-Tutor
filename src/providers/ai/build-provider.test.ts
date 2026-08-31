import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildProvider } from './index';
import type { ProviderConfig } from '../../types/provider';

function mockJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('buildProvider + DotsProvider integration', () => {
  it('buildProvider with dots-openai produces DotsProvider with /v1/chat/completions', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        return mockJsonResponse({
          choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }],
        });
      }),
    );

    // Simulate exactly what buildProviderFromSavedModel does
    const config: ProviderConfig = {
      provider: 'dots-openai',
      modelId: 'dots3-note-prev',
      baseUrl: 'https://note3-prev-api.askdiandian.com',
      apiKey: 'test-key',
      displayName: 'Dots3 Note Prev',
    };
    const provider = buildProvider(config);
    await provider.chat({
      model: 'dots3-note-prev',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(calls[0]).toBe('https://note3-prev-api.askdiandian.com/v1/chat/completions');
  });

  it('buildProvider with dots-openai uses api-key header, not Authorization', async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push(init);
        return mockJsonResponse({
          choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }],
        });
      }),
    );

    const provider = buildProvider({
      provider: 'dots-openai',
      modelId: 'dots3-note-prev',
      baseUrl: 'https://note3-prev-api.askdiandian.com',
      apiKey: 'test-key',
    });
    await provider.chat({
      model: 'dots3-note-prev',
      messages: [{ role: 'user', content: 'hi' }],
    });

    const headers = calls[0]!.headers as Record<string, string>;
    expect(headers['api-key']).toBe('test-key');
    expect(headers['Authorization']).toBeUndefined();
  });

  it('buildProvider with openai-compatible produces standard /chat/completions', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        return mockJsonResponse({
          choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }],
        });
      }),
    );

    const provider = buildProvider({
      provider: 'openai-compatible',
      modelId: 'gpt-4o-mini',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'test-key',
    });
    await provider.chat({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(calls[0]).toBe('https://api.example.com/v1/chat/completions');
  });

  it('buildProvider with openai-compatible uses Authorization Bearer', async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push(init);
        return mockJsonResponse({
          choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }],
        });
      }),
    );

    const provider = buildProvider({
      provider: 'openai-compatible',
      modelId: 'gpt-4o-mini',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'test-key',
    });
    await provider.chat({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
    });

    const headers = calls[0]!.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-key');
    expect(headers['api-key']).toBeUndefined();
  });

  it('streamChat also uses /v1/chat/completions for dots-openai', async () => {
    const calls: string[] = [];
    const encoder = new TextEncoder();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\n'));
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }),
    );

    const provider = buildProvider({
      provider: 'dots-openai',
      modelId: 'dots3-note-prev',
      baseUrl: 'https://note3-prev-api.askdiandian.com',
      apiKey: 'test-key',
    });
    let acc = '';
    for await (const chunk of provider.streamChat({
      model: 'dots3-note-prev',
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      acc += chunk.text;
    }

    expect(calls[0]).toBe('https://note3-prev-api.askdiandian.com/v1/chat/completions');
    expect(acc).toBe('OK');
  });

  it('baseUrl with trailing /v1 does NOT produce double /v1', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        return mockJsonResponse({
          choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }],
        });
      }),
    );

    // Some users might paste a baseUrl that includes /v1
    const provider = buildProvider({
      provider: 'dots-openai',
      modelId: 'dots3-note-prev',
      baseUrl: 'https://note3-prev-api.askdiandian.com/v1',
      apiKey: 'test-key',
    });
    await provider.chat({
      model: 'dots3-note-prev',
      messages: [{ role: 'user', content: 'hi' }],
    });

    // Dots endpointPath is /v1/chat/completions — if baseUrl has /v1,
    // we should NOT get /v1/v1/chat/completions.
    // normalizeBaseUrl should strip the /v1 when the protocol is dots.
    // Currently it doesn't — this test documents the expected behavior.
    // The URL should be: https://note3-prev-api.askdiandian.com/v1/chat/completions
    // NOT: https://note3-prev-api.askdiandian.com/v1/v1/chat/completions
    expect(calls[0]).toBe('https://note3-prev-api.askdiandian.com/v1/chat/completions');
  });
});
