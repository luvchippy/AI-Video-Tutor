import type { PageContext } from '../../types/page-context';
import type { PlatformAdapter } from '../../types/media';
import type {
  PlaybackClock,
  SubtitleSegment,
  VideoMetadata,
  CreatorInfo,
} from '../../types/playback';
import { createVideoPlaybackClock } from '../../playback/clock';
import { findMainVideo } from '../media/page-video';
import { extractTextTrackSubtitles } from '../../services/subtitle';

function extractCreatorFromMeta(): CreatorInfo | null {
  const meta =
    document.querySelector<HTMLMetaElement>('meta[name="author"]') ??
    document.querySelector<HTMLMetaElement>('meta[property="og:site_name"]');
  const name = meta?.content?.trim() ?? null;
  if (!name) return null;
  return { name, url: document.location.origin };
}

/**
 * Generic HTML5 video adapter. Handles any page with a <video> element,
 * including YouTube / Bilibili / etc. (which render HTML5 <video>).
 */
export const GenericHtml5VideoAdapter: PlatformAdapter = {
  id: 'generic',

  match(_context: PageContext): boolean {
    return true; // generic fallback matches everything
  },

  async getMetadata(): Promise<VideoMetadata> {
    const video = findMainVideo();
    return {
      title: document.title || null,
      author: extractCreatorFromMeta()?.name ?? null,
      duration: video
        ? Number.isFinite(video.duration)
          ? video.duration
          : null
        : null,
      src: video?.currentSrc ?? video?.src ?? null,
    };
  },

  async getPlaybackClock(): Promise<PlaybackClock | null> {
    const video = findMainVideo();
    return video ? createVideoPlaybackClock(video) : null;
  },

  async getSubtitles(): Promise<SubtitleSegment[]> {
    const video = findMainVideo();
    return video ? extractTextTrackSubtitles(video) : [];
  },

  async getCreatorInfo(): Promise<CreatorInfo | null> {
    return extractCreatorFromMeta();
  },
};
