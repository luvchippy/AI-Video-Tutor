import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  convertRawCatalog,
  mapRemoteModelToCapabilities,
  getLocalOverrides,
  findModelInOverrides,
  findModelInList,
} from './remote-model-registry';

beforeEach(() => {
  vi.unstubAllGlobals();
});

/** Build a raw model object that matches the models.dev schema (pre-validation). */
function makeModel(opts: {
  name?: string;
  tool_call?: boolean;
  reasoning?: boolean;
  structured_output?: boolean;
  attachment?: boolean;
  context?: number;
  modalities?: { input?: string[]; output?: string[] };
  status?: string;
}) {
  return {
    name: opts.name ?? 'Test',
    tool_call: opts.tool_call ?? false,
    reasoning: opts.reasoning ?? false,
    structured_output: opts.structured_output ?? false,
    attachment: opts.attachment ?? false,
    limit: { context: opts.context, output: 4096 },
    modalities: opts.modalities ?? { input: ['text'], output: ['text'] },
    status: opts.status,
  };
}

describe('mapRemoteModelToCapabilities', () => {
  it('maps text-only model', () => {
    const model = makeModel({ name: 'Test Model', context: 8192 });
    const caps = mapRemoteModelToCapabilities(model);
    expect(caps.textInput).toBe(true);
    expect(caps.imageInput).toBe(false);
    expect(caps.audioInput).toBe(false);
    expect(caps.videoInput).toBe(false);
    expect(caps.functionCalling).toBe(false);
    expect(caps.contextWindow).toBe(8192);
  });

  it('maps multimodal model with image+audio+video', () => {
    const model = makeModel({
      name: 'Omni Model',
      tool_call: true,
      context: 128000,
      modalities: { input: ['text', 'image', 'audio', 'video'], output: ['text'] },
    });
    const caps = mapRemoteModelToCapabilities(model);
    expect(caps.textInput).toBe(true);
    expect(caps.imageInput).toBe(true);
    expect(caps.audioInput).toBe(true);
    expect(caps.videoInput).toBe(true);
    expect(caps.functionCalling).toBe(true);
    expect(caps.contextWindow).toBe(128000);
  });

  it('maps tool_call to functionCalling', () => {
    const model = makeModel({ name: 'Tool Model', tool_call: true });
    const caps = mapRemoteModelToCapabilities(model);
    expect(caps.functionCalling).toBe(true);
  });

  it('defaults nativeWebSearch to false (never trust remote for this)', () => {
    const model = makeModel({ name: 'Search Model' });
    const caps = mapRemoteModelToCapabilities(model);
    expect(caps.nativeWebSearch).toBe(false);
  });
});

describe('convertRawCatalog', () => {
  it('converts a catalog with providers and models', () => {
    const catalog = {
      'openai': {
        name: 'OpenAI',
        models: {
          'gpt-4o': {
            name: 'GPT-4o',
            tool_call: true,
            reasoning: false,
            structured_output: true,
            attachment: false,
            modalities: { input: ['text', 'image'], output: ['text'] },
            limit: { context: 128000, output: 16384 },
          },
          'gpt-4o-mini': {
            name: 'GPT-4o mini',
            tool_call: true,
            reasoning: false,
            structured_output: true,
            attachment: false,
            modalities: { input: ['text', 'image'], output: ['text'] },
            limit: { context: 128000, output: 16384 },
          },
        },
      },
      'deepseek': {
        name: 'DeepSeek',
        models: {
          'deepseek-chat': {
            name: 'DeepSeek Chat',
            tool_call: true,
            reasoning: false,
            structured_output: false,
            attachment: false,
            modalities: { input: ['text'], output: ['text'] },
            limit: { context: 64000, output: 8192 },
          },
        },
      },
    };
    const models = convertRawCatalog(catalog);
    expect(models).toHaveLength(3);
    expect(models.find((m) => m.id === 'gpt-4o')?.capabilities.imageInput).toBe(true);
    expect(models.find((m) => m.id === 'deepseek-chat')?.capabilities.textInput).toBe(true);
    expect(models.find((m) => m.id === 'gpt-4o')?.provider).toBe('openai');
  });

  it('skips deprecated models', () => {
    const catalog = {
      'openai': {
        name: 'OpenAI',
        models: {
          'gpt-3.5-turbo': {
            name: 'GPT-3.5 Turbo',
            tool_call: false,
            reasoning: false,
            structured_output: false,
            attachment: false,
            status: 'deprecated',
            modalities: { input: ['text'], output: ['text'] },
          },
          'gpt-4o': {
            name: 'GPT-4o',
            tool_call: true,
            reasoning: false,
            structured_output: true,
            attachment: false,
            modalities: { input: ['text', 'image'], output: ['text'] },
          },
        },
      },
    };
    const models = convertRawCatalog(catalog);
    expect(models).toHaveLength(1);
    expect(models[0]!.id).toBe('gpt-4o');
  });

  it('returns empty array for invalid data', () => {
    expect(convertRawCatalog({})).toEqual([]);
    expect(convertRawCatalog({ invalid: { models: { bad: 'not-an-object' } } })).toEqual([]);
  });
});

describe('getLocalOverrides', () => {
  it('contains dots3-note-prev with correct capabilities', () => {
    const overrides = getLocalOverrides();
    const dots = overrides.find((m) => m.id === 'dots3-note-prev');
    expect(dots).toBeDefined();
    expect(dots!.provider).toBe('dots');
    expect(dots!.capabilities.textInput).toBe(true);
    expect(dots!.capabilities.imageInput).toBe(true);
    expect(dots!.capabilities.videoInput).toBe(true);
    expect(dots!.capabilities.audioInput).toBe(true);
    expect(dots!.capabilities.functionCalling).toBe(true);
    expect(dots!.capabilities.nativeWebSearch).toBe(false);
    expect(dots!.capabilities.contextWindow).toBe(524288);
  });
});

describe('findModelInOverrides', () => {
  it('finds dots3-note-prev', () => {
    const model = findModelInOverrides('dots', 'dots3-note-prev');
    expect(model).toBeDefined();
    expect(model!.id).toBe('dots3-note-prev');
  });

  it('returns undefined for unknown model', () => {
    expect(findModelInOverrides('dots', 'unknown')).toBeUndefined();
    expect(findModelInOverrides('unknown', 'unknown')).toBeUndefined();
  });
});

describe('findModelInList', () => {
  it('finds a model in a list by provider + id', () => {
    const list = getLocalOverrides();
    const model = findModelInList(list, 'dots', 'dots3-note-prev');
    expect(model).toBeDefined();
  });

  it('returns undefined for unknown model', () => {
    const list = getLocalOverrides();
    expect(findModelInList(list, 'unknown', 'unknown')).toBeUndefined();
  });
});
