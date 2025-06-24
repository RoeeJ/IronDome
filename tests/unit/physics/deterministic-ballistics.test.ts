import { describe, test, expect } from 'bun:test';
import * as THREE from 'three';
import {
  calculateBallisticPosition,
  calculateBallisticVelocity,
  calculateTimeToImpact,
  calculateImpactPoint,
  calculateTrajectoryPoints,
  calculateLaunchAngles,
  launchParametersToVelocity,
  GRAVITY
} from '../../../src/physics/ballistics';

describe('Deterministic Ballistics Tests', () => {
  // Test vectors for deterministic validation
  const TEST_CASES = {
    simple: {
      position: new THREE.Vector3(0, 100, 0),
      velocity: new THREE.Vector3(50, 20, 0)
    },
    complex: {
      position: new THREE.Vector3(100, 500, 200),
      velocity: new THREE.Vector3(-80, 50, -60)
    }
  };

  describe('Position Calculations', () => {
    test('should calculate exact position at t=0', () => {
      const pos = calculateBallisticPosition(
        TEST_CASES.simple.position,
        TEST_CASES.simple.velocity,
        0
      );
      expect(pos.x).toBe(0);
      expect(pos.y).toBe(100);
      expect(pos.z).toBe(0);
    });

    test('should calculate exact position at t=2s', () => {
      const pos = calculateBallisticPosition(
        TEST_CASES.simple.position,
        TEST_CASES.simple.velocity,
        2
      );
      // x = 0 + 50*2 = 100
      // y = 100 + 20*2 - 0.5*9.82*4 = 140 - 19.64 = 120.36
      // z = 0 + 0*2 = 0
      expect(pos.x).toBe(100);
      expect(pos.y).toBeCloseTo(120.36, 2);
      expect(pos.z).toBe(0);
    });

    test('deterministic complex trajectory', () => {
      const times = [0, 1, 2, 3, 4, 5];
      const expectedPositions = times.map(t => ({
        x: 100 + (-80) * t,
        y: 500 + 50 * t - 0.5 * GRAVITY * t * t,
        z: 200 + (-60) * t
      }));

      times.forEach((t, i) => {
        const pos = calculateBallisticPosition(
          TEST_CASES.complex.position,
          TEST_CASES.complex.velocity,
          t
        );
        expect(pos.x).toBeCloseTo(expectedPositions[i].x, 6);
        expect(pos.y).toBeCloseTo(expectedPositions[i].y, 6);
        expect(pos.z).toBeCloseTo(expectedPositions[i].z, 6);
      });
    });
  });

  describe('Velocity Calculations', () => {
    test('should maintain horizontal velocity', () => {
      const times = [0, 1, 2, 3, 4, 5];
      times.forEach(t => {
        const vel = calculateBallisticVelocity(TEST_CASES.simple.velocity, t);
        expect(vel.x).toBe(50); // Constant
        expect(vel.z).toBe(0);  // Constant
      });
    });

    test('should decrease vertical velocity by gravity', () => {
      const vel0 = calculateBallisticVelocity(TEST_CASES.simple.velocity, 0);
      expect(vel0.y).toBe(20);

      const vel1 = calculateBallisticVelocity(TEST_CASES.simple.velocity, 1);
      expect(vel1.y).toBeCloseTo(20 - GRAVITY, 2);

      const vel2 = calculateBallisticVelocity(TEST_CASES.simple.velocity, 2);
      expect(vel2.y).toBeCloseTo(20 - 2 * GRAVITY, 2);
    });
  });

  describe('Time to Impact', () => {
    test('should calculate exact time for simple drop', () => {
      const dropCase = {
        position: new THREE.Vector3(0, 100, 0),
        velocity: new THREE.Vector3(0, 0, 0)
      };
      
      const time = calculateTimeToImpact(dropCase.position, dropCase.velocity);
      // t = sqrt(2h/g) = sqrt(200/9.82) ≈ 4.515
      expect(time).not.toBeNull();
      expect(time!).toBeCloseTo(4.515, 2);
    });

    test('should handle upward initial velocity', () => {
      const upwardCase = {
        position: new THREE.Vector3(0, 50, 0),
        velocity: new THREE.Vector3(0, 30, 0)
      };
      
      const time = calculateTimeToImpact(upwardCase.position, upwardCase.velocity);
      expect(time).not.toBeNull();
      // Goes up first, then comes down
      expect(time!).toBeGreaterThan(30 / GRAVITY); // Time to apex
    });

    test('should return null for impossible trajectories', () => {
      const impossibleCase = {
        position: new THREE.Vector3(0, -10, 0), // Below ground
        velocity: new THREE.Vector3(0, -10, 0)  // Moving down
      };
      
      const time = calculateTimeToImpact(impossibleCase.position, impossibleCase.velocity);
      expect(time).toBeNull();
    });
  });

  describe('Impact Point', () => {
    test('deterministic impact point calculation', () => {
      const impact = calculateImpactPoint(
        TEST_CASES.simple.position,
        TEST_CASES.simple.velocity
      );
      
      expect(impact).not.toBeNull();
      expect(impact!.y).toBe(0); // Ground level
      
      // Verify using time to impact
      const time = calculateTimeToImpact(
        TEST_CASES.simple.position,
        TEST_CASES.simple.velocity
      )!;
      
      expect(impact!.x).toBeCloseTo(TEST_CASES.simple.velocity.x * time, 2);
      expect(impact!.z).toBeCloseTo(TEST_CASES.simple.velocity.z * time, 2);
    });

    test('complex trajectory impact point', () => {
      const impact = calculateImpactPoint(
        TEST_CASES.complex.position,
        TEST_CASES.complex.velocity
      );
      
      expect(impact).not.toBeNull();
      
      // Verify the impact point is correct by checking position at impact time
      const impactTime = calculateTimeToImpact(
        TEST_CASES.complex.position,
        TEST_CASES.complex.velocity
      )!;
      
      const finalPos = calculateBallisticPosition(
        TEST_CASES.complex.position,
        TEST_CASES.complex.velocity,
        impactTime
      );
      
      expect(impact!.x).toBeCloseTo(finalPos.x, 2);
      expect(impact!.y).toBeCloseTo(0, 2);
      expect(impact!.z).toBeCloseTo(finalPos.z, 2);
    });
  });

  describe('Launch Angles', () => {
    test('should calculate both low and high angles', () => {
      const range = 100;
      const height = 0;
      const velocity = 50;
      
      const angles = calculateLaunchAngles(range, height, velocity);
      expect(angles).not.toBeNull();
      
      // For flat ground, angles should be complementary around 45°
      const avgAngle = (angles!.lowAngle + angles!.highAngle) / 2;
      expect(avgAngle).toBeCloseTo(Math.PI / 4, 1);
    });

    test('should handle elevated targets', () => {
      const range = 80;
      const height = 30; // Target is 30m higher
      const velocity = 50;
      
      const angles = calculateLaunchAngles(range, height, velocity);
      expect(angles).not.toBeNull();
      
      // Both angles should be positive and different
      expect(angles!.lowAngle).toBeGreaterThan(0);
      expect(angles!.highAngle).toBeGreaterThan(angles!.lowAngle);
    });

    test('should return null for unreachable targets', () => {
      const range = 1000; // Too far
      const height = 0;
      const velocity = 50;
      
      const angles = calculateLaunchAngles(range, height, velocity);
      expect(angles).toBeNull();
    });
  });

  describe('Trajectory Points', () => {
    test('should generate consistent trajectory points', () => {
      const points = calculateTrajectoryPoints(
        TEST_CASES.simple.position,
        TEST_CASES.simple.velocity,
        0.5, // 0.5s intervals
        10   // 10s max
      );
      
      expect(points.length).toBeGreaterThan(0);
      
      // First point should be initial position
      expect(points[0].x).toBe(TEST_CASES.simple.position.x);
      expect(points[0].y).toBe(TEST_CASES.simple.position.y);
      expect(points[0].z).toBe(TEST_CASES.simple.position.z);
      
      // Points should follow parabolic path
      for (let i = 1; i < points.length; i++) {
        const t = i * 0.5;
        const expectedPos = calculateBallisticPosition(
          TEST_CASES.simple.position,
          TEST_CASES.simple.velocity,
          t
        );
        expect(points[i].x).toBeCloseTo(expectedPos.x, 6);
        expect(points[i].y).toBeCloseTo(expectedPos.y, 6);
        expect(points[i].z).toBeCloseTo(expectedPos.z, 6);
      }
    });

    test('should stop at ground level', () => {
      const points = calculateTrajectoryPoints(
        new THREE.Vector3(0, 10, 0),
        new THREE.Vector3(10, 0, 0),
        0.1,
        10
      );
      
      const lastPoint = points[points.length - 1];
      expect(lastPoint.y).toBeGreaterThanOrEqual(0);
      
      // No points should be below ground
      points.forEach(point => {
        expect(point.y).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('Launch Parameters to Velocity', () => {
    test('should convert angles correctly', () => {
      const speed = 100;
      const elevation = Math.PI / 4; // 45°
      const azimuth = 0; // Due east
      
      const velocity = launchParametersToVelocity(speed, elevation, azimuth);
      
      // At 45° elevation, horizontal and vertical components should be equal
      const expectedHorizontal = speed * Math.cos(elevation);
      const expectedVertical = speed * Math.sin(elevation);
      
      expect(velocity.x).toBeCloseTo(expectedHorizontal, 6);
      expect(velocity.y).toBeCloseTo(expectedVertical, 6);
      expect(velocity.z).toBeCloseTo(0, 6);
      
      // Total speed should be preserved
      expect(velocity.length()).toBeCloseTo(speed, 6);
    });

    test('should handle different azimuth angles', () => {
      const speed = 50;
      const elevation = Math.PI / 6; // 30°
      
      // Test cardinal directions
      const testCases = [
        { azimuth: 0, expected: { x: 1, z: 0 } },           // East
        { azimuth: Math.PI / 2, expected: { x: 0, z: 1 } }, // North
        { azimuth: Math.PI, expected: { x: -1, z: 0 } },    // West
        { azimuth: -Math.PI / 2, expected: { x: 0, z: -1 } } // South
      ];
      
      testCases.forEach(({ azimuth, expected }) => {
        const velocity = launchParametersToVelocity(speed, elevation, azimuth);
        const horizontalSpeed = speed * Math.cos(elevation);
        
        expect(velocity.x).toBeCloseTo(horizontalSpeed * expected.x, 6);
        expect(velocity.z).toBeCloseTo(horizontalSpeed * expected.z, 6);
        expect(velocity.y).toBeCloseTo(speed * Math.sin(elevation), 6);
      });
    });
  });
});