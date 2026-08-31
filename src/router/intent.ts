import type { QuestionIntent } from '../types/intent';

export interface IntentContext {
  hasVideo?: boolean;
}

const VISUAL_PATTERNS = [
  '这里',
  '画面',
  '图里',
  '这个结构',
  '这张图',
  '图片',
  '截图',
  '零件',
  '发生了什么',
  '图中',
  '图上',
  '图是什么',
  '结构图',
];

const FACT_CHECK_PATTERNS = [
  '是真的吗',
  '核实',
  '查一下',
  '真的假的',
  '对吗',
  '对不对',
  '是不是真的',
  '靠谱吗',
  '证实',
  '是不是骗',
];

const CURRENT_INFO_PATTERNS = ['现在', '最新', '目前', '当下', '最近'];

const BEGINNER_PATTERNS = [
  '没听懂',
  '没懂',
  '什么意思',
  '不懂',
  '不明白',
  '解释一下',
  '解释术语',
  '什么是',
  '通俗',
  '入门',
  '小白',
  '零基础',
  '为什么',
];

function includesAny(text: string, patterns: string[]): boolean {
  return patterns.some((p) => text.includes(p));
}

/**
 * Rule-first question intent classifier.
 * Complex/ambiguous cases can later be escalated to a cheap tutor model.
 */
export function classifyIntent(
  question: string,
  ctx: IntentContext = {},
): QuestionIntent {
  const q = question.trim();
  if (!q) return 'GENERAL_QUESTION';

  if (includesAny(q, VISUAL_PATTERNS)) return 'VISUAL_QUESTION';
  if (includesAny(q, FACT_CHECK_PATTERNS)) return 'FACT_CHECK';
  if (includesAny(q, CURRENT_INFO_PATTERNS)) return 'CURRENT_INFO';
  if (includesAny(q, BEGINNER_PATTERNS)) return 'BEGINNER_EXPLANATION';
  if (ctx.hasVideo) return 'VIDEO_CONTENT';
  return 'GENERAL_QUESTION';
}
