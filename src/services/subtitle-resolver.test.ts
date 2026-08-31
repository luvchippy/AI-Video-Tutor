import { describe, it, expect, vi } from 'vitest';
import { resolveSubtitles } from './subtitle-resolver';
import type { SubtitleSegment } from '../types/playback';

vi.mock('./subtitle', () => ({
  extractTextTrackSubtitles: vi.fn(),
  cueToSegment: vi.fn(),
}));

import { extractTextTrackSubtitles } from './subtitle';

describe('resolveSubtitles', () => {
  it('returns external segments when provided (highest priority)', () => {
    const external: SubtitleSegment[] = [
      { start: 0, end: 2, text: 'Hello', source: 'external-file' },
    ];
    const result = resolveSubtitles({
      htmlTrackVideo: null,
      externalSegments: external,
    });
    expect(result.segments).toEqual(external);
    expect(result.sourceLabel).toBe('外部字幕文件');
    expect(result.containerNotSupported).toBe(false);
  });

  it('falls back to HTML track when no external segments', () => {
    const htmlSegs: SubtitleSegment[] = [
      { start: 1, end: 3, text: 'Hi', source: 'html-track' },
    ];
    vi.mocked(extractTextTrackSubtitles).mockReturnValue(htmlSegs);
    const result = resolveSubtitles({
      htmlTrackVideo: {} as HTMLVideoElement,
      externalSegments: null,
    });
    expect(result.segments).toEqual(htmlSegs);
    expect(result.sourceLabel).toBe('HTML 字幕轨');
  });

  it('returns empty when no source has subtitles', () => {
    vi.mocked(extractTextTrackSubtitles).mockReturnValue([]);
    const result = resolveSubtitles({
      htmlTrackVideo: {} as HTMLVideoElement,
      externalSegments: null,
    });
    expect(result.segments).toEqual([]);
    expect(result.sourceLabel).toBe('未发现字幕');
  });

  it('returns empty when external is empty array and html has no tracks', () => {
    vi.mocked(extractTextTrackSubtitles).mockReturnValue([]);
    const result = resolveSubtitles({
      htmlTrackVideo: {} as HTMLVideoElement,
      externalSegments: [],
    });
    expect(result.segments).toEqual([]);
    expect(result.sourceLabel).toBe('未发现字幕');
  });

  it('prefers external over html track even when html has subtitles', () => {
    const external: SubtitleSegment[] = [
      { start: 0, end: 2, text: 'External', source: 'external-file' },
    ];
    const htmlSegs: SubtitleSegment[] = [
      { start: 1, end: 3, text: 'HTML', source: 'html-track' },
    ];
    vi.mocked(extractTextTrackSubtitles).mockReturnValue(htmlSegs);
    const result = resolveSubtitles({
      htmlTrackVideo: {} as HTMLVideoElement,
      externalSegments: external,
    });
    expect(result.segments).toEqual(external);
    expect(result.sourceLabel).toBe('外部字幕文件');
  });
});
