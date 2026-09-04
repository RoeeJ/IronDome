import * as THREE from 'three';
import { isFiniteVector, polynomialRoots } from '@/physics/numerics';
import { calculateBallisticPosition, calculateTimeToImpact, GRAVITY } from './ballistics';

/**
 * Pure interception algorithms used by both game and tests
 * All functions are deterministic and have no side effects
 */

export interface InterceptionSolution {
  interceptPoint: THREE.Vector3;
  timeToIntercept: number;
  launchVelocity: THREE.Vector3;
  probability: number;
}

export interface ProximityResult {
  shouldDetonate: boolean;
  detonationQuality: number;
  distance: number;
}

/** Vacuum launch state with interceptor gravity included; target may be ballistic or level. */
export function calculateVacuumLaunch(
  targetPosition: THREE.Vector3,
  targetVelocity: THREE.Vector3,
  origin: THREE.Vector3,
  speed: number,
  targetGravity = GRAVITY,
  maxTime = 30
): InterceptionSolution | null {
  if (
    ![targetPosition, targetVelocity, origin].every(isFiniteVector) ||
    !Number.isFinite(speed) ||
    speed <= 0 ||
    !Number.isFinite(targetGravity) ||
    targetGravity < 0 ||
    !Number.isFinite(maxTime) ||
    maxTime <= 0 ||
    targetPosition.y <= 0
  )
    return null;
  const p = targetPosition.clone().sub(origin);
  const a = new THREE.Vector3(0, (GRAVITY - targetGravity) / 2, 0);
  const ground = calculateTimeToImpact(targetPosition, targetVelocity, targetGravity);
  const horizon = Math.min(maxTime, ground ?? maxTime);
  const roots = polynomialRoots(
    [
      p.lengthSq(),
      2 * p.dot(targetVelocity),
      targetVelocity.lengthSq() + 2 * p.dot(a) - speed * speed,
      2 * targetVelocity.dot(a),
      a.lengthSq(),
    ],
    0,
    horizon
  );
  for (const time of roots) {
    if (time <= 1e-9 || (ground !== null && time >= ground)) continue;
    const point = calculateBallisticPosition(targetPosition, targetVelocity, time, targetGravity);
    const launchVelocity = p
      .clone()
      .addScaledVector(targetVelocity, time)
      .addScaledVector(a, time * time)
      .divideScalar(time);
    const interceptorGround = calculateTimeToImpact(origin, launchVelocity);
    if (point.y <= 0 || (interceptorGround !== null && interceptorGround <= time)) continue;
    if (Math.abs(launchVelocity.length() - speed) > 1e-5) continue;
    return { interceptPoint: point, timeToIntercept: time, launchVelocity, probability: 0.95 };
  }
  return null;
}

/**
 * Calculate optimal interception point for a ballistic threat
 */
export function calculateBallisticInterception(
  threatPosition: THREE.Vector3,
  threatVelocity: THREE.Vector3,
  interceptorPosition: THREE.Vector3,
  interceptorSpeed: number,
  gravity: number = GRAVITY,
  timeStep: number = 0.1,
  maxTime: number = 30
): InterceptionSolution | null {
  if (!Number.isFinite(timeStep) || timeStep <= 0 || !Number.isFinite(gravity) || gravity < 0)
    return null;
  return solveInterception(
    threatPosition,
    threatVelocity,
    interceptorPosition,
    interceptorSpeed,
    gravity,
    maxTime
  );
}

/** Constant-speed reachability of a vacuum/constant-velocity target; not a guided-flight guarantee. */
function solveInterception(
  position: THREE.Vector3,
  velocity: THREE.Vector3,
  origin: THREE.Vector3,
  speed: number,
  gravity: number,
  maxTime: number
): InterceptionSolution | null {
  if (
    ![position, velocity, origin].every(isFiniteVector) ||
    !Number.isFinite(speed) ||
    speed <= 0 ||
    !Number.isFinite(maxTime) ||
    maxTime <= 0 ||
    position.y <= 0
  )
    return null;
  const groundTime = calculateTimeToImpact(position, velocity, gravity);
  const horizon = Math.min(maxTime, groundTime ?? maxTime);
  const p = position.clone().sub(origin);
  const halfAcceleration = new THREE.Vector3(0, -0.5 * gravity, 0);
  const roots = polynomialRoots(
    [
      p.lengthSq(),
      2 * p.dot(velocity),
      velocity.lengthSq() + 2 * p.dot(halfAcceleration) - speed * speed,
      2 * velocity.dot(halfAcceleration),
      halfAcceleration.lengthSq(),
    ],
    0,
    horizon
  );
  for (const time of roots) {
    if (time <= 0 || (groundTime !== null && time >= groundTime)) continue;
    const point = calculateBallisticPosition(position, velocity, time, gravity);
    const distance = point.distanceTo(origin);
    if (!isFiniteVector(point) || point.y <= 0 || Math.abs(distance - speed * time) > 1e-5)
      continue;
    return {
      interceptPoint: point,
      timeToIntercept: time,
      launchVelocity: point.clone().sub(origin).normalize().multiplyScalar(speed),
      probability: calculateInterceptionProbability(distance, time, velocity.length(), speed),
    };
  }
  return null;
}

/**
 * Calculate interception for constant velocity target (e.g., drone)
 */
export function calculateConstantVelocityInterception(
  targetPosition: THREE.Vector3,
  targetVelocity: THREE.Vector3,
  interceptorPosition: THREE.Vector3,
  interceptorSpeed: number,
  maxTime: number = 30
): InterceptionSolution | null {
  return solveInterception(
    targetPosition,
    targetVelocity,
    interceptorPosition,
    interceptorSpeed,
    0,
    maxTime
  );
}

/**
 * Calculate interception probability based on various factors
 */
export function calculateInterceptionProbability(
  distance: number,
  timeToIntercept: number,
  targetSpeed: number,
  interceptorSpeed: number
): number {
  // Base probability from range (max effective range ~5000m)
  const rangeFactor = Math.max(0, 1 - distance / 5000);

  // Time factor (prefer shorter intercept times)
  const timeFactor = Math.max(0, 1 - timeToIntercept / 30);

  // Speed advantage factor
  const speedRatio = interceptorSpeed / targetSpeed;
  const speedFactor = Math.min(1, speedRatio / 3);

  // Combined probability
  return rangeFactor * 0.4 + timeFactor * 0.3 + speedFactor * 0.3;
}

/**
 * Proportional Navigation Guidance
 */
export function calculateProportionalNavigation(
  interceptorPosition: THREE.Vector3,
  interceptorVelocity: THREE.Vector3,
  targetPosition: THREE.Vector3,
  targetVelocity: THREE.Vector3,
  navigationConstant: number = 3,
  maxAcceleration: number = 300 // m/s²
): THREE.Vector3 {
  // Line of sight vector
  const los = targetPosition.clone().sub(interceptorPosition);
  const range = los.length();

  if (range < 0.1) return new THREE.Vector3(); // Already at target

  // Calculate line of sight rate
  const losUnit = los.normalize();
  const relativeVelocity = targetVelocity.clone().sub(interceptorVelocity);
  const closingVelocity = -relativeVelocity.dot(losUnit);

  // Calculate rotation rate of line of sight
  const perpVelocity = relativeVelocity
    .clone()
    .sub(losUnit.clone().multiplyScalar(-closingVelocity));
  const losRate = perpVelocity.divideScalar(range);

  // Proportional navigation acceleration
  const acceleration = losRate.multiplyScalar(navigationConstant * closingVelocity);

  // Limit acceleration
  if (acceleration.length() > maxAcceleration) {
    acceleration.normalize().multiplyScalar(maxAcceleration);
  }

  return acceleration;
}

/**
 * Check proximity fuse detonation
 */
export function checkProximityDetonation(
  projectilePosition: THREE.Vector3,
  targetPosition: THREE.Vector3,
  projectileVelocity: THREE.Vector3,
  targetVelocity: THREE.Vector3,
  armingDistance: number,
  detonationRadius: number,
  optimalRadius: number,
  distanceTraveled: number
): ProximityResult {
  // Calculate current distance
  const distance = projectilePosition.distanceTo(targetPosition);

  // Check if armed
  if (distanceTraveled < armingDistance) {
    return { shouldDetonate: false, detonationQuality: 0, distance };
  }

  // Check if within detonation radius
  if (distance > detonationRadius) {
    return { shouldDetonate: false, detonationQuality: 0, distance };
  }

  // Calculate relative velocity
  const relativeVelocity = projectileVelocity.clone().sub(targetVelocity);
  const toTarget = targetPosition.clone().sub(projectilePosition);
  const closingRate = relativeVelocity.dot(toTarget.normalize());

  // If moving away and within detonation radius, detonate
  if (closingRate < 0 || distance <= detonationRadius) {
    const quality = calculateDetonationQuality(distance, optimalRadius, detonationRadius);
    return { shouldDetonate: true, detonationQuality: quality, distance };
  }

  return { shouldDetonate: false, detonationQuality: 0, distance };
}

/**
 * Calculate detonation quality based on distance
 */
export function calculateDetonationQuality(
  distance: number,
  optimalRadius: number,
  maxRadius: number
): number {
  if (distance <= optimalRadius) {
    // Near-optimal detonation (90-100% quality)
    return 0.9 + (1 - distance / optimalRadius) * 0.1;
  } else if (distance <= maxRadius) {
    // Sub-optimal but effective (50-90% quality)
    const falloffRange = maxRadius - optimalRadius;
    const distanceFromOptimal = distance - optimalRadius;
    return Math.max(0.5, 0.9 - (distanceFromOptimal / falloffRange) * 0.4);
  }
  return 0;
}

/**
 * Calculate kill probability based on detonation distance
 * Based on blast physics and fragmentation patterns
 */
export function calculateKillProbability(
  detonationDistance: number,
  warheadType: 'small' | 'medium' | 'large' = 'medium'
): number {
  // Kill probability curves based on warhead type
  const curves = {
    small: { lethal: 3, effective: 6, max: 10 },
    medium: { lethal: 5, effective: 8, max: 15 },
    large: { lethal: 8, effective: 12, max: 20 },
  };

  const curve = curves[warheadType];

  if (detonationDistance <= curve.lethal) {
    // Lethal range: 95-100% kill probability
    return 0.95 + (1 - detonationDistance / curve.lethal) * 0.05;
  } else if (detonationDistance <= curve.effective) {
    // Effective range: 50-95% kill probability
    const range = curve.effective - curve.lethal;
    const distance = detonationDistance - curve.lethal;
    return 0.95 - (distance / range) * 0.45;
  } else if (detonationDistance <= curve.max) {
    // Maximum range: 0-50% kill probability
    const range = curve.max - curve.effective;
    const distance = detonationDistance - curve.effective;
    return 0.5 - (distance / range) * 0.5;
  }

  return 0; // Beyond maximum range
}
