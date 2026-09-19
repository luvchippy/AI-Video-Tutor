/**
 * Chunk-summary prompt — the tutor model fills the AI fields of a batch of
 * knowledge chunks (summary / keywords / concepts / claims).
 */

export interface SummaryBatchItem {
  /** Position inside this batch; echoed back so results map to chunks. */
  index: number;
  /** Human-readable time range, e.g. "01:30–02:15". */
  range: string;
  /** Transcript excerpt for this chunk (already truncated by the caller). */
  transcript: string;
}

export function buildChunkSummaryPrompt(items: SummaryBatchItem[]): string {
  const lines = [
    '你正在为教学视频建立时间轴知识索引。',
    '',
    `下面是按时间顺序切分好的 ${items.length} 个字幕片段，请为每个片段生成结构化摘要。`,
    '',
    '对每个片段返回一项，整体输出一个 JSON 数组，数组长度等于片段数量：',
    '[{"index":0,"summary":"...","keywords":["..."],"concepts":["..."],"claims":["..."]}]',
    '',
    '字段说明：',
    '- index: 片段序号，必须原样回填，用于对应回原片段',
    '- summary: 一句话中文摘要，说明这段字幕讲了什么',
    '- keywords: 关键词数组（便于检索），没有则为空数组',
    '- concepts: 这段讲解到的概念、知识点数组，没有则为空数组',
    '- claims: 博主给出的可核实的论断、结论或数据数组，没有则为空数组',
    '',
    '片段：',
  ];

  for (const item of items) {
    lines.push(
      '',
      `[index=${item.index}] 时间范围 ${item.range}`,
      `字幕：${item.transcript}`,
    );
  }

  lines.push(
    '',
    '要求：',
    '- 只依据每个片段给出的字幕内容，不要补充字幕里没有的信息',
    '- 不要把一个片段的内容写进另一个片段，每个片段的 index 都要出现在结果里',
    '- 严格输出 JSON 数组，不要输出 JSON 以外的任何内容（不要解释、不要前后缀、不要 Markdown 标题）',
  );

  return lines.join('\n');
}