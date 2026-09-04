import { calculateTimeToImpact, calculateImpactPoint } from '@/physics/ballistics';
import { gameplayRandom } from '@/simulation/Random';
import { simulationClock } from '@/simulation/SimulationClock';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Projectile, ProjectileOptions } from './Projectile';
import { GeometryFactory } from '../utils/GeometryFactory';
import { MaterialCache } from '../utils/MaterialCache';
import { MissileModelFactory } from '../utils/MissileModelFactory';

import { ThreatType, ThreatConfig, THREAT_CONFIGS } from './ThreatConfig';
export { ThreatType, THREAT_CONFIGS } from './ThreatConfig';
export type { ThreatConfig } from './ThreatConfig';

export interface ThreatOptions extends Omit<ProjectileOptions, 'color' | 'radius' | 'mass'> {
  type: ThreatType;
  targetPosition: THREE.Vector3;
  useInstancing?: boolean;
  instanceManager?: any;
}

export class Threat extends Projectile {
  type: ThreatType;
  targetPosition: THREE.Vector3;
  launchTime: number;
  impactTime: number | null = null;
  impactPoint: THREE.Vector3 | null = null;
  private config: ThreatConfig;
  private cruisingPhase: boolean = false;
  private maneuverTimer: number = 0;
  private _isBeingIntercepted: boolean = false;

  // New properties for ballistic threats
  private flightPhase: 'boost' | 'midcourse' | 'terminal' = 'boost';
  private phaseTimer: number = 0;
  public shouldDeployPayload: boolean = false;
  private hasPassedApex: boolean = false; // For payload deployment logic

  // Health system for laser damage
  private health: number = 100;
  private maxHealth: number = 100;

  constructor(scene: THREE.Scene, world: CANNON.World, options: ThreatOptions) {
    const config = THREAT_CONFIGS[options.type];

    super(scene, world, {
      ...options,
      color: config.color,
      radius: config.radius,
      mass: config.warheadSize,
      trailLength: config.isDrone ? 50 : 200, // Shorter trail for drones
      useExhaustTrail: !config.isDrone, // No exhaust for drones
      isInterceptor: false,
      useInstancing: options.useInstancing,
      instanceManager: options.instanceManager,
    });

    this.type = options.type;
    this.config = config;
    this.targetPosition = options.targetPosition;
    this.launchTime = simulationClock.nowMs;

    // Calculate impact prediction
    this.calculateImpactPrediction();

    // Replace default sphere mesh with proper missile model
    // Only if not using instancing
    if (!options.useInstancing) {
      this.replaceMeshWithModel(scene, options.type);
    }
    // For instancing, the ThreatManager will handle adding to the instance renderer

    // Set up special physics for drones
    if (config.isDrone) {
      this.body.linearDamping = 0.5; // Moderate air resistance
      this.body.angularDamping = 0.99; // Very high angular damping to prevent rotation
      this.body.type = CANNON.Body.DYNAMIC;
      // Prevent drones from falling too fast
      this.body.mass = config.warheadSize * 0.5; // Lighter than regular projectiles
      // Lock rotation for drones
      this.body.fixedRotation = true;
      this.body.updateMassProperties();
    }

    // Initialize flight phase
    if (this.config.flightStages) {
      this.flightPhase = 'boost';
    } else {
      this.flightPhase = 'midcourse'; // Default for non-staged threats
    }
  }

  private replaceMeshWithModel(scene: THREE.Scene, type: ThreatType): void {
    // Remove default sphere mesh
    if (this.mesh) {
      scene.remove(this.mesh);
      // Don't dispose geometry/material - they're from caches
    }

    // Create new model using factory
    const modelFactory = MissileModelFactory.getInstance();
    this.mesh = modelFactory.createThreatModel(type, this.config);
    this.mesh.position.copy(this.getPosition());
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
  }

  private calculateImpactPrediction(): void {
    const position = this.getPosition(),
      velocity = this.getVelocity();
    const remaining = calculateTimeToImpact(position, velocity);
    this.impactTime = remaining === null ? null : simulationClock.nowMs + remaining * 1000;
    this.impactPoint = calculateImpactPoint(position, velocity);
  }

  getTimeToImpact(): number {
    // For drones, return a constant positive value since they don't follow ballistic trajectories
    if (this.config.isDrone) {
      // Estimate based on distance to target and speed
      const currentPos = this.getPosition();
      const distance = currentPos.distanceTo(this.targetPosition);
      const speed = this.getVelocity().length();
      if (speed > 0) {
        return distance / speed;
      }
      return 30; // Default 30 seconds if not moving
    }

    this.calculateImpactPrediction();
    if (this.impactTime === null) return -1;
    return Math.max(0, (this.impactTime - simulationClock.nowMs) / 1000);
  }

  getImpactPoint(): THREE.Vector3 | null {
    if (this.config.isDrone) return this.targetPosition.clone();
    this.calculateImpactPrediction();
    return this.impactPoint;
  }

  private updateDroneBehavior(deltaTime: number): void {
    const currentPos = this.getPosition();
    const targetDir = new THREE.Vector3().subVectors(this.targetPosition, currentPos);

    const horizontalDistance = Math.sqrt(targetDir.x * targetDir.x + targetDir.z * targetDir.z);

    // For drones, we want to maintain altitude while moving toward target
    if (this.config.cruiseAltitude) {
      // Calculate altitude error
      const altitudeError = this.config.cruiseAltitude - currentPos.y;

      // Apply vertical force to maintain altitude
      const liftForce = altitudeError * 10 + 15; // Proportional control + constant lift
      const lift = new CANNON.Vec3(0, liftForce, 0);
      this.body.applyForce(lift);

      // Also limit downward velocity to prevent falling
      if (this.body.velocity.y < -10) {
        this.body.velocity.y = -10;
      }

      // If close to target horizontally, start aggressive descent
      if (horizontalDistance < 30) {
        // Reduced from 50 to 30 for more aggressive dive
        // Override altitude maintenance and dive toward target
        const diveDir = new THREE.Vector3().subVectors(this.targetPosition, currentPos).normalize();

        // Strong dive force to ensure drone reaches target
        const diveForce = new CANNON.Vec3(
          diveDir.x * 50,
          -50, // Strong downward force
          diveDir.z * 50
        );
        this.body.applyForce(diveForce);

        // Also directly adjust velocity to ensure descent
        if (this.body.velocity.y > -20) {
          this.body.velocity.y = -20;
        }
      } else {
        // Normal flight - maintain altitude and move toward target
        targetDir.y = 0; // Ignore vertical component for horizontal movement
        targetDir.normalize();

        // Apply horizontal steering force
        const steerForce = new CANNON.Vec3(targetDir.x * 20, 0, targetDir.z * 20);
        this.body.applyForce(steerForce);

        // Ensure minimum forward speed
        const currentSpeed = Math.sqrt(
          this.body.velocity.x * this.body.velocity.x + this.body.velocity.z * this.body.velocity.z
        );
        if (currentSpeed < this.config.velocity * 0.5) {
          // Apply forward thrust
          const thrust = new CANNON.Vec3(
            targetDir.x * this.config.velocity * 0.3,
            0,
            targetDir.z * this.config.velocity * 0.3
          );
          this.body.applyForce(thrust);
        }

        // Add some random maneuvering
        this.maneuverTimer += deltaTime;
        if (this.config.maneuverability && this.maneuverTimer > 0.5) {
          const maneuver = new CANNON.Vec3(
            (gameplayRandom.next() - 0.5) * this.config.maneuverability * 10,
            0,
            (gameplayRandom.next() - 0.5) * this.config.maneuverability * 10
          );
          this.body.applyForce(maneuver);
          this.maneuverTimer = 0;
        }
      }

      // Limit maximum velocity to configured speed
      const velocity = this.body.velocity;
      const speed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
      if (speed > this.config.velocity) {
        const scale = this.config.velocity / speed;
        this.body.velocity.x *= scale;
        this.body.velocity.z *= scale;
      }
    }
  }

  private updateCruiseMissileBehavior(): void {
    const currentPos = this.getPosition();
    const velocity = this.getVelocity();

    // Terrain following - maintain low altitude
    if (currentPos.y > this.config.cruiseAltitude!) {
      // Dive down to cruise altitude
      const diveForce = new CANNON.Vec3(0, -50, 0);
      this.body.applyForce(diveForce);
    } else if (currentPos.y < this.config.cruiseAltitude! * 0.8) {
      // Pull up if too low
      const liftForce = new CANNON.Vec3(0, 100, 0);
      this.body.applyForce(liftForce);
    }

    // Terminal guidance when close to target
    const distanceToTarget = currentPos.distanceTo(this.targetPosition);
    if (distanceToTarget < 1000) {
      const targetDir = new THREE.Vector3().subVectors(this.targetPosition, currentPos).normalize();

      // Proportional navigation
      const navForce = new CANNON.Vec3(targetDir.x * 200, targetDir.y * 200, targetDir.z * 200);
      this.body.applyForce(navForce);
    }
  }

  private updateBallisticBehavior(deltaTime: number): void {
    if (!this.config.flightStages) return;

    this.phaseTimer += deltaTime;

    switch (this.flightPhase) {
      case 'boost':
        // Apply thrust along velocity vector
        const thrustForce = this.getVelocity()
          .normalize()
          .multiplyScalar(this.config.flightStages.boost.thrust);
        this.body.applyForce(new CANNON.Vec3(thrustForce.x, thrustForce.y, thrustForce.z));

        if (this.phaseTimer >= this.config.flightStages.boost.duration) {
          this.flightPhase = 'midcourse';
          this.phaseTimer = 0;
        }
        break;

      case 'midcourse':
        // Coasting phase (gravity is already applied by physics engine)
        // Check for apex to deploy payload
        if (this.config.payload && this.getVelocity().y <= 0 && !this.shouldDeployPayload) {
          this.shouldDeployPayload = true;
          this.flightPhase = 'terminal'; // Move to terminal after payload deployment
        } else if (this.getVelocity().y <= 0) {
          this.flightPhase = 'terminal';
        }
        break;

      case 'terminal':
        // The main bus of the ballistic missile does not have a terminal guidance phase.
        // It deploys its payload and then becomes inert, following a ballistic trajectory
        // until it's removed from the simulation. The spawned RE_ENTRY_VEHICLEs have their own guidance.
        break;
    }
  }

  private updateTerminalGuidance(deltaTime: number): void {
    if (!this.targetPosition) return;

    const currentPos = this.getPosition();
    const targetPos = this.targetPosition;

    // Proportional navigation towards the ground target
    const toTarget = new THREE.Vector3().subVectors(targetPos, currentPos);
    const distanceToTarget = toTarget.length();

    // If very close, just continue straight
    if (distanceToTarget < 50) {
      return;
    }

    const currentVel = this.getVelocity();
    const currentSpeed = currentVel.length();

    // Don't guide if speed is too low
    if (currentSpeed < 100) return;

    // Calculate desired velocity vector
    const desiredVel = toTarget.normalize().multiplyScalar(currentSpeed);

    // Calculate the required change in velocity
    const velocityError = desiredVel.sub(currentVel);

    // Apply a correction force. The gain determines how quickly it corrects.
    // A higher gain makes it more agile.
    const gain = this.body.mass * 5; // High gain for fast correction
    const correctionForce = velocityError.multiplyScalar(gain);

    // Limit the correction force to simulate realistic maneuverability
    const maxForce = this.body.mass * 50000; // High G-force tolerance
    if (correctionForce.lengthSq() > maxForce * maxForce) {
      correctionForce.normalize().multiplyScalar(maxForce);
    }

    this.body.applyForce(new CANNON.Vec3(correctionForce.x, correctionForce.y, correctionForce.z));
  }

  override preparePhysics(deltaTime: number): void {
    super.preparePhysics(deltaTime);
    if (!this.isActive) return;
    if (this.config.flightStages) this.updateBallisticBehavior(deltaTime);
    else if (this.config.hasTerminalGuidance) this.updateTerminalGuidance(deltaTime);
    else if (this.config.isDrone) this.updateDroneBehavior(deltaTime);
    else if (this.config.cruiseAltitude) this.updateCruiseMissileBehavior();
  }

  update(deltaTime: number): void {
    super.update(deltaTime);
    if (this.config.isDrone) {
      // Keep drone level - override any rotation from physics
      this.mesh.rotation.x = 0;
      this.mesh.rotation.z = 0;

      // Face direction of movement
      const velocity = this.getVelocity();
      if (velocity.x !== 0 || velocity.z !== 0) {
        this.mesh.rotation.y = Math.atan2(velocity.x, velocity.z);
      }

      // Animate rotors
      if (this.mesh.userData.rotors) {
        this.mesh.userData.rotors.children.forEach((armGroup, i) => {
          const rotor = armGroup.children[1]; // Second child is the rotor
          if (rotor) {
            rotor.rotation.y += 0.8 + i * 0.1; // Slightly different speeds
          }
        });
      }
    }

    // Apex detection for payload deployment on non-staged ballistic missiles
    if (
      this.config.payload &&
      !this.config.flightStages && // Only for our simplified ballistic missiles
      !this.shouldDeployPayload // Only if payload hasn't been deployed
    ) {
      const currentVelocity = this.getVelocity();
      if (!this.hasPassedApex && currentVelocity.y <= 0) {
        this.hasPassedApex = true;
      }

      // Deploy when descending below 80% of max altitude
      if (this.hasPassedApex && this.getPosition().y < this.config.maxAltitude * 0.8) {
        this.shouldDeployPayload = true;
      }
    }

    // Orient all non-drone threats along velocity
    if (!this.config.isDrone) {
      const velocity = this.getVelocity();
      if (velocity.length() > 0.1) {
        const direction = velocity.normalize();

        // Different orientation for different model types
        if (this.mesh instanceof THREE.Group) {
          // For group models, we need to handle orientation properly
          // Rocket models are built pointing along -Z axis (rotated cylinders)
          const defaultForward = new THREE.Vector3(0, 0, -1);
          const quaternion = new THREE.Quaternion().setFromUnitVectors(defaultForward, direction);
          this.mesh.quaternion.copy(quaternion);
        } else {
          // For simple mesh models
          this.mesh.lookAt(
            this.mesh.position.x + direction.x,
            this.mesh.position.y + direction.y,
            this.mesh.position.z + direction.z
          );
          if (this.config.isMortar) {
            this.mesh.rotateX(Math.PI / 2); // Adjust for cylinder orientation
          }
        }
      }
    }
  }

  markAsBeingIntercepted(): boolean {
    if (this._isBeingIntercepted) {
      return false; // Already being intercepted
    }
    this._isBeingIntercepted = true;
    return true; // Successfully marked
  }

  unmarkAsBeingIntercepted(): void {
    this._isBeingIntercepted = false;
  }

  isBeingIntercepted(): boolean {
    return this._isBeingIntercepted;
  }

  // Health system methods
  takeDamage(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0 || !this.isActive) return;
    this.health = Math.max(0, this.health - amount);

    // Visual feedback for damage
    if (this.mesh instanceof THREE.Mesh && this.mesh.material) {
      const material = this.mesh.material as THREE.MeshStandardMaterial;
      // Flash red briefly to indicate damage
      const originalColor = material.color.clone();
      material.color.setHex(0xff0000);
      simulationClock.setTimeout(() => {
        material.color.copy(originalColor);
      }, 100);
    }
  }

  getHealth(): number {
    return this.health;
  }

  getMaxHealth(): number {
    return this.maxHealth;
  }

  isDestroyed(): boolean {
    return this.health <= 0;
  }
}
