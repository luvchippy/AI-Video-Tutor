import { describe, it, expect } from 'vitest';
import { getProtocol, listProtocols, protocolToAuthProfile, PROTOCOLS, PROTOCOL_IDS } from './protocol-registry';

describe('PROTOCOLS', () => {
  it('contains openai-compatible protocol', () => {
    expect(PROTOCOLS['openai-compatible']).toBeDefined();
    expect(PROTOCOLS['openai-compatible'].chatPath).toBe('/chat/completions');
    expect(PROTOCOLS['openai-compatible'].auth.header).toBe('Authorization');
    expect(PROTOCOLS['openai-compatible'].auth.prefix).toBe('Bearer ');
    expect(PROTOCOLS['openai-compatible'].requestFormat).toBe('openai-chat');
  });

  it('contains dots-openai protocol with /v1/chat/completions', () => {
    expect(PROTOCOLS['dots-openai']).toBeDefined();
    expect(PROTOCOLS['dots-openai'].chatPath).toBe('/v1/chat/completions');
    expect(PROTOCOLS['dots-openai'].auth.header).toBe('api-key');
    expect(PROTOCOLS['dots-openai'].auth.prefix).toBe('');
    expect(PROTOCOLS['dots-openai'].defaultBaseUrl).toBe('https://note3-prev-api.askdiandian.com');
  });

  it('contains gemini, deepseek, qwen, mock protocols', () => {
    expect(PROTOCOLS.gemini).toBeDefined();
    expect(PROTOCOLS.deepseek).toBeDefined();
    expect(PROTOCOLS.qwen).toBeDefined();
    expect(PROTOCOLS.mock).toBeDefined();
  });
});

describe('getProtocol', () => {
  it('returns protocol by id', () => {
    const proto = getProtocol('dots-openai');
    expect(proto?.id).toBe('dots-openai');
    expect(proto?.chatPath).toBe('/v1/chat/completions');
  });

  it('returns undefined for unknown id', () => {
    expect(getProtocol('unknown')).toBeUndefined();
  });
});

describe('listProtocols', () => {
  it('returns all protocols including mock', () => {
    const protos = listProtocols();
    expect(protos.length).toBeGreaterThanOrEqual(5);
    expect(protos.some((p) => p.id === 'openai-compatible')).toBe(true);
    expect(protos.some((p) => p.id === 'dots-openai')).toBe(true);
  });
});

describe('protocolToAuthProfile', () => {
  it('converts openai-compatible to standard Bearer auth', () => {
    const profile = protocolToAuthProfile(PROTOCOLS['openai-compatible']);
    expect(profile.authHeader).toBe('Authorization');
    expect(profile.authScheme).toBe('Bearer ');
    expect(profile.endpointPath).toBe('/chat/completions');
  });

  it('converts dots-openai to api-key auth', () => {
    const profile = protocolToAuthProfile(PROTOCOLS['dots-openai']);
    expect(profile.authHeader).toBe('api-key');
    expect(profile.authScheme).toBe('');
    expect(profile.endpointPath).toBe('/v1/chat/completions');
  });
});

describe('PROTOCOL_IDS', () => {
  it('includes all expected protocol IDs', () => {
    expect(PROTOCOL_IDS).toContain('openai-compatible');
    expect(PROTOCOL_IDS).toContain('dots-openai');
    expect(PROTOCOL_IDS).toContain('gemini');
    expect(PROTOCOL_IDS).toContain('deepseek');
    expect(PROTOCOL_IDS).toContain('qwen');
    expect(PROTOCOL_IDS).toContain('mock');
  });
});
