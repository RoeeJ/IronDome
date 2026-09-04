import type { Vector3 } from 'three';

export function isFiniteVector(vector: Vector3): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}

/** Real polynomial roots within a bounded interval, coefficients in ascending order.
 * Derivative roots partition monotonic intervals, so tangencies are not lost between samples.
 */
export function polynomialRoots(coefficients: number[], lower: number, upper: number): number[] {
  if (!coefficients.every(Number.isFinite) || !Number.isFinite(lower + upper) || upper < lower) {
    return [];
  }
  const c = coefficients.slice();
  while (c.length > 1 && c[c.length - 1] === 0) c.pop();
  if (c.length < 2) return [];
  if (c.length === 2) {
    const root = -c[0] / c[1];
    return root >= lower && root <= upper ? [root] : [];
  }
  const evaluate = (t: number) => c.reduceRight((value, term) => value * t + term, 0);
  const scaleAt = (t: number) =>
    c.reduceRight((value, term) => value * Math.abs(t) + Math.abs(term), 0);
  const cuts = [
    lower,
    ...polynomialRoots(
      c.slice(1).map((v, i) => v * (i + 1)),
      lower,
      upper
    ),
    upper,
  ];
  const roots: number[] = [];
  for (const t of cuts) {
    if (Math.abs(evaluate(t)) <= 1e-12 * Math.max(1, scaleAt(t))) roots.push(t);
  }
  for (let i = 1; i < cuts.length; i++) {
    let lo = cuts[i - 1];
    let hi = cuts[i];
    let flo = evaluate(lo);
    if (flo * evaluate(hi) >= 0) continue;
    for (let iteration = 0; iteration < 80 && hi - lo > 1e-11; iteration++) {
      const mid = (lo + hi) / 2;
      const value = evaluate(mid);
      if (value === 0) {
        lo = hi = mid;
        break;
      }
      if (Math.sign(value) === Math.sign(flo)) {
        lo = mid;
        flo = value;
      } else hi = mid;
    }
    roots.push((lo + hi) / 2);
  }
  return roots.sort((a, b) => a - b).filter((root, i, all) => i === 0 || root - all[i - 1] > 1e-9);
}
