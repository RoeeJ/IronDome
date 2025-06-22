import * as THREE from 'three'
import { InstancedExplosionRenderer } from '../rendering/InstancedExplosionRenderer'
import { MaterialCache } from '../utils/MaterialCache'
import { GeometryFactory } from '../utils/GeometryFactory'
import { debug } from '../utils/DebugLogger'
import { LightPool } from './LightPool'

export enum ExplosionType {
  AIR_INTERCEPTION = 'air_interception',
  GROUND_IMPACT = 'ground_impact',
  DEBRIS_IMPACT = 'debris_impact',
  DRONE_DESTRUCTION = 'drone_destruction'
}

export interface ExplosionConfig {
  type: ExplosionType
  position: THREE.Vector3
  radius: number
  color?: number
  intensity?: number
  duration?: number
  hasDebris?: boolean
  hasFlash?: boolean
  hasShockwave?: boolean
}

interface ExplosionInstance {
  id: string
  config: ExplosionConfig
  startTime: number
  duration: number
  flash?: THREE.PointLight
  shockwave?: THREE.Mesh
  active: boolean
}

/**
 * Centralized explosion management system that consolidates all explosion
 * creation and rendering through the instanced explosion renderer.
 * This eliminates duplicate explosion creation logic across the codebase.
 */
export class ExplosionManager {
  private static instance: ExplosionManager
  private scene: THREE.Scene
  private instancedRenderer: InstancedExplosionRenderer
  private explosions = new Map<string, ExplosionInstance>()
  private nextId = 0
  private lightPool: LightPool
  
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
      flashColor: 0xffaa00
    },
    [ExplosionType.GROUND_IMPACT]: {
      color: 0xff4400,
      intensity: 3,
      duration: 2000,
      hasDebris: true,
      hasFlash: true,
      hasShockwave: true,
      flashIntensity: 150,
      flashColor: 0xff6600
    },
    [ExplosionType.DEBRIS_IMPACT]: {
      color: 0xff8800,
      intensity: 1,
      duration: 800,
      hasDebris: false,
      hasFlash: false,
      hasShockwave: false
    },
    [ExplosionType.DRONE_DESTRUCTION]: {
      color: 0xffff00,
      intensity: 1.5,
      duration: 1200,
      hasDebris: true,
      hasFlash: true,
      hasShockwave: false,
      flashIntensity: 80,
      flashColor: 0xffff00
    }
  }
  
  private constructor(scene: THREE.Scene) {
    this.scene = scene
    this.instancedRenderer = new InstancedExplosionRenderer(scene)
    this.lightPool = LightPool.getInstance(scene, 20) // Support 20 simultaneous explosion lights
  }
  
  static getInstance(scene: THREE.Scene): ExplosionManager {
    if (!ExplosionManager.instance) {
      ExplosionManager.instance = new ExplosionManager(scene)
    }
    return ExplosionManager.instance
  }
  
  
  /**
   * Create an explosion with the specified configuration
   */
  createExplosion(config: ExplosionConfig): string {
    const id = `explosion_${this.nextId++}`
    const typeConfig = this.typeConfigs[config.type]
    
    // Merge type config with provided config
    const finalConfig: ExplosionConfig = {
      ...config,
      color: config.color ?? typeConfig.color,
      intensity: config.intensity ?? typeConfig.intensity,
      duration: config.duration ?? typeConfig.duration,
      hasDebris: config.hasDebris ?? typeConfig.hasDebris,
      hasFlash: config.hasFlash ?? typeConfig.hasFlash,
      hasShockwave: config.hasShockwave ?? typeConfig.hasShockwave
    }
    
    const explosion: ExplosionInstance = {
      id,
      config: finalConfig,
      startTime: Date.now(),
      duration: finalConfig.duration || 1500,
      active: true
    }
    
    // Add to instanced renderer - note: createExplosion doesn't return an index
    this.instancedRenderer.createExplosion(
      config.position,
      finalConfig.intensity || 1,
      config.type === ExplosionType.GROUND_IMPACT ? 'ground' : 'air'
    )
    
    // Create flash effect if enabled
    if (finalConfig.hasFlash) {
      const flashColor = typeConfig.flashColor || finalConfig.color || 0xff6600
      const flashIntensity = typeConfig.flashIntensity || 100
      
      // Priority based on explosion type (ground impacts have higher priority)
      const priority = config.type === ExplosionType.GROUND_IMPACT ? 10 : 5
      
      const light = this.lightPool.acquire(
        config.position,
        flashColor,
        flashIntensity,
        config.radius * 10,
        priority
      )
      
      if (light) {
        explosion.flash = light
      }
    }
    
    // Create shockwave effect if enabled
    if (finalConfig.hasShockwave) {
      this.createShockwave(config.position, config.radius, config.type)
    }
    
    // Trigger debris if enabled (handled by external debris system)
    if (finalConfig.hasDebris) {
      // Emit event for debris system to handle
      debug.category('Explosion', `Creating debris for explosion at`, config.position)
    }
    
    this.explosions.set(id, explosion)
    
    debug.category('Explosion', `Created ${config.type} explosion:`, {
      id,
      position: config.position,
      radius: config.radius
    })
    
    return id
  }
  
  
  private createShockwave(position: THREE.Vector3, radius: number, explosionType?: ExplosionType): void {
    // Only create horizontal shockwaves for ground impacts
    if (explosionType && explosionType !== ExplosionType.GROUND_IMPACT) {
      return  // Skip shockwave for air explosions
    }
    
    const geometry = GeometryFactory.getInstance().getRing(0, radius * 2, 32, 1)
    const material = MaterialCache.getInstance().getMeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
    
    const shockwave = new THREE.Mesh(geometry, material)
    shockwave.position.copy(position)
    shockwave.rotation.x = -Math.PI / 2  // Horizontal for ground impacts
    this.scene.add(shockwave)
    
    // Animate shockwave expansion
    const startTime = Date.now()
    const duration = 500
    
    const animate = () => {
      const elapsed = Date.now() - startTime
      const progress = Math.min(elapsed / duration, 1)
      
      const scale = 1 + progress * 3
      shockwave.scale.set(scale, scale, 1)
      
      const opacity = 0.5 * (1 - progress)
      ;(shockwave.material as THREE.MeshBasicMaterial).opacity = opacity
      
      if (progress < 1) {
        requestAnimationFrame(animate)
      } else {
        this.scene.remove(shockwave)
      }
    }
    
    animate()
  }
  
  /**
   * Create explosion at threat impact
   */
  createImpactExplosion(position: THREE.Vector3, isGround: boolean): string {
    return this.createExplosion({
      type: isGround ? ExplosionType.GROUND_IMPACT : ExplosionType.AIR_INTERCEPTION,
      position,
      radius: isGround ? 15 : 10
    })
  }
  
  /**
   * Create explosion for intercepted threat
   */
  createInterceptionExplosion(position: THREE.Vector3, threatRadius: number): string {
    return this.createExplosion({
      type: ExplosionType.AIR_INTERCEPTION,
      position,
      radius: Math.max(10, threatRadius * 3)
    })
  }
  
  /**
   * Update all active explosions
   */
  update(deltaTime: number): void {
    const currentTime = Date.now()
    
    // Update instanced renderer
    this.instancedRenderer.update(deltaTime)
    
    // Update individual explosions
    for (const [id, explosion] of this.explosions) {
      if (!explosion.active) continue
      
      const elapsed = currentTime - explosion.startTime
      const progress = elapsed / explosion.duration
      
      // Update flash light
      if (explosion.flash) {
        const fadeStart = 0.1
        if (progress > fadeStart) {
          const fadeProgress = (progress - fadeStart) / (1 - fadeStart)
          explosion.flash.intensity = explosion.flash.intensity * (1 - fadeProgress)
        }
      }
      
      // Remove completed explosions
      if (progress >= 1) {
        this.removeExplosion(id)
      }
    }
  }
  
  private removeExplosion(id: string): void {
    const explosion = this.explosions.get(id)
    if (!explosion) return
    
    // Note: InstancedExplosionRenderer manages its own lifecycle
    // We don't need to explicitly remove explosions
    
    // Return light to pool
    if (explosion.flash) {
      this.lightPool.release(explosion.flash)
    }
    
    explosion.active = false
    this.explosions.delete(id)
  }
  
  /**
   * Get statistics about active explosions
   */
  getStats(): {
    activeExplosions: number
    activeLights: number
    availableLights: number
  } {
    const lightStats = this.lightPool.getStats()
    return {
      activeExplosions: this.explosions.size,
      activeLights: lightStats.inUse,
      availableLights: lightStats.available
    }
  }
  
  /**
   * Clear all explosions
   */
  clear(): void {
    for (const id of this.explosions.keys()) {
      this.removeExplosion(id)
    }
    
    this.instancedRenderer.clear()
  }
  
  /**
   * Dispose of all resources
   */
  dispose(): void {
    this.clear()
    
    // LightPool will handle its own disposal
    
    // Dispose instanced renderer
    this.instancedRenderer.dispose()
  }
}