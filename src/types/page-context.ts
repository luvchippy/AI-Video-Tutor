/**
 * Page Context Layer types.
 * "What website am I on, right now?"
 */

export interface PageContext {
  /** Full page URL. */
  url: string;
  /** Hostname only (e.g. "www.youtube.com"). */
  host: string;
  /** document.title */
  title: string;
  /** Matched platform adapter id, or "generic". */
  platformId: string;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
