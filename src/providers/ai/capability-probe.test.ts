import { describe, it, expect, vi } from 'vitest';
import {
  probeCapabilities,
  PROBE_IMAGE,
  PROBE_TEXT_PROMPT,
} from './capability-probe';
import type { AiProvider } from '../../types/provider';
import type { ModelCapabilities } from '../../types/model';

const BASE: ModelCapabilities = {
  textInput: true,
  imageInput: false,
  audioInput: false,
  videoInput: false,
  videoFileUpload: false,
  directVideoUrl: false,
  youtubeUrl: false,
  nativeWebSearch: false,
  functionCalling: true,
  structuredOutput: false,
  streaming: true,
  contextWindow: 128000,
};

function fakeProvider(overrides: Partial<AiProvider> = {}): AiProvider {
  const base: AiProvider = {
    id: 'test:probe-model',
    provider: 'test',
    modelId: 'probe-model',
    displayName: 'Probe Model',
    capabilities: BASE,
    async *streamChat() {},
    chat: vi.fn(async () => ({ text: 'OK', finishReason: 'stop' })),
    analyzeImage: vi.fn(async () => 'OK'),
    search: vi.fn(async () => []),
  };
  return Object.assign(base, overrides);
}

describe('probeCapabilities', () => {
  it('reports both capabilities when the endpoint answers both probes', async () => {
    const provider = fakeProvider();
    const { capabilities, probed } = await probeCapabilities(provider, BASE);

    expect(probed).toEqual({ textInput: true, imageInput: true });
    expect(capabilities.textInput).toBe(true);
    expect(capabilities.imageInput).toBe(true);
  });

  it('marks imageInput false when only the image request fails', async () => {
    const provider = fakeProvider({
      analyzeImage: vi.fn(async () => {
        throw new Error('HTTP 400: image content not supported');
      }),
    });
    const { capabilities, probed } = await probeCapabilities(provider, BASE);

    expect(probed).toEqual({ textInput: true, imageInput: false });
    expect(capabilities.textInput).toBe(true);
    expect(capabilities.imageInput).toBe(false);
  });

  it('skips the image probe and leaves imageInput untouched when text fails', async () => {
    // A dead endpoint says nothing about vision support, so overriding
    // imageInput from that would mislabel the model.
    const analyzeImage = vi.fn(async () => 'OK');
    const provider = fakeProvider({
      chat: vi.fn(async () => {
        throw new Error('HTTP 401: bad key');
      }),
      analyzeImage,
    });
    const { capabilities, probed } = await probeCapabilities(provider, BASE);

    expect(probed).toEqual({ textInput: false, imageInput: null });
    expect(capabilities.textInput).toBe(false);
    expect(capabilities.imageInput).toBe(BASE.imageInput);
    expect(analyzeImage).not.toHaveBeenCalled();
  });

  it('overrides nothing when the caller aborts', async () => {
    const controller = new AbortController();
    const provider = fakeProvider({
      chat: vi.fn(async () => {
        controller.abort();
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      }),
    });

    const { capabilities, probed } = await probeCapabilities(
      provider,
      BASE,
      controller.signal,
    );

    expect(probed).toEqual({ textInput: null, imageInput: null });
    expect(capabilities).toEqual(BASE);
  });

  it('sends the documented minimal text request', async () => {
    const chat = vi.fn(async () => ({ text: 'OK', finishReason: 'stop' }));
    await probeCapabilities(fakeProvider({ chat }), BASE);

    expect(chat).toHaveBeenCalledWith(
      {
        model: 'probe-model',
        messages: [{ role: 'user', content: PROBE_TEXT_PROMPT }],
        maxTokens: 8,
      },
      undefined,
    );
  });

  it('ships a decodable 1x1 PNG as the probe image', () => {
    // Guards against a future edit pasting a malformed literal: providers
    // reject undecodable images, which would look like "no vision support".
    // Decoded with atob rather than Buffer — @types/node is not a dependency.
    const bytes = Uint8Array.from(atob(PROBE_IMAGE.data), (c) => c.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    const ascii = (start: number, end: number): string =>
      String.fromCharCode(...bytes.subarray(start, end));

    expect(Array.from(bytes.subarray(0, 8))).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]);
    expect(ascii(12, 16)).toBe('IHDR');
    expect(view.getUint32(16)).toBe(1);
    expect(view.getUint32(20)).toBe(1);
    expect(PROBE_IMAGE.mimeType).toBe('image/png');
  });
});