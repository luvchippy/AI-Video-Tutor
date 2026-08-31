/**
 * Playback Context Layer types.
 * "Where exactly is the user in the video right now?"
 */

export type PlaybackState =
  | 'playing'
  | 'paused'
  | 'seeking'
  | 'ended'
  | 'unknown';

export type Confidence = 'exact' | 'estimated' | 'unknown';

/** A point-in-time snapshot of playback, safe to serialize over messaging. */
export interface PlaybackSnapshot {
  currentTime: number | null;
  duration: number | null;
  playbackRate: number;
  state: PlaybackState;
  confidence: Confidence;
}

/**
 * Abstraction over "how do I read playback position for this video".
 * Implemented per media source (page video, local file, ...).
 */
export interface PlaybackClock {
  getCurrentTime(): Promise<number | null>;
  getDuration(): Promise<number | null>;
  getPlaybackRate(): Promise<number>;
  getState(): Promise<PlaybackState>;
  getConfidence(): Confidence;
}

export type SubtitleSource =
  | 'html-track'
  | 'external-file'
  | 'embedded'
  | 'platform';

/** One subtitle/caption cue, normalized. */
export interface SubtitleSegment {
  start: number;
  end: number;
  text: string;
  source: SubtitleSource;
}

export interface VideoMetadata {
  title: string | null;
  author: string | null;
  duration: number | null;
  src: string | null;
}

export interface CreatorInfo {
  name: string | null;
  url?: string | null;
}
