import { describe, test, expect } from 'bun:test';
import * as THREE from 'three';
import {
  calculateBallisticInterception,
  calculateConstantVelocityInterception,
  calculateProportionalNavigation,
  checkProximityDetonation,
  calculateDetonationQuality,
  calculateKillProbability,
  calculateInterceptionProbability
} from '../../../src/physics/interception';

describe('Deterministic Interception Tests', () => {
  describe('Ballistic Interception', () => {
    test('should find exact interception solution', () => {
      const threat = {
        position: new THREE.Vector3(1000, 500, 0),
        velocity: new THREE.Vector3(-100, 20, 0)
      };
      const interceptor = {
        position: new THREE.Vector3(0, 0, 0),
        speed: 300
      };

      const solution = calculateBallisticInterception(
        threat.position,
        threat.velocity,
        interceptor.position,
        interceptor.speed
      );

      expect(solution).not.toBeNull();
      expect(solution!.timeToIntercept).toBeGreaterThan(0);
      expect(solution!.interceptPoint.y).toBeGreaterThan(0); // Above ground
      expect(solution!.probability).toBeGreaterThan(0.5);
      
      // Verify interceptor can reach the point in time
      const distance = solution!.interceptPoint.distanceTo(interceptor.position);
      const travelTime = distance / interceptor.speed;
      expect(Math.abs(travelTime - solution!.timeToIntercept)).toBeLessThan(0.1);
    });

    test('should return null for unreachable threats', () => {
      const threat = {
        position: new THREE.Vector3(10000, 100, 10000), // Very far
        velocity: new THREE.Vector3(-500, -50, -500)    // Very fast
      };
      const interceptor = {
        position: new THREE.Vector3(0, 0, 0),
        speed: 100 // Too slow
      };

      const solution = calculateBallisticInterception(
        threat.position,
        threat.velocity,
        interceptor.position,
        interceptor.speed
      );

      expect(solution).toBeNull();
    });

    test('deterministic results for same inputs', () => {
      const threat = {
        position: new THREE.Vector3(800, 400, 600),
        velocity: new THREE.Vector3(-50, -10, -30)
      };
      const interceptor = {
        position: new THREE.Vector3(100, 50, 100),
        speed: 250
      };

      // Run multiple times
      const results = [];
      for (let i = 0; i < 10; i++) {
        const solution = calculateBallisticInterception(
          threat.position,
          threat.velocity,
          interceptor.position,
          interceptor.speed
        );
        results.push(solution);
      }

      // All results should be identical
      for (let i = 1; i < results.length; i++) {
        expect(results[i]!.timeToIntercept).toBe(results[0]!.timeToIntercept);
        expect(results[i]!.interceptPoint.x).toBe(results[0]!.interceptPoint.x);
        expect(results[i]!.interceptPoint.y).toBe(results[0]!.interceptPoint.y);
        expect(results[i]!.interceptPoint.z).toBe(results[0]!.interceptPoint.z);
      }
    });
  });

  describe('Constant Velocity Interception', () => {
    test('should intercept drone with constant velocity', () => {
      const drone = {
        position: new THREE.Vector3(1000, 200, 1000),
        velocity: new THREE.Vector3(-30, 0, -30)
      };
      const interceptor = {
        position: new THREE.Vector3(0, 100, 0),
        speed: 150
      };

      const solution = calculateConstantVelocityInterception(
        drone.position,
        drone.velocity,
        interceptor.position,
        interceptor.speed
      );

      expect(solution).not.toBeNull();
      
      // Verify the interception point
      const droneAtIntercept = drone.position.clone().add(
        drone.velocity.clone().multiplyScalar(solution!.timeToIntercept)
      );
      
      expect(solution!.interceptPoint.x).toBeCloseTo(droneAtIntercept.x, 6);
      expect(solution!.interceptPoint.y).toBeCloseTo(droneAtIntercept.y, 6);
      expect(solution!.interceptPoint.z).toBeCloseTo(droneAtIntercept.z, 6);
    });

    test('should handle head-on interception', () => {
      const target = {
        position: new THREE.Vector3(1000, 100, 0),
        velocity: new THREE.Vector3(-100, 0, 0)
      };
      const interceptor = {
        position: new THREE.Vector3(0, 100, 0),
        speed: 200
      };

      const solution = calculateConstantVelocityInterception(
        target.position,
        target.velocity,
        interceptor.position,
        interceptor.speed
      );

      expect(solution).not.toBeNull();
      
      // For head-on, intercept should be between initial positions
      expect(solution!.interceptPoint.x).toBeGreaterThan(0);
      expect(solution!.interceptPoint.x).toBeLessThan(1000);
      expect(solution!.interceptPoint.y).toBe(100);
    });
  });

  describe('Proportional Navigation', () => {
    test('zero acceleration when on collision course', () => {
      const interceptor = {
        position: new THREE.Vector3(0, 100, 0),
        velocity: new THREE.Vector3(200, 0, 0)
      };
      const target = {
        position: new THREE.Vector3(1000, 100, 0),
        velocity: new THREE.Vector3(-100, 0, 0)
      };

      const acceleration = calculateProportionalNavigation(
        interceptor.position,
        interceptor.velocity,
        target.position,
        target.velocity
      );

      // Should be near zero for perfect collision course
      expect(acceleration.length()).toBeLessThan(0.1);
    });

    test('generates lateral acceleration for crossing target', () => {
      const interceptor = {
        position: new THREE.Vector3(0, 0, 0),
        velocity: new THREE.Vector3(200, 0, 0)
      };
      const target = {
        position: new THREE.Vector3(500, 0, 500),
        velocity: new THREE.Vector3(0, 0, -100)
      };

      const acceleration = calculateProportionalNavigation(
        interceptor.position,
        interceptor.velocity,
        target.position,
        target.velocity,
        3, // Navigation constant
        300 // Max acceleration
      );

      // Should generate acceleration to intercept
      expect(acceleration.length()).toBeGreaterThan(0);
      // Should generate lateral acceleration component
      expect(Math.abs(acceleration.z)).toBeGreaterThan(0);
    });

    test('respects maximum acceleration limit', () => {
      const maxAccel = 250;
      const interceptor = {
        position: new THREE.Vector3(0, 0, 0),
        velocity: new THREE.Vector3(100, 0, 0)
      };
      const target = {
        position: new THREE.Vector3(100, 100, 100),
        velocity: new THREE.Vector3(-50, -50, -50)
      };

      const acceleration = calculateProportionalNavigation(
        interceptor.position,
        interceptor.velocity,
        target.position,
        target.velocity,
        5, // High navigation constant
        maxAccel
      );

      expect(acceleration.length()).toBeLessThanOrEqual(maxAccel);
    });
  });

  describe('Proximity Detonation', () => {
    test('should not detonate before arming distance', () => {
      const result = checkProximityDetonation(
        new THREE.Vector3(0, 100, 0),    // Projectile position
        new THREE.Vector3(5, 100, 0),    // Target position (5m away)
        new THREE.Vector3(100, 0, 0),    // Projectile velocity
        new THREE.Vector3(-50, 0, 0),    // Target velocity
        20,  // Arming distance
        10,  // Detonation radius
        5,   // Optimal radius
        15   // Distance traveled (less than arming)
      );

      expect(result.shouldDetonate).toBe(false);
      expect(result.distance).toBeCloseTo(5, 6);
    });

    test('should detonate within radius when armed', () => {
      const result = checkProximityDetonation(
        new THREE.Vector3(0, 100, 0),    // Projectile position
        new THREE.Vector3(8, 100, 0),    // Target position (8m away)
        new THREE.Vector3(100, 0, 0),    // Projectile velocity
        new THREE.Vector3(-50, 0, 0),    // Target velocity
        20,  // Arming distance
        10,  // Detonation radius
        5,   // Optimal radius
        50   // Distance traveled (armed)
      );

      expect(result.shouldDetonate).toBe(true);
      expect(result.distance).toBe(8);
      expect(result.detonationQuality).toBeGreaterThan(0.5);
    });

    test('should detonate when moving away', () => {
      const result = checkProximityDetonation(
        new THREE.Vector3(0, 100, 0),     // Projectile position
        new THREE.Vector3(-8, 100, 0),    // Target position (behind)
        new THREE.Vector3(100, 0, 0),     // Projectile velocity (moving away)
        new THREE.Vector3(-50, 0, 0),     // Target velocity
        20,  // Arming distance
        10,  // Detonation radius
        5,   // Optimal radius
        50   // Distance traveled (armed)
      );

      expect(result.shouldDetonate).toBe(true);
    });

    test('deterministic detonation quality', () => {
      // Test quality at various distances
      const testCases = [
        { distance: 0, expectedMin: 0.99 },    // Direct hit
        { distance: 2.5, expectedMin: 0.94 },  // Half optimal
        { distance: 5, expectedMin: 0.9 },     // Optimal
        { distance: 7.5, expectedMin: 0.7 },   // Between optimal and max
        { distance: 10, expectedMin: 0.5 }     // Maximum range
      ];

      testCases.forEach(({ distance, expectedMin }) => {
        const quality = calculateDetonationQuality(distance, 5, 10);
        expect(quality).toBeGreaterThanOrEqual(expectedMin);
        expect(quality).toBeLessThanOrEqual(1.0);
      });
    });
  });

  describe('Kill Probability', () => {
    test('deterministic kill probability curves', () => {
      // Test medium warhead
      const testCases = [
        { distance: 0, minProb: 0.99 },   // Direct hit
        { distance: 3, minProb: 0.96 },   // Lethal range
        { distance: 5, minProb: 0.95 },   // Edge of lethal
        { distance: 8, minProb: 0.49 },   // Effective range
        { distance: 12, minProb: 0.2 },   // Reduced effectiveness
        { distance: 15, minProb: 0 },     // Maximum range
        { distance: 20, minProb: 0 }      // Beyond range
      ];

      testCases.forEach(({ distance, minProb }) => {
        const prob = calculateKillProbability(distance, 'medium');
        expect(prob).toBeGreaterThanOrEqual(minProb);
        expect(prob).toBeLessThanOrEqual(1.0);
      });
    });

    test('warhead size affects kill probability', () => {
      const distance = 10;
      
      const smallProb = calculateKillProbability(distance, 'small');
      const mediumProb = calculateKillProbability(distance, 'medium');
      const largeProb = calculateKillProbability(distance, 'large');
      
      // Larger warheads should have higher kill probability at same distance
      expect(smallProb).toBeLessThan(mediumProb);
      expect(mediumProb).toBeLessThan(largeProb);
    });
  });

  describe('Interception Probability', () => {
    test('should calculate reasonable probabilities', () => {
      // Close, fast intercept
      const highProb = calculateInterceptionProbability(
        500,   // 500m distance
        3,     // 3 seconds
        100,   // Target speed
        300    // Interceptor speed
      );
      expect(highProb).toBeGreaterThan(0.8);

      // Far, slow intercept
      const lowProb = calculateInterceptionProbability(
        4000,  // 4km distance
        25,    // 25 seconds
        200,   // Fast target
        150    // Slower interceptor
      );
      expect(lowProb).toBeLessThan(0.5);
    });

    test('deterministic probability calculation', () => {
      const testInputs = {
        distance: 1500,
        time: 8,
        targetSpeed: 150,
        interceptorSpeed: 250
      };

      // Run multiple times
      const results = [];
      for (let i = 0; i < 10; i++) {
        results.push(calculateInterceptionProbability(
          testInputs.distance,
          testInputs.time,
          testInputs.targetSpeed,
          testInputs.interceptorSpeed
        ));
      }

      // All should be identical
      results.forEach(prob => {
        expect(prob).toBe(results[0]);
      });
    });
  });
});