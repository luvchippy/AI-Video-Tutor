import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../AppContext';
import { sendBackground } from '../lib';
import { formatTime } from '@/playback/format';
import type { Keyframe, KnowledgeChunk } from '@/types/knowledge';

export function TimelinePage() {
  const {
    runtime,
    localVideo,
    externalSubtitles,
    samplingEnabled,
    sampling,
    setSamplingEnabled,
  } = useApp();
  const [chunks, setChunks] = useState<KnowledgeChunk[]>([]);
  const [keyframes, setKeyframes] = useState<Keyframe[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  const videoId = localVideo?.videoId ?? runtime?.videoId ?? null;
  // Seeking a local file lives in the player, which owns the <video> element.
  const canSeek = localVideo == null;
  const canSample =
    runtime?.capabilityStatus.vision === true &&
    canSeek &&
    runtime?.videoId != null;

  const load = useCallback(async () => {
    if (!videoId) {
      setChunks([]);
      setKeyframes([]);
      return;
    }
    const res = await sendBackground({ type: 'GET_TIMELINE', videoId });
    if (res.type === 'TIMELINE') setChunks(res.chunks);
    const kf = await sendBackground({ type: 'GET_KEYFRAMES', videoId });
    if (kf.type === 'KEYFRAMES') setKeyframes(kf.keyframes);
  }, [videoId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Refresh the strip as playback sampling stores more keyframes.
  useEffect(() => {
    if (!videoId || sampling.saved === 0) return;
    void sendBackground({ type: 'GET_KEYFRAMES', videoId }).then((res) => {
      if (res.type === 'KEYFRAMES') setKeyframes(res.keyframes);
    });
  }, [videoId, sampling.saved]);

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
        const enriched = res.aiEnriched ?? 0;
        const parts = [`已建立 ${res.chunkCount} 个知识片段`];
        if (res.sourceLabel) parts.push(`字幕来源：${res.sourceLabel}`);
        if (enriched > 0) parts.push(`${enriched} 个由 AI 生成摘要与关键词`);
        setStatus(parts.join('，') + (res.aiNote ? `（${res.aiNote}）` : ''));
        await load();
      } else {
        setStatus(res.error ?? '建立索引失败');
      }
    }
  };

  const seek = async (time: number) => {
    if (!canSeek) return;
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

      {/* 画面自动采样：每一帧都是一次付费的视觉请求，所以默认关闭 */}
      <section className="settings-section">
        <h3>画面自动采样</h3>
        {canSample ? (
          <>
            <label className="switch-row">
              <input
                type="checkbox"
                checked={samplingEnabled}
                onChange={(e) => setSamplingEnabled(e.target.checked)}
              />
              <span>
                播放时每 10 秒截取一帧交给视觉模型分析。每个时间点只分析一次，本次上限{' '}
                {sampling.limit} 帧。
              </span>
            </label>
            <p className="muted small">
              已分析 {sampling.saved} 帧，覆盖 {sampling.attempted} / {sampling.limit} 个时间点。
            </p>
            {sampling.note && <p className="error-text small">{sampling.note}</p>}
          </>
        ) : (
          <p className="muted small">
            {!canSeek
              ? '本地视频请在播放器中使用「分析完整视频」。'
              : runtime?.capabilityStatus.vision !== true
                ? '需要先在「设置 → 模型分工」中配置视觉模型。'
                : '当前页面没有检测到视频。'}
          </p>
        )}
      </section>

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
              disabled={!canSeek}
              title={canSeek ? '点击跳转到该时间点' : '本地视频请在播放器中跳转'}
            >
              <span className="timeline-range">
                {formatTime(c.startTime)}–{formatTime(c.endTime)}
              </span>
              <span className="timeline-summary">
                {c.summary ?? c.transcript.slice(0, 80)}
              </span>
              {c.keywords && c.keywords.length > 0 && (
                <span className="timeline-keywords">
                  {c.keywords.slice(0, 4).map((k) => (
                    <span key={k} className="timeline-keyword">{k}</span>
                  ))}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {keyframes.length > 0 && (
        <section className="keyframe-section">
          <h3>关键帧（{keyframes.length}）</h3>
          {!canSeek && <p className="muted small">本地视频请在播放器中跳转。</p>}
          <div className="keyframe-strip">
            {keyframes.map((kf) => (
              <button
                key={kf.id}
                className="keyframe-item"
                onClick={() => void seek(kf.timestamp)}
                disabled={!canSeek}
                title={kf.visualSummary ?? '视觉分析未给出描述'}
              >
                {kf.thumbnailDataUrl ? (
                  <img className="keyframe-thumb" src={kf.thumbnailDataUrl} alt="" />
                ) : (
                  <span className="keyframe-thumb placeholder" />
                )}
                <span className="keyframe-time">{formatTime(kf.timestamp)}</span>
                <span className="keyframe-summary">
                  {kf.visualSummary ?? '（无画面描述）'}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}