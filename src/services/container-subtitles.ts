import type { SubtitleSegment } from '../types/playback';

export type ContainerSubtitleStatus =
  | { kind: 'no-subtitles' }
  | { kind: 'detected-but-not-supported'; trackCount: number; handlerTypes: string[] }
  | { kind: 'extracted'; segments: SubtitleSegment[] };

interface Mp4Box {
  type: string;
  offset: number;
  size: number;
  dataOffset: number;
}

/** Read a 32-bit big-endian uint from a DataView at byteOffset. */
function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, false);
}

function readAscii(view: DataView, offset: number, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) {
    s += String.fromCharCode(view.getUint8(offset + i));
  }
  return s;
}

/**
 * Iterate top-level MP4 boxes in a buffer. Returns parsed box descriptors.
 * Handles both 32-bit and 64-bit (when size === 1) box sizes.
 */
function* iterateBoxes(data: ArrayBuffer, start: number, end: number): Generator<Mp4Box> {
  let offset = start;
  while (offset + 8 <= end) {
    const view = new DataView(data, offset, Math.min(16, end - offset));
    const size = readU32(view, 0);
    const type = readAscii(view, 4, 4);
    if (size < 8 && size !== 1) break;
    let boxSize = size;
    let dataOffset = offset + 8;
    if (size === 1) {
      // 64-bit extended size
      if (offset + 16 > end) break;
      const hi = readU32(view, 8);
      const lo = readU32(view, 12);
      boxSize = hi * 2 ** 32 + lo;
      dataOffset = offset + 16;
    }
    if (boxSize < 8 || offset + boxSize > end) break;
    yield { type, offset, size: boxSize, dataOffset };
    offset += boxSize;
  }
}

/** Find the first box of the given type within [start, end). */
function findBox(data: ArrayBuffer, start: number, end: number, targetType: string): Mp4Box | null {
  for (const box of iterateBoxes(data, start, end)) {
    if (box.type === targetType) return box;
  }
  return null;
}

/** Find all boxes of the given type within [start, end). */
function findAllBoxes(data: ArrayBuffer, start: number, end: number, targetType: string): Mp4Box[] {
  const result: Mp4Box[] = [];
  for (const box of iterateBoxes(data, start, end)) {
    if (box.type === targetType) result.push(box);
  }
  return result;
}

interface TrackInfo {
  handlerType: string;
  trackId: number;
}

/**
 * Scan the moov/trak/mdia/hdlr boxes of an MP4 to find subtitle tracks.
 * Returns handler types like 'sbtl', 'text', 'subt'.
 */
function scanMp4SubtitleTracks(data: ArrayBuffer): TrackInfo[] {
  const tracks: TrackInfo[] = [];
  const moov = findBox(data, 0, data.byteLength, 'moov');
  if (!moov) return tracks;
  const moovEnd = moov.offset + moov.size;
  const trakBoxes = findAllBoxes(data, moov.dataOffset, moovEnd, 'trak');
  for (const trak of trakBoxes) {
    const trakEnd = trak.offset + trak.size;
    const mdia = findBox(data, trak.dataOffset, trakEnd, 'mdia');
    if (!mdia) continue;
    const mdiaEnd = mdia.offset + mdia.size;
    const minf = findBox(data, mdia.dataOffset, mdiaEnd, 'minf');
    if (!minf) continue;
    const minfEnd = minf.offset + minf.size;
    const stbl = findBox(data, minf.dataOffset, minfEnd, 'stbl');
    if (!stbl) continue;
    const stblEnd = stbl.offset + stbl.size;
    const stsd = findBox(data, stbl.dataOffset, stblEnd, 'stsd');
    if (!stsd) continue;
    // stsd: version/flags(4) + entry_count(4) + entries
    const stsdData = new DataView(data, stsd.dataOffset, stblEnd - stsd.dataOffset);
    if (stsdData.byteLength < 8) continue;
    const entryCount = readU32(stsdData, 4);
    if (entryCount < 1) continue;
    // First entry: size(4) + type(4)
    if (stsdData.byteLength < 16) continue;
    const entryType = readAscii(stsdData, 12, 4);

    // Also check hdlr box for handler type
    const hdlr = findBox(data, mdia.dataOffset, mdiaEnd, 'hdlr');
    let handlerType = '';
    let trackId = 0;
    if (hdlr) {
      const hdlrView = new DataView(data, hdlr.dataOffset, mdiaEnd - hdlr.dataOffset);
      // hdlr: version/flags(4) + pre_defined(4) + handler_type(4)
      if (hdlrView.byteLength >= 12) {
        handlerType = readAscii(hdlrView, 8, 4);
      }
    }

    // tkhd for trackId
    const tkhd = findBox(data, trak.dataOffset, trakEnd, 'tkhd');
    if (tkhd) {
      const tkhdView = new DataView(data, tkhd.dataOffset, trakEnd - tkhd.dataOffset);
      if (tkhdView.byteLength >= 8) {
        trackId = readU32(tkhdView, 4);
      }
    }

    const subtitleHandlers = ['sbtl', 'text', 'subt'];
    const subtitleSampleEntries = ['tx3g', 'wvtt', 'stpp', 'sbtl', 'text'];
    if (subtitleHandlers.includes(handlerType) || subtitleSampleEntries.includes(entryType)) {
      tracks.push({ handlerType: handlerType || entryType, trackId });
    }
  }
  return tracks;
}

export const CONTAINER_SUBTITLE_NOT_SUPPORTED_MESSAGE =
  '检测到视频容器内嵌字幕轨，但当前版本暂不支持自动提取。请使用「加载字幕」手动选择 .srt / .vtt 文件。';

/**
 * Scan a video File/ArrayBuffer for embedded subtitle tracks.
 * For this version: detects but does not extract (tx3g/wvtt/stpp decoding
 * requires format-specific parsers that are not yet implemented).
 * Never fabricates success — returns 'detected-but-not-supported' honestly.
 */
export async function extractContainerSubtitles(
  file: File | ArrayBuffer,
): Promise<ContainerSubtitleStatus> {
  const buffer = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  // Quick check: is it an MP4? (ftyp box at offset 4)
  if (buffer.byteLength < 12) return { kind: 'no-subtitles' };
  const ftypCheck = readAscii(new DataView(buffer, 4, 4), 0, 4);
  if (ftypCheck !== 'ftyp' && ftypCheck !== 'moov' && ftypCheck !== 'free') {
    // Not an MP4 container we can parse
    return { kind: 'no-subtitles' };
  }

  const tracks = scanMp4SubtitleTracks(buffer);
  if (tracks.length === 0) {
    return { kind: 'no-subtitles' };
  }

  // We can detect subtitle tracks but cannot reliably extract/decode them
  // (tx3g, wvtt, stpp each need format-specific decoders).
  return {
    kind: 'detected-but-not-supported',
    trackCount: tracks.length,
    handlerTypes: tracks.map((t) => t.handlerType),
  };
}
