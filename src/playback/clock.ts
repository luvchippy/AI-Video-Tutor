import type {
  Confidence,
  PlaybackClock,
  PlaybackSnapshot,
  PlaybackState,
} from '../types/playback';

export interface VideoStateInput {
  paused: boolean;
  ended: boolean;
  seeking: boolean;
  currentTime: number | null;
  duration: number | null;
}

/** Pure: derive a PlaybackState from raw video element values. */
export function derivePlaybackState(input: VideoStateInput): PlaybackState {
  if (input.seeking) return 'seeking';
  if (input.ended) return 'ended';
  if (input.currentTime === null) return 'unknown';
  return input.paused ? 'paused' : 'playing';
}

/** Pure: how sure are we about the position? */
export function deriveConfidence(
  duration: number | null | undefined,
): Confidence {
  if (duration != null && Number.isFinite(duration) && duration > 0) {
    return 'exact';
  }
  if (duration != null && Number.isFinite(duration)) {
    return 'estimated';
  }
  return 'unknown';
}

/**
 * A PlaybackClock backed by a live <video> element. Used by both the page-video
 * adapter (content script) and the local-file player (side panel).
 */
export function createVideoPlaybackClock(video: HTMLVideoElement): PlaybackClock {
  return {
    async getCurrentTime() {
      const t = video.currentTime;
      return Number.isFinite(t) ? t : null;
    },
    async getDuration() {
      const d = video.duration;
      return Number.isFinite(d) ? d : null;
    },
    async getPlaybackRate() {
      const r = video.playbackRate;
      return Number.isFinite(r) && r > 0 ? r : 1;
    },
    async getState() {
      return derivePlaybackState({
        paused: video.paused,
        ended: video.ended,
        seeking: video.seeking,
        currentTime: Number.isFinite(video.currentTime)
          ? video.currentTime
          : null,
        duration: Number.isFinite(video.duration) ? video.duration : null,
      });
    },
    getConfidence() {
      return deriveConfidence(video.duration);
    },
  };
}

/** One-shot snapshot, safe to serialize over messaging. */
export function snapshotFromVideo(video: HTMLVideoElement): PlaybackSnapshot {
  const currentTime = Number.isFinite(video.currentTime)
    ? video.currentTime
    : null;
  const duration = Number.isFinite(video.duration) ? video.duration : null;
  return {
    currentTime,
    duration,
    playbackRate: Number.isFinite(video.playbackRate) ? video.playbackRate : 1,
    state: derivePlaybackState({
      paused: video.paused,
      ended: video.ended,
      seeking: video.seeking,
      currentTime,
      duration,
    }),
    confidence: deriveConfidence(duration),
  };
}
