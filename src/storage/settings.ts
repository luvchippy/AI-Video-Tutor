import type { Settings, SavedModel } from '../types/model';
import { SettingsSchema } from './schema';

const SETTINGS_KEY = 'settings';
const API_KEYS_KEY = 'apiKeys';

/**
 * API keys live ONLY in chrome.storage.local (never in DOM, window, content
 * script, or console). They are read exclusively by the background service
 * worker and injected into provider configs at call time.
 */

export const DEFAULT_SETTINGS: Settings = {
  learnerLevel: 'beginner',
  learnerBackground: '',
  savedModels: [],
  modelConfig: {
    tutor: { modelId: '' },
    vision: null,
    video: null,
    audio: null,
    search: null,
  },
  activePreset: null,
};

export async function loadSettings(): Promise<Settings> {
  const raw = await browser.storage.local.get(SETTINGS_KEY);
  const data = raw[SETTINGS_KEY];
  if (!data) return DEFAULT_SETTINGS;
  const parsed = SettingsSchema.safeParse(data);
  if (!parsed.success) return DEFAULT_SETTINGS;

  // Migration: remove Mock model from savedModels for production users.
  // Mock is still available in tests and dev mode, but should not appear
  // in the normal Settings UI or role dropdowns.
  const settings = parsed.data;
  const hadMock = settings.savedModels.some((m) => m.protocol === 'mock');
  if (hadMock) {
    settings.savedModels = settings.savedModels.filter((m) => m.protocol !== 'mock');
    // Clear mock from role assignments
    if (settings.modelConfig.tutor?.modelId === 'mock-tutor') {
      settings.modelConfig.tutor = { modelId: '' };
    }
    // Persist the migrated settings
    await browser.storage.local.set({ [SETTINGS_KEY]: settings });
  }

  return settings;
}

export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_KEY]: settings });
}

function apiKeyStorageKey(protocol: string, baseUrl: string | null | undefined): string {
  return baseUrl ? `${protocol}::${baseUrl}` : protocol;
}

export async function saveApiKey(
  protocol: string,
  baseUrl: string | null,
  key: string,
): Promise<void> {
  const storageKey = apiKeyStorageKey(protocol, baseUrl);
  const raw = await browser.storage.local.get(API_KEYS_KEY);
  const existing =
    (raw[API_KEYS_KEY] as Record<string, string> | undefined) ?? {};
  const keys: Record<string, string> = { ...existing };
  keys[storageKey] = key;
  await browser.storage.local.set({ [API_KEYS_KEY]: keys });
}

export async function getApiKey(
  protocol: string,
  baseUrl?: string | null,
): Promise<string | null> {
  const storageKey = apiKeyStorageKey(protocol, baseUrl);
  const raw = await browser.storage.local.get(API_KEYS_KEY);
  const keys: Record<string, string> =
    (raw[API_KEYS_KEY] as Record<string, string> | undefined) ?? {};
  const key = keys[storageKey];
  return typeof key === 'string' && key.length > 0 ? key : null;
}

export async function getApiKeyStatus(): Promise<Record<string, boolean>> {
  const raw = await browser.storage.local.get(API_KEYS_KEY);
  const keys: Record<string, string> =
    (raw[API_KEYS_KEY] as Record<string, string> | undefined) ?? {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(keys)) {
    out[k] = typeof v === 'string' && v.length > 0;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Saved model CRUD                                                     */
/* ------------------------------------------------------------------ */

export async function saveSavedModel(model: SavedModel, apiKey?: string): Promise<void> {
  const settings = await loadSettings();
  const idx = settings.savedModels.findIndex((m) => m.id === model.id);
  if (idx >= 0) {
    settings.savedModels[idx] = model;
  } else {
    settings.savedModels.push(model);
  }
  // Save API key if provided
  if (apiKey !== undefined) {
    await saveApiKey(model.protocol, model.baseUrl ?? null, apiKey);
  }
  await saveSettings(settings);
}

export async function deleteSavedModel(modelId: string): Promise<void> {
  const settings = await loadSettings();
  settings.savedModels = settings.savedModels.filter((m) => m.id !== modelId);
  // Clear any role assignments pointing to this model
  if (settings.modelConfig.tutor.modelId === modelId) {
    // Fall back to mock if tutor is deleted
    settings.modelConfig.tutor = { modelId: 'mock-tutor' };
  }
  if (settings.modelConfig.vision?.modelId === modelId) {
    settings.modelConfig.vision = null;
  }
  if (settings.modelConfig.video?.modelId === modelId) {
    settings.modelConfig.video = null;
  }
  if (settings.modelConfig.audio?.modelId === modelId) {
    settings.modelConfig.audio = null;
  }
  if (settings.modelConfig.search?.modelId === modelId) {
    settings.modelConfig.search = null;
  }
  await saveSettings(settings);
}

export async function getSavedModel(modelId: string): Promise<SavedModel | undefined> {
  const settings = await loadSettings();
  return settings.savedModels.find((m) => m.id === modelId);
}
