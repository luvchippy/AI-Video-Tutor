import type { PageContext } from '../../types/page-context';
import type { PlatformAdapter } from '../../types/media';
import type {
  PlaybackClock,
  SubtitleSegment,
  VideoMetadata,
  CreatorInfo,
} from '../../types/playback';

/**
 * Interface-only stubs for platform-specific adapters.
 *
 * These are NOT active in the Demo — the GenericHtml5VideoAdapter already
 * handles their <video> elements. They exist to reserve clean seams for future
 * real implementations (subtitle fetch, creator extraction, DRM-free playback).
 */

function createStub(id: string, hosts: string[]): PlatformAdapter {
  return {
    id,
    match(context: PageContext) {
      let host: string;
      try {
        host = new URL(context.url).hostname.toLowerCase();
      } catch {
        return false;
      }
      return hosts.some((h) => host === h || host.endsWith(`.${h}`));
    },
    async getMetadata(): Promise<VideoMetadata> {
      // TODO: extract title/author/duration from the platform's DOM.
      return { title: null, author: null, duration: null, src: null };
    },
    async getPlaybackClock(): Promise<PlaybackClock | null> {
      // TODO: platform-specific video element discovery.
      return null;
    },
    async getSubtitles(): Promise<SubtitleSegment[]> {
      // TODO: platform-specific subtitle fetch (e.g. Bilibili danmaku/cc).
      return [];
    },
    async getCreatorInfo(): Promise<CreatorInfo | null> {
      // TODO: platform-specific creator extraction.
      return null;
    },
  };
}

export const YouTubeAdapter: PlatformAdapter = createStub('youtube', [
  'youtube.com',
  'youtu.be',
]);
export const BilibiliAdapter: PlatformAdapter = createStub('bilibili', [
  'bilibili.com',
  'b23.tv',
]);
export const DouyinAdapter: PlatformAdapter = createStub('douyin', [
  'douyin.com',
]);
export const XiaohongshuAdapter: PlatformAdapter = createStub('xiaohongshu', [
  'xiaohongshu.com',
  'xhslink.com',
]);
