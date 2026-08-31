import raw from '../data/model-registry.json';
import { ModelRegistrySchema } from './schema';
import type {
  ModelDefinition,
  ModelCapabilities,
  PresetConfig,
  ProviderProtocol,
} from '../types/model';

export function loadRegistry(): ModelDefinition[] {
  return ModelRegistrySchema.parse(raw);
}

const registry: ModelDefinition[] = loadRegistry();

export function listModels(): ModelDefinition[] {
  return registry;
}

export function getModel(
  provider: string,
  id: string,
): ModelDefinition | undefined {
  return registry.find((m) => m.provider === provider && m.id === id);
}

export function capabilitiesOf(
  provider: string,
  id: string,
): ModelCapabilities | undefined {
  return getModel(provider, id)?.capabilities;
}

const PRESET_SLOT = (
  protocol: ProviderProtocol,
  modelId: string,
): { protocol: ProviderProtocol; modelId: string } => ({
  protocol,
  modelId,
});

const PRESETS: PresetConfig[] = [
  {
    id: 'value',
    name: '高性价比',
    description: 'DeepSeek + Gemini 视觉',
    suitableFor: '大多数字幕视频学习',
    tutor: PRESET_SLOT('deepseek', 'deepseek-v4-flash'),
    vision: PRESET_SLOT('gemini', 'gemini-2.5-flash'),
    video: null,
    search: null,
  },
  {
    id: 'gemini-all',
    name: 'Gemini 全能',
    description: 'Tutor · Vision · Video · Search 一个 Provider 完成',
    suitableFor: '需要视觉 + 联网核实',
    tutor: PRESET_SLOT('gemini', 'gemini-2.5-flash'),
    vision: PRESET_SLOT('gemini', 'gemini-2.5-flash'),
    video: PRESET_SLOT('gemini', 'gemini-2.5-flash'),
    search: PRESET_SLOT('gemini', 'gemini-2.5-flash'),
  },
  {
    id: 'qwen-omni',
    name: 'Qwen Omni 全能',
    description: 'Tutor · Vision · Audio · Video（中文用户友好）',
    suitableFor: '中文学习',
    tutor: PRESET_SLOT('qwen', 'qwen-omni-turbo'),
    vision: PRESET_SLOT('qwen', 'qwen-omni-turbo'),
    video: PRESET_SLOT('qwen', 'qwen-omni-turbo'),
    search: null,
  },
];

export function getPresets(): PresetConfig[] {
  return PRESETS;
}

export function getPreset(id: string): PresetConfig | undefined {
  return PRESETS.find((p) => p.id === id);
}
