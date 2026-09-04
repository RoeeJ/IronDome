import * as THREE from 'three';
import { GRAVITY } from '@/physics/ballistics';
import { TrajectoryCalculator } from '@/utils/TrajectoryCalculator';

/** Compatibility facade: both modes share the validated bounded reachability solver. */
export class ImprovedTrajectoryCalculator {
  private static readonly GRAVITY = GRAVITY;

  static calculateInterceptionPoint(
    threatPos: THREE.Vector3,
    threatVel: THREE.Vector3,
    interceptorPos: THREE.Vector3,
    interceptorSpeed: number,
    isDrone = false
  ): { point: THREE.Vector3; time: number; confidence: number } | null {
    const result = TrajectoryCalculator.calculateInterceptionPoint(
      threatPos,
      threatVel,
      interceptorPos,
      interceptorSpeed,
      isDrone
    );
    // Solver confidence indicates geometric convergence, not interception success probability.
    return result ? { ...result, confidence: 0.95 } : null;
  }

  /**
   * Calculate multiple interception opportunities for shoot-look-shoot
   */
  static calculateMultipleInterceptionWindows(
    threatPos: THREE.Vector3,
    threatVel: THREE.Vector3,
    interceptorPos: THREE.Vector3,
    interceptorSpeed: number,
    minSeparation: number = 2.0 // seconds
  ): Array<{ point: THREE.Vector3; time: number; quality: number }> {
    const windows: Array<{ point: THREE.Vector3; time: number; quality: number }> = [];

    // First interception
    const first = this.calculateInterceptionPoint(
      threatPos,
      threatVel,
      interceptorPos,
      interceptorSpeed,
      false
    );
    if (!first) return windows;

    windows.push({
      point: first.point,
      time: first.time,
      quality: first.confidence,
    });

    if (!Number.isFinite(minSeparation) || minSeparation <= 0) return windows;
    // A second launcher opportunity starts after the requested separation. Solve its
    // remaining flight from the future target state, then report absolute event time.
    const delay = first.time + minSeparation;
    const futurePosition = new THREE.Vector3(
      threatPos.x + threatVel.x * delay,
      threatPos.y + threatVel.y * delay - 0.5 * this.GRAVITY * delay ** 2,
      threatPos.z + threatVel.z * delay
    );
    const futureVelocity = threatVel.clone();
    futureVelocity.y -= this.GRAVITY * delay;
    const second = this.calculateInterceptionPoint(
      futurePosition,
      futureVelocity,
      interceptorPos,
      interceptorSpeed
    );
    if (second)
      windows.push({ point: second.point, time: delay + second.time, quality: second.confidence });

    return windows;
  }
}
