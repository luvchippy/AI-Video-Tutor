import { describe, it, expect } from 'vitest';
import { classifyUrl, videoExtension, detectPlatform } from './direct-url';

describe('classifyUrl', () => {
  it('recognizes a direct .mp4 media URL', () => {
    expect(classifyUrl('https://x.com/video.mp4')).toEqual({
      kind: 'direct-media',
      extension: 'mp4',
      platformId: null,
    });
  });

  it('recognizes .webm with query string', () => {
    expect(classifyUrl('https://cdn.example.com/clip.webm?token=1')).toEqual({
      kind: 'direct-media',
      extension: 'webm',
      platformId: null,
    });
  });

  it('recognizes a YouTube platform URL', () => {
    expect(classifyUrl('https://www.youtube.com/watch?v=abc123')).toEqual({
      kind: 'platform-url',
      extension: null,
      platformId: 'youtube',
    });
  });

  it('recognizes a Bilibili platform URL', () => {
    expect(classifyUrl('https://www.bilibili.com/video/BV1xx411c7mD')).toEqual({
      kind: 'platform-url',
      extension: null,
      platformId: 'bilibili',
    });
  });

  it('returns unknown for a non-video URL', () => {
    expect(classifyUrl('https://example.com/about')).toEqual({
      kind: 'unknown',
      extension: null,
      platformId: null,
    });
  });

  it('returns unknown for invalid input', () => {
    expect(classifyUrl('not a url')).toEqual({
      kind: 'unknown',
      extension: null,
      platformId: null,
    });
  });
});

describe('helpers', () => {
  it('videoExtension extracts the extension', () => {
    expect(videoExtension('/a/b/video.mkv')).toBe('mkv');
    expect(videoExtension('/a/b/not-a-video.html')).toBeNull();
  });

  it('detectPlatform matches subdomains', () => {
    expect(detectPlatform('www.bilibili.com')).toBe('bilibili');
    expect(detectPlatform('unknown.com')).toBeNull();
  });
});
