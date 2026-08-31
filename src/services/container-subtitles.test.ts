import { describe, it, expect } from 'vitest';
import { extractContainerSubtitles, CONTAINER_SUBTITLE_NOT_SUPPORTED_MESSAGE } from './container-subtitles';

const encoder = new TextEncoder();

function makeBox(type: string, body: Uint8Array): Uint8Array {
  const typeBytes = encoder.encode(type);
  const size = 8 + body.length;
  const buf = new Uint8Array(size);
  const view = new DataView(buf.buffer);
  view.setUint32(0, size, false);
  buf.set(typeBytes, 4);
  buf.set(body, 8);
  return buf;
}

function concatBoxes(...boxes: Uint8Array[]): Uint8Array {
  const total = boxes.reduce((s, b) => s + b.length, 0);
  const result = new Uint8Array(total);
  let off = 0;
  for (const b of boxes) {
    result.set(b, off);
    off += b.length;
  }
  return result;
}

function hdlrData(handlerType: string): Uint8Array {
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 0, false);
  view.setUint32(4, 0, false);
  for (let i = 0; i < 4; i++) data[8 + i] = handlerType.charCodeAt(i);
  return data;
}

function tkhdData(trackId: number): Uint8Array {
  const data = new Uint8Array(8);
  const view = new DataView(data.buffer);
  view.setUint32(0, 0, false);
  view.setUint32(4, trackId, false);
  return data;
}

function stsdData(entryType: string): Uint8Array {
  const data = new Uint8Array(16);
  const view = new DataView(data.buffer);
  view.setUint32(0, 0, false);
  view.setUint32(4, 1, false);
  view.setUint32(8, 8, false);
  for (let i = 0; i < 4; i++) data[12 + i] = entryType.charCodeAt(i);
  return data;
}

/** Build a trak box with the given handler type and stsd entry type. */
function makeTrak(handlerType: string, entryType: string, trackId: number): Uint8Array {
  const stsd = makeBox('stsd', stsdData(entryType));
  const stbl = makeBox('stbl', stsd);
  const minf = makeBox('minf', stbl);
  const hdlr = makeBox('hdlr', hdlrData(handlerType));
  const mdia = makeBox('mdia', concatBoxes(hdlr, minf));
  const tkhd = makeBox('tkhd', tkhdData(trackId));
  return makeBox('trak', concatBoxes(tkhd, mdia));
}

function toArrayBuffer(ua: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(ua.byteLength);
  new Uint8Array(ab).set(ua);
  return ab;
}

describe('extractContainerSubtitles', () => {
  it('returns no-subtitles for empty buffer', async () => {
    const result = await extractContainerSubtitles(new ArrayBuffer(0));
    expect(result.kind).toBe('no-subtitles');
  });

  it('returns no-subtitles for non-MP4 data', async () => {
    const result = await extractContainerSubtitles(new ArrayBuffer(20));
    expect(result.kind).toBe('no-subtitles');
  });

  it('returns no-subtitles for MP4 with only video+audio tracks', async () => {
    const ftyp = makeBox('ftyp', new Uint8Array([0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]));
    const videoTrak = makeTrak('vide', 'avc1', 1);
    const audioTrak = makeTrak('soun', 'mp4a', 2);
    const moov = makeBox('moov', concatBoxes(videoTrak, audioTrak));
    const buf = toArrayBuffer(concatBoxes(ftyp, moov));
    const result = await extractContainerSubtitles(buf);
    expect(result.kind).toBe('no-subtitles');
  });

  it('returns detected-but-not-supported for MP4 with sbtl track', async () => {
    const ftyp = makeBox('ftyp', new Uint8Array([0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]));
    const subTrak = makeTrak('sbtl', 'tx3g', 3);
    const moov = makeBox('moov', subTrak);
    const buf = toArrayBuffer(concatBoxes(ftyp, moov));
    const result = await extractContainerSubtitles(buf);
    expect(result.kind).toBe('detected-but-not-supported');
    if (result.kind === 'detected-but-not-supported') {
      expect(result.trackCount).toBe(1);
      expect(result.handlerTypes).toContain('sbtl');
    }
  });

  it('returns detected-but-not-supported for MP4 with text handler track', async () => {
    const ftyp = makeBox('ftyp', new Uint8Array([0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]));
    const subTrak = makeTrak('text', 'tx3g', 3);
    const moov = makeBox('moov', subTrak);
    const buf = toArrayBuffer(concatBoxes(ftyp, moov));
    const result = await extractContainerSubtitles(buf);
    expect(result.kind).toBe('detected-but-not-supported');
  });

  it('accepts a File object', async () => {
    const ftyp = makeBox('ftyp', new Uint8Array(8));
    const buf = toArrayBuffer(ftyp);
    const file = new File([buf], 'test.mp4', { type: 'video/mp4' });
    const result = await extractContainerSubtitles(file);
    expect(result.kind).toBe('no-subtitles');
  });
});

describe('CONTAINER_SUBTITLE_NOT_SUPPORTED_MESSAGE', () => {
  it('contains a clear explanation and guidance', () => {
    expect(CONTAINER_SUBTITLE_NOT_SUPPORTED_MESSAGE).toContain('内嵌字幕');
    expect(CONTAINER_SUBTITLE_NOT_SUPPORTED_MESSAGE).toContain('加载字幕');
  });
});
