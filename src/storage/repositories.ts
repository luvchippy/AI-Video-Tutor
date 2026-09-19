import { db } from './db';
import type {
  VideoRecord,
  KnowledgeChunk,
  Keyframe,
  Conversation,
  Message,
  LearningNote,
} from '../types/knowledge';

export async function upsertVideo(video: VideoRecord): Promise<void> {
  await db.videos.put(video);
}

export async function getVideo(id: string): Promise<VideoRecord | undefined> {
  return db.videos.get(id);
}

export async function listChunks(videoId: string): Promise<KnowledgeChunk[]> {
  return db.chunks.where('videoId').equals(videoId).sortBy('startTime');
}

export async function putChunks(chunks: KnowledgeChunk[]): Promise<void> {
  await db.chunks.bulkPut(chunks);
}

export async function putKeyframe(kf: Keyframe): Promise<void> {
  await db.keyframes.put(kf);
}

export async function listKeyframes(videoId: string): Promise<Keyframe[]> {
  return db.keyframes.where('videoId').equals(videoId).sortBy('timestamp');
}

/**
 * Flag that a video now has at least one analyzed keyframe.
 *
 * Analysis can run before any index is built (playback sampling writes a
 * keyframe the moment the user enables it), so a missing video record is
 * CREATED here rather than the flag being dropped on the floor.
 */
export async function markVisualIndex(videoId: string): Promise<void> {
  const existing = await db.videos.get(videoId);
  const now = Date.now();
  await db.videos.put({
    id: videoId,
    url:
      existing?.url ??
      (videoId.startsWith('page:') ? videoId.slice('page:'.length) : undefined),
    title: existing?.title,
    platformId: existing?.platformId,
    authorName: existing?.authorName,
    duration: existing?.duration,
    hasTranscript: existing?.hasTranscript ?? false,
    hasVisualIndex: true,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

export async function createConversation(
  videoId: string | null,
  title?: string,
): Promise<Conversation> {
  const now = Date.now();
  const conv: Conversation = {
    id: crypto.randomUUID(),
    videoId,
    title,
    createdAt: now,
    updatedAt: now,
  };
  await db.conversations.put(conv);
  return conv;
}

export async function listConversations(): Promise<Conversation[]> {
  return db.conversations.orderBy('updatedAt').reverse().toArray();
}

export async function getConversation(
  id: string,
): Promise<Conversation | undefined> {
  return db.conversations.get(id);
}

export async function appendMessage(msg: Message): Promise<void> {
  await db.messages.put(msg);
  await db.conversations
    .where('id')
    .equals(msg.conversationId)
    .modify({ updatedAt: Date.now() });
}

export async function listMessages(conversationId: string): Promise<Message[]> {
  return db.messages
    .where('conversationId')
    .equals(conversationId)
    .sortBy('createdAt');
}

export async function addLearningNote(note: LearningNote): Promise<void> {
  await db.learningNotes.put(note);
}

export function newId(): string {
  return crypto.randomUUID();
}
