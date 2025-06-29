import * as THREE from 'three';

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
  const a = -0.5 * gravity;
  const b = initialVelocity.y;
  const c = initialPosition.y;

  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;

  const sqrtDisc = Math.sqrt(discriminant);
  const t1 = (-b + sqrtDisc) / (2 * a);
  const t2 = (-b - sqrtDisc) / (2 * a);

  // Return the positive time that's greater than 0
  const validTimes = [t1, t2].filter(t => t > 0);
  return validTimes.length > 0 ? Math.min(...validTimes) : null;
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
  if (!impactTime) return null;

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
  const speed = currentVelocity.length();
  if (speed < 0.001) return currentVelocity.clone();

  // Drag force: F = 0.5 * Cd * ρ * A * v²
  const dragMagnitude = 0.5 * dragCoefficient * airDensity * crossSectionArea * speed * speed;

  // Drag acceleration (opposite to velocity direction)
  const dragAcceleration = dragMagnitude / mass;
  const dragDirection = currentVelocity.clone().normalize().multiplyScalar(-1);

  // Update velocity
  const dragDelta = dragDirection.multiplyScalar(dragAcceleration * deltaTime);
  return currentVelocity.clone().add(dragDelta);
}
