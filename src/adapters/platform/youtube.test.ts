/**
 * Unit tests for the pure YouTube parsers.
 *
 * The suite runs in the node environment (no DOM, no network), which is
 * exactly the contract of the module: strings in, values out.
 */

import { describe, it, expect } from 'vitest';
import {
  buildWatchUrl,
  extractVideoId,
  matchesHost,
  parseCaptionTracks,
  parseTimedTextXml,
  pickCreator,
} from './youtube';

const VIDEO_ID = 'dQw4w9WgXcQ';

/** A realistic-ish response: nested objects and braces inside strings. */
const PLAYER_RESPONSE = {
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: [
        {
          baseUrl: `https://www.youtube.com/api/timedtext?v=${VIDEO_ID}&lang=en&fmt=json3`,
          name: { simpleText: 'English' },
          languageCode: 'en',
          kind: 'asr',
        },
        {
          baseUrl: `https://www.youtube.com/api/timedtext?v=${VIDEO_ID}&lang=zh-Hans`,
          languageCode: 'zh-Hans',
        },
      ],
      audioTracks: [{ captionTrackIndices: [0, 1] }],
    },
  },
  videoDetails: {
    videoId: VIDEO_ID,
    title: 'A title with { braces } inside',
    shortDescription: 'text with } a stray brace and {"quoted":"json"}',
  },
};

/** What the service worker actually gets: page HTML around the assignment. */
function htmlWithPlayerResponse(payload: unknown, prefix = 'var ytInitialPlayerResponse = '): string {
  return `<html><body><script>${prefix}${JSON.stringify(payload)};</script></body></html>`;
}

describe('matchesHost', () => {
  it('matches the bare YouTube domains', () => {
    expect(matchesHost('youtube.com')).toBe(true);
    expect(matchesHost('youtu.be')).toBe(true);
  });

  it('matches subdomains', () => {
    expect(matchesHost('www.youtube.com')).toBe(true);
    expect(matchesHost('m.youtube.com')).toBe(true);
    expect(matchesHost('music.youtube.com')).toBe(true);
    expect(matchesHost('www.youtu.be')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(matchesHost('WWW.YouTube.COM')).toBe(true);
    expect(matchesHost('YouTu.Be')).toBe(true);
  });

  it('rejects look-alike hosts', () => {
    expect(matchesHost('notyoutube.com')).toBe(false);
    expect(matchesHost('myyoutube.com')).toBe(false);
    expect(matchesHost('youtube.com.evil.com')).toBe(false);
    expect(matchesHost('youtube.co')).toBe(false);
    expect(matchesHost('evilyoutu.be')).toBe(false);
    expect(matchesHost('')).toBe(false);
  });
});

describe('extractVideoId', () => {
  it('reads watch?v=', () => {
    expect(extractVideoId(`https://www.youtube.com/watch?v=${VIDEO_ID}`)).toBe(VIDEO_ID);
    expect(extractVideoId(`https://www.youtube.com/watch?list=PL1&v=${VIDEO_ID}&t=42s`)).toBe(VIDEO_ID);
  });

  it('reads youtu.be short links', () => {
    expect(extractVideoId(`https://youtu.be/${VIDEO_ID}`)).toBe(VIDEO_ID);
    expect(extractVideoId(`https://youtu.be/${VIDEO_ID}?t=30`)).toBe(VIDEO_ID);
  });

  it('reads /shorts/ and /embed/', () => {
    expect(extractVideoId(`https://www.youtube.com/shorts/${VIDEO_ID}`)).toBe(VIDEO_ID);
    expect(extractVideoId(`https://www.youtube.com/embed/${VIDEO_ID}?start=10`)).toBe(VIDEO_ID);
  });

  it('accepts a path-only value, as read from location.pathname', () => {
    expect(extractVideoId(`/shorts/${VIDEO_ID}`)).toBe(VIDEO_ID);
    expect(extractVideoId(`/watch?v=${VIDEO_ID}`)).toBe(VIDEO_ID);
  });

  it('returns null when the URL carries no id', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=')).toBeNull();
    expect(extractVideoId('https://www.youtube.com/watch?list=PL123')).toBeNull();
    expect(extractVideoId('https://www.youtube.com/')).toBeNull();
    expect(extractVideoId('https://youtu.be/')).toBeNull();
    expect(extractVideoId('https://www.youtube.com/watch?v=has%20space')).toBeNull();
  });

  it('returns null for non-YouTube hosts and junk', () => {
    expect(extractVideoId('https://vimeo.com/12345')).toBeNull();
    expect(extractVideoId(`https://notyoutube.com/watch?v=${VIDEO_ID}`)).toBeNull();
    expect(extractVideoId('not a url')).toBeNull();
    expect(extractVideoId('javascript:alert(1)')).toBeNull();
    expect(extractVideoId('')).toBeNull();
  });

  it('round-trips with buildWatchUrl', () => {
    expect(buildWatchUrl(VIDEO_ID)).toBe(`https://www.youtube.com/watch?v=${VIDEO_ID}`);
    expect(extractVideoId(buildWatchUrl(VIDEO_ID))).toBe(VIDEO_ID);
  });
});

describe('parseTimedTextXml', () => {
  const WELL_FORMED =
    '<transcript><text start="1.23" dur="4.5">hello world</text>' +
    '<text start="6" dur="2">second cue</text></transcript>';

  it('parses a well-formed transcript in order', () => {
    const segments = parseTimedTextXml(WELL_FORMED);
    expect(segments).toHaveLength(2);
    expect(segments[0]?.start).toBe(1.23);
    expect(segments[0]?.end).toBe(1.23 + 4.5);
    expect(segments[0]?.text).toBe('hello world');
    expect(segments[1]?.start).toBe(6);
    expect(segments[1]?.end).toBe(8);
    expect(segments[1]?.text).toBe('second cue');
  });

  it('tags every cue with the platform subtitle source', () => {
    const segments = parseTimedTextXml(WELL_FORMED);
    expect(segments.every((segment) => segment.source === 'platform')).toBe(true);
  });

  it('decodes the named XML entities', () => {
    const xml =
      '<transcript><text start="0" dur="1">a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;</text></transcript>';
    expect(parseTimedTextXml(xml)[0]?.text).toBe('a & b <c> "d" \'e\'');
  });

  it('decodes decimal and hexadecimal numeric entities', () => {
    const xml =
      '<transcript><text start="0" dur="1">&#123;x&#125; &#x1F600; &#x7b;</text></transcript>';
    expect(parseTimedTextXml(xml)[0]?.text).toBe('{x} 😀 {');
  });

  it('strips inner word-timing markup but keeps escaped angle brackets', () => {
    const xml =
      '<transcript><text start="0" dur="1">hello <s t="0">wor</s>ld</text></transcript>';
    expect(parseTimedTextXml(xml)[0]?.text).toBe('hello world');
  });

  it('skips cues with a missing or non-numeric dur', () => {
    const xml =
      '<transcript>' +
      '<text start="1">no dur at all</text>' +
      '<text start="2" dur="abc">non-numeric</text>' +
      '<text start="3" dur="">empty value</text>' +
      '<text start="4" dur="1">kept</text>' +
      '</transcript>';
    const segments = parseTimedTextXml(xml);
    expect(segments.map((segment) => segment.text)).toEqual(['kept']);
  });

  it('skips cues with a missing or non-numeric start', () => {
    const xml =
      '<transcript>' +
      '<text dur="2">no start</text>' +
      '<text start="abc" dur="2">non-numeric</text>' +
      '<text start="Infinity" dur="2">not finite</text>' +
      '<text start="5" dur="2">kept</text>' +
      '</transcript>';
    const segments = parseTimedTextXml(xml);
    expect(segments.map((segment) => segment.text)).toEqual(['kept']);
    expect(segments[0]?.start).toBe(5);
  });

  it('skips cues whose text is empty after trimming', () => {
    const xml =
      '<transcript>' +
      '<text start="1" dur="1">   </text>' +
      '<text start="2" dur="1"></text>' +
      '<text start="3" dur="1"><s></s></text>' +
      '<text start="4" dur="1"> ok </text>' +
      '</transcript>';
    const segments = parseTimedTextXml(xml);
    expect(segments.map((segment) => segment.text)).toEqual(['ok']);
  });

  it('reads unquoted attribute values', () => {
    expect(parseTimedTextXml('<text start=1 dur=2>bare</text>')[0]).toEqual({
      start: 1,
      end: 3,
      text: 'bare',
      source: 'platform',
    });
  });

  it('extracts what it can from malformed XML and never throws', () => {
    const truncated = '<transcript><text start="1" dur="2">ok</text><text start="3" dur="2">cut off';
    expect(() => parseTimedTextXml(truncated)).not.toThrow();
    expect(parseTimedTextXml(truncated).map((segment) => segment.text)).toEqual(['ok', 'cut off']);

    expect(() => parseTimedTextXml('not xml at all')).not.toThrow();
    expect(parseTimedTextXml('not xml at all')).toEqual([]);
    expect(parseTimedTextXml('<text')).toEqual([]);
    expect(parseTimedTextXml('<transcript></transcript>')).toEqual([]);
  });

  it('does not confuse a <textual> tag with a cue', () => {
    expect(parseTimedTextXml('<textual start="1" dur="1">nope</textual>')).toEqual([]);
  });
});

describe('parseCaptionTracks', () => {
  it('extracts caption tracks from page HTML', () => {
    expect(parseCaptionTracks(htmlWithPlayerResponse(PLAYER_RESPONSE))).toEqual([
      {
        url: `https://www.youtube.com/api/timedtext?v=${VIDEO_ID}&lang=en&fmt=json3`,
        languageCode: 'en',
        kind: 'asr',
      },
      {
        url: `https://www.youtube.com/api/timedtext?v=${VIDEO_ID}&lang=zh-Hans`,
        languageCode: 'zh-Hans',
        kind: null,
      },
    ]);
  });

  it('accepts the text of just the inline script element', () => {
    const scriptText = `var ytInitialPlayerResponse = ${JSON.stringify(PLAYER_RESPONSE)};`;
    expect(parseCaptionTracks(scriptText)).toHaveLength(2);
  });

  it('is not truncated by braces or escapes inside JSON strings', () => {
    // The payload's videoDetails strings contain `{`, `}` and escaped quotes;
    // a greedy/regex extraction or a brace scan without string tracking would
    // cut the object short and fail to parse it.
    const tracks = parseCaptionTracks(htmlWithPlayerResponse(PLAYER_RESPONSE));
    expect(tracks[0]?.url).toContain('lang=en');
    expect(tracks).toHaveLength(2);
  });

  it('returns [] when the variable is absent', () => {
    expect(parseCaptionTracks('<html><body>nothing here</body></html>')).toEqual([]);
    expect(parseCaptionTracks('<script>var other = {"captions": {}};</script>')).toEqual([]);
    expect(parseCaptionTracks('')).toEqual([]);
  });

  it('tries later occurrences when an earlier one is not an object', () => {
    const html =
      '<script>window.ytInitialPlayerResponse = null;</script>' +
      `<script>window["ytInitialPlayerResponse"] = ${JSON.stringify(PLAYER_RESPONSE)};</script>`;
    expect(parseCaptionTracks(html)).toHaveLength(2);
  });

  it('handles the JSON-key form of the response', () => {
    const html = `{"ytInitialPlayerResponse":${JSON.stringify(PLAYER_RESPONSE)}}`;
    expect(parseCaptionTracks(html)).toHaveLength(2);
  });

  it('returns [] when the payload has no caption tracks', () => {
    const payload = { videoDetails: { videoId: VIDEO_ID }, captions: {} };
    expect(parseCaptionTracks(htmlWithPlayerResponse(payload))).toEqual([]);
  });

  it('skips tracks without a usable url and keeps the rest', () => {
    const payload = {
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [{ languageCode: 'en' }, { baseUrl: 'https://example.test/t' }],
        },
      },
    };
    expect(parseCaptionTracks(htmlWithPlayerResponse(payload))).toEqual([
      { url: 'https://example.test/t', languageCode: null, kind: null },
    ]);
  });

  it('unescapes an HTML-escaped baseUrl', () => {
    const payload =
      '{"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":' +
      '[{"baseUrl":"https://www.youtube.com/api/timedtext?v=ID&amp;lang=en"}]}}}';
    const html = `<script>var ytInitialPlayerResponse = ${payload};</script>`;
    expect(parseCaptionTracks(html)[0]?.url).toBe(
      'https://www.youtube.com/api/timedtext?v=ID&lang=en',
    );
  });

  it('returns [] for truncated or invalid JSON and never throws', () => {
    const unclosed =
      '<script>var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[{';
    expect(() => parseCaptionTracks(unclosed)).not.toThrow();
    expect(parseCaptionTracks(unclosed)).toEqual([]);

    const invalid = '<script>var ytInitialPlayerResponse = {not json at all};</script>';
    expect(() => parseCaptionTracks(invalid)).not.toThrow();
    expect(parseCaptionTracks(invalid)).toEqual([]);
  });
});

describe('pickCreator', () => {
  it('reads the name and normalizes a protocol-relative channel url', () => {
    const meta = {
      '[itemprop=author] [itemprop=name]': 'Some Channel',
      '[itemprop=author] [itemprop=url]': '//www.youtube.com/@somechannel',
    };
    expect(pickCreator(meta)).toEqual({
      name: 'Some Channel',
      url: 'https://www.youtube.com/@somechannel',
    });
  });

  it('falls back through the meta keys and the rendered DOM keys', () => {
    expect(pickCreator({ 'meta[name=author]': 'From meta' })).toEqual({
      name: 'From meta',
      url: null,
    });
    expect(pickCreator({ 'meta[itemprop=author]': 'From itemprop' })).toEqual({
      name: 'From itemprop',
      url: null,
    });
    expect(pickCreator({ '#owner #channel-name a': 'From DOM' })).toEqual({
      name: 'From DOM',
      url: null,
    });
    expect(pickCreator({ 'ytd-video-owner-renderer #channel-name a': 'From renderer' })).toEqual({
      name: 'From renderer',
      url: null,
    });
  });

  it('prefers the author-scoped key over the fallbacks', () => {
    const meta = {
      '[itemprop=author] [itemprop=name]': 'Specific',
      'meta[name=author]': 'Generic',
    };
    expect(pickCreator(meta)?.name).toBe('Specific');
  });

  it('does not mistake the schema.org video title for the creator', () => {
    // `<meta itemprop="name">` is the VideoObject title on a watch page.
    expect(pickCreator({ 'meta[itemprop=name]': 'Video Title' })).toBeNull();
  });

  it('ignores empty, whitespace-only and non-string values', () => {
    const meta = {
      '[itemprop=author] [itemprop=name]': '   ',
      'meta[name=author]': 'Real Channel',
      'meta[itemprop=author]': 42 as unknown as string,
    };
    expect(pickCreator(meta)).toEqual({ name: 'Real Channel', url: null });
  });

  it('returns null when no name can be read', () => {
    expect(pickCreator({})).toBeNull();
    expect(pickCreator({ 'meta[name=author]': '  ' })).toBeNull();
    expect(pickCreator({ '[itemprop=author] [itemprop=url]': '//www.youtube.com/@solo' })).toBeNull();
  });

  it('normalizes root-relative urls and drops unusable ones', () => {
    expect(pickCreator({ 'meta[name=author]': 'C', '#owner a.yt-simple-endpoint': '/@c' })?.url).toBe(
      'https://www.youtube.com/@c',
    );
    expect(
      pickCreator({ 'meta[name=author]': 'C', '#owner a.yt-simple-endpoint': 'not a url' })?.url,
    ).toBeNull();
  });
});

describe('robustness', () => {
  const junk = ['', null, undefined, 0, NaN, {}, [], true] as readonly unknown[];

  it('never throws on empty or null-style input', () => {
    for (const value of junk) {
      expect(() => matchesHost(value as unknown as string)).not.toThrow();
      expect(() => extractVideoId(value as unknown as string)).not.toThrow();
      expect(() => buildWatchUrl(value as unknown as string)).not.toThrow();
      expect(() => parseTimedTextXml(value as unknown as string)).not.toThrow();
      expect(() => parseCaptionTracks(value as unknown as string)).not.toThrow();
      expect(() =>
        pickCreator(value as unknown as Record<string, string | undefined>),
      ).not.toThrow();
    }
  });

  it('returns the empty result for junk input', () => {
    expect(matchesHost(null as unknown as string)).toBe(false);
    expect(extractVideoId(null as unknown as string)).toBeNull();
    expect(parseTimedTextXml(null as unknown as string)).toEqual([]);
    expect(parseCaptionTracks(null as unknown as string)).toEqual([]);
    expect(pickCreator(null as unknown as Record<string, string | undefined>)).toBeNull();
    // buildWatchUrl is total and still returns a well-formed URL string.
    expect(buildWatchUrl(null as unknown as string)).toBe('https://www.youtube.com/watch?v=');
  });
});