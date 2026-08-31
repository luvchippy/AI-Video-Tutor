/**
 * Timeline Knowledge Index + Local Storage entity types.
 */

export interface KnowledgeChunk {
  id: string;
  videoId: string;
  startTime: number;
  endTime: number;
  transcript: string;
  summary?: string;
  keywords?: string[];
  concepts?: string[];
  technicalTerms?: string[];
  claims?: string[];
  visualSummary?: string;
  ocr?: string[];
  importance?: number;
}

/** A sparse-analysis keyframe (≈ every 10s), low-res thumbnail only. */
export interface Keyframe {
  id: string;
  videoId: string;
  timestamp: number;
  visualSummary?: string;
  ocr?: string[];
  technicalTerms?: string[];
  diagramType?: string | null;
  importantObjects?: string[];
  importance?: number;
  thumbnailDataUrl?: string;
}

export interface VideoRecord {
  id: string;
  url?: string;
  title?: string;
  platformId?: string;
  duration?: number;
  hasTranscript: boolean;
  hasVisualIndex: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Conversation {
  id: string;
  videoId: string | null;
  title?: string;
  createdAt: number;
  updatedAt: number;
}

export type MessageRole = 'user' | 'assistant' | 'system';

export interface MessageMeta {
  intent?: string;
  currentTime?: number | null;
  usedModels?: string[];
  factChecked?: boolean;
}

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: number;
  meta?: MessageMeta;
}

export interface LearningNote {
  id: string;
  videoId: string;
  chunkId?: string;
  timestamp?: number;
  text: string;
  createdAt: number;
}
