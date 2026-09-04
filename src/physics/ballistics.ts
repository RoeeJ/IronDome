import * as THREE from 'three';
import { isFiniteVector } from '@/physics/numerics';

/**
 * Pure ballistics calculations used by both game and tests
 * All functions are deterministic and have no side effects
 */

export const GRAVITY = 9.82; // m/s²

export interface BallisticTrajectory {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  time: number;
}

/**
 * Calculate position at time t for ballistic trajectory
 * s = s0 + v0*t + 0.5*a*t²
 */
export function calculateBallisticPosition(
  initialPosition: THREE.Vector3,
  initialVelocity: THREE.Vector3,
  time: number,
  gravity: number = GRAVITY
): THREE.Vector3 {
  return new THREE.Vector3(
    initialPosition.x + initialVelocity.x * time,
    initialPosition.y + initialVelocity.y * time - 0.5 * gravity * time * time,
    initialPosition.z + initialVelocity.z * time
  );
}

/**
 * Calculate velocity at time t for ballistic trajectory
 * v = v0 + a*t
 */
export function calculateBallisticVelocity(
  initialVelocity: THREE.Vector3,
  time: number,
  gravity: number = GRAVITY
): THREE.Vector3 {
  return new THREE.Vector3(
    initialVelocity.x,
    initialVelocity.y - gravity * time,
    initialVelocity.z
  );
}

/**
 * Calculate time to impact ground (y = 0)
 * Solves: 0 = y0 + vy*t - 0.5*g*t²
 */
export function calculateTimeToImpact(
  initialPosition: THREE.Vector3,
  initialVelocity: THREE.Vector3,
  gravity: number = GRAVITY
): number | null {
  if (
    !isFiniteVector(initialPosition) ||
    !isFiniteVector(initialVelocity) ||
    !Number.isFinite(gravity) ||
    gravity < 0
  )
    return null;
  const y = initialPosition.y;
  const vy = initialVelocity.y;
  if (y < 0) return null;
  if (y === 0 && vy <= 0) return 0;
  if (gravity === 0) return vy < 0 ? -y / vy : null;
  const root = Math.sqrt(vy * vy + 2 * gravity * y);
  // Avoid cancellation for a rapidly descending object close to the ground.
  return vy < 0 ? (2 * y) / (root - vy) : (vy + root) / gravity;
}

/**
 * Calculate impact point on ground (y = 0)
 */
export function calculateImpactPoint(
  initialPosition: THREE.Vector3,
  initialVelocity: THREE.Vector3,
  gravity: number = GRAVITY
): THREE.Vector3 | null {
  const impactTime = calculateTimeToImpact(initialPosition, initialVelocity, gravity);
  if (impactTime === null) return null;

  return new THREE.Vector3(
    initialPosition.x + initialVelocity.x * impactTime,
    0,
    initialPosition.z + initialVelocity.z * impactTime
  );
}

/**
 * Calculate trajectory points for visualization
 */
export function calculateTrajectoryPoints(
  initialPosition: THREE.Vector3,
  initialVelocity: THREE.Vector3,
  timeStep: number = 0.1,
  maxTime: number = 20,
  gravity: number = GRAVITY
): THREE.Vector3[] {
  if (!Number.isFinite(timeStep) || timeStep <= 0 || !Number.isFinite(maxTime) || maxTime < 0) {
    throw new RangeError(
      'Trajectory sampling requires a positive finite step and nonnegative horizon'
    );
  }
  const points: THREE.Vector3[] = [];

  for (let t = 0; t <= maxTime; t += timeStep) {
    const pos = calculateBallisticPosition(initialPosition, initialVelocity, t, gravity);
    if (pos.y < 0) break; // Stop at ground
    points.push(pos);
  }

  return points;
}

/**
 * Calculate launch angle for given range and velocity
 * Returns both low and high angle solutions
 */
export function calculateLaunchAngles(
  horizontalRange: number,
  heightDifference: number,
  launchVelocity: number,
  gravity: number = GRAVITY
): { lowAngle: number; highAngle: number } | null {
  if (
    ![horizontalRange, heightDifference, launchVelocity, gravity].every(Number.isFinite) ||
    horizontalRange <= 0 ||
    launchVelocity <= 0 ||
    gravity <= 0
  )
    return null;
  const v2 = launchVelocity * launchVelocity;
  const g = gravity;
  const x = horizontalRange;
  const y = heightDifference;

  // Quadratic formula for launch angle
  const discriminant = v2 * v2 - g * (g * x * x + 2 * y * v2);
  if (discriminant < 0) return null; // Out of range

  const sqrtDisc = Math.sqrt(discriminant);
  const angle1 = Math.atan((v2 + sqrtDisc) / (g * x));
  const angle2 = Math.atan((v2 - sqrtDisc) / (g * x));

  return {
    lowAngle: Math.min(angle1, angle2),
    highAngle: Math.max(angle1, angle2),
  };
}

/**
 * Convert launch parameters to velocity vector
 */
export function launchParametersToVelocity(
  launchSpeed: number,
  elevationAngle: number, // radians
  azimuthAngle: number // radians
): THREE.Vector3 {
  const horizontalSpeed = launchSpeed * Math.cos(elevationAngle);
  const verticalSpeed = launchSpeed * Math.sin(elevationAngle);

  return new THREE.Vector3(
    horizontalSpeed * Math.cos(azimuthAngle),
    verticalSpeed,
    horizontalSpeed * Math.sin(azimuthAngle)
  );
}

/**
 * Calculate drag-affected trajectory (simplified model)
 */
export function calculateDragAffectedVelocity(
  currentVelocity: THREE.Vector3,
  dragCoefficient: number,
  airDensity: number,
  crossSectionArea: number,
  mass: number,
  deltaTime: number
): THREE.Vector3 {
  if (
    !isFiniteVector(currentVelocity) ||
    ![dragCoefficient, airDensity, crossSectionArea, mass, deltaTime].every(Number.isFinite) ||
    mass <= 0 ||
    Math.min(dragCoefficient, airDensity, crossSectionArea, deltaTime) < 0
  ) {
    throw new RangeError('Drag requires finite nonnegative coefficients/time and positive mass');
  }
  const speed = currentVelocity.length();
  if (speed < 0.001) return currentVelocity.clone();

  // Exact drag-only solution dv/dt = -k |v| v: dissipative for any step size.
  const k = (0.5 * dragCoefficient * airDensity * crossSectionArea) / mass;
  return currentVelocity.clone().multiplyScalar(1 / (1 + k * speed * deltaTime));
}
