import { describe, expect, it } from 'vitest';
import { mapMetrics, renewalPhase } from './renewal';

describe('renewed coordinate maps', () => {
  it('only resets an invisible map at every boundary, including long runs', () => {
    const period = 3600;
    for (let step = 0; step <= 108000; step++) {
      const state = renewalPhase(step, period);
      expect(state.weightA).toBeGreaterThanOrEqual(0); expect(state.weightA).toBeLessThanOrEqual(1);
      if (state.reset === 0) expect(state.weightA).toBe(0);
      if (state.reset === 1) expect(state.weightA).toBe(1);
      expect(state.reset !== -1).toBe(step > 0 && step % 1800 === 0);
    }
  });
  it('starts with two identity maps and no reset', () => {
    expect(renewalPhase(0, 3600)).toEqual({ tick: 0, weightA: 0, reset: -1 });
  });
  it('has smooth weights across wraparound and hides both alternating resets', () => {
    for (const t of [1800, 3600, 108000]) {
      expect(Math.abs(renewalPhase(t + 1, 3600).weightA - renewalPhase(t, 3600).weightA)).toBeLessThan(1e-6);
      expect(renewalPhase(t - 1, 3600).weightA).toBeCloseTo(renewalPhase(t + 1, 3600).weightA, 12);
    }
  });
  it('rejects a half-cycle that would never land on an integer tick', () => {
    expect(() => renewalPhase(1, 3601)).toThrow(); expect(() => renewalPhase(.1, 3600)).toThrow();
  });
  it('detects no distortion for a uniform translation', () => {
    const map = new Float32Array(16 * 16 * 4);
    for (let i = 0; i < map.length; i += 4) { map[i] = .3; map[i + 1] = -.1; }
    expect(mapMetrics(map, 16)).toMatchObject({ minDet: 1, maxDet: 1, nonPositive: 0, symmetricStretchMax: 1, anisotropyMax: 1 });
  });
  it('detects shear even when every determinant is one', () => {
    const n = 32, map = new Float32Array(n * n * 4);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) map[(y * n + x) * 4] = .3 * Math.sin(2 * Math.PI * y / n);
    const result = mapMetrics(map, n);
    expect(result.minDet).toBe(1); expect(result.maxDet).toBe(1);
    expect(result.symmetricStretchP95).toBeGreaterThan(2); expect(result.anisotropyP95).toBeGreaterThan(4);
  });
  it('detects foldovers and nonfinite data independently', () => {
    const n = 32, map = new Float32Array(n * n * 4);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) map[(y * n + x) * 4] = .3 * Math.sin(2 * Math.PI * x / n);
    expect(mapMetrics(map, n).nonPositive).toBeGreaterThan(0);
    map[0] = NaN; expect(mapMetrics(map, n).finite).toBe(false);
  });
});
