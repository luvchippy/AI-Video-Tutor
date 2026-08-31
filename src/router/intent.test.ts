import { describe, it, expect } from 'vitest';
import { classifyIntent } from './intent';

describe('classifyIntent', () => {
  it('routes visual questions', () => {
    expect(classifyIntent('这里是什么意思？', { hasVideo: true })).toBe(
      'VISUAL_QUESTION',
    );
    expect(classifyIntent('画面里是什么', { hasVideo: true })).toBe(
      'VISUAL_QUESTION',
    );
    expect(classifyIntent('这个结构是什么意思', { hasVideo: true })).toBe(
      'VISUAL_QUESTION',
    );
  });

  it('routes fact-check questions', () => {
    expect(classifyIntent('博主说的是真的吗？', { hasVideo: true })).toBe(
      'FACT_CHECK',
    );
    expect(classifyIntent('帮我核实一下', { hasVideo: true })).toBe('FACT_CHECK');
  });

  it('routes current-info questions', () => {
    expect(classifyIntent('现在有什么新进展？')).toBe('CURRENT_INFO');
    expect(classifyIntent('最新版本是什么？')).toBe('CURRENT_INFO');
  });

  it('routes beginner explanation', () => {
    expect(classifyIntent('刚才没听懂', { hasVideo: true })).toBe(
      'BEGINNER_EXPLANATION',
    );
    expect(classifyIntent('这个术语什么意思', { hasVideo: true })).toBe(
      'BEGINNER_EXPLANATION',
    );
  });

  it('defaults to VIDEO_CONTENT with video context', () => {
    expect(classifyIntent('讲一下这段内容', { hasVideo: true })).toBe(
      'VIDEO_CONTENT',
    );
  });

  it('defaults to GENERAL_QUESTION without video context', () => {
    expect(classifyIntent('你好')).toBe('GENERAL_QUESTION');
  });

  it('handles empty input', () => {
    expect(classifyIntent('   ')).toBe('GENERAL_QUESTION');
  });
});
