import type { DirectUrlClassification } from '../../types/media';

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|mkv|avi|ogg|ogv|m3u8|ts)(\?|#|$)/i;

export interface PlatformHost {
  id: string;
  hosts: string[];
}

export const PLATFORM_HOSTS: PlatformHost[] = [
  { id: 'youtube', hosts: ['youtube.com', 'youtu.be', 'm.youtube.com', 'www.youtube.com'] },
  { id: 'bilibili', hosts: ['bilibili.com', 'b23.tv', 'www.bilibili.com'] },
  { id: 'douyin', hosts: ['douyin.com', 'iesdouyin.com', 'www.douyin.com'] },
  { id: 'xiaohongshu', hosts: ['xiaohongshu.com', 'xhslink.com', 'www.xiaohongshu.com'] },
];

/** Extract the video file extension from a URL path, if any. */
export function videoExtension(pathname: string): string | null {
  const m = pathname.match(VIDEO_EXT);
  return m ? m[1]!.toLowerCase() : null;
}

/** Detect the platform of a URL host, if it is a known video platform. */
export function detectPlatform(hostname: string): string | null {
  const host = hostname.toLowerCase();
  for (const p of PLATFORM_HOSTS) {
    if (p.hosts.some((h) => host === h || host.endsWith(`.${h}`))) {
      return p.id;
    }
  }
  return null;
}

/**
 * Classify a pasted URL as a direct media URL, a platform page URL, or unknown.
 */
export function classifyUrl(raw: string): DirectUrlClassification {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { kind: 'unknown', extension: null, platformId: null };
  }

  const ext = videoExtension(url.pathname);
  if (ext) {
    return { kind: 'direct-media', extension: ext, platformId: null };
  }

  const platformId = detectPlatform(url.hostname);
  if (platformId) {
    return { kind: 'platform-url', extension: null, platformId };
  }

  return { kind: 'unknown', extension: null, platformId: null };
}
