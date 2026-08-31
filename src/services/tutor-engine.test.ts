import { describe, it, expect } from 'vitest';
import { planAnswer, dataUrlToImageInput } from './tutor-engine';
import { NO_WEB_SEARCH_MESSAGE } from '../providers/search';

describe('planAnswer', () => {
  it('routes a visual question to vision when vision + frame available', () => {
    const plan = planAnswer('这里的图是什么意思？', {
      hasVideo: true,
      visionAvailable: true,
      frameAvailable: true,
      searchAvailable: false,
    });
    expect(plan.intent).toBe('VISUAL_QUESTION');
    expect(plan.useVision).toBe(true);
    expect(plan.useSearch).toBe(false);
  });

  it('does not use vision when vision model unavailable', () => {
    const plan = planAnswer('分析画面', {
      hasVideo: true,
      visionAvailable: false,
      frameAvailable: true,
      searchAvailable: false,
    });
    expect(plan.useVision).toBe(false);
  });

  it('routes fact-check to search when available', () => {
    const plan = planAnswer('这是真的吗？', {
      hasVideo: true,
      visionAvailable: false,
      frameAvailable: false,
      searchAvailable: true,
    });
    expect(plan.intent).toBe('FACT_CHECK');
    expect(plan.useSearch).toBe(true);
    expect(plan.searchDisabledReason).toBeNull();
  });

  it('marks fact-check as unverified when search is disabled', () => {
    const plan = planAnswer('这是真的吗？', {
      hasVideo: true,
      visionAvailable: false,
      frameAvailable: false,
      searchAvailable: false,
    });
    expect(plan.useSearch).toBe(false);
    expect(plan.searchDisabledReason).toBe(NO_WEB_SEARCH_MESSAGE);
  });

  it('routes a general question to tutor only', () => {
    const plan = planAnswer('讲一下这段内容', {
      hasVideo: true,
      visionAvailable: true,
      frameAvailable: true,
      searchAvailable: true,
    });
    expect(plan.intent).toBe('VIDEO_CONTENT');
    expect(plan.useVision).toBe(false);
    expect(plan.useSearch).toBe(false);
  });
});

describe('dataUrlToImageInput', () => {
  it('parses a JPEG data URL', () => {
    expect(dataUrlToImageInput('data:image/jpeg;base64,QUJD')).toEqual({
      mimeType: 'image/jpeg',
      data: 'QUJD',
    });
  });
  it('returns null for a non-image data URL', () => {
    expect(dataUrlToImageInput('data:text/plain;base64,QUJD')).toBeNull();
  });
});
