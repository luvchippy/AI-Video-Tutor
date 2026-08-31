import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMsg } from '../useChat';

function SourceChips({ sources }: { sources: { url: string; title: string }[] }) {
  if (sources.length === 0) return null;
  return (
    <div className="source-chips">
      <span className="source-label">联网证据</span>
      {sources.slice(0, 6).map((s, i) => (
        <a
          key={i}
          href={s.url}
          target="_blank"
          rel="noreferrer"
          className="source-chip"
          title={s.url}
        >
          {s.title || s.url}
        </a>
      ))}
    </div>
  );
}

function Bubble({ msg }: { msg: ChatMsg }) {
  if (msg.role === 'user') {
    return (
      <div className="msg msg-user">
        <div className="bubble user-bubble">{msg.content}</div>
      </div>
    );
  }

  const isFactCheckUnverified =
    (msg.intent === 'FACT_CHECK' || msg.intent === 'CURRENT_INFO') &&
    msg.factChecked === false &&
    !msg.streaming;

  return (
    <div className="msg msg-assistant">
      <div className="bubble assistant-bubble">
        {msg.error ? (
          <div className="error-text">{msg.content}</div>
        ) : (
          <div className="markdown">
            <Markdown remarkPlugins={[remarkGfm]}>{msg.content}</Markdown>
            {msg.streaming && <span className="cursor" />}
          </div>
        )}
        {isFactCheckUnverified && <span className="badge badge-unverified">未联网核实</span>}
        {!msg.streaming && msg.usedModels && msg.usedModels.length > 0 && (
          <div className="msg-meta muted">使用：{msg.usedModels.join(' + ')}</div>
        )}
        {!msg.streaming && msg.sources && <SourceChips sources={msg.sources} />}
      </div>
    </div>
  );
}

export function MessageList({ messages }: { messages: ChatMsg[] }) {
  return (
    <div className="message-list">
      {messages.length === 0 && (
        <div className="empty-state">
          <p>正在看视频？随时暂停，问我：</p>
          <p className="muted">“这里是什么意思？” · “刚才没听懂” · “这个术语是什么？”</p>
        </div>
      )}
      {messages.map((m) => (
        <Bubble key={m.id} msg={m} />
      ))}
    </div>
  );
}
