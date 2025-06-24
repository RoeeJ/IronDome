import * as THREE from 'three';
import { calculateBallisticPosition, calculateBallisticVelocity, GRAVITY } from './ballistics';

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
  // Iterative solution
  for (let t = 0; t <= maxTime; t += timeStep) {
    // Predict threat position at time t
    const futurePosition = calculateBallisticPosition(threatPosition, threatVelocity, t, gravity);
    
    // Check if threat has impacted ground
    if (futurePosition.y <= 0) break;
    
    // Calculate interceptor travel time to this position
    const distance = futurePosition.distanceTo(interceptorPosition);
    const interceptorTime = distance / interceptorSpeed;
    
    // Check if times match (within tolerance)
    if (Math.abs(t - interceptorTime) < timeStep / 2) {
      // Calculate launch velocity vector
      const launchDirection = futurePosition.clone().sub(interceptorPosition).normalize();
      const launchVelocity = launchDirection.multiplyScalar(interceptorSpeed);
      
      // Calculate interception probability based on various factors
      const probability = calculateInterceptionProbability(
        distance,
        t,
        threatVelocity.length(),
        interceptorSpeed
      );
      
      return {
        interceptPoint: futurePosition,
        timeToIntercept: t,
        launchVelocity,
        probability
      };
    }
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
  // Use quadratic formula to solve for interception time
  const relativePosition = targetPosition.clone().sub(interceptorPosition);
  const a = targetVelocity.lengthSq() - interceptorSpeed * interceptorSpeed;
  const b = 2 * relativePosition.dot(targetVelocity);
  const c = relativePosition.lengthSq();
  
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  
  const sqrtDisc = Math.sqrt(discriminant);
  const t1 = (-b - sqrtDisc) / (2 * a);
  const t2 = (-b + sqrtDisc) / (2 * a);
  
  // Choose the earliest positive time
  const validTimes = [t1, t2].filter(t => t > 0 && t <= maxTime);
  if (validTimes.length === 0) return null;
  
  const t = Math.min(...validTimes);
  const interceptPoint = targetPosition.clone().add(targetVelocity.clone().multiplyScalar(t));
  
  const launchDirection = interceptPoint.clone().sub(interceptorPosition).normalize();
  const launchVelocity = launchDirection.multiplyScalar(interceptorSpeed);
  
  const distance = interceptorPosition.distanceTo(interceptPoint);
  const probability = calculateInterceptionProbability(
    distance,
    t,
    targetVelocity.length(),
    interceptorSpeed
  );
  
  return {
    interceptPoint,
    timeToIntercept: t,
    launchVelocity,
    probability
  };
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
  const perpVelocity = relativeVelocity.clone().sub(losUnit.clone().multiplyScalar(-closingVelocity));
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
    large: { lethal: 8, effective: 12, max: 20 }
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