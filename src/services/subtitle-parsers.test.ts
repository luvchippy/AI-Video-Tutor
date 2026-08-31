import { describe, it, expect } from 'vitest';
import { parseSrt, parseVtt, detectSubtitleFormat } from './subtitle-parsers';
import type { SubtitleSegment } from '../types/playback';

describe('parseSrt', () => {
  it('parses a basic SRT block', () => {
    const srt = `1
00:00:01,000 --> 00:00:02,500
Hello world`;
    const result = parseSrt(srt);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual<SubtitleSegment>({
      start: 1,
      end: 2.5,
      text: 'Hello world',
      source: 'external-file',
    });
  });

  it('parses multi-line cues', () => {
    const srt = `1
00:00:01,000 --> 00:00:03,000
Line one
Line two`;
    const result = parseSrt(srt);
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe('Line one\nLine two');
  });

  it('parses multiple cues blocks', () => {
    const srt = `1
00:00:01,000 --> 00:00:02,000
First

2
00:00:03,000 --> 00:00:04,000
Second`;
    const result = parseSrt(srt);
    expect(result).toHaveLength(2);
    expect(result[0]!.text).toBe('First');
    expect(result[1]!.text).toBe('Second');
  });

  it('skips empty blocks and whitespace-only text', () => {
    const srt = `1
00:00:01,000 --> 00:00:02,000
   

2
00:00:03,000 --> 00:00:04,000
Real text`;
    const result = parseSrt(srt);
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe('Real text');
  });

  it('returns empty array for invalid input', () => {
    expect(parseSrt('')).toEqual([]);
    expect(parseSrt('no timestamps here')).toEqual([]);
  });

  it('handles timestamps with milliseconds', () => {
    const srt = `1
00:01:02,500 --> 00:01:05,750
Test`;
    const result = parseSrt(srt);
    expect(result).toHaveLength(1);
    expect(result[0]!.start).toBe(62.5);
    expect(result[0]!.end).toBe(65.75);
  });
});

describe('parseVtt', () => {
  it('parses a basic VTT file with WEBVTT header', () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:02.500
Hello world`;
    const result = parseVtt(vtt);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual<SubtitleSegment>({
      start: 1,
      end: 2.5,
      text: 'Hello world',
      source: 'external-file',
    });
  });

  it('parses VTT without cue identifiers', () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:02.000
First

00:00:03.000 --> 00:00:04.000
Second`;
    const result = parseVtt(vtt);
    expect(result).toHaveLength(2);
    expect(result[0]!.text).toBe('First');
    expect(result[1]!.text).toBe('Second');
  });

  it('parses VTT with cue identifiers', () => {
    const vtt = `WEBVTT

cue-1
00:00:01.000 --> 00:00:02.000
First

cue-2
00:00:03.000 --> 00:00:04.000
Second`;
    const result = parseVtt(vtt);
    expect(result).toHaveLength(2);
    expect(result[0]!.text).toBe('First');
    expect(result[1]!.text).toBe('Second');
  });

  it('handles VTT timestamps with comma instead of dot', () => {
    const vtt = `WEBVTT

00:00:01,000 --> 00:00:02,000
Test`;
    const result = parseVtt(vtt);
    expect(result).toHaveLength(1);
    expect(result[0]!.start).toBe(1);
    expect(result[0]!.end).toBe(2);
  });

  it('ignores NOTE and STYLE blocks', () => {
    const vtt = `WEBVTT

NOTE This is a comment

STYLE
::cue { color: red; }

00:00:01.000 --> 00:00:02.000
Real`;
    const result = parseVtt(vtt);
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe('Real');
  });

  it('returns empty array for invalid input', () => {
    expect(parseVtt('')).toEqual([]);
    expect(parseVtt('no webvtt header')).toEqual([]);
  });
});

describe('detectSubtitleFormat', () => {
  it('detects .srt extension', () => {
    expect(detectSubtitleFormat('subtitles.srt')).toBe('srt');
  });

  it('detects .vtt extension', () => {
    expect(detectSubtitleFormat('subtitles.vtt')).toBe('vtt');
  });

  it('detects by content WEBVTT header', () => {
    expect(detectSubtitleFormat('file.txt', 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi')).toBe('vtt');
  });

  it('detects by content SRT pattern', () => {
    expect(detectSubtitleFormat('file.txt', '1\n00:00:01,000 --> 00:00:02,000\nHi')).toBe('srt');
  });

  it('returns null for unknown format', () => {
    expect(detectSubtitleFormat('file.txt', 'random content')).toBeNull();
  });
});
