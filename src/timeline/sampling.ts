/**
 * Playback-time sampling for the sparse visual index.
 *
 * Pure: no timers, no messaging, no storage. The side panel owns the heartbeat
 * (its 1s runtime-context poll) and the set of boundaries already covered; this
 * module only answers "what should this tick do". Keeping the decision here is
 * what makes the dedupe rule testable without a browser.
 */

import { SPARSE_INTERVAL } from './sparse-analysis';

/**
 * Upper bound on frames captured for one video. Each frame is a paid vision
 * request and playback sampling runs unattended, so without a bound a two-hour
 * lecture would spend over 700 of them. Reaching it stops sampling, and the UI
 * states the bound up front and reports when it is hit.
 */
export const MAX_SAMPLED_FRAMES = 240;

/**
 * The interval boundary a playback position falls into (0, 10, 20, …), or null
 * when the position is unknown. Snapping to the boundary is what makes dozens of
 * 1s ticks inside one 10s bucket collapse into a single capture.
 */
export function boundaryFor(
  currentTime: number | null,
  interval = SPARSE_INTERVAL,
): number | null {
  if (currentTime === null || !Number.isFinite(currentTime) || currentTime < 0) {
    return null;
  }
  if (!Number.isFinite(interval) || interval <= 0) return null;
  return Math.floor(currentTime / interval) * interval;
}

/**
 * The boundary this tick should capture, or null when it should capture nothing:
 *
 *   - unknown, non-finite or negative playback position;
 *   - a boundary already in `captured` — the same 10s bucket is never paid for
 *     twice, including after seeking backwards;
 *   - a boundary at or past `duration`, matching `candidateTimes`, which never
 *     emits a sample at or beyond the end. An unknown duration does not block
 *     sampling: the live position is still a valid place to look.
 */
export function nextSampleTime(
  currentTime: number | null,
  duration: number | null,
  captured: ReadonlySet<number>,
  interval = SPARSE_INTERVAL,
): number | null {
  const boundary = boundaryFor(currentTime, interval);
  if (boundary === null) return null;
  if (
    duration !== null &&
    Number.isFinite(duration) &&
    duration > 0 &&
    boundary >= duration
  ) {
    return null;
  }
  if (captured.has(boundary)) return null;
  return boundary;
}

/** True when the per-video capture bound has been reached. */
export function atSampleLimit(
  captured: ReadonlySet<number>,
  limit = MAX_SAMPLED_FRAMES,
): boolean {
  return captured.size >= limit;
}