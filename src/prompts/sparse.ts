/**
 * Sparse-analysis prompt — the vision model builds a low-cost visual index.
 */

export const SPARSE_INDEX_KEYS = [
  'visual_summary',
  'visible_text',
  'technical_terms',
  'diagram_type',
  'important_objects',
  'importance',
] as const;

export function buildSparseIndexPrompt(): string {
  return [
    '你正在为教学视频建立视觉检索索引。',
    '',
    '不要详细讲课。',
    '',
    '对每张带时间戳的画面返回一个 JSON 对象，包含以下字段：',
    '- visual_summary: 画面内容的简要描述',
    '- visible_text: 画面中可见的文字（OCR），没有则为空数组',
    '- technical_terms: 画面中出现的专业术语，没有则为空数组',
    '- diagram_type: 如果是图表/示意图，说明类型（如"流程图"、"电路图"、"结构图"），否则为 null',
    '- important_objects: 画面中的重要对象',
    '- importance: 0-1 之间的数字，表示该画面对理解视频的重要程度',
    '',
    '要求：',
    '- 只描述画面能观察到的事实',
    '- 不要因为字幕或常识猜测画面中不存在的信息',
    '- 严格输出 JSON，不要输出其他内容',
  ].join('\n');
}
