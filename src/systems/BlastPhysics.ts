import * as THREE from 'three';
import { gameplayRandom } from '@/simulation/Random';
import { isFiniteVector } from '@/physics/numerics';
import { debug } from '../utils/logger';

export interface BlastConfig {
  // Legacy descriptive metadata; the game probability model uses only the four damage zones.
  /** @deprecated Metadata only; not an input to the game probability model. */
  warheadMass: number;
  /** @deprecated Metadata only. */
  fragmentationRadius: number;
  /** @deprecated Metadata only. */
  blastRadius: number;

  // Damage zones
  lethalRadius: number; // 100% kill probability (meters)
  severeRadius: number; // High damage, >80% kill probability (meters)
  moderateRadius: number; // Medium damage, 50-80% kill probability (meters)
  lightRadius: number; // Light damage, <50% kill probability (meters)
}

export class BlastPhysics {
  // Simulator tuning values; not a validated real-world lethality model.
  static readonly TAMIR_CONFIG: BlastConfig = {
    warheadMass: 11, // ~11kg warhead
    fragmentationRadius: 20, // Effective fragment range
    blastRadius: 15, // Blast overpressure range

    // Damage zones for fragmentation warhead
    lethalRadius: 3, // Direct hit zone
    severeRadius: 6, // High fragment density
    moderateRadius: 10, // Medium fragment density
    lightRadius: 15, // Low fragment density
  };

  /**
   * Calculate damage probability based on distance from blast center
   * Deterministic game damage-zone model; stochastic resolution is a separate operation.
   */
  static evaluateDamage(
    blastPosition: THREE.Vector3,
    targetPosition: THREE.Vector3,
    targetVelocity: THREE.Vector3,
    config: BlastConfig = BlastPhysics.TAMIR_CONFIG,
    interceptorVelocity?: THREE.Vector3
  ): {
    damage: number;
    killProbability: number;
    damageType: 'direct' | 'severe' | 'moderate' | 'light' | 'none';
  } {
    const zones = [
      config.lethalRadius,
      config.severeRadius,
      config.moderateRadius,
      config.lightRadius,
    ];
    if (
      ![
        blastPosition,
        targetPosition,
        targetVelocity,
        interceptorVelocity ?? new THREE.Vector3(),
      ].every(isFiniteVector) ||
      !zones.every(Number.isFinite) ||
      zones[0] < 0 ||
      zones.some((value, i) => i > 0 && value <= zones[i - 1])
    ) {
      throw new RangeError('Invalid game blast inputs');
    }
    const distance = blastPosition.distanceTo(targetPosition);

    // Account for relative velocity (crossing targets are harder to hit)
    const relativeSpeed = targetVelocity
      .clone()
      .sub(interceptorVelocity ?? new THREE.Vector3())
      .length();
    const crossingFactor = Math.min(1, 300 / (relativeSpeed + 100)); // Penalty for fast targets

    // Calculate directional damage bonus for head-on intercepts
    let directionalMultiplier = 1.0;
    if (interceptorVelocity && interceptorVelocity.length() > 0 && targetVelocity.length() > 0) {
      // Get normalized velocities
      const interceptorDir = interceptorVelocity.clone().normalize();
      const targetDir = targetVelocity.clone().normalize();

      // Calculate angle between trajectories (0 = head-on, 180 = tail-chase)
      const dotProduct = -interceptorDir.dot(targetDir); // Negative because opposite directions = head-on
      const angle = Math.acos(Math.max(-1, Math.min(1, dotProduct))) * (180 / Math.PI);

      // Apply directional multiplier: 1.5x for head-on (< 30°), scaling down to 1.0x at 90°
      if (angle < 30) {
        directionalMultiplier = 1.5;
      } else if (angle < 60) {
        directionalMultiplier = 1.3;
      } else if (angle < 90) {
        directionalMultiplier = 1.1;
      }

      debug.category(
        'BlastPhysics',
        `Directional analysis: angle=${angle.toFixed(1)}°, multiplier=${directionalMultiplier}x`
      );
    }

    let killProbability = 0;
    let damageType: 'direct' | 'severe' | 'moderate' | 'light' | 'none' = 'none';

    if (distance <= config.lethalRadius) {
      // Direct hit zone - fragments + blast
      killProbability = 0.95 * crossingFactor * directionalMultiplier;
      damageType = 'direct';
    } else if (distance <= config.severeRadius) {
      // High fragment density zone
      // Probability decreases with square of distance (fragment dispersal)
      const factor =
        1 -
        Math.pow((distance - config.lethalRadius) / (config.severeRadius - config.lethalRadius), 2);
      killProbability = (0.8 + factor * 0.15) * crossingFactor * directionalMultiplier;
      damageType = 'severe';
    } else if (distance <= config.moderateRadius) {
      // Medium fragment density
      const factor =
        1 -
        Math.pow(
          (distance - config.severeRadius) / (config.moderateRadius - config.severeRadius),
          2
        );
      killProbability = (0.3 + factor * 0.5) * crossingFactor * directionalMultiplier;
      damageType = 'moderate';
    } else if (distance <= config.lightRadius) {
      // Low fragment density - only lucky hits
      const factor =
        1 -
        Math.pow(
          (distance - config.moderateRadius) / (config.lightRadius - config.moderateRadius),
          2
        );
      killProbability = factor * 0.3 * crossingFactor * directionalMultiplier;
      damageType = 'light';
    }

    killProbability = Math.max(0, Math.min(1, killProbability));
    return { damage: killProbability, killProbability, damageType };
  }

  static calculateDamage(
    blastPosition: THREE.Vector3,
    targetPosition: THREE.Vector3,
    targetVelocity: THREE.Vector3,
    config: BlastConfig = BlastPhysics.TAMIR_CONFIG,
    interceptorVelocity?: THREE.Vector3,
    random: () => number = () => gameplayRandom.next()
  ) {
    const damage = this.evaluateDamage(
      blastPosition,
      targetPosition,
      targetVelocity,
      config,
      interceptorVelocity
    );
    const sample = random();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1)
      throw new RangeError('Random sample must be in [0, 1)');
    return { ...damage, hit: sample < damage.killProbability };
  }

  /**
   * Calculate optimal detonation point for moving target
   * Accounts for fragment travel time and target motion
   */
  static calculateOptimalDetonationPoint(
    interceptorPos: THREE.Vector3,
    interceptorVel: THREE.Vector3,
    targetPos: THREE.Vector3,
    targetVel: THREE.Vector3,
    fuseConfig: { detonationRadius: number; optimalRadius: number }
  ): {
    shouldDetonate: boolean;
    detonationPoint: THREE.Vector3;
    timeToDetonation: number;
    predictedDistance: number;
  } {
    // Fragment velocity (~1000 m/s for modern warheads)
    const FRAGMENT_VELOCITY = 1000;

    // Calculate relative motion
    const relPos = targetPos.clone().sub(interceptorPos);
    const relVel = targetVel.clone().sub(interceptorVel);

    // Calculate closest approach
    const timeToClosest = relVel.lengthSq() > 1e-12 ? -relPos.dot(relVel) / relVel.lengthSq() : 0;

    if (timeToClosest <= 0) {
      // Already passed closest approach
      const currentDistance = relPos.length();
      return {
        shouldDetonate: currentDistance <= fuseConfig.detonationRadius,
        detonationPoint: interceptorPos.clone(),
        timeToDetonation: 0,
        predictedDistance: currentDistance,
      };
    }

    // Predict positions at closest approach
    const futureInterceptorPos = interceptorPos
      .clone()
      .add(interceptorVel.clone().multiplyScalar(timeToClosest));
    const futureTargetPos = targetPos.clone().add(targetVel.clone().multiplyScalar(timeToClosest));

    const closestDistance = futureInterceptorPos.distanceTo(futureTargetPos);

    // Account for fragment travel time
    const fragmentTravelTime = closestDistance / FRAGMENT_VELOCITY;
    const adjustedTargetPos = futureTargetPos
      .clone()
      .add(targetVel.clone().multiplyScalar(fragmentTravelTime));

    const adjustedDistance = futureInterceptorPos.distanceTo(adjustedTargetPos);

    return {
      shouldDetonate: adjustedDistance <= fuseConfig.detonationRadius,
      detonationPoint: futureInterceptorPos,
      timeToDetonation: timeToClosest,
      predictedDistance: adjustedDistance,
    };
  }

  /**
   * Check if a target would be damaged by blast at given position
   */
  static checkBlastDamage(
    blastPosition: THREE.Vector3,
    targets: Array<{ position: THREE.Vector3; velocity: THREE.Vector3; id: string }>,
    config: BlastConfig = BlastPhysics.TAMIR_CONFIG
  ): Array<{
    targetId: string;
    damage: number;
    willBeDestroyed: boolean;
    damageType: string;
  }> {
    const results = [];

    for (const target of targets) {
      const damage = this.calculateDamage(blastPosition, target.position, target.velocity, config);

      results.push({
        targetId: target.id,
        damage: damage.killProbability,
        willBeDestroyed: damage.hit,
        damageType: damage.damageType,
      });
    }

    return results;
  }
}
