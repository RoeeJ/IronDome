import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { debug } from '../utils/logger';

export interface ThrustControlConfig {
  // Motor characteristics
  maxThrust: number; // Maximum thrust force (N)
  thrustDuration: number; // Motor burn time (seconds)
  specificImpulse: number; // Fuel efficiency (seconds)

  // Thrust Vector Control (TVC)
  maxGimbalAngle: number; // Max deflection angle (degrees)
  gimbalRate: number; // Gimbal rotation speed (deg/s)

  // Divert and Attitude Control System (DACS)
  dacsThrustPulse: number; // Side thruster force (N)
  dacsImpulseBudget: number; // Total DACS fuel (N·s)
  minPulseDuration: number; // Minimum pulse time (ms)

  // Control parameters
  proportionalGain: number; // P gain for control loop
  derivativeGain: number; // D gain for control loop
  maxAngularAccel: number; // Max angular acceleration (rad/s²)
}

export class ThrustVectorControl {
  private config: ThrustControlConfig;
  private thrustStartTime: number;
  private currentThrust: number;
  private gimbalAngle: THREE.Vector2; // Pitch and yaw
  public dacsRemainingImpulse: number; // Made public for access
  private lastControlTime: number = 0;

  // Tamir interceptor specifications (estimated from public data)
  static readonly TAMIR_CONFIG: ThrustControlConfig = {
    // Solid rocket motor
    maxThrust: 5000, // ~5kN thrust
    thrustDuration: 3, // 3 second burn time
    specificImpulse: 250, // Typical for solid fuel

    // TVC capabilities
    maxGimbalAngle: 5, // ±5° gimbal range
    gimbalRate: 30, // 30°/s gimbal speed

    // DACS thrusters
    dacsThrustPulse: 50, // 50N side thrusters
    dacsImpulseBudget: 300, // 300 N·s total
    minPulseDuration: 20, // 20ms minimum pulse

    // Control gains
    proportionalGain: 2.0,
    derivativeGain: 0.5,
    maxAngularAccel: 15, // 15 rad/s²
  };

  constructor(config: Partial<ThrustControlConfig> = {}) {
    this.config = { ...ThrustVectorControl.TAMIR_CONFIG, ...config };
    this.thrustStartTime = Date.now();
    this.currentThrust = this.config.maxThrust;
    this.gimbalAngle = new THREE.Vector2(0, 0);
    this.dacsRemainingImpulse = this.config.dacsImpulseBudget;
  }

  /**
   * Calculate thrust vector based on guidance commands
   */
  calculateThrustVector(
    currentVelocity: THREE.Vector3,
    desiredAcceleration: THREE.Vector3,
    currentTime: number
  ): {
    thrustVector: THREE.Vector3;
    thrustMagnitude: number;
    gimbalCommand: THREE.Vector2;
    dacsCommand: THREE.Vector3;
  } {
    const dt = currentTime - this.lastControlTime;
    this.lastControlTime = currentTime;

    // Calculate main motor thrust
    const burnTime = (currentTime - this.thrustStartTime) / 1000;
    const thrustMagnitude = this.calculateThrustProfile(burnTime);

    if (thrustMagnitude <= 0) {
      // Motor burnout - use DACS only
      return this.calculateDACSControl(currentVelocity, desiredAcceleration, dt);
    }

    // For a rocket, thrust is always along the body axis (forward direction)
    // We use gimbal to deflect this thrust slightly
    const velocityDir = currentVelocity.clone().normalize();

    // If velocity is too low, use desired acceleration as forward direction
    const forwardDir =
      currentVelocity.length() > 5 ? velocityDir : desiredAcceleration.clone().normalize();

    // Calculate gimbal angles needed to achieve desired acceleration
    const gimbalCommand = this.calculateGimbalAngles(
      forwardDir,
      desiredAcceleration.clone().normalize(),
      dt
    );

    // Apply gimbal limits
    this.updateGimbalPosition(gimbalCommand, dt);

    // Calculate actual thrust vector with gimbal
    // Thrust starts along velocity vector and is deflected by gimbal
    const thrustVector = this.applyGimbalToThrust(forwardDir, this.gimbalAngle).multiplyScalar(
      thrustMagnitude
    );

    // Calculate if DACS is needed for fine control
    const dacsCommand = this.calculateDACSAssist(
      thrustVector,
      desiredAcceleration,
      thrustMagnitude
    );

    return {
      thrustVector,
      thrustMagnitude,
      gimbalCommand: this.gimbalAngle,
      dacsCommand,
    };
  }

  /**
   * Calculate thrust profile over time (thrust vs burn time curve)
   */
  private calculateThrustProfile(burnTime: number): number {
    if (burnTime < 0 || burnTime > this.config.thrustDuration) {
      return 0; // Motor off
    }

    // Regressive burn profile (common for solid motors)
    // Starts at max thrust, decreases over time
    const burnFraction = burnTime / this.config.thrustDuration;

    if (burnFraction < 0.1) {
      // Initial thrust buildup
      return this.config.maxThrust * (burnFraction * 10);
    } else if (burnFraction < 0.8) {
      // Sustained burn phase
      return this.config.maxThrust * (1 - 0.2 * (burnFraction - 0.1));
    } else {
      // Tail-off phase
      return this.config.maxThrust * 0.86 * (1 - burnFraction) * 5;
    }
  }

  /**
   * Calculate required gimbal angles for desired acceleration
   */
  private calculateGimbalAngles(
    currentDir: THREE.Vector3,
    desiredDir: THREE.Vector3,
    dt: number
  ): THREE.Vector2 {
    // Calculate angle between current and desired direction
    const dot = currentDir.dot(desiredDir);
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));

    if (angle < 0.001) {
      return new THREE.Vector2(0, 0); // Already aligned
    }

    // Calculate rotation axis
    const rotationAxis = currentDir.clone().cross(desiredDir).normalize();

    // Convert to gimbal angles (pitch and yaw)
    // Assuming Z is forward, Y is up, X is right
    const pitch = Math.asin(rotationAxis.x) * this.config.proportionalGain;
    const yaw = Math.asin(-rotationAxis.y) * this.config.proportionalGain;

    return new THREE.Vector2(pitch, yaw);
  }

  /**
   * Update gimbal position with rate limits
   */
  private updateGimbalPosition(command: THREE.Vector2, dt: number): void {
    const maxChange = ((this.config.gimbalRate * Math.PI) / 180) * dt;

    // Apply rate limits
    const pitchChange = Math.max(-maxChange, Math.min(maxChange, command.x - this.gimbalAngle.x));
    const yawChange = Math.max(-maxChange, Math.min(maxChange, command.y - this.gimbalAngle.y));

    this.gimbalAngle.x += pitchChange;
    this.gimbalAngle.y += yawChange;

    // Apply angle limits
    const maxAngleRad = (this.config.maxGimbalAngle * Math.PI) / 180;
    this.gimbalAngle.x = Math.max(-maxAngleRad, Math.min(maxAngleRad, this.gimbalAngle.x));
    this.gimbalAngle.y = Math.max(-maxAngleRad, Math.min(maxAngleRad, this.gimbalAngle.y));
  }

  /**
   * Apply gimbal angles to thrust vector
   */
  private applyGimbalToThrust(nominalDir: THREE.Vector3, gimbal: THREE.Vector2): THREE.Vector3 {
    // Create rotation from gimbal angles
    const pitchQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), gimbal.x);
    const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), gimbal.y);

    // Apply rotations
    const result = nominalDir.clone();
    result.applyQuaternion(pitchQuat);
    result.applyQuaternion(yawQuat);

    return result.normalize();
  }

  /**
   * Calculate DACS control for fine adjustments
   */
  private calculateDACSAssist(
    mainThrust: THREE.Vector3,
    desiredAccel: THREE.Vector3,
    thrustMag: number
  ): THREE.Vector3 {
    if (this.dacsRemainingImpulse <= 0) {
      return new THREE.Vector3(0, 0, 0); // No DACS fuel left
    }

    // Calculate lateral acceleration needed
    const lateralAccel = desiredAccel.clone().sub(
      mainThrust
        .clone()
        .normalize()
        .multiplyScalar(desiredAccel.dot(mainThrust) / thrustMag)
    );

    const lateralMag = lateralAccel.length();
    if (lateralMag < 0.1) {
      return new THREE.Vector3(0, 0, 0); // Not needed
    }

    // Determine DACS thrust needed
    const dacsThrust = lateralAccel
      .normalize()
      .multiplyScalar(Math.min(this.config.dacsThrustPulse, lateralMag * 10));

    return dacsThrust;
  }

  /**
   * Calculate control when main motor is off
   */
  private calculateDACSControl(
    currentVelocity: THREE.Vector3,
    desiredAcceleration: THREE.Vector3,
    dt: number
  ): {
    thrustVector: THREE.Vector3;
    thrustMagnitude: number;
    gimbalCommand: THREE.Vector2;
    dacsCommand: THREE.Vector3;
  } {
    if (this.dacsRemainingImpulse <= 0) {
      return {
        thrustVector: new THREE.Vector3(0, 0, 0),
        thrustMagnitude: 0,
        gimbalCommand: new THREE.Vector2(0, 0),
        dacsCommand: new THREE.Vector3(0, 0, 0),
      };
    }

    // Use DACS for terminal guidance
    const accelMag = desiredAcceleration.length();
    const thrustNeeded = Math.min(this.config.dacsThrustPulse, accelMag * 10);

    const dacsCommand = desiredAcceleration.clone().normalize().multiplyScalar(thrustNeeded);

    // Update remaining impulse
    this.dacsRemainingImpulse -= thrustNeeded * dt;

    return {
      thrustVector: new THREE.Vector3(0, 0, 0),
      thrustMagnitude: 0,
      gimbalCommand: new THREE.Vector2(0, 0),
      dacsCommand,
    };
  }

  /**
   * Apply forces to physics body
   */
  applyForces(body: CANNON.Body, thrustVector: THREE.Vector3, dacsCommand: THREE.Vector3): void {
    // Apply main thrust
    if (thrustVector.length() > 0) {
      const force = new CANNON.Vec3(thrustVector.x, thrustVector.y, thrustVector.z);
      body.applyForce(force, body.position);
    }

    // Apply DACS thrust
    if (dacsCommand.length() > 0 && this.dacsRemainingImpulse > 0) {
      const dacsForce = new CANNON.Vec3(dacsCommand.x, dacsCommand.y, dacsCommand.z);
      body.applyForce(dacsForce, body.position);

      debug.category(
        'TVC',
        `DACS pulse: ${dacsCommand.length().toFixed(1)}N, remaining: ${this.dacsRemainingImpulse.toFixed(0)}Ns`
      );
    }
  }

  /**
   * Get current motor status
   */
  getStatus(): {
    motorActive: boolean;
    thrustLevel: number;
    gimbalAngles: THREE.Vector2;
    dacsRemaining: number;
    burnTimeRemaining: number;
  } {
    const burnTime = (Date.now() - this.thrustStartTime) / 1000;
    const motorActive = burnTime < this.config.thrustDuration;

    return {
      motorActive,
      thrustLevel: this.currentThrust / this.config.maxThrust,
      gimbalAngles: this.gimbalAngle.clone(),
      dacsRemaining: this.dacsRemainingImpulse / this.config.dacsImpulseBudget,
      burnTimeRemaining: Math.max(0, this.config.thrustDuration - burnTime),
    };
  }
}
