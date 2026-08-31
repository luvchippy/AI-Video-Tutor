import type { AiProvider, ImageInput } from '../types/provider';
import type { Keyframe } from '../types/knowledge';
import { buildSparseIndexPrompt } from '../prompts/sparse';

/**
 * Global Sparse Analysis — build a low-cost visual index (~1 frame / 10s).
 */

export const SPARSE_INTERVAL = 10;

/** Candidate sample times: 0, 10, 20, ... (exclusive of duration). */
export function candidateTimes(duration: number, interval = SPARSE_INTERVAL): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const times: number[] = [];
  for (let t = 0; t < duration; t += interval) times.push(t);
  return times;
}

export interface SparseFrameResult {
  visualSummary?: string;
  ocr?: string[];
  technicalTerms?: string[];
  diagramType?: string | null;
  importantObjects?: string[];
  importance?: number;
}

/** Extract a JSON object from a model's text output (handles ```json fences). */
export function extractJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  try {
    const v = JSON.parse(trimmed);
    if (v && typeof v === 'object') return v as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      return JSON.parse(fence[1]!.trim()) as Record<string, unknown>;
    } catch {
      /* fall through */
    }
  }
  const brace = trimmed.match(/\{[\s\S]*\}/);
  if (brace) {
    try {
      return JSON.parse(brace[0]!) as Record<string, unknown>;
    } catch {
      /* fall through */
    }
  }
  return null;
}

function asStringArray(v: unknown): string[] | undefined {
  return Array.isArray(v) ? v.map((x) => String(x)) : undefined;
}

export function parseSparseResult(text: string): SparseFrameResult | null {
  const obj = extractJson(text);
  if (!obj) return null;
  const importance =
    typeof obj.importance === 'number' ? obj.importance : undefined;
  return {
    visualSummary:
      typeof obj.visual_summary === 'string' ? obj.visual_summary : undefined,
    ocr: asStringArray(obj.visible_text),
    technicalTerms: asStringArray(obj.technical_terms),
    diagramType:
      typeof obj.diagram_type === 'string' ? obj.diagram_type : undefined,
    importantObjects: asStringArray(obj.important_objects),
    importance,
  };
}

/** Analyze a single frame and produce a Keyframe. Raw image is NOT persisted. */
export async function analyzeFrame(
  provider: AiProvider,
  image: ImageInput,
  videoId: string,
  timestamp: number,
  signal?: AbortSignal,
): Promise<Keyframe | null> {
  const text = await provider.analyzeImage(image, buildSparseIndexPrompt(), signal);
  const result = parseSparseResult(text);
  if (!result) return null;
  return {
    id: `${videoId}@${timestamp}`,
    videoId,
    timestamp,
    visualSummary: result.visualSummary,
    ocr: result.ocr,
    technicalTerms: result.technicalTerms,
    diagramType: result.diagramType ?? null,
    importantObjects: result.importantObjects,
    importance: result.importance,
  };
}
