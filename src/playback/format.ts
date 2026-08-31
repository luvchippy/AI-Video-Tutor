/**
 * Time formatting helpers.
 */

/** seconds -> "mm:ss" or "h:mm:ss" */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** "current / duration" — e.g. "08:43 / 24:12" */
export function formatClock(
  current: number | null | undefined,
  duration: number | null | undefined,
): string {
  const cur = formatTime(current ?? 0);
  const dur = formatTime(duration ?? 0);
  return `${cur} / ${dur}`;
}
