import * as THREE from 'three';
import { debug } from '@/utils/DebugLogger';

export interface GuidanceCommand {
  acceleration: THREE.Vector3;
  requiredG: number;
  timeToGo: number;
}

export class ProportionalNavigation {
  private readonly navigationConstant: number = 3.0; // Typically 3-5
  private readonly maxAcceleration: number = 300; // m/s² (~30G)
  private readonly minClosingVelocity: number = 50; // m/s

  // State for augmented PN
  private previousLOS: THREE.Vector3 | null = null;
  private previousTime: number = 0;

  calculateGuidanceCommand(
    interceptorPos: THREE.Vector3,
    interceptorVel: THREE.Vector3,
    targetPos: THREE.Vector3,
    targetVel: THREE.Vector3,
    useAugmented: boolean = true
  ): GuidanceCommand {
    // Calculate relative position and velocity
    const r = targetPos.clone().sub(interceptorPos);
    const vr = targetVel.clone().sub(interceptorVel);

    const range = r.length();
    const closingVelocity = -r.dot(vr) / range;

    // Time to go estimation
    const timeToGo = range / Math.max(closingVelocity, this.minClosingVelocity);

    // Calculate line of sight (LOS) unit vector
    const los = r.normalize();

    // Calculate LOS rate
    let omega: THREE.Vector3;

    if (useAugmented && this.previousLOS) {
      // Augmented PN: Use actual LOS rate measurement
      const currentTime = Date.now() / 1000;
      const dt = currentTime - this.previousTime;

      if (dt > 0) {
        const losChange = los.clone().sub(this.previousLOS);
        omega = losChange.divideScalar(dt);
      } else {
        // Fallback to true PN
        omega = this.calculateLOSRate(r, vr, range);
      }

      this.previousTime = currentTime;
    } else {
      // True PN: Calculate from kinematics
      omega = this.calculateLOSRate(r, vr, range);
    }

    this.previousLOS = los.clone();

    // Apply proportional navigation law: a = N * Vc * ω
    const commandAccel = omega.multiplyScalar(this.navigationConstant * closingVelocity);

    // Apply acceleration limits
    const requiredG = commandAccel.length() / 9.81;
    if (commandAccel.length() > this.maxAcceleration) {
      commandAccel.normalize().multiplyScalar(this.maxAcceleration);
    }

    debug.module('Guidance').log('PN Command', {
      range: range.toFixed(1),
      closingVelocity: closingVelocity.toFixed(1),
      timeToGo: timeToGo.toFixed(2),
      requiredG: requiredG.toFixed(1),
      commandedG: (commandAccel.length() / 9.81).toFixed(1),
    });

    return {
      acceleration: commandAccel,
      requiredG: commandAccel.length() / 9.81,
      timeToGo,
    };
  }

  private calculateLOSRate(r: THREE.Vector3, vr: THREE.Vector3, range: number): THREE.Vector3 {
    // ω = (r × vr) / r²
    const crossProduct = r.clone().cross(vr);
    return crossProduct.divideScalar(range * range);
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
    const compensationFactor = (baseCommand.timeToGo * this.navigationConstant) / 2;
    const accelCompensation = targetAccel.clone().multiplyScalar(compensationFactor);

    const totalAccel = baseCommand.acceleration.add(accelCompensation);

    // Apply limits
    if (totalAccel.length() > this.maxAcceleration) {
      totalAccel.normalize().multiplyScalar(this.maxAcceleration);
    }

    return {
      acceleration: totalAccel,
      requiredG: totalAccel.length() / 9.81,
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
    const azimuth = Math.atan2(direction.x, direction.z);
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
