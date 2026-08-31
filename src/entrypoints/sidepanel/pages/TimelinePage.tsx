import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../AppContext';
import { sendBackground } from '../lib';
import { formatTime } from '@/playback/format';
import type { KnowledgeChunk } from '@/types/knowledge';

export function TimelinePage() {
  const { runtime, localVideo, externalSubtitles } = useApp();
  const [chunks, setChunks] = useState<KnowledgeChunk[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  const videoId = localVideo?.videoId ?? runtime?.videoId ?? null;

  const load = useCallback(async () => {
    if (!videoId) {
      setChunks([]);
      return;
    }
    const res = await sendBackground({ type: 'GET_TIMELINE', videoId });
    if (res.type === 'TIMELINE') setChunks(res.chunks);
  }, [videoId]);

  useEffect(() => {
    void load();
  }, [load]);

  const build = async () => {
    if (!videoId) return;
    setStatus('正在读取字幕并建立索引…');
    const res = await sendBackground({
      type: 'BUILD_INDEX',
      videoId,
      externalSubtitles: externalSubtitles ?? undefined,
    });
    if (res.type === 'INDEX_RESULT') {
      if (res.ok) {
        setStatus(`已建立 ${res.chunkCount} 个知识片段`);
        await load();
      } else {
        setStatus(res.error ?? '建立索引失败');
      }
    }
  };

  const seek = async (time: number) => {
    if (localVideo) return; // local video seek lives in the player
    await sendBackground({ type: 'SEEK', time });
  };

  return (
    <div className="page timeline-page">
      <div className="page-header">
        <h2>时间轴</h2>
        <button className="quick-btn" onClick={() => void build()} disabled={!videoId}>
          建立视频知识索引
        </button>
      </div>
      {status && <p className="muted">{status}</p>}
      {chunks.length === 0 ? (
        <div className="empty-state">
          <p>还没有时间轴知识片段。</p>
          <p className="muted">点击「建立视频知识索引」，根据字幕把视频切分成带时间戳的知识片段。</p>
        </div>
      ) : (
        <div className="timeline-list">
          {chunks.map((c) => (
            <button
              key={c.id}
              className="timeline-item"
              onClick={() => void seek(c.startTime)}
              title="点击跳转到该时间点"
            >
              <span className="timeline-range">
                {formatTime(c.startTime)}–{formatTime(c.endTime)}
              </span>
              <span className="timeline-summary">
                {c.summary ?? c.transcript.slice(0, 80)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
