import * as THREE from 'three';
import { calculateProportionalNavigation } from '@/physics/interception';
import { isFiniteVector } from '@/physics/numerics';

export interface GuidanceCommand {
  acceleration: THREE.Vector3;
  requiredG: number;
  timeToGo: number;
}

export class ProportionalNavigation {
  private readonly navigationConstant: number = 3.0; // Typically 3-5
  private readonly maxAcceleration: number = 300; // m/s² (~30G)
  private readonly minClosingVelocity: number = 50; // m/s

  /** Analytic LOS derivative uses current kinematics, with no shared or wall-clock history.
   * The legacy augmented flag is retained; acceleration augmentation is explicit in terminal guidance.
   */
  calculateGuidanceCommand(
    interceptorPos: THREE.Vector3,
    interceptorVel: THREE.Vector3,
    targetPos: THREE.Vector3,
    targetVel: THREE.Vector3,
    _useAugmented = true
  ): GuidanceCommand {
    if (![interceptorPos, interceptorVel, targetPos, targetVel].every(isFiniteVector)) {
      throw new RangeError('Navigation requires finite position and velocity');
    }
    const r = targetPos.clone().sub(interceptorPos);
    const range = r.length();
    if (range < 1e-9) return { acceleration: new THREE.Vector3(), requiredG: 0, timeToGo: 0 };
    const closingVelocity = -r.dot(targetVel.clone().sub(interceptorVel)) / range;
    const acceleration = calculateProportionalNavigation(
      interceptorPos,
      interceptorVel,
      targetPos,
      targetVel,
      this.navigationConstant,
      this.maxAcceleration
    );
    return {
      acceleration,
      requiredG: acceleration.length() / 9.82,
      timeToGo: range / Math.max(closingVelocity, this.minClosingVelocity),
    };
  }

  // Advanced guidance for terminal phase
  calculateTerminalGuidance(
    interceptorPos: THREE.Vector3,
    interceptorVel: THREE.Vector3,
    targetPos: THREE.Vector3,
    targetVel: THREE.Vector3,
    targetAccel: THREE.Vector3
  ): GuidanceCommand {
    // Augmented proportional navigation with target acceleration compensation
    const baseCommand = this.calculateGuidanceCommand(
      interceptorPos,
      interceptorVel,
      targetPos,
      targetVel,
      true
    );

    // Add target acceleration compensation
    const compensationFactor = this.navigationConstant / 2;
    const accelCompensation = targetAccel.clone().multiplyScalar(compensationFactor);

    const totalAccel = baseCommand.acceleration.add(accelCompensation);

    // Apply limits
    if (totalAccel.length() > this.maxAcceleration) {
      totalAccel.normalize().multiplyScalar(this.maxAcceleration);
    }

    return {
      acceleration: totalAccel,
      requiredG: totalAccel.length() / 9.82,
      timeToGo: baseCommand.timeToGo,
    };
  }

  // Predict miss distance for current engagement
  calculatePredictedMissDistance(
    interceptorPos: THREE.Vector3,
    interceptorVel: THREE.Vector3,
    targetPos: THREE.Vector3,
    targetVel: THREE.Vector3,
    interceptorAccel: THREE.Vector3
  ): number {
    // Zero effort miss (ZEM) calculation
    const r = targetPos.clone().sub(interceptorPos);
    const v = targetVel.clone().sub(interceptorVel);

    if (v.lengthSq() < 1e-12) return r.length();
    const timeToGo = -r.dot(v) / v.lengthSq();

    if (timeToGo <= 0) {
      // Already passed closest approach
      return r.length();
    }

    // Project positions at closest approach
    const interceptorFinal = interceptorPos
      .clone()
      .add(interceptorVel.clone().multiplyScalar(timeToGo))
      .add(interceptorAccel.clone().multiplyScalar(0.5 * timeToGo * timeToGo));

    const targetFinal = targetPos.clone().add(targetVel.clone().multiplyScalar(timeToGo));

    return interceptorFinal.distanceTo(targetFinal);
  }

  // Optimal launch angle calculation for energy management
  calculateOptimalLaunchAngle(
    launchPos: THREE.Vector3,
    targetPos: THREE.Vector3,
    targetVel: THREE.Vector3,
    interceptorSpeed: number
  ): { azimuth: number; elevation: number } {
    // Predict intercept point
    const range = targetPos.distanceTo(launchPos);
    const timeToIntercept = range / interceptorSpeed;

    const predictedPos = targetPos.clone().add(targetVel.clone().multiplyScalar(timeToIntercept));

    const direction = predictedPos.sub(launchPos).normalize();

    // Convert to spherical coordinates
    const azimuth = Math.atan2(direction.z, direction.x);
    const elevation = Math.asin(direction.y);

    // Apply energy-optimal elevation bias
    const optimalElevation = elevation + this.calculateElevationBias(range);

    return {
      azimuth,
      elevation: Math.min(Math.max(optimalElevation, -Math.PI / 2), Math.PI / 2),
    };
  }

  private calculateElevationBias(range: number): number {
    // Add elevation bias for energy-optimal trajectory
    // Longer range needs higher launch angle
    const maxBias = (15 * Math.PI) / 180; // 15 degrees
    const biasRange = 10000; // meters

    return maxBias * Math.min(range / biasRange, 1);
  }
}
