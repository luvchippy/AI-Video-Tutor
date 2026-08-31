import type { AiProvider, ImageInput, SearchProvider, SearchResult } from '../types/provider';
import type { KnowledgeChunk } from '../types/knowledge';
import type { Settings } from '../types/model';
import type { QuestionIntent } from '../types/intent';
import { classifyIntent } from '../router/intent';
import { buildLocalVisionPrompt } from '../prompts/vision';
import { buildTutorMessages, type VideoInfo } from './context-assembly';
import { retrieve } from '../rag/retriever';
import {
  NO_WEB_SEARCH_MESSAGE,
  NOT_VERIFIED_TAG,
} from '../providers/search';

export interface AnswerMeta {
  intent: QuestionIntent;
  currentTime: number | null;
  usedModels: string[];
  factChecked: boolean;
}

export type EngineEvent =
  | { type: 'sources'; sources: SearchResult[] }
  | { type: 'delta'; text: string }
  | { type: 'done'; meta: AnswerMeta }
  | { type: 'error'; error: string };

export interface AnswerPlan {
  intent: QuestionIntent;
  useVision: boolean;
  useSearch: boolean;
  searchDisabledReason: string | null;
}

/** Pure: decide how to route a question. Testable without providers. */
export function planAnswer(
  question: string,
  opts: {
    hasVideo: boolean;
    visionAvailable: boolean;
    frameAvailable: boolean;
    searchAvailable: boolean;
    intentHint?: QuestionIntent;
  },
): AnswerPlan {
  const intent =
    opts.intentHint ?? classifyIntent(question, { hasVideo: opts.hasVideo });
  const useVision =
    intent === 'VISUAL_QUESTION' &&
    opts.visionAvailable &&
    opts.frameAvailable;
  const needsSearch = intent === 'FACT_CHECK' || intent === 'CURRENT_INFO';
  const useSearch = needsSearch && opts.searchAvailable;
  const searchDisabledReason =
    needsSearch && !opts.searchAvailable ? NO_WEB_SEARCH_MESSAGE : null;
  return { intent, useVision, useSearch, searchDisabledReason };
}

export function dataUrlToImageInput(dataUrl: string): ImageInput | null {
  const m = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!m) return null;
  return { mimeType: m[1]!, data: m[2]! };
}

export interface AnswerInput {
  question: string;
  video: VideoInfo | null;
  chunks: KnowledgeChunk[];
  currentTime: number | null;
  frameDataUrl: string | null;
  intentHint?: QuestionIntent;
}

/**
 * Tutor Engine — orchestrates intent routing → RAG retrieval → vision/search
 * enrichment → tutor model streaming. The product's brain.
 */
export class TutorEngine {
  constructor(
    private tutor: AiProvider,
    private vision: AiProvider | null,
    private search: SearchProvider,
    private settings: Settings,
  ) {}

  async *answer(input: AnswerInput, signal?: AbortSignal): AsyncGenerator<EngineEvent> {
    const hasVideo = input.video != null;
    const visionAvailable = this.vision?.capabilities.imageInput === true;
    const plan = planAnswer(input.question, {
      hasVideo,
      visionAvailable,
      frameAvailable: input.frameDataUrl != null,
      searchAvailable: this.search.available,
      intentHint: input.intentHint,
    });

    const usedModels = new Set<string>([this.tutor.id]);

    try {
      let visionText: string | null = null;

      if (plan.useVision && this.vision && input.frameDataUrl) {
        const image = dataUrlToImageInput(input.frameDataUrl);
        if (image) {
          usedModels.add(this.vision.id);
          visionText = await this.vision.analyzeImage(
            image,
            buildLocalVisionPrompt(input.question),
            signal,
          );
        }
      }

      let sources: SearchResult[] = [];
      if (plan.useSearch) {
        sources = await this.search.search(input.question, signal);
        if (sources.length > 0) yield { type: 'sources', sources };
      }

      const { topChunks } = retrieve(input.chunks, input.question, input.currentTime);
      const messages = buildTutorMessages({
        settings: this.settings,
        video: input.video,
        currentTime: input.currentTime,
        chunks: topChunks,
        visionText,
        sources,
        searchDisabledReason: plan.searchDisabledReason,
        intent: plan.intent,
        question: input.question,
      });

      for await (const chunk of this.tutor.streamChat(
        { model: this.tutor.modelId, messages },
        signal,
      )) {
        if (chunk.text) yield { type: 'delta', text: chunk.text };
        const groundingSources = chunk.grounding?.sources ?? [];
        if (groundingSources.length > 0) {
          yield { type: 'sources', sources: groundingSources };
        }
      }

      yield {
        type: 'done',
        meta: {
          intent: plan.intent,
          currentTime: input.currentTime,
          usedModels: [...usedModels],
          factChecked: plan.useSearch,
        },
      };
    } catch (e) {
      yield {
        type: 'error',
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
}

export { NOT_VERIFIED_TAG };
