/**
 * Bilibili platform parsing helpers — pure functions only.
 *
 * No `fetch`, no DOM access, no Node APIs: every export is a deterministic
 * value-in / value-out function, so the module runs unchanged in the content
 * script, in the background service worker and in a plain node test process.
 * The contexts around it divide the work like this:
 *
 *   - CONTENT SCRIPT (has the DOM): builds the flat "key -> value" map that
 *     `pickCreator` consumes (see its KEY CONTRACT). The page's own JS state
 *     (`window.__INITIAL_STATE__`, which does carry `aid` / `cid` / `bvid`) is
 *     NOT reachable from the isolated world, so only the DOM is available here.
 *   - BACKGROUND SERVICE WORKER (`<all_urls>` host permission, unrestricted
 *     cross-origin fetch): calls `extractBvid` / `buildViewApiUrl` /
 *     `buildPlayerApiUrl` / `buildSubtitleJsonUrl` and hands the parsed JSON to
 *     the `parse*` functions. The worker is the only context that can reach
 *     `api.bilibili.com`: a content-script fetch is subject to CORS and these
 *     endpoints send no `Access-Control-Allow-Origin`.
 *
 * FIELD ASSUMPTIONS: the shapes below come from the public interface
 * documentation and from commonly observed responses — not from any contract
 * Bilibili guarantees. Fields are added, renamed and dropped without notice,
 * so every parser is best-effort: malformed input yields `null` / `[]` and
 * never throws, and callers must degrade gracefully.
 */

import type { CreatorInfo, SubtitleSegment } from '../../types/playback';
import { PLATFORM_HOSTS } from '../media/direct-url';
import { readCreatorMeta, type CreatorMetaValue } from './creator-meta';

/**
 * Bilibili hosts, derived from the shared PLATFORM_HOSTS table
 * (`src/adapters/media/direct-url.ts`) so the two lists cannot drift.
 * `www.bilibili.com` needs no separate entry: it is a subdomain and is covered
 * by the suffix rule in `matchesHost`. `b23.tv` is the share-link domain — it
 * carries no video id of its own, see `extractBvid`.
 */
const BILIBILI_HOSTS: readonly string[] =
  PLATFORM_HOSTS.find((platform) => platform.id === 'bilibili')?.hosts ?? [
    'bilibili.com',
    'b23.tv',
  ];

/** Canonical origin of the video site, used to resolve root-relative paths. */
const BILIBILI_ORIGIN = 'https://www.bilibili.com';

/** Origin that serves the JSON APIs. Note it is NOT one of the page hosts. */
const API_ORIGIN = 'https://api.bilibili.com';

/**
 * BV id: the literal `BV` prefix followed by `[A-Za-z0-9]` only. The
 * real-world length (12) is deliberately NOT pinned, so short fixtures and any
 * future id shape still work; the charset check is what rejects empty and
 * obviously-wrong values.
 */
const BVID_RE = /^BV[A-Za-z0-9]+$/;

/**
 * Case-insensitive prefix test used while scanning for a BV id. The canonical
 * spelling is uppercase `BV`; a hand-typed lowercase `bv...` is still a BV id,
 * and only the prefix case is normalized (see `sanitizeBvid`), never the body.
 */
const BVID_PREFIX_RE = /^bv/i;

/** Path segment that precedes a BV id on the canonical video URL. */
const VIDEO_PATH_SEGMENT = 'video';

/**
 * `SubtitleSegment.source` is typed as `SubtitleSource`, whose union in
 * `src/types/playback.ts` already carries `'platform'` ("captions fetched from
 * the platform") — which is exactly what a subtitle-JSON fetch is, so that
 * member is reused verbatim.
 */
const PLATFORM_SUBTITLE_SOURCE = 'platform' satisfies SubtitleSegment['source'];

/* ------------------------------------------------------------------ */
/* Host matching                                                       */
/* ------------------------------------------------------------------ */

/**
 * True for `bilibili.com` / `b23.tv` and any subdomain of them.
 * Case-insensitive. `notbilibili.com`, `bilibili.com.evil.com` and `evb23.tv`
 * are all rejected: a bare `endsWith('bilibili.com')` would wrongly accept the
 * first and third, so the suffix must include the separating dot.
 */
export function matchesHost(hostname: string): boolean {
  if (typeof hostname !== 'string') return false;
  const host = hostname.trim().toLowerCase();
  if (host === '') return false;
  return BILIBILI_HOSTS.some((base) => host === base || host.endsWith(`.${base}`));
}

/* ------------------------------------------------------------------ */
/* URL building / BV id extraction                                     */
/* ------------------------------------------------------------------ */

/** `decodeURIComponent` that leaves a malformed `%` sequence untouched. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** `String(n)` for a finite number, `''` otherwise (the URL stays well-formed). */
function numericParam(value: number): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

/**
 * Normalize a raw path segment / query value into a BV id, or null when it is
 * not one. The BV body is CASE-SENSITIVE (its mixed case encodes information),
 * so only the `BV` prefix is normalized; the rest is preserved verbatim.
 */
function sanitizeBvid(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  // Path segments are still percent-encoded, query values are not; decoding
  // twice is a no-op for the `[A-Za-z0-9]` charset this ends up filtered by.
  const value = safeDecode(raw).trim();
  if (!BVID_PREFIX_RE.test(value)) return null;
  const normalized = `BV${value.slice(2)}`;
  return BVID_RE.test(normalized) ? normalized : null;
}

/** Parse an absolute URL, a protocol-relative one, or a root-relative path. */
function parseUrlLenient(raw: string): URL | null {
  // Share markup uses the protocol-relative form (`//www.bilibili.com/video/...`),
  // so it is completed against https rather than rejected.
  const candidate = raw.startsWith('//') ? `https:${raw}` : raw;
  try {
    return new URL(candidate);
  } catch {
    // A content script often only has `location.pathname` (`/video/BVxxx`).
    if (candidate.startsWith('/')) {
      try {
        return new URL(candidate, BILIBILI_ORIGIN);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Extract a BV id from a Bilibili URL. Supported shapes:
 *   - https://www.bilibili.com/video/BV1xx411c7mD
 *   - .../video/BV1xx411c7mD?p=1        (multi-part selector)
 *   - .../video/BV1xx411c7mD#reply      (fragment)
 *   - //www.bilibili.com/video/BV1xx411c7mD   (protocol-relative share link)
 *   - /video/BV1xx411c7mD               (a path-only value, as read from
 *                                        `location.pathname`)
 *
 * Every path segment is scanned (not just the one after `video`) and `?bvid=`
 * is used as a query fallback, so the watch-later / collection pages, whose id
 * lives in the query rather than the path, still resolve.
 *
 * The legacy numeric `av12345` form is NOT converted: it needs an API call
 * (`x/web-interface/view?aid=`), which a pure function cannot make — callers
 * with an aid should use the API directly.
 *
 * `b23.tv` short links are an opaque code (`b23.tv/aBcDeFg`) that only the
 * server can resolve: expanding one requires a network round trip (a request
 * following the redirect), so this function returns null for them. The CALLER
 * must resolve the short link first and re-run this function on the final URL.
 * A `b23.tv` link whose path happens to carry a real BV id is still accepted.
 *
 * Returns null for a non-Bilibili host, a URL without an id, or unparseable
 * input — the caller decides what to do with an unknown page.
 */
export function extractBvid(url: string): string | null {
  if (typeof url !== 'string') return null;
  const raw = url.trim();
  if (raw === '') return null;

  const parsed = parseUrlLenient(raw);
  if (parsed === null || !matchesHost(parsed.hostname)) return null;

  const segments = parsed.pathname.split('/').filter((segment) => segment !== '');

  // Canonical shape: the id is the segment right after `video`. It is checked
  // first, then every other segment is scanned, so a URL carrying more than one
  // BV-looking segment (`/video/BVxxx/reply/BVyyy`) resolves to the one the
  // page is actually on rather than to whichever came first.
  const videoAt = segments.findIndex(
    (segment) => segment.toLowerCase() === VIDEO_PATH_SEGMENT,
  );
  if (videoAt >= 0) {
    const bvid = sanitizeBvid(segments[videoAt + 1]);
    if (bvid !== null) return bvid;
  }
  for (const segment of segments) {
    const bvid = sanitizeBvid(segment);
    if (bvid !== null) return bvid;
  }

  // Query fallback: the watch-later / collection pages carry the id as
  // `?bvid=` instead of in the path.
  return sanitizeBvid(parsed.searchParams.get('bvid'));
}

/**
 * Canonical `view` API URL for a BV id — the endpoint that resolves a page to
 * its `aid` / `cid` pair (and carries the title and owner as a side effect).
 * Total function: never throws, and an empty id still yields a well-formed URL
 * (`...?bvid=`), so callers should null-check `extractBvid` before building one.
 */
export function buildViewApiUrl(bvid: string): string {
  const id = typeof bvid === 'string' ? bvid.trim() : '';
  return `${API_ORIGIN}/x/web-interface/view?bvid=${encodeURIComponent(id)}`;
}

/**
 * `player/v2` API URL for an `aid` / `cid` pair — the endpoint that lists the
 * available subtitle tracks (`subtitle.subtitles[]`).
 *
 * A non-finite argument collapses to an empty value (`aid=&cid=`) instead of
 * the literal `NaN`, keeping the URL well-formed and the failure visible in the
 * response rather than in the request.
 */
export function buildPlayerApiUrl(aid: number, cid: number): string {
  return `${API_ORIGIN}/x/player/v2?aid=${numericParam(aid)}&cid=${numericParam(cid)}`;
}

/**
 * Make the `subtitle_url` field fetchable from a service worker.
 *
 * The API returns it protocol-relative — `//aisubtitle.hdslb.com/bfs/subtitle/
 * xxxxx.json` — which has no origin of its own and therefore cannot be fetched
 * as-is; prefixing `https:` completes it. An already-absolute `http://` /
 * `https://` value is returned verbatim (so this function is idempotent), and
 * anything else — empty string, a relative path, a `javascript:` payload —
 * collapses to `''` because guessing an origin there would silently fetch the
 * wrong host. Callers should treat `''` as "no subtitle".
 */
export function buildSubtitleJsonUrl(url: string): string {
  if (typeof url !== 'string') return '';
  const value = url.trim();
  if (value === '') return '';
  if (value.startsWith('//')) return `https:${value}`;
  if (/^https?:\/\//i.test(value)) return value;
  return '';
}

/* ------------------------------------------------------------------ */
/* Response parsing                                                    */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Finite-number reader. A numeric STRING is not accepted: the API sends real
 * JSON numbers, and accepting `"123"` would let a string reach `aid` / `cid`
 * and end up concatenated into a request URL.
 */
function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** `subtitle_url` normalized to an absolute http(s) URL, or null when unusable. */
function absoluteSubtitleUrl(value: unknown): string | null {
  const raw = nonEmptyString(value);
  if (raw === null) return null;
  const absolute = buildSubtitleJsonUrl(raw);
  return absolute === '' ? null : absolute;
}

/**
 * Parse a `x/web-interface/view` response.
 *
 * ASSUMED shape (public interface docs / common responses):
 *   { code: 0, data: { aid, cid, title, owner: { mid, name } } }
 *
 * Rules, all defensive:
 *   - `code` must be exactly `0`. Bilibili reports its own errors there
 *     (-400 bad request, -404 not found, -403 forbidden, 62002 unavailable);
 *     a missing `code` is not the documented shape and is rejected too.
 *   - `data` must be an object; `data: null` and a missing `data` both yield
 *     null.
 *   - `aid` and `cid` must both be finite numbers: they are the two halves of
 *     the `player/v2` request this parse exists to enable, so a half pair is
 *     useless and the whole parse fails.
 *   - `title`, `owner.name` and `owner.mid` are optional: a missing or empty
 *     value becomes null rather than failing the parse.
 *
 * NOTE: `cid` is the first page's cid (`data.cid`). A multi-part video watched
 * as `?p=N` plays a different cid, which lives in `data.pages[N-1].cid`; the
 * caller must pick the page before asking this parser (or request the page
 * itself), since the response alone does not say which part is playing.
 */
export function parseViewApiResponse(json: unknown): {
  aid: number;
  cid: number;
  title: string | null;
  ownerName: string | null;
  ownerMid: number | null;
} | null {
  if (!isRecord(json)) return null;
  if (json['code'] !== 0) return null;

  const data = json['data'];
  if (!isRecord(data)) return null;

  const aid = finiteNumber(data['aid']);
  const cid = finiteNumber(data['cid']);
  if (aid === null || cid === null) return null;

  const owner = data['owner'];
  const ownerRecord = isRecord(owner) ? owner : {};

  return {
    aid,
    cid,
    title: nonEmptyString(data['title']),
    ownerName: nonEmptyString(ownerRecord['name']),
    ownerMid: finiteNumber(ownerRecord['mid']),
  };
}

/**
 * Parse a `x/player/v2` response into its subtitle tracks.
 *
 * ASSUMED shape (public interface docs / common responses):
 *   { code: 0, data: { subtitle: { subtitles: [ { lan, lan_doc, subtitle_url } ] } } }
 *
 * Rules, all defensive:
 *   - `code` / `data` are gated exactly as in `parseViewApiResponse`, so a
 *     non-zero code yields `[]` even if a `data` subtree happens to be present.
 *   - `subtitle` missing / not an object, or `subtitles` missing / not an
 *     array -> `[]` (the normal answer for a video without subtitles).
 *   - Non-object entries are skipped.
 *   - `subtitle_url` is normalized here (protocol-relative -> absolute https),
 *     so the caller can fetch the value directly; `buildSubtitleJsonUrl` is
 *     idempotent, so routing it through again is harmless. An entry with an
 *     unusable URL is KEPT with `subtitleUrl: null` when it still names a
 *     language — the language menu is useful even when the track itself is not
 *     fetchable (e.g. a login-gated track) — and dropped when it carries
 *     neither.
 *   - `language` is `lan` (`'zh-CN'`, `'ai-zh'`, ...). The human-readable
 *     `lan_doc` is deliberately ignored: it is localized prose, while `lan` is
 *     the stable identifier a caller can match on.
 */
export function parsePlayerApiResponse(json: unknown): {
  subtitleUrl: string | null;
  language: string | null;
}[] {
  if (!isRecord(json)) return [];
  if (json['code'] !== 0) return [];

  const data = json['data'];
  if (!isRecord(data)) return [];

  const subtitle = data['subtitle'];
  if (!isRecord(subtitle)) return [];

  const subtitles = subtitle['subtitles'];
  if (!Array.isArray(subtitles)) return [];

  const tracks: { subtitleUrl: string | null; language: string | null }[] = [];
  for (const raw of subtitles) {
    if (!isRecord(raw)) continue;

    const subtitleUrl = absoluteSubtitleUrl(raw['subtitle_url']);
    const language = nonEmptyString(raw['lan']);
    // An entry that yields neither a fetchable URL nor a language carries no
    // information at all; there is nothing for the caller to do with it.
    if (subtitleUrl === null && language === null) continue;

    tracks.push({ subtitleUrl, language });
  }
  return tracks;
}

/**
 * Parse the subtitle JSON that `subtitle_url` points at into normalized
 * segments.
 *
 * ASSUMED shape (public interface docs / common responses):
 *   { body: [ { from: 0.5, to: 3.2, content: "..." } ] }
 *
 * Rules, all defensive:
 *   - `body` missing / not an array -> `[]`; non-object entries are skipped.
 *   - `from` / `to` must be finite numbers and `to > from`: a cue with a
 *     non-numeric or inverted / zero-length span is dropped rather than
 *     clamped, since an invented boundary is worse than a missing cue.
 *   - `content` is trimmed; empty (whitespace-only) text drops the cue, so no
 *     blank segment ever reaches the reader.
 *
 * Segments are returned SORTED ASCENDING by `start`. The payload is already
 * time-ordered in practice, but the caller looks cues up by playback time, so
 * the invariant is enforced here instead of trusted. `Array.prototype.sort` is
 * stable, so cues sharing a start keep their document order.
 */
export function parseSubtitleJson(json: unknown): SubtitleSegment[] {
  if (!isRecord(json)) return [];

  const body = json['body'];
  if (!Array.isArray(body)) return [];

  const segments: SubtitleSegment[] = [];
  for (const raw of body) {
    if (!isRecord(raw)) continue;

    const start = finiteNumber(raw['from']);
    const end = finiteNumber(raw['to']);
    if (start === null || end === null || end <= start) continue;

    const text = nonEmptyString(raw['content']);
    if (text === null) continue;

    segments.push({
      start,
      end,
      text,
      source: PLATFORM_SUBTITLE_SOURCE,
    });
  }

  return segments.sort((a, b) => a.start - b.start);
}

/* ------------------------------------------------------------------ */
/* Creator info                                                        */
/* ------------------------------------------------------------------ */

/** Priorities for `pickCreator`; ids match the KEY CONTRACT in its JSDoc. */
const CREATOR_NAME_KEYS: readonly string[] = [
  'meta[name=author]',
  'meta[itemprop=author]',
  '[itemprop=author] [itemprop=name]',
  '#v_upinfo .username',
  'a.up-name',
];

/** URL keys are read with the same priorities; the values are `href`s. */
const CREATOR_URL_KEYS: readonly string[] = [
  '[itemprop=author] [itemprop=url]',
  '#v_upinfo a.username',
  'a[href*="space.bilibili.com"]',
];

/** `//space.bilibili.com/1` -> `https://space.bilibili.com/1`, `/1` -> absolute. */
function normalizeAuthorUrl(raw: string | null): string | null {
  if (raw === null) return null;
  const value = raw.trim();
  if (value === '') return null;
  if (value.startsWith('//')) return `https:${value}`;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
  if (value.startsWith('/')) return `${BILIBILI_ORIGIN}${value}`;
  return null;
}

/**
 * Pick creator (UP主 / uploader) info out of the flat "key -> value" map that
 * the CONTENT SCRIPT builds from the page DOM.
 *
 * KEY CONTRACT — keys are CSS-selector-shaped strings, so the caller can
 * literally do `map[key] = read(document.querySelector(key))`:
 *
 *   name, in priority order               value to pass
 *   'meta[name=author]'                   `content` attr
 *   'meta[itemprop=author]'               `content` attr
 *   '[itemprop=author] [itemprop=name]'   `content` attr, else textContent
 *   '#v_upinfo .username'                 textContent
 *   'a.up-name'                           textContent
 *
 *   url, in priority order                value to pass
 *   '[itemprop=author] [itemprop=url]'    `href` attr
 *   '#v_upinfo a.username'                `href` attr
 *   'a[href*="space.bilibili.com"]'       `href` attr
 *
 * `meta[name=author]` leads because it lives in `<head>` and survives the
 * frequent re-renders of the video page body; the DOM selectors are the
 * fallback for pages whose head metadata is missing or stale. The name key
 * `'#v_upinfo .username'` and the url key `'#v_upinfo a.username'` are two
 * DIFFERENT selector strings on purpose: each map entry then reads one
 * attribute, so a caller can never hand the wrong one to the wrong slot.
 *
 * `'h1[title]'` is deliberately NOT a key: on a video page that element holds
 * the VIDEO title (`<h1 class="video-title" title=...>`), not the uploader, so
 * using it would silently mislabel every video with its own title.
 *
 * Only non-empty string values are trusted; anything else in the map is
 * ignored. Returns null when no name could be read — CreatorInfo is keyed on
 * the name, so a known URL alone is not a usable creator.
 */
export function pickCreator(
  meta: Record<string, string | undefined>,
): CreatorInfo | null {
  // Runtime guard: the map is assembled by hand across a page whose markup
  // changes, and the tests feed null-style values through this signature.
  const source: Record<string, unknown> = isRecord(meta) ? meta : {};

  let name: string | null = null;
  for (const key of CREATOR_NAME_KEYS) {
    name = nonEmptyString(source[key]);
    if (name !== null) break;
  }
  if (name === null) return null;

  let url: string | null = null;
  for (const key of CREATOR_URL_KEYS) {
    url = normalizeAuthorUrl(nonEmptyString(source[key]));
    if (url !== null) break;
  }

  return { name, url };
}

/**
 * Build the map `pickCreator` above consumes, using `read` to look one selector
 * up. The CONTENT SCRIPT passes a DOM-backed reader; tests pass a plain object
 * lookup. Keeping the selector lists here means the KEY CONTRACT above and the
 * code that fills it cannot drift.
 */
export function collectCreatorMeta(
  read: (selector: string) => CreatorMetaValue | undefined,
): Record<string, string | undefined> {
  return readCreatorMeta(CREATOR_NAME_KEYS, CREATOR_URL_KEYS, read);
}