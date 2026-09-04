import { Box3, Vector3 } from 'three';
import { isFiniteVector } from './numerics';

/** Earliest segment contact with an axis-aligned box, in normalized step time [0, 1]. */
export function segmentBoxContact(start: Vector3, end: Vector3, box: Box3): number | null {
  if (!isFiniteVector(start) || !isFiniteVector(end) || box.isEmpty()) return null;
  let enter = 0;
  let leave = 1;
  for (const axis of ['x', 'y', 'z'] as const) {
    const delta = end[axis] - start[axis];
    if (Math.abs(delta) < 1e-12) {
      if (start[axis] < box.min[axis] || start[axis] > box.max[axis]) return null;
    } else {
      const a = (box.min[axis] - start[axis]) / delta;
      const b = (box.max[axis] - start[axis]) / delta;
      enter = Math.max(enter, Math.min(a, b));
      leave = Math.min(leave, Math.max(a, b));
      if (enter > leave) return null;
    }
  }
  return enter;
}

/** Exact swept sphere/AABB contact, including rounded edges and corners. */
export function sweptSphereBoxContact(
  start: Vector3,
  end: Vector3,
  radius: number,
  box: Box3
): number | null {
  if (
    !Number.isFinite(radius) ||
    radius < 0 ||
    !isFiniteVector(start) ||
    !isFiniteVector(end) ||
    box.isEmpty()
  )
    return null;
  if (radius === 0) return segmentBoxContact(start, end, box);
  // Reject disjoint swept bounds before allocating the exact rounded-contact calculation.
  for (const axis of ['x', 'y', 'z'] as const) {
    if (
      Math.max(start[axis], end[axis]) + radius < box.min[axis] ||
      Math.min(start[axis], end[axis]) - radius > box.max[axis]
    )
      return null;
  }
  const delta = end.clone().sub(start);
  const cuts = [0, 1];
  for (const axis of ['x', 'y', 'z'] as const) {
    if (delta[axis] === 0) continue;
    for (const boundary of [box.min[axis], box.max[axis]]) {
      const t = (boundary - start[axis]) / delta[axis];
      if (t > 0 && t < 1) cuts.push(t);
    }
  }
  cuts.sort((a, b) => a - b);
  // Between slab crossings, squared distance to the box is a quadratic in t.
  for (let i = 0; i < cuts.length - 1; i++) {
    const lo = cuts[i],
      hi = cuts[i + 1],
      mid = (lo + hi) / 2;
    let a = 0,
      b = 0,
      c = -radius * radius;
    for (const axis of ['x', 'y', 'z'] as const) {
      const point = start[axis] + delta[axis] * mid;
      const boundary =
        point < box.min[axis] ? box.min[axis] : point > box.max[axis] ? box.max[axis] : null;
      if (boundary === null) continue;
      const offset = start[axis] - boundary;
      a += delta[axis] ** 2;
      b += 2 * offset * delta[axis];
      c += offset ** 2;
    }
    if ((a * lo + b) * lo + c <= 1e-10) return lo;
    const discriminant = b * b - 4 * a * c;
    if (a > 0 && discriminant >= 0) {
      const entry = (-b - Math.sqrt(discriminant)) / (2 * a);
      if (entry >= lo - 1e-12 && entry <= hi + 1e-12) return Math.max(lo, entry);
    }
  }
  return null;
}
