import { useRef, useState, type DragEvent, type ChangeEvent } from 'react';
import { useApp } from '../AppContext';
import { sendBackground } from '../lib';
import { snapshotFromVideo } from '@/playback/clock';
import { captureVideoFrame } from '@/services/frame-capture';
import { candidateTimes } from '@/timeline/sparse-analysis';
import {
  createObjectUrl,
  revokeObjectUrl,
  isSupportedVideoFile,
} from '@/adapters/media/local-file';
import { detectSubtitleFormat, parseSrt, parseVtt } from '@/services/subtitle-parsers';

async function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const done = () => {
      video.removeEventListener('seeked', done);
      resolve();
    };
    const timeout = setTimeout(() => {
      video.removeEventListener('seeked', done);
      resolve();
    }, 4000);
    video.addEventListener('seeked', () => {
      clearTimeout(timeout);
      done();
    });
    video.currentTime = time;
  });
}

export function LocalVideoPlayer() {
  const { localVideo, setLocalVideo, setLocalPlayback, runtime, externalSubtitles, setExternalSubtitles } = useApp();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subtitleStatus, setSubtitleStatus] = useState<string | null>(null);

  const caps = runtime?.capabilityStatus;
  const canAnalyze = caps?.vision === true;

  const updatePlayback = () => {
    const v = videoRef.current;
    if (v) setLocalPlayback(snapshotFromVideo(v));
  };

  const handleFile = (file: File) => {
    setError(null);
    if (!isSupportedVideoFile(file)) {
      setError('请选择 MP4 / WebM 等视频文件');
      return;
    }
    // Revoke the previous object URL so we don't leak blob memory.
    if (localVideo?.objectUrl) revokeObjectUrl(localVideo.objectUrl);
    const objectUrl = createObjectUrl(file);
    const videoId = `local:${crypto.randomUUID()}`;
    setLocalVideo({ videoId, title: file.name, objectUrl });
    setExternalSubtitles(null);
    setSubtitleStatus(null);
    void sendBackground({
      type: 'REGISTER_LOCAL_VIDEO',
      videoId,
      title: file.name,
      duration: 0,
    });
  };

  const handleSubtitleFile = async (file: File) => {
    setError(null);
    const text = await file.text();
    const format = detectSubtitleFormat(file.name, text);
    if (!format) {
      setError(`不支持的字幕格式：${file.name}。请使用 .srt 或 .vtt 文件。`);
      return;
    }
    const segments = format === 'srt' ? parseSrt(text) : parseVtt(text);
    if (segments.length === 0) {
      setError(`字幕文件解析失败或为空：${file.name}`);
      return;
    }
    setExternalSubtitles(segments);
    setSubtitleStatus(`已加载 ${segments.length} 条字幕（${format.toUpperCase()}）`);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const onSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const clear = () => {
    // Revoke the blob URL to release the underlying file memory.
    if (localVideo?.objectUrl) revokeObjectUrl(localVideo.objectUrl);
    setLocalVideo(null);
    setLocalPlayback(null);
  };

  const analyzeFull = async () => {
    const v = videoRef.current;
    if (!v || !localVideo) return;
    const times = candidateTimes(v.duration);
    if (times.length === 0) {
      setError('视频时长未知，无法采样');
      return;
    }
    setAnalyzing(true);
    setProgress({ done: 0, total: times.length });
    let done = 0;
    for (const t of times) {
      await seekTo(v, t);
      const dataUrl = captureVideoFrame(v);
      if (dataUrl) {
        try {
          await sendBackground({
            type: 'ANALYZE_FRAME',
            videoId: localVideo.videoId,
            timestamp: t,
            dataUrl,
          });
        } catch {
          /* continue */
        }
      }
      done++;
      setProgress({ done, total: times.length });
    }
    setAnalyzing(false);
    setProgress(null);
  };

  if (!localVideo) {
    return (
      <div
        className={`drop-zone ${dragOver ? 'over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <p>拖入 MP4 / WebM 本地视频</p>
        <p className="muted">或</p>
        <label className="file-pick">
          选择文件
          <input type="file" accept="video/*" onChange={onSelect} hidden />
        </label>
        {error && <p className="error-text">{error}</p>}
      </div>
    );
  }

  return (
    <div className="local-player">
      <div className="local-player-toolbar">
        <span className="video-title" title={localVideo.title}>
          {localVideo.title}
        </span>
        <button className="text-btn" onClick={clear}>
          移除
        </button>
      </div>
      <video
        ref={videoRef}
        src={localVideo.objectUrl}
        controls
        className="local-video"
        onTimeUpdate={updatePlayback}
        onPlay={updatePlayback}
        onPause={updatePlayback}
        onLoadedMetadata={updatePlayback}
      />
      <div className="local-player-actions">
        <label className="quick-btn file-pick">
          加载字幕
          <input
            type="file"
            accept=".srt,.vtt,text/vtt,application/x-subrip"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleSubtitleFile(file);
              e.target.value = '';
            }}
            hidden
          />
        </label>
        {subtitleStatus && <span className="muted small">{subtitleStatus}</span>}
        {externalSubtitles && externalSubtitles.length > 0 && (
          <span className="badge badge-subtitle">字幕就绪</span>
        )}
        {canAnalyze ? (
          <button className="quick-btn" onClick={() => void analyzeFull()} disabled={analyzing}>
            {analyzing
              ? `分析中 ${progress ? `${progress.done}/${progress.total}` : '…'}`
              : '分析完整视频'}
          </button>
        ) : (
          <p className="muted">当前模型不支持视频画面分析（需视觉模型）。</p>
        )}
      </div>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
