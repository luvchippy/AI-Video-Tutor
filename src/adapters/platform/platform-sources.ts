/**
 * Background-side platform subtitle sources.
 *
 * WHY THIS IS NOT A `PlatformAdapter`: the `PlatformAdapter` interface in
 * `src/types/media.ts` is the CONTENT-SCRIPT half of platform support — every
 * one of its methods reads the live DOM (`findMainVideo`, `document.title`, …),
 * and `generic-html5.ts` is a real implementation of it. Resolving a platform's
 * captions, by contrast, needs an unrestricted cross-origin `fetch`, which only
 * the service worker has. A `PlatformAdapter` living in the worker could only
 * ever return null from `getPlaybackClock()` and empty from `getSubtitles()`.
 *
 * So the work is split the way the rest of the extension already is:
 *   - CONTENT SCRIPT: reads the DOM. The page's own creator markup is picked up
 *     through `collectCreatorMeta` / `pickCreator` in the sibling modules (see
 *     `src/entrypoints/content.ts`).
 *   - BACKGROUND (here): turns the page URL into captions by calling the
 *     platform's own endpoints, with the parsers from the sibling modules.
 *
 * Everything here degrades honestly: a failure returns `[]` plus a Chinese
 * `note` saying what went wrong. Captions are NEVER invented, and a risk-control
 * or consent page that parses to zero cues is reported as a failure rather than
 * silently producing an empty-but-"successful" result.
 */

import type { SubtitleSegment } from '../../types/playback';
import { isSafeHttpUrl } from '../../services/url-guard';
import {
  matchesHost as matchesYouTubeHost,
  extractVideoId,
  buildWatchUrl,
  parseCaptionTracks,
  parseTimedTextXml,
  type CaptionTrack,
} from './youtube';
import {
  matchesHost as matchesBilibiliHost,
  extractBvid,
  buildViewApiUrl,
  buildPlayerApiUrl,
  parseViewApiResponse,
  parsePlayerApiResponse,
  parseSubtitleJson,
} from './bilibili';

export interface PlatformSubtitleFetch {
  segments: SubtitleSegment[];
  /** Chinese, user-facing: which track was read, or why nothing was. */
  note: string;
}

export interface PlatformSubtitleSource {
  id: string;
  matchesHost(hostname: string): boolean;
  /** Resolve the page's own captions. Never throws; [] plus a note on failure. */
  fetchSubtitles(
    pageUrl: string,
    signal?: AbortSignal,
  ): Promise<PlatformSubtitleFetch>;
}

/** Long enough for a slow page fetch, short enough not to hang the UI. */
const REQUEST_TIMEOUT_MS = 15_000;

/** Caller signal merged with the deadline; either one aborts the request. */
function withTimeout(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/**
 * Fetch a URL as text, or null for every failure mode: a URL that is not public
 * http(s), a network error, the 15s deadline, a caller abort, or a non-2xx
 * status.
 *
 * The address guard matters here because one of the URLs we fetch is not a
 * constant: a caption `baseUrl` or `subtitle_url` is read out of the page's own
 * JSON payload. Those payloads arrive from the platform over HTTPS, so a URL in
 * one that points at loopback, a private range or a cloud-metadata address means
 * the payload is not what it claims to be — and a request there must never leave
 * the extension on a page's word.
 *
 * `credentials: 'omit'` keeps the request anonymous: these are public pages and
 * APIs, and sending the user's cookies to them would leak their session for no
 * benefit. A 200 response that is actually an error page is not detected here —
 * it simply fails to parse below, which the callers report as such.
 */
async function fetchText(
  url: string,
  callerSignal?: AbortSignal,
): Promise<string | null> {
  if (!isSafeHttpUrl(url)) return null;
  try {
    const response = await fetch(url, {
      credentials: 'omit',
      signal: withTimeout(callerSignal),
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

/** Fetch a URL and parse it as JSON, or null for every failure mode. */
async function fetchJson(
  url: string,
  callerSignal?: AbortSignal,
): Promise<unknown | null> {
  const text = await fetchText(url, callerSignal);
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/* ------------------------------- YouTube -------------------------------- */

/**
 * Pick which caption track to read. Hand-written captions (`kind` absent or a
 * value other than `'asr'`) are preferred over auto-generated ones: the ASR
 * track is always present when YouTube can generate it, and its errors would
 * then feed the knowledge index as if they were the video's own words.
 */
function pickCaptionTrack(tracks: CaptionTrack[]): CaptionTrack | undefined {
  return tracks.find((track) => track.kind !== 'asr') ?? tracks[0];
}

const youtubeSource: PlatformSubtitleSource = {
  id: 'youtube',
  matchesHost: matchesYouTubeHost,

  async fetchSubtitles(pageUrl, signal) {
    const videoId = extractVideoId(pageUrl);
    if (videoId === null) {
      return {
        segments: [],
        note: '无法从当前地址识别 YouTube 视频 ID。',
      };
    }

    // The caption track list is embedded in the watch page; there is no
    // keyless API for it.
    const html = await fetchText(buildWatchUrl(videoId), signal);
    if (html === null) {
      return {
        segments: [],
        note: '抓取 YouTube 页面失败（网络错误，或该站点拒绝了本次请求）。',
      };
    }

    const tracks = parseCaptionTracks(html);
    const track = pickCaptionTrack(tracks);
    if (track === undefined) {
      return {
        segments: [],
        note: 'YouTube 页面中未找到字幕轨：该视频可能没有字幕，或页面未返回播放器数据（如同意页／风控页）。',
      };
    }

    const xml = await fetchText(track.url, signal);
    if (xml === null) {
      return { segments: [], note: '字幕轨存在，但下载字幕内容失败。' };
    }

    const segments = parseTimedTextXml(xml);
    if (segments.length === 0) {
      return {
        segments: [],
        note: '字幕内容无法解析（YouTube 返回的不是预期的 XML 格式）。',
      };
    }

    const flavour = track.kind === 'asr' ? '自动生成' : null;
    const details = [flavour, track.languageCode].filter(
      (part): part is string => part !== null,
    );
    const suffix = details.length > 0 ? `（${details.join('，')}）` : '';
    return {
      segments,
      note: `已从 YouTube 读取 ${segments.length} 条字幕${suffix}。`,
    };
  },
};

/* ------------------------------- Bilibili ------------------------------- */

const bilibiliSource: PlatformSubtitleSource = {
  id: 'bilibili',
  matchesHost: matchesBilibiliHost,

  async fetchSubtitles(pageUrl, signal) {
    const bvid = extractBvid(pageUrl);
    if (bvid === null) {
      return {
        segments: [],
        note: '无法从当前地址识别 BV 号。若地址是 b23.tv 短链，请先让它在浏览器中跳转到正式视频页再重试。',
      };
    }

    // view -> aid/cid, then player/v2 -> subtitle track list, then the track
    // itself. Three steps because that is how Bilibili exposes CC captions.
    const view = parseViewApiResponse(await fetchJson(buildViewApiUrl(bvid), signal));
    if (view === null) {
      return {
        segments: [],
        note: 'Bilibili 视频信息接口没有返回可用数据（视频可能有访问限制，或被风控拦截）。',
      };
    }

    const tracks = parsePlayerApiResponse(
      await fetchJson(buildPlayerApiUrl(view.aid, view.cid), signal),
    );
    const track = tracks.find((candidate) => candidate.subtitleUrl !== null);
    if (track === undefined) {
      return {
        segments: [],
        note: '该视频没有可读取的字幕（Bilibili 的 CC 字幕大多需要登录后才返回地址）。',
      };
    }

    const segments = parseSubtitleJson(await fetchJson(track.subtitleUrl!, signal));
    if (segments.length === 0) {
      return { segments: [], note: '字幕地址返回的内容无法解析。' };
    }

    const language = track.language === null ? '' : `（${track.language}）`;
    return {
      segments,
      note: `已从 Bilibili 读取 ${segments.length} 条字幕${language}。`,
    };
  },
};

/* -------------------------------- registry ------------------------------ */

/** Order matters only because the hosts are disjoint. */
export const PLATFORM_SUBTITLE_SOURCES: PlatformSubtitleSource[] = [
  youtubeSource,
  bilibiliSource,
];

export function matchSubtitleSource(hostname: string): PlatformSubtitleSource | null {
  return (
    PLATFORM_SUBTITLE_SOURCES.find((source) => source.matchesHost(hostname)) ?? null
  );
}

/**
 * Fetch captions from whichever platform serves `pageUrl`. Returns [] with a
 * Chinese note for any site that has no source, any unparseable URL and any
 * throw from a source — callers treat an empty `segments` as "no platform
 * subtitles" and fall back to the other subtitle sources.
 */
export async function fetchPlatformSubtitles(
  pageUrl: string,
  signal?: AbortSignal,
): Promise<PlatformSubtitleFetch> {
  let hostname: string;
  try {
    hostname = new URL(pageUrl).hostname;
  } catch {
    return { segments: [], note: '页面地址无法解析，无法读取平台字幕。' };
  }

  const source = matchSubtitleSource(hostname);
  if (source === null) {
    return { segments: [], note: '当前站点没有平台字幕适配器。' };
  }

  try {
    return await source.fetchSubtitles(pageUrl, signal);
  } catch {
    return { segments: [], note: '读取平台字幕时发生未知错误。' };
  }
}