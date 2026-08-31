import { useCallback, useRef, useState } from 'react';
import type { QuestionIntent } from '@/types/intent';
import { useApp } from './AppContext';
import { connectChat, sendBackground } from './lib';

export interface ChatMsg {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  streaming?: boolean;
  factChecked?: boolean;
  intent?: string;
  usedModels?: string[];
  sources?: { url: string; title: string }[];
  error?: boolean;
}

export function useChat() {
  const { runtime, localVideo, localPlayback } = useApp();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const conversationIdRef = useRef<string | null>(null);

  const videoId = localVideo?.videoId ?? runtime?.videoId ?? null;
  const videoTitle = localVideo?.title ?? runtime?.videoTitle ?? null;
  const isLocal = localVideo != null;

  const ensureConversation = useCallback(async (): Promise<string> => {
    if (conversationIdRef.current) return conversationIdRef.current;
    const res = await sendBackground({ type: 'NEW_CONVERSATION', videoId });
    if (res.type === 'CONVERSATION_CREATED') {
      conversationIdRef.current = res.conversation.id;
      return res.conversation.id;
    }
    throw new Error('无法创建对话');
  }, [videoId]);

  const send = useCallback(
    async (question: string, intentHint?: QuestionIntent) => {
      const text = question.trim();
      if (!text || streaming) return;
      setStreaming(true);

      const userMsg: ChatMsg = {
        id: crypto.randomUUID(),
        role: 'user',
        content: text,
      };
      const assistantId = crypto.randomUUID();
      const assistantMsg: ChatMsg = {
        id: assistantId,
        role: 'assistant',
        content: '',
        streaming: true,
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);

      let conversationId: string;
      try {
        conversationId = await ensureConversation();
      } catch (e) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, streaming: false, error: true, content: String(e) }
              : m,
          ),
        );
        setStreaming(false);
        return;
      }

      const currentTime =
        localPlayback?.currentTime ?? runtime?.playback?.currentTime ?? null;

      const conn = connectChat((msg) => {
        switch (msg.type) {
          case 'CHAT_DELTA':
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: m.content + msg.text } : m,
              ),
            );
            break;
          case 'CHAT_SOURCES':
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, sources: msg.sources }
                  : m,
              ),
            );
            break;
          case 'CHAT_META':
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      usedModels: msg.meta.usedModels,
                      factChecked: msg.meta.factChecked,
                      intent: msg.meta.intent,
                    }
                  : m,
              ),
            );
            break;
          case 'CHAT_DONE':
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      streaming: false,
                      content:
                        m.content || msg.result.assistantMessage.content,
                    }
                  : m,
              ),
            );
            setStreaming(false);
            conn.disconnect();
            break;
          case 'CHAT_ERROR':
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      streaming: false,
                      error: true,
                      content: m.content || `⚠️ ${msg.error}`,
                    }
                  : m,
              ),
            );
            setStreaming(false);
            conn.disconnect();
            break;
          default:
            break;
        }
      });

      conn.start({
        conversationId,
        question: text,
        intentHint,
        currentTime,
        videoId,
        videoTitle,
        isLocalVideo: isLocal,
      });
    },
    [ensureConversation, streaming, localPlayback, runtime, videoId, videoTitle, isLocal],
  );

  return { messages, streaming, send, setMessages };
}
