import * as THREE from 'three';
import { debug } from './DebugLogger';

export class ImprovedTrajectoryCalculator {
  private static readonly GRAVITY = 9.81;

  /**
   * Enhanced interception calculation using Newton-Raphson method for faster convergence
   */
  static calculateInterceptionPoint(
    threatPos: THREE.Vector3,
    threatVel: THREE.Vector3,
    interceptorPos: THREE.Vector3,
    interceptorSpeed: number,
    isDrone: boolean = false
  ): { point: THREE.Vector3; time: number; confidence: number } | null {
    // Use closed-form solution for drones (constant velocity)
    if (isDrone) {
      return this.calculateDroneInterception(
        threatPos,
        threatVel,
        interceptorPos,
        interceptorSpeed
      );
    }

    // For ballistic threats, use improved numerical method
    return this.calculateBallisticInterception(
      threatPos,
      threatVel,
      interceptorPos,
      interceptorSpeed
    );
  }

  private static calculateDroneInterception(
    threatPos: THREE.Vector3,
    threatVel: THREE.Vector3,
    interceptorPos: THREE.Vector3,
    interceptorSpeed: number
  ): { point: THREE.Vector3; time: number; confidence: number } | null {
    // Quadratic equation for constant velocity interception
    const P = threatPos.clone().sub(interceptorPos);
    const V = threatVel;
    const s = interceptorSpeed;

    const threatSpeed = V.length();

    // If speeds are nearly equal, use a different approach
    if (Math.abs(threatSpeed - s) < 0.1) {
      // Use iterative method for edge case
      return this.calculateDroneInterceptionIterative(
        threatPos,
        threatVel,
        interceptorPos,
        interceptorSpeed
      );
    }

    // Solve: |P + V*t| = s*t
    // (P + V*t)·(P + V*t) = s²*t²
    const a = V.dot(V) - s * s;
    const b = 2 * P.dot(V);
    const c = P.dot(P);

    // Check for degenerate case
    if (Math.abs(a) < 0.0001) {
      // Linear equation: b*t + c = 0
      if (Math.abs(b) < 0.0001) {
        return null; // No solution
      }
      const t = -c / b;
      if (t <= 0 || t > 30) {
        return null;
      }

      const interceptPoint = threatPos.clone().add(threatVel.clone().multiplyScalar(t));
      if (interceptPoint.y <= 0) {
        return null;
      }

      return {
        point: interceptPoint,
        time: t,
        confidence: 0.9,
      };
    }

    const discriminant = b * b - 4 * a * c;

    if (discriminant < 0) {
      debug.module('Trajectory').log('No solution for drone interception: negative discriminant');
      return null; // No solution
    }

    const t1 = (-b - Math.sqrt(discriminant)) / (2 * a);
    const t2 = (-b + Math.sqrt(discriminant)) / (2 * a);

    // Choose the smallest positive time
    let t = null;
    if (t1 > 0 && t2 > 0) {
      t = Math.min(t1, t2);
    } else if (t1 > 0) {
      t = t1;
    } else if (t2 > 0) {
      t = t2;
    }

    if (!t || t > 30) {
      debug.module('Trajectory').log(`Invalid interception time: t1=${t1}, t2=${t2}`);
      return null;
    }

    const interceptPoint = threatPos.clone().add(threatVel.clone().multiplyScalar(t));

    // Check if intercept point is above ground
    if (interceptPoint.y <= 0) {
      debug.module('Trajectory').log(`Intercept point below ground: y=${interceptPoint.y}`);
      return null;
    }

    return {
      point: interceptPoint,
      time: t,
      confidence: 0.95, // High confidence for closed-form solution
    };
  }

  private static calculateDroneInterceptionIterative(
    threatPos: THREE.Vector3,
    threatVel: THREE.Vector3,
    interceptorPos: THREE.Vector3,
    interceptorSpeed: number
  ): { point: THREE.Vector3; time: number; confidence: number } | null {
    // Simple iterative approach for edge cases
    let t = 0.1;
    const dt = 0.1;
    const maxTime = 30;

    while (t < maxTime) {
      const futurePos = threatPos.clone().add(threatVel.clone().multiplyScalar(t));

      // Check if threat has hit ground
      if (futurePos.y <= 0) {
        return null;
      }

      // Calculate time for interceptor to reach this position
      const distance = futurePos.distanceTo(interceptorPos);
      const interceptTime = distance / interceptorSpeed;

      // Check if times match within tolerance
      if (Math.abs(interceptTime - t) < 0.05) {
        return {
          point: futurePos,
          time: t,
          confidence: 0.85,
        };
      }

      t += dt;
    }

    return null;
  }

  private static calculateBallisticInterception(
    threatPos: THREE.Vector3,
    threatVel: THREE.Vector3,
    interceptorPos: THREE.Vector3,
    interceptorSpeed: number
  ): { point: THREE.Vector3; time: number; confidence: number } | null {
    // Newton-Raphson method for faster convergence
    let t = this.getInitialTimeEstimate(threatPos, threatVel, interceptorPos, interceptorSpeed);
    let iterations = 0;
    const maxIterations = 20;
    const tolerance = 0.001;

    while (iterations < maxIterations) {
      // Calculate threat position at time t
      const futurePos = new THREE.Vector3(
        threatPos.x + threatVel.x * t,
        threatPos.y + threatVel.y * t - 0.5 * this.GRAVITY * t * t,
        threatPos.z + threatVel.z * t
      );

      // Check ground collision
      if (futurePos.y <= 0) {
        // Binary search for exact ground hit time
        const groundTime = this.findGroundHitTime(threatPos, threatVel);
        if (groundTime && t > groundTime) {
          return null;
        }
      }

      // Calculate function value and derivative
      const distance = futurePos.distanceTo(interceptorPos);
      const f = distance - interceptorSpeed * t;

      // Calculate derivative
      const threatVelAtT = new THREE.Vector3(
        threatVel.x,
        threatVel.y - this.GRAVITY * t,
        threatVel.z
      );

      const dirToThreat = futurePos.clone().sub(interceptorPos).normalize();
      const df = dirToThreat.dot(threatVelAtT) - interceptorSpeed;

      // Newton-Raphson update
      const dt = -f / df;
      t += dt;

      // Check convergence
      if (Math.abs(dt) < tolerance) {
        const interceptPoint = new THREE.Vector3(
          threatPos.x + threatVel.x * t,
          threatPos.y + threatVel.y * t - 0.5 * this.GRAVITY * t * t,
          threatPos.z + threatVel.z * t
        );

        // Calculate confidence based on convergence quality
        const confidence = Math.max(0.5, 1 - iterations / maxIterations);

        return {
          point: interceptPoint,
          time: t,
          confidence,
        };
      }

      iterations++;
    }

    return null; // Failed to converge
  }

  private static getInitialTimeEstimate(
    threatPos: THREE.Vector3,
    threatVel: THREE.Vector3,
    interceptorPos: THREE.Vector3,
    interceptorSpeed: number
  ): number {
    // Smart initial guess based on straight-line distance
    const directDistance = threatPos.distanceTo(interceptorPos);
    const approachSpeed =
      -threatVel.clone().normalize().dot(interceptorPos.clone().sub(threatPos).normalize()) *
      threatVel.length();

    const relativeSpeed = interceptorSpeed + Math.max(0, approachSpeed);
    return directDistance / relativeSpeed;
  }

  private static findGroundHitTime(
    threatPos: THREE.Vector3,
    threatVel: THREE.Vector3
  ): number | null {
    // Solve: y = y0 + vy*t - 0.5*g*t² = 0
    const a = -0.5 * this.GRAVITY;
    const b = threatVel.y;
    const c = threatPos.y;

    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return null;

    const t1 = (-b - Math.sqrt(discriminant)) / (2 * a);
    const t2 = (-b + Math.sqrt(discriminant)) / (2 * a);

    return t2 > 0 ? t2 : null;
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

    // Calculate second opportunity
    const secondTime = first.time + minSeparation;
    const secondPos = new THREE.Vector3(
      threatPos.x + threatVel.x * secondTime,
      threatPos.y + threatVel.y * secondTime - 0.5 * this.GRAVITY * secondTime * secondTime,
      threatPos.z + threatVel.z * secondTime
    );

    if (secondPos.y > 100) {
      // Minimum altitude for second attempt
      const distance = secondPos.distanceTo(interceptorPos);
      const interceptTime = distance / interceptorSpeed;

      if (Math.abs(secondTime - interceptTime) < 1.0) {
        windows.push({
          point: secondPos,
          time: secondTime,
          quality: 0.8, // Lower quality for second attempt
        });
      }
    }

    return windows;
  }
}
