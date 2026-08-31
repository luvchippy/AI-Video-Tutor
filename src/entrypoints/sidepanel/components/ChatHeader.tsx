import { useApp } from '../AppContext';
import { formatClock } from '@/playback/format';
import { platformLabel } from '@/adapters/platform/registry';

function StatusChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`status-chip ${ok ? 'ok' : 'no'}`}>
      {ok ? '✓' : '✕'} {label}
    </span>
  );
}

export function ChatHeader() {
  const { runtime, localVideo, localPlayback } = useApp();
  const caps = runtime?.capabilityStatus;
  const isLocal = localVideo != null;
  const hasVideo = isLocal || runtime?.hasVideo === true;

  const platform = isLocal
    ? 'Local'
    : platformLabel(runtime?.pageContext?.platformId ?? 'generic');
  const title = localVideo?.title ?? runtime?.videoTitle ?? null;

  const playback = localPlayback ?? runtime?.playback;
  const currentTime = playback?.currentTime ?? null;
  const duration = playback?.duration ?? null;
  const state = playback?.state;

  const stateLabel =
    state === 'playing'
      ? '播放中'
      : state === 'paused'
        ? '已暂停'
        : state === 'ended'
          ? '已结束'
          : '';

  return (
    <header className="chat-header">
      <div className="chat-header-row">
        <span className="app-name">AI Video Tutor</span>
        {caps?.isMock && <span className="badge badge-mock">DEMO / MOCK</span>}
      </div>

      <div className="chat-header-row muted">
        <span className="platform-chip">{platform}</span>
        <span className="video-title" title={title ?? ''}>
          {title ?? '未检测到视频'}
        </span>
      </div>

      <div className="chat-header-row clock">
        <span className="clock-time">{formatClock(currentTime, duration)}</span>
        {stateLabel && <span className="muted"> · {stateLabel}</span>}
      </div>

      <div className="chat-header-row status">
        <StatusChip ok={hasVideo} label="已连接视频" />
        <StatusChip ok={(runtime?.subtitles.length ?? 0) > 0} label="已读取字幕" />
        <StatusChip ok={caps?.vision === true} label="支持视觉" />
        <StatusChip ok={caps?.audio === true} label="支持音频" />
        <StatusChip ok={caps?.search === true} label="支持联网" />
      </div>

      <div className="chat-header-row models muted">
        <span className="model-line">
          Tutor {caps?.tutorModel ?? '—'}
          {caps?.visionModel ? ` · Vision ${caps.visionModel}` : ''}
          {caps?.audioModel ? ` · Audio ${caps.audioModel}` : ''}
          {caps?.searchModel ? ` · Search ${caps.searchModel}` : ''}
        </span>
      </div>
    </header>
  );
}
