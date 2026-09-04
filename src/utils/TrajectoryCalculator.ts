import * as THREE from 'three';
import { calculateLaunchAngles, calculateTrajectoryPoints, GRAVITY } from '@/physics/ballistics';
import {
  calculateBallisticInterception,
  calculateConstantVelocityInterception,
} from '@/physics/interception';
import { isFiniteVector } from '@/physics/numerics';

export interface LaunchParameters {
  velocity: number;
  angle: number; // degrees
  azimuth: number; // degrees
}

export class TrajectoryCalculator {
  static readonly GRAVITY = GRAVITY; // m/s²

  /**
   * Calculate launch parameters to hit a target
   */
  static calculateLaunchParameters(
    launchPos: THREE.Vector3,
    targetPos: THREE.Vector3,
    velocity: number,
    preferLofted: boolean = false
  ): LaunchParameters | null {
    if (!isFiniteVector(launchPos) || !isFiniteVector(targetPos)) return null;
    const dx = targetPos.x - launchPos.x;
    const dz = targetPos.z - launchPos.z;
    const angles = calculateLaunchAngles(Math.hypot(dx, dz), targetPos.y - launchPos.y, velocity);
    if (!angles) return null;
    return {
      velocity,
      angle: THREE.MathUtils.radToDeg(preferLofted ? angles.highAngle : angles.lowAngle),
      azimuth: THREE.MathUtils.radToDeg(Math.atan2(dz, dx)),
    };
  }

  /**
   * Calculate velocity vector from launch parameters
   */
  static getVelocityVector(params: LaunchParameters): THREE.Vector3 {
    const angleRad = (params.angle * Math.PI) / 180;
    const azimuthRad = (params.azimuth * Math.PI) / 180;

    const horizontalVelocity = params.velocity * Math.cos(angleRad);
    const verticalVelocity = params.velocity * Math.sin(angleRad);

    return new THREE.Vector3(
      horizontalVelocity * Math.cos(azimuthRad),
      verticalVelocity,
      horizontalVelocity * Math.sin(azimuthRad)
    );
  }

  /**
   * Predict trajectory points for visualization
   */
  static predictTrajectory(
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    timeStep: number = 0.1,
    maxTime: number = 20
  ): THREE.Vector3[] {
    return calculateTrajectoryPoints(position, velocity, timeStep, maxTime);
  }

  /**
   * Calculate optimal interception point
   */
  static calculateInterceptionPoint(
    threatPos: THREE.Vector3,
    threatVel: THREE.Vector3,
    interceptorPos: THREE.Vector3,
    interceptorSpeed: number,
    isDrone: boolean = false
  ): { point: THREE.Vector3; time: number } | null {
    const solution = isDrone
      ? calculateConstantVelocityInterception(
          threatPos,
          threatVel,
          interceptorPos,
          interceptorSpeed
        )
      : calculateBallisticInterception(threatPos, threatVel, interceptorPos, interceptorSpeed);
    return solution ? { point: solution.interceptPoint, time: solution.timeToIntercept } : null;
  }
}
