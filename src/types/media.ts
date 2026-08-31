/**
 * Media Acquisition Layer types.
 * PlatformAdapter (what site) is SEPARATE from MediaSourceAdapter (where the
 * video bytes come from). Do not conflate them.
 */

import type { PageContext } from './page-context';
import type {
  PlaybackClock,
  SubtitleSegment,
  VideoMetadata,
  CreatorInfo,
} from './playback';

/** Where does the video content actually come from? */
export type MediaSourceType =
  | 'page-video'
  | 'local-file'
  | 'direct-url'
  | 'platform-url'
  | 'tab-capture';

/**
 * Knows about a specific website (YouTube, Bilibili, generic HTML5, ...).
 */
export interface PlatformAdapter {
  id: string;
  match(context: PageContext): boolean;
  getMetadata(): Promise<VideoMetadata>;
  getPlaybackClock(): Promise<PlaybackClock | null>;
  getSubtitles(): Promise<SubtitleSegment[]>;
  getCreatorInfo(): Promise<CreatorInfo | null>;
}

/**
 * Describes a detected media source. `available: false` + `limitation` is the
 * honest "we cannot read this" signal — never fake success.
 */
export interface MediaSourceDescription {
  type: MediaSourceType;
  id: string;
  label: string;
  available: boolean;
  limitation?: string;
}

export interface MediaSourceAdapter {
  type: MediaSourceType;
  id: string;
  detect(): Promise<MediaSourceDescription>;
}

/** Result of classifying a pasted URL. */
export interface DirectUrlClassification {
  kind: 'direct-media' | 'platform-url' | 'unknown';
  extension: string | null;
  platformId: string | null;
}
