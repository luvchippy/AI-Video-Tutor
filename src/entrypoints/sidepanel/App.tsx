import { useState } from 'react';
import { AppProvider } from './AppContext';
import { ChatPage } from './pages/ChatPage';
import { TimelinePage } from './pages/TimelinePage';
import { SettingsPage } from './pages/SettingsPage';

type Tab = 'chat' | 'timeline' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'chat', label: 'Chat' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'settings', label: 'Settings' },
];

function Shell() {
  const [tab, setTab] = useState<Tab>('chat');

  return (
    <div className="app">
      <div className="page-view">
        {/* keep all pages mounted so chat/timeline state survives tab switches */}
        <div className="page-wrap" style={{ display: tab === 'chat' ? 'flex' : 'none' }}>
          <ChatPage />
        </div>
        <div className="page-wrap" style={{ display: tab === 'timeline' ? 'flex' : 'none' }}>
          <TimelinePage />
        </div>
        <div className="page-wrap" style={{ display: tab === 'settings' ? 'flex' : 'none' }}>
          <SettingsPage />
        </div>
      </div>
      <nav className="tab-bar">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? 'tab active' : 'tab'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
