import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createBraveSearchProvider,
  createExternalSearchProvider,
  createTavilySearchProvider,
} from './web-search';
import type { ExternalSearchService } from './web-search';

type FetchArgs = [url: string, init?: RequestInit];

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html' },
  });
}

function firstCall(): FetchArgs {
  const call = fetchMock.mock.calls[0];
  if (!call) throw new Error('expected fetch to have been called');
  return call;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ------------------------------- availability ------------------------------- */

describe('availability without an API key', () => {
  it('marks Tavily unavailable, explains why, and never sends a request', async () => {
    const provider = createTavilySearchProvider('');

    expect(provider.id).toBe('external:tavily');
    expect(provider.available).toBe(false);
    expect(provider.reason).toContain('Tavily');
    expect(provider.reason).toContain('API Key');

    await expect(provider.search('量子计算')).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats a whitespace-only key as missing (Brave)', async () => {
    const provider = createBraveSearchProvider('  \t\n ');

    expect(provider.id).toBe('external:brave');
    expect(provider.available).toBe(false);
    expect(provider.reason).toContain('Brave');
    expect(provider.reason).toContain('API Key');

    await expect(provider.search('transformers')).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports both services unavailable through createExternalSearchProvider', () => {
    expect(
      createExternalSearchProvider({ service: 'tavily', apiKey: '' }).available,
    ).toBe(false);
    expect(
      createExternalSearchProvider({ service: 'brave', apiKey: '   ' }).available,
    ).toBe(false);
  });

  it('stays available (and quiet) when a key is present', () => {
    const provider = createTavilySearchProvider('tvly-key');

    expect(provider.available).toBe(true);
    expect(provider.reason).toBeUndefined();
  });
});

/* ---------------------------------- Tavily ---------------------------------- */

describe('Tavily provider', () => {
  it('posts to the documented endpoint with bearer auth and body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [] }));

    await createTavilySearchProvider('tvly-key').search('查询 with spaces');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = firstCall();
    expect(url).toBe('https://api.tavily.com/search');
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tvly-key');
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init?.body as string)).toEqual({
      query: '查询 with spaces',
      max_results: 5,
      search_depth: 'basic',
    });
  });

  it('trims a pasted key before using it', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [] }));

    await createTavilySearchProvider('  tvly-key\n').search('q');

    const headers = firstCall()[1]?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tvly-key');
  });

  it('maps results, falls back to the url for a missing title and drops url-less entries', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        results: [
          {
            title: 'Attention Is All You Need',
            url: 'https://arxiv.org/abs/1706.03762',
            content: 'Transformer 原始论文。',
          },
          { url: 'https://example.com/untitled', content: 'no title' },
          { title: '缺失链接', content: 'must be dropped' },
          { title: '无摘要', url: 'https://example.com/plain' },
        ],
      }),
    );

    const results = await createTavilySearchProvider('tvly-key').search(
      'transformer',
    );

    expect(results).toEqual([
      {
        title: 'Attention Is All You Need',
        url: 'https://arxiv.org/abs/1706.03762',
        snippet: 'Transformer 原始论文。',
      },
      {
        title: 'https://example.com/untitled',
        url: 'https://example.com/untitled',
        snippet: 'no title',
      },
      { title: '无摘要', url: 'https://example.com/plain' },
    ]);
  });
});

/* ----------------------------------- Brave ----------------------------------- */

describe('Brave provider', () => {
  it('gets the documented endpoint with the encoded query and subscription token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ web: { results: [] } }));

    await createBraveSearchProvider('brave-key').search('a b&c/d');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = firstCall();
    expect(url).toBe(
      'https://api.search.brave.com/res/v1/web/search?q=a%20b%26c%2Fd&count=5',
    );
    expect(init?.method).toBe('GET');
    const headers = init?.headers as Record<string, string>;
    expect(headers['Accept']).toBe('application/json');
    expect(headers['X-Subscription-Token']).toBe('brave-key');
  });

  it('maps web.results from description to snippet', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        web: {
          results: [
            {
              title: 'MDN Web Docs',
              url: 'https://developer.mozilla.org/',
              description: 'Web 平台文档。',
            },
            { url: 'https://example.com/no-title', description: 'untitled' },
            { title: '无链接', description: 'must be dropped' },
          ],
        },
      }),
    );

    const results = await createBraveSearchProvider('brave-key').search('mdn');

    expect(results).toEqual([
      {
        title: 'MDN Web Docs',
        url: 'https://developer.mozilla.org/',
        snippet: 'Web 平台文档。',
      },
      {
        title: 'https://example.com/no-title',
        url: 'https://example.com/no-title',
        snippet: 'untitled',
      },
    ]);
  });

  it('returns [] when the payload has no web.results', async () => {
    const payloads = [
      { query: { original: 'x' } },
      { web: {} },
      { web: { results: 'nope' } },
      { web: null },
      {},
    ];

    for (const payload of payloads) {
      fetchMock.mockResolvedValue(jsonResponse(payload));
      await expect(
        createBraveSearchProvider('brave-key').search('x'),
      ).resolves.toEqual([]);
    }
  });
});

/* -------------------------------- failure modes -------------------------------- */

describe('failure modes never throw and never fabricate results', () => {
  it.each([401, 429, 500])(
    'returns [] on HTTP %i without throwing or leaking the key',
    async (status) => {
      const consoleSpies = [
        vi.spyOn(console, 'error'),
        vi.spyOn(console, 'warn'),
        vi.spyOn(console, 'log'),
      ];
      for (const spy of consoleSpies) spy.mockImplementation(() => {});

      fetchMock.mockResolvedValue(jsonResponse({ error: 'nope' }, status));

      const provider = createTavilySearchProvider('tvly-super-secret');
      await expect(provider.search('q')).resolves.toEqual([]);

      // The key must not surface in a log line or on the provider object.
      for (const spy of consoleSpies) {
        for (const call of spy.mock.calls) {
          expect(JSON.stringify(call)).not.toContain('tvly-super-secret');
        }
      }
      expect(JSON.stringify(provider)).not.toContain('tvly-super-secret');
    },
  );

  it('returns [] when the request rejects (network error)', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(createTavilySearchProvider('k').search('q')).resolves.toEqual(
      [],
    );
    await expect(createBraveSearchProvider('k').search('q')).resolves.toEqual([]);
  });

  it('returns [] when the body is not valid JSON', async () => {
    fetchMock.mockResolvedValue(textResponse('<html>502 Bad Gateway</html>'));

    await expect(createTavilySearchProvider('k').search('q')).resolves.toEqual(
      [],
    );
    await expect(createBraveSearchProvider('k').search('q')).resolves.toEqual([]);
  });

  it.each([
    [null],
    [42],
    ['results'],
    [[]],
    [{ results: 'not-an-array' }],
    [{ results: [null, 1, 'x', { title: 'no url' }] }],
  ])('returns [] for a structurally wrong Tavily body (%s)', async (payload) => {
    fetchMock.mockResolvedValue(jsonResponse(payload));

    await expect(createTavilySearchProvider('k').search('q')).resolves.toEqual(
      [],
    );
  });

  it('returns [] when the response body is empty', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    await expect(createTavilySearchProvider('k').search('q')).resolves.toEqual(
      [],
    );
  });
});

/* ----------------------------------- abort ----------------------------------- */

describe('abort handling', () => {
  it('returns [] and does not fetch when the caller signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      createTavilySearchProvider('k').search('q', controller.signal),
    ).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns [] when the request is aborted mid-flight', async () => {
    fetchMock.mockImplementation(async () => {
      throw new DOMException('The operation was aborted.', 'AbortError');
    });

    await expect(createTavilySearchProvider('k').search('q')).resolves.toEqual(
      [],
    );
  });

  it('returns [] when the 10s deadline fires', async () => {
    fetchMock.mockImplementation(async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    });

    await expect(createBraveSearchProvider('k').search('q')).resolves.toEqual(
      [],
    );
  });

  it('hands fetch a signal merged from the caller signal and the deadline', async () => {
    const captured: { signal?: AbortSignal } = {};
    fetchMock.mockImplementation(async (_url, init) => {
      captured.signal = init?.signal ?? undefined;
      return jsonResponse({ results: [] });
    });

    const controller = new AbortController();
    await createTavilySearchProvider('k').search('q', controller.signal);

    expect(captured.signal).toBeDefined();
    // Not the raw caller signal — AbortSignal.any() merged in the timeout.
    expect(captured.signal).not.toBe(controller.signal);
    expect(captured.signal?.aborted).toBe(false);

    controller.abort();
    expect(captured.signal?.aborted).toBe(true);
  });
});

/* ------------------------------ endpoint URL guard ------------------------------ */

describe('endpoint URL guard', () => {
  const blockedEndpoints = [
    'http://127.0.0.1:8080/search',
    'http://127.1/search',
    'http://2130706433/search', // decimal loopback
    'http://0x7f000001/search', // hex loopback
    'http://0177.0.0.1/search', // octal loopback
    'http://localhost/search',
    'http://LOCALHOST/search',
    'http://localhost./search',
    'http://sub.localhost/search',
    'http://[::1]/search',
    'http://[0:0:0:0:0:0:0:1]/search',
    'http://[::]/search',
    'http://[::ffff:127.0.0.1]/search',
    'http://[::ffff:7f00:1]/search', // the canonical form the URL parser produces
    'http://[64:ff9b::7f00:1]/search', // NAT64 to loopback
    'http://[2002:7f00:1::]/search', // 6to4 wrapping loopback
    'http://[2001:db8::1]/search', // documentation range
    'http://[fe80::1%25eth0]/search',
    'http://10.1.2.3/search',
    'http://172.16.0.1/search',
    'http://172.31.255.254/search',
    'http://192.168.1.1/search',
    'http://169.254.169.254/latest/meta-data/', // cloud metadata
    'http://0.0.0.0/search',
    'http://100.64.0.1/search',
    'http://[fd12:3456::1]/search',
    'http://[fe80::1]/search',
    'http://printer.local/search',
    'http://metadata.internal/search',
    'http://host.home.arpa/search',
    'file:///etc/passwd',
    'ftp://192.168.1.1/search',
    'https://user:pw@api.tavily.com/search',
    'not a url at all',
  ];

  it.each(blockedEndpoints)(
    'refuses to fetch %s and reports no results',
    async (endpoint) => {
      const provider = createTavilySearchProvider('k', endpoint);

      await expect(provider.search('q')).resolves.toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('guards the Brave endpoint too', async () => {
    await expect(
      createBraveSearchProvider('k', 'http://192.168.0.10/x').search('q'),
    ).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still sends the request for the public https endpoints', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [] }));
    await createTavilySearchProvider('k', 'https://api.tavily.com/search').search(
      'q',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValue(jsonResponse({ web: { results: [] } }));
    await createBraveSearchProvider(
      'k',
      'https://api.search.brave.com/res/v1/web/search',
    ).search('q');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    'http://example.com/',
    'https://sub.example.co.uk/path?q=1',
    'http://93.184.216.34/',
    'https://[2606:4700:4700::1111]/dns-query',
  ])('does not over-block the public endpoint %s', async (endpoint) => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [] }));

    await createTavilySearchProvider('k', endpoint).search('q');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

/* ---------------------------------- dispatch ---------------------------------- */

describe('createExternalSearchProvider', () => {
  it('builds the Tavily provider for service "tavily"', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [] }));

    const provider = createExternalSearchProvider({
      service: 'tavily',
      apiKey: 'key',
    });
    await provider.search('q');

    expect(provider.id).toBe('external:tavily');
    expect(firstCall()[0]).toBe('https://api.tavily.com/search');
  });

  it('builds the Brave provider for service "brave"', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ web: { results: [] } }));

    const provider = createExternalSearchProvider({
      service: 'brave',
      apiKey: 'key',
    });
    await provider.search('q');

    expect(provider.id).toBe('external:brave');
    expect(firstCall()[0]).toBe(
      'https://api.search.brave.com/res/v1/web/search?q=q&count=5',
    );
  });

  it('stays honest for an unknown persisted service', async () => {
    const provider = createExternalSearchProvider({
      service: 'duckduckgo' as unknown as ExternalSearchService,
      apiKey: 'key',
    });

    expect(provider.id).toBe('external:unknown');
    expect(provider.available).toBe(false);
    expect(provider.reason).toBeTruthy();
    await expect(provider.search('q')).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});