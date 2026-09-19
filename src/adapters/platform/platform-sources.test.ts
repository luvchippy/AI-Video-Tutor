import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  matchSubtitleSource,
  fetchPlatformSubtitles,
  PLATFORM_SUBTITLE_SOURCES,
} from './platform-sources';

/* ------------------------------- fixtures -------------------------------- */

const YOUTUBE_HTML = `<script>var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[{"baseUrl":"https://www.youtube.com/api/timedtext?v=abc&lang=en","languageCode":"en"}]}}};</script>`;

const YOUTUBE_HTML_ASR_FIRST = `<script>var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[{"baseUrl":"https://www.youtube.com/api/timedtext?v=abc&kind=asr","languageCode":"en","kind":"asr"},{"baseUrl":"https://www.youtube.com/api/timedtext?v=abc&lang=zh-Hans","languageCode":"zh-Hans"}]}}};</script>`;

const TIMEDTEXT_XML =
  '<transcript><text start="0" dur="2.5">Hello &amp; welcome</text><text start="2.5" dur="1.5">Second line</text></transcript>';

const BILIBILI_VIEW = {
  code: 0,
  data: { aid: 111, cid: 222, title: '标题', owner: { mid: 333, name: 'UP主' } },
};

const BILIBILI_PLAYER = {
  code: 0,
  data: {
    subtitle: {
      subtitles: [
        { lan: 'zh-CN', subtitle_url: '//aisubtitle.hdslb.com/bfs/subtitle/x.json' },
      ],
    },
  },
};

const BILIBILI_SUBTITLE_JSON = {
  body: [
    { from: 0.5, to: 3.2, content: '第一句' },
    { from: 3.2, to: 4.8, content: '第二句' },
  ],
};

function textResponse(body: string) {
  return { ok: true, text: async () => body };
}

function jsonResponse(body: unknown) {
  return { ok: true, text: async () => JSON.stringify(body) };
}

function errorResponse() {
  return { ok: false, text: async () => 'denied' };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/* --------------------------------- tests ---------------------------------- */

describe('matchSubtitleSource', () => {
  it('resolves the platform by host and rejects everything else', () => {
    expect(matchSubtitleSource('www.youtube.com')?.id).toBe('youtube');
    expect(matchSubtitleSource('youtu.be')?.id).toBe('youtube');
    expect(matchSubtitleSource('www.bilibili.com')?.id).toBe('bilibili');
    expect(matchSubtitleSource('b23.tv')?.id).toBe('bilibili');
    expect(matchSubtitleSource('example.com')).toBeNull();
    // A lookalike host must not match: the suffix check needs the dot.
    expect(matchSubtitleSource('notyoutube.com')).toBeNull();
    expect(matchSubtitleSource('youtube.com.evil.com')).toBeNull();
  });

  it('registers each platform once', () => {
    const ids = PLATFORM_SUBTITLE_SOURCES.map((source) => source.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('fetchPlatformSubtitles dispatch', () => {
  it('makes no request for an unsupported site', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchPlatformSubtitles('https://example.com/watch?v=1');

    expect(result.segments).toEqual([]);
    expect(result.note).toContain('没有平台字幕适配器');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports an unparseable page URL instead of throwing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchPlatformSubtitles('not a url');

    expect(result.segments).toEqual([]);
    expect(result.note).toContain('无法解析');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('fetchPlatformSubtitles — YouTube', () => {
  it('reads the watch page, then the timedtext URL it names', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(textResponse(YOUTUBE_HTML))
      .mockResolvedValueOnce(textResponse(TIMEDTEXT_XML));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchPlatformSubtitles(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]![0])).toContain(
      '/watch?v=dQw4w9WgXcQ',
    );
    expect(fetchMock.mock.calls[1]![0]).toBe(
      'https://www.youtube.com/api/timedtext?v=abc&lang=en',
    );
    expect(result.segments).toEqual([
      { start: 0, end: 2.5, text: 'Hello & welcome', source: 'platform' },
      { start: 2.5, end: 4, text: 'Second line', source: 'platform' },
    ]);
    expect(result.note).toContain('YouTube');
    expect(result.note).toContain('2 条字幕');
  });

  it('sends an anonymous request (no cookies) to the platform', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(textResponse(YOUTUBE_HTML))
      .mockResolvedValueOnce(textResponse(TIMEDTEXT_XML));
    vi.stubGlobal('fetch', fetchMock);

    await fetchPlatformSubtitles('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    for (const call of fetchMock.mock.calls) {
      expect(call[1]).toMatchObject({ credentials: 'omit' });
    }
  });

  it('prefers a hand-written track over the auto-generated one', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(textResponse(YOUTUBE_HTML_ASR_FIRST))
      .mockResolvedValueOnce(textResponse(TIMEDTEXT_XML));
    vi.stubGlobal('fetch', fetchMock);

    await fetchPlatformSubtitles('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    // The ASR track is listed first; the manual one must win.
    expect(String(fetchMock.mock.calls[1]![0])).toContain('lang=zh-Hans');
    expect(String(fetchMock.mock.calls[1]![0])).not.toContain('kind=asr');
  });

  it('falls back to the ASR track when it is the only one', async () => {
    const asrOnly = `<script>var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[{"baseUrl":"https://www.youtube.com/api/timedtext?v=abc&kind=asr","languageCode":"en","kind":"asr"}]}}};</script>`;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(textResponse(asrOnly))
      .mockResolvedValueOnce(textResponse(TIMEDTEXT_XML));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchPlatformSubtitles(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    );

    expect(result.segments).toHaveLength(2);
    expect(result.note).toContain('自动生成');
  });

  it('reports a network failure without inventing captions', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchPlatformSubtitles(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    );

    expect(result.segments).toEqual([]);
    expect(result.note).toContain('抓取 YouTube 页面失败');
  });

  it('reports a non-2xx watch page as a failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse());
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchPlatformSubtitles(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    );

    expect(result.segments).toEqual([]);
    expect(result.note).toContain('失败');
  });

  it('reports a page with no caption tracks instead of a silent empty result', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(textResponse('<html>consent</html>'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchPlatformSubtitles(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    );

    expect(result.segments).toEqual([]);
    expect(result.note).toContain('未找到字幕轨');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports timedtext that is not the XML form the parser handles', async () => {
    const srV3 = '<timedtext><body><p t="0" d="1000">hi</p></body></timedtext>';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(textResponse(YOUTUBE_HTML))
      .mockResolvedValueOnce(textResponse(srV3));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchPlatformSubtitles(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    );

    expect(result.segments).toEqual([]);
    expect(result.note).toContain('无法解析');
  });

  it('reports an unrecognisable video URL without requesting anything', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchPlatformSubtitles('https://www.youtube.com/feed/subscriptions');

    expect(result.segments).toEqual([]);
    expect(result.note).toContain('视频 ID');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a caption URL the page says points at a private address', async () => {
    // The caption URL is remote data: a payload that names loopback or a
    // private range is not a caption file, and must not be requested.
    const hostile = `<script>var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[{"baseUrl":"http://127.0.0.1:8080/timedtext?v=abc","languageCode":"en"}]}}};</script>`;
    const fetchMock = vi.fn().mockResolvedValueOnce(textResponse(hostile));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchPlatformSubtitles(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    );

    expect(result.segments).toEqual([]);
    expect(result.note).toContain('下载字幕内容失败');
    // Only the watch page was fetched; the private-address URL was refused.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('fetchPlatformSubtitles — Bilibili', () => {
  it('walks view -> player/v2 -> subtitle JSON', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(BILIBILI_VIEW))
      .mockResolvedValueOnce(jsonResponse(BILIBILI_PLAYER))
      .mockResolvedValueOnce(jsonResponse(BILIBILI_SUBTITLE_JSON));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchPlatformSubtitles(
      'https://www.bilibili.com/video/BV1xx411c7mD',
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0]![0])).toContain('bvid=BV1xx411c7mD');
    expect(String(fetchMock.mock.calls[1]![0])).toContain('aid=111');
    expect(String(fetchMock.mock.calls[1]![0])).toContain('cid=222');
    // The protocol-relative subtitle_url is completed to https before fetching.
    expect(fetchMock.mock.calls[2]![0]).toBe(
      'https://aisubtitle.hdslb.com/bfs/subtitle/x.json',
    );
    expect(result.segments).toEqual([
      { start: 0.5, end: 3.2, text: '第一句', source: 'platform' },
      { start: 3.2, end: 4.8, text: '第二句', source: 'platform' },
    ]);
    expect(result.note).toContain('Bilibili');
    expect(result.note).toContain('zh-CN');
  });

  it('explains that a b23.tv short link must be resolved first', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchPlatformSubtitles('https://b23.tv/aBcDeFg');

    expect(result.segments).toEqual([]);
    expect(result.note).toContain('BV 号');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a non-zero API code instead of an empty success', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ code: -404, message: 'not found' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchPlatformSubtitles(
      'https://www.bilibili.com/video/BV1xx411c7mD',
    );

    expect(result.segments).toEqual([]);
    expect(result.note).toContain('视频信息接口');
  });

  it('reports a video whose subtitle list is empty', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(BILIBILI_VIEW))
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { subtitle: { subtitles: [] } } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchPlatformSubtitles(
      'https://www.bilibili.com/video/BV1xx411c7mD',
    );

    expect(result.segments).toEqual([]);
    expect(result.note).toContain('没有可读取的字幕');
  });

  it('reports a video whose subtitle track has no fetchable URL', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(BILIBILI_VIEW))
      .mockResolvedValueOnce(
        jsonResponse({ code: 0, data: { subtitle: { subtitles: [{ lan: 'zh-CN' }] } } }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchPlatformSubtitles(
      'https://www.bilibili.com/video/BV1xx411c7mD',
    );

    expect(result.segments).toEqual([]);
    expect(result.note).toContain('没有可读取的字幕');
  });

  it('reports a subtitle body that cannot be parsed', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(BILIBILI_VIEW))
      .mockResolvedValueOnce(jsonResponse(BILIBILI_PLAYER))
      .mockResolvedValueOnce(textResponse('<html>error</html>'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchPlatformSubtitles(
      'https://www.bilibili.com/video/BV1xx411c7mD',
    );

    expect(result.segments).toEqual([]);
    expect(result.note).toContain('无法解析');
  });

  it('refuses a subtitle_url pointing at a private address', async () => {
    const hostilePlayer = {
      code: 0,
      data: {
        subtitle: {
          subtitles: [{ lan: 'zh-CN', subtitle_url: 'http://192.168.1.10/x.json' }],
        },
      },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(BILIBILI_VIEW))
      .mockResolvedValueOnce(jsonResponse(hostilePlayer));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchPlatformSubtitles(
      'https://www.bilibili.com/video/BV1xx411c7mD',
    );

    expect(result.segments).toEqual([]);
    expect(result.note).toContain('无法解析');
    // view + player/v2 were fetched; the private-address subtitle URL was not.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});