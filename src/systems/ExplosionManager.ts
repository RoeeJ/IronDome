import * as THREE from 'three';
import { InstancedExplosionRenderer } from '../rendering/InstancedExplosionRenderer';
import { MaterialCache } from '../utils/MaterialCache';
import { GeometryFactory } from '../utils/GeometryFactory';
import { debug } from '../utils/logger';
import { LightPool } from './LightPool';
import { SoundSystem } from './SoundSystem';

export enum ExplosionType {
  AIR_INTERCEPTION = 'air_interception',
  GROUND_IMPACT = 'ground_impact',
  DEBRIS_IMPACT = 'debris_impact',
  DRONE_DESTRUCTION = 'drone_destruction',
  AIR_BURST = 'air_burst',
}

export interface ExplosionConfig {
  type: ExplosionType;
  position: THREE.Vector3;
  radius: number;
  color?: number;
  intensity?: number;
  duration?: number;
  hasDebris?: boolean;
  hasFlash?: boolean;
  hasShockwave?: boolean;
  normal?: THREE.Vector3; // For oriented shockwaves
}

interface ExplosionInstance {
  id: string;
  config: ExplosionConfig;
  startTime: number;
  duration: number;
  flash?: THREE.PointLight;
  shockwave?: THREE.Mesh;
  normal?: THREE.Vector3;
  active: boolean;
}

/**
 * Centralized explosion management system that consolidates all explosion
 * creation and rendering through the instanced explosion renderer.
 * This eliminates duplicate explosion creation logic across the codebase.
 */
export class ExplosionManager {
  private static instance: ExplosionManager;
  private scene: THREE.Scene;
  private instancedRenderer: InstancedExplosionRenderer;
  private explosions = new Map<string, ExplosionInstance>();
  private nextId = 0;
  private lightPool: LightPool;
  private readonly MAX_SHOCKWAVES = 10; // Limit active shockwaves for performance

  // CHAINSAW: Instanced shockwave rendering
  private shockwaveInstancedMesh: THREE.InstancedMesh;
  private shockwaveInstances = new Map<
    string,
    {
      index: number;
      position: THREE.Vector3;
      radius: number;
      startTime: number;
      normal?: THREE.Vector3;
    }
  >();
  private availableShockwaveIndices: number[] = [];
  private shockwaveDummy = new THREE.Object3D();

  // Explosion type configurations
  private typeConfigs = {
    [ExplosionType.AIR_INTERCEPTION]: {
      color: 0xff6600,
      intensity: 2,
      duration: 1500,
      hasDebris: true,
      hasFlash: true,
      hasShockwave: true,
      flashIntensity: 100,
      flashColor: 0xffaa00,
    },
    [ExplosionType.GROUND_IMPACT]: {
      color: 0xff4400,
      intensity: 3,
      duration: 2000,
      hasDebris: true,
      hasFlash: true,
      hasShockwave: true,
      flashIntensity: 150,
      flashColor: 0xff6600,
    },
    [ExplosionType.DEBRIS_IMPACT]: {
      color: 0xff8800,
      intensity: 1,
      duration: 800,
      hasDebris: false,
      hasFlash: false,
      hasShockwave: false,
    },
    [ExplosionType.DRONE_DESTRUCTION]: {
      color: 0xffff00,
      intensity: 1.5,
      duration: 1200,
      hasDebris: true,
      hasFlash: true,
      hasShockwave: false,
      flashIntensity: 80,
      flashColor: 0xffff00,
    },
    [ExplosionType.AIR_BURST]: {
      color: new THREE.Color(0xffffff), // Bright white flash
      lightColor: new THREE.Color(0xffffff),
      lightIntensity: 8, // Very intense light
      scale: 1.5, // Large visual effect
      duration: 500, // Short duration
      hasDebris: false, // No debris
      hasShockwave: false, // No shockwave
      sound: 'air',
    },
  };

  private constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.instancedRenderer = new InstancedExplosionRenderer(scene);
    this.lightPool = LightPool.getInstance(scene, 20); // Support 20 simultaneous explosion lights

    // CHAINSAW: Initialize instanced shockwave mesh
    const shockwaveGeometry = GeometryFactory.getInstance().getRing(1, 1.2, 32, 1);
    const shockwaveMaterial = MaterialCache.getInstance().getMeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.shockwaveInstancedMesh = new THREE.InstancedMesh(
      shockwaveGeometry,
      shockwaveMaterial,
      this.MAX_SHOCKWAVES
    );
    this.shockwaveInstancedMesh.castShadow = false;
    this.shockwaveInstancedMesh.receiveShadow = false;

    // Initialize all instances as invisible
    const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.MAX_SHOCKWAVES; i++) {
      this.shockwaveInstancedMesh.setMatrixAt(i, zeroScale);
      this.availableShockwaveIndices.push(i);
    }
    this.shockwaveInstancedMesh.instanceMatrix.needsUpdate = true;

    this.scene.add(this.shockwaveInstancedMesh);
  }

  static getInstance(scene: THREE.Scene): ExplosionManager {
    if (!ExplosionManager.instance) {
      ExplosionManager.instance = new ExplosionManager(scene);
    }
    return ExplosionManager.instance;
  }

  /**
   * Create an explosion with the specified configuration
   */
  createExplosion(config: ExplosionConfig): string {
    const id = `explosion_${this.nextId++}`;
    const typeConfig = this.typeConfigs[config.type];

    // Merge type config with provided config
    const finalConfig: ExplosionConfig = {
      ...config,
      color: config.color ?? typeConfig.color,
      intensity: config.intensity ?? typeConfig.intensity,
      duration: config.duration ?? typeConfig.duration,
      hasDebris: config.hasDebris ?? typeConfig.hasDebris,
      hasFlash: config.hasFlash ?? typeConfig.hasFlash,
      hasShockwave: config.hasShockwave ?? typeConfig.hasShockwave,
      normal: config.normal,
    };

    const explosion: ExplosionInstance = {
      id,
      config: finalConfig,
      startTime: Date.now(),
      duration: finalConfig.duration || 1500,
      normal: finalConfig.normal,
      active: true,
    };

    // Add to instanced renderer - note: createExplosion doesn't return an index
    this.instancedRenderer.createExplosion(
      config.position,
      finalConfig.intensity || 1,
      config.type === ExplosionType.GROUND_IMPACT ? 'ground' : 'air'
    );

    // Play explosion sound
    const soundSystem = SoundSystem.getInstance();
    const explosionType =
      config.type === ExplosionType.GROUND_IMPACT
        ? 'ground'
        : config.type === ExplosionType.AIR_INTERCEPTION
          ? 'intercept'
          : 'air';
    soundSystem.playExplosion(explosionType, config.position);

    // Create flash effect if enabled
    if (finalConfig.hasFlash) {
      const flashColor = typeConfig.flashColor || finalConfig.color || 0xff6600;
      const flashIntensity = typeConfig.flashIntensity || 100;

      // Priority based on explosion type (ground impacts have higher priority)
      const priority = config.type === ExplosionType.GROUND_IMPACT ? 10 : 5;

      const light = this.lightPool.acquire(
        config.position,
        flashColor,
        flashIntensity,
        config.radius * 10,
        priority
      );

      if (light) {
        explosion.flash = light;
      }
    }

    // Create shockwave effect if enabled
    if (finalConfig.hasShockwave) {
      this.createShockwave(config.position, config.radius, config.type, finalConfig.normal);
    }

    // Trigger debris if enabled (handled by external debris system)
    if (finalConfig.hasDebris) {
      // Emit event for debris system to handle
      debug.category('Explosion', `Creating debris for explosion at`, config.position);
    }

    // Check for collateral damage to nearby threats and interceptors
    this.checkExplosionCollisions(config.position, config.radius * 2, config.type);

    this.explosions.set(id, explosion);

    // Trigger camera shake based on distance and explosion size
    const cameraController = (window as any).__cameraController;
    const camera = (window as any).__camera;
    if (cameraController && camera) {
      const distance = camera.position.distanceTo(config.position);
      const maxShakeDistance = config.radius * 20;

      if (distance < maxShakeDistance) {
        // Calculate shake intensity based on distance and explosion size
        const distanceFactor = 1 - distance / maxShakeDistance;
        const sizeFactor = config.radius / 20; // Normalize to standard explosion size
        const intensity = distanceFactor * sizeFactor * 2;

        cameraController.shake(intensity);
      }
    }

    debug.category('Explosion', `Created ${config.type} explosion:`, {
      id,
      position: config.position,
      radius: config.radius,
    });

    return id;
  }

  private checkExplosionCollisions(
    position: THREE.Vector3,
    blastRadius: number,
    explosionType: ExplosionType
  ): void {
    // Get threat manager and interception system
    const threatManager = (window as any).__threatManager;
    const interceptionSystem = (window as any).__interceptionSystem;

    if (!threatManager || !interceptionSystem) return;

    // Check threats
    const threats = threatManager.getActiveThreats();
    threats.forEach((threat: any) => {
      if (!threat.isActive) return;

      const distance = threat.getPosition().distanceTo(position);
      if (distance <= blastRadius) {
        // Calculate damage based on distance
        const damageFactor = 1 - distance / blastRadius;
        const damage = damageFactor * 100; // Max 100 damage at center

        if (damage > 50) {
          // Enough damage to destroy
          debug.category(
            'Explosion',
            `Explosion destroyed nearby threat at ${distance.toFixed(1)}m`
          );

          // Mark threat as intercepted by explosion
          threatManager.markThreatIntercepted(threat);

          // Create secondary explosion at threat location
          if (distance > 5) {
            // Avoid infinite explosion chain
            setTimeout(() => {
              this.createExplosion({
                type: ExplosionType.AIR_INTERCEPTION,
                position: threat.getPosition(),
                radius: 8,
              });
            }, 50);
          }
        }
      }
    });

    // Check interceptors
    const interceptors = interceptionSystem.getActiveInterceptors
      ? interceptionSystem.getActiveInterceptors()
      : [];
    interceptors.forEach((interceptor: any) => {
      const distance = interceptor.getPosition().distanceTo(position);
      if (distance <= blastRadius && distance > 2) {
        // Don't destroy self
        const damageFactor = 1 - distance / blastRadius;

        if (damageFactor > 0.3) {
          // 30% damage threshold
          debug.category(
            'Explosion',
            `Explosion destroyed nearby interceptor at ${distance.toFixed(1)}m`
          );

          // Detonate the interceptor
          if (interceptor.detonate) {
            interceptor.detonate();
          }
        }
      }
    });

    // Check batteries if ground explosion
    if (explosionType === ExplosionType.GROUND_IMPACT) {
      const batteries = (window as any).__domePlacementSystem?.getAllBatteries() || [];
      batteries.forEach((battery: any) => {
        if (!battery.isOperational()) return;

        const distance = battery.getPosition().distanceTo(position);
        if (distance <= blastRadius) {
          const damageFactor = 1 - distance / blastRadius;
          const damage = Math.ceil(damageFactor * 30); // Max 30 damage from explosion

          if (damage > 0) {
            battery.takeDamage(damage);
            debug.category(
              'Explosion',
              `Explosion damaged battery at ${distance.toFixed(1)}m for ${damage} damage`
            );
          }
        }
      });
    }

    // Check buildings for damage
    const buildingSystem = (window as any).__buildingSystem;
    if (buildingSystem) {
      buildingSystem.checkExplosionDamage(position, blastRadius);
    }
  }

  private createShockwave(
    position: THREE.Vector3,
    radius: number,
    explosionType?: ExplosionType,
    normal?: THREE.Vector3
  ): void {
    // Only create horizontal shockwaves for ground impacts
    if (explosionType && explosionType !== ExplosionType.GROUND_IMPACT && !normal) {
      return; // Skip shockwave for air explosions
    }

    // Only create shockwave if near ground level or if it's an oriented blast (e.g. building hit)
    if (position.y > 5 && !normal) {
      return; // Skip shockwave for explosions too high above ground
    }

    // CHAINSAW: Use instanced rendering for shockwaves
    if (this.availableShockwaveIndices.length === 0) {
      debug.log(`Skipping shockwave creation - max shockwaves (${this.MAX_SHOCKWAVES}) reached`);
      return;
    }

    // Check if there's already a shockwave nearby to prevent overlap
    const minShockwaveDistance = Math.max(5, radius * 0.5); // At least 5m apart
    for (const [id, instance] of this.shockwaveInstances) {
      const distance = Math.sqrt(
        Math.pow(instance.position.x - position.x, 2) +
          Math.pow(instance.position.z - position.z, 2)
      ); // Only check horizontal distance

      if (distance < minShockwaveDistance) {
        debug.log(
          `Skipping shockwave creation - too close to existing shockwave ${id} (${distance.toFixed(1)}m < ${minShockwaveDistance.toFixed(1)}m)`
        );
        return;
      }
    }

    const shockwaveId = `shockwave_${Date.now()}_${Math.random()}`;
    const index = this.availableShockwaveIndices.pop()!;

    // Store shockwave instance data
    this.shockwaveInstances.set(shockwaveId, {
      index,
      position: position.clone(),
      radius: radius * 2,
      startTime: Date.now(),
      normal: normal,
    });

    debug.log(
      `Shockwave ${shockwaveId} created at ${position.x.toFixed(1)}, ${position.z.toFixed(1)}`
    );
  }

  /**
   * Create explosion at threat impact
   */
  createImpactExplosion(position: THREE.Vector3, isGround: boolean): string {
    return this.createExplosion({
      type: isGround ? ExplosionType.GROUND_IMPACT : ExplosionType.AIR_INTERCEPTION,
      position,
      radius: isGround ? 15 : 10,
    });
  }

  /**
   * Create explosion for intercepted threat
   */
  createInterceptionExplosion(position: THREE.Vector3, threatRadius: number): string {
    return this.createExplosion({
      type: ExplosionType.AIR_INTERCEPTION,
      position,
      radius: Math.max(10, threatRadius * 3),
    });
  }

  /**
   * Update all active explosions
   */
  update(deltaTime: number): void {
    const currentTime = Date.now();

    // Update instanced renderer
    this.instancedRenderer.update(deltaTime);

    // CHAINSAW: Update instanced shockwaves
    const shockwaveDuration = 500; // 500ms for shockwave animation
    const toRemove: string[] = [];
    let needsUpdate = false;

    for (const [id, instance] of this.shockwaveInstances) {
      const elapsed = currentTime - instance.startTime;
      const progress = Math.min(elapsed / shockwaveDuration, 1);

      if (progress >= 1) {
        toRemove.push(id);
        continue;
      }

      // Update instance matrix
      const scale = 1 + (instance.radius - 1) * progress;
      this.shockwaveDummy.position.copy(instance.position);
      this.shockwaveDummy.quaternion.identity(); // Reset rotation

      if (instance.normal && Math.abs(instance.normal.y) < 0.99) {
        // Oriented shockwave for side hits
        this.shockwaveDummy.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          instance.normal
        );
      } else {
        // Horizontal shockwave for ground or top hits
        this.shockwaveDummy.rotation.x = -Math.PI / 2;
        if (!instance.normal) this.shockwaveDummy.position.y = 0.05 + Math.random() * 0.02; // Only adjust y for ground hits
      }
      this.shockwaveDummy.scale.set(scale, scale, 1);

      this.shockwaveDummy.updateMatrix();
      this.shockwaveInstancedMesh.setMatrixAt(instance.index, this.shockwaveDummy.matrix);

      // Update opacity through color
      const opacity = 0.5 * (1 - progress);
      const color = new THREE.Color(1, 1, 1).multiplyScalar(opacity * 2);
      this.shockwaveInstancedMesh.setColorAt(instance.index, color);

      needsUpdate = true;
    }

    // Update instance matrix if needed
    if (needsUpdate) {
      this.shockwaveInstancedMesh.instanceMatrix.needsUpdate = true;
      if (this.shockwaveInstancedMesh.instanceColor) {
        this.shockwaveInstancedMesh.instanceColor.needsUpdate = true;
      }
    }

    // Remove completed shockwaves
    for (const id of toRemove) {
      this.removeShockwave(id);
    }

    // Update individual explosions
    for (const [id, explosion] of this.explosions) {
      if (!explosion.active) continue;

      const elapsed = currentTime - explosion.startTime;
      const progress = elapsed / explosion.duration;

      // Update flash light
      if (explosion.flash) {
        const fadeStart = 0.1;
        if (progress > fadeStart) {
          const fadeProgress = (progress - fadeStart) / (1 - fadeStart);
          explosion.flash.intensity = explosion.flash.intensity * (1 - fadeProgress);
        }
      }

      // Remove completed explosions
      if (progress >= 1) {
        this.removeExplosion(id);
      }
    }
  }

  private removeShockwave(id: string): void {
    // CHAINSAW: Handle instanced shockwaves
    const instance = this.shockwaveInstances.get(id);
    if (!instance) {
      return;
    }

    // Hide the instance
    const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0);
    this.shockwaveInstancedMesh.setMatrixAt(instance.index, zeroScale);
    this.shockwaveInstancedMesh.instanceMatrix.needsUpdate = true;

    // Return index to pool
    this.availableShockwaveIndices.push(instance.index);
    this.shockwaveInstances.delete(id);

    debug.log(`Shockwave ${id} removed. Active shockwaves: ${this.shockwaveInstances.size}`);
  }

  private removeExplosion(id: string): void {
    const explosion = this.explosions.get(id);
    if (!explosion) return;

    // Note: InstancedExplosionRenderer manages its own lifecycle
    // We don't need to explicitly remove explosions

    // Return light to pool
    if (explosion.flash) {
      this.lightPool.release(explosion.flash);
    }

    explosion.active = false;
    this.explosions.delete(id);
  }

  /**
   * Get statistics about active explosions
   */
  getStats(): {
    activeExplosions: number;
    activeLights: number;
    availableLights: number;
    activeShockwaves: number;
  } {
    const lightStats = this.lightPool.getStats();
    return {
      activeExplosions: this.explosions.size,
      activeLights: lightStats.inUse,
      availableLights: lightStats.available,
      activeShockwaves: this.shockwaveInstances.size,
    };
  }

  /**
   * Clear all explosions
   */
  clear(): void {
    for (const id of this.explosions.keys()) {
      this.removeExplosion(id);
    }

    // CHAINSAW: Clean up all instanced shockwaves
    const shockwaveIds = Array.from(this.shockwaveInstances.keys());
    for (const id of shockwaveIds) {
      this.removeShockwave(id);
    }
    debug.log('All shockwaves cleared');

    this.instancedRenderer.clear();
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    this.clear();

    // LightPool will handle its own disposal

    // Dispose instanced renderer
    this.instancedRenderer.dispose();
  }
}
