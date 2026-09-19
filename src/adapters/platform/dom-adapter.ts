/**
 * Factory for the DOM-side `PlatformAdapter` implementations.
 *
 * Every adapter that runs in the content script answers the same four questions
 * from the same live DOM (which `<video>` is playing, how far in, which
 * `<track>` cues it has). Only `getCreatorInfo` is genuinely platform-specific,
 * so it is the one piece each adapter supplies; the rest is built here once.
 *
 * The split with `platform-sources.ts` is deliberate: captions that only the
 * platform's own API can serve are fetched by the BACKGROUND, because a
 * content-script `fetch` is bound by the page's CORS policy and these endpoints
 * send no `Access-Control-Allow-Origin`. See that module's header.
 */

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
import type { CreatorMetaValue } from './creator-meta';

/**
 * A reader that looks one CSS selector up in the page and reports every value
 * that element could carry. Which one a key wants is decided by the platform
 * module's `collectCreatorMeta`, not here.
 *
 * A missing element yields `undefined`, so the caller's map keeps the same
 * shape on every page.
 */
export function domMetaReader(): (
  selector: string,
) => CreatorMetaValue | undefined {
  return (selector: string) => {
    const element = document.querySelector(selector);
    if (element === null) return undefined;
    return {
      content: element.getAttribute('content') ?? undefined,
      text: element.textContent?.trim() || undefined,
      href: element.getAttribute('href') ?? undefined,
    };
  };
}

export interface DomAdapterSpec {
  id: string;
  /** Host-based in practice; receives the full context for future use. */
  match(context: PageContext): boolean;
  /** Read the creator/uploader from the live DOM, or null when not identifiable. */
  creatorFromDom(): CreatorInfo | null;
}

export function createDomPlatformAdapter(spec: DomAdapterSpec): PlatformAdapter {
  return {
    id: spec.id,

    match: spec.match,

    async getMetadata(): Promise<VideoMetadata> {
      const video = findMainVideo();
      return {
        title: document.title || null,
        author: spec.creatorFromDom()?.name ?? null,
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
      return spec.creatorFromDom();
    },
  };
}