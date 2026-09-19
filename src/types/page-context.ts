/**
 * Page Context Layer types.
 * "What website am I on, right now?"
 */

import type { CreatorInfo } from './playback';

export interface PageContext {
  /** Full page URL. */
  url: string;
  /** Hostname only (e.g. "www.youtube.com"). */
  host: string;
  /** document.title */
  title: string;
  /** Matched platform adapter id, or "generic". */
  platformId: string;
  /**
   * Channel / uploader read from the page markup, when the platform exposes it.
   * Stored and displayed only — it is never sent to a model. See the privacy
   * policy, section 3.
   */
  creator?: CreatorInfo | null;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
