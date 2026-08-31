/**
 * Protocol Registry — separates "how to call the API" (protocol) from
 * "what the model can do" (model capabilities).
 *
 * A ProtocolProfile defines:
 *   - The chat endpoint path
 *   - The authentication header scheme
 *   - The request format (currently only openai-chat is implemented)
 *
 * This allows adding new providers that use the OpenAI chat/completions
 * request body format but differ in auth or endpoint path — without
 * writing a new Provider class.
 */

export type RequestFormat = 'openai-chat' | 'anthropic-messages' | 'gemini-native' | 'qwen-native';

export interface ProtocolProfile {
  /** Unique protocol identifier, e.g. 'openai-compatible', 'dots-openai' */
  readonly id: string;
  /** Human-readable label for the UI dropdown */
  readonly label: string;
  /** Chat endpoint path appended to baseUrl, e.g. '/chat/completions' or '/v1/chat/completions' */
  readonly chatPath: string;
  /** Auth configuration */
  readonly auth: {
    /** Header name, e.g. 'Authorization' or 'api-key' */
    readonly header: string;
    /** Value prefix before the key, e.g. 'Bearer ' (trailing space). Empty string for none. */
    readonly prefix: string;
  };
  /** Request body format — determines which Provider class handles it */
  readonly requestFormat: RequestFormat;
  /** Default base URL if the protocol has a canonical one (e.g. Dots) */
  readonly defaultBaseUrl?: string;
}

export const PROTOCOLS = {
  'openai-compatible': {
    id: 'openai-compatible',
    label: 'OpenAI 兼容（中转站 / OpenAI / DeepSeek / 其他）',
    chatPath: '/chat/completions',
    auth: { header: 'Authorization', prefix: 'Bearer ' },
    requestFormat: 'openai-chat' as const,
  },
  'dots-openai': {
    id: 'dots-openai',
    label: 'Dots API',
    chatPath: '/v1/chat/completions',
    auth: { header: 'api-key', prefix: '' },
    requestFormat: 'openai-chat' as const,
    defaultBaseUrl: 'https://note3-prev-api.askdiandian.com',
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini (Google AI)',
    chatPath: '/chat/completions',
    auth: { header: 'Authorization', prefix: 'Bearer ' },
    requestFormat: 'openai-chat' as const,
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek (官方)',
    chatPath: '/chat/completions',
    auth: { header: 'Authorization', prefix: 'Bearer ' },
    requestFormat: 'openai-chat' as const,
    defaultBaseUrl: 'https://api.deepseek.com',
  },
  qwen: {
    id: 'qwen',
    label: 'Qwen (DashScope)',
    chatPath: '/chat/completions',
    auth: { header: 'Authorization', prefix: 'Bearer ' },
    requestFormat: 'openai-chat' as const,
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  },
  mock: {
    id: 'mock',
    label: 'Mock (Demo)',
    chatPath: '',
    auth: { header: '', prefix: '' },
    requestFormat: 'openai-chat' as const,
  },
} as const satisfies Record<string, ProtocolProfile>;

export type ProtocolId = keyof typeof PROTOCOLS;

/** All protocol IDs for UI dropdowns */
export const PROTOCOL_IDS = Object.keys(PROTOCOLS) as ProtocolId[];

/** Get a protocol profile by ID */
export function getProtocol(id: string): ProtocolProfile | undefined {
  return PROTOCOLS[id as ProtocolId];
}

/** Get all protocol profiles for UI dropdowns */
export function listProtocols(): ProtocolProfile[] {
  return PROTOCOL_IDS.map((id) => PROTOCOLS[id]);
}

/**
 * Convert a ProtocolProfile to an AuthProfile for the Provider layer.
 * This bridges the new ProtocolProfile abstraction to the existing
 * OpenAICompatibleProvider.authProfile field.
 */
export function protocolToAuthProfile(proto: ProtocolProfile) {
  return {
    authHeader: proto.auth.header,
    authScheme: proto.auth.prefix,
    endpointPath: proto.chatPath,
  };
}
