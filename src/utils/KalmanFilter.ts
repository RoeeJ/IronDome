import * as THREE from 'three';

interface KalmanState {
  // State vector: [x, y, z, vx, vy, vz, ax, ay, az]
  x: number[];
  // Error covariance matrix (9x9)
  P: number[][];
}

export class KalmanFilter {
  private state: KalmanState;
  private F: number[][] = []; // State transition matrix
  private H: number[][] = []; // Measurement matrix
  private Q: number[][] = [];
  private processNoiseIntensity = 0; // Process noise covariance
  private R: number[][] = []; // Measurement noise covariance
  private I: number[][]; // Identity matrix

  constructor() {
    // Initialize 9-dimensional state (position, velocity, acceleration)
    this.state = {
      x: [0, 0, 0, 0, 0, 0, 0, 0, 0],
      P: this.createIdentityMatrix(9, 100), // Initial uncertainty
    };

    this.I = this.createIdentityMatrix(9);
    this.initializeMatrices();
  }

  private initializeMatrices(): void {
    // Measurement matrix - we only measure position
    this.H = [
      [1, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 1, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 1, 0, 0, 0, 0, 0, 0],
    ];

    // Measurement noise (position uncertainty in meters)
    const measurementNoise = 5.0;
    this.R = [
      [measurementNoise, 0, 0],
      [0, measurementNoise, 0],
      [0, 0, measurementNoise],
    ];

    // Process noise will be set based on threat type
    this.Q = this.createZeroMatrix(9, 9);
  }

  initializeFromThreat(position: THREE.Vector3, velocity: THREE.Vector3, threatType: string): void {
    // Set initial state
    this.state.x = [
      position.x,
      position.y,
      position.z,
      velocity.x,
      velocity.y,
      velocity.z,
      0,
      /drone|cruise/i.test(threatType) ? 0 : -9.82,
      0, // Initial acceleration (gravity for ballistic)
    ];

    // Adjust process noise based on threat type
    const processNoise = this.getProcessNoiseForThreatType(threatType);
    this.processNoiseIntensity = processNoise;
    this.Q = this.createProcessNoiseMatrix(processNoise, 0);

    // Reset covariance
    this.state.P = this.createIdentityMatrix(9, 100);
  }

  predict(deltaTime: number): { position: THREE.Vector3; velocity: THREE.Vector3 } {
    if (!Number.isFinite(deltaTime) || deltaTime < 0)
      throw new RangeError('Invalid prediction duration');
    this.Q = this.createProcessNoiseMatrix(this.processNoiseIntensity, deltaTime);
    // Create state transition matrix for this time step
    this.F = this.createStateTransitionMatrix(deltaTime);

    // Predict state: x = F * x
    const predictedState = this.matrixVectorMultiply(this.F, this.state.x);

    // Predict covariance: P = F * P * F' + Q
    const FP = this.matrixMultiply(this.F, this.state.P);
    const FPFt = this.matrixMultiply(FP, this.transpose(this.F));
    this.state.P = this.matrixAdd(FPFt, this.Q);

    this.state.x = predictedState;

    return {
      position: new THREE.Vector3(predictedState[0], predictedState[1], predictedState[2]),
      velocity: new THREE.Vector3(predictedState[3], predictedState[4], predictedState[5]),
    };
  }

  update(measurement: THREE.Vector3): void {
    // Measurement residual: y = z - H * x
    const z = [measurement.x, measurement.y, measurement.z];
    const Hx = this.matrixVectorMultiply(this.H, this.state.x).slice(0, 3);
    const y = this.vectorSubtract(z, Hx);

    // Residual covariance: S = H * P * H' + R
    const HP = this.matrixMultiply(this.H, this.state.P);
    const HPHt = this.matrixMultiply(HP, this.transpose(this.H));
    const S = this.matrixAdd(HPHt, this.R);

    // Kalman gain: K = P * H' * S^(-1)
    const PHt = this.matrixMultiply(this.state.P, this.transpose(this.H));
    const K = this.matrixMultiply(PHt, this.matrixInverse3x3(S));

    // Update state: x = x + K * y
    const Ky = this.matrixVectorMultiply(K, y);
    this.state.x = this.vectorAdd(this.state.x, Ky);

    // Update covariance: P = (I - K * H) * P
    const KH = this.matrixMultiply(K, this.H);
    const IminusKH = this.matrixSubtract(this.I, KH);
    // Joseph form preserves symmetry and positive semidefiniteness under rounding.
    this.state.P = this.matrixAdd(
      this.matrixMultiply(this.matrixMultiply(IminusKH, this.state.P), this.transpose(IminusKH)),
      this.matrixMultiply(this.matrixMultiply(K, this.R), this.transpose(K))
    );
  }

  getState(): { position: THREE.Vector3; velocity: THREE.Vector3; acceleration: THREE.Vector3 } {
    return {
      position: new THREE.Vector3(this.state.x[0], this.state.x[1], this.state.x[2]),
      velocity: new THREE.Vector3(this.state.x[3], this.state.x[4], this.state.x[5]),
      acceleration: new THREE.Vector3(this.state.x[6], this.state.x[7], this.state.x[8]),
    };
  }

  getPositionUncertainty(): number {
    // Return average position uncertainty from covariance diagonal
    return Math.sqrt((this.state.P[0][0] + this.state.P[1][1] + this.state.P[2][2]) / 3);
  }

  private createStateTransitionMatrix(dt: number): number[][] {
    // Kinematic model with constant acceleration
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

  private getProcessNoiseForThreatType(type: string): number {
    // Different threat types have different maneuverability
    if (/drone/i.test(type)) return 5.0;
    switch (type.toLowerCase()) {
      case 'drone':
        return 5.0; // High maneuverability
      case 'cruise_missile':
        return 2.0; // Medium maneuverability
      case 'ballistic_missile':
        return 0.5; // Low maneuverability
      default:
        return 1.0;
    }
  }

  /** Continuous white jerk noise integrated over the prediction interval. */
  private createProcessNoiseMatrix(noise: number, dt: number): number[][] {
    const Q = this.createZeroMatrix(9, 9);
    const block = [
      [dt ** 5 / 20, dt ** 4 / 8, dt ** 3 / 6],
      [dt ** 4 / 8, dt ** 3 / 3, dt ** 2 / 2],
      [dt ** 3 / 6, dt ** 2 / 2, dt],
    ];
    for (let axis = 0; axis < 3; axis++) {
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++)
          Q[axis + row * 3][axis + col * 3] = noise * block[row][col];
      }
    }
    return Q;
  }

  /** Read-only constant-acceleration forecast from the current filtered state. */
  forecast(deltaTime: number): { position: THREE.Vector3; velocity: THREE.Vector3 } {
    if (!Number.isFinite(deltaTime) || deltaTime < 0)
      throw new RangeError('Invalid forecast duration');
    const { position, velocity, acceleration } = this.getState();
    position
      .addScaledVector(velocity, deltaTime)
      .addScaledVector(acceleration, 0.5 * deltaTime ** 2);
    velocity.addScaledVector(acceleration, deltaTime);
    return { position, velocity };
  }

  // Matrix operations
  private createIdentityMatrix(size: number, scale: number = 1): number[][] {
    const matrix: number[][] = [];
    for (let i = 0; i < size; i++) {
      matrix[i] = [];
      for (let j = 0; j < size; j++) {
        matrix[i][j] = i === j ? scale : 0;
      }
    }
    return matrix;
  }

  private createZeroMatrix(rows: number, cols: number): number[][] {
    const matrix: number[][] = [];
    for (let i = 0; i < rows; i++) {
      matrix[i] = new Array(cols).fill(0);
    }
    return matrix;
  }

  private matrixMultiply(A: number[][], B: number[][]): number[][] {
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

  private matrixVectorMultiply(A: number[][], v: number[]): number[] {
    const result: number[] = [];
    for (let i = 0; i < A.length; i++) {
      let sum = 0;
      for (let j = 0; j < v.length; j++) {
        sum += A[i][j] * v[j];
      }
      result[i] = sum;
    }
    return result;
  }

  private matrixAdd(A: number[][], B: number[][]): number[][] {
    const result: number[][] = [];
    for (let i = 0; i < A.length; i++) {
      result[i] = [];
      for (let j = 0; j < A[0].length; j++) {
        result[i][j] = A[i][j] + B[i][j];
      }
    }
    return result;
  }

  private matrixSubtract(A: number[][], B: number[][]): number[][] {
    const result: number[][] = [];
    for (let i = 0; i < A.length; i++) {
      result[i] = [];
      for (let j = 0; j < A[0].length; j++) {
        result[i][j] = A[i][j] - B[i][j];
      }
    }
    return result;
  }

  private vectorAdd(a: number[], b: number[]): number[] {
    return a.map((val, i) => val + b[i]);
  }

  private vectorSubtract(a: number[], b: number[]): number[] {
    return a.map((val, i) => val - b[i]);
  }

  private transpose(A: number[][]): number[][] {
    const rows = A.length;
    const cols = A[0].length;
    const result: number[][] = [];

    for (let i = 0; i < cols; i++) {
      result[i] = [];
      for (let j = 0; j < rows; j++) {
        result[i][j] = A[j][i];
      }
    }
    return result;
  }

  private matrixInverse3x3(A: number[][]): number[][] {
    // Calculate determinant
    const det =
      A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) -
      A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) +
      A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);

    if (Math.abs(det) < 1e-10) {
      // Singular matrix, return identity to avoid division by zero
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
}
