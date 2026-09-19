import { findMainVideo } from '@/adapters/media/page-video';
import { snapshotFromVideo } from '@/playback/clock';
import { extractTextTrackSubtitles } from '@/services/subtitle';
import { captureVideoFrame } from '@/services/frame-capture';
import { detectPlatform } from '@/adapters/media/direct-url';
import { matchPlatform } from '@/adapters/platform/registry';
import type { PageContext } from '@/types/page-context';
import type { CreatorInfo, PlaybackSnapshot } from '@/types/playback';
import type { ContentRequest, ContentResponse } from '@/types/messaging';

const EMPTY_SNAPSHOT: PlaybackSnapshot = {
  currentTime: null,
  duration: null,
  playbackRate: 1,
  state: 'unknown',
  confidence: 'unknown',
};

/**
 * Creator lookups run a handful of `querySelector` calls, and `GET_PAGE_CONTEXT`
 * is polled once a second by the side panel, so the answer is memoized per URL
 * (the SPA navigation case). A page that has not rendered its channel block yet
 * caches null for that URL — the platform metadata and the schema.org author
 * markup are both present in the initial HTML, so the first pass already sees
 * them in practice.
 */
let creatorCache: { url: string; creator: CreatorInfo | null } | null = null;

async function readCreator(context: PageContext): Promise<CreatorInfo | null> {
  if (creatorCache?.url === context.url) return creatorCache.creator;
  const adapter = matchPlatform(context);
  const creator = adapter ? await adapter.getCreatorInfo() : null;
  creatorCache = { url: context.url, creator };
  return creator;
}

async function buildPageContext(): Promise<PageContext> {
  const host = location.hostname;
  const context: PageContext = {
    url: location.href,
    host,
    title: document.title,
    platformId: detectPlatform(host) ?? 'generic',
  };
  return { ...context, creator: await readCreator(context) };
}

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    browser.runtime.onMessage.addListener(
      (message: ContentRequest, _sender, sendResponse) => {
        handle(message)
          .then(sendResponse)
          .catch((e: unknown) =>
            sendResponse({
              type: 'ERROR',
              error: e instanceof Error ? e.message : String(e),
            } satisfies ContentResponse),
          );
        return true; // keep the channel open for the async response
      },
    );
  },
});

async function handle(message: ContentRequest): Promise<ContentResponse> {
  switch (message.type) {
    case 'GET_PAGE_CONTEXT':
      return { type: 'PAGE_CONTEXT', context: await buildPageContext() };

    case 'GET_PLAYBACK': {
      const video = findMainVideo();
      return {
        type: 'PLAYBACK',
        snapshot: video ? snapshotFromVideo(video) : EMPTY_SNAPSHOT,
      };
    }

    case 'GET_SUBTITLES': {
      const video = findMainVideo();
      return {
        type: 'SUBTITLES',
        segments: video ? extractTextTrackSubtitles(video) : [],
      };
    }

    case 'GET_VIDEO_RECT': {
      const video = findMainVideo();
      const viewport = {
        width: window.innerWidth,
        height: window.innerHeight,
      };
      if (!video) return { type: 'VIDEO_RECT', rect: null, viewport };
      const r = video.getBoundingClientRect();
      return {
        type: 'VIDEO_RECT',
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        viewport,
      };
    }

    case 'CAPTURE_FRAME_CANVAS': {
      const video = findMainVideo();
      if (!video) return { type: 'FRAME_DATA_URL', dataUrl: null };
      // null means the canvas was tainted (cross-origin) or capture failed
      return { type: 'FRAME_DATA_URL', dataUrl: captureVideoFrame(video) };
    }

    case 'SEEK': {
      const video = findMainVideo();
      if (video) {
        try {
          video.currentTime = message.time;
        } catch {
          // seek may fail on some live streams; ignore
        }
      }
      return { type: 'SEEK_ACK', ok: video != null };
    }

    default:
      return { type: 'ERROR', error: 'unknown message type' };
  }
}
