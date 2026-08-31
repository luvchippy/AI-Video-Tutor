import type {
  AiProvider,
  ChatRequest,
  ChatResult,
  ImageInput,
  SearchResult,
  StreamChunk,
} from '../../types/provider';
import type { ModelCapabilities } from '../../types/model';
import type { ProviderConfig } from '../../types/provider';

export const MOCK_CAPABILITIES: ModelCapabilities = {
  textInput: true,
  imageInput: true,
  audioInput: false,
  videoInput: false,
  videoFileUpload: false,
  directVideoUrl: false,
  youtubeUrl: false,
  nativeWebSearch: true,
  functionCalling: false,
  structuredOutput: false,
  streaming: true,
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function mockAnswer(question: string): string {
  const lines = [
    '[DEMO/MOCK] 这是一个模拟回复，用于在没有 API Key 时演示 AI Video Tutor 的交互流程。',
    '',
    `你问的是：${question}`,
    '',
    '在真实模式下，这里会出现结合当前视频内容、播放时间、相关字幕、画面与联网证据的教学式解释。',
    '现在仅作演示，不会调用任何真实模型。',
  ];
  return lines.join('\n');
}

function mockVision(image: ImageInput, prompt: string): string {
  void image;
  return JSON.stringify({
    visual_summary: '[DEMO/MOCK] 模拟画面描述：一张教学示意图，含若干文字标签与结构框。',
    visible_text: ['[mock] 标签 A', '[mock] 标签 B'],
    technical_terms: ['[mock] 术语一'],
    diagram_type: '结构图',
    important_objects: ['[mock] 节点', '[mock] 连线'],
    importance: 0.5,
    _prompt: prompt,
  });
}

/**
 * Mock provider — works with NO api key. Every output is clearly labelled
 * DEMO/MOCK so it can never be mistaken for a real AI response.
 */
export class MockProvider implements AiProvider {
  readonly id = 'mock:mock-tutor';
  readonly provider = 'mock';
  readonly modelId = 'mock-tutor';
  readonly displayName = 'Mock (Demo)';
  readonly capabilities: ModelCapabilities;

  constructor(config?: ProviderConfig) {
    this.capabilities = config?.capabilities ?? MOCK_CAPABILITIES;
  }

  async *streamChat(
    req: ChatRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamChunk> {
    const question =
      typeof req.messages[req.messages.length - 1]?.content === 'string'
        ? (req.messages[req.messages.length - 1]?.content as string)
        : '';
    const full = mockAnswer(question);
    // stream in ~10 small chunks
    const chunkSize = Math.max(1, Math.ceil(full.length / 10));
    for (let i = 0; i < full.length; i += chunkSize) {
      if (signal?.aborted) throw new Error('aborted');
      await sleep(40);
      yield {
        text: full.slice(i, i + chunkSize),
        done: false,
        finishReason: null,
      };
    }
    yield { text: '', done: true, finishReason: 'stop' };
  }

  async chat(req: ChatRequest, _signal?: AbortSignal): Promise<ChatResult> {
    const question =
      typeof req.messages[req.messages.length - 1]?.content === 'string'
        ? (req.messages[req.messages.length - 1]?.content as string)
        : '';
    return {
      text: mockAnswer(question),
      finishReason: 'stop',
    };
  }

  async analyzeImage(
    image: ImageInput,
    prompt: string,
    _signal?: AbortSignal,
  ): Promise<string> {
    await sleep(60);
    return mockVision(image, prompt);
  }

  async search(
    _query: string,
    _signal?: AbortSignal,
  ): Promise<SearchResult[]> {
    await sleep(40);
    return [
      {
        title: '[DEMO/MOCK] 模拟来源一',
        url: 'https://example.com/mock-source-1',
        snippet: '这是一条模拟的联网搜索结果，仅用于演示。',
      },
      {
        title: '[DEMO/MOCK] 模拟来源二',
        url: 'https://example.com/mock-source-2',
        snippet: '模拟证据，不代表真实信息。',
      },
    ];
  }
}
