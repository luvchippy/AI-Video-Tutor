import { describe, it, expect } from 'vitest';
import { loadRegistry, getModel, capabilitiesOf, getPresets } from './model-registry';
import { ModelDefinitionSchema } from './schema';

describe('model registry', () => {
  it('loads a non-empty registry', () => {
    const models = loadRegistry();
    expect(models.length).toBeGreaterThan(0);
  });

  it('looks up known models', () => {
    expect(getModel('gemini', 'gemini-2.5-flash')).toBeDefined();
    expect(getModel('deepseek', 'deepseek-v4-flash')).toBeDefined();
    expect(getModel('mock', 'mock-tutor')).toBeDefined();
    expect(getModel('nope', 'nope')).toBeUndefined();
  });

  it('exposes capabilities', () => {
    const ds = capabilitiesOf('deepseek', 'deepseek-v4-flash')!;
    expect(ds.textInput).toBe(true);
    expect(ds.imageInput).toBe(false);
    expect(ds.nativeWebSearch).toBe(false);

    const gemini = capabilitiesOf('gemini', 'gemini-2.5-flash')!;
    expect(gemini.videoInput).toBe(true);
    expect(gemini.nativeWebSearch).toBe(true);
  });

  it('provides three presets', () => {
    const presets = getPresets();
    expect(presets).toHaveLength(3);
    expect(presets.map((p) => p.id)).toEqual(['value', 'gemini-all', 'qwen-omni']);
  });

  it('presets use protocol-based slots', () => {
    const presets = getPresets();
    const value = presets.find((p) => p.id === 'value')!;
    expect(value.tutor.protocol).toBe('deepseek');
    expect(value.tutor.modelId).toBe('deepseek-v4-flash');
    expect(value.vision?.protocol).toBe('gemini');
  });

  it('rejects an invalid definition', () => {
    expect(() =>
      ModelDefinitionSchema.parse({ id: 'x', displayName: 'x' }),
    ).toThrow();
  });

  it('rejects a definition with a wrong capability type', () => {
    const bad = {
      provider: 'x',
      id: 'x',
      displayName: 'x',
      capabilities: { textInput: 'yes' },
      roles: { tutor: true, vision: false, video: false, search: false },
    };
    expect(() => ModelDefinitionSchema.parse(bad)).toThrow();
  });
});
