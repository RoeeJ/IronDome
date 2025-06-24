import { test, describe, expect } from 'bun:test';
import * as THREE from 'three';
import {
  calculateBallisticPosition,
  calculateBallisticVelocity,
  calculateTimeToImpact,
  calculateTrajectoryPoints
} from '../../src/physics/ballistics';
import {
  calculateBallisticInterception,
  calculateProportionalNavigation,
  checkProximityDetonation,
  calculateKillProbability
} from '../../src/physics/interception';
import {
  initializeKalmanState,
  kalmanPredict,
  kalmanUpdate,
  predictFuturePosition
} from '../../src/physics/kalman';

// Performance thresholds (operations per second)
const PERFORMANCE_THRESHOLDS = {
  ballisticPosition: 1_000_000,      // 1M ops/sec
  ballisticVelocity: 2_000_000,      // 2M ops/sec
  timeToImpact: 500_000,             // 500K ops/sec
  trajectoryPoints: 10_000,          // 10K full trajectories/sec
  ballisticInterception: 5_000,      // 5K interceptions/sec
  proportionalNavigation: 100_000,   // 100K guidance updates/sec
  proximityDetonation: 500_000,      // 500K checks/sec
  kalmanPredict: 50_000,             // 50K predictions/sec
  kalmanUpdate: 30_000,              // 30K updates/sec
};

describe('Physics Performance Benchmarks', () => {
  // Test data
  const testPosition = new THREE.Vector3(1000, 500, 0);
  const testVelocity = new THREE.Vector3(-100, 20, 0);
  const testAcceleration = new THREE.Vector3(0, -9.82, 0);

  describe('Ballistics', () => {
    test('calculateBallisticPosition performance', () => {
      const iterations = 100000;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        calculateBallisticPosition(testPosition, testVelocity, 2.5);
      }
      const end = performance.now();
      const opsPerSec = iterations / ((end - start) / 1000);
      console.log(`calculateBallisticPosition: ${opsPerSec.toFixed(0)} ops/sec`);
      expect(opsPerSec).toBeGreaterThan(PERFORMANCE_THRESHOLDS.ballisticPosition);
    });

    test('calculateBallisticVelocity performance', () => {
      const iterations = 100000;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        calculateBallisticVelocity(testVelocity, 2.5);
      }
      const end = performance.now();
      const opsPerSec = iterations / ((end - start) / 1000);
      console.log(`calculateBallisticVelocity: ${opsPerSec.toFixed(0)} ops/sec`);
      expect(opsPerSec).toBeGreaterThan(PERFORMANCE_THRESHOLDS.ballisticVelocity);
    });

    test('calculateTimeToImpact performance', () => {
      const iterations = 50000;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        calculateTimeToImpact(testPosition, testVelocity);
      }
      const end = performance.now();
      const opsPerSec = iterations / ((end - start) / 1000);
      console.log(`calculateTimeToImpact: ${opsPerSec.toFixed(0)} ops/sec`);
      expect(opsPerSec).toBeGreaterThan(PERFORMANCE_THRESHOLDS.timeToImpact);
    });

    test('calculateTrajectoryPoints (100 points) performance', () => {
      const iterations = 1000;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        calculateTrajectoryPoints(testPosition, testVelocity, 0.1, 10);
      }
      const end = performance.now();
      const opsPerSec = iterations / ((end - start) / 1000);
      console.log(`calculateTrajectoryPoints: ${opsPerSec.toFixed(0)} ops/sec`);
      expect(opsPerSec).toBeGreaterThan(PERFORMANCE_THRESHOLDS.trajectoryPoints);
    });
  });

  describe('Interception', () => {
    const threatPos = new THREE.Vector3(2000, 1000, 0);
    const threatVel = new THREE.Vector3(-150, 10, 0);
    const interceptorPos = new THREE.Vector3(0, 0, 0);
    const interceptorVel = new THREE.Vector3(200, 100, 0);

    test('calculateBallisticInterception performance', () => {
      const iterations = 500;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        calculateBallisticInterception(
          threatPos,
          threatVel,
          interceptorPos,
          300
        );
      }
      const end = performance.now();
      const opsPerSec = iterations / ((end - start) / 1000);
      console.log(`calculateBallisticInterception: ${opsPerSec.toFixed(0)} ops/sec`);
      expect(opsPerSec).toBeGreaterThan(PERFORMANCE_THRESHOLDS.ballisticInterception);
    });

    test('calculateProportionalNavigation performance', () => {
      const iterations = 10000;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        calculateProportionalNavigation(
          interceptorPos,
          interceptorVel,
          threatPos,
          threatVel
        );
      }
      const end = performance.now();
      const opsPerSec = iterations / ((end - start) / 1000);
      console.log(`calculateProportionalNavigation: ${opsPerSec.toFixed(0)} ops/sec`);
      expect(opsPerSec).toBeGreaterThan(PERFORMANCE_THRESHOLDS.proportionalNavigation);
    });

    test('checkProximityDetonation performance', () => {
      const iterations = 50000;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        checkProximityDetonation(
          interceptorPos,
          threatPos,
          interceptorVel,
          threatVel,
          20,  // arming distance
          10,  // detonation radius
          5,   // optimal radius
          50   // distance traveled
        );
      }
      const end = performance.now();
      const opsPerSec = iterations / ((end - start) / 1000);
      console.log(`checkProximityDetonation: ${opsPerSec.toFixed(0)} ops/sec`);
      expect(opsPerSec).toBeGreaterThan(PERFORMANCE_THRESHOLDS.proximityDetonation);
    });

    test('calculateKillProbability performance', () => {
      const iterations = 100000;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        calculateKillProbability(7.5, 'medium');
      }
      const end = performance.now();
      const opsPerSec = iterations / ((end - start) / 1000);
      console.log(`calculateKillProbability: ${opsPerSec.toFixed(0)} ops/sec`);
      // Kill probability is so fast it exceeds our threshold by far
      expect(opsPerSec).toBeGreaterThan(100000);
    });
  });

  describe('Kalman Filter', () => {
    const kalmanState = initializeKalmanState(
      testPosition,
      testVelocity,
      testAcceleration
    );

    test('initializeKalmanState performance', () => {
      const iterations = 10000;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        initializeKalmanState(testPosition, testVelocity, testAcceleration);
      }
      const end = performance.now();
      const opsPerSec = iterations / ((end - start) / 1000);
      console.log(`initializeKalmanState: ${opsPerSec.toFixed(0)} ops/sec`);
      // Initialization is very fast
      expect(opsPerSec).toBeGreaterThan(50000);
    });

    test('kalmanPredict performance', () => {
      const iterations = 5000;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        kalmanPredict(kalmanState, 0.1);
      }
      const end = performance.now();
      const opsPerSec = iterations / ((end - start) / 1000);
      console.log(`kalmanPredict: ${opsPerSec.toFixed(0)} ops/sec`);
      expect(opsPerSec).toBeGreaterThan(PERFORMANCE_THRESHOLDS.kalmanPredict);
    });

    test('kalmanUpdate performance', () => {
      const iterations = 3000;
      const measurement = testPosition.clone().add(new THREE.Vector3(1, -2, 0.5));
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        kalmanUpdate(kalmanState, measurement);
      }
      const end = performance.now();
      const opsPerSec = iterations / ((end - start) / 1000);
      console.log(`kalmanUpdate: ${opsPerSec.toFixed(0)} ops/sec`);
      expect(opsPerSec).toBeGreaterThan(PERFORMANCE_THRESHOLDS.kalmanUpdate);
    });

    test('predictFuturePosition performance', () => {
      const iterations = 10000;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        predictFuturePosition(kalmanState, 5.0);
      }
      const end = performance.now();
      const opsPerSec = iterations / ((end - start) / 1000);
      console.log(`predictFuturePosition: ${opsPerSec.toFixed(0)} ops/sec`);
      // Future prediction should be fast
      expect(opsPerSec).toBeGreaterThan(50000);
    });
  });

  describe('Complex Scenarios', () => {
    test('Full interception calculation chain performance', () => {
      const iterations = 100;
      const start = performance.now();
      
      for (let i = 0; i < iterations; i++) {
        // Calculate interception
        const solution = calculateBallisticInterception(
          new THREE.Vector3(3000, 1500, 0),
          new THREE.Vector3(-180, 20, 0),
          new THREE.Vector3(0, 0, 0),
          300
        );
        
        if (solution) {
          // Calculate guidance
          calculateProportionalNavigation(
            new THREE.Vector3(100, 100, 0),
            solution.launchVelocity,
            new THREE.Vector3(2800, 1400, 0),
            new THREE.Vector3(-180, 10, 0)
          );
          
          // Check proximity
          checkProximityDetonation(
            new THREE.Vector3(2700, 1300, 0),
            new THREE.Vector3(2705, 1305, 0),
            new THREE.Vector3(280, 50, 0),
            new THREE.Vector3(-180, 0, 0),
            20, 10, 5, 100
          );
        }
      }
      
      const end = performance.now();
      const opsPerSec = iterations / ((end - start) / 1000);
      console.log(`Full interception chain: ${opsPerSec.toFixed(0)} ops/sec`);
      // Complex scenario should still be reasonably fast
      expect(opsPerSec).toBeGreaterThan(100);
    });

    test('Kalman filter tracking cycle performance', () => {
      const iterations = 1000;
      const start = performance.now();
      
      for (let i = 0; i < iterations; i++) {
        let state = initializeKalmanState(
          new THREE.Vector3(2000, 1000, 500),
          new THREE.Vector3(-100, 50, -50),
          new THREE.Vector3(0, -9.82, 0)
        );
        
        // Predict
        state = kalmanPredict(state, 0.1);
        
        // Measure with noise
        const measurement = state.position.clone().add(
          new THREE.Vector3(0.5, -0.5, 0.5)
        );
        
        // Update
        state = kalmanUpdate(state, measurement);
        
        // Future prediction
        predictFuturePosition(state, 3.0);
      }
      
      const end = performance.now();
      const opsPerSec = iterations / ((end - start) / 1000);
      console.log(`Kalman tracking cycle: ${opsPerSec.toFixed(0)} ops/sec`);
      // Full Kalman cycle should be efficient
      expect(opsPerSec).toBeGreaterThan(1000);
    });
  });
});

// Performance regression detection
describe('Performance Regression Tests', () => {
  // Test data (need to redeclare for this scope)
  const testPosition = new THREE.Vector3(1000, 500, 0);
  const testVelocity = new THREE.Vector3(-100, 20, 0);
  
  const runBenchmark = (fn: () => void, iterations: number): number => {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      fn();
    }
    const end = performance.now();
    return iterations / ((end - start) / 1000); // ops/sec
  };

  test('Ballistic calculations meet performance targets', () => {
    const iterations = 10000;
    
    const positionOps = runBenchmark(() => {
      calculateBallisticPosition(testPosition, testVelocity, 2.5);
    }, iterations);
    
    const velocityOps = runBenchmark(() => {
      calculateBallisticVelocity(testVelocity, 2.5);
    }, iterations);
    
    console.log(`Ballistic position: ${positionOps.toFixed(0)} ops/sec`);
    console.log(`Ballistic velocity: ${velocityOps.toFixed(0)} ops/sec`);
    
    expect(positionOps).toBeGreaterThan(PERFORMANCE_THRESHOLDS.ballisticPosition);
    expect(velocityOps).toBeGreaterThan(PERFORMANCE_THRESHOLDS.ballisticVelocity);
  });

  test('Interception algorithms meet performance targets', () => {
    const iterations = 1000;
    
    const guidanceOps = runBenchmark(() => {
      calculateProportionalNavigation(
        new THREE.Vector3(0, 100, 0),
        new THREE.Vector3(200, 0, 0),
        new THREE.Vector3(1000, 100, 0),
        new THREE.Vector3(-100, 0, 0)
      );
    }, iterations);
    
    const proximityOps = runBenchmark(() => {
      checkProximityDetonation(
        new THREE.Vector3(100, 100, 0),
        new THREE.Vector3(105, 100, 0),
        new THREE.Vector3(200, 0, 0),
        new THREE.Vector3(-100, 0, 0),
        20, 10, 5, 50
      );
    }, iterations);
    
    console.log(`Proportional navigation: ${guidanceOps.toFixed(0)} ops/sec`);
    console.log(`Proximity detonation: ${proximityOps.toFixed(0)} ops/sec`);
    
    expect(guidanceOps).toBeGreaterThan(PERFORMANCE_THRESHOLDS.proportionalNavigation);
    expect(proximityOps).toBeGreaterThan(PERFORMANCE_THRESHOLDS.proximityDetonation);
  });

  test('Kalman filter meets performance targets', () => {
    const iterations = 500;
    const state = initializeKalmanState(testPosition, testVelocity);
    
    const predictOps = runBenchmark(() => {
      kalmanPredict(state, 0.1);
    }, iterations);
    
    const updateOps = runBenchmark(() => {
      kalmanUpdate(state, testPosition);
    }, iterations);
    
    console.log(`Kalman predict: ${predictOps.toFixed(0)} ops/sec`);
    console.log(`Kalman update: ${updateOps.toFixed(0)} ops/sec`);
    
    expect(predictOps).toBeGreaterThan(PERFORMANCE_THRESHOLDS.kalmanPredict);
    expect(updateOps).toBeGreaterThan(PERFORMANCE_THRESHOLDS.kalmanUpdate);
  });
});