import { useState } from 'react';
import { useApp } from '../AppContext';
import { useChat } from '../useChat';
import { ChatHeader } from '../components/ChatHeader';
import { MessageList } from '../components/MessageList';
import { QuickButtons } from '../components/QuickButtons';
import { LocalVideoPlayer } from '../components/LocalVideoPlayer';

export function ChatPage() {
  const { messages, streaming, send } = useChat();
  const { localVideo } = useApp();
  const [input, setInput] = useState('');

  const submit = () => {
    const text = input.trim();
    if (!text || streaming) return;
    void send(text);
    setInput('');
  };

  return (
    <div className="page chat-page">
      <ChatHeader />
      <LocalVideoPlayer />
      <MessageList messages={messages} />
      <QuickButtons onPick={(q, intent) => void send(q, intent)} />
      <div className="input-row">
        <input
          className="chat-input"
          placeholder="问问当前视频……"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button
          className="send-btn"
          onClick={submit}
          disabled={streaming || !input.trim()}
        >
          {streaming ? '…' : '发送'}
        </button>
      </div>
      {localVideo && (
        <p className="muted hint">本地视频模式下，播放时间由下方播放器读取。</p>
      )}
    </div>
  );
}
