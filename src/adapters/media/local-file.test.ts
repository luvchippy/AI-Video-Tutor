import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  isSupportedVideoFile,
  createObjectUrl,
  revokeObjectUrl,
} from './local-file';

describe('isSupportedVideoFile', () => {
  it('accepts known MIME types', () => {
    expect(isSupportedVideoFile(new File([], 'a.mp4', { type: 'video/mp4' }))).toBe(true);
    expect(isSupportedVideoFile(new File([], 'a.webm', { type: 'video/webm' }))).toBe(true);
  });

  it('falls back to extension for empty MIME', () => {
    expect(isSupportedVideoFile(new File([], 'a.mkv', { type: '' }))).toBe(true);
    expect(isSupportedVideoFile(new File([], 'a.txt', { type: '' }))).toBe(false);
  });

  it('rejects non-video files', () => {
    expect(isSupportedVideoFile(new File([], 'a.pdf', { type: 'application/pdf' }))).toBe(false);
  });
});

describe('object URL lifecycle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('createObjectUrl calls URL.createObjectURL', () => {
    const stub = vi.fn(() => 'blob:fake');
    vi.stubGlobal('URL', { ...URL, createObjectURL: stub, revokeObjectURL: vi.fn() });
    const url = createObjectUrl(new Blob(['x']));
    expect(stub).toHaveBeenCalledOnce();
    expect(url).toBe('blob:fake');
  });

  it('revokeObjectUrl calls URL.revokeObjectURL', () => {
    const revoke = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(), revokeObjectURL: revoke });
    revokeObjectUrl('blob:fake');
    expect(revoke).toHaveBeenCalledWith('blob:fake');
  });

  it('revokeObjectUrl does not throw on invalid URL', () => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(),
      revokeObjectURL: () => {
        throw new Error('boom');
      },
    });
    expect(() => revokeObjectUrl('blob:bad')).not.toThrow();
  });
});
