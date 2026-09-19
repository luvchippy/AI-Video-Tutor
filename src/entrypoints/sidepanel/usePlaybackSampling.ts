import { useEffect, useRef, useState } from 'react';
import { sendBackground } from './lib';
import { atSampleLimit, nextSampleTime, MAX_SAMPLED_FRAMES } from '@/timeline/sampling';
import type { PlaybackSnapshot } from '@/types/playback';

export interface PlaybackSamplingStatus {
  /** Keyframes now stored for this video (loaded from the DB, then incremented). */
  saved: number;
  /** Boundaries captured or attempted this session — the number the bound caps. */
  attempted: number;
  /** Per-video capture bound, so the UI can state it up front. */
  limit: number;
  /** The last thing worth telling the user (failure, or the bound being hit). */
  note: string | null;
}

export interface PlaybackSamplingOptions {
  /** Null when no page video is playing. */
  videoId: string | null;
  playback: PlaybackSnapshot | null;
  /** User's explicit opt-in. Sampling never runs otherwise. */
  enabled: boolean;
}

/**
 * Capture the frame at each 10s boundary the playhead crosses, and hand it to
 * the background for visual analysis.
 *
 * The side panel's 1s runtime-context poll IS the heartbeat: this hook reacts to
 * each new playback position, so nothing here owns a timer. Which boundary (if
 * any) a tick should capture is decided by `timeline/sampling.ts`, and the
 * answer is memoized in `attemptedRef` so one 10s bucket is never paid for
 * twice — including across a seek backwards, and across a page reload (the DB's
 * keyframe timestamps seed the set on mount).
 *
 * Sampling is OFF unless the caller passes `enabled`, because every frame is a
 * paid vision request.
 */
export function usePlaybackSampling({
  videoId,
  playback,
  enabled,
}: PlaybackSamplingOptions): PlaybackSamplingStatus {
  const attemptedRef = useRef<Set<number>>(new Set());
  const savedRef = useRef(0);
  const busyRef = useRef(false);
  const [saved, setSaved] = useState(0);
  const [attempted, setAttempted] = useState(0);
  const [note, setNote] = useState<string | null>(null);

  const currentTime = playback?.currentTime ?? null;
  const duration = playback?.duration ?? null;

  // Seed the dedupe set from what is already stored, so reopening the panel (or
  // switching back to a video) does not re-analyze frames it already has.
  useEffect(() => {
    attemptedRef.current = new Set();
    savedRef.current = 0;
    setSaved(0);
    setAttempted(0);
    setNote(null);
    if (!videoId) return;

    let cancelled = false;
    void sendBackground({ type: 'GET_KEYFRAMES', videoId }).then((res) => {
      if (cancelled || res.type !== 'KEYFRAMES') return;
      for (const kf of res.keyframes) attemptedRef.current.add(kf.timestamp);
      savedRef.current = res.keyframes.length;
      setSaved(res.keyframes.length);
      setAttempted(attemptedRef.current.size);
    });
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  useEffect(() => {
    if (!enabled || !videoId) return;
    // One capture at a time: a vision request can take seconds, and the poll
    // keeps ticking throughout.
    if (busyRef.current) return;

    const target = nextSampleTime(currentTime, duration, attemptedRef.current);
    if (target === null) return;

    if (atSampleLimit(attemptedRef.current)) {
      setNote(
        `已停止自动采样：覆盖的时间点已达到本次上限（${MAX_SAMPLED_FRAMES} 个）。`,
      );
      return;
    }

    // Reserve before awaiting so the ticks that arrive during the request skip
    // this boundary rather than queueing behind it.
    attemptedRef.current.add(target);
    setAttempted(attemptedRef.current.size);
    busyRef.current = true;

    void (async () => {
      try {
        const frame = await sendBackground({ type: 'CAPTURE_FRAME' });
        if (frame.type !== 'FRAME_CAPTURED' || !frame.frame.dataUrl) {
          setNote(
            frame.type === 'FRAME_CAPTURED' && frame.frame.limitation
              ? frame.frame.limitation
              : '无法截取当前画面，已跳过该时间点。',
          );
          return;
        }

        const res = await sendBackground({
          type: 'ANALYZE_FRAME',
          videoId,
          timestamp: target,
          dataUrl: frame.frame.dataUrl,
        });
        if (res.type === 'ANALYZE_FRAME_RESULT' && !res.ok) {
          setNote(res.error ?? '画面分析失败。');
          return;
        }
        savedRef.current += 1;
        setSaved(savedRef.current);
      } catch {
        setNote('自动采样时发生错误。');
      } finally {
        busyRef.current = false;
      }
    })();
  }, [enabled, videoId, currentTime, duration]);

  return {
    saved,
    attempted,
    limit: MAX_SAMPLED_FRAMES,
    note,
  };
}