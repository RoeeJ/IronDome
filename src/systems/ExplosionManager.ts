import * as THREE from 'three';
import { InstancedExplosionRenderer } from '../rendering/InstancedExplosionRenderer';
import { MaterialCache } from '../utils/MaterialCache';
import { GeometryFactory } from '../utils/GeometryFactory';
import { debug } from '../utils/logger';
import { LightPool } from './LightPool';

export enum ExplosionType {
  AIR_INTERCEPTION = 'air_interception',
  GROUND_IMPACT = 'ground_impact',
  DEBRIS_IMPACT = 'debris_impact',
  DRONE_DESTRUCTION = 'drone_destruction',
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
}

interface ExplosionInstance {
  id: string;
  config: ExplosionConfig;
  startTime: number;
  duration: number;
  flash?: THREE.PointLight;
  shockwave?: THREE.Mesh;
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
  private activeShockwaves = new Map<
    string,
    { mesh: THREE.Mesh; material: THREE.Material; startTime: number }
  >();
  private readonly MAX_SHOCKWAVES = 10; // Limit active shockwaves for performance

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
  };

  private constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.instancedRenderer = new InstancedExplosionRenderer(scene);
    this.lightPool = LightPool.getInstance(scene, 20); // Support 20 simultaneous explosion lights
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
    };

    const explosion: ExplosionInstance = {
      id,
      config: finalConfig,
      startTime: Date.now(),
      duration: finalConfig.duration || 1500,
      active: true,
    };

    // Add to instanced renderer - note: createExplosion doesn't return an index
    this.instancedRenderer.createExplosion(
      config.position,
      finalConfig.intensity || 1,
      config.type === ExplosionType.GROUND_IMPACT ? 'ground' : 'air'
    );

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
      this.createShockwave(config.position, config.radius, config.type);
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
    explosionType?: ExplosionType
  ): void {
    // Only create horizontal shockwaves for ground impacts
    if (explosionType && explosionType !== ExplosionType.GROUND_IMPACT) {
      return; // Skip shockwave for air explosions
    }

    // Only create shockwave if near ground level
    if (position.y > 5) {
      return; // Skip shockwave for explosions too high above ground
    }

    // Limit total number of shockwaves
    if (this.activeShockwaves.size >= this.MAX_SHOCKWAVES) {
      debug.log(`Skipping shockwave creation - max shockwaves (${this.MAX_SHOCKWAVES}) reached`);
      return;
    }

    // Check if there's already a shockwave nearby to prevent overlap
    const minShockwaveDistance = Math.max(5, radius * 0.5); // At least 5m apart
    for (const [id, shockwaveData] of this.activeShockwaves) {
      // Use stored position for comparison (handles both placeholder and actual mesh)
      const otherPos = shockwaveData.mesh.position;
      const distance = Math.sqrt(
        Math.pow(otherPos.x - position.x, 2) + Math.pow(otherPos.z - position.z, 2)
      ); // Only check horizontal distance

      if (distance < minShockwaveDistance) {
        debug.log(
          `Skipping shockwave creation - too close to existing shockwave ${id} (${distance.toFixed(1)}m < ${minShockwaveDistance.toFixed(1)}m)`
        );
        return;
      }
    }

    // Create unique ID first to ensure atomicity
    const shockwaveId = `shockwave_${Date.now()}_${Math.random()}`;

    // Reserve the position immediately to prevent race conditions
    const placeholder = {
      mesh: { position: position.clone() } as any,
      material: null as any,
      startTime: Date.now(),
    };
    this.activeShockwaves.set(shockwaveId, placeholder);

    // Now create the actual shockwave
    const geometry = GeometryFactory.getInstance().getRing(0, radius * 2, 32, 1);
    // Clone material to allow independent opacity animation
    const baseMaterial = MaterialCache.getInstance().getMeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const material = baseMaterial.clone();

    const shockwave = new THREE.Mesh(geometry, material);
    shockwave.position.copy(position);
    shockwave.position.y = 0.05 + Math.random() * 0.02; // Slight random height to prevent Z-fighting
    shockwave.rotation.x = -Math.PI / 2; // Horizontal for ground impacts
    
    // Optimize: Shockwaves don't need shadows
    shockwave.castShadow = false;
    shockwave.receiveShadow = false;

    // Add unique identifier to mesh for debugging
    shockwave.userData.shockwaveId = shockwaveId;

    this.scene.add(shockwave);

    // Update with actual data
    this.activeShockwaves.set(shockwaveId, {
      mesh: shockwave,
      material: material,
      startTime: placeholder.startTime,
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

    // Update shockwaves
    const shockwaveDuration = 500; // 500ms for shockwave animation
    const toRemove: string[] = [];

    for (const [id, shockwaveData] of this.activeShockwaves) {
      // Skip if placeholder (not fully initialized)
      if (!shockwaveData.material || !shockwaveData.mesh.geometry) {
        continue;
      }

      const elapsed = currentTime - shockwaveData.startTime;
      const progress = Math.min(elapsed / shockwaveDuration, 1);

      // Update scale and opacity only if mesh is still in scene
      if (shockwaveData.mesh.parent) {
        const scale = 1 + progress * 3;
        shockwaveData.mesh.scale.set(scale, scale, 1);
        shockwaveData.material.opacity = 0.5 * (1 - progress);
      }

      // Mark for removal if complete
      if (progress >= 1) {
        toRemove.push(id);
      }
    }

    // Remove completed shockwaves atomically
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
    const shockwaveData = this.activeShockwaves.get(id);
    if (!shockwaveData) {
      return;
    }

    // Remove from map first to prevent concurrent access
    this.activeShockwaves.delete(id);

    // Then clean up resources
    try {
      if (shockwaveData.mesh && shockwaveData.mesh.parent) {
        this.scene.remove(shockwaveData.mesh);
      }
      if (shockwaveData.material) {
        shockwaveData.material.dispose();
      }
    } catch (error) {
      debug.error(`Error removing shockwave ${id}:`, error);
    }

    debug.log(`Shockwave ${id} removed. Active shockwaves: ${this.activeShockwaves.size}`);
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
      activeShockwaves: this.activeShockwaves.size,
    };
  }

  /**
   * Clear all explosions
   */
  clear(): void {
    for (const id of this.explosions.keys()) {
      this.removeExplosion(id);
    }

    // Clean up all shockwaves atomically
    const shockwaveIds = Array.from(this.activeShockwaves.keys());
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
