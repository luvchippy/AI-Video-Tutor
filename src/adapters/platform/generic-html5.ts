import type { PageContext } from '../../types/page-context';
import type { PlatformAdapter } from '../../types/media';
import type { CreatorInfo } from '../../types/playback';
import { createDomPlatformAdapter } from './dom-adapter';

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
 *
 * Its `match()` returns true for everything, so it MUST stay last in
 * `ACTIVE_ADAPTERS` — a platform adapter listed after it would never be
 * reached.
 */
export const GenericHtml5VideoAdapter: PlatformAdapter = createDomPlatformAdapter({
  id: 'generic',

  match(_context: PageContext): boolean {
    return true; // generic fallback matches everything
  },

  creatorFromDom: extractCreatorFromMeta,
});