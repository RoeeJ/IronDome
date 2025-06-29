import * as THREE from 'three';

/**
 * Pure Kalman filter implementation for trajectory tracking
 * All operations are deterministic with no side effects
 */

export interface KalmanState {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  acceleration: THREE.Vector3;
  covariance: number[][]; // 9x9 error covariance matrix
}

export interface KalmanConfig {
  processNoise: number;
  measurementNoise: number;
  initialUncertainty: number;
}

/**
 * Initialize Kalman filter state
 */
export function initializeKalmanState(
  position: THREE.Vector3,
  velocity: THREE.Vector3,
  acceleration: THREE.Vector3 = new THREE.Vector3(0, -9.81, 0),
  config: KalmanConfig = { processNoise: 1.0, measurementNoise: 5.0, initialUncertainty: 100 }
): KalmanState {
  return {
    position: position.clone(),
    velocity: velocity.clone(),
    acceleration: acceleration.clone(),
    covariance: createIdentityMatrix(9, config.initialUncertainty),
  };
}

/**
 * Predict next state using kinematic model
 */
export function kalmanPredict(
  state: KalmanState,
  deltaTime: number,
  processNoise: number = 1.0
): KalmanState {
  // Create state transition matrix F
  const F = createStateTransitionMatrix(deltaTime);

  // Convert state to vector form
  const stateVector = stateToVector(state);

  // Predict state: x_pred = F * x
  const predictedVector = matrixVectorMultiply(F, stateVector);

  // Predict covariance: P_pred = F * P * F' + Q
  const Q = createProcessNoiseMatrix(processNoise);
  const FP = matrixMultiply(F, state.covariance);
  const FPFt = matrixMultiply(FP, transposeMatrix(F));
  const predictedCovariance = matrixAdd(FPFt, Q);

  return {
    position: new THREE.Vector3(predictedVector[0], predictedVector[1], predictedVector[2]),
    velocity: new THREE.Vector3(predictedVector[3], predictedVector[4], predictedVector[5]),
    acceleration: new THREE.Vector3(predictedVector[6], predictedVector[7], predictedVector[8]),
    covariance: predictedCovariance,
  };
}

/**
 * Update state with measurement
 */
export function kalmanUpdate(
  state: KalmanState,
  measuredPosition: THREE.Vector3,
  measurementNoise: number = 5.0
): KalmanState {
  // Measurement matrix H (we only measure position)
  const H = createMeasurementMatrix();

  // Measurement noise matrix R
  const R = createMeasurementNoiseMatrix(measurementNoise);

  // Convert to vectors
  const stateVector = stateToVector(state);
  const measurement = [measuredPosition.x, measuredPosition.y, measuredPosition.z];

  // Innovation: y = z - H * x
  const Hx = matrixVectorMultiply(H, stateVector).slice(0, 3);
  const innovation = vectorSubtract(measurement, Hx);

  // Innovation covariance: S = H * P * H' + R
  const HP = matrixMultiply(H, state.covariance);
  const HPHt = matrixMultiply(HP, transposeMatrix(H));
  const S = matrixAdd(HPHt, R);

  // Kalman gain: K = P * H' * inv(S)
  const PHt = matrixMultiply(state.covariance, transposeMatrix(H));
  const K = matrixMultiply(PHt, matrixInverse3x3(S));

  // Update state: x_new = x + K * y
  const Ky = matrixVectorMultiply(K, innovation);
  const updatedVector = vectorAdd(stateVector, Ky);

  // Update covariance: P_new = (I - K * H) * P
  const I = createIdentityMatrix(9);
  const KH = matrixMultiply(K, H);
  const IminusKH = matrixSubtract(I, KH);
  const updatedCovariance = matrixMultiply(IminusKH, state.covariance);

  return {
    position: new THREE.Vector3(updatedVector[0], updatedVector[1], updatedVector[2]),
    velocity: new THREE.Vector3(updatedVector[3], updatedVector[4], updatedVector[5]),
    acceleration: new THREE.Vector3(updatedVector[6], updatedVector[7], updatedVector[8]),
    covariance: updatedCovariance,
  };
}

/**
 * Get position uncertainty from covariance
 */
export function getPositionUncertainty(state: KalmanState): number {
  // Average of position covariance diagonal elements
  return Math.sqrt((state.covariance[0][0] + state.covariance[1][1] + state.covariance[2][2]) / 3);
}

/**
 * Predict future position with uncertainty
 */
export function predictFuturePosition(
  state: KalmanState,
  futureTime: number,
  gravity: number = 9.81
): { position: THREE.Vector3; uncertainty: number } {
  // Kinematic prediction
  const t = futureTime;
  const t2 = 0.5 * t * t;

  const futurePosition = new THREE.Vector3(
    state.position.x + state.velocity.x * t + state.acceleration.x * t2,
    state.position.y + state.velocity.y * t + state.acceleration.y * t2,
    state.position.z + state.velocity.z * t + state.acceleration.z * t2
  );

  // Propagate uncertainty
  const F = createStateTransitionMatrix(futureTime);
  const futureCovariance = matrixMultiply(matrixMultiply(F, state.covariance), transposeMatrix(F));
  const uncertainty = Math.sqrt(
    (futureCovariance[0][0] + futureCovariance[1][1] + futureCovariance[2][2]) / 3
  );

  return { position: futurePosition, uncertainty };
}

// Matrix operations (pure functions)

function stateToVector(state: KalmanState): number[] {
  return [
    state.position.x,
    state.position.y,
    state.position.z,
    state.velocity.x,
    state.velocity.y,
    state.velocity.z,
    state.acceleration.x,
    state.acceleration.y,
    state.acceleration.z,
  ];
}

function createIdentityMatrix(size: number, scale: number = 1): number[][] {
  const matrix: number[][] = [];
  for (let i = 0; i < size; i++) {
    matrix[i] = [];
    for (let j = 0; j < size; j++) {
      matrix[i][j] = i === j ? scale : 0;
    }
  }
  return matrix;
}

function createStateTransitionMatrix(dt: number): number[][] {
  const dt2 = 0.5 * dt * dt;
  return [
    [1, 0, 0, dt, 0, 0, dt2, 0, 0],
    [0, 1, 0, 0, dt, 0, 0, dt2, 0],
    [0, 0, 1, 0, 0, dt, 0, 0, dt2],
    [0, 0, 0, 1, 0, 0, dt, 0, 0],
    [0, 0, 0, 0, 1, 0, 0, dt, 0],
    [0, 0, 0, 0, 0, 1, 0, 0, dt],
    [0, 0, 0, 0, 0, 0, 1, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 1, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 1],
  ];
}

function createMeasurementMatrix(): number[][] {
  return [
    [1, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 1, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 1, 0, 0, 0, 0, 0, 0],
  ];
}

function createProcessNoiseMatrix(noise: number): number[][] {
  const Q = Array(9)
    .fill(null)
    .map(() => Array(9).fill(0));
  // Add noise to acceleration components
  Q[6][6] = noise;
  Q[7][7] = noise;
  Q[8][8] = noise;
  return Q;
}

function createMeasurementNoiseMatrix(noise: number): number[][] {
  return [
    [noise, 0, 0],
    [0, noise, 0],
    [0, 0, noise],
  ];
}

function matrixMultiply(A: number[][], B: number[][]): number[][] {
  const rows = A.length;
  const cols = B[0].length;
  const result: number[][] = [];

  for (let i = 0; i < rows; i++) {
    result[i] = [];
    for (let j = 0; j < cols; j++) {
      let sum = 0;
      for (let k = 0; k < A[0].length; k++) {
        sum += A[i][k] * B[k][j];
      }
      result[i][j] = sum;
    }
  }
  return result;
}

function matrixVectorMultiply(A: number[][], v: number[]): number[] {
  return A.map(row => row.reduce((sum, val, i) => sum + val * v[i], 0));
}

function matrixAdd(A: number[][], B: number[][]): number[][] {
  return A.map((row, i) => row.map((val, j) => val + B[i][j]));
}

function matrixSubtract(A: number[][], B: number[][]): number[][] {
  return A.map((row, i) => row.map((val, j) => val - B[i][j]));
}

function vectorAdd(a: number[], b: number[]): number[] {
  return a.map((val, i) => val + b[i]);
}

function vectorSubtract(a: number[], b: number[]): number[] {
  return a.map((val, i) => val - b[i]);
}

function transposeMatrix(A: number[][]): number[][] {
  return A[0].map((_, i) => A.map(row => row[i]));
}

function matrixInverse3x3(A: number[][]): number[][] {
  const det =
    A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) -
    A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) +
    A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);

  if (Math.abs(det) < 1e-10) {
    // Return identity for singular matrix
    return [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
  }

  const invDet = 1 / det;

  return [
    [
      invDet * (A[1][1] * A[2][2] - A[1][2] * A[2][1]),
      invDet * (A[0][2] * A[2][1] - A[0][1] * A[2][2]),
      invDet * (A[0][1] * A[1][2] - A[0][2] * A[1][1]),
    ],
    [
      invDet * (A[1][2] * A[2][0] - A[1][0] * A[2][2]),
      invDet * (A[0][0] * A[2][2] - A[0][2] * A[2][0]),
      invDet * (A[0][2] * A[1][0] - A[0][0] * A[1][2]),
    ],
    [
      invDet * (A[1][0] * A[2][1] - A[1][1] * A[2][0]),
      invDet * (A[0][1] * A[2][0] - A[0][0] * A[2][1]),
      invDet * (A[0][0] * A[1][1] - A[0][1] * A[1][0]),
    ],
  ];
}
