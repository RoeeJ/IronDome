import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ProximityFuse } from '../systems/ProximityFuse';
import { ModelCache } from '../utils/ModelCache';
import { debug } from '../utils/logger';
import { ThrustVectorControl } from '../systems/ThrustVectorControl';
import { UnifiedTrailSystem, TrailType } from '../systems/UnifiedTrailSystem';
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
  thrustControl?: ThrustVectorControl;
  private scene: THREE.Scene;
  private failureMode: string;
  private failureTime: number;
  private launchTime: number;
  private hasFailed: boolean = false;
  private radius: number;
  private maxLifetime: number;
  private batteryPosition?: THREE.Vector3;
  private useInstancing: boolean = false;
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
      maxLifetime = isInterceptor ? 10 : 30, // 10s for interceptors, 30s for threats
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

    // Create mesh using missile model factory or instancing
    if (useInstancing && instanceManager) {
      // Use instanced rendering
      this.instanceId = instanceManager.allocateInstance(this.id, isInterceptor ? 'interceptor' : 'threat');
      if (this.instanceId !== null) {
        // Create dummy mesh for physics sync
        this.mesh = new THREE.Object3D() as any;
        this.mesh.position.copy(position);
        // Don't add to scene - it's rendered via instancing
      } else {
        // Fallback to regular mesh if instance allocation failed
        this.useInstancing = false;
      }
    }
    
    if (!useInstancing || this.instanceId === null) {
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

    // Create trail using UnifiedTrailSystem if available
    this.maxTrailLength = trailLength;
    this.trailPositions = [];

    // Try to use UnifiedTrailSystem first
    try {
      const unifiedTrail = UnifiedTrailSystem.getInstance(scene);
      unifiedTrail.createTrail(this.id, {
        type: TrailType.LINE, // Use line trails for both interceptors and threats
        color: color,
        maxPoints: trailLength * 2, // Double the trail length for better visual effect
        linewidth: isInterceptor ? 2 : 1,
        fadeOut: true,
      });
      this.useUnifiedTrail = true;

      // Create minimal dummy objects for compatibility - NO geometry, NO material, NOT in scene
      this.trailGeometry = null as any; // Set to null but typed as BufferGeometry for compatibility
      this.trail = null as any; // Set to null but typed as Line for compatibility
    } catch (e) {
      // Fallback to legacy trail
      this.trailGeometry = new THREE.BufferGeometry();
      const trailMaterial = MaterialCache.getInstance().getLineMaterial({
        color: color,
        opacity: 0.6,
        transparent: true,
      });
      this.trail = new THREE.Line(this.trailGeometry, trailMaterial);
      // Optimize: Trails don't need shadows
      this.trail.castShadow = false;
      this.trail.receiveShadow = false;
      scene.add(this.trail);
    }

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

    // Initialize exhaust trail system using UnifiedTrailSystem
    if (useExhaustTrail) {
      const exhaustTrailId = `exhaust_${this.id}`;
      const unifiedTrail = UnifiedTrailSystem.getInstance(scene);

      unifiedTrail.createTrail(exhaustTrailId, {
        type: TrailType.LINE,
        color: isInterceptor ? 0xffaa00 : 0xff6600,
        particleCount: 10,
        particleSize: 0.8,
        particleLifetime: 1.0,
        emissive: true,
        emissiveIntensity: 0.5,
      });

      this.exhaustTrailId = exhaustTrailId;
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

      // Stop exhaust trail
      if (this.exhaustTrailId) {
        const unifiedTrail = UnifiedTrailSystem.getInstance(this.scene);
        unifiedTrail.removeTrail(this.exhaustTrailId);
      }

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
        const dangerRadius = 15; // Self-destruct if landing within 15m of battery

        if (distanceToBattery < dangerRadius && position.y < 50) {
          // Only when low altitude
          debug.category(
            'Projectile',
            `Interceptor self-destructing to protect battery (${distanceToBattery.toFixed(
              1
            )}m from battery)`
          );

          // Trigger detonation
          if (this.detonationCallback) {
            this.detonationCallback(this.mesh.position.clone(), 0.5); // Medium quality explosion
          }

          // Stop exhaust trail
          if (this.exhaustTrailId) {
            const unifiedTrail = UnifiedTrailSystem.getInstance(this.scene);
            unifiedTrail.removeTrail(this.exhaustTrailId);
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
    
    // Update instance transform if using instancing
    if (this.useInstancing && this.instanceManager && this.instanceId !== null) {
      this.instanceManager.updateInstance(
        this.id,
        this.mesh.position,
        this.mesh.rotation,
        this.mesh.scale
      );
    }

    // Update trail
    if (this.useUnifiedTrail) {
      // Update unified trail system
      const unifiedTrail = UnifiedTrailSystem.getInstance(this.scene);
      unifiedTrail.updateTrail(this.id, this.mesh.position, this.getVelocity());
      // Skip all legacy trail updates when using unified system
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
      const unifiedTrail = UnifiedTrailSystem.getInstance(this.scene);
      unifiedTrail.updateTrail(this.exhaustTrailId, emitPosition, velocity);
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
          const unifiedTrail = UnifiedTrailSystem.getInstance(this.scene);
          unifiedTrail.removeTrail(this.exhaustTrailId);
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
    
    // Release instance if using instancing
    if (this.useInstancing && this.instanceManager && this.instanceId !== null) {
      this.instanceManager.releaseInstance(this.id);
    } else {
      // Only remove mesh if not using instancing
      scene.remove(this.mesh);
    }
    
    world.removeBody(this.body);

    // Remove from unified trail system if used
    if (this.useUnifiedTrail) {
      const unifiedTrail = UnifiedTrailSystem.getInstance(scene);
      unifiedTrail.removeTrail(this.id);
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
      const unifiedTrail = UnifiedTrailSystem.getInstance(scene);
      unifiedTrail.removeTrail(this.exhaustTrailId);
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
    const pitch = Math.atan2(velocity.y, Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z));
    
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
      case 'motor':
        // Motor failure - stop thrust, let gravity take over
        if (this.exhaustTrailId) {
          const unifiedTrail = UnifiedTrailSystem.getInstance(this.scene);
          unifiedTrail.removeTrail(this.exhaustTrailId);
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

      case 'guidance':
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
      debug.warning('setTargetPoint called with undefined targetPoint');
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
      debug.category('Guidance', `[SKIP] Speed too low: ${currentSpeed.toFixed(1)} m/s`);
      return;
    }

    // Check minimum travel distance before guidance kicks in
    const distanceTraveled = this.proximityFuse?.getDistanceTraveled() || 0;
    const minGuidanceDistance = 15; // Don't guide for first 15 meters
    if (distanceTraveled < minGuidanceDistance && !this.isReEngaging) {
      // Just orient the missile during launch phase
      this.orientMissile(currentVelocity);
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
    if (!this.isReEngaging && 
        this.minDistanceToTarget < 15 && // Got close but missed
        distance > this.lastTargetDistance && // Moving away from target
        distance > 10 && // Far enough to need re-engagement
        this.reEngagementAttempts < 1 && // Only try once
        currentSpeed > 50) { // Still have enough energy
      
      debug.category('Guidance', 
        `[RE-ENGAGE] Missed target! Min dist: ${this.minDistanceToTarget.toFixed(1)}m, ` +
        `Current: ${distance.toFixed(1)}m, Attempting turnaround`
      );
      
      this.isReEngaging = true;
      this.reEngagementAttempts++;
      this.minDistanceToTarget = Infinity; // Reset for new approach
    }
    
    this.lastTargetDistance = distance;

    // DEBUG: Log basic guidance info
    debug.category(
      'Guidance',
      `[UPDATE] Distance to target: ${distance.toFixed(
        1
      )}m, Speed: ${currentSpeed.toFixed(1)} m/s, Flight time: ${(
        (Date.now() - this.launchTime) /
        1000
      ).toFixed(1)}s`
    );

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

      // DEBUG: Log prediction details
      debug.category(
        'Guidance',
        `[PREDICTION] Target speed: ${targetSpeed.toFixed(
          1
        )} m/s, Time to impact: ${timeToImpact.toFixed(2)}s, Lead time: ${leadTime.toFixed(2)}s`
      );
    }

    // Calculate line of sight to predicted position
    const los = predictedTargetPos.clone().sub(myPos).normalize();

    // Simple proportional navigation
    const desiredVelocity = los.multiplyScalar(currentSpeed);
    const velocityError = desiredVelocity.clone().sub(currentVelocity);

    // Only guide if we're not too close (avoid overshooting)
    if (distance < 3) {
      debug.category(
        'Guidance',
        `[CLOSE RANGE] Distance < 5m, letting momentum carry - Distance: ${distance.toFixed(1)}m`
      );
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
      
      debug.category('Guidance', '[RE-ENGAGE] Using aggressive turn parameters');
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

    // DEBUG: Log forces
    debug.category(
      'Guidance',
      `[FORCES] Correction force: ${forceBeforeLimit.toFixed(1)}N (limited: ${correctionForce
        .length()
        .toFixed(1)}N), Max: ${maxForce.toFixed(1)}N`
    );

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
      debug.category(
        'Guidance',
        `[THRUST] Thrust force: ${thrustForce.toFixed(1)}N, Current speed: ${currentSpeed.toFixed(
          1
        )} m/s, Target: ${targetSpeed} m/s`
      );
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
        debug.category('Guidance', '[RE-ENGAGE] Successfully re-acquired target!');
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

    // Orient the missile model
    this.orientMissile(currentVelocity);
  }

  private orientMissile(velocity: THREE.Vector3): void {
    if (velocity.length() < 0.1) return;

    const direction = velocity.clone().normalize();

    // For GLTF models, we need to handle orientation differently
    if (this.mesh instanceof THREE.Group || this.mesh.type === 'Group') {
      // Use static debug values for model orientation
      const quaternion = new THREE.Quaternion().setFromUnitVectors(
        Projectile.modelForwardVector,
        direction
      );

      // Apply adjustment rotation
      const adjustmentQuat = new THREE.Quaternion().setFromEuler(
        Projectile.modelRotationAdjustment
      );
      quaternion.multiply(adjustmentQuat);

      this.mesh.quaternion.copy(quaternion);
    } else {
      // For procedural geometry (cone) - cone points up by default in Three.js
      const defaultForward = new THREE.Vector3(0, 1, 0); // Cone points along +Y
      const quaternion = new THREE.Quaternion().setFromUnitVectors(defaultForward, direction);
      this.mesh.quaternion.copy(quaternion);
    }

    // Add slight roll based on turn rate for realism
    if (this.isInterceptor) {
      const angularVel = this.body.angularVelocity;
      const rollAmount = Math.min(Math.max(-angularVel.y * 0.1, -0.5), 0.5);
      this.mesh.rotateZ(rollAmount);
    }
  }

  private async loadTamirModelOptimized(
    scene: THREE.Scene,
    scale: number,
    quality: string = 'ultra'
  ): Promise<void> {
    try {
      const modelCache = ModelCache.getInstance();
      // Choose model quality based on performance needs
      // Ultra simple: ~10% triangles, Simple: ~20% triangles
      const modelPath =
        quality === 'simple'
          ? 'assets/tamir/scene_simple.glb'
          : 'assets/tamir/scene_ultra_simple.glb';
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
      const targetSize = scale * 15; // Increased size - model might be too small
      const scaleFactor = maxDimension > 0 ? targetSize / maxDimension : 1;
      this.mesh.scale.setScalar(scaleFactor);
      debug.asset(
        'Scaling model',
        `${scaleFactor.toFixed(3)}x to target size ${targetSize.toFixed(2)}`
      );

      // Set initial rotation to match the cone's orientation
      this.mesh.rotation.x = Math.PI / 2; // Point forward

      // Remove any debug lines and apply materials
      const toRemove: THREE.Object3D[] = [];
      this.mesh.traverse(child => {
        // Remove any Line objects that might be in the model
        if (
          child instanceof THREE.Line ||
          child instanceof THREE.LineSegments ||
          child.name.toLowerCase().includes('helper') ||
          child.name.toLowerCase().includes('debug')
        ) {
          toRemove.push(child);
          debug.warn(`Removing debug object from projectile model: ${child.name} (${child.type})`);
        } else if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          child.frustumCulled = true; // Enable frustum culling
          child.visible = true; // Ensure visible

          // Simplify material for performance
          if (child.material) {
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach(material => {
              // Only modify properties that exist
              if ('metalness' in material) {
                material.metalness = 0.7;
              }
              if ('roughness' in material) {
                material.roughness = 0.3;
              }
              // Only set emissive if the property exists
              if ('emissive' in material && material.emissive) {
                material.emissive = new THREE.Color(0x0066ff);
              }
              if ('emissiveIntensity' in material) {
                material.emissiveIntensity = 0.2; // Increased for visibility
              }
              // Ensure material is visible
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

      // Remove any debug objects
      toRemove.forEach(obj => {
        if (obj.parent) {
          obj.parent.remove(obj);
        }
      });

      // Position and add to scene
      this.mesh.position.copy(this.body.position as any);
      scene.add(this.mesh);

      // Now remove old mesh after new one is added
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

      // Debug: Add a bright box to show where the model should be (disabled to prevent visual artifacts)
      // if (debug.isEnabled()) {
      //   const debugBox = new THREE.Mesh(
      //     new THREE.BoxGeometry(scale * 2, scale * 2, scale * 10),
      //     new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true })
      //   )
      //   debugBox.position.copy(this.mesh.position)
      //   debugBox.rotation.copy(this.mesh.rotation)
      //   scene.add(debugBox)
      //   setTimeout(() => scene.remove(debugBox), 5000) // Remove after 5 seconds
      // }
    } catch (error) {
      debug.error('Failed to load optimized Tamir model:', error);
      // Keep using the simple cone on error
    }
  }
}
