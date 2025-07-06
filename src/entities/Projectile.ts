import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ProximityFuse } from '../systems/ProximityFuse';
import { ModelCache } from '../utils/ModelCache';
import { debug } from '../utils/logger';
import { ThrustVectorControl } from '../systems/ThrustVectorControl';
import { PooledTrailSystem } from '../rendering/PooledTrailSystem';
import { GeometryFactory } from '../utils/GeometryFactory';
import { MaterialCache } from '../utils/MaterialCache';
import { MissileModelFactory } from '../utils/MissileModelFactory';

export interface ProjectileOptions {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  color?: number;
  radius?: number;
  mass?: number;
  trailLength?: number;
  isInterceptor?: boolean;
  target?: THREE.Object3D;
  useExhaustTrail?: boolean;
  failureMode?: 'none' | 'motor' | 'guidance' | 'premature';
  failureTime?: number;
  maxLifetime?: number; // Maximum flight time before self-destruct (seconds)
  batteryPosition?: THREE.Vector3; // Battery position for self-destruct check
  useInstancing?: boolean; // Use instanced rendering
  instanceManager?: any; // ProjectileInstanceManager reference
}

export class Projectile {
  id: string;
  mesh: THREE.Mesh | THREE.Group;
  body: CANNON.Body;
  trail: THREE.Line; // Legacy trail for compatibility
  trailPositions: THREE.Vector3[]; // Legacy trail positions
  trailGeometry: THREE.BufferGeometry; // Legacy trail geometry
  maxTrailLength: number;
  useUnifiedTrail: boolean = false;
  isActive: boolean = true;
  isInterceptor: boolean;
  target?: THREE.Object3D;
  proximityFuse?: ProximityFuse;
  detonationCallback?: (position: THREE.Vector3, quality: number) => void;
  exhaustTrailId?: string;
  mainTrailId?: string;
  thrustControl?: ThrustVectorControl;
  private scene: THREE.Scene;
  private failureMode: string;
  private failureTime: number;
  private launchTime: number;
  private hasFailed: boolean = false;
  private radius: number;
  private maxLifetime: number;
  private batteryPosition?: THREE.Vector3;
  useInstancing: boolean = false;
  private instanceManager?: any;
  private instanceId?: number;

  // Re-engagement tracking
  private minDistanceToTarget: number = Infinity;
  private isReEngaging: boolean = false;
  private reEngagementAttempts: number = 0;
  private lastTargetDistance: number = Infinity;

  // Physics scaling factor for simulator world
  private static readonly WORLD_SCALE = 0.3; // 30% of real-world values

  // Model orientation debugging
  private static modelForwardVector = new THREE.Vector3(0, 1, 0); // Default: +Y for interceptor model
  private static modelRotationAdjustment = new THREE.Euler(0, 0, 0); // No rotation needed

  // Proximity fuse settings - Aligned with blast physics for optimal effectiveness
  // These settings ensure detonation occurs within the severe damage zone (6m)
  private static readonly PROXIMITY_FUSE_SETTINGS = {
    initial: {
      armingDistance: 15, // Arms after 15m
      detonationRadius: 8, // Detonate within 8m (ensures severe damage zone)
      optimalRadius: 4, // Best at 4m (lethal to severe damage transition)
      scanRate: 1, // Check every frame for better accuracy
    },
    retarget: {
      armingDistance: 10, // Shorter arming distance since already in flight
      detonationRadius: 8, // Detonate within 8m
      optimalRadius: 4, // Best at 4m
      scanRate: 1, // Check every frame
    },
  };

  constructor(scene: THREE.Scene, world: CANNON.World, options: ProjectileOptions) {
    const {
      position,
      velocity,
      color = 0x00ff00,
      radius = 0.5,
      mass = 5,
      trailLength = 100,
      isInterceptor = false,
      target,
      useExhaustTrail = true,
      failureMode = 'none',
      failureTime = 0,
      maxLifetime = isInterceptor ? 15 : 120, // 15s for interceptors, 120s for threats (longer flight from world edge)
      batteryPosition,
      useInstancing = false,
      instanceManager,
    } = options;

    this.id = `projectile_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.scene = scene;
    this.isInterceptor = isInterceptor;
    this.target = target;
    this.failureMode = failureMode;
    this.failureTime = failureTime;
    this.launchTime = Date.now();
    this.radius = radius;
    this.maxLifetime = maxLifetime;
    this.batteryPosition = batteryPosition;
    this.useInstancing = useInstancing;
    this.instanceManager = instanceManager;

    // Optional debug logging for interceptor launch positions
    if (isInterceptor && batteryPosition && (window as any).__debugLaunchPositions) {
      debug.module('Projectile').log('Interceptor created:', {
        id: this.id,
        position: position,
        batteryPosition: batteryPosition,
        distanceFromBattery: position.distanceTo(batteryPosition),
        velocity: velocity,
        speed: velocity.length(),
      });
    }

    // Create mesh using missile model factory or instancing
    if (useInstancing && instanceManager) {
      // For instanced rendering, we still need a mesh for physics
      // The instance manager will handle hiding it and using instanced rendering
      // Create dummy mesh for physics sync
      this.mesh = new THREE.Object3D() as any;
      this.mesh.position.copy(position);
      // Don't add to scene yet - instance manager will handle it
      this.instanceId = 0; // Placeholder, will be set by instance manager
    }

    if (!useInstancing) {
      // Regular mesh creation
      const modelFactory = MissileModelFactory.getInstance();
      if (isInterceptor) {
        // Create interceptor model
        this.mesh = modelFactory.createInterceptorModel(color);

        // Load optimized Tamir model using shared cache (if enabled)
        const modelQuality = (window as any).__interceptorModelQuality || 'ultra';
        if (modelQuality !== 'none') {
          this.loadTamirModelOptimized(scene, radius, modelQuality);
        }
      } else {
        // Threat missile - simple sphere for compatibility
        // (Threats should use their own models via Threat class)
        const geometry = GeometryFactory.getInstance().getSphere(radius, 12, 6); // Reduced segments
        const material = MaterialCache.getInstance().getMeshStandardMaterial({
          color,
        });
        this.mesh = new THREE.Mesh(geometry, material);
      }

      this.mesh.castShadow = true;
      this.mesh.position.copy(position);
      scene.add(this.mesh);
    }

    // Create physics body
    const shape = new CANNON.Sphere(radius);
    this.body = new CANNON.Body({
      mass,
      shape,
      position: new CANNON.Vec3(position.x, position.y, position.z),
      velocity: new CANNON.Vec3(velocity.x, velocity.y, velocity.z),
      linearDamping: 0.01, // Small amount of drag for stability
      angularDamping: 0.3, // Moderate damping - allows turning but prevents spin
    });
    world.addBody(this.body);

    // Create trail using PooledTrailSystem for massive performance gain
    this.maxTrailLength = trailLength;
    this.trailPositions = [];

    // Use PooledTrailSystem - 1 draw call for ALL trails
    const pooledTrail = PooledTrailSystem.getInstance(scene);
    this.mainTrailId = pooledTrail.createTrail(trailLength, color);
    this.useUnifiedTrail = true;

    // Create minimal dummy objects for compatibility - NO geometry, NO material, NOT in scene
    this.trailGeometry = null as any; // Set to null but typed as BufferGeometry for compatibility
    this.trail = null as any; // Set to null but typed as Line for compatibility

    // Initialize proximity fuse for interceptors with realistic parameters
    if (isInterceptor && target) {
      this.proximityFuse = new ProximityFuse(position, Projectile.PROXIMITY_FUSE_SETTINGS.initial);

      // Disable thrust vector control for now - it's causing issues
      // this.thrustControl = new ThrustVectorControl({
      //   maxThrust: 200 * mass,
      //   thrustDuration: 3,
      //   dacsThrustPulse: 10 * mass,
      //   dacsImpulseBudget: 100 * mass
      // })
    }

    // Initialize exhaust trail using PooledTrailSystem
    if (useExhaustTrail) {
      this.exhaustTrailId = pooledTrail.createTrail(
        Math.floor(trailLength * 0.5), // Shorter exhaust trail
        isInterceptor ? 0xffaa00 : 0xff6600
      );
    }
  }

  update(deltaTime: number = 0.016): void {
    if (!this.isActive) return;

    // Check for failure conditions
    if (!this.hasFailed && this.failureMode !== 'none') {
      const elapsed = (Date.now() - this.launchTime) / 1000;
      if (elapsed >= this.failureTime) {
        this.handleFailure();
      }
    }

    // Check max lifetime for self-destruct
    const flightTime = (Date.now() - this.launchTime) / 1000;
    if (flightTime >= this.maxLifetime) {
      debug.category(
        'Projectile',
        `${
          this.isInterceptor ? 'Interceptor' : 'Threat'
        } self-destructing after ${flightTime.toFixed(1)}s`
      );

      // Trigger detonation callback if available (for visual explosion)
      if (this.detonationCallback) {
        this.detonationCallback(this.mesh.position.clone(), 0.3); // Low quality explosion
      }

      // Exhaust trail removed for performance

      this.isActive = false;
      return;
    }

    // Check for interceptor self-destruct near battery
    if (this.isInterceptor && this.batteryPosition) {
      // Calculate predicted landing position
      const velocity = this.getVelocity();
      const position = this.getPosition();

      // Only check if projectile is descending
      if (velocity.y < 0) {
        // Calculate time to ground impact
        const timeToGround = -position.y / velocity.y;

        // Predict landing position
        const landingPos = new THREE.Vector3(
          position.x + velocity.x * timeToGround,
          0,
          position.z + velocity.z * timeToGround
        );

        // Check distance to battery
        const distanceToBattery = landingPos.distanceTo(this.batteryPosition);
        const dangerRadius = 10; // Self-destruct if landing within 10m of battery

        // Also check current distance to prevent immediate self-destruct on launch
        const currentDistanceToBattery = position.distanceTo(this.batteryPosition);

        if (distanceToBattery < dangerRadius && position.y < 50 && currentDistanceToBattery > 5) {
          // Only when low altitude and not just launched
          debug.category(
            'Projectile',
            `Interceptor self-destructing to protect battery (landing ${distanceToBattery.toFixed(
              1
            )}m from battery, currently ${currentDistanceToBattery.toFixed(1)}m away)`
          );

          // Trigger detonation
          if (this.detonationCallback) {
            this.detonationCallback(this.mesh.position.clone(), 0.5); // Medium quality explosion
          }

          // Stop exhaust trail
          if (this.exhaustTrailId) {
            const pooledTrail = PooledTrailSystem.getInstance(this.scene);
            pooledTrail.removeTrail(this.exhaustTrailId);
          }

          this.isActive = false;
          return;
        }
      }
    }

    // Sync mesh position with physics body
    this.mesh.position.copy(this.body.position as any);
    // Don't copy quaternion - we'll orient based on velocity instead

    // Always orient based on current velocity
    const currentVel = this.getVelocity();
    if (currentVel.length() > 1) {
      this.orientMissile(currentVel);
    }

    // Instance updates are handled by the manager's batch update method
    // No individual updates needed here

    // Update trail
    if (this.useUnifiedTrail) {
      // Update pooled trail system
      const pooledTrail = PooledTrailSystem.getInstance(this.scene);
      if (this.mainTrailId) {
        pooledTrail.updateTrail(this.mainTrailId, this.mesh.position);
      }
      // Skip all legacy trail updates when using pooled system
    } else if (this.trail && this.trailGeometry) {
      // Legacy trail update - only if trail objects exist
      this.trailPositions.push(this.mesh.position.clone());
      if (this.trailPositions.length > this.maxTrailLength) {
        this.trailPositions.shift();
      }

      // Update trail geometry
      if (this.trailPositions.length > 1) {
        const positions = new Float32Array(this.trailPositions.length * 3);
        this.trailPositions.forEach((pos, i) => {
          positions[i * 3] = pos.x;
          positions[i * 3 + 1] = pos.y;
          positions[i * 3 + 2] = pos.z;
        });
        this.trailGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      }
    }

    // Update exhaust trail
    if (this.exhaustTrailId && this.body.velocity.length() > 0.1) {
      const velocity = this.getVelocity();

      // Emit from rear of projectile
      const emitPosition = this.mesh.position.clone();
      const velocityNormalized = velocity.clone().normalize();
      emitPosition.sub(velocityNormalized.multiplyScalar(this.radius));

      // Update particle trail position
      const pooledTrail = PooledTrailSystem.getInstance(this.scene);
      pooledTrail.updateTrail(this.exhaustTrailId, emitPosition);
    }

    // Mid-flight guidance for interceptors (if not failed)
    if (this.isInterceptor && this.target && !this.hasFailed && this.failureMode !== 'guidance') {
      this.updateGuidance(deltaTime);
    }

    // Check proximity fuse for interceptors
    if (this.isInterceptor && this.proximityFuse && this.target) {
      const targetPosition =
        'getPosition' in this.target ? (this.target as any).getPosition() : this.target.position;
      const currentTime = Date.now();

      const { shouldDetonate, detonationQuality } = this.proximityFuse.update(
        this.mesh.position,
        targetPosition,
        deltaTime,
        currentTime
      );

      if (shouldDetonate) {
        // Stop exhaust trail
        if (this.exhaustTrailId) {
          const pooledTrail = PooledTrailSystem.getInstance(this.scene);
          pooledTrail.removeTrail(this.exhaustTrailId);
        }

        // Trigger detonation
        if (this.detonationCallback) {
          this.detonationCallback(this.mesh.position.clone(), detonationQuality);
        }
        this.isActive = false;
      }
    }
  }

  destroy(scene: THREE.Scene, world: CANNON.World): void {
    this.isActive = false;

    // Instance removal is handled by the manager when removing threats
    // Only remove mesh if not using instancing
    if (!this.useInstancing && this.mesh) {
      scene.remove(this.mesh);
    }

    world.removeBody(this.body);

    // Remove from pooled trail system if used
    if (this.useUnifiedTrail) {
      const pooledTrail = PooledTrailSystem.getInstance(scene);
      if (this.mainTrailId) {
        pooledTrail.removeTrail(this.mainTrailId);
      }
    } else if (this.trail && this.trailGeometry) {
      // Remove legacy trail - only if objects exist
      scene.remove(this.trail);
      this.trailGeometry.dispose(); // Trail geometry is unique per projectile
      // Don't dispose trail material - it's shared from MaterialCache
    }

    // Don't dispose geometry and materials when using shared caches
    // They are managed by GeometryFactory and MaterialCache
    if (this.mesh instanceof THREE.Group) {
      // For GLTF models, only dispose if materials were cloned
      this.mesh.traverse(child => {
        if (child instanceof THREE.Mesh) {
          // Model materials might have been cloned, check if they need disposal
          if (child.material && child.userData.materialCloned) {
            if (Array.isArray(child.material)) {
              child.material.forEach(mat => mat.dispose());
            } else {
              child.material.dispose();
            }
          }
        }
      });
    }
    // Note: Shared geometries and materials from caches should NOT be disposed here

    // Clean up exhaust trail
    if (this.exhaustTrailId) {
      const pooledTrail = PooledTrailSystem.getInstance(scene);
      pooledTrail.removeTrail(this.exhaustTrailId);
    }
  }

  getPosition(): THREE.Vector3 {
    return this.mesh.position.clone();
  }

  getVelocity(): THREE.Vector3 {
    return new THREE.Vector3(this.body.velocity.x, this.body.velocity.y, this.body.velocity.z);
  }

  getRotation(): THREE.Euler {
    // Calculate rotation from velocity vector
    const velocity = this.getVelocity();
    const heading = Math.atan2(-velocity.z, velocity.x);
    const pitch = Math.atan2(
      velocity.y,
      Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z)
    );

    return new THREE.Euler(pitch, heading, 0);
  }

  getScale(): THREE.Vector3 {
    return this.mesh.scale.clone();
  }

  retarget(newTarget: THREE.Object3D): void {
    // Change target for an interceptor mid-flight
    if (!this.isInterceptor || this.hasFailed) return;

    debug.category('Interceptor', 'Retargeting to new threat');
    this.target = newTarget;

    // Reset proximity fuse for new target with current position
    if (this.proximityFuse) {
      this.proximityFuse = new ProximityFuse(
        this.mesh.position,
        Projectile.PROXIMITY_FUSE_SETTINGS.retarget
      );
    }
  }

  private handleFailure(): void {
    this.hasFailed = true;
    debug.category('Interceptor', `Failure: ${this.failureMode}`);

    switch (this.failureMode) {
      case 'motor': {
        // Motor failure - stop thrust, let gravity take over
        if (this.exhaustTrailId) {
          const pooledTrail = PooledTrailSystem.getInstance(this.scene);
          pooledTrail.removeTrail(this.exhaustTrailId);
        }
        // Reduce velocity significantly
        this.body.velocity.x *= 0.3;
        this.body.velocity.y *= 0.3;
        this.body.velocity.z *= 0.3;
        // Change color to indicate failure
        if (this.mesh instanceof THREE.Mesh) {
          (this.mesh.material as THREE.MeshStandardMaterial).color.setHex(0x666666);
          (this.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
        } else if (this.mesh instanceof THREE.Group) {
          // For GLTF models, traverse and update materials
          this.mesh.traverse(child => {
            if (child instanceof THREE.Mesh && child.material) {
              // Handle different material types safely
              if (Array.isArray(child.material)) {
                child.material.forEach(mat => {
                  if ('color' in mat && mat.color) {
                    mat.color.setHex(0x666666);
                  }
                  if ('emissiveIntensity' in mat) {
                    mat.emissiveIntensity = 0;
                  }
                });
              } else {
                const material = child.material;
                if ('color' in material && material.color) {
                  material.color.setHex(0x666666);
                }
                if ('emissiveIntensity' in material) {
                  material.emissiveIntensity = 0;
                }
              }
            }
          });
        }
        break;
      }

      case 'guidance': {
        // Guidance failure - veer off course
        const randomVeer = new THREE.Vector3(
          (Math.random() - 0.5) * 50,
          (Math.random() - 0.5) * 30,
          (Math.random() - 0.5) * 50
        );
        this.body.velocity.x += randomVeer.x;
        this.body.velocity.y += randomVeer.y;
        this.body.velocity.z += randomVeer.z;
        // Disable proximity fuse
        this.proximityFuse = undefined;
        break;
      }

      case 'premature':
        // Premature detonation
        if (this.detonationCallback) {
          this.detonationCallback(this.mesh.position.clone(), 0.3); // Low quality detonation
        }
        this.isActive = false;
        break;
    }
  }

  setTargetPoint(targetPoint: THREE.Vector3): void {
    // Update the target position for improved targeting
    if (!targetPoint) {
      debug.warn('setTargetPoint called with undefined targetPoint');
      return;
    }

    // If target is a Threat object, we shouldn't modify it directly
    if (this.target && 'getPosition' in this.target) {
      // Target is a Threat, create a separate dummy target for the aim point
      const dummyTarget = new THREE.Object3D();
      dummyTarget.position.copy(targetPoint);
      dummyTarget.visible = false; // Make dummy target invisible
      this.scene.add(dummyTarget);
      this.target = dummyTarget;
    } else if (!this.target) {
      // Create a dummy target object if none exists
      this.target = new THREE.Object3D();
      this.target.visible = false; // Make dummy target invisible
      this.scene.add(this.target);
      this.target.position.copy(targetPoint);
    } else if (this.target.position) {
      // Target has a position property, update it
      this.target.position.copy(targetPoint);
    }
  }

  private updateGuidance(deltaTime: number): void {
    if (!this.target || !this.isActive) return;

    const currentVelocity = this.getVelocity();
    const currentSpeed = currentVelocity.length();

    // Don't guide if moving too slowly
    if (currentSpeed < 10) {
      // Removed excessive logging - speed too low
      return;
    }

    // Check minimum travel distance before guidance kicks in
    const distanceTraveled = this.proximityFuse?.getDistanceTraveled() || 0;
    const minGuidanceDistance = 30; // Don't guide for first 30 meters to clear battery
    if (distanceTraveled < minGuidanceDistance && !this.isReEngaging) {
      // During launch phase, don't apply any guidance corrections
      // The interceptor will continue on its initial launch trajectory
      return;
    }

    // Calculate intercept point prediction
    const targetPos =
      'getPosition' in this.target
        ? (this.target as any).getPosition()
        : this.target.position.clone();
    const myPos = this.mesh.position.clone();

    // Proportional navigation
    const toTarget = targetPos.clone().sub(myPos);
    const distance = toTarget.length();

    // Track minimum distance for re-engagement detection
    if (distance < this.minDistanceToTarget) {
      this.minDistanceToTarget = distance;
    }

    // Check for re-engagement opportunity
    if (
      !this.isReEngaging &&
      this.minDistanceToTarget < 15 && // Got close but missed
      distance > this.lastTargetDistance && // Moving away from target
      distance > 10 && // Far enough to need re-engagement
      this.reEngagementAttempts < 1 && // Only try once
      currentSpeed > 50
    ) {
      // Still have enough energy

      // Removed re-engage miss logging

      this.isReEngaging = true;
      this.reEngagementAttempts++;
      this.minDistanceToTarget = Infinity; // Reset for new approach
    }

    this.lastTargetDistance = distance;

    // Removed excessive guidance logging

    // Continue guiding even when close to ensure hit
    // Proximity fuse will handle detonation

    // Calculate time to impact
    const timeToImpact = distance / currentSpeed;
    const predictedTargetPos = targetPos.clone();

    // Predict target future position
    if ('getVelocity' in this.target) {
      const targetVel = (this.target as any).getVelocity();
      const targetSpeed = targetVel.length();
      // Simple lead calculation
      const leadTime = timeToImpact * 0.5; // Lead by half the time to impact
      predictedTargetPos.add(targetVel.clone().multiplyScalar(leadTime));

      // Removed excessive prediction logging
    }

    // Calculate line of sight to predicted position
    const los = predictedTargetPos.clone().sub(myPos).normalize();

    // Simple proportional navigation
    const desiredVelocity = los.multiplyScalar(currentSpeed);
    const velocityError = desiredVelocity.clone().sub(currentVelocity);

    // Only guide if we're not too close (avoid overshooting)
    if (distance < 3) {
      // Removed excessive close range logging
      this.orientMissile(currentVelocity);
      return; // Let momentum and proximity fuse handle it
    }

    // Apply correction force
    let correctionGain = this.body.mass * 2; // Default P gain
    let maxGForce = 40; // Default max G-force

    // More aggressive control for re-engagement
    if (this.isReEngaging) {
      correctionGain = this.body.mass * 4; // Double the gain for faster turn
      maxGForce = 60; // Allow higher G-forces for turnaround

      // Add additional turning force perpendicular to current velocity
      const turnAxis = currentVelocity.clone().cross(los).normalize();
      const turnForce = turnAxis.multiplyScalar(this.body.mass * 100);
      velocityError.add(turnForce);

      // Removed re-engage logging
    }

    const correctionForce = velocityError.multiplyScalar(correctionGain);

    // Realistic missile constraints scaled for simulator
    const gravity = 9.81;
    const maxAcceleration = maxGForce * gravity;
    const maxForce = this.body.mass * maxAcceleration;
    const forceBeforeLimit = correctionForce.length();
    if (correctionForce.length() > maxForce) {
      correctionForce.normalize().multiplyScalar(maxForce);
    }

    // Removed excessive force logging

    // Apply the force with gravity compensation
    const gravityCompensation = this.body.mass * 9.81;
    this.body.applyForce(
      new CANNON.Vec3(
        correctionForce.x,
        correctionForce.y + gravityCompensation,
        correctionForce.z
      ),
      new CANNON.Vec3(0, 0, 0)
    );

    // Add forward thrust to maintain speed
    const thrustDirection = currentVelocity.clone().normalize();
    const targetSpeed = this.isReEngaging ? 180 : 150; // Higher speed for re-engagement
    const speedError = targetSpeed - currentSpeed;
    const thrustForce = Math.max(0, speedError * this.body.mass * 0.5);

    if (thrustForce > 0 && thrustDirection.length() > 0) {
      // Removed thrust logging
      this.body.applyForce(
        new CANNON.Vec3(
          thrustDirection.x * thrustForce,
          thrustDirection.y * thrustForce,
          thrustDirection.z * thrustForce
        ),
        new CANNON.Vec3(0, 0, 0)
      );
    }

    // Check if re-engagement is complete (heading back toward target)
    if (this.isReEngaging && distance < 20) {
      const closingVelocity = -toTarget.normalize().dot(currentVelocity);
      if (closingVelocity > 0) {
        // Removed re-engage success logging
        this.isReEngaging = false;
        // Reset proximity fuse for new approach
        if (this.proximityFuse) {
          this.proximityFuse = new ProximityFuse(
            this.mesh.position,
            Projectile.PROXIMITY_FUSE_SETTINGS.retarget
          );
        }
      }
    }

    // Orient the missile model - MOVED to main update() loop to prevent stuttering
    // this.orientMissile(currentVelocity);
  }

  private orientMissile(velocity: THREE.Vector3): void {
    if (velocity.length() < 0.1) return;

    const direction = velocity.clone().normalize();

    // Create a point far ahead in the direction of velocity
    const lookAtPoint = this.mesh.position.clone().add(direction.multiplyScalar(10));

    // Make the mesh look at that point
    this.mesh.lookAt(lookAtPoint);

    // For GLTF models, we might need an additional rotation to correct the model's intrinsic orientation.
    // The Tamir model seems to be oriented along its Y-axis, so we add a 90-degree rotation on the X-axis.
    if (this.mesh instanceof THREE.Group || this.mesh.type === 'Group') {
      this.mesh.rotateX(Math.PI / 2);
    }
  }

  private async loadTamirModelOptimized(
    scene: THREE.Scene,
    scale: number,
    quality: string = 'ultra'
  ): Promise<void> {
    try {
      const modelCache = ModelCache.getInstance();
      const modelPath = 'assets/tamir/scene.gltf'; // Use full model
      const model = await modelCache.createInstance(modelPath);

      // Store reference to old mesh
      const oldMesh = this.mesh;

      // Use the loaded model
      this.mesh = model;

      // Calculate model bounds and scale appropriately
      const box = new THREE.Box3().setFromObject(this.mesh);
      const size = box.getSize(new THREE.Vector3());
      const maxDimension = Math.max(size.x, size.y, size.z);
      debug.asset(
        'Model dimensions',
        `${size.x.toFixed(2)}x${size.y.toFixed(2)}x${size.z.toFixed(2)}`,
        { max: maxDimension }
      );

      // Scale to match the desired size (based on radius parameter)
      const targetSize = scale * 15; // Model scale from working version
      const scaleFactor = maxDimension > 0 ? targetSize / maxDimension : 1;
      this.mesh.scale.setScalar(scaleFactor);
      debug.asset(
        'Scaling model',
        `${scaleFactor.toFixed(3)}x to target size ${targetSize.toFixed(2)}`
      );

      // Set initial rotation to match the cone's orientation
      this.mesh.rotation.x = Math.PI / 2; // Point forward

      // Apply materials but DON'T remove parts
      this.mesh.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          child.frustumCulled = true;
          child.visible = true;

          // Ensure materials are visible
          if (child.material) {
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach(material => {
              if ('opacity' in material) {
                material.opacity = 1.0;
              }
              if ('visible' in material) {
                material.visible = true;
              }
            });
          }
        }
      });

      // Position and add to scene
      this.mesh.position.copy(this.body.position as any);
      scene.add(this.mesh);

      // Remove old mesh
      scene.remove(oldMesh);
      if (oldMesh instanceof THREE.Mesh) {
        oldMesh.geometry.dispose();
        (oldMesh.material as THREE.Material).dispose();
      }

      debug.asset(
        'Tamir model loaded',
        `at position ${this.mesh.position
          .toArray()
          .map(n => n.toFixed(2))
          .join(', ')}`
      );
    } catch (error) {
      debug.error('Failed to load Tamir model:', error);
    }
  }

  private logModelHierarchy(obj: THREE.Object3D, depth: number): void {
    const indent = '  '.repeat(depth);
    let info = `${indent}${obj.name || 'unnamed'} (${obj.type})`;

    if (obj instanceof THREE.Mesh) {
      const box = new THREE.Box3().setFromObject(obj);
      const size = box.getSize(new THREE.Vector3());
      info += ` - Size: ${size.x.toFixed(2)}x${size.y.toFixed(2)}x${size.z.toFixed(2)}`;
      info += ` - Scale: ${obj.scale.x.toFixed(2)},${obj.scale.y.toFixed(2)},${obj.scale.z.toFixed(2)}`;
    }

    debug.asset(info);

    obj.children.forEach(child => {
      this.logModelHierarchy(child, depth + 1);
    });
  }
}
