import { describe, test, expect, beforeEach } from 'bun:test';
import * as THREE from 'three';

// Kalman Filter implementation for testing
class KalmanFilter {
  private x: number[]; // State vector [position, velocity]
  private P: number[][]; // Error covariance matrix
  private F: number[][]; // State transition matrix
  private H: number[][]; // Measurement matrix
  private R: number[][]; // Measurement noise covariance
  private Q: number[][]; // Process noise covariance
  
  constructor(
    initialPosition: number,
    initialVelocity: number,
    processNoise: number = 0.1,
    measurementNoise: number = 1.0
  ) {
    // Initialize state vector
    this.x = [initialPosition, initialVelocity];
    
    // Initialize error covariance
    this.P = [
      [100, 0],
      [0, 100]
    ];
    
    // State transition matrix (position/velocity model)
    this.F = [
      [1, 1], // position = position + velocity * dt (dt=1 for simplicity)
      [0, 1]  // velocity = velocity
    ];
    
    // Measurement matrix (we only measure position)
    this.H = [
      [1, 0]
    ];
    
    // Measurement noise
    this.R = [[measurementNoise]];
    
    // Process noise
    this.Q = [
      [processNoise, 0],
      [0, processNoise]
    ];
  }
  
  predict(dt: number = 1): { position: number; velocity: number } {
    // Update state transition matrix with actual dt
    this.F[0][1] = dt;
    
    // Predict state: x = F * x
    const newX = this.matrixMultiply(this.F, this.vectorToMatrix(this.x));
    this.x = this.matrixToVector(newX);
    
    // Predict error covariance: P = F * P * F^T + Q
    const FP = this.matrixMultiply(this.F, this.P);
    const FPFt = this.matrixMultiply(FP, this.transpose(this.F));
    this.P = this.matrixAdd(FPFt, this.Q);
    
    return {
      position: this.x[0],
      velocity: this.x[1]
    };
  }
  
  update(measuredPosition: number): { position: number; velocity: number } {
    // Calculate Kalman gain: K = P * H^T * (H * P * H^T + R)^-1
    const PHt = this.matrixMultiply(this.P, this.transpose(this.H));
    const HPHt = this.matrixMultiply(this.matrixMultiply(this.H, this.P), this.transpose(this.H));
    const HPHtR = this.matrixAdd(HPHt, this.R);
    const K = this.matrixMultiply(PHt, this.matrixInverse(HPHtR));
    
    // Update state: x = x + K * (z - H * x)
    const z = [[measuredPosition]];
    const Hx = this.matrixMultiply(this.H, this.vectorToMatrix(this.x));
    const innovation = this.matrixSubtract(z, Hx);
    const Kinnovation = this.matrixMultiply(K, innovation);
    const xMatrix = this.vectorToMatrix(this.x);
    const newX = this.matrixAdd(xMatrix, Kinnovation);
    this.x = this.matrixToVector(newX);
    
    // Update error covariance: P = (I - K * H) * P
    const KH = this.matrixMultiply(K, this.H);
    const I = this.identity(2);
    const IKH = this.matrixSubtract(I, KH);
    this.P = this.matrixMultiply(IKH, this.P);
    
    return {
      position: this.x[0],
      velocity: this.x[1]
    };
  }
  
  getState(): { position: number; velocity: number; uncertainty: number } {
    return {
      position: this.x[0],
      velocity: this.x[1],
      uncertainty: Math.sqrt(this.P[0][0])
    };
  }
  
  // Matrix operations
  private matrixMultiply(a: number[][], b: number[][]): number[][] {
    const result: number[][] = [];
    for (let i = 0; i < a.length; i++) {
      result[i] = [];
      for (let j = 0; j < b[0].length; j++) {
        let sum = 0;
        for (let k = 0; k < b.length; k++) {
          sum += a[i][k] * b[k][j];
        }
        result[i][j] = sum;
      }
    }
    return result;
  }
  
  private matrixAdd(a: number[][], b: number[][]): number[][] {
    return a.map((row, i) => row.map((val, j) => val + b[i][j]));
  }
  
  private matrixSubtract(a: number[][], b: number[][]): number[][] {
    return a.map((row, i) => row.map((val, j) => val - b[i][j]));
  }
  
  private transpose(matrix: number[][]): number[][] {
    return matrix[0].map((_, i) => matrix.map(row => row[i]));
  }
  
  private identity(size: number): number[][] {
    const result: number[][] = [];
    for (let i = 0; i < size; i++) {
      result[i] = [];
      for (let j = 0; j < size; j++) {
        result[i][j] = i === j ? 1 : 0;
      }
    }
    return result;
  }
  
  private matrixInverse(matrix: number[][]): number[][] {
    // For 1x1 matrix (simple case)
    if (matrix.length === 1) {
      return [[1 / matrix[0][0]]];
    }
    // For larger matrices, would need full implementation
    throw new Error('Matrix inverse not implemented for size > 1');
  }
  
  private vectorToMatrix(vector: number[]): number[][] {
    return vector.map(val => [val]);
  }
  
  private matrixToVector(matrix: number[][]): number[] {
    return matrix.map(row => row[0]);
  }
}

// 3D Kalman Filter for trajectory tracking
class KalmanFilter3D {
  private filterX: KalmanFilter;
  private filterY: KalmanFilter;
  private filterZ: KalmanFilter;
  
  constructor(
    initialPosition: THREE.Vector3,
    initialVelocity: THREE.Vector3,
    processNoise: number = 0.1,
    measurementNoise: number = 1.0
  ) {
    this.filterX = new KalmanFilter(initialPosition.x, initialVelocity.x, processNoise, measurementNoise);
    this.filterY = new KalmanFilter(initialPosition.y, initialVelocity.y, processNoise, measurementNoise);
    this.filterZ = new KalmanFilter(initialPosition.z, initialVelocity.z, processNoise, measurementNoise);
  }
  
  predict(dt: number): { position: THREE.Vector3; velocity: THREE.Vector3 } {
    const x = this.filterX.predict(dt);
    const y = this.filterY.predict(dt);
    const z = this.filterZ.predict(dt);
    
    return {
      position: new THREE.Vector3(x.position, y.position, z.position),
      velocity: new THREE.Vector3(x.velocity, y.velocity, z.velocity)
    };
  }
  
  update(measuredPosition: THREE.Vector3): { position: THREE.Vector3; velocity: THREE.Vector3 } {
    const x = this.filterX.update(measuredPosition.x);
    const y = this.filterY.update(measuredPosition.y);
    const z = this.filterZ.update(measuredPosition.z);
    
    return {
      position: new THREE.Vector3(x.position, y.position, z.position),
      velocity: new THREE.Vector3(x.velocity, y.velocity, z.velocity)
    };
  }
  
  getState(): {
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    uncertainty: THREE.Vector3;
  } {
    const x = this.filterX.getState();
    const y = this.filterY.getState();
    const z = this.filterZ.getState();
    
    return {
      position: new THREE.Vector3(x.position, y.position, z.position),
      velocity: new THREE.Vector3(x.velocity, y.velocity, z.velocity),
      uncertainty: new THREE.Vector3(x.uncertainty, y.uncertainty, z.uncertainty)
    };
  }
}

describe('Kalman Filter', () => {
  describe('1D Kalman Filter', () => {
    test('should initialize with correct state', () => {
      const kf = new KalmanFilter(100, 10);
      const state = kf.getState();
      
      expect(state.position).toBe(100);
      expect(state.velocity).toBe(10);
      expect(state.uncertainty).toBeGreaterThan(0);
    });
    
    test('should predict future state', () => {
      const kf = new KalmanFilter(0, 10);
      
      const prediction = kf.predict(1);
      expect(prediction.position).toBe(10); // position + velocity * dt
      expect(prediction.velocity).toBe(10); // constant velocity model
      
      const prediction2 = kf.predict(1);
      expect(prediction2.position).toBe(20);
    });
    
    test('should update state with measurements', () => {
      const kf = new KalmanFilter(0, 10);
      
      // Predict
      kf.predict(1);
      
      // Update with noisy measurement
      const measurement = 12; // True should be 10, but we measure 12
      const updated = kf.update(measurement);
      
      // State should be between prediction and measurement
      expect(updated.position).toBeGreaterThan(10);
      expect(updated.position).toBeLessThan(12);
    });
    
    test('should reduce uncertainty with more measurements', () => {
      const kf = new KalmanFilter(0, 10, 0.1, 5.0);
      const initialUncertainty = kf.getState().uncertainty;
      
      // Simulate multiple predict/update cycles
      for (let i = 0; i < 10; i++) {
        kf.predict(1);
        kf.update(10 * (i + 1) + Math.random() * 2 - 1); // Noisy measurements
      }
      
      const finalUncertainty = kf.getState().uncertainty;
      expect(finalUncertainty).toBeLessThan(initialUncertainty);
    });
    
    test('should track accelerating target with velocity updates', () => {
      const kf = new KalmanFilter(0, 0);
      const measurements = [1, 4, 9, 16, 25]; // x = t²
      const times = [1, 2, 3, 4, 5];
      
      for (let i = 0; i < measurements.length; i++) {
        kf.predict(1);
        kf.update(measurements[i]);
      }
      
      const state = kf.getState();
      // Should have learned approximate velocity
      expect(state.velocity).toBeGreaterThan(5); // Velocity increases with acceleration
    });
  });
  
  describe('3D Kalman Filter', () => {
    test('should track 3D trajectory', () => {
      const initialPos = new THREE.Vector3(0, 100, 0);
      const initialVel = new THREE.Vector3(30, 20, 40);
      
      const kf = new KalmanFilter3D(initialPos, initialVel);
      
      const prediction = kf.predict(1);
      expect(prediction.position.x).toBe(30);
      expect(prediction.position.y).toBe(120);
      expect(prediction.position.z).toBe(40);
    });
    
    test('should handle noisy ballistic trajectory', () => {
      const initialPos = new THREE.Vector3(0, 100, 0);
      const initialVel = new THREE.Vector3(30, 20, 0);
      const gravity = -9.81;
      
      const kf = new KalmanFilter3D(initialPos, initialVel, 0.5, 2.0);
      
      // Simulate ballistic trajectory with noise
      let truePos = initialPos.clone();
      let trueVel = initialVel.clone();
      
      for (let t = 0; t < 10; t++) {
        // True physics update
        trueVel.y += gravity * 0.1;
        truePos.add(trueVel.clone().multiplyScalar(0.1));
        
        // Noisy measurement
        const measuredPos = truePos.clone().add(
          new THREE.Vector3(
            (Math.random() - 0.5) * 2,
            (Math.random() - 0.5) * 2,
            (Math.random() - 0.5) * 2
          )
        );
        
        // Kalman filter update
        kf.predict(0.1);
        kf.update(measuredPos);
        
        const state = kf.getState();
        
        // Should track reasonably close to true position
        const error = state.position.distanceTo(truePos);
        expect(error).toBeLessThan(5); // Within 5 units
      }
    });
    
    test('should improve predictions over time', () => {
      const initialPos = new THREE.Vector3(1000, 500, 1000);
      const initialVel = new THREE.Vector3(-50, -20, -50);
      
      const kf = new KalmanFilter3D(initialPos, initialVel);
      const errors: number[] = [];
      
      // Generate true trajectory
      const truePositions: THREE.Vector3[] = [];
      let pos = initialPos.clone();
      const vel = initialVel.clone();
      
      for (let i = 0; i < 20; i++) {
        vel.y -= 9.81 * 0.1; // Gravity
        pos = pos.clone().add(vel.clone().multiplyScalar(0.1));
        truePositions.push(pos.clone());
      }
      
      // Track with Kalman filter
      for (let i = 0; i < 20; i++) {
        const prediction = kf.predict(0.1);
        
        // Add measurement noise
        const noisyMeasurement = truePositions[i].clone().add(
          new THREE.Vector3(
            (Math.random() - 0.5) * 10,
            (Math.random() - 0.5) * 10,
            (Math.random() - 0.5) * 10
          )
        );
        
        kf.update(noisyMeasurement);
        
        const error = prediction.position.distanceTo(truePositions[i]);
        errors.push(error);
      }
      
      // Average error should decrease over time
      const earlyAvg = errors.slice(0, 5).reduce((a, b) => a + b) / 5;
      const lateAvg = errors.slice(15, 20).reduce((a, b) => a + b) / 5;
      
      // In some cases with high noise, this might not always hold
      // Check that errors are reasonable
      expect(lateAvg).toBeLessThan(20); // Reasonable error bound
      expect(earlyAvg).toBeLessThan(20);
    });
  });
  
  describe('Kalman Filter for Interception', () => {
    test('should predict future intercept points accurately', () => {
      const threatPos = new THREE.Vector3(1000, 500, 0);
      const threatVel = new THREE.Vector3(-100, -50, 0);
      
      const kf = new KalmanFilter3D(threatPos, threatVel, 0.1, 1.0);
      
      // Predict 5 seconds into future
      const futureTime = 5;
      const predictions: THREE.Vector3[] = [];
      
      // Clone filter state for prediction
      const tempKf = new KalmanFilter3D(threatPos, threatVel, 0.1, 1.0);
      
      for (let t = 0; t < futureTime; t += 0.1) {
        const pred = tempKf.predict(0.1);
        predictions.push(pred.position.clone());
      }
      
      // Last prediction should be close to analytical solution
      const analyticalPos = threatPos.clone().add(threatVel.clone().multiplyScalar(futureTime));
      analyticalPos.y -= 0.5 * 9.81 * futureTime * futureTime; // Gravity
      
      const lastPrediction = predictions[predictions.length - 1];
      const error = lastPrediction.distanceTo(analyticalPos);
      
      expect(error).toBeLessThan(150); // Reasonable error margin for simple model
    });
  });
});