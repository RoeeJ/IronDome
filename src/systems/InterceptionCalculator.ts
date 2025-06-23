import * as THREE from 'three';

/**
 * Pure functions for interception calculations
 * No side effects, no external dependencies
 */

export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export interface InterceptionScenario {
  interceptorPosition: Vector3Like;
  interceptorVelocity: Vector3Like;
  threatPosition: Vector3Like;
  threatVelocity: Vector3Like;
  interceptorSpeed: number;
  gravity?: number;
  maxFlightTime?: number;
}

export interface InterceptionSolution {
  shouldFire: boolean;
  aimPoint: Vector3Like;
  launchVelocity: Vector3Like;
  timeToIntercept: number;
  probability: number;
  distance: number;
}

export interface ProximityResult {
  distance: number;
  closingRate: number;
  timeToClosestApproach: number;
  closestApproachDistance: number;
}

/**
 * Calculate whether an interception is possible and the optimal aim point
 */
export function calculateInterception(scenario: InterceptionScenario): InterceptionSolution {
  const gravity = scenario.gravity ?? 9.81;
  const maxFlightTime = scenario.maxFlightTime ?? 30;

  // Convert to THREE.Vector3 for calculations
  const interceptorPos = new THREE.Vector3(
    scenario.interceptorPosition.x,
    scenario.interceptorPosition.y,
    scenario.interceptorPosition.z
  );
  const threatPos = new THREE.Vector3(
    scenario.threatPosition.x,
    scenario.threatPosition.y,
    scenario.threatPosition.z
  );
  const threatVel = new THREE.Vector3(
    scenario.threatVelocity.x,
    scenario.threatVelocity.y,
    scenario.threatVelocity.z
  );

  // Simple iterative solver for intercept point
  let bestSolution: InterceptionSolution | null = null;
  let bestScore = -Infinity;

  // Try different flight times
  for (let t = 1; t <= maxFlightTime; t += 0.5) {
    // Predict where threat will be at time t
    const predictedThreatPos = threatPos.clone().add(threatVel.clone().multiplyScalar(t));
    predictedThreatPos.y -= 0.5 * gravity * t * t;

    // Skip if threat would be below ground
    if (predictedThreatPos.y < 0) continue;

    // Calculate required velocity to reach that point
    const displacement = predictedThreatPos.clone().sub(interceptorPos);
    const horizontalDisp = new THREE.Vector3(displacement.x, 0, displacement.z);
    const horizontalDist = horizontalDisp.length();

    // Required horizontal speed
    const requiredHorizontalSpeed = horizontalDist / t;

    // Required vertical velocity (accounting for gravity)
    const requiredVerticalVel = displacement.y / t + 0.5 * gravity * t;

    // Total required speed
    const requiredSpeed = Math.sqrt(
      requiredHorizontalSpeed * requiredHorizontalSpeed + requiredVerticalVel * requiredVerticalVel
    );

    // Check if interceptor can achieve this speed
    if (requiredSpeed > scenario.interceptorSpeed * 1.2) continue; // 20% margin

    // Calculate launch velocity
    const launchVelocity = horizontalDisp.normalize().multiplyScalar(requiredHorizontalSpeed);
    launchVelocity.y = requiredVerticalVel;

    // Calculate hit probability based on various factors
    const distance = displacement.length();
    const probability = calculateHitProbability(
      distance,
      t,
      requiredSpeed / scenario.interceptorSpeed
    );

    // Score this solution
    const score = probability * (1 / t); // Prefer faster intercepts

    if (score > bestScore) {
      bestScore = score;
      bestSolution = {
        shouldFire: true,
        aimPoint: {
          x: predictedThreatPos.x,
          y: predictedThreatPos.y,
          z: predictedThreatPos.z,
        },
        launchVelocity: {
          x: launchVelocity.x,
          y: launchVelocity.y,
          z: launchVelocity.z,
        },
        timeToIntercept: t,
        probability: probability,
        distance: distance,
      };
    }
  }

  return (
    bestSolution || {
      shouldFire: false,
      aimPoint: { x: 0, y: 0, z: 0 },
      launchVelocity: { x: 0, y: 0, z: 0 },
      timeToIntercept: 0,
      probability: 0,
      distance: 0,
    }
  );
}

/**
 * Calculate hit probability based on various factors
 */
export function calculateHitProbability(
  distance: number,
  flightTime: number,
  speedRatio: number
): number {
  // Base probability
  let probability = 0.95;

  // Reduce probability for long distances
  if (distance > 5000) {
    probability *= Math.exp(-(distance - 5000) / 3000);
  }

  // Reduce probability for long flight times
  if (flightTime > 10) {
    probability *= Math.exp(-(flightTime - 10) / 10);
  }

  // Reduce probability if interceptor is at speed limit
  if (speedRatio > 0.9) {
    probability *= (1 - speedRatio) * 10;
  }

  return Math.max(0, Math.min(1, probability));
}

/**
 * Calculate proximity between interceptor and threat
 */
export function calculateProximity(
  interceptorPos: Vector3Like,
  interceptorVel: Vector3Like,
  threatPos: Vector3Like,
  threatVel: Vector3Like
): ProximityResult {
  // Current distance
  const dx = threatPos.x - interceptorPos.x;
  const dy = threatPos.y - interceptorPos.y;
  const dz = threatPos.z - interceptorPos.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // Relative velocity
  const dvx = threatVel.x - interceptorVel.x;
  const dvy = threatVel.y - interceptorVel.y;
  const dvz = threatVel.z - interceptorVel.z;

  // Closing rate (positive = getting closer)
  // Note: dvx = threatVel - interceptorVel, so positive dot product means moving apart
  // We want positive when closing, so negate
  const closingRate = -(dx * dvx + dy * dvy + dz * dvz) / distance;

  // Time to closest approach
  const relVelSquared = dvx * dvx + dvy * dvy + dvz * dvz;
  const timeToClosestApproach =
    relVelSquared > 0.001 ? -(dx * dvx + dy * dvy + dz * dvz) / relVelSquared : 0;

  // Calculate closest approach distance
  let closestApproachDistance = distance;
  if (timeToClosestApproach > 0) {
    const futureX = dx + dvx * timeToClosestApproach;
    const futureY = dy + dvy * timeToClosestApproach;
    const futureZ = dz + dvz * timeToClosestApproach;
    closestApproachDistance = Math.sqrt(futureX * futureX + futureY * futureY + futureZ * futureZ);
  }

  return {
    distance,
    closingRate,
    timeToClosestApproach,
    closestApproachDistance,
  };
}

/**
 * Determine if proximity fuse should detonate
 */
export function shouldDetonate(
  proximity: ProximityResult,
  settings: {
    armingDistance: number;
    detonationRadius: number;
    optimalRadius: number;
  },
  distanceTraveled: number
): { detonate: boolean; quality: number } {
  // Not armed yet
  if (distanceTraveled < settings.armingDistance) {
    return { detonate: false, quality: 0 };
  }

  // Too far away
  if (proximity.distance > settings.detonationRadius) {
    return { detonate: false, quality: 0 };
  }

  // Moving away and will only get further
  if (proximity.closingRate < 0) {
    // If we're within detonation radius and moving away, detonate immediately
    // Calculate detonation quality based on distance
    const quality =
      proximity.distance <= settings.optimalRadius
        ? 1.0
        : 1 -
          (proximity.distance - settings.optimalRadius) /
            (settings.detonationRadius - settings.optimalRadius);
    return { detonate: true, quality: Math.max(0.3, quality) };
  }

  // Within optimal range
  if (proximity.distance <= settings.optimalRadius) {
    return { detonate: true, quality: 1.0 };
  }

  // Getting closer but might overshoot - check if we'll get closer
  if (
    proximity.timeToClosestApproach > 0 &&
    proximity.closestApproachDistance < settings.optimalRadius
  ) {
    // We'll get closer, wait
    return { detonate: false, quality: 0 };
  }

  // We're as close as we'll get - detonate now
  const quality =
    1 -
    (proximity.distance - settings.optimalRadius) /
      (settings.detonationRadius - settings.optimalRadius);
  return { detonate: true, quality: Math.max(0.5, quality) };
}
