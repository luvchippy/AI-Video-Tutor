import { describe, it, expect } from 'vitest';
import { scoreVideo } from './page-video';
import type { VideoCandidate } from './page-video';

function c(partial: Partial<VideoCandidate>): VideoCandidate {
  return {
    paused: true,
    visible: false,
    inViewport: false,
    area: 0,
    duration: null,
    ...partial,
  };
}

describe('scoreVideo', () => {
  it('prefers a playing video over a paused one', () => {
    const playing = scoreVideo(c({ paused: false, visible: true, area: 1000 }));
    const paused = scoreVideo(c({ paused: true, visible: true, area: 1000 }));
    expect(playing).toBeGreaterThan(paused);
  });

  it('prefers a visible video over a hidden one', () => {
    const visible = scoreVideo(c({ visible: true }));
    const hidden = scoreVideo(c({ visible: false }));
    expect(visible).toBeGreaterThan(hidden);
  });

  it('prefers a larger visible area', () => {
    const big = scoreVideo(c({ visible: true, area: 100000 }));
    const small = scoreVideo(c({ visible: true, area: 1000 }));
    expect(big).toBeGreaterThan(small);
  });

  it('picks the expected winner from a realistic set', () => {
    // three candidates: a tiny paused thumbnail, a hidden autoplay ad, the main player
    const thumb = scoreVideo(c({ paused: true, visible: true, inViewport: true, area: 5000, duration: 10 }));
    const ad = scoreVideo(c({ paused: false, visible: false, inViewport: false, area: 1000, duration: 15 }));
    const main = scoreVideo(c({ paused: false, visible: true, inViewport: true, area: 900000, duration: 1452 }));
    expect(main).toBeGreaterThan(thumb);
    expect(main).toBeGreaterThan(ad);
  });
});
