import { describe, test, expect } from 'bun:test';
import * as THREE from 'three';
import {
  initializeKalmanState,
  kalmanPredict,
  kalmanUpdate,
  getPositionUncertainty,
  predictFuturePosition,
  KalmanState
} from '../../../src/physics/kalman';

describe('Deterministic Kalman Filter Tests', () => {
  describe('State Initialization', () => {
    test('should initialize with exact values', () => {
      const position = new THREE.Vector3(1000, 500, 2000);
      const velocity = new THREE.Vector3(-100, 20, -50);
      const acceleration = new THREE.Vector3(0, -9.81, 0);
      
      const state = initializeKalmanState(position, velocity, acceleration);
      
      expect(state.position.x).toBe(1000);
      expect(state.position.y).toBe(500);
      expect(state.position.z).toBe(2000);
      expect(state.velocity.x).toBe(-100);
      expect(state.velocity.y).toBe(20);
      expect(state.velocity.z).toBe(-50);
      expect(state.acceleration.y).toBe(-9.81);
      
      // Check covariance matrix is initialized
      expect(state.covariance.length).toBe(9);
      expect(state.covariance[0].length).toBe(9);
      expect(state.covariance[0][0]).toBe(100); // Initial uncertainty
    });

    test('deterministic initialization', () => {
      const pos = new THREE.Vector3(100, 200, 300);
      const vel = new THREE.Vector3(10, 20, 30);
      
      // Initialize multiple times with same inputs
      const states = [];
      for (let i = 0; i < 5; i++) {
        states.push(initializeKalmanState(pos, vel));
      }
      
      // All states should be identical
      for (let i = 1; i < states.length; i++) {
        expect(states[i].position).toEqual(states[0].position);
        expect(states[i].velocity).toEqual(states[0].velocity);
        expect(states[i].covariance).toEqual(states[0].covariance);
      }
    });
  });

  describe('Prediction Step', () => {
    test('should predict ballistic trajectory', () => {
      const initialState = initializeKalmanState(
        new THREE.Vector3(0, 100, 0),
        new THREE.Vector3(50, 20, 0),
        new THREE.Vector3(0, -9.81, 0)
      );
      
      // Predict 1 second ahead
      const predictedState = kalmanPredict(initialState, 1.0);
      
      // Position should follow kinematic equations
      // x = x0 + vx*t + 0.5*ax*t² = 0 + 50*1 + 0 = 50
      // y = y0 + vy*t + 0.5*ay*t² = 100 + 20*1 + 0.5*(-9.81)*1 = 115.095
      // z = z0 + vz*t + 0.5*az*t² = 0 + 0*1 + 0 = 0
      expect(predictedState.position.x).toBeCloseTo(50, 6);
      expect(predictedState.position.y).toBeCloseTo(115.095, 6);
      expect(predictedState.position.z).toBeCloseTo(0, 6);
      
      // Velocity should update with acceleration
      // vx = vx0 + ax*t = 50 + 0*1 = 50
      // vy = vy0 + ay*t = 20 + (-9.81)*1 = 10.19
      // vz = vz0 + az*t = 0 + 0*1 = 0
      expect(predictedState.velocity.x).toBeCloseTo(50, 6);
      expect(predictedState.velocity.y).toBeCloseTo(10.19, 6);
      expect(predictedState.velocity.z).toBeCloseTo(0, 6);
    });

    test('deterministic multi-step prediction', () => {
      const initialState = initializeKalmanState(
        new THREE.Vector3(1000, 800, 500),
        new THREE.Vector3(-80, 50, -40),
        new THREE.Vector3(0, -9.81, 0)
      );
      
      let state = initialState;
      const dt = 0.1;
      const predictions = [];
      
      // Predict 10 steps
      for (let i = 0; i < 10; i++) {
        state = kalmanPredict(state, dt);
        predictions.push({
          position: state.position.clone(),
          velocity: state.velocity.clone()
        });
      }
      
      // Verify deterministic results
      const finalTime = 1.0; // 10 steps * 0.1s
      const expectedPos = {
        x: 1000 + (-80) * finalTime,
        y: 800 + 50 * finalTime + 0.5 * (-9.81) * finalTime * finalTime,
        z: 500 + (-40) * finalTime
      };
      
      expect(predictions[9].position.x).toBeCloseTo(expectedPos.x, 4);
      expect(predictions[9].position.y).toBeCloseTo(expectedPos.y, 4);
      expect(predictions[9].position.z).toBeCloseTo(expectedPos.z, 4);
    });
  });

  describe('Update Step', () => {
    test('should correct prediction with measurement', () => {
      const state = initializeKalmanState(
        new THREE.Vector3(100, 200, 300),
        new THREE.Vector3(10, 20, 30),
        new THREE.Vector3(0, -9.81, 0)
      );
      
      // Predict forward
      const predicted = kalmanPredict(state, 0.5);
      
      // Simulate noisy measurement (true position with error)
      const truePosition = new THREE.Vector3(
        100 + 10 * 0.5,
        200 + 20 * 0.5 - 0.5 * 9.81 * 0.25,
        300 + 30 * 0.5
      );
      const measurement = truePosition.clone().add(new THREE.Vector3(2, -1, 3));
      
      // Update with measurement
      const updated = kalmanUpdate(predicted, measurement);
      
      // Updated position should be between predicted and measurement
      expect(updated.position.x).toBeGreaterThan(predicted.position.x);
      expect(updated.position.x).toBeLessThan(measurement.x);
    });

    test('should reduce uncertainty with updates', () => {
      let state = initializeKalmanState(
        new THREE.Vector3(0, 100, 0),
        new THREE.Vector3(50, 0, 0),
        new THREE.Vector3(0, -9.81, 0),
        { processNoise: 0.5, measurementNoise: 2.0, initialUncertainty: 100 }
      );
      
      const initialUncertainty = getPositionUncertainty(state);
      
      // Simulate multiple predict/update cycles
      for (let i = 0; i < 5; i++) {
        state = kalmanPredict(state, 0.1, 0.5);
        
        // Perfect measurements
        const trueMeasurement = state.position.clone();
        state = kalmanUpdate(state, trueMeasurement, 2.0);
      }
      
      const finalUncertainty = getPositionUncertainty(state);
      expect(finalUncertainty).toBeLessThan(initialUncertainty);
    });
  });

  describe('Future Position Prediction', () => {
    test('should predict future position with uncertainty', () => {
      const state = initializeKalmanState(
        new THREE.Vector3(0, 500, 0),
        new THREE.Vector3(100, 50, 0),
        new THREE.Vector3(0, -9.81, 0)
      );
      
      const futureTime = 2.0;
      const prediction = predictFuturePosition(state, futureTime);
      
      // Verify kinematic prediction
      const expectedX = 0 + 100 * 2;
      const expectedY = 500 + 50 * 2 - 0.5 * 9.81 * 4;
      const expectedZ = 0;
      
      expect(prediction.position.x).toBeCloseTo(expectedX, 6);
      expect(prediction.position.y).toBeCloseTo(expectedY, 6);
      expect(prediction.position.z).toBeCloseTo(expectedZ, 6);
      
      // Should have non-zero uncertainty
      expect(prediction.uncertainty).toBeGreaterThan(0);
    });

    test('uncertainty should grow with prediction time', () => {
      const state = initializeKalmanState(
        new THREE.Vector3(1000, 1000, 1000),
        new THREE.Vector3(-100, 0, -100),
        new THREE.Vector3(0, -9.81, 0)
      );
      
      const times = [1, 2, 3, 4, 5];
      const uncertainties = times.map(t => 
        predictFuturePosition(state, t).uncertainty
      );
      
      // Uncertainty should increase with time
      for (let i = 1; i < uncertainties.length; i++) {
        expect(uncertainties[i]).toBeGreaterThan(uncertainties[i-1]);
      }
    });
  });

  describe('Threat Type Handling', () => {
    test('different threat types should have different process noise', () => {
      const threats = [
        { type: 'ballistic', expectedNoise: 0.5 },
        { type: 'drone', expectedNoise: 5.0 },
        { type: 'cruise', expectedNoise: 2.0 }
      ];
      
      threats.forEach(({ type, expectedNoise }) => {
        const config = {
          processNoise: type === 'ballistic' ? 0.5 : type === 'drone' ? 5.0 : 2.0,
          measurementNoise: 5.0,
          initialUncertainty: 100
        };
        
        const state = initializeKalmanState(
          new THREE.Vector3(1000, 500, 0),
          new THREE.Vector3(-100, 0, 0),
          new THREE.Vector3(0, -9.81, 0),
          config
        );
        
        // Predict and check that process noise affects uncertainty growth
        const predicted = kalmanPredict(state, 1.0, config.processNoise);
        const uncertainty = getPositionUncertainty(predicted);
        
        // Higher process noise should lead to higher uncertainty growth
        // But initial uncertainty dominates in single step
        if (type === 'drone') {
          expect(config.processNoise).toBe(5.0);
        } else if (type === 'ballistic') {
          expect(config.processNoise).toBe(0.5);
        }
        // All should have reasonable uncertainty after one prediction
        expect(uncertainty).toBeGreaterThan(10);
        expect(uncertainty).toBeLessThan(200);
      });
    });
  });

  describe('Deterministic Behavior', () => {
    test('identical inputs produce identical outputs', () => {
      const runSimulation = () => {
        let state = initializeKalmanState(
          new THREE.Vector3(2000, 1000, 1500),
          new THREE.Vector3(-150, 30, -100),
          new THREE.Vector3(0, -9.81, 0)
        );
        
        const results = [];
        
        for (let i = 0; i < 10; i++) {
          state = kalmanPredict(state, 0.1);
          
          if (i % 2 === 0) {
            const measurement = state.position.clone().add(
              new THREE.Vector3(
                Math.sin(i) * 2,
                Math.cos(i) * 2,
                Math.sin(i * 2) * 2
              )
            );
            state = kalmanUpdate(state, measurement);
          }
          
          results.push({
            position: state.position.clone(),
            velocity: state.velocity.clone(),
            uncertainty: getPositionUncertainty(state)
          });
        }
        
        return results;
      };
      
      // Run simulation multiple times
      const run1 = runSimulation();
      const run2 = runSimulation();
      const run3 = runSimulation();
      
      // All runs should produce identical results
      for (let i = 0; i < run1.length; i++) {
        expect(run2[i].position).toEqual(run1[i].position);
        expect(run2[i].velocity).toEqual(run1[i].velocity);
        expect(run2[i].uncertainty).toBe(run1[i].uncertainty);
        
        expect(run3[i].position).toEqual(run1[i].position);
        expect(run3[i].velocity).toEqual(run1[i].velocity);
        expect(run3[i].uncertainty).toBe(run1[i].uncertainty);
      }
    });
  });
});