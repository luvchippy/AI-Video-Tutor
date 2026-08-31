import type { SubtitleSegment } from '../types/playback';

type SubtitleFormat = 'srt' | 'vtt';

/**
 * Parse a VTT/SRT timestamp into seconds.
 * Accepts both `.` and `,` as the millisecond separator.
 * Supports `HH:MM:SS.mmm`, `MM:SS.mmm`, and `SS.mmm`.
 */
function parseTimestamp(ts: string): number | null {
  const normalized = ts.trim().replace(',', '.');
  const match = /(?:(\d+):)?(?:(\d+):)?(\d+(?:\.\d+)?)/.exec(normalized);
  if (!match) return null;
  const h = match[1] ? parseInt(match[1], 10) : 0;
  const m = match[2] ? parseInt(match[2], 10) : 0;
  const s = parseFloat(match[3] ?? '0');
  if (!Number.isFinite(s)) return null;
  return h * 3600 + m * 60 + s;
}

function parseTimeRange(line: string): { start: number; end: number } | null {
  const match = /(\d{1,2}:\d{2}:\d{2}[.,]\d{3}|\d{1,2}:\d{2}[.,]\d{3}|\d+[.,]\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{3}|\d{1,2}:\d{2}[.,]\d{3}|\d+[.,]\d{3})/.exec(
    line,
  );
  if (!match) return null;
  const start = parseTimestamp(match[1] ?? '');
  const end = parseTimestamp(match[2] ?? '');
  if (start === null || end === null) return null;
  return { start, end };
}

function makeSegment(start: number, end: number, text: string): SubtitleSegment | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (end <= start) return null;
  return { start, end, text: trimmed, source: 'external-file' };
}

/**
 * Parse SubRip (.srt) subtitle text into SubtitleSegment[].
 * Format: index line, time range line, text lines, blank line separator.
 */
export function parseSrt(text: string): SubtitleSegment[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalized) return [];
  const blocks = normalized.split(/\n\s*\n/);
  const segments: SubtitleSegment[] = [];

  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.length > 0);
    if (lines.length < 2) continue;
    const rangeLine = lines.find((l) => l.includes('-->'));
    if (!rangeLine) continue;
    const range = parseTimeRange(rangeLine);
    if (!range) continue;
    const textStart = lines.indexOf(rangeLine) + 1;
    const cueText = lines.slice(textStart).join('\n');
    const seg = makeSegment(range.start, range.end, cueText);
    if (seg) segments.push(seg);
  }

  return segments;
}

/**
 * Parse WebVTT (.vtt) subtitle text into SubtitleSegment[].
 * Skips WEBVTT header, NOTE blocks, STYLE blocks, and cue identifiers.
 */
export function parseVtt(text: string): SubtitleSegment[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalized) return [];

  const lines = normalized.split('\n');
  const segments: SubtitleSegment[] = [];
  let i = 0;

  // Skip WEBVTT header line
  if (lines[0]?.startsWith('WEBVTT')) {
    i = 1;
  }

  while (i < lines.length) {
    const line = lines[i] ?? '';

    // Skip empty lines
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Skip NOTE blocks
    if (line.startsWith('NOTE')) {
      i++;
      while (i < lines.length && (lines[i] ?? '').trim() !== '') i++;
      continue;
    }

    // Skip STYLE / REGION blocks
    if (line.startsWith('STYLE') || line.startsWith('REGION')) {
      i++;
      while (i < lines.length && (lines[i] ?? '').trim() !== '') i++;
      continue;
    }

    // Check if this line is a time range
    const range = parseTimeRange(line);
    if (range) {
      i++;
      const cueLines: string[] = [];
      while (i < lines.length && (lines[i] ?? '').trim() !== '') {
        cueLines.push(lines[i] ?? '');
        i++;
      }
      const seg = makeSegment(range.start, range.end, cueLines.join('\n'));
      if (seg) segments.push(seg);
      continue;
    }

    // Otherwise it might be a cue identifier — check the next line
    const nextLine = lines[i + 1] ?? '';
    const nextRange = parseTimeRange(nextLine);
    if (nextRange) {
      // This line is a cue identifier, skip it
      i++;
      continue;
    }

    i++;
  }

  return segments;
}

/**
 * Detect subtitle format from filename extension or content.
 * Returns 'srt', 'vtt', or null if unknown.
 */
export function detectSubtitleFormat(
  filename: string,
  content?: string,
): SubtitleFormat | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.srt')) return 'srt';
  if (lower.endsWith('.vtt')) return 'vtt';

  if (content) {
    const trimmed = content.trim();
    if (trimmed.startsWith('WEBVTT')) return 'vtt';
    if (/^\d+\s*\n\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->/.test(trimmed)) return 'srt';
  }

  return null;
}
