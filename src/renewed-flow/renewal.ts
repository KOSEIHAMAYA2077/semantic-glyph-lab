/** Reset only the invisible map. Integer ticks avoid a missed reset at a float boundary. */
export function renewalPhase(step: number, period: number) {
  if (!Number.isInteger(step) || step < 0 || !Number.isInteger(period) || period < 2 || period % 2) throw Error('Expected nonnegative integer step and even positive period');
  const tick = step % period;
  return { tick, weightA: .5 - .5 * Math.cos(2 * Math.PI * tick / period), reset: step > 0 ? (tick === 0 ? 0 : tick === period / 2 ? 1 : -1) : -1 };
}

/** UV inverse-map metrics, not readability or 3D surface-area measurements. */
export function mapMetrics(map: Float32Array, size: number) {
  if (map.length !== size * size * 4 || size < 3) throw Error('Invalid RGBA map');
  const stretch: number[] = [], anisotropy: number[] = [];
  let minDet = Infinity, maxDet = -Infinity, nonPositive = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const l = (y * size + (x + size - 1) % size) * 4, r = (y * size + (x + 1) % size) * 4;
    const d = (((y + size - 1) % size) * size + x) * 4, u = (((y + 1) % size) * size + x) * 4, k = size * .5;
    const a = 1 + (map[r] - map[l]) * k, b = (map[u] - map[d]) * k;
    const c = (map[r + 1] - map[l + 1]) * k, e = 1 + (map[u + 1] - map[d + 1]) * k;
    const det = a * e - b * c, q = a * a + b * b + c * c + e * e;
    const hi = Math.sqrt(Math.max(0, (q + Math.sqrt(Math.max(0, q * q - 4 * det * det))) / 2));
    const lo = Math.abs(det) / Math.max(1e-12, hi);
    minDet = Math.min(minDet, det); maxDet = Math.max(maxDet, det); if (det <= 0) nonPositive++;
    stretch.push(Math.max(hi, 1 / Math.max(1e-12, lo)));
    anisotropy.push(hi / Math.max(1e-12, lo));
  }
  stretch.sort((a, b) => a - b); anisotropy.sort((a, b) => a - b);
  const p95 = Math.ceil(stretch.length * .95) - 1;
  return { finite: map.every(Number.isFinite), minDet, maxDet, nonPositive,
    symmetricStretchP95: stretch[p95], symmetricStretchMax: stretch.at(-1)!,
    anisotropyP95: anisotropy[p95], anisotropyMax: anisotropy.at(-1)! };
}
