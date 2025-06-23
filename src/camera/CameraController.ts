import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Threat } from '../entities/Threat';
import { Projectile } from '../entities/Projectile';
import { IronDomeBattery } from '../entities/IronDomeBattery';
import { debug } from '../utils/DebugLogger';

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
  private transition: CameraTransition | null = null;
  private cinematicPath: THREE.CatmullRomCurve3 | null = null;
  private cinematicProgress: number = 0;
  private cinematicSpeed: number = 0.1;
  private desiredMode: CameraMode = CameraMode.ORBIT; // Mode to switch to when target becomes available
  private modeChangeCallback?: (mode: string) => void;

  // Camera shake
  private shakeIntensity: number = 0;
  private shakeDecay: number = 0.95;
  private originalPosition: THREE.Vector3 = new THREE.Vector3();

  // Smooth follow parameters
  private followOffset: THREE.Vector3 = new THREE.Vector3(30, 20, 30);
  private followSmoothness: number = 0.1;
  private lookAheadFactor: number = 0.5;
  private minVelocityThreshold: number = 5; // Minimum velocity to consider for direction

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
        this.targetFOV = mode === CameraMode.FOLLOW_INTERCEPTOR ? 70 : 60; // Wider FOV for fast interceptors
        if (!target) {
          debug.warn('No target specified for follow mode');
          this.setMode(CameraMode.ORBIT);
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
    // Debug log interceptor count periodically
    if (
      Math.random() < 0.02 &&
      (this.currentMode === CameraMode.FOLLOW_INTERCEPTOR ||
        this.desiredMode === CameraMode.FOLLOW_INTERCEPTOR)
    ) {
      debug.log(
        `Camera update - Active interceptors: ${interceptors.filter(i => i.isActive).length}, Total: ${interceptors.length}`
      );
    }

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
    if (!this.followTarget || !('getPosition' in this.followTarget)) {
      // No target - camera stays at current position
      return;
    }

    const targetPos = this.followTarget.getPosition();
    const targetVel =
      'getVelocity' in this.followTarget ? this.followTarget.getVelocity() : new THREE.Vector3();

    // Debug log for interceptor velocity and position
    if (this.currentMode === CameraMode.FOLLOW_INTERCEPTOR) {
      const speed = targetVel.length();
      const targetId = (this.followTarget as any).id || 'unknown';
      if (Math.random() < 0.02) {
        // Log occasionally
        debug.log(
          `Following interceptor ${targetId}: velocity ${speed.toFixed(1)} m/s, pos (${targetPos.x.toFixed(1)}, ${targetPos.y.toFixed(1)}, ${targetPos.z.toFixed(1)})`
        );
      }
    }

    // Calculate look-ahead position
    const lookAhead = targetVel.clone().multiplyScalar(this.lookAheadFactor);
    const desiredTarget = targetPos.clone().add(lookAhead);

    // Calculate desired camera position - follow behind the target
    let desiredPosition: THREE.Vector3;
    const speed = targetVel.length();

    if (speed > this.minVelocityThreshold) {
      // Position camera behind the velocity direction
      const behindDir = targetVel.clone().normalize().multiplyScalar(-40); // Increased distance
      behindDir.y = 20; // Keep camera elevated
      desiredPosition = targetPos.clone().add(behindDir);

      // For fast-moving interceptors, increase smoothness for smoother tracking
      if (this.currentMode === CameraMode.FOLLOW_INTERCEPTOR && speed > 100) {
        this.camera.position.lerp(desiredPosition, this.followSmoothness * 1.5);
      } else {
        this.camera.position.lerp(desiredPosition, this.followSmoothness);
      }
    } else {
      // If not moving or moving slowly, use default offset
      desiredPosition = targetPos.clone().add(this.followOffset);
      this.camera.position.lerp(desiredPosition, this.followSmoothness);
    }

    // Look at target
    // For a tailing camera, we want to look at the target itself or slightly ahead
    this.camera.lookAt(desiredTarget);
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
    // Special handling for follow interceptor - check if we're actually following one
    if (
      this.currentMode === CameraMode.FOLLOW_INTERCEPTOR &&
      (!this.followTarget || !('isActive' in this.followTarget) || !this.followTarget.isActive)
    ) {
      const activeInterceptors = interceptors.filter(i => i.isActive);
      debug.log(
        `Follow interceptor mode but no valid target. Active interceptors: ${activeInterceptors.length}`
      );
      if (activeInterceptors.length > 0) {
        this.followTarget = activeInterceptors[0];
        const interceptorId = (activeInterceptors[0] as any).id || 'unknown';
        debug.log(`Assigned interceptor ${interceptorId} as new target`);
      } else {
        // Stay in follow mode but with no target - camera will remain at last position
        this.followTarget = null;
        debug.log('No interceptors available, waiting in follow mode...');
        return;
      }
    }

    // Check if current target is still valid
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
            debug.log(`Looking for new interceptor. Active count: ${activeInterceptors.length}`);
            const newInterceptor = activeInterceptors[0];
            if (newInterceptor) {
              this.followTarget = newInterceptor;
              const interceptorId = (newInterceptor as any).id || 'unknown';
              debug.log(`Switched to new interceptor target: ${interceptorId}`);
            } else {
              // No interceptors available, stay in follow mode waiting
              debug.log('No active interceptors found, waiting for new interceptors...');
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

    // Check if we're waiting for a target
    if (this.currentMode === CameraMode.ORBIT && this.desiredMode !== CameraMode.ORBIT) {
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
