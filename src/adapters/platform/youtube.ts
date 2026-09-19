/**
 * YouTube platform parsing helpers — pure functions only.
 *
 * No `fetch`, no DOM access, no Node APIs: every export is a deterministic
 * value-in / value-out function, so the module runs unchanged in the content
 * script, in the background service worker and in a plain node test process.
 * The contexts around it divide the work like this:
 *
 *   - CONTENT SCRIPT (has the DOM): builds the flat "key -> value" map that
 *     `pickCreator` consumes (see its KEY CONTRACT), and reads the text of the
 *     inline <script> that defines `ytInitialPlayerResponse`. The isolated
 *     world cannot see the page's JS variables, but the script *text* is part
 *     of the DOM and is reachable.
 *   - BACKGROUND SERVICE WORKER (`<all_urls>` host permission, unrestricted
 *     cross-origin fetch): calls `extractVideoId` / `buildWatchUrl`, fetches
 *     the timedtext URL and hands the response body to `parseTimedTextXml` /
 *     `parseCaptionTracks`.
 *
 * FRAGILITY: YouTube's markup, the way `ytInitialPlayerResponse` is embedded
 * in the page and the timedtext payload shape all change without notice.
 * Every parser below is therefore best-effort: malformed input yields
 * `null` / `[]` and never throws, so callers must degrade gracefully.
 */

import type { CreatorInfo, SubtitleSegment } from '../../types/playback';
import { PLATFORM_HOSTS } from '../media/direct-url';
import { readCreatorMeta, type CreatorMetaValue } from './creator-meta';

/**
 * YouTube hosts, derived from the shared PLATFORM_HOSTS table
 * (`src/adapters/media/direct-url.ts`) so the two lists cannot drift.
 * `www.youtube.com` / `m.youtube.com` need no separate entry: they are
 * subdomains and are covered by the suffix rule below.
 */
const YOUTUBE_HOSTS: readonly string[] =
  PLATFORM_HOSTS.find((platform) => platform.id === 'youtube')?.hosts ?? [
    'youtube.com',
    'youtu.be',
  ];

/** Canonical origin used for every URL this module builds or normalizes. */
const YOUTUBE_ORIGIN = 'https://www.youtube.com';

/** Path prefixes that carry the video id as their first segment. */
const VIDEO_PATH_PREFIXES = new Set(['shorts', 'embed', 'live', 'v']);

/**
 * Video ids are `[A-Za-z0-9_-]`. The length is deliberately NOT pinned to the
 * canonical 11 characters, so short fixtures and any future id shape still
 * work; the charset check is what rejects empty / obviously-wrong values.
 */
const VIDEO_ID_RE = /^[A-Za-z0-9_-]+$/;

/** `&#123;`, `&#x1F600;`, `&amp;` — the trailing `;` is required. */
const ENTITY_RE = /&(#[Xx][0-9A-Fa-f]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
};

/**
 * `<text ...>inner</text>`, plus the self-closing and the unterminated forms.
 * Group 1 = attributes, group 2 = inner markup (absent when self-closing).
 * The lookahead after `<text` keeps `<textual>` from matching, and the lazy
 * inner group stops at the nearest `</text>`; when there is none (truncated
 * payload) the rest of the input is taken as the cue body.
 */
const TEXT_ELEMENT_RE = /<text(?=[\s/>])([^>]*?)(?:\/>|>([\s\S]*?)(?:<\/text\s*>|$))/gi;

/** Real tags inside a cue (word-timing `<s>` in some payloads); `<` in prose stays. */
const INNER_TAG_RE = /<\/?[A-Za-z][^>]*>/g;

/** Attribute readers; non-global, so `.exec` keeps no state between calls. */
const TIME_ATTRIBUTE_RE: Record<'start' | 'dur', RegExp> = {
  start: /(?:^|\s)start\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i,
  dur: /(?:^|\s)dur\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i,
};

/** Marker whose assignment carries the player response JSON. */
const PLAYER_RESPONSE_MARKER = 'ytInitialPlayerResponse';

/** How far after the marker the `=` / `:` separator may sit. */
const MAX_SEPARATOR_DISTANCE = 32;

/**
 * `SubtitleSegment.source` is typed as `SubtitleSource`, whose union in
 * `src/types/playback.ts` already carries `'platform'` ("captions fetched from
 * the platform") — which is exactly what a timedtext fetch is, so that member
 * is reused verbatim.
 *
 * TODO: needs a 'platform-api' value on SubtitleSegment.source
 * (`src/types/**` is out of scope for this change, hence the reuse above.)
 */
const PLATFORM_SUBTITLE_SOURCE = 'platform' satisfies SubtitleSegment['source'];

/* ------------------------------------------------------------------ */
/* Host matching                                                       */
/* ------------------------------------------------------------------ */

/**
 * True for `youtube.com` / `youtu.be` and any subdomain of them.
 * Case-insensitive. `notyoutube.com`, `myyoutube.com`, `youtube.com.evil.com`
 * and `evilyoutu.be` are all rejected: a bare `endsWith('youtube.com')` would
 * wrongly accept the first and third, so the suffix must include the dot.
 */
export function matchesHost(hostname: string): boolean {
  if (typeof hostname !== 'string') return false;
  const host = hostname.trim().toLowerCase();
  if (host === '') return false;
  return YOUTUBE_HOSTS.some((base) => host === base || host.endsWith(`.${base}`));
}

/* ------------------------------------------------------------------ */
/* URL building / video id extraction                                  */
/* ------------------------------------------------------------------ */

/** `decodeURIComponent` that leaves a malformed `%` sequence untouched. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Parse an absolute URL, or a root-relative path against the canonical origin. */
function parseUrlLenient(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    // A content script often only has `location.pathname` (`/shorts/ID`).
    if (raw.startsWith('/')) {
      try {
        return new URL(raw, YOUTUBE_ORIGIN);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function sanitizeVideoId(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  // Path segments are still percent-encoded, query values are not; decoding
  // twice is a no-op for the `[A-Za-z0-9_-]` charset this ends up filtered by.
  const value = safeDecode(raw).trim();
  if (value === '' || !VIDEO_ID_RE.test(value)) return null;
  return value;
}

/**
 * Extract a video id from a YouTube URL. Supported shapes:
 *   - https://www.youtube.com/watch?v=ID   (`v` anywhere in the query)
 *   - https://youtu.be/ID
 *   - https://www.youtube.com/shorts/ID
 *   - https://www.youtube.com/embed/ID    (also /live/ID and legacy /v/ID)
 *
 * Returns null for a non-YouTube host, a URL without an id, or unparseable
 * input — the caller decides what to do with an unknown page.
 */
export function extractVideoId(url: string): string | null {
  if (typeof url !== 'string') return null;
  const raw = url.trim();
  if (raw === '') return null;

  const parsed = parseUrlLenient(raw);
  if (parsed === null || !matchesHost(parsed.hostname)) return null;

  const segments = parsed.pathname.split('/').filter((segment) => segment !== '');
  const first = segments[0]?.toLowerCase();

  if (first === 'watch') return sanitizeVideoId(parsed.searchParams.get('v'));
  if (first !== undefined && VIDEO_PATH_PREFIXES.has(first)) {
    return sanitizeVideoId(segments[1]);
  }
  // Short-link form: the id is the first path segment (`youtu.be/ID`).
  if (parsed.hostname.toLowerCase().endsWith('youtu.be')) {
    return sanitizeVideoId(segments[0]);
  }
  return null;
}

/**
 * Canonical watch URL for a video id. Total function: never throws, and an
 * empty id still yields the watch page (`.../watch?v=`), so callers should
 * null-check `extractVideoId` before building one.
 */
export function buildWatchUrl(videoId: string): string {
  const id = typeof videoId === 'string' ? videoId.trim() : '';
  return `${YOUTUBE_ORIGIN}/watch?v=${encodeURIComponent(id)}`;
}

/* ------------------------------------------------------------------ */
/* timedtext XML                                                       */
/* ------------------------------------------------------------------ */

function codePointToString(code: number): string | null {
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return null;
  if (code >= 0xd800 && code <= 0xdfff) return null; // lone surrogate
  try {
    return String.fromCodePoint(code);
  } catch {
    return null;
  }
}

/**
 * Decode the XML entities YouTube emits. Unknown entities are left verbatim so
 * nothing is silently lost; a bare `&` without `;` is not an entity and is
 * untouched.
 */
function decodeEntities(text: string): string {
  return text.replace(ENTITY_RE, (match: string, body: string): string => {
    if (body.startsWith('#')) {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      return codePointToString(code) ?? match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

function readTimeAttribute(attributes: string, name: 'start' | 'dur'): string | null {
  const match = TIME_ATTRIBUTE_RE[name].exec(attributes);
  if (!match) return null;
  // `??` (not `||`) on purpose: an empty quoted value is a present-but-invalid
  // value and is rejected by parseSeconds, not skipped over.
  return match[1] ?? match[2] ?? match[3] ?? null;
}

/** Strict seconds parser: empty / non-numeric / non-finite all yield null. */
function parseSeconds(raw: string | null): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/**
 * Parse YouTube `timedtext` XML into normalized segments.
 *
 * Shape: `<transcript><text start="1.23" dur="4.5">content</text>...</transcript>`
 * (`fmt=srv3`'s `<p t= d=>` millisecond form and `fmt=json3` are NOT handled —
 * fetch the default XML form.)
 *
 * Rules, all defensive:
 *   - `start` or `dur` missing / non-numeric / non-finite -> cue skipped.
 *   - `end = start + dur` (a numeric `dur="0"` is kept as-is; only the two
 *     attributes above gate a cue).
 *   - Empty (whitespace-only) text -> cue skipped; inner markup such as the
 *     word-timing `<s>` is stripped before entity decoding, so an escaped
 *     `&lt;s&gt;` survives as literal text.
 *   - Entities are decoded (`&amp;`, `&#39;`, `&#x1F600;`, ...); unknown ones
 *     are left verbatim.
 *   - Truncated / malformed XML yields as many cues as could be read and
 *     never throws.
 *
 * Cues are returned in document order (timedtext payloads are time-ordered).
 */
export function parseTimedTextXml(xml: string): SubtitleSegment[] {
  if (typeof xml !== 'string' || xml === '') return [];

  const segments: SubtitleSegment[] = [];
  for (const match of xml.matchAll(TEXT_ELEMENT_RE)) {
    const start = parseSeconds(readTimeAttribute(match[1] ?? '', 'start'));
    const duration = parseSeconds(readTimeAttribute(match[1] ?? '', 'dur'));
    if (start === null || duration === null) continue;

    const text = decodeEntities((match[2] ?? '').replace(INNER_TAG_RE, '')).trim();
    if (text === '') continue;

    segments.push({
      start,
      end: start + duration,
      text,
      source: PLATFORM_SUBTITLE_SOURCE,
    });
  }

  return segments;
}

/* ------------------------------------------------------------------ */
/* ytInitialPlayerResponse -> caption tracks                           */
/* ------------------------------------------------------------------ */

/** One entry of `captions.playerCaptionsTracklistRenderer.captionTracks[]`. */
export interface CaptionTrack {
  /** Absolute timedtext URL (`baseUrl`); the caller fetches it verbatim. */
  url: string;
  /** BCP-47 code, e.g. `'en'`, `'zh-Hans'`. */
  languageCode: string | null;
  /** YouTube's track flavour — `'asr'` means auto-generated. */
  kind: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Find the `{` that opens the `ytInitialPlayerResponse` object after `from`.
 * Tolerates the embeddings seen in the wild:
 *   `var ytInitialPlayerResponse = {...}`        -> `=`
 *   `window["ytInitialPlayerResponse"] = {...}`  -> `"]` then `=`
 *   `"ytInitialPlayerResponse":{...}`            -> `:`
 * Returns -1 when this occurrence is followed by something else (`= null`, a
 * `.videoDetails` reference, a mention inside a string), so an unrelated `{`
 * further down the document is never grabbed.
 */
function playerResponseObjectStart(html: string, from: number): number {
  let i = from;
  let seenSeparator = false;
  const limit = Math.min(html.length, from + MAX_SEPARATOR_DISTANCE);

  while (i < limit) {
    const ch = html.charAt(i);
    if (ch === '=' || ch === ':') {
      seenSeparator = true;
      i++;
      break;
    }
    if (ch === '"' || ch === "'" || ch === ']' || ch === ')' || /\s/.test(ch)) {
      i++;
      continue;
    }
    return -1;
  }
  if (!seenSeparator) return -1;

  while (i < html.length && /\s/.test(html.charAt(i))) i++;
  return html.charAt(i) === '{' ? i : -1;
}

/**
 * Substring of `text` from the balanced JSON object at `start`, or null when
 * it is never closed. String state and backslash escapes are tracked — JSON
 * string delimiters are always `"` — so braces inside a value (titles,
 * descriptions, URLs) cannot end the object early. This is the reason a
 * bracket scan is used instead of a greedy regex.
 */
function extractBalancedObject(text: string, start: number): string | null {
  if (text.charAt(start) !== '{') return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text.charAt(i);

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}

function readCaptionTracks(payload: unknown): CaptionTrack[] {
  if (!isRecord(payload)) return [];
  const captions = payload['captions'];
  if (!isRecord(captions)) return [];
  const tracklist = captions['playerCaptionsTracklistRenderer'];
  if (!isRecord(tracklist)) return [];
  const rawTracks = tracklist['captionTracks'];
  if (!Array.isArray(rawTracks)) return [];

  const tracks: CaptionTrack[] = [];
  for (const raw of rawTracks) {
    if (!isRecord(raw)) continue;
    // ASSUMPTION: current payloads carry `baseUrl`; older ones used `url`.
    const rawUrl = nonEmptyString(raw['baseUrl']) ?? nonEmptyString(raw['url']);
    if (rawUrl === null) continue;

    tracks.push({
      // `\u0026` is already unescaped by JSON.parse; the entity pass is for a
      // payload that reached us through an HTML-escaped serialization.
      url: decodeEntities(rawUrl),
      languageCode: nonEmptyString(raw['languageCode']),
      kind: nonEmptyString(raw['kind']),
    });
  }
  return tracks;
}

/**
 * Extract `captions.playerCaptionsTracklistRenderer.captionTracks` from page
 * HTML — or from just the text of the inline script that defines it, which is
 * what a content script can read in the isolated world.
 *
 * The JSON object is located by bracket balancing rather than by a regex, and
 * every occurrence of the marker is tried in order because
 * `ytInitialPlayerResponse` also appears as `null` / as a dotted reference
 * earlier in a YouTube document. Returns [] when no occurrence yields a
 * usable track list — the caller then falls back to scraping the DOM.
 */
export function parseCaptionTracks(html: string): CaptionTrack[] {
  if (typeof html !== 'string' || html === '') return [];

  let cursor = 0;
  for (;;) {
    const markerAt = html.indexOf(PLAYER_RESPONSE_MARKER, cursor);
    if (markerAt < 0) return [];
    cursor = markerAt + PLAYER_RESPONSE_MARKER.length;

    const objectAt = playerResponseObjectStart(html, cursor);
    if (objectAt < 0) continue;

    const json = extractBalancedObject(html, objectAt);
    if (json === null) continue;

    let payload: unknown;
    try {
      payload = JSON.parse(json);
    } catch {
      continue;
    }

    const tracks = readCaptionTracks(payload);
    if (tracks.length > 0) return tracks;
  }
}

/* ------------------------------------------------------------------ */
/* Creator info                                                        */
/* ------------------------------------------------------------------ */

/** Priorities for `pickCreator`; ids match the KEY CONTRACT in its JSDoc. */
const CREATOR_NAME_KEYS: readonly string[] = [
  '[itemprop=author] [itemprop=name]',
  'meta[name=author]',
  'meta[itemprop=author]',
  '#owner #channel-name a',
  'ytd-video-owner-renderer #channel-name a',
];

const CREATOR_URL_KEYS: readonly string[] = [
  '[itemprop=author] [itemprop=url]',
  '#owner a.yt-simple-endpoint',
  'a.yt-simple-endpoint[href^="/@"]',
];

/** `//host/x` -> `https://host/x`, `/@x` -> `https://www.youtube.com/@x`. */
function normalizeAuthorUrl(raw: string | null): string | null {
  if (raw === null) return null;
  const value = raw.trim();
  if (value === '') return null;
  if (value.startsWith('//')) return `https:${value}`;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
  if (value.startsWith('/')) return `${YOUTUBE_ORIGIN}${value}`;
  return null;
}

/**
 * Pick creator (channel) info out of the flat "key -> value" map that the
 * CONTENT SCRIPT builds from the page DOM.
 *
 * KEY CONTRACT — keys are CSS-selector-shaped strings, so the caller can
 * literally do `map[key] = read(document.querySelector(key))`:
 *
 *   name, in priority order                     value to pass
 *   '[itemprop=author] [itemprop=name]'         `content` attr, else textContent
 *   'meta[name=author]'                         `content` attr
 *   'meta[itemprop=author]'                     `content` attr
 *   '#owner #channel-name a'                    textContent
 *   'ytd-video-owner-renderer #channel-name a'  textContent
 *
 *   url, in priority order                      value to pass
 *   '[itemprop=author] [itemprop=url]'          `href` attr
 *   '#owner a.yt-simple-endpoint'               `href` attr
 *   'a.yt-simple-endpoint[href^="/@"]'          `href` attr
 *
 * A bare '[itemprop=name]' is deliberately NOT a key: on a watch page the
 * first match is the schema.org VideoObject *title*
 * (`<meta itemprop="name">`), not the author's `<link itemprop="name">`.
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