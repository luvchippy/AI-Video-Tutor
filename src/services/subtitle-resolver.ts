import type { SubtitleSegment } from '../types/playback';
import { extractTextTrackSubtitles } from './subtitle';

export interface SubtitleResolverResult {
  segments: SubtitleSegment[];
  /** Human-readable summary of which source was used. */
  sourceLabel: string;
  /** When container subtitles were detected but not extractable. */
  containerNotSupported: boolean;
}

export interface SubtitleResolverInput {
  /** HTML5 <track> subtitles from video.textTracks (page video only). */
  htmlTrackVideo: HTMLVideoElement | null;
  /** External subtitles loaded from a .srt/.vtt file. */
  externalSegments: SubtitleSegment[] | null;
  /**
   * The same <track> cues, already extracted. The background has no DOM, so the
   * content script reads them and hands them over; supplying them here skips the
   * DOM extraction and keeps one priority order in one place.
   */
  htmlSegments?: SubtitleSegment[] | null;
  /**
   * Captions already fetched from the platform's own API (YouTube timedtext,
   * Bilibili subtitle JSON). Fetching is asynchronous and needs the background
   * service worker's cross-origin access, so it happens BEFORE this call and the
   * segments are handed in ready to use — which keeps this function pure.
   */
  platformSegments?: SubtitleSegment[] | null;
}

/**
 * Resolve subtitles from multiple sources by priority:
 *   1. External SRT/VTT (user-loaded) — highest, most reliable for local video
 *   2. HTML <track> textTracks — for page videos with embedded <track> elements
 *   3. Platform CC (YouTube/Bilibili) — fetched by the background, see
 *      `adapters/platform/platform-sources.ts`
 *
 * All sources are normalized to SubtitleSegment[] with a `source` tag.
 * Timeline/RAG consumers do not need to know the origin.
 */
export function resolveSubtitles(input: SubtitleResolverInput): SubtitleResolverResult {
  // 1. External file (user-loaded .srt/.vtt) — highest priority
  if (input.externalSegments && input.externalSegments.length > 0) {
    return {
      segments: input.externalSegments,
      sourceLabel: '外部字幕文件',
      containerNotSupported: false,
    };
  }

  // 2. HTML <track> textTracks
  const htmlSegments =
    input.htmlSegments ??
    (input.htmlTrackVideo ? extractTextTrackSubtitles(input.htmlTrackVideo) : []);
  if (htmlSegments.length > 0) {
    return {
      segments: htmlSegments,
      sourceLabel: 'HTML 字幕轨',
      containerNotSupported: false,
    };
  }

  // 3. Platform CC (YouTube / Bilibili)
  if (input.platformSegments && input.platformSegments.length > 0) {
    return {
      segments: input.platformSegments,
      sourceLabel: '平台字幕',
      containerNotSupported: false,
    };
  }

  return {
    segments: [],
    sourceLabel: '未发现字幕',
    containerNotSupported: false,
  };
}
