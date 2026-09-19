/**
 * Unit tests for the pure Bilibili parsers.
 *
 * The suite runs in the node environment (no DOM, no network), which is
 * exactly the contract of the module: strings in, values out.
 */

import { describe, it, expect } from 'vitest';
import {
  buildPlayerApiUrl,
  buildSubtitleJsonUrl,
  buildViewApiUrl,
  extractBvid,
  matchesHost,
  parsePlayerApiResponse,
  parseSubtitleJson,
  parseViewApiResponse,
  pickCreator,
} from './bilibili';

const BVID = 'BV1xx411c7mD';

/** A realistic-ish `x/web-interface/view` response, with extra fields around. */
const VIEW_RESPONSE = {
  code: 0,
  message: '0',
  ttl: 1,
  data: {
    bvid: BVID,
    aid: 112233445,
    videos: 2,
    cid: 667788990,
    title: '一个标题',
    pic: 'http://i0.hdslb.com/bfs/archive/x.jpg',
    owner: { mid: 99887766, name: '某UP主', face: 'http://i0.hdslb.com/x.jpg' },
    pages: [
      { cid: 667788990, page: 1, part: 'P1' },
      { cid: 111222333, page: 2, part: 'P2' },
    ],
  },
};

/** A realistic-ish `x/player/v2` response; the URLs are protocol-relative. */
const PLAYER_RESPONSE = {
  code: 0,
  data: {
    subtitle: {
      allow_submit: false,
      subtitles: [
        {
          id: 1,
          lan: 'zh-CN',
          lan_doc: '中文（简体）',
          subtitle_url: '//aisubtitle.hdslb.com/bfs/subtitle/zh.json',
        },
        {
          id: 2,
          lan: 'ai-zh',
          lan_doc: '中文（自动生成）',
          subtitle_url: '//aisubtitle.hdslb.com/bfs/subtitle/ai.json',
        },
      ],
    },
  },
};

/** A realistic-ish subtitle JSON payload (extra keys ignored). */
const SUBTITLE_JSON = {
  font_size: 0.4,
  font_color: '#FFFFFF',
  body: [
    { from: 0.5, to: 3.2, location: 2, content: '第一句' },
    { from: 3.2, to: 6, location: 2, content: ' second line ' },
  ],
};

describe('matchesHost', () => {
  it('matches the bare Bilibili domains', () => {
    expect(matchesHost('bilibili.com')).toBe(true);
    expect(matchesHost('b23.tv')).toBe(true);
  });

  it('matches subdomains', () => {
    expect(matchesHost('www.bilibili.com')).toBe(true);
    expect(matchesHost('m.bilibili.com')).toBe(true);
    expect(matchesHost('space.bilibili.com')).toBe(true);
    expect(matchesHost('api.bilibili.com')).toBe(true);
    expect(matchesHost('www.b23.tv')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(matchesHost('WWW.BiliBili.COM')).toBe(true);
    expect(matchesHost('B23.TV')).toBe(true);
  });

  it('rejects look-alike hosts', () => {
    expect(matchesHost('notbilibili.com')).toBe(false);
    expect(matchesHost('bilibili.com.evil.com')).toBe(false);
    expect(matchesHost('b23.tv.evil.com')).toBe(false);
    expect(matchesHost('evb23.tv')).toBe(false);
    expect(matchesHost('xb23.tv')).toBe(false);
    expect(matchesHost('bilibili.co')).toBe(false);
    expect(matchesHost('')).toBe(false);
    expect(matchesHost('   ')).toBe(false);
  });
});

describe('extractBvid', () => {
  it('reads the canonical /video/BVxxxxxxx url', () => {
    expect(extractBvid(`https://www.bilibili.com/video/${BVID}`)).toBe(BVID);
    expect(extractBvid(`https://bilibili.com/video/${BVID}`)).toBe(BVID);
    expect(extractBvid(`https://m.bilibili.com/video/${BVID}`)).toBe(BVID);
  });

  it('ignores the query string', () => {
    expect(extractBvid(`https://www.bilibili.com/video/${BVID}?p=1`)).toBe(BVID);
    expect(extractBvid(`https://www.bilibili.com/video/${BVID}?p=2&t=30`)).toBe(BVID);
    expect(
      extractBvid(`https://www.bilibili.com/video/${BVID}/?spm_id_from=333.999.0.0`),
    ).toBe(BVID);
  });

  it('ignores the fragment and a trailing slash', () => {
    expect(extractBvid(`https://www.bilibili.com/video/${BVID}#reply`)).toBe(BVID);
    expect(extractBvid(`https://www.bilibili.com/video/${BVID}/`)).toBe(BVID);
  });

  it('accepts the protocol-relative share form', () => {
    expect(extractBvid(`//www.bilibili.com/video/${BVID}`)).toBe(BVID);
  });

  it('accepts a path-only value, as read from location.pathname', () => {
    expect(extractBvid(`/video/${BVID}`)).toBe(BVID);
    expect(extractBvid(`/video/${BVID}?p=1`)).toBe(BVID);
  });

  it('prefers the segment right after /video/', () => {
    expect(extractBvid(`https://www.bilibili.com/video/${BVID}/reply/BV1999999999`)).toBe(BVID);
  });

  it('falls back to ?bvid= for pages whose id is only in the query', () => {
    expect(extractBvid(`https://www.bilibili.com/list/watchlater?bvid=${BVID}`)).toBe(BVID);
    expect(extractBvid(`https://www.bilibili.com/medialist/play/ml1?bvid=${BVID}&oid=2`)).toBe(BVID);
  });

  it('returns null for an opaque b23.tv short code, which needs a redirect', () => {
    expect(extractBvid('https://b23.tv/aBcDeFg')).toBeNull();
    expect(extractBvid('https://b23.tv/abc123')).toBeNull();
  });

  it('still takes a real BV id that a b23.tv path happens to carry', () => {
    expect(extractBvid(`https://b23.tv/${BVID}`)).toBe(BVID);
  });

  it('normalizes only a lowercase BV prefix, never the case-sensitive body', () => {
    expect(extractBvid('https://www.bilibili.com/video/bv1xx411c7md')).toBe('BV1xx411c7md');
    expect(extractBvid('https://www.bilibili.com/video/Bv1xx411c7mD')).toBe('BV1xx411c7mD');
  });

  it('does not pin the id length, but rejects an empty body', () => {
    expect(extractBvid('https://www.bilibili.com/video/BV1')).toBe('BV1');
    expect(extractBvid('https://www.bilibili.com/video/BV')).toBeNull();
    expect(extractBvid('https://www.bilibili.com/video/bv')).toBeNull();
  });

  it('does not convert the legacy numeric av form', () => {
    expect(extractBvid('https://www.bilibili.com/video/av12345')).toBeNull();
  });

  it('returns null for non-Bilibili hosts, id-less urls and junk', () => {
    expect(extractBvid(`https://www.youtube.com/video/${BVID}`)).toBeNull();
    expect(extractBvid(`https://notbilibili.com/video/${BVID}`)).toBeNull();
    expect(extractBvid(`https://bilibili.com.evil.com/video/${BVID}`)).toBeNull();
    expect(extractBvid('https://www.bilibili.com/')).toBeNull();
    expect(extractBvid('https://www.bilibili.com/video/')).toBeNull();
    expect(extractBvid('https://www.bilibili.com/video/av12345?p=1')).toBeNull();
    expect(extractBvid('not a url')).toBeNull();
    expect(extractBvid('javascript:alert(1)')).toBeNull();
    expect(extractBvid('')).toBeNull();
  });

  it('round-trips with buildViewApiUrl', () => {
    expect(buildViewApiUrl(BVID)).toBe(
      'https://api.bilibili.com/x/web-interface/view?bvid=BV1xx411c7mD',
    );
    expect(extractBvid(`https://www.bilibili.com/video/${BVID}`)).toBe(BVID);
  });
});

describe('buildViewApiUrl', () => {
  it('builds the documented view url', () => {
    expect(buildViewApiUrl(BVID)).toBe(
      'https://api.bilibili.com/x/web-interface/view?bvid=BV1xx411c7mD',
    );
    expect(buildViewApiUrl('  BV1xx411c7mD  ')).toBe(
      'https://api.bilibili.com/x/web-interface/view?bvid=BV1xx411c7mD',
    );
  });

  it('percent-encodes the id and stays well-formed for junk input', () => {
    expect(buildViewApiUrl('BV 1')).toBe(
      'https://api.bilibili.com/x/web-interface/view?bvid=BV%201',
    );
    // Total function: an empty id still yields a well-formed URL.
    expect(buildViewApiUrl('')).toBe('https://api.bilibili.com/x/web-interface/view?bvid=');
    expect(buildViewApiUrl(null as unknown as string)).toBe(
      'https://api.bilibili.com/x/web-interface/view?bvid=',
    );
  });
});

describe('buildPlayerApiUrl', () => {
  it('builds the documented player url', () => {
    expect(buildPlayerApiUrl(112233445, 667788990)).toBe(
      'https://api.bilibili.com/x/player/v2?aid=112233445&cid=667788990',
    );
    expect(buildPlayerApiUrl(0, 0)).toBe('https://api.bilibili.com/x/player/v2?aid=0&cid=0');
  });

  it('collapses a non-finite argument instead of emitting NaN', () => {
    expect(buildPlayerApiUrl(Number.NaN, Number.POSITIVE_INFINITY)).toBe(
      'https://api.bilibili.com/x/player/v2?aid=&cid=',
    );
    expect(buildPlayerApiUrl(undefined as unknown as number, 5)).toBe(
      'https://api.bilibili.com/x/player/v2?aid=&cid=5',
    );
  });
});

describe('buildSubtitleJsonUrl', () => {
  it('completes a protocol-relative subtitle url with https:', () => {
    expect(buildSubtitleJsonUrl('//aisubtitle.hdslb.com/bfs/subtitle/x.json')).toBe(
      'https://aisubtitle.hdslb.com/bfs/subtitle/x.json',
    );
    expect(buildSubtitleJsonUrl('  //aisubtitle.hdslb.com/a.json  ')).toBe(
      'https://aisubtitle.hdslb.com/a.json',
    );
  });

  it('returns an already-absolute url verbatim (idempotent)', () => {
    const https = 'https://aisubtitle.hdslb.com/bfs/subtitle/x.json';
    const http = 'http://aisubtitle.hdslb.com/bfs/subtitle/x.json?sign=abc';
    expect(buildSubtitleJsonUrl(https)).toBe(https);
    expect(buildSubtitleJsonUrl(http)).toBe(http);
    expect(buildSubtitleJsonUrl(buildSubtitleJsonUrl('//a.hdslb.com/x.json'))).toBe(
      'https://a.hdslb.com/x.json',
    );
  });

  it('collapses an empty or unusable value to the empty string', () => {
    expect(buildSubtitleJsonUrl('')).toBe('');
    expect(buildSubtitleJsonUrl('   ')).toBe('');
    expect(buildSubtitleJsonUrl('/bfs/subtitle/x.json')).toBe('');
    expect(buildSubtitleJsonUrl('aisubtitle.hdslb.com/x.json')).toBe('');
    expect(buildSubtitleJsonUrl('javascript:alert(1)')).toBe('');
    expect(buildSubtitleJsonUrl(null as unknown as string)).toBe('');
  });
});

describe('parseViewApiResponse', () => {
  it('reads aid, cid, title and owner', () => {
    expect(parseViewApiResponse(VIEW_RESPONSE)).toEqual({
      aid: 112233445,
      cid: 667788990,
      title: '一个标题',
      ownerName: '某UP主',
      ownerMid: 99887766,
    });
  });

  it('returns null for a non-zero code', () => {
    for (const code of [-400, -404, -403, 62002, 1]) {
      expect(parseViewApiResponse({ ...VIEW_RESPONSE, code })).toBeNull();
    }
    // A missing code is not the documented shape either.
    expect(parseViewApiResponse({ data: VIEW_RESPONSE.data })).toBeNull();
    expect(parseViewApiResponse({ code: '0', data: VIEW_RESPONSE.data })).toBeNull();
  });

  it('returns null when data is missing or not an object', () => {
    expect(parseViewApiResponse({ code: 0 })).toBeNull();
    expect(parseViewApiResponse({ code: 0, data: null })).toBeNull();
    expect(parseViewApiResponse({ code: 0, data: [] })).toBeNull();
    expect(parseViewApiResponse({ code: 0, data: 'nope' })).toBeNull();
  });

  it('returns null when aid or cid is missing or not a finite number', () => {
    const data = VIEW_RESPONSE.data;
    expect(parseViewApiResponse({ code: 0, data: { ...data, aid: undefined } })).toBeNull();
    expect(parseViewApiResponse({ code: 0, data: { ...data, cid: undefined } })).toBeNull();
    expect(parseViewApiResponse({ code: 0, data: { ...data, aid: '112233445' } })).toBeNull();
    expect(parseViewApiResponse({ code: 0, data: { ...data, cid: Number.NaN } })).toBeNull();
    expect(parseViewApiResponse({ code: 0, data: { aid: 1 } })).toBeNull();
  });

  it('nulls the optional fields instead of failing', () => {
    expect(parseViewApiResponse({ code: 0, data: { aid: 1, cid: 2 } })).toEqual({
      aid: 1,
      cid: 2,
      title: null,
      ownerName: null,
      ownerMid: null,
    });
    expect(
      parseViewApiResponse({ code: 0, data: { aid: 1, cid: 2, title: '   ', owner: {} } }),
    ).toEqual({ aid: 1, cid: 2, title: null, ownerName: null, ownerMid: null });
    expect(
      parseViewApiResponse({
        code: 0,
        data: { aid: 1, cid: 2, title: 42, owner: { mid: '9', name: [] } },
      }),
    ).toEqual({ aid: 1, cid: 2, title: null, ownerName: null, ownerMid: null });
  });

  it('never throws on malformed input', () => {
    for (const value of [null, undefined, 'code 0', 0, [], {}, true, () => 1]) {
      expect(() => parseViewApiResponse(value)).not.toThrow();
      expect(parseViewApiResponse(value)).toBeNull();
    }
  });
});

describe('parsePlayerApiResponse', () => {
  it('reads every subtitle track and normalizes its url', () => {
    expect(parsePlayerApiResponse(PLAYER_RESPONSE)).toEqual([
      { subtitleUrl: 'https://aisubtitle.hdslb.com/bfs/subtitle/zh.json', language: 'zh-CN' },
      { subtitleUrl: 'https://aisubtitle.hdslb.com/bfs/subtitle/ai.json', language: 'ai-zh' },
    ]);
  });

  it('returns [] when subtitle or subtitles is missing or the wrong type', () => {
    expect(parsePlayerApiResponse({ code: 0, data: {} })).toEqual([]);
    expect(parsePlayerApiResponse({ code: 0, data: { subtitle: null } })).toEqual([]);
    expect(parsePlayerApiResponse({ code: 0, data: { subtitle: {} } })).toEqual([]);
    expect(parsePlayerApiResponse({ code: 0, data: { subtitle: { subtitles: {} } } })).toEqual([]);
    expect(parsePlayerApiResponse({ code: 0, data: { subtitle: { subtitles: 'none' } } })).toEqual(
      [],
    );
    expect(parsePlayerApiResponse({ code: 0, data: null })).toEqual([]);
    expect(parsePlayerApiResponse({ code: 0 })).toEqual([]);
  });

  it('returns [] for an error response and for junk input', () => {
    expect(parsePlayerApiResponse({ ...PLAYER_RESPONSE, code: -403 })).toEqual([]);
    expect(parsePlayerApiResponse({ data: PLAYER_RESPONSE.data })).toEqual([]);
    for (const value of [null, undefined, 'x', 7, [], {}, true]) {
      expect(() => parsePlayerApiResponse(value)).not.toThrow();
      expect(parsePlayerApiResponse(value)).toEqual([]);
    }
  });

  it('keeps an entry whose subtitle_url is unusable when it still names a language', () => {
    const json = {
      code: 0,
      data: {
        subtitle: {
          subtitles: [{ lan: 'zh-CN', lan_doc: '中文（简体）' }, { lan: 'en-US', subtitle_url: '' }],
        },
      },
    };
    expect(parsePlayerApiResponse(json)).toEqual([
      { subtitleUrl: null, language: 'zh-CN' },
      { subtitleUrl: null, language: 'en-US' },
    ]);
  });

  it('drops entries and non-object members that carry no information', () => {
    const json = {
      code: 0,
      data: {
        subtitle: {
          subtitles: [
            null,
            42,
            'nope',
            {},
            { lan: '  ' },
            { subtitle_url: 'javascript:alert(1)' },
            { lan: 'zh-CN', subtitle_url: '//a.hdslb.com/keep.json' },
          ],
        },
      },
    };
    expect(parsePlayerApiResponse(json)).toEqual([
      { subtitleUrl: 'https://a.hdslb.com/keep.json', language: 'zh-CN' },
    ]);
  });
});

describe('parseSubtitleJson', () => {
  it('maps body cues onto normalized segments', () => {
    expect(parseSubtitleJson(SUBTITLE_JSON)).toEqual([
      { start: 0.5, end: 3.2, text: '第一句', source: 'platform' },
      { start: 3.2, end: 6, text: 'second line', source: 'platform' },
    ]);
  });

  it('tags every cue with the platform subtitle source', () => {
    const segments = parseSubtitleJson(SUBTITLE_JSON);
    expect(segments.every((segment) => segment.source === 'platform')).toBe(true);
  });

  it('returns cues sorted ascending by start', () => {
    const json = {
      body: [
        { from: 9, to: 10, content: 'third' },
        { from: 1, to: 2, content: 'first' },
        { from: 5, to: 6, content: 'second' },
      ],
    };
    expect(parseSubtitleJson(json).map((segment) => segment.text)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  it('skips cues whose span is inverted, empty or not a finite number', () => {
    const json = {
      body: [
        { from: 2, to: 2, content: 'zero length' },
        { from: 3, to: 1, content: 'inverted' },
        { from: '1', to: 2, content: 'string from' },
        { from: 1, to: null, content: 'null to' },
        { from: Number.NaN, to: 5, content: 'NaN from' },
        { from: 6, to: Number.POSITIVE_INFINITY, content: 'infinite to' },
        { from: 7, to: 8, content: 'kept' },
      ],
    };
    expect(parseSubtitleJson(json).map((segment) => segment.text)).toEqual(['kept']);
  });

  it('skips cues whose content is empty after trimming', () => {
    const json = {
      body: [
        { from: 1, to: 2, content: '' },
        { from: 2, to: 3, content: '   ' },
        { from: 3, to: 4, content: '\n\t' },
        { from: 4, to: 5 },
        { from: 5, to: 6, content: 123 },
        { from: 6, to: 7, content: ' ok ' },
      ],
    };
    expect(parseSubtitleJson(json)).toEqual([
      { start: 6, end: 7, text: 'ok', source: 'platform' },
    ]);
  });

  it('returns [] when body is missing or not an array', () => {
    expect(parseSubtitleJson({})).toEqual([]);
    expect(parseSubtitleJson({ body: null })).toEqual([]);
    expect(parseSubtitleJson({ body: {} })).toEqual([]);
    expect(parseSubtitleJson({ body: 'nope' })).toEqual([]);
    expect(parseSubtitleJson({ body: [] })).toEqual([]);
  });

  it('skips non-object members and never throws on malformed input', () => {
    expect(parseSubtitleJson({ body: [null, 42, 'x', []] })).toEqual([]);
    for (const value of [null, undefined, 'body', 0, [], {}, true]) {
      expect(() => parseSubtitleJson(value)).not.toThrow();
      expect(parseSubtitleJson(value)).toEqual([]);
    }
  });
});

describe('pickCreator', () => {
  it('reads the head metadata name and the uploader space link', () => {
    const meta = {
      'meta[name=author]': '某UP主',
      'a[href*="space.bilibili.com"]': '//space.bilibili.com/99887766',
    };
    expect(pickCreator(meta)).toEqual({
      name: '某UP主',
      url: 'https://space.bilibili.com/99887766',
    });
  });

  it('falls back through the meta keys and the rendered DOM keys', () => {
    expect(pickCreator({ 'meta[itemprop=author]': 'From itemprop' })).toEqual({
      name: 'From itemprop',
      url: null,
    });
    expect(pickCreator({ '[itemprop=author] [itemprop=name]': 'From schema' })).toEqual({
      name: 'From schema',
      url: null,
    });
    expect(pickCreator({ '#v_upinfo .username': 'From upinfo' })).toEqual({
      name: 'From upinfo',
      url: null,
    });
    expect(pickCreator({ 'a.up-name': 'From up-name' })).toEqual({
      name: 'From up-name',
      url: null,
    });
  });

  it('prefers the head metadata over the DOM fallbacks', () => {
    const meta = {
      'meta[name=author]': 'Specific',
      '#v_upinfo .username': 'Rendered later',
    };
    expect(pickCreator(meta)?.name).toBe('Specific');
  });

  it('reads the url from its own key priorities', () => {
    expect(
      pickCreator({ 'meta[name=author]': 'C', '[itemprop=author] [itemprop=url]': '//space.bilibili.com/1' })
        ?.url,
    ).toBe('https://space.bilibili.com/1');
    expect(pickCreator({ 'meta[name=author]': 'C', '#v_upinfo a.username': '//space.bilibili.com/2' })?.url).toBe(
      'https://space.bilibili.com/2',
    );
  });

  it('does not mistake the video title for the creator', () => {
    // `<h1 class="video-title" title=...>` carries the VIDEO title.
    expect(pickCreator({ 'h1[title]': '某个视频标题' })).toBeNull();
  });

  it('ignores empty, whitespace-only and non-string values', () => {
    const meta = {
      'meta[name=author]': '   ',
      'meta[itemprop=author]': 42 as unknown as string,
      '#v_upinfo .username': 'Real uploader',
    };
    expect(pickCreator(meta)).toEqual({ name: 'Real uploader', url: null });
  });

  it('returns null when no name can be read', () => {
    expect(pickCreator({})).toBeNull();
    expect(pickCreator({ 'meta[name=author]': '  ' })).toBeNull();
    expect(pickCreator({ 'a[href*="space.bilibili.com"]': '//space.bilibili.com/1' })).toBeNull();
  });

  it('normalizes root-relative urls and drops unusable ones', () => {
    expect(
      pickCreator({ 'meta[name=author]': 'C', '#v_upinfo a.username': '/space/1' })?.url,
    ).toBe('https://www.bilibili.com/space/1');
    expect(
      pickCreator({ 'meta[name=author]': 'C', 'a[href*="space.bilibili.com"]': 'not a url' })?.url,
    ).toBeNull();
    expect(
      pickCreator({ 'meta[name=author]': 'C', 'a[href*="space.bilibili.com"]': ' ' })?.url,
    ).toBeNull();
  });
});

describe('robustness', () => {
  const junk = ['', null, undefined, 0, NaN, {}, [], true] as readonly unknown[];

  it('never throws on empty or null-style input', () => {
    for (const value of junk) {
      expect(() => matchesHost(value as unknown as string)).not.toThrow();
      expect(() => extractBvid(value as unknown as string)).not.toThrow();
      expect(() => buildViewApiUrl(value as unknown as string)).not.toThrow();
      expect(() => buildPlayerApiUrl(value as unknown as number, value as unknown as number)).not.toThrow();
      expect(() => buildSubtitleJsonUrl(value as unknown as string)).not.toThrow();
      expect(() => pickCreator(value as unknown as Record<string, string | undefined>)).not.toThrow();
      expect(() => parseViewApiResponse(value)).not.toThrow();
      expect(() => parsePlayerApiResponse(value)).not.toThrow();
      expect(() => parseSubtitleJson(value)).not.toThrow();
    }
  });

  it('returns the empty result for junk input', () => {
    expect(matchesHost(null as unknown as string)).toBe(false);
    expect(extractBvid(null as unknown as string)).toBeNull();
    expect(buildSubtitleJsonUrl(null as unknown as string)).toBe('');
    expect(pickCreator(null as unknown as Record<string, string | undefined>)).toBeNull();
    expect(parseViewApiResponse(null)).toBeNull();
    expect(parsePlayerApiResponse(null)).toEqual([]);
    expect(parseSubtitleJson(null)).toEqual([]);
    // The build* functions are total and still return well-formed URL strings.
    expect(buildViewApiUrl(null as unknown as string)).toBe(
      'https://api.bilibili.com/x/web-interface/view?bvid=',
    );
    expect(buildPlayerApiUrl(null as unknown as number, null as unknown as number)).toBe(
      'https://api.bilibili.com/x/player/v2?aid=&cid=',
    );
  });
});