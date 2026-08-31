import type {
  AiProvider,
  ChatMessage,
  ChatRequest,
  ChatResult,
  ContentPart,
  GroundingMetadata,
  ImageInput,
  SearchResult,
  StreamChunk,
  Usage,
} from '../../types/provider';
import type { ModelCapabilities } from '../../types/model';
import type { ProviderConfig } from '../../types/provider';
import { iterateSse, isAbortError } from './sse';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export const GEMINI_CAPABILITIES: ModelCapabilities = {
  textInput: true,
  imageInput: true,
  audioInput: true,
  videoInput: true,
  videoFileUpload: true,
  directVideoUrl: true,
  youtubeUrl: true,
  nativeWebSearch: true,
  functionCalling: true,
  structuredOutput: true,
  streaming: true,
  contextWindow: 1048576,
};

/* ----------------------------- Gemini part shapes ----------------------------- */

interface GeminiTextPart {
  text: string;
}
interface GeminiInlineDataPart {
  inline_data: { mime_type: string; data: string };
}
interface GeminiFileDataPart {
  file_data: { mime_type: string; file_uri: string };
}
type GeminiPart = GeminiTextPart | GeminiInlineDataPart | GeminiFileDataPart;

interface GeminiRequestBody {
  contents: { role: string; parts: GeminiPart[] }[];
  systemInstruction?: { parts: GeminiPart[] };
  generationConfig?: { temperature?: number; maxOutputTokens?: number };
  tools?: { google_search: Record<string, never> }[];
}

interface GeminiCandidate {
  content?: { parts?: { text?: string }[]; role?: string };
  finishReason?: string;
  groundingMetadata?: GeminiGroundingMetadata;
}
interface GeminiResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}
interface GeminiGroundingMetadata {
  webSearchQueries?: string[];
  groundingChunks?: { web?: { uri?: string; title?: string } }[];
}
interface GeminiErrorBody {
  error?: { code?: number; message?: string; status?: string };
}

/* ------------------------------- helpers ------------------------------- */

function parseDataUrl(url: string): { mimeType: string; data: string } {
  const comma = url.indexOf(',');
  const header = url.slice(0, comma);
  const data = url.slice(comma + 1);
  const mimeType = header.replace(/^data:/, '').replace(/;base64$/, '');
  return { mimeType: mimeType || 'image/jpeg', data };
}

function toGeminiPart(part: ContentPart): GeminiPart {
  switch (part.type) {
    case 'text':
      return { text: part.text };
    case 'inline_image':
      return {
        inline_data: {
          mime_type: part.inline_image.mimeType,
          data: part.inline_image.data,
        },
      };
    case 'image_url': {
      const url = part.image_url.url;
      if (url.startsWith('data:')) {
        const { mimeType, data } = parseDataUrl(url);
        return { inline_data: { mime_type: mimeType, data } };
      }
      return { file_data: { mime_type: 'image/*', file_uri: url } };
    }
    case 'video_url':
      return {
        file_data: { mime_type: 'video/*', file_uri: part.video_url.url },
      };
  }
}

function contentToGeminiParts(content: string | ContentPart[]): GeminiPart[] {
  if (typeof content === 'string') return [{ text: content }];
  return content.map(toGeminiPart);
}

function textPartsOf(content: string | ContentPart[]): string[] {
  if (typeof content === 'string') return [content];
  const out: string[] = [];
  for (const p of content) {
    if (p.type === 'text') out.push(p.text);
  }
  return out;
}

function usageFrom(u?: GeminiResponse['usageMetadata']): Usage | undefined {
  if (!u) return undefined;
  const usage: Usage = {};
  if (u.promptTokenCount !== undefined) usage.promptTokens = u.promptTokenCount;
  if (u.candidatesTokenCount !== undefined)
    usage.completionTokens = u.candidatesTokenCount;
  if (u.totalTokenCount !== undefined) usage.totalTokens = u.totalTokenCount;
  return usage;
}

function groundingFrom(
  g?: GeminiGroundingMetadata,
): GroundingMetadata | undefined {
  if (!g) return undefined;
  const webSearchQueries = g.webSearchQueries ?? [];
  const sources: { url: string; title: string }[] = [];
  for (const chunk of g.groundingChunks ?? []) {
    const web = chunk.web;
    if (!web?.uri) continue;
    sources.push({ url: web.uri, title: web.title ?? web.uri });
  }
  if (webSearchQueries.length === 0 && sources.length === 0) return undefined;
  return { webSearchQueries, sources };
}

function candidateText(candidate?: GeminiCandidate): string {
  const parts = candidate?.content?.parts ?? [];
  return parts.map((p) => p.text ?? '').join('');
}

/* ------------------------------- provider ------------------------------- */

export class GeminiProvider implements AiProvider {
  readonly id: string;
  readonly provider = 'gemini';
  readonly modelId: string;
  readonly displayName: string;
  readonly capabilities: ModelCapabilities;
  private readonly apiKey: string;

  constructor(config: ProviderConfig) {
    this.modelId = config.modelId;
    this.apiKey = config.apiKey ?? '';
    this.displayName = config.displayName ?? `Gemini ${config.modelId}`;
    this.capabilities = config.capabilities ?? GEMINI_CAPABILITIES;
    this.id = `gemini:${config.modelId}`;
  }

  private buildBody(req: ChatRequest): GeminiRequestBody {
    const contents: { role: string; parts: GeminiPart[] }[] = [];
    const systemTexts: string[] = [];

    for (const msg of req.messages) {
      if (msg.role === 'system') {
        systemTexts.push(...textPartsOf(msg.content));
        continue;
      }
      const role = msg.role === 'assistant' ? 'model' : 'user';
      contents.push({ role, parts: contentToGeminiParts(msg.content) });
    }

    const body: GeminiRequestBody = { contents };
    if (systemTexts.length > 0) {
      body.systemInstruction = {
        parts: systemTexts.map((text) => ({ text })),
      };
    }
    if (req.temperature !== undefined || req.maxTokens !== undefined) {
      const generationConfig: NonNullable<GeminiRequestBody['generationConfig']> =
        {};
      if (req.temperature !== undefined)
        generationConfig.temperature = req.temperature;
      if (req.maxTokens !== undefined)
        generationConfig.maxOutputTokens = req.maxTokens;
      body.generationConfig = generationConfig;
    }
    if (req.webSearch) {
      body.tools = [{ google_search: {} }];
    }
    return body;
  }

  private async request(
    url: string,
    body: GeminiRequestBody,
    signal?: AbortSignal,
  ): Promise<Response> {
    try {
      return await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      if (isAbortError(e)) throw new Error('aborted', { cause: e });
      throw e;
    }
  }

  private async throwOnError(response: Response): Promise<never> {
    let status: string | number = response.status;
    let message = 'unknown error';
    try {
      const body: GeminiErrorBody = await response.json();
      if (body.error?.status) status = body.error.status;
      if (body.error?.message) message = body.error.message;
    } catch {
      // ignore malformed error body
    }
    throw new Error(`Gemini API error ${status}: ${message}`);
  }

  async *streamChat(
    req: ChatRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamChunk> {
    const url = `${DEFAULT_BASE_URL}/models/${this.modelId}:streamGenerateContent?alt=sse`;
    const response = await this.request(url, this.buildBody(req), signal);
    if (!response.ok) await this.throwOnError(response);

    try {
      for await (const payload of iterateSse(response)) {
        if (payload.trim() === '[DONE]') break;
        let data: GeminiResponse;
        try {
          data = JSON.parse(payload) as GeminiResponse;
        } catch {
          continue;
        }
        const candidate = data.candidates?.[0];
        const finishReason = candidate?.finishReason ?? null;
        yield {
          text: candidateText(candidate),
          done: finishReason === 'STOP',
          finishReason,
          usage: usageFrom(data.usageMetadata),
          grounding: groundingFrom(candidate?.groundingMetadata),
        };
      }
    } catch (e) {
      if (isAbortError(e)) throw new Error('aborted', { cause: e });
      throw e;
    }
  }

  async chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResult> {
    const url = `${DEFAULT_BASE_URL}/models/${this.modelId}:generateContent`;
    const response = await this.request(url, this.buildBody(req), signal);
    if (!response.ok) await this.throwOnError(response);
    const data: GeminiResponse = await response.json();
    const candidate = data.candidates?.[0];
    return {
      text: candidateText(candidate),
      finishReason: candidate?.finishReason ?? null,
      usage: usageFrom(data.usageMetadata),
      grounding: groundingFrom(candidate?.groundingMetadata),
    };
  }

  async analyzeImage(
    image: ImageInput,
    prompt: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const body: GeminiRequestBody = {
      contents: [
        {
          role: 'user',
          parts: [
            { inline_data: { mime_type: image.mimeType, data: image.data } },
            { text: prompt },
          ],
        },
      ],
    };
    const url = `${DEFAULT_BASE_URL}/models/${this.modelId}:generateContent`;
    const response = await this.request(url, body, signal);
    if (!response.ok) await this.throwOnError(response);
    const data: GeminiResponse = await response.json();
    return candidateText(data.candidates?.[0]);
  }

  async search(
    query: string,
    signal?: AbortSignal,
  ): Promise<SearchResult[]> {
    const body: GeminiRequestBody = {
      contents: [{ role: 'user', parts: [{ text: query }] }],
      tools: [{ google_search: {} }],
    };
    const url = `${DEFAULT_BASE_URL}/models/${this.modelId}:generateContent`;
    const response = await this.request(url, body, signal);
    if (!response.ok) await this.throwOnError(response);
    const data: GeminiResponse = await response.json();
    const g = data.candidates?.[0]?.groundingMetadata;
    const results: SearchResult[] = [];
    for (const chunk of g?.groundingChunks ?? []) {
      const web = chunk.web;
      if (!web?.uri) continue;
      results.push({ title: web.title ?? web.uri, url: web.uri });
    }
    return results;
  }
}

export type { ChatMessage };
