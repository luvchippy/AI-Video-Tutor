import type { PageContext } from '../../types/page-context';
import type { PlatformAdapter } from '../../types/media';
import { GenericHtml5VideoAdapter } from './generic-html5';
import { createDomPlatformAdapter, domMetaReader } from './dom-adapter';
import {
  matchesHost as matchesYouTube,
  collectCreatorMeta as collectYouTubeCreatorMeta,
  pickCreator as pickYouTubeCreator,
} from './youtube';
import {
  matchesHost as matchesBilibili,
  collectCreatorMeta as collectBilibiliCreatorMeta,
  pickCreator as pickBilibiliCreator,
} from './bilibili';

/**
 * Platform registry — the DOM-SIDE half of platform support.
 *
 * Each adapter here answers "what is playing on this page" from the live DOM.
 * The other half — captions that only the platform's own API serves — runs in
 * the background service worker and is registered separately, in
 * `platform-sources.ts`. Neither half duplicates the other's job, because the
 * content script cannot make those cross-origin requests and the service worker
 * has no DOM.
 *
 * ORDER MATTERS: `matchPlatform` scans `ACTIVE_ADAPTERS` in order and the
 * generic adapter matches every page, so it must stay last.
 */

/** The page's hostname, falling back to the one the page context already has. */
function hostOf(context: PageContext): string {
  try {
    return new URL(context.url).hostname;
  } catch {
    return context.host;
  }
}

export const YouTubeAdapter: PlatformAdapter = createDomPlatformAdapter({
  id: 'youtube',
  match: (context) => matchesYouTube(hostOf(context)),
  creatorFromDom: () =>
    pickYouTubeCreator(collectYouTubeCreatorMeta(domMetaReader())),
});

export const BilibiliAdapter: PlatformAdapter = createDomPlatformAdapter({
  id: 'bilibili',
  match: (context) => matchesBilibili(hostOf(context)),
  creatorFromDom: () =>
    pickBilibiliCreator(collectBilibiliCreatorMeta(domMetaReader())),
});

export const ACTIVE_ADAPTERS: PlatformAdapter[] = [
  YouTubeAdapter,
  BilibiliAdapter,
  GenericHtml5VideoAdapter,
];

export function matchPlatform(context: PageContext): PlatformAdapter | null {
  for (const adapter of ACTIVE_ADAPTERS) {
    if (adapter.match(context)) return adapter;
  }
  return null;
}

/** Human label for the current page's platform ("Generic", "Bilibili", ...). */
export function platformLabel(platformId: string): string {
  const labels: Record<string, string> = {
    generic: 'Generic',
    youtube: 'YouTube',
    bilibili: 'Bilibili',
    douyin: 'Douyin',
    xiaohongshu: 'Xiaohongshu',
  };
  return labels[platformId] ?? platformId;
}