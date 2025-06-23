import * as THREE from 'three';

interface PooledLight {
  light: THREE.PointLight;
  inUse: boolean;
  priority: number;
  timeAllocated: number;
}

export class LightPool {
  private static instance: LightPool;
  private pool: PooledLight[] = [];
  private scene: THREE.Scene;
  private maxLights: number;
  private defaultIntensity: number = 2;
  private defaultDistance: number = 100;
  private defaultDecay: number = 2;

  private constructor(scene: THREE.Scene, maxLights: number = 10) {
    this.scene = scene;
    this.maxLights = maxLights;
    this.initializePool();
  }

  static getInstance(scene?: THREE.Scene, maxLights?: number): LightPool {
    if (!LightPool.instance) {
      if (!scene) {
        throw new Error('Scene required for first initialization');
      }
      LightPool.instance = new LightPool(scene, maxLights);
    }
    return LightPool.instance;
  }

  private initializePool(): void {
    for (let i = 0; i < this.maxLights; i++) {
      const light = new THREE.PointLight(0xffffff, 0, this.defaultDistance, this.defaultDecay);
      light.visible = false;
      this.scene.add(light);

      this.pool.push({
        light,
        inUse: false,
        priority: 0,
        timeAllocated: 0,
      });
    }
  }

  /**
   * Acquire a light from the pool
   * @param position - Position to place the light
   * @param color - Light color
   * @param intensity - Light intensity
   * @param distance - Light distance
   * @param priority - Priority for light allocation (higher = more important)
   * @returns The allocated light or null if none available
   */
  acquire(
    position: THREE.Vector3,
    color: THREE.Color | number = 0xffffff,
    intensity: number = this.defaultIntensity,
    distance: number = this.defaultDistance,
    priority: number = 1
  ): THREE.PointLight | null {
    // First try to find an unused light
    let pooledLight = this.pool.find(pl => !pl.inUse);

    // If no unused lights, try to steal one with lower priority
    if (!pooledLight) {
      const now = performance.now();
      pooledLight = this.pool
        .filter(pl => pl.priority < priority || now - pl.timeAllocated > 1000) // 1 second timeout
        .sort((a, b) => a.priority - b.priority)[0];
    }

    if (!pooledLight) {
      return null; // No lights available
    }

    // Configure and activate the light
    const light = pooledLight.light;
    light.position.copy(position);
    light.color = color instanceof THREE.Color ? color : new THREE.Color(color);
    light.intensity = intensity;
    light.distance = distance;
    light.visible = true;

    // Update pool entry
    pooledLight.inUse = true;
    pooledLight.priority = priority;
    pooledLight.timeAllocated = performance.now();

    return light;
  }

  /**
   * Release a light back to the pool
   * @param light - The light to release
   */
  release(light: THREE.PointLight): void {
    const pooledLight = this.pool.find(pl => pl.light === light);
    if (pooledLight) {
      pooledLight.inUse = false;
      pooledLight.priority = 0;
      pooledLight.timeAllocated = 0;
      light.visible = false;
      light.intensity = 0;
    }
  }

  /**
   * Release all lights back to the pool
   */
  releaseAll(): void {
    this.pool.forEach(pooledLight => {
      pooledLight.inUse = false;
      pooledLight.priority = 0;
      pooledLight.timeAllocated = 0;
      pooledLight.light.visible = false;
      pooledLight.light.intensity = 0;
    });
  }

  /**
   * Get current pool statistics
   */
  getStats(): { total: number; inUse: number; available: number } {
    const inUse = this.pool.filter(pl => pl.inUse).length;
    return {
      total: this.maxLights,
      inUse,
      available: this.maxLights - inUse,
    };
  }

  /**
   * Update pool size dynamically
   * @param newSize - New maximum number of lights
   */
  resize(newSize: number): void {
    if (newSize > this.maxLights) {
      // Add more lights
      for (let i = this.maxLights; i < newSize; i++) {
        const light = new THREE.PointLight(0xffffff, 0, this.defaultDistance, this.defaultDecay);
        light.visible = false;
        this.scene.add(light);

        this.pool.push({
          light,
          inUse: false,
          priority: 0,
          timeAllocated: 0,
        });
      }
    } else if (newSize < this.maxLights) {
      // Remove excess lights
      const toRemove = this.maxLights - newSize;
      for (let i = 0; i < toRemove; i++) {
        const pooledLight = this.pool.pop();
        if (pooledLight) {
          this.scene.remove(pooledLight.light);
          pooledLight.light.dispose();
        }
      }
    }

    this.maxLights = newSize;
  }

  /**
   * Clean up the light pool
   */
  dispose(): void {
    this.pool.forEach(pooledLight => {
      this.scene.remove(pooledLight.light);
      pooledLight.light.dispose();
    });
    this.pool = [];
  }
}
