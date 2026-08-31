import type { PageContext } from '../../types/page-context';
import type { PlatformAdapter } from '../../types/media';
import { GenericHtml5VideoAdapter } from './generic-html5';

/**
 * Platform registry. For the Demo only the GenericHtml5VideoAdapter is active;
 * YouTube / Bilibili / Douyin / Xiaohongshu are interface stubs (see stubs.ts)
 * and are intentionally NOT registered yet — the generic adapter already reads
 * their <video> elements.
 */
export const ACTIVE_ADAPTERS: PlatformAdapter[] = [GenericHtml5VideoAdapter];

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
