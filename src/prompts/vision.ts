/**
 * Vision prompts — used for local dense analysis of a frame.
 */

export function buildLocalVisionPrompt(question: string): string {
  return [
    '你是视频画面分析助手。请仔细分析这张视频截图，并结合用户的问题进行回答。',
    '',
    `用户问题：${question}`,
    '',
    '要求：',
    '- 只描述画面中能观察到的事实',
    '- 如果画面不清晰或无法判断，请明确说明',
    '- 如果用户问的是图中的结构/文字/对象，请具体描述其内容',
  ].join('\n');
}

export function buildFactCheckVisionPrompt(question: string): string {
  return [
    '你是事实核查助手。请观察这张视频画面，提取与用户问题相关的可视证据。',
    '',
    `用户问题：${question}`,
    '',
    '只报告画面中确实可见的内容，不要臆测。',
  ].join('\n');
}
