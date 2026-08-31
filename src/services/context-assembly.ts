import type { ChatMessage, SearchResult } from '../types/provider';
import type { KnowledgeChunk } from '../types/knowledge';
import type { Settings } from '../types/model';
import type { QuestionIntent } from '../types/intent';
import { buildTutorSystemPrompt } from '../prompts/tutor';
import { formatTime } from '../playback/format';

export interface VideoInfo {
  videoId: string | null;
  title: string | null;
  platformLabel: string;
  duration: number | null;
}

export interface AssemblyInput {
  settings: Settings;
  video: VideoInfo | null;
  currentTime: number | null;
  chunks: KnowledgeChunk[];
  visionText: string | null;
  sources: SearchResult[];
  searchDisabledReason: string | null;
  intent: QuestionIntent;
  question: string;
}

/** Build the tutor messages (system + user) from assembled context. */
export function buildTutorMessages(input: AssemblyInput): ChatMessage[] {
  return [
    { role: 'system', content: buildTutorSystemPrompt(input.settings) },
    { role: 'user', content: buildUserPrompt(input) },
  ];
}

function buildUserPrompt(input: AssemblyInput): string {
  const lines: string[] = [];

  if (input.video) {
    lines.push('## 视频信息');
    lines.push(`- 标题：${input.video.title ?? '未知'}`);
    lines.push(`- 平台：${input.video.platformLabel}`);
    if (input.video.duration != null) {
      lines.push(`- 总时长：${formatTime(input.video.duration)}`);
    }
  }

  if (input.currentTime != null) {
    lines.push('', `## 当前播放时间：${formatTime(input.currentTime)}`);
  }

  if (input.chunks.length > 0) {
    lines.push('', '## 相关视频知识（仅节选）');
    for (const c of input.chunks) {
      const range = `${formatTime(c.startTime)}–${formatTime(c.endTime)}`;
      const summary = c.summary ? `（${c.summary}）` : '';
      lines.push(`- [${range}]${summary} ${c.transcript.slice(0, 240)}`);
    }
  }

  if (input.visionText) {
    lines.push('', '## 视觉模型对当前画面的分析');
    lines.push(input.visionText);
  }

  if (input.sources.length > 0) {
    lines.push('', '## 联网搜索结果');
    for (const s of input.sources) {
      const snippet = s.snippet ? `：${s.snippet}` : '';
      lines.push(`- ${s.title}${snippet}（${s.url}）`);
    }
  }

  if (input.searchDisabledReason) {
    lines.push('', `⚠️ ${input.searchDisabledReason}`);
  }

  lines.push('', '## 用户问题', input.question);
  return lines.join('\n');
}
