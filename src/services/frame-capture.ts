import type { Rect } from '../types/page-context';

export interface FrameCaptureOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
}

const DEFAULT_MAX_WIDTH = 480;
const DEFAULT_QUALITY = 0.72;

/**
 * Compute the source crop region for a full-tab screenshot given the video's
 * viewport-relative bounding rect. Pure + unit-testable.
 */
export function videoCropRegion(
  rect: Rect,
  imgWidth: number,
  imgHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const scaleX = viewportWidth > 0 ? imgWidth / viewportWidth : 1;
  const scaleY = viewportHeight > 0 ? imgHeight / viewportHeight : 1;
  const sx = rect.x * scaleX;
  const sy = rect.y * scaleY;
  const sw = rect.width * scaleX;
  const sh = rect.height * scaleY;
  return { sx, sy, sw, sh };
}

function scaleCanvas(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  maxWidth: number,
  quality: number,
): string {
  const ratio = Math.min(1, maxWidth / Math.max(1, srcW));
  const w = Math.max(1, Math.round(srcW * ratio));
  const h = Math.max(1, Math.round(srcH * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.drawImage(source, 0, 0, srcW, srcH, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Capture a frame from a same-origin (or untainted) <video> via canvas.
 * Returns a data URL, or null if the canvas is tainted (cross-origin) or fails.
 */
export function captureVideoFrame(
  video: HTMLVideoElement,
  opts: FrameCaptureOptions = {},
): string | null {
  const maxWidth = opts.maxWidth ?? DEFAULT_MAX_WIDTH;
  const quality = opts.quality ?? DEFAULT_QUALITY;
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;
  try {
    return scaleCanvas(video, w, h, maxWidth, quality);
  } catch {
    // Tainted canvas (cross-origin video) — caller should fall back to tab capture.
    return null;
  }
}

/**
 * Crop the video region out of a full-tab screenshot (chrome.tabs.captureVisibleTab)
 * using the video's bounding rect. Returns a downscaled JPEG data URL.
 */
export function cropFrameFromImage(
  image: HTMLImageElement,
  rect: Rect,
  viewportWidth: number,
  viewportHeight: number,
  opts: FrameCaptureOptions = {},
): string {
  const maxWidth = opts.maxWidth ?? DEFAULT_MAX_WIDTH;
  const quality = opts.quality ?? DEFAULT_QUALITY;
  const region = videoCropRegion(rect, image.naturalWidth, image.naturalHeight, viewportWidth, viewportHeight);
  const sw = Math.max(1, Math.round(region.sw));
  const sh = Math.max(1, Math.round(region.sh));
  const canvas = document.createElement('canvas');
  const ratio = Math.min(1, maxWidth / Math.max(1, sw));
  canvas.width = Math.max(1, Math.round(sw * ratio));
  canvas.height = Math.max(1, Math.round(sh * ratio));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.drawImage(
    image,
    region.sx,
    region.sy,
    sw,
    sh,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas.toDataURL('image/jpeg', quality);
}

export const NO_FRAME_MESSAGE = '当前网站无法直接获取视频画面。仍可根据字幕进行学习。';

/* ------------------------------------------------------------------ */
/* Service-worker-safe cropping (OffscreenCanvas + createImageBitmap).  */
/* Used by the background to crop chrome.tabs.captureVisibleTab output. */
/* ------------------------------------------------------------------ */

export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const meta = dataUrl.slice(0, comma);
  const b64 = dataUrl.slice(comma + 1);
  const mime = /data:(.*?);base64/.exec(meta)?.[1] ?? 'image/png';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Crop a full-page/tab screenshot (data URL) to the video region using
 * OffscreenCanvas — works in the MV3 service worker (no DOM).
 */
export async function cropDataUrl(
  dataUrl: string,
  rect: Rect,
  viewportWidth: number,
  viewportHeight: number,
  opts: FrameCaptureOptions = {},
): Promise<string> {
  const maxWidth = opts.maxWidth ?? DEFAULT_MAX_WIDTH;
  const quality = opts.quality ?? DEFAULT_QUALITY;
  const bitmap = await createImageBitmap(dataUrlToBlob(dataUrl));
  const region = videoCropRegion(
    rect,
    bitmap.width,
    bitmap.height,
    viewportWidth,
    viewportHeight,
  );
  const ratio = Math.min(1, maxWidth / Math.max(1, region.sw));
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(region.sw * ratio)),
    Math.max(1, Math.round(region.sh * ratio)),
  );
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('offscreen canvas 2d context unavailable');
  ctx.drawImage(
    bitmap,
    region.sx,
    region.sy,
    region.sw,
    region.sh,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  const out = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  return blobToDataUrl(out);
}
