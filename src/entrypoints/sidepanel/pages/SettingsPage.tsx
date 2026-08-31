import { useEffect, useState } from 'react';
import { useApp } from '../AppContext';
import { sendBackground } from '../lib';
import { resolveCapabilities } from '@/registry/capability-resolver';
import { listProtocols, getProtocol } from '@/registry/protocol-registry';
import type {
  LearnerLevel,
  ModelCapabilities,
  ProviderProtocol,
  SavedModel,
} from '@/types/model';
import type { ProviderTestResult } from '@/types/messaging';

const LEVELS: { id: LearnerLevel; label: string }[] = [
  { id: 'quick', label: '快速' },
  { id: 'beginner', label: '初学者' },
  { id: 'college', label: '大学生' },
  { id: 'professional', label: '专业人士' },
];

const PROTOCOLS: { id: ProviderProtocol; label: string }[] = listProtocols()
  .filter((p) => p.id !== 'mock')
  .map((p) => ({ id: p.id as ProviderProtocol, label: p.label }));

type RoleId = 'tutor' | 'vision' | 'video' | 'audio' | 'search';

const ROLES: { id: RoleId; label: string; icon: string; capKey: keyof ModelCapabilities }[] = [
  { id: 'tutor', label: '主助教', icon: '🧠', capKey: 'textInput' },
  { id: 'vision', label: '视觉理解', icon: '👁', capKey: 'imageInput' },
  { id: 'video', label: '视频理解', icon: '🎬', capKey: 'videoInput' },
  { id: 'audio', label: '音频理解', icon: '🎙', capKey: 'audioInput' },
  { id: 'search', label: '联网核验', icon: '🌐', capKey: 'nativeWebSearch' },
];

function TestResultDisplay({ result }: { result: ProviderTestResult | null }) {
  if (!result) return null;
  if (result.ok) {
    return (
      <p className="test-result ok">
        ✓ 连接成功{result.endpoint ? `（${result.endpoint}）` : ''}
      </p>
    );
  }
  return (
    <div className="test-result error">
      <p>✕ {result.errorMessage ?? '测试失败'}</p>
      {result.statusCode ? <p className="muted small">HTTP {result.statusCode}</p> : null}
      {result.endpoint ? <p className="muted small">{result.endpoint}</p> : null}
      {result.errorType ? <p className="muted small error-type">{result.errorType}</p> : null}
    </div>
  );
}

function ModelCard({
  model,
  keySaved,
  onDelete,
  onReplaceKey,
}: {
  model: SavedModel;
  keySaved: boolean;
  onDelete: () => void;
  onReplaceKey: (newKey: string) => Promise<void>;
}) {
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [keySavedFlash, setKeySavedFlash] = useState(false);

  const caps = model.capabilities;
  const capLabels: { key: keyof ModelCapabilities; label: string }[] = [
    { key: 'textInput', label: 'Text' },
    { key: 'imageInput', label: 'Image' },
    { key: 'audioInput', label: 'Audio' },
    { key: 'videoInput', label: 'Video' },
    { key: 'nativeWebSearch', label: 'Web' },
  ];

  const handleSaveKey = async () => {
    if (!newKey.trim()) return;
    await onReplaceKey(newKey.trim());
    setNewKey('');
    setShowKeyInput(false);
    setKeySavedFlash(true);
    setTimeout(() => setKeySavedFlash(false), 3000);
  };

  return (
    <div className="model-card">
      <div className="model-card-header">
        <span className="model-card-name">{model.name}</span>
        <button className="text-btn danger" onClick={onDelete}>删除</button>
      </div>
      <div className="model-card-caps">
        {capLabels
          .filter((c) => caps[c.key])
          .map((c) => (
            <span key={c.key} className="cap-badge">✓ {c.label}</span>
          ))}
      </div>
      <div className="model-card-status">
        <span className={`conn-status ${model.connectionStatus}`}>
          {model.connectionStatus === 'connected' ? '● 已连接' : model.connectionStatus === 'failed' ? '● 连接失败' : '● 未测试'}
        </span>
        <span className="muted small">{model.capabilitySource === 'registry' ? '◐ Registry 已知' : model.capabilitySource}</span>
      </div>
      <div className="model-card-key">
        {keySavedFlash ? (
          <span className="key-status saved">✓ API Key 已保存</span>
        ) : keySaved ? (
          <>
            <span className="key-status saved">🔑 Key 已保存</span>
            {!showKeyInput && (
              <button className="text-btn small" onClick={() => setShowKeyInput(true)}>替换 API Key</button>
            )}
          </>
        ) : (
          <>
            <span className="key-status missing">🔑 未保存 Key</span>
            {!showKeyInput && (
              <button className="text-btn small" onClick={() => setShowKeyInput(true)}>设置 API Key</button>
            )}
          </>
        )}
      </div>
      {showKeyInput && (
        <div className="key-replace-row">
          <input
            type="password"
            placeholder="输入新的 API Key"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
          />
          <button className="quick-btn" onClick={() => void handleSaveKey()} disabled={!newKey.trim()}>
            保存
          </button>
          <button className="text-btn" onClick={() => { setShowKeyInput(false); setNewKey(''); }}>取消</button>
        </div>
      )}
    </div>
  );
}

function CapabilitySummary({ models }: { models: SavedModel[] }) {
  if (models.length === 0) {
    return (
      <div className="cap-summary">
        <p className="muted">尚未添加任何模型。点击「+ 添加模型」开始。</p>
      </div>
    );
  }

  const allCaps = models.map((m) => m.capabilities);
  const has = (key: keyof ModelCapabilities) => allCaps.some((c) => c[key]);

  const features: { label: string; ok: boolean; missingReason: string | null }[] = [
    { label: '视频字幕学习', ok: has('textInput'), missingReason: '需要文本模型' },
    { label: '专业术语解释', ok: has('textInput'), missingReason: '需要文本模型' },
    { label: '当前画面分析', ok: has('imageInput'), missingReason: '尚未配置视觉模型' },
    { label: '完整视频理解', ok: has('videoInput'), missingReason: '尚未配置视频模型' },
    { label: '音频理解', ok: has('audioInput'), missingReason: '尚未配置音频模型' },
    { label: '联网核验', ok: has('nativeWebSearch'), missingReason: '尚未配置联网搜索模型' },
  ];

  return (
    <div className="cap-summary">
      <p className="muted small">当前 AI Video Tutor 能力：</p>
      {features.map((f) => (
        <div key={f.label} className="cap-summary-item">
          <span>{f.ok ? '✓' : '○'} {f.label}</span>
          {!f.ok && f.missingReason && <span className="muted small"> {f.missingReason}</span>}
        </div>
      ))}
    </div>
  );
}

export function SettingsPage() {
  const { settings, updateSettings } = useApp();
  const [showAddForm, setShowAddForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formProtocol, setFormProtocol] = useState<ProviderProtocol>('openai-compatible');
  const [formBaseUrl, setFormBaseUrl] = useState('');
  const [formApiKey, setFormApiKey] = useState('');
  const [formModelId, setFormModelId] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);
  const [keySavedStatus, setKeySavedStatus] = useState<Record<string, boolean>>({});
  const [keySavedFlash, setKeySavedFlash] = useState(false);

  // Load key status for all saved models on mount and when models change
  const savedModelsKey = settings?.savedModels.map((m) => `${m.protocol}:${m.baseUrl ?? ''}`).join('|') ?? '';

  useEffect(() => {
    if (!settings || settings.savedModels.length === 0) {
      setKeySavedStatus({});
      return;
    }
    const models = settings.savedModels
      .filter((m) => m.protocol !== 'mock')
      .map((m) => ({ protocol: m.protocol, baseUrl: m.baseUrl }));
    if (models.length === 0) return;
    void sendBackground({ type: 'GET_MODEL_KEY_STATUS', models }).then((res) => {
      if (res.type === 'MODEL_KEY_STATUS') {
        setKeySavedStatus(res.entries);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedModelsKey]);

  if (!settings) return <div className="page">加载中…</div>;

  const savedModels = settings.savedModels;

  const keyStorageKey = (protocol: string, baseUrl?: string): string =>
    baseUrl ? `${protocol}::${baseUrl}` : protocol;

  const isKeySaved = (model: SavedModel): boolean => {
    if (model.protocol === 'mock') return true;
    return keySavedStatus[keyStorageKey(model.protocol, model.baseUrl)] ?? false;
  };

  const applyLevel = async (level: LearnerLevel) => {
    await updateSettings({ ...settings, learnerLevel: level });
  };

  const applyBackground = async (text: string) => {
    await updateSettings({ ...settings, learnerBackground: text });
  };

  const reloadKeyStatus = async () => {
    const models = savedModels
      .filter((m) => m.protocol !== 'mock')
      .map((m) => ({ protocol: m.protocol, baseUrl: m.baseUrl }));
    if (models.length === 0) return;
    const res = await sendBackground({ type: 'GET_MODEL_KEY_STATUS', models });
    if (res.type === 'MODEL_KEY_STATUS') {
      setKeySavedStatus(res.entries);
    }
  };

  const handleSaveAndTest = async () => {
    if (!formModelId.trim()) return;
    setTesting(true);
    setTestResult(null);

    const modelId = formModelId.trim();
    const name = formName.trim() || modelId;
    const baseUrl = formBaseUrl.trim() || undefined;
    const protocol = formProtocol;

    // Resolve capabilities from registry / protocol defaults
    const resolved = resolveCapabilities(protocol, modelId);

    const modelId_ = crypto.randomUUID();
    const model: SavedModel = {
      id: modelId_,
      name,
      protocol,
      baseUrl,
      modelId,
      capabilities: resolved.capabilities,
      connectionStatus: 'untested',
      capabilitySource: resolved.source,
    };

    // Save the model + API key
    await sendBackground({
      type: 'SAVE_MODEL',
      model,
      apiKey: formApiKey.trim() || undefined,
    });

    // Test the connection
    const testRes = await sendBackground({
      type: 'TEST_PROVIDER',
      slot: {
        provider: protocol,
        modelId,
        baseUrl,
        displayName: name,
        capabilities: resolved.capabilities,
      },
    });

    if (testRes.type === 'TEST_RESULT') {
      setTestResult(testRes.testResult ?? { ok: testRes.ok, errorMessage: testRes.error });
      // Update model connection status
      const updatedModel: SavedModel = {
        ...model,
        connectionStatus: testRes.ok ? 'connected' : 'failed',
      };
      await sendBackground({ type: 'SAVE_MODEL', model: updatedModel });
    }

    // Reload settings to reflect the saved model
    const settingsRes = await sendBackground({ type: 'GET_SETTINGS' });
    if (settingsRes.type === 'SETTINGS') {
      await updateSettings(settingsRes.settings);
    }
    await reloadKeyStatus();

    setTesting(false);

    // Show key saved flash if a key was provided
    if (formApiKey.trim()) {
      setFormApiKey('');
      setKeySavedFlash(true);
      setTimeout(() => setKeySavedFlash(false), 3000);
    }

    // If test succeeded, close the form
    if (testRes.type === 'TEST_RESULT' && testRes.ok) {
      setShowAddForm(false);
      setFormName('');
      setFormBaseUrl('');
      setFormModelId('');
    }
  };

  const handleDelete = async (modelId: string) => {
    await sendBackground({ type: 'DELETE_MODEL', modelId });
    const settingsRes = await sendBackground({ type: 'GET_SETTINGS' });
    if (settingsRes.type === 'SETTINGS') {
      await updateSettings(settingsRes.settings);
    }
  };

  const handleReplaceKey = async (model: SavedModel, newKey: string) => {
    await sendBackground({
      type: 'SAVE_API_KEY',
      provider: model.protocol,
      baseUrl: model.baseUrl ?? null,
      key: newKey,
    });
    await reloadKeyStatus();
  };

  const handleRoleChange = async (role: RoleId, modelId: string | null) => {
    const newConfig = { ...settings.modelConfig };
    if (role === 'tutor') {
      if (modelId) newConfig.tutor = { modelId };
    } else {
      newConfig[role] = modelId ? { modelId } : null;
    }
    await updateSettings({ ...settings, modelConfig: newConfig });
  };

  // Filter models eligible for each role
  const modelsForRole = (role: RoleId): SavedModel[] => {
    const capKey = ROLES.find((r) => r.id === role)!.capKey;
    return savedModels.filter((m) => m.capabilities[capKey]);
  };

  return (
    <div className="page settings-page">
      <h2>设置</h2>

      <section className="settings-section">
        <h3>解释深度</h3>
        <div className="level-row">
          {LEVELS.map((l) => (
            <button
              key={l.id}
              className={settings.learnerLevel === l.id ? 'chip active' : 'chip'}
              onClick={() => void applyLevel(l.id)}
            >
              {l.label}
            </button>
          ))}
        </div>
        <h3>我的背景</h3>
        <textarea
          className="bg-input"
          placeholder='例如："我没有半导体专业背景，只有高中物理基础。"'
          value={settings.learnerBackground}
          onChange={(e) => void applyBackground(e.target.value)}
          rows={3}
        />
      </section>

      {/* 我的模型 */}
      <section className="settings-section">
        <div className="section-header">
          <h3>我的模型</h3>
          <button className="quick-btn" onClick={() => setShowAddForm((v) => !v)}>
            {showAddForm ? '取消' : '+ 添加模型'}
          </button>
        </div>
        <p className="muted small">API Key 只保存在浏览器扩展本地存储，不会写入页面或发送到任何服务器。</p>

        {showAddForm && (
          <div className="custom-form">
            <input
              placeholder="模型名称（如 DeepSeek V4）"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
            />
            <select
              value={formProtocol}
              onChange={(e) => {
                const proto = e.target.value as ProviderProtocol;
                setFormProtocol(proto);
                // Auto-fill default Base URL if the protocol has one and the field is empty
                const profile = getProtocol(proto);
                if (profile?.defaultBaseUrl && !formBaseUrl.trim()) {
                  setFormBaseUrl(profile.defaultBaseUrl);
                }
              }}
            >
              {PROTOCOLS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
            {formProtocol !== 'mock' && (
              <input
                placeholder="Base URL，如 https://api.example.com/v1（程序自动追加 /chat/completions）"
                value={formBaseUrl}
                onChange={(e) => setFormBaseUrl(e.target.value)}
              />
            )}
            <input
              placeholder="Model ID，如 deepseek-chat / gemini-2.5-flash"
              value={formModelId}
              onChange={(e) => setFormModelId(e.target.value)}
            />
            <input
              type="password"
              placeholder="API Key"
              value={formApiKey}
              onChange={(e) => setFormApiKey(e.target.value)}
            />
            {keySavedFlash && (
              <p className="test-result ok">✓ API Key 已保存</p>
            )}
            <button
              className="quick-btn"
              onClick={() => void handleSaveAndTest()}
              disabled={testing || !formModelId.trim()}
            >
              {testing ? '测试中…' : '保存并检测'}
            </button>
            <TestResultDisplay result={testResult} />
          </div>
        )}

        <div className="model-list">
          {savedModels.length === 0 && (
            <p className="muted">尚未添加任何模型。点击「+ 添加模型」开始配置 AI 助教。</p>
          )}
          {savedModels.map((m) => (
            <ModelCard
              key={m.id}
              model={m}
              keySaved={isKeySaved(m)}
              onDelete={() => void handleDelete(m.id)}
              onReplaceKey={(newKey) => handleReplaceKey(m, newKey)}
            />
          ))}
        </div>
      </section>

      {/* 模型分工 */}
      <section className="settings-section">
        <h3>模型分工</h3>
        {ROLES.map((r) => {
          const eligible = modelsForRole(r.id);
          const currentId = settings.modelConfig[r.id]?.modelId ?? null;
          return (
            <div key={r.id} className="role-row">
              <label className="role-label">
                {r.icon} {r.label}
                {r.id === 'tutor' && <span className="muted small">（必选）</span>}
              </label>
              <select
                value={currentId ?? ''}
                onChange={(e) => void handleRoleChange(r.id, e.target.value || null)}
                disabled={r.id === 'tutor' && eligible.length <= 1}
              >
                {r.id !== 'tutor' && <option value="">— 未配置 —</option>}
                {eligible.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              {eligible.length === 0 && (
                <span className="muted small">无可用模型（需支持 {r.capKey}）</span>
              )}
            </div>
          );
        })}
      </section>

      {/* 当前能力 */}
      <section className="settings-section">
        <h3>当前能力</h3>
        <CapabilitySummary models={savedModels} />
      </section>
    </div>
  );
}
