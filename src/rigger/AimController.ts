import * as THREE from 'three';
import { RigData } from './BoneVisualizer';

export interface AimConstraints {
  yawLimit: number; // Maximum yaw rotation in radians (0 = no limit)
  pitchMin: number; // Minimum pitch angle in radians
  pitchMax: number; // Maximum pitch angle in radians
}

export interface AimInfo {
  angle: number; // Angle to target in degrees
  distance: number; // Distance to target
  yaw: number; // Current yaw in degrees
  pitch: number; // Current pitch in degrees
}

export class AimController {
  private mode: 'manual' | 'look-at' | 'ik' = 'manual';
  private constraints: AimConstraints = {
    yawLimit: 0, // No limit by default
    pitchMin: -Math.PI / 6, // -30 degrees
    pitchMax: Math.PI / 2.4, // 75 degrees
  };
  private smoothing: number = 0.1;
  private lastTargetDistance: number = 0;

  constructor() {}

  setMode(mode: 'manual' | 'look-at' | 'ik'): void {
    this.mode = mode;
  }

  setConstraints(constraints: Partial<AimConstraints>): void {
    this.constraints = { ...this.constraints, ...constraints };
  }

  setSmoothing(smoothing: number): void {
    this.smoothing = Math.max(0, Math.min(1, smoothing));
  }

  setRig(rigData: RigData): void {
    // Not used in simplified version
  }

  updateAim(model: THREE.Object3D, targetPosition: THREE.Vector3, deltaTime: number): void {
    if (this.mode === 'manual') return;

    // Find the key nodes in the model
    const sketchfabModel = model.getObjectByName('Sketchfab_model');
    if (!sketchfabModel) {
      console.warn('No Sketchfab_model found');
      return;
    }

    const rootNode = sketchfabModel.getObjectByName('Root');
    if (!rootNode) {
      console.warn('No Root node found');
      return;
    }

    const barrelNode = rootNode.getObjectByName('Cube001');
    if (!barrelNode) {
      console.warn('No Cube001 barrel found');
      return;
    }

    // Get world positions
    const modelWorldPos = new THREE.Vector3();
    rootNode.getWorldPosition(modelWorldPos);

    // Calculate direction to target
    const direction = new THREE.Vector3().subVectors(targetPosition, modelWorldPos);
    this.lastTargetDistance = direction.length();
    
    // Calculate yaw (horizontal rotation)
    // Project direction onto XZ plane
    const flatDirection = new THREE.Vector3(direction.x, 0, direction.z);
    flatDirection.normalize();
    
    // Calculate angle from +X axis (model's forward)
    const targetYaw = Math.atan2(flatDirection.z, flatDirection.x);
    
    // Apply to Root node
    rootNode.rotation.y = targetYaw;
    
    // Calculate pitch for barrel
    // Get barrel world position after yaw rotation
    const barrelWorldPos = new THREE.Vector3();
    barrelNode.getWorldPosition(barrelWorldPos);
    
    // Direction from barrel to target
    const barrelToTarget = new THREE.Vector3().subVectors(targetPosition, barrelWorldPos);
    barrelToTarget.normalize();
    
    // Calculate pitch angle
    const horizontalDist = Math.sqrt(barrelToTarget.x * barrelToTarget.x + barrelToTarget.z * barrelToTarget.z);
    const targetPitch = Math.atan2(barrelToTarget.y, horizontalDist);
    
    // Apply pitch to barrel
    // The barrel has an initial rotation of -0.49 radians on X
    const initialPitch = -0.49;
    barrelNode.rotation.x = initialPitch + targetPitch;
    
    // Log occasionally
    if (Math.random() < 0.02) {
      console.log('Aiming:', {
        yaw: THREE.MathUtils.radToDeg(targetYaw).toFixed(1),
        pitch: THREE.MathUtils.radToDeg(targetPitch).toFixed(1),
        targetY: targetPosition.y.toFixed(1)
      });
    }
  }

  getAimInfo(): AimInfo | null {
    return {
      angle: 0,
      distance: this.lastTargetDistance,
      yaw: 0,
      pitch: 0
    };
  }

  exportConfig(): any {
    return {
      mode: this.mode,
      constraints: {
        yawLimit: THREE.MathUtils.radToDeg(this.constraints.yawLimit),
        pitchMin: THREE.MathUtils.radToDeg(this.constraints.pitchMin),
        pitchMax: THREE.MathUtils.radToDeg(this.constraints.pitchMax),
      },
      smoothing: this.smoothing,
    };
  }

  importConfig(config: any): void {
    if (config.mode) {
      this.mode = config.mode;
    }

    if (config.constraints) {
      this.constraints = {
        yawLimit: THREE.MathUtils.degToRad(config.constraints.yawLimit || 0),
        pitchMin: THREE.MathUtils.degToRad(config.constraints.pitchMin || -30),
        pitchMax: THREE.MathUtils.degToRad(config.constraints.pitchMax || 75),
      };
    }

    if (config.smoothing !== undefined) {
      this.smoothing = config.smoothing;
    }
  }

  reset(): void {
    // Reset rotations
  }
}