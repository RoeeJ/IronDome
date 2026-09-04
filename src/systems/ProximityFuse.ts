import * as THREE from 'three';
import { isFiniteVector } from '@/physics/numerics';

export interface ProximityFuseConfig {
  armingDistance: number;
  detonationRadius: number;
  optimalRadius: number;
  /** @deprecated Continuous safety checks run every simulation step. */
  scanRate: number;
}

export interface FuseResult {
  shouldDetonate: boolean;
  detonationQuality: number;
  fraction?: number;
  position?: THREE.Vector3;
  targetPosition?: THREE.Vector3;
}

/** Sweeps relative motion over each step, restricted to its armed, airborne interval. */
export class ProximityFuse {
  private config: ProximityFuseConfig;
  private armed = false;
  private detonated = false;
  private distanceTraveled = 0;
  private lastPosition: THREE.Vector3;

  constructor(startPosition: THREE.Vector3, config: Partial<ProximityFuseConfig> = {}) {
    this.config = {
      armingDistance: 15,
      detonationRadius: 8,
      optimalRadius: 4,
      scanRate: 1,
      ...config,
    };
    const c = this.config;
    if (
      !isFiniteVector(startPosition) ||
      ![c.armingDistance, c.detonationRadius, c.optimalRadius].every(Number.isFinite) ||
      c.armingDistance < 0 ||
      c.optimalRadius <= 0 ||
      c.detonationRadius < c.optimalRadius
    ) {
      throw new RangeError('Invalid proximity fuse configuration');
    }
    this.lastPosition = startPosition.clone();
    this.armed = c.armingDistance === 0;
  }

  update(
    currentPosition: THREE.Vector3,
    targetPosition: THREE.Vector3,
    deltaTime: number,
    _currentTime: number,
    previousTargetPosition = targetPosition,
    endFraction = 1
  ): FuseResult {
    const miss = { shouldDetonate: false, detonationQuality: 0 };
    if (
      this.detonated ||
      deltaTime <= 0 ||
      !Number.isFinite(deltaTime) ||
      !isFiniteVector(currentPosition) ||
      !isFiniteVector(targetPosition) ||
      !isFiniteVector(previousTargetPosition)
    )
      return miss;
    const start = this.lastPosition.clone();
    const travel = currentPosition.distanceTo(start);
    const needed = Math.max(0, this.config.armingDistance - this.distanceTraveled);
    const armedFraction = needed === 0 ? 0 : travel > 0 ? needed / travel : Infinity;
    this.distanceTraveled += travel;
    this.lastPosition.copy(currentPosition);
    this.armed = this.distanceTraveled >= this.config.armingDistance;
    const end = Math.max(0, Math.min(1, endFraction));
    if (!this.armed || armedFraction > end) return miss;
    const relativeStart = start.clone().sub(previousTargetPosition);
    const relativeDelta = currentPosition
      .clone()
      .sub(start)
      .sub(targetPosition.clone().sub(previousTargetPosition));
    const atArm = relativeStart.clone().addScaledVector(relativeDelta, armedFraction);
    let fraction = armedFraction;
    if (atArm.lengthSq() > this.config.detonationRadius ** 2) {
      const a = relativeDelta.lengthSq();
      const b = 2 * relativeStart.dot(relativeDelta);
      const c = relativeStart.lengthSq() - this.config.detonationRadius ** 2;
      const discriminant = b * b - 4 * a * c;
      if (a === 0 || discriminant < 0) return miss;
      fraction = (-b - Math.sqrt(discriminant)) / (2 * a);
      if (fraction < armedFraction - 1e-10 || fraction > end + 1e-10) return miss;
    }
    this.detonated = true;
    const position = start.lerp(currentPosition, fraction);
    const targetAtContact = previousTargetPosition.clone().lerp(targetPosition, fraction);
    const distance = position.distanceTo(targetAtContact);
    const quality =
      distance <= this.config.optimalRadius
        ? 1 - (0.1 * distance) / this.config.optimalRadius
        : Math.max(
            0.5,
            0.9 -
              (0.4 * (distance - this.config.optimalRadius)) /
                (this.config.detonationRadius - this.config.optimalRadius)
          );
    return {
      shouldDetonate: true,
      detonationQuality: quality,
      fraction,
      position,
      targetPosition: targetAtContact,
    };
  }

  checkApproach(
    currentPosition: THREE.Vector3,
    targetPosition: THREE.Vector3,
    velocity: THREE.Vector3
  ) {
    const relative = targetPosition.clone().sub(currentPosition);
    const time =
      velocity.lengthSq() > 0 ? Math.max(0, relative.dot(velocity) / velocity.lengthSq()) : 0;
    return {
      isApproaching: relative.dot(velocity) > 0,
      closestApproachDistance: relative.addScaledVector(velocity, -time).length(),
    };
  }
  isArmed(): boolean {
    return this.armed;
  }
  hasDetonated(): boolean {
    return this.detonated;
  }
  getDistanceTraveled(): number {
    return this.distanceTraveled;
  }
}
