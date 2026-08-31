import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Settings } from '@/types/model';
import type { RuntimeContext } from '@/types/messaging';
import type { PlaybackSnapshot, SubtitleSegment } from '@/types/playback';
import { sendBackground } from './lib';
import { revokeObjectUrl } from '@/adapters/media/local-file';

export interface LocalVideoState {
  videoId: string;
  title: string;
  objectUrl: string;
}

interface AppState {
  settings: Settings | null;
  runtime: RuntimeContext | null;
  localVideo: LocalVideoState | null;
  localPlayback: PlaybackSnapshot | null;
  externalSubtitles: SubtitleSegment[] | null;
  updateSettings: (s: Settings) => Promise<void>;
  setLocalVideo: (v: LocalVideoState | null) => void;
  setLocalPlayback: (p: PlaybackSnapshot | null) => void;
  setExternalSubtitles: (s: SubtitleSegment[] | null) => void;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [runtime, setRuntime] = useState<RuntimeContext | null>(null);
  const [localVideo, setLocalVideoState] = useState<LocalVideoState | null>(null);
  const [localPlayback, setLocalPlaybackState] = useState<PlaybackSnapshot | null>(null);
  const [externalSubtitles, setExternalSubtitlesState] = useState<SubtitleSegment[] | null>(null);
  const localVideoRef = useRef<LocalVideoState | null>(null);

  useEffect(() => {
    sendBackground({ type: 'GET_SETTINGS' }).then((res) => {
      if (res.type === 'SETTINGS') setSettings(res.settings);
    });

    let cancelled = false;
    const poll = async () => {
      const res = await sendBackground({ type: 'GET_RUNTIME_CONTEXT' });
      if (!cancelled && res.type === 'RUNTIME_CONTEXT') setRuntime(res.context);
    };
    void poll();
    const timer = setInterval(() => void poll(), 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const updateSettings = useCallback(async (s: Settings) => {
    setSettings(s);
    await sendBackground({ type: 'SET_SETTINGS', settings: s });
  }, []);

  const setLocalVideo = useCallback((v: LocalVideoState | null) => {
    // Revoke the previous URL when replacing or clearing so blob memory
    // is not leaked across file drops.
    if (localVideoRef.current?.objectUrl && localVideoRef.current.objectUrl !== v?.objectUrl) {
      revokeObjectUrl(localVideoRef.current.objectUrl);
    }
    localVideoRef.current = v;
    setLocalVideoState(v);
  }, []);

  // Revoke any lingering object URL when the side panel unmounts.
  useEffect(() => {
    return () => {
      if (localVideoRef.current?.objectUrl) {
        revokeObjectUrl(localVideoRef.current.objectUrl);
        localVideoRef.current = null;
      }
    };
  }, []);

  const setLocalPlayback = useCallback((p: PlaybackSnapshot | null) => {
    setLocalPlaybackState(p);
  }, []);

  const setExternalSubtitles = useCallback((s: SubtitleSegment[] | null) => {
    setExternalSubtitlesState(s);
  }, []);

  // Clear external subtitles when local video is removed or changed.
  useEffect(() => {
    if (!localVideo) {
      setExternalSubtitlesState(null);
    }
  }, [localVideo]);

  return (
    <AppContext.Provider
      value={{
        settings,
        runtime,
        localVideo,
        localPlayback,
        externalSubtitles,
        updateSettings,
        setLocalVideo,
        setLocalPlayback,
        setExternalSubtitles,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
