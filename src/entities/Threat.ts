import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Projectile, ProjectileOptions } from './Projectile';
import { GeometryFactory } from '../utils/GeometryFactory';
import { MaterialCache } from '../utils/MaterialCache';
import { MissileModelFactory } from '../utils/MissileModelFactory';

export enum ThreatType {
  // Rockets
  SHORT_RANGE = 'SHORT_RANGE',
  MEDIUM_RANGE = 'MEDIUM_RANGE',
  LONG_RANGE = 'LONG_RANGE',

  // New threat types
  MORTAR = 'MORTAR',
  DRONE_SLOW = 'DRONE_SLOW',
  DRONE_FAST = 'DRONE_FAST',
  CRUISE_MISSILE = 'CRUISE_MISSILE',

  // Specific rocket variants
  QASSAM_1 = 'QASSAM_1',
  QASSAM_2 = 'QASSAM_2',
  QASSAM_3 = 'QASSAM_3',
  GRAD_ROCKET = 'GRAD_ROCKET',
  BALLISTIC_MISSILE = 'BALLISTIC_MISSILE',
  DECOY = 'DECOY',
  RE_ENTRY_VEHICLE = 'RE_ENTRY_VEHICLE',
}

export interface ThreatConfig {
  velocity: number; // m/s
  maxRange: number; // meters
  maxAltitude: number; // meters
  warheadSize: number; // kg
  color: number;
  radius: number;
  // New properties for advanced threats
  maneuverability?: number; // 0-1, ability to change course
  cruiseAltitude?: number; // For cruise missiles and drones
  isDrone?: boolean; // Different physics for drones
  isMortar?: boolean; // High arc trajectory
  rcs?: number; // Radar cross section (affects detection)
  signature?: {
    // For decoys vs real threats
    radar: number; // 1.0 for real, < 1.0 for decoys
    thermal: number;
    electronic: number;
  };
  flightStages?: {
    boost: { duration: number; thrust: number };
    terminal: { speed: number };
  };
  payload?: { type: ThreatType; count: number; spread: number };
  hasTerminalGuidance?: boolean;
}

export const THREAT_CONFIGS: Record<ThreatType, ThreatConfig> = {
  [ThreatType.SHORT_RANGE]: {
    velocity: 300,
    maxRange: 10000,
    maxAltitude: 3000,
    warheadSize: 10,
    color: 0xff0000,
    radius: 0.4,
  },
  [ThreatType.MEDIUM_RANGE]: {
    velocity: 600,
    maxRange: 40000,
    maxAltitude: 10000,
    warheadSize: 50,
    color: 0xff6600,
    radius: 0.6,
    signature: { radar: 1.0, thermal: 1.0, electronic: 1.0 },
  },
  [ThreatType.LONG_RANGE]: {
    velocity: 1000,
    maxRange: 70000,
    maxAltitude: 20000,
    warheadSize: 100,
    color: 0xff0066,
    radius: 0.8,
  },

  // Mortars - high arc, short range
  [ThreatType.MORTAR]: {
    velocity: 200,
    maxRange: 5000,
    maxAltitude: 1500,
    warheadSize: 5,
    color: 0x8b4513, // Brown
    radius: 0.3,
    isMortar: true,
    rcs: 0.1,
  },

  // Drones - slow, maneuverable, low altitude
  [ThreatType.DRONE_SLOW]: {
    velocity: 30, // ~110 km/h
    maxRange: 50000,
    maxAltitude: 500,
    warheadSize: 5,
    color: 0x00ff00, // Green
    radius: 0.8,
    isDrone: true,
    maneuverability: 0.8,
    cruiseAltitude: 100,
    rcs: 0.3,
  },

  [ThreatType.DRONE_FAST]: {
    velocity: 50, // ~180 km/h
    maxRange: 100000,
    maxAltitude: 1000,
    warheadSize: 20,
    color: 0x00ff66, // Light green
    radius: 1.0,
    isDrone: true,
    maneuverability: 0.6,
    cruiseAltitude: 200,
    rcs: 0.5,
  },

  // Cruise missile - fast, terrain following
  [ThreatType.CRUISE_MISSILE]: {
    velocity: 250, // ~900 km/h
    maxRange: 300000,
    maxAltitude: 100,
    warheadSize: 500,
    color: 0x0066ff, // Blue
    radius: 1.2,
    maneuverability: 0.3,
    cruiseAltitude: 50,
    rcs: 0.8,
  },

  // Specific rocket variants
  [ThreatType.QASSAM_1]: {
    velocity: 200,
    maxRange: 5000,
    maxAltitude: 2000,
    warheadSize: 5,
    color: 0xff3333,
    radius: 0.3,
    rcs: 0.4,
  },

  [ThreatType.QASSAM_2]: {
    velocity: 280,
    maxRange: 10000,
    maxAltitude: 3500,
    warheadSize: 10,
    color: 0xff4444,
    radius: 0.4,
    rcs: 0.5,
  },

  [ThreatType.QASSAM_3]: {
    velocity: 350,
    maxRange: 15000,
    maxAltitude: 5000,
    warheadSize: 20,
    color: 0xff5555,
    radius: 0.5,
    rcs: 0.6,
  },

  [ThreatType.GRAD_ROCKET]: {
    velocity: 450,
    maxRange: 20000,
    maxAltitude: 7000,
    warheadSize: 20,
    color: 0xff8800,
    radius: 0.5,
    rcs: 0.7,
  },

  [ThreatType.BALLISTIC_MISSILE]: {
    velocity: 800, // Max velocity cap, not a fixed launch speed.
    maxRange: 500000,
    maxAltitude: 40000, // High altitude for ballistic arc
    warheadSize: 1000,
    color: 0xcc00ff, // Purple
    radius: 2.0,
    rcs: 2.0,
    payload: { type: ThreatType.RE_ENTRY_VEHICLE, count: 4, spread: 500 },
  },

  [ThreatType.DECOY]: {
    velocity: 600, // Same as medium range to be convincing
    maxRange: 40000,
    maxAltitude: 10000,
    warheadSize: 0, // No damage
    color: 0xaaaaaa, // Grey color
    radius: 0.6, // Same size as medium range
    rcs: 1.0, // Same radar cross-section
    signature: {
      radar: 1.0, // Looks real on radar
      thermal: 0.1, // Low thermal signature
      electronic: 0.1, // Low electronic signature
    },
  },

  [ThreatType.RE_ENTRY_VEHICLE]: {
    velocity: 1500, // High speed, but inherited from parent on spawn. This is a fallback value.
    maxRange: 80000, // Inherited from parent, not used for launch
    maxAltitude: 80000, // Inherited from parent
    warheadSize: 150, // Smaller, tactical warhead
    color: 0xff4500, // Bright orange/red for re-entry heat
    radius: 0.5,
    rcs: 0.3, // Smaller radar cross-section
    hasTerminalGuidance: true, // This vehicle guides itself
    signature: { radar: 1.0, thermal: 5.0, electronic: 0.5 }, // High thermal signature
    // No flight stages or payload, it's a terminal threat
  },
};

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
    this.launchTime = Date.now();

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
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
  }

  private calculateImpactPrediction(): void {
    // Simple ballistic prediction (ignoring air resistance for now)
    const v0 = this.getVelocity();
    const p0 = this.getPosition();
    const g = 9.82;

    // Solve for time when y = 0 (ground impact)
    // y = y0 + v0y*t - 0.5*g*t^2
    const a = -0.5 * g;
    const b = v0.y;
    const c = p0.y;

    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return;

    const t1 = (-b + Math.sqrt(discriminant)) / (2 * a);
    const t2 = (-b - Math.sqrt(discriminant)) / (2 * a);

    const impactTimeSeconds = Math.max(t1, t2);
    if (impactTimeSeconds <= 0) return;

    this.impactTime = this.launchTime + impactTimeSeconds * 1000;

    // Calculate impact position
    this.impactPoint = new THREE.Vector3(
      p0.x + v0.x * impactTimeSeconds,
      0,
      p0.z + v0.z * impactTimeSeconds
    );
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

    if (!this.impactTime) return -1;
    return Math.max(0, (this.impactTime - Date.now()) / 1000);
  }

  getImpactPoint(): THREE.Vector3 | null {
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
      this.body.applyForce(lift, this.body.position);

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
        this.body.applyForce(diveForce, this.body.position);

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
        this.body.applyForce(steerForce, this.body.position);

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
          this.body.applyForce(thrust, this.body.position);
        }

        // Add some random maneuvering
        this.maneuverTimer += deltaTime;
        if (this.config.maneuverability && this.maneuverTimer > 0.5) {
          const maneuver = new CANNON.Vec3(
            (Math.random() - 0.5) * this.config.maneuverability * 10,
            0,
            (Math.random() - 0.5) * this.config.maneuverability * 10
          );
          this.body.applyForce(maneuver, this.body.position);
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
      this.body.applyForce(diveForce, this.body.position);
    } else if (currentPos.y < this.config.cruiseAltitude! * 0.8) {
      // Pull up if too low
      const liftForce = new CANNON.Vec3(0, 100, 0);
      this.body.applyForce(liftForce, this.body.position);
    }

    // Terminal guidance when close to target
    const distanceToTarget = currentPos.distanceTo(this.targetPosition);
    if (distanceToTarget < 1000) {
      const targetDir = new THREE.Vector3().subVectors(this.targetPosition, currentPos).normalize();

      // Proportional navigation
      const navForce = new CANNON.Vec3(targetDir.x * 200, targetDir.y * 200, targetDir.z * 200);
      this.body.applyForce(navForce, this.body.position);
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

  update(deltaTime: number): void {
    super.update();

    if (this.config.flightStages) {
      this.updateBallisticBehavior(deltaTime);
    } else if (this.config.hasTerminalGuidance) {
      this.updateTerminalGuidance(deltaTime);
    } else if (this.config.isDrone) {
      this.updateDroneBehavior(deltaTime);

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
    } else if (this.config.cruiseAltitude && !this.config.isDrone) {
      this.updateCruiseMissileBehavior();
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
    this.health = Math.max(0, this.health - amount);
    
    // Visual feedback for damage
    if (this.mesh instanceof THREE.Mesh && this.mesh.material) {
      const material = this.mesh.material as THREE.MeshStandardMaterial;
      // Flash red briefly to indicate damage
      const originalColor = material.color.clone();
      material.color.setHex(0xff0000);
      setTimeout(() => {
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
