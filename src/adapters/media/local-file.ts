import type { MediaSourceAdapter, MediaSourceDescription } from '../../types/media';

const SUPPORTED_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska', 'video/ogg'];

export function isSupportedVideoFile(file: File): boolean {
  if (SUPPORTED_TYPES.includes(file.type)) return true;
  // fall back to extension check for files with an empty/unknown MIME
  return /\.(mp4|webm|mov|mkv|ogg|ogv)$/i.test(file.name);
}

export function createObjectUrl(file: Blob): string {
  return URL.createObjectURL(file);
}

export function revokeObjectUrl(url: string): void {
  try {
    URL.revokeObjectURL(url);
  } catch {
    // ignore
  }
}

/**
 * LocalFileSource — a video the user dragged into the side panel. The actual
 * <video> element and controls live in the LocalVideoPlayer component (T25);
 * this adapter owns the object-URL lifecycle.
 */
export const LocalFileSource: MediaSourceAdapter = {
  type: 'local-file',
  id: 'local-file',
  async detect(): Promise<MediaSourceDescription> {
    return {
      type: 'local-file',
      id: 'local-file',
      label: '本地视频',
      available: true,
    };
  },
};
