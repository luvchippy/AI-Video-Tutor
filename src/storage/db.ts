import Dexie, { type EntityTable } from 'dexie';
import type {
  VideoRecord,
  KnowledgeChunk,
  Keyframe,
  Conversation,
  Message,
  LearningNote,
} from '../types/knowledge';

export class AiVideoTutorDB extends Dexie {
  videos!: EntityTable<VideoRecord, 'id'>;
  chunks!: EntityTable<KnowledgeChunk, 'id'>;
  keyframes!: EntityTable<Keyframe, 'id'>;
  conversations!: EntityTable<Conversation, 'id'>;
  messages!: EntityTable<Message, 'id'>;
  learningNotes!: EntityTable<LearningNote, 'id'>;

  constructor() {
    super('AI_VIDEO_TUTOR_DB');
    this.version(1).stores({
      videos: 'id, createdAt, updatedAt',
      chunks: 'id, videoId, startTime, endTime',
      keyframes: 'id, videoId, timestamp',
      conversations: 'id, videoId, updatedAt',
      messages: 'id, conversationId, createdAt',
      learningNotes: 'id, videoId, createdAt',
    });
  }
}

export const db = new AiVideoTutorDB();
