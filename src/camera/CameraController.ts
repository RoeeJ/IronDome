import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Threat } from '../entities/Threat';
import { Projectile } from '../entities/Projectile';
import { IronDomeBattery } from '../entities/IronDomeBattery';
import { debug } from '../utils/logger';

export enum CameraMode {
  ORBIT = 'orbit',
  FOLLOW_THREAT = 'follow_threat',
  FOLLOW_INTERCEPTOR = 'follow_interceptor',
  CINEMATIC = 'cinematic',
  TACTICAL = 'tactical',
  BATTLE_OVERVIEW = 'battle_overview',
  FIRST_PERSON = 'first_person',
}

interface CameraTransition {
  startPosition: THREE.Vector3;
  endPosition: THREE.Vector3;
  startTarget: THREE.Vector3;
  endTarget: THREE.Vector3;
  startTime: number;
  duration: number;
  easing: (t: number) => number;
}

export class CameraController {
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private currentMode: CameraMode = CameraMode.ORBIT;
  private followTarget: Threat | Projectile | IronDomeBattery | null = null;
  private smoothedTargetPosition: THREE.Vector3 = new THREE.Vector3();
  private smoothedLookAtTarget: THREE.Vector3 = new THREE.Vector3(); // Separate smoothed lookAt target
  private targetVelocity: THREE.Vector3 = new THREE.Vector3(); // Smoothed velocity for prediction
  private isFirstFollowUpdate: boolean = true;
  private targetSmoothingFactor: number = 0.08; // Much lower for gliding motion
  private lookAtSmoothingFactor: number = 0.12; // Smoother lookAt transitions
  private velocitySmoothingFactor: number = 0.15; // Smooth velocity changes
  private transition: CameraTransition | null = null;
  private cinematicPath: THREE.CatmullRomCurve3 | null = null;
  private cinematicProgress: number = 0;
  private cinematicSpeed: number = 0.1;
  private desiredMode: CameraMode = CameraMode.ORBIT; // Mode to switch to when target becomes available
  private modeChangeCallback?: (mode: string) => void;

  // Linger effect after target destruction
  private lingerTimer: number = 0;
  private lingerDuration: number = 1; // Seconds to linger after explosion
  private lingerPosition: THREE.Vector3 = new THREE.Vector3();
  private isLingering: boolean = false;

  // Camera shake
  private shakeIntensity: number = 0;
  private shakeDecay: number = 0.95;
  private originalPosition: THREE.Vector3 = new THREE.Vector3();

  // Smooth follow parameters
  private followOffset: THREE.Vector3 = new THREE.Vector3(30, 20, 30);
  private followSmoothness: number = 0.08; // Very smooth gliding motion
  private lookAheadFactor: number = 0.3; // How much to anticipate movement
  private minVelocityThreshold: number = 1; // Lower threshold for smoother transitions

  // Zoom parameters
  private targetFOV: number = 75;
  private currentFOV: number = 75;
  private zoomSmoothness: number = 0.1;
  private minFOV: number = 20;
  private maxFOV: number = 90;

  // Battle overview parameters
  private battleCenter: THREE.Vector3 = new THREE.Vector3();
  private battleRadius: number = 100;

  constructor(camera: THREE.PerspectiveCamera, controls: OrbitControls) {
    this.camera = camera;
    this.controls = controls;
    this.currentFOV = camera.fov;
    this.targetFOV = camera.fov;
  }

  setMode(mode: CameraMode, target?: Threat | Projectile | IronDomeBattery) {
    if (mode === this.currentMode && target === this.followTarget) return;

    const previousMode = this.currentMode;
    this.currentMode = mode;
    this.desiredMode = mode;
    this.followTarget = target || null;

    // Reset cinematic progress
    this.cinematicProgress = 0;

    // Set up mode-specific parameters
    switch (mode) {
      case CameraMode.ORBIT:
        this.controls.enabled = true;
        this.targetFOV = 75;
        break;

      case CameraMode.FOLLOW_THREAT:
      case CameraMode.FOLLOW_INTERCEPTOR:
        this.controls.enabled = false;
        this.isFirstFollowUpdate = true; // Reset smoothing on mode switch
        this.targetFOV = mode === CameraMode.FOLLOW_INTERCEPTOR ? 70 : 60; // Wider FOV for fast interceptors
        if (!target) {
          debug.warn('No target specified for follow mode');
          this.setMode(CameraMode.ORBIT);
        } else if ('getPosition' in target) {
          // Initialize smoothed positions to target's current position
          const pos = target.getPosition();
          this.smoothedTargetPosition.copy(pos);
          this.smoothedLookAtTarget.copy(pos);
          this.isLingering = false; // Cancel any lingering when switching targets
        }
        break;

      case CameraMode.FIRST_PERSON:
        this.controls.enabled = false;
        this.targetFOV = 90;
        if (!target) {
          debug.warn('No target specified for first person mode');
          this.setMode(CameraMode.ORBIT);
        }
        break;

      case CameraMode.CINEMATIC:
        this.controls.enabled = false;
        this.targetFOV = 50;
        this.setupCinematicPath();
        break;

      case CameraMode.TACTICAL:
        this.controls.enabled = false;
        this.targetFOV = 45;
        this.transitionToPosition(new THREE.Vector3(0, 200, 100), new THREE.Vector3(0, 0, 0), 2000);
        break;

      case CameraMode.BATTLE_OVERVIEW:
        this.controls.enabled = false;
        this.targetFOV = 65;
        break;
    }

    debug.log(`Camera mode changed from ${previousMode} to ${mode}`);
  }

  private setupCinematicPath() {
    // Create a smooth path around the battlefield
    const points = [
      new THREE.Vector3(150, 80, 150),
      new THREE.Vector3(0, 120, 200),
      new THREE.Vector3(-150, 80, 150),
      new THREE.Vector3(-200, 60, 0),
      new THREE.Vector3(-150, 80, -150),
      new THREE.Vector3(0, 120, -200),
      new THREE.Vector3(150, 80, -150),
      new THREE.Vector3(200, 60, 0),
      new THREE.Vector3(150, 80, 150), // Loop back
    ];

    this.cinematicPath = new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.5);
  }

  update(deltaTime: number, threats: Threat[], interceptors: Projectile[]) {
    // Remove excessive debug logging

    // Check if we need to find a new target or switch modes
    this.checkTargetValidity(threats, interceptors);

    // Update zoom
    this.currentFOV += (this.targetFOV - this.currentFOV) * this.zoomSmoothness;
    this.camera.fov = this.currentFOV;
    this.camera.updateProjectionMatrix();

    // Update camera shake
    if (this.shakeIntensity > 0.01) {
      const shakeX = (Math.random() - 0.5) * this.shakeIntensity;
      const shakeY = (Math.random() - 0.5) * this.shakeIntensity;
      const shakeZ = (Math.random() - 0.5) * this.shakeIntensity;

      this.camera.position.add(new THREE.Vector3(shakeX, shakeY, shakeZ));
      this.shakeIntensity *= this.shakeDecay;
    }

    // Handle transitions
    if (this.transition) {
      const elapsed = Date.now() - this.transition.startTime;
      const progress = Math.min(elapsed / this.transition.duration, 1);
      const easedProgress = this.transition.easing(progress);

      this.camera.position.lerpVectors(
        this.transition.startPosition,
        this.transition.endPosition,
        easedProgress
      );

      const currentTarget = new THREE.Vector3().lerpVectors(
        this.transition.startTarget,
        this.transition.endTarget,
        easedProgress
      );

      this.camera.lookAt(currentTarget);

      if (progress >= 1) {
        this.transition = null;
        if (this.currentMode === CameraMode.ORBIT) {
          this.controls.target.copy(currentTarget);
        }
      }
      return;
    }

    // Update based on current mode
    switch (this.currentMode) {
      case CameraMode.FOLLOW_THREAT:
      case CameraMode.FOLLOW_INTERCEPTOR:
        this.updateFollowMode(deltaTime);
        break;

      case CameraMode.FIRST_PERSON:
        this.updateFirstPersonMode();
        break;

      case CameraMode.CINEMATIC:
        this.updateCinematicMode(deltaTime);
        break;

      case CameraMode.BATTLE_OVERVIEW:
        this.updateBattleOverview(threats, interceptors);
        break;

      case CameraMode.TACTICAL:
        // Static tactical view, no updates needed
        break;
    }
  }

  private updateFollowMode(deltaTime: number) {
    // Handle lingering after explosion
    if (this.isLingering) {
      this.lingerTimer -= deltaTime;

      // Continue looking at the explosion position with slight drift
      const driftOffset = new THREE.Vector3(
        Math.sin(this.lingerTimer * 2) * 0.5,
        Math.cos(this.lingerTimer * 3) * 0.3,
        Math.sin(this.lingerTimer * 1.5) * 0.5
      );

      this.camera.lookAt(this.lingerPosition.clone().add(driftOffset));

      // Slowly pull camera back during linger
      const pullbackSpeed = 0.02;
      const currentDir = this.camera.position.clone().sub(this.lingerPosition).normalize();
      this.camera.position.add(currentDir.multiplyScalar(pullbackSpeed));

      if (this.lingerTimer <= 0) {
        this.isLingering = false;
        debug.log('Linger complete, searching for new target...');
        // Will find new target on next update
      }
      return;
    }

    if (!this.followTarget || !('getPosition' in this.followTarget)) {
      // No target - camera stays at current position
      return;
    }

    const targetPos = this.followTarget.getPosition();
    const targetVel =
      'getVelocity' in this.followTarget ? this.followTarget.getVelocity() : new THREE.Vector3();

    // If it's the first frame of following, snap everything to the target's position
    if (this.isFirstFollowUpdate) {
      this.smoothedTargetPosition.copy(targetPos);
      this.smoothedLookAtTarget.copy(targetPos);
      this.targetVelocity.copy(targetVel);
      this.isFirstFollowUpdate = false;
    } else {
      // Smooth the velocity for more stable predictions
      this.targetVelocity.lerp(targetVel, this.velocitySmoothingFactor);

      // Calculate predicted position based on smoothed velocity
      const predictedPos = targetPos
        .clone()
        .add(this.targetVelocity.clone().multiplyScalar(this.lookAheadFactor * deltaTime));

      // Glide smoothly to the predicted position
      this.smoothedTargetPosition.lerp(predictedPos, this.targetSmoothingFactor);

      // Even smoother lookAt target for stable orientation
      this.smoothedLookAtTarget.lerp(predictedPos, this.lookAtSmoothingFactor);
    }

    // Remove excessive debug logging

    // Calculate camera position based on smoothed velocity direction
    const speed = this.targetVelocity.length();
    let desiredPosition: THREE.Vector3;

    if (speed > this.minVelocityThreshold) {
      // Dynamic camera distance based on speed
      const baseBehindDistance = this.currentMode === CameraMode.FOLLOW_INTERCEPTOR ? 20 : 10;
      const speedFactor = Math.min(speed / 50, 2); // Scale with speed up to 2x
      const behindDistance = baseBehindDistance * (1 + speedFactor * 0.3);

      // Position camera behind based on smoothed velocity direction
      const velocityDir = this.targetVelocity.clone().normalize();
      const cameraOffset = velocityDir.multiplyScalar(-behindDistance);

      // Small lateral offset for slight cinematic angle (reduced from 3 to 0.5)
      const lateralOffset = new THREE.Vector3(-velocityDir.z, 0, velocityDir.x).multiplyScalar(0.5);

      desiredPosition = this.smoothedTargetPosition.clone().add(cameraOffset).add(lateralOffset);

      // Dynamic vertical offset based on trajectory
      const verticalOffset = this.currentMode === CameraMode.FOLLOW_INTERCEPTOR ? 8 : 4;
      const trajectoryAngle = Math.atan2(
        this.targetVelocity.y,
        Math.sqrt(this.targetVelocity.x ** 2 + this.targetVelocity.z ** 2)
      );
      desiredPosition.y += verticalOffset * (1 + Math.sin(trajectoryAngle) * 0.5);
    } else {
      // Default position when stationary
      const behindDistance = 12;
      const verticalOffset = 6;
      desiredPosition = this.smoothedTargetPosition
        .clone()
        .add(new THREE.Vector3(5, verticalOffset, -behindDistance));
    }

    // Glide camera to desired position
    this.camera.position.lerp(desiredPosition, this.followSmoothness);

    // Look slightly ahead of the smoothed target
    const lookAheadPos = this.smoothedLookAtTarget.clone();
    if (speed > this.minVelocityThreshold) {
      lookAheadPos.add(this.targetVelocity.clone().normalize().multiplyScalar(5));
    }

    this.camera.lookAt(lookAheadPos);
  }

  private updateFirstPersonMode() {
    if (!this.followTarget || !('getPosition' in this.followTarget)) return;

    const targetPos = this.followTarget.getPosition();

    // Position camera at the target location
    this.camera.position.copy(targetPos);

    // Look in the direction of movement if it's a projectile
    if ('getVelocity' in this.followTarget) {
      const velocity = this.followTarget.getVelocity();
      if (velocity.length() > 0.1) {
        const lookTarget = targetPos.clone().add(velocity.normalize().multiplyScalar(10));
        this.camera.lookAt(lookTarget);
      }
    }
  }

  private updateCinematicMode(deltaTime: number) {
    if (!this.cinematicPath) return;

    // Update progress along the path
    this.cinematicProgress += this.cinematicSpeed * deltaTime;
    if (this.cinematicProgress > 1) this.cinematicProgress -= 1;

    // Get position on path
    const position = this.cinematicPath.getPoint(this.cinematicProgress);
    this.camera.position.copy(position);

    // Look towards center with some variation
    const lookOffset = new THREE.Vector3(
      Math.sin(this.cinematicProgress * Math.PI * 4) * 20,
      0,
      Math.cos(this.cinematicProgress * Math.PI * 4) * 20
    );
    this.camera.lookAt(lookOffset);
  }

  private updateBattleOverview(threats: Threat[], interceptors: Projectile[]) {
    // Calculate battle bounds
    let minX = Infinity,
      maxX = -Infinity;
    let minZ = Infinity,
      maxZ = -Infinity;
    let maxY = 0;

    const updateBounds = (pos: THREE.Vector3) => {
      minX = Math.min(minX, pos.x);
      maxX = Math.max(maxX, pos.x);
      minZ = Math.min(minZ, pos.z);
      maxZ = Math.max(maxZ, pos.z);
      maxY = Math.max(maxY, pos.y);
    };

    threats.forEach(threat => updateBounds(threat.getPosition()));
    interceptors.forEach(interceptor => updateBounds(interceptor.getPosition()));

    // Calculate center and radius
    if (threats.length > 0 || interceptors.length > 0) {
      this.battleCenter.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);

      this.battleRadius =
        Math.max(
          maxX - minX,
          maxZ - minZ,
          maxY * 2,
          50 // Minimum radius
        ) * 0.6;

      // Position camera to show entire battle
      const elevation = Math.max(this.battleRadius * 0.8, maxY + 50);
      const distance = this.battleRadius * 1.5;

      const desiredPosition = new THREE.Vector3(
        this.battleCenter.x + distance * 0.7,
        elevation,
        this.battleCenter.z + distance * 0.7
      );

      this.camera.position.lerp(desiredPosition, 0.05);
      this.camera.lookAt(this.battleCenter);

      // Adjust FOV based on battle size
      this.targetFOV = THREE.MathUtils.clamp(45 + (this.battleRadius / 200) * 20, 45, 65);
    }
  }

  transitionToPosition(position: THREE.Vector3, target: THREE.Vector3, duration: number = 1000) {
    this.transition = {
      startPosition: this.camera.position.clone(),
      endPosition: position.clone(),
      startTarget: new THREE.Vector3(),
      endTarget: target.clone(),
      startTime: Date.now(),
      duration,
      easing: this.easeInOutCubic,
    };

    // Get current look-at target
    this.camera.getWorldDirection(this.transition.startTarget);
    this.transition.startTarget.multiplyScalar(10).add(this.camera.position);
  }

  shake(intensity: number) {
    this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
    this.originalPosition.copy(this.camera.position);
  }

  zoom(delta: number) {
    this.targetFOV = THREE.MathUtils.clamp(this.targetFOV - delta * 10, this.minFOV, this.maxFOV);
  }

  setFollowOffset(offset: THREE.Vector3) {
    this.followOffset.copy(offset);
  }

  setCinematicSpeed(speed: number) {
    this.cinematicSpeed = THREE.MathUtils.clamp(speed, 0.01, 1);
  }

  private easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  getCurrentMode(): CameraMode {
    return this.currentMode;
  }

  getFollowTarget(): Threat | Projectile | IronDomeBattery | null {
    return this.followTarget;
  }

  setModeChangeCallback(callback: (mode: string) => void): void {
    this.modeChangeCallback = callback;
  }

  private checkTargetValidity(threats: Threat[], interceptors: Projectile[]): void {
    // Check if we're already lingering
    if (this.isLingering) {
      return; // Continue lingering, don't check for new targets
    }

    // Check if current target is still valid FIRST before reassigning
    if (this.followTarget && 'isActive' in this.followTarget && !this.followTarget.isActive) {
      // Target just became inactive - start lingering at explosion location
      if (
        this.currentMode === CameraMode.FOLLOW_INTERCEPTOR ||
        this.currentMode === CameraMode.FOLLOW_THREAT
      ) {
        this.isLingering = true;
        this.lingerTimer = this.lingerDuration;
        this.lingerPosition.copy(this.smoothedTargetPosition);
        this.followTarget = null; // Clear target so we don't keep checking it
        debug.log(
          `Target destroyed! Starting linger effect at explosion location for ${this.lingerDuration}s`
        );
        return; // Don't switch targets while lingering
      }
    }

    // Now check if we need a new target (no target or need initial target)
    if (
      this.currentMode === CameraMode.FOLLOW_INTERCEPTOR &&
      (!this.followTarget || !('isActive' in this.followTarget))
    ) {
      const activeInterceptors = interceptors.filter(i => i.isActive);
      if (activeInterceptors.length > 0) {
        this.followTarget = activeInterceptors[0];
        this.isFirstFollowUpdate = true; // Reset smoothing for new target
      } else {
        // Stay in follow mode but with no target - camera will remain at last position
        this.followTarget = null;
        return;
      }
    }

    // Handle other follow modes similarly
    if (this.followTarget && 'isActive' in this.followTarget) {
      if (!this.followTarget.isActive) {
        debug.log(`Current ${this.desiredMode} target destroyed, looking for replacement...`);
        // Target destroyed, find new target based on desired mode
        switch (this.desiredMode) {
          case CameraMode.FOLLOW_THREAT:
            const newThreat = threats.find(t => t.isActive);
            if (newThreat) {
              this.followTarget = newThreat;
              debug.log('Switched to new threat target');
            } else {
              // No threats available, stay in follow mode waiting
              debug.log('No threats available, waiting for new threats...');
            }
            break;

          case CameraMode.FOLLOW_INTERCEPTOR:
            const activeInterceptors = interceptors.filter(i => i.isActive);
            const newInterceptor = activeInterceptors[0];
            if (newInterceptor) {
              this.followTarget = newInterceptor;
            }
            break;

          case CameraMode.FIRST_PERSON:
            // Try interceptor first, then threat
            const fpInterceptor = interceptors.find(i => i.isActive);
            if (fpInterceptor) {
              this.followTarget = fpInterceptor;
            } else {
              const fpThreat = threats.find(t => t.isActive);
              if (fpThreat) {
                this.followTarget = fpThreat;
              } else {
                // Nothing to follow, stay in first person mode waiting
                debug.log('No targets for first person view, waiting...');
              }
            }
            break;
        }
      }
    }

    // Check if we need to find a target (either waiting in orbit mode or just finished lingering)
    if (
      (this.currentMode === CameraMode.ORBIT && this.desiredMode !== CameraMode.ORBIT) ||
      (this.followTarget === null &&
        !this.isLingering &&
        (this.currentMode === CameraMode.FOLLOW_INTERCEPTOR ||
          this.currentMode === CameraMode.FOLLOW_THREAT))
    ) {
      switch (this.desiredMode) {
        case CameraMode.FOLLOW_THREAT:
          const threat = threats.find(t => t.isActive);
          if (threat) {
            this.followTarget = threat;
            this.currentMode = this.desiredMode;
            this.controls.enabled = false;
            if (this.modeChangeCallback) {
              this.modeChangeCallback(this.currentMode);
            }
            debug.log('Found threat to follow');
          }
          break;

        case CameraMode.FOLLOW_INTERCEPTOR:
          const interceptor = interceptors.find(i => i.isActive);
          if (interceptor) {
            this.followTarget = interceptor;
            this.currentMode = this.desiredMode;
            this.controls.enabled = false;
            if (this.modeChangeCallback) {
              this.modeChangeCallback(this.currentMode);
            }
            debug.log('Found interceptor to follow');
          }
          break;

        case CameraMode.FIRST_PERSON:
          const fpTarget = interceptors.find(i => i.isActive) || threats.find(t => t.isActive);
          if (fpTarget) {
            this.followTarget = fpTarget;
            this.currentMode = this.desiredMode;
            this.controls.enabled = false;
            if (this.modeChangeCallback) {
              this.modeChangeCallback(this.currentMode);
            }
            debug.log('Found target for first person view');
          }
          break;
      }
    }
  }

  setDesiredMode(mode: CameraMode): void {
    this.desiredMode = mode;
  }
}
