import type { SubtitleSegment } from '../types/playback';

/** Pure: normalize a cue-like object into a SubtitleSegment (or null). */
export function cueToSegment(cue: {
  startTime: number;
  endTime: number;
  text: string;
}): SubtitleSegment | null {
  const text = (cue.text ?? '').trim();
  if (!text) return null;
  if (!Number.isFinite(cue.startTime) || !Number.isFinite(cue.endTime)) return null;
  if (cue.endTime <= cue.startTime) return null;
  return { start: cue.startTime, end: cue.endTime, text, source: 'html-track' };
}

function cueText(cue: TextTrackCue): string {
  const vt = cue as VTTCue;
  return typeof vt.text === 'string' ? vt.text : '';
}

/**
 * Extract subtitles from a <video>'s TextTracks (kind=subtitles|captions).
 * Setting track.mode='hidden' forces the browser to load the cues.
 */
export function extractTextTrackSubtitles(video: HTMLVideoElement): SubtitleSegment[] {
  const tracks = Array.from(video.textTracks ?? []);
  const segments: SubtitleSegment[] = [];

  for (const track of tracks) {
    if (track.kind !== 'subtitles' && track.kind !== 'captions') continue;
    try {
      if (track.mode === 'disabled') track.mode = 'hidden';
    } catch {
      // some tracks cannot change mode; skip
      continue;
    }
    const cues = track.cues;
    if (!cues) continue;
    for (let i = 0; i < cues.length; i++) {
      const cue = cues[i];
      if (!cue) continue;
      const seg = cueToSegment({
        startTime: cue.startTime,
        endTime: cue.endTime,
        text: cueText(cue),
      });
      if (seg) segments.push(seg);
    }
  }

  return segments.sort((a, b) => a.start - b.start);
}

export const NO_SUBTITLES_MESSAGE = '当前视频没有发现可读取字幕。';
