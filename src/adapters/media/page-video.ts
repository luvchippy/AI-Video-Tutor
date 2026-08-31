import type { MediaSourceAdapter, MediaSourceDescription } from '../../types/media';

export interface VideoCandidate {
  paused: boolean;
  visible: boolean;
  inViewport: boolean;
  area: number;
  duration: number | null;
}

/**
 * Score a candidate <video> for "is this the main video the user is watching?"
 * Precedence: playing > visible > in-viewport > area > duration.
 * Never just pick the first element.
 */
export function scoreVideo(c: VideoCandidate): number {
  let score = 0;
  if (!c.paused) score += 100;
  if (c.visible) score += 50;
  if (c.inViewport) score += 30;
  score += Math.min(c.area / 1000, 40);
  if (c.duration !== null && c.duration > 0) {
    score += Math.min(c.duration / 10, 20);
  }
  return score;
}

export function candidateFromElement(
  video: HTMLVideoElement,
  viewportW: number,
  viewportH: number,
): VideoCandidate {
  const rect = video.getBoundingClientRect();
  const visible = video.offsetWidth > 0 && video.offsetHeight > 0;
  const inViewport =
    rect.width > 0 &&
    rect.height > 0 &&
    rect.left < viewportW &&
    rect.right > 0 &&
    rect.top < viewportH &&
    rect.bottom > 0;
  const area = rect.width * rect.height;
  const duration = Number.isFinite(video.duration) ? video.duration : null;
  return {
    paused: video.paused,
    visible,
    inViewport,
    area,
    duration,
  };
}

export function findMainVideo(doc: Document = document): HTMLVideoElement | null {
  const videos = Array.from(doc.querySelectorAll('video'));
  if (videos.length === 0) return null;
  const vw = doc.defaultView?.innerWidth ?? 0;
  const vh = doc.defaultView?.innerHeight ?? 0;

  let best: HTMLVideoElement | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const v of videos) {
    const s = scoreVideo(candidateFromElement(v, vw, vh));
    if (s > bestScore) {
      bestScore = s;
      best = v;
    }
  }
  return best;
}

export const PageVideoSource: MediaSourceAdapter = {
  type: 'page-video',
  id: 'page-video',
  async detect(): Promise<MediaSourceDescription> {
    const video = findMainVideo();
    if (!video) {
      return {
        type: 'page-video',
        id: 'page-video',
        label: '网页视频',
        available: false,
        limitation: '当前网页没有检测到视频。',
      };
    }
    return {
      type: 'page-video',
      id: 'page-video',
      label: '网页视频',
      available: true,
    };
  },
};
