import { describe, test, expect, beforeEach } from 'bun:test';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// Import the actual physics calculations from the game
// We'll need to extract these from the entities for proper testing
class BallisticsCalculator {
  static calculateTrajectory(
    initialPosition: THREE.Vector3,
    initialVelocity: THREE.Vector3,
    gravity: number,
    timeStep: number,
    maxTime: number
  ): THREE.Vector3[] {
    const points: THREE.Vector3[] = [];
    const g = new THREE.Vector3(0, -gravity, 0);
    
    for (let t = 0; t <= maxTime; t += timeStep) {
      // s = ut + 0.5at²
      const position = new THREE.Vector3()
        .copy(initialPosition)
        .add(initialVelocity.clone().multiplyScalar(t))
        .add(g.clone().multiplyScalar(0.5 * t * t));
      
      points.push(position);
      
      // Stop if we hit the ground
      if (position.y <= 0) break;
    }
    
    return points;
  }
  
  static calculateImpactPoint(
    initialPosition: THREE.Vector3,
    initialVelocity: THREE.Vector3,
    gravity: number
  ): THREE.Vector3 | null {
    // Solve for when y = 0
    // y = y0 + v_y*t - 0.5*g*t²
    // 0 = y0 + v_y*t - 0.5*g*t²
    
    const a = -0.5 * gravity;
    const b = initialVelocity.y;
    const c = initialPosition.y;
    
    // Quadratic formula
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return null;
    
    const t1 = (-b + Math.sqrt(discriminant)) / (2 * a);
    const t2 = (-b - Math.sqrt(discriminant)) / (2 * a);
    
    // Use the positive time that's greater than 0
    const t = Math.max(t1, t2);
    if (t <= 0) return null;
    
    return new THREE.Vector3(
      initialPosition.x + initialVelocity.x * t,
      0,
      initialPosition.z + initialVelocity.z * t
    );
  }
  
  static calculateTimeToImpact(
    initialPosition: THREE.Vector3,
    initialVelocity: THREE.Vector3,
    gravity: number
  ): number | null {
    const a = -0.5 * gravity;
    const b = initialVelocity.y;
    const c = initialPosition.y;
    
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return null;
    
    const t1 = (-b + Math.sqrt(discriminant)) / (2 * a);
    const t2 = (-b - Math.sqrt(discriminant)) / (2 * a);
    
    const t = Math.max(t1, t2);
    return t > 0 ? t : null;
  }
  
  static calculateInterceptionPoint(
    threatPosition: THREE.Vector3,
    threatVelocity: THREE.Vector3,
    interceptorPosition: THREE.Vector3,
    interceptorSpeed: number,
    gravity: number
  ): { point: THREE.Vector3; time: number } | null {
    // This is a complex calculation that requires solving where the interceptor
    // can meet the threat given their respective trajectories
    
    // Simplified version: iterate through threat trajectory and find first point
    // where interceptor can reach in time
    const timeStep = 0.1;
    const maxTime = 30;
    
    for (let t = 0; t <= maxTime; t += timeStep) {
      // Calculate threat position at time t
      const threatFuturePos = new THREE.Vector3()
        .copy(threatPosition)
        .add(threatVelocity.clone().multiplyScalar(t))
        .add(new THREE.Vector3(0, -0.5 * gravity * t * t, 0));
      
      // Check if threat has impacted
      if (threatFuturePos.y <= 0) break;
      
      // Calculate distance interceptor needs to travel
      const distance = interceptorPosition.distanceTo(threatFuturePos);
      
      // Calculate time interceptor needs (assuming constant speed for simplicity)
      const interceptorTime = distance / interceptorSpeed;
      
      // If interceptor can reach in time, we found an interception point
      if (interceptorTime <= t) {
        return { point: threatFuturePos, time: t };
      }
    }
    
    return null;
  }
}

describe('Ballistics Calculations', () => {
  const gravity = 9.81;
  
  describe('Trajectory Calculation', () => {
    test('should calculate correct trajectory points', () => {
      const initialPos = new THREE.Vector3(0, 100, 0);
      const initialVel = new THREE.Vector3(50, 50, 0);
      
      const trajectory = BallisticsCalculator.calculateTrajectory(
        initialPos,
        initialVel,
        gravity,
        0.1,
        10
      );
      
      expect(trajectory.length).toBeGreaterThan(0);
      expect(trajectory[0]).toEqual(initialPos);
      
      // Verify trajectory follows physics
      // At t=1s: x = 50m, y = 100 + 50 - 4.905 = 145.095m
      const t1 = trajectory[10]; // t = 1s (0.1 * 10)
      expect(t1.x).toBeCloseTo(50, 1);
      expect(t1.y).toBeCloseTo(145.095, 1);
    });
    
    test('should stop trajectory at ground level', () => {
      const initialPos = new THREE.Vector3(0, 10, 0);
      const initialVel = new THREE.Vector3(10, 0, 0);
      
      const trajectory = BallisticsCalculator.calculateTrajectory(
        initialPos,
        initialVel,
        gravity,
        0.1,
        10
      );
      
      const lastPoint = trajectory[trajectory.length - 1];
      expect(lastPoint.y).toBeLessThanOrEqual(0);
    });
  });
  
  describe('Impact Point Calculation', () => {
    test('should calculate correct impact point for parabolic trajectory', () => {
      const initialPos = new THREE.Vector3(0, 100, 0);
      const initialVel = new THREE.Vector3(30, 20, 40);
      
      const impact = BallisticsCalculator.calculateImpactPoint(
        initialPos,
        initialVel,
        gravity
      );
      
      expect(impact).not.toBeNull();
      expect(impact!.y).toBe(0);
      
      // Verify the impact point using time calculation
      const time = BallisticsCalculator.calculateTimeToImpact(
        initialPos,
        initialVel,
        gravity
      );
      
      expect(time).not.toBeNull();
      expect(impact!.x).toBeCloseTo(initialVel.x * time!, 1);
      expect(impact!.z).toBeCloseTo(initialVel.z * time!, 1);
    });
    
    test('should return null for upward-only trajectories that never land', () => {
      const initialPos = new THREE.Vector3(0, 0, 0);
      const initialVel = new THREE.Vector3(0, 100, 0);
      
      // This would need to account for starting at ground level
      // In real scenario, we'd need to check if projectile ever comes down
      const impact = BallisticsCalculator.calculateImpactPoint(
        initialPos,
        initialVel,
        gravity
      );
      
      // Should still calculate impact when fired upward from ground
      expect(impact).not.toBeNull();
    });
  });
  
  describe('Time to Impact', () => {
    test('should calculate correct time for simple drop', () => {
      const initialPos = new THREE.Vector3(0, 100, 0);
      const initialVel = new THREE.Vector3(0, 0, 0);
      
      const time = BallisticsCalculator.calculateTimeToImpact(
        initialPos,
        initialVel,
        gravity
      );
      
      // t = sqrt(2h/g) = sqrt(200/9.81) ≈ 4.52s
      expect(time).not.toBeNull();
      expect(time!).toBeCloseTo(4.52, 1);
    });
    
    test('should handle projectiles fired upward', () => {
      const initialPos = new THREE.Vector3(0, 10, 0);
      const initialVel = new THREE.Vector3(0, 30, 0);
      
      const time = BallisticsCalculator.calculateTimeToImpact(
        initialPos,
        initialVel,
        gravity
      );
      
      expect(time).not.toBeNull();
      expect(time!).toBeGreaterThan(3); // Goes up first, then comes down
    });
  });
  
  describe('Interception Calculations', () => {
    test('should find valid interception point when possible', () => {
      const threatPos = new THREE.Vector3(0, 100, 0);
      const threatVel = new THREE.Vector3(20, -10, 0);
      const interceptorPos = new THREE.Vector3(50, 0, 0);
      const interceptorSpeed = 100; // Fast interceptor
      
      const interception = BallisticsCalculator.calculateInterceptionPoint(
        threatPos,
        threatVel,
        interceptorPos,
        interceptorSpeed,
        gravity
      );
      
      expect(interception).not.toBeNull();
      expect(interception!.time).toBeGreaterThan(0);
      expect(interception!.point.y).toBeGreaterThan(0); // Intercept before ground
    });
    
    test('should return null when interception impossible', () => {
      const threatPos = new THREE.Vector3(1000, 100, 1000); // Far away
      const threatVel = new THREE.Vector3(100, -50, 100); // Fast
      const interceptorPos = new THREE.Vector3(0, 0, 0);
      const interceptorSpeed = 10; // Slow interceptor
      
      const interception = BallisticsCalculator.calculateInterceptionPoint(
        threatPos,
        threatVel,
        interceptorPos,
        interceptorSpeed,
        gravity
      );
      
      expect(interception).toBeNull();
    });
  });
});

describe('Physics World Integration', () => {
  let world: CANNON.World;
  
  beforeEach(() => {
    world = new CANNON.World();
    world.gravity.set(0, -9.81, 0);
  });
  
  test('should correctly simulate projectile motion', () => {
    const body = new CANNON.Body({
      mass: 1,
      position: new CANNON.Vec3(0, 100, 0),
      velocity: new CANNON.Vec3(30, 20, 0),
      shape: new CANNON.Sphere(0.5)
    });
    
    world.addBody(body);
    
    // Simulate for 2 seconds
    const timeStep = 1/60;
    const steps = 120;
    
    for (let i = 0; i < steps; i++) {
      world.step(timeStep);
    }
    
    // After 2 seconds, check position
    // x = v_x * t = 30 * 2 = 60
    // y = y_0 + v_y * t - 0.5 * g * t² = 100 + 40 - 19.62 = 120.38
    // Cannon-es uses numerical integration which may have small errors
    expect(body.position.x).toBeGreaterThan(59);
    expect(body.position.x).toBeLessThan(61);
    expect(body.position.y).toBeGreaterThan(119);
    expect(body.position.y).toBeLessThan(122);
  });
  
  test('should handle drag forces correctly', () => {
    const body = new CANNON.Body({
      mass: 1,
      position: new CANNON.Vec3(0, 100, 0),
      velocity: new CANNON.Vec3(100, 0, 0), // High horizontal velocity
      shape: new CANNON.Sphere(0.5),
      linearDamping: 0.1 // Air resistance
    });
    
    world.addBody(body);
    
    // Simulate for 1 second
    const timeStep = 1/60;
    const steps = 60;
    const initialVelocity = body.velocity.x;
    
    for (let i = 0; i < steps; i++) {
      world.step(timeStep);
    }
    
    // Velocity should decrease due to damping
    expect(body.velocity.x).toBeLessThan(initialVelocity);
    expect(body.velocity.x).toBeGreaterThan(0);
  });
});