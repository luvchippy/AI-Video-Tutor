import { describe, it, expect } from 'vitest';
import { videoCropRegion } from './frame-capture';

describe('videoCropRegion', () => {
  it('scales a viewport rect to a full-page capture at 2x DPR', () => {
    // video occupies x:100..400, y:50..250 in a 800x600 viewport; capture is 1600x1200
    const r = videoCropRegion(
      { x: 100, y: 50, width: 300, height: 200 },
      1600,
      1200,
      800,
      600,
    );
    expect(r).toEqual({ sx: 200, sy: 100, sw: 600, sh: 400 });
  });

  it('handles a zero viewport gracefully', () => {
    const r = videoCropRegion({ x: 0, y: 0, width: 10, height: 10 }, 800, 600, 0, 0);
    expect(r.sw).toBe(10);
    expect(r.sh).toBe(10);
  });
});
