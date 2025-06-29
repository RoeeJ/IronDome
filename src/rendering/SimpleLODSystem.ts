import * as THREE from 'three';
import { debug } from '../utils/logger';

interface LODConfig {
  distances: number[]; // Distance thresholds for each LOD level
  particleReduction: number[]; // Particle count multipliers per level (1.0 = full, 0.5 = half)
  effectReduction: number[]; // Effect quality multipliers per level
  shadowDistance: number; // Max distance for shadow casting
  updateInterval: number; // How often to update LOD (ms)
}

interface LODObject {
  id: string;
  object: THREE.Object3D;
  baseQuality: number;
  currentLOD: number;
  lastUpdate: number;
}

/**
 * Simple LOD system for managing level of detail based on camera distance.
 * Reduces particle counts, effect quality, and disables features at distance.
 */
export class SimpleLODSystem {
  private static instance: SimpleLODSystem;
  private camera: THREE.Camera;
  private objects = new Map<string, LODObject>();
  private lastUpdateTime = 0;

  // Default LOD configuration
  private config: LODConfig = {
    distances: [0, 50, 150, 300, 500], // LOD levels at these distances
    particleReduction: [1.0, 0.7, 0.4, 0.2, 0.0], // Particle multipliers
    effectReduction: [1.0, 0.8, 0.5, 0.3, 0.0], // Effect quality multipliers
    shadowDistance: 150, // Only cast shadows within 150m
    updateInterval: 100, // Update every 100ms
  };

  // Performance metrics
  private stats = {
    totalObjects: 0,
    lodCounts: [0, 0, 0, 0, 0], // Count per LOD level
    particleSavings: 0,
  };

  private constructor(camera: THREE.Camera) {
    this.camera = camera;
  }

  static getInstance(camera: THREE.Camera): SimpleLODSystem {
    if (!SimpleLODSystem.instance) {
      SimpleLODSystem.instance = new SimpleLODSystem(camera);
    }
    return SimpleLODSystem.instance;
  }

  /**
   * Register an object for LOD management
   */
  registerObject(id: string, object: THREE.Object3D, baseQuality: number = 1.0): void {
    this.objects.set(id, {
      id,
      object,
      baseQuality,
      currentLOD: 0,
      lastUpdate: 0,
    });

    this.stats.totalObjects = this.objects.size;
  }

  /**
   * Unregister an object from LOD management
   */
  unregisterObject(id: string): void {
    this.objects.delete(id);
    this.stats.totalObjects = this.objects.size;
  }

  /**
   * Get the particle count multiplier for a given distance
   */
  getParticleMultiplier(distance: number): number {
    const lodLevel = this.calculateLODLevel(distance);
    return this.config.particleReduction[lodLevel];
  }

  /**
   * Get the effect quality multiplier for a given distance
   */
  getEffectQuality(distance: number): number {
    const lodLevel = this.calculateLODLevel(distance);
    return this.config.effectReduction[lodLevel];
  }

  /**
   * Check if shadows should be enabled at a given distance
   */
  shouldCastShadows(distance: number): boolean {
    return distance <= this.config.shadowDistance;
  }

  /**
   * Calculate appropriate number of particles based on distance
   */
  calculateParticleCount(baseCount: number, distance: number): number {
    const multiplier = this.getParticleMultiplier(distance);
    return Math.max(1, Math.floor(baseCount * multiplier));
  }

  /**
   * Calculate appropriate explosion radius based on distance
   */
  calculateEffectRadius(baseRadius: number, distance: number): number {
    const quality = this.getEffectQuality(distance);
    return baseRadius * (0.5 + 0.5 * quality); // Minimum 50% radius
  }

  /**
   * Update all registered objects - call this in the render loop
   */
  update(): void {
    const now = Date.now();
    if (now - this.lastUpdateTime < this.config.updateInterval) return;

    this.lastUpdateTime = now;
    const cameraPos = this.camera.position;

    // Reset stats
    this.stats.lodCounts.fill(0);
    this.stats.particleSavings = 0;

    this.objects.forEach(lodObject => {
      // Skip if recently updated
      if (now - lodObject.lastUpdate < this.config.updateInterval * 2) return;

      const distance = lodObject.object.position.distanceTo(cameraPos);
      const newLOD = this.calculateLODLevel(distance);

      // Only update if LOD changed
      if (newLOD !== lodObject.currentLOD) {
        this.applyLODLevel(lodObject, newLOD, distance);
        lodObject.currentLOD = newLOD;
      }

      lodObject.lastUpdate = now;
      this.stats.lodCounts[newLOD]++;
    });
  }

  private calculateLODLevel(distance: number): number {
    for (let i = this.config.distances.length - 1; i >= 0; i--) {
      if (distance >= this.config.distances[i]) {
        return i;
      }
    }
    return 0;
  }

  private applyLODLevel(lodObject: LODObject, level: number, distance: number): void {
    const object = lodObject.object;

    // Update visibility based on LOD
    if (level >= this.config.particleReduction.length - 1) {
      // Furthest LOD - hide object
      object.visible = false;
      return;
    }

    object.visible = true;

    // Update shadow casting
    object.traverse(child => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = distance <= this.config.shadowDistance;

        // Reduce geometry detail for far objects
        if (level >= 3 && child.geometry instanceof THREE.BufferGeometry) {
          // Could implement geometry simplification here
        }
      }
    });

    // Handle specific object types
    if (object.userData.type === 'explosion') {
      this.updateExplosionLOD(object, level);
    } else if (object.userData.type === 'projectile') {
      this.updateProjectileLOD(object, level);
    } else if (object.userData.type === 'building') {
      this.updateBuildingLOD(object, level);
    }
  }

  private updateExplosionLOD(object: THREE.Object3D, level: number): void {
    // Reduce particle count for explosions
    if (object.userData.particleSystem) {
      const baseCount = object.userData.baseParticleCount || 100;
      const newCount = this.calculateParticleCount(baseCount, level * 100);
      object.userData.particleSystem.setParticleCount(newCount);

      this.stats.particleSavings += baseCount - newCount;
    }
  }

  private updateProjectileLOD(object: THREE.Object3D, level: number): void {
    // Disable trails for distant projectiles
    if (level >= 2 && object.userData.trail) {
      object.userData.trail.visible = false;
    } else if (object.userData.trail) {
      object.userData.trail.visible = true;
    }

    // Disable exhaust effects for very distant projectiles
    if (level >= 3 && object.userData.exhaust) {
      object.userData.exhaust.visible = false;
    }
  }

  private updateBuildingLOD(object: THREE.Object3D, level: number): void {
    // Hide windows for distant buildings
    if (level >= 2) {
      object.traverse(child => {
        if (child.name.includes('window')) {
          child.visible = false;
        }
      });
    }

    // Use simpler material for very distant buildings
    if (level >= 3) {
      object.traverse(child => {
        if (child instanceof THREE.Mesh && child.material) {
          // Could swap to simpler material here
        }
      });
    }
  }

  /**
   * Get LOD system statistics
   */
  getStats(): {
    totalObjects: number;
    lodDistribution: number[];
    particleSavings: number;
    shadowedObjects: number;
  } {
    let shadowedObjects = 0;
    const cameraPos = this.camera.position;

    this.objects.forEach(lodObject => {
      const distance = lodObject.object.position.distanceTo(cameraPos);
      if (distance <= this.config.shadowDistance) {
        shadowedObjects++;
      }
    });

    return {
      totalObjects: this.stats.totalObjects,
      lodDistribution: [...this.stats.lodCounts],
      particleSavings: this.stats.particleSavings,
      shadowedObjects,
    };
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<LODConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Force update all objects (useful after config change)
   */
  forceUpdateAll(): void {
    const cameraPos = this.camera.position;

    this.objects.forEach(lodObject => {
      const distance = lodObject.object.position.distanceTo(cameraPos);
      const newLOD = this.calculateLODLevel(distance);
      this.applyLODLevel(lodObject, newLOD, distance);
      lodObject.currentLOD = newLOD;
      lodObject.lastUpdate = Date.now();
    });
  }
}
