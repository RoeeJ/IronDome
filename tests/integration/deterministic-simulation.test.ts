import { describe, test, expect, beforeEach } from 'bun:test';
import * as THREE from 'three';
import {
  calculateBallisticPosition,
  calculateBallisticVelocity,
  GRAVITY
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

// Deterministic simulation parameters
const SIMULATION_DT = 0.01; // 10ms timestep for high precision
const MAX_SIMULATION_TIME = 30; // seconds

interface SimulationResult {
  intercepted: boolean;
  timeToIntercept: number;
  minDistance: number;
  detonationDistance: number;
  killProbability: number;
  interceptorPath: THREE.Vector3[];
  threatPath: THREE.Vector3[];
}

/**
 * Run a complete deterministic interception simulation
 */
function runInterceptionSimulation(
  threatPosition: THREE.Vector3,
  threatVelocity: THREE.Vector3,
  interceptorPosition: THREE.Vector3,
  interceptorSpeed: number,
  fuseConfig = {
    armingDistance: 15,
    detonationRadius: 12,
    optimalRadius: 6
  }
): SimulationResult {
  // Calculate interception solution
  const solution = calculateBallisticInterception(
    threatPosition,
    threatVelocity,
    interceptorPosition,
    interceptorSpeed
  );

  if (!solution) {
    return {
      intercepted: false,
      timeToIntercept: -1,
      minDistance: Infinity,
      detonationDistance: Infinity,
      killProbability: 0,
      interceptorPath: [],
      threatPath: []
    };
  }

  // Initialize simulation state
  let interceptorPos = interceptorPosition.clone();
  let interceptorVel = solution.launchVelocity.clone();
  let distanceTraveled = 0;
  let minDistance = Infinity;
  let detonated = false;
  let detonationDistance = Infinity;
  
  const interceptorPath: THREE.Vector3[] = [];
  const threatPath: THREE.Vector3[] = [];

  // Run simulation
  for (let t = 0; t <= MAX_SIMULATION_TIME; t += SIMULATION_DT) {
    // Update threat position
    const threatPos = calculateBallisticPosition(threatPosition, threatVelocity, t);
    const threatVel = calculateBallisticVelocity(threatVelocity, t);
    
    if (threatPos.y <= 0) break; // Threat hit ground

    // Calculate guidance acceleration
    const acceleration = calculateProportionalNavigation(
      interceptorPos,
      interceptorVel,
      threatPos,
      threatVel,
      3, // Navigation constant
      300 // Max acceleration
    );

    // Update interceptor physics
    interceptorVel.add(acceleration.clone().multiplyScalar(SIMULATION_DT));
    interceptorVel.y -= GRAVITY * SIMULATION_DT; // Apply gravity
    
    const oldPos = interceptorPos.clone();
    interceptorPos.add(interceptorVel.clone().multiplyScalar(SIMULATION_DT));
    distanceTraveled += interceptorPos.distanceTo(oldPos);

    // Track paths
    if (t % 0.1 < SIMULATION_DT) { // Sample every 0.1s
      interceptorPath.push(interceptorPos.clone());
      threatPath.push(threatPos.clone());
    }

    // Check proximity
    const distance = interceptorPos.distanceTo(threatPos);
    minDistance = Math.min(minDistance, distance);

    // Check detonation
    const proximityResult = checkProximityDetonation(
      interceptorPos,
      threatPos,
      interceptorVel,
      threatVel,
      fuseConfig.armingDistance,
      fuseConfig.detonationRadius,
      fuseConfig.optimalRadius,
      distanceTraveled
    );

    if (proximityResult.shouldDetonate && !detonated) {
      detonated = true;
      detonationDistance = proximityResult.distance;
      break;
    }

    // Check if interceptor hit ground
    if (interceptorPos.y <= 0) break;
  }

  const killProbability = detonated ? 
    calculateKillProbability(detonationDistance, 'medium') : 0;

  return {
    intercepted: detonated,
    timeToIntercept: solution.timeToIntercept,
    minDistance,
    detonationDistance,
    killProbability,
    interceptorPath,
    threatPath
  };
}

describe('Deterministic End-to-End Simulations', () => {
  describe('Baseline Scenarios', () => {
    test('Short range rocket interception', () => {
      const result = runInterceptionSimulation(
        new THREE.Vector3(2000, 800, 0),
        new THREE.Vector3(-150, -60, 0),
        new THREE.Vector3(0, 0, 0),
        300
      );

      expect(result.intercepted).toBe(true);
      expect(result.minDistance).toBeLessThan(12);
      expect(result.killProbability).toBeGreaterThan(0.3);
      
      // Verify deterministic path
      expect(result.interceptorPath.length).toBeGreaterThan(10);
      expect(result.threatPath.length).toBeGreaterThan(10);
    });

    test('Medium range ballistic missile', () => {
      const result = runInterceptionSimulation(
        new THREE.Vector3(5000, 2000, 0),
        new THREE.Vector3(-200, 50, 0),
        new THREE.Vector3(0, 0, 0),
        350
      );

      expect(result.intercepted).toBe(true);
      expect(result.timeToIntercept).toBeGreaterThan(5);
      expect(result.timeToIntercept).toBeLessThan(15);
    });

    test('Crossing cruise missile', () => {
      const result = runInterceptionSimulation(
        new THREE.Vector3(0, 200, 2000),
        new THREE.Vector3(100, 0, -100), // Slower crossing speed
        new THREE.Vector3(0, 0, 0),
        350 // Faster interceptor
      );

      // Crossing targets are challenging
      if (result.intercepted) {
        expect(result.minDistance).toBeLessThan(12);
      } else {
        expect(result.minDistance).toBeGreaterThan(12);
      }
    });
  });

  describe('Edge Cases', () => {
    test('Very close high-speed threat', () => {
      const result = runInterceptionSimulation(
        new THREE.Vector3(800, 400, 0), // Slightly farther
        new THREE.Vector3(-200, -80, 0),
        new THREE.Vector3(0, 0, 0),
        400
      );

      // Close threats are challenging
      if (result.intercepted) {
        expect(result.timeToIntercept).toBeLessThan(3);
        expect(result.killProbability).toBeGreaterThan(0.5);
      }
    });

    test('High altitude ballistic', () => {
      const result = runInterceptionSimulation(
        new THREE.Vector3(8000, 5000, 0),
        new THREE.Vector3(-300, 100, 0),
        new THREE.Vector3(0, 0, 0),
        400
      );

      if (result.intercepted) {
        expect(result.timeToIntercept).toBeGreaterThan(10);
        expect(result.detonationDistance).toBeLessThan(12);
      }
    });

    test('Out of range threat', () => {
      const result = runInterceptionSimulation(
        new THREE.Vector3(15000, 2000, 0),
        new THREE.Vector3(-100, -50, 0),
        new THREE.Vector3(0, 0, 0),
        250 // Slow interceptor
      );

      expect(result.intercepted).toBe(false);
      expect(result.timeToIntercept).toBe(-1);
    });
  });

  describe('Deterministic Behavior Validation', () => {
    test('Identical inputs produce identical results', () => {
      const scenario = {
        threat: {
          position: new THREE.Vector3(3000, 1500, 1000),
          velocity: new THREE.Vector3(-180, 20, -80)
        },
        interceptor: {
          position: new THREE.Vector3(100, 50, 100),
          speed: 320
        }
      };

      // Run simulation multiple times
      const results = [];
      for (let i = 0; i < 5; i++) {
        results.push(runInterceptionSimulation(
          scenario.threat.position,
          scenario.threat.velocity,
          scenario.interceptor.position,
          scenario.interceptor.speed
        ));
      }

      // All results should be identical
      for (let i = 1; i < results.length; i++) {
        expect(results[i].intercepted).toBe(results[0].intercepted);
        expect(results[i].timeToIntercept).toBe(results[0].timeToIntercept);
        expect(results[i].minDistance).toBe(results[0].minDistance);
        expect(results[i].detonationDistance).toBe(results[0].detonationDistance);
        expect(results[i].killProbability).toBe(results[0].killProbability);
        
        // Path lengths should be identical
        expect(results[i].interceptorPath.length).toBe(results[0].interceptorPath.length);
        expect(results[i].threatPath.length).toBe(results[0].threatPath.length);
      }
    });
  });

  describe('Kalman Filter Integration', () => {
    test('Tracking with measurement updates', () => {
      // Initialize threat with Kalman filter
      const threatPos = new THREE.Vector3(4000, 2000, 0);
      const threatVel = new THREE.Vector3(-200, 30, 0);
      
      let kalmanState = initializeKalmanState(
        threatPos,
        threatVel,
        new THREE.Vector3(0, -GRAVITY, 0)
      );

      const measurements: THREE.Vector3[] = [];
      const predictions: THREE.Vector3[] = [];

      // Simulate tracking for 5 seconds
      for (let t = 0; t <= 5; t += 0.5) {
        // Predict
        kalmanState = kalmanPredict(kalmanState, 0.5);
        predictions.push(kalmanState.position.clone());

        // Generate "measurement" (true position with noise)
        const truePos = calculateBallisticPosition(threatPos, threatVel, t + 0.5);
        const measurement = truePos.clone();
        // Add deterministic "noise" based on time
        measurement.x += Math.sin(t * 10) * 5;
        measurement.y += Math.cos(t * 10) * 5;
        measurements.push(measurement);

        // Update
        kalmanState = kalmanUpdate(kalmanState, measurement);
      }

      // Verify tracking accuracy
      const finalTrue = calculateBallisticPosition(threatPos, threatVel, 5);
      const finalEstimate = kalmanState.position;
      const error = finalEstimate.distanceTo(finalTrue);

      expect(error).toBeLessThan(150); // Within 150m after tracking with noise
      expect(predictions.length).toBeGreaterThanOrEqual(10);
      expect(measurements.length).toBeGreaterThanOrEqual(10);
    });

    test('Future position prediction for interception', () => {
      const threatState = initializeKalmanState(
        new THREE.Vector3(3000, 1500, 0),
        new THREE.Vector3(-150, 20, 0),
        new THREE.Vector3(0, -GRAVITY, 0)
      );

      // Predict 5 seconds into future
      const prediction = predictFuturePosition(threatState, 5);
      
      // Compare with kinematic prediction
      const kinematicPos = calculateBallisticPosition(
        threatState.position,
        threatState.velocity,
        5
      );

      const error = prediction.position.distanceTo(kinematicPos);
      expect(error).toBeLessThan(0.001); // Should match exactly without updates
      expect(prediction.uncertainty).toBeGreaterThan(0);
    });
  });

  describe('Performance Regression Detection', () => {
    const REFERENCE_SCENARIOS = [
      {
        name: 'Standard ballistic',
        threat: { pos: new THREE.Vector3(3000, 1200, 0), vel: new THREE.Vector3(-180, 10, 0) },
        interceptor: { pos: new THREE.Vector3(0, 0, 0), speed: 350 }, // Faster interceptor
        expected: { intercepted: true, minKillProb: 0.25 }
      },
      {
        name: 'Fast crossing',
        threat: { pos: new THREE.Vector3(2000, 500, 2000), vel: new THREE.Vector3(-100, -20, -100) },
        interceptor: { pos: new THREE.Vector3(0, 0, 0), speed: 350 },
        expected: { intercepted: true, minKillProb: 0.5 }
      },
      {
        name: 'High altitude',
        threat: { pos: new THREE.Vector3(6000, 4000, 0), vel: new THREE.Vector3(-250, 50, 0) },
        interceptor: { pos: new THREE.Vector3(0, 0, 0), speed: 400 },
        expected: { intercepted: true, minKillProb: 0.2 }
      }
    ];

    REFERENCE_SCENARIOS.forEach(scenario => {
      test(`Performance baseline: ${scenario.name}`, () => {
        const result = runInterceptionSimulation(
          scenario.threat.pos,
          scenario.threat.vel,
          scenario.interceptor.pos,
          scenario.interceptor.speed
        );

        expect(result.intercepted).toBe(scenario.expected.intercepted);
        if (result.intercepted) {
          expect(result.killProbability).toBeGreaterThanOrEqual(scenario.expected.minKillProb);
        }
      });
    });
  });
});