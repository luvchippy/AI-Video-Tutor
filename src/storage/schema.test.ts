import { describe, it, expect } from 'vitest';
import { ProviderProtocolSchema, SettingsSchema } from './schema';

describe('ProviderProtocolSchema', () => {
  it('accepts dots-openai protocol (Dots API)', () => {
    expect(ProviderProtocolSchema.safeParse('dots-openai').success).toBe(true);
  });
});

describe('SettingsSchema', () => {
  it('accepts a saved Dots model with protocol dots-openai', () => {
    const settings = {
      learnerLevel: 'beginner',
      learnerBackground: '',
      savedModels: [
        {
          id: 'm1',
          name: 'Dots3 Note Prev',
          protocol: 'dots-openai',
          baseUrl: 'https://note3-prev-api.askdiandian.com',
          modelId: 'dots3-note-prev',
          capabilities: {
            textInput: true,
            imageInput: true,
            audioInput: true,
            videoInput: true,
            videoFileUpload: false,
            directVideoUrl: true,
            youtubeUrl: false,
            nativeWebSearch: false,
            functionCalling: true,
            structuredOutput: false,
            streaming: true,
            contextWindow: 524288,
          },
          connectionStatus: 'untested',
          capabilitySource: 'registry',
        },
      ],
      modelConfig: {
        tutor: { modelId: 'm1' },
        vision: null,
        video: null,
        audio: null,
        search: null,
      },
      activePreset: null,
    };

    const result = SettingsSchema.safeParse(settings);
    expect(result.success).toBe(true);
  });

  it('defaults searchService to none for settings stored before the field existed', () => {
    // A required field here would fail safeParse and `loadSettings` would reset
    // every saved model — see the `.default()` note in schema.ts.
    const legacy = {
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

    const result = SettingsSchema.safeParse(legacy);
    expect(result.success).toBe(true);
    expect(result.success && result.data.searchService).toBe('none');
  });

  it('rejects an unknown search service', () => {
    const result = SettingsSchema.safeParse({
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
      searchService: 'google',
    });
    expect(result.success).toBe(false);
  });
});