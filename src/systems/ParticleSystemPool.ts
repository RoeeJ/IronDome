import * as THREE from 'three'
import { ExhaustTrailSystem } from './ExhaustTrailSystem'

/**
 * Manages a pool of particle systems to reduce draw calls
 * Instead of each projectile having its own particle system,
 * we use a shared pool with larger capacity
 */
export class ParticleSystemPool {
  private static instance: ParticleSystemPool
  private scene: THREE.Scene
  private interceptorPool: ExhaustTrailSystem
  private missilePool: ExhaustTrailSystem
  private activeEmitters: Map<string, {
    position: THREE.Vector3
    velocity: THREE.Vector3
    type: 'interceptor' | 'missile'
    lastEmit: number
  }> = new Map()
  
  private constructor(scene: THREE.Scene) {
    this.scene = scene
    
    // Create larger shared particle systems
    this.interceptorPool = new ExhaustTrailSystem(scene, {
      particleCount: 1000,  // Shared pool for all interceptors
      particleSize: 0.8,
      particleLifetime: 0.8,
      emissionRate: 50,
      startColor: new THREE.Color(0x00ffff),
      endColor: new THREE.Color(0x0066aa),
      startOpacity: 0.6,
      endOpacity: 0,
      spread: 0.2,
      velocityFactor: -0.8,
      gravity: false
    })
    
    this.missilePool = new ExhaustTrailSystem(scene, {
      particleCount: 800,  // Shared pool for all missiles
      particleSize: 1.0,
      particleLifetime: 1.0,
      emissionRate: 40,
      startColor: new THREE.Color(0xffcc00),
      endColor: new THREE.Color(0x444444),
      startOpacity: 0.8,
      endOpacity: 0.1,
      spread: 0.3,
      velocityFactor: -0.5,
      gravity: true,
      windEffect: true
    })
  }
  
  static getInstance(scene: THREE.Scene): ParticleSystemPool {
    if (!ParticleSystemPool.instance) {
      ParticleSystemPool.instance = new ParticleSystemPool(scene)
    }
    return ParticleSystemPool.instance
  }
  
  registerEmitter(
    id: string, 
    type: 'interceptor' | 'missile',
    position: THREE.Vector3,
    velocity: THREE.Vector3
  ): void {
    this.activeEmitters.set(id, {
      position: position.clone(),
      velocity: velocity.clone(),
      type,
      lastEmit: 0
    })
  }
  
  updateEmitter(
    id: string,
    position: THREE.Vector3,
    velocity: THREE.Vector3
  ): void {
    const emitter = this.activeEmitters.get(id)
    if (emitter) {
      emitter.position.copy(position)
      emitter.velocity.copy(velocity)
    }
  }
  
  removeEmitter(id: string): void {
    this.activeEmitters.delete(id)
  }
  
  update(deltaTime: number, camera: THREE.Camera): void {
    const currentTime = Date.now()
    
    // Emit from all active emitters
    for (const [id, emitter] of this.activeEmitters) {
      const pool = emitter.type === 'interceptor' ? this.interceptorPool : this.missilePool
      
      // LOD check
      const distance = emitter.position.distanceTo(camera.position)
      if (distance > 200) continue
      
      // Emit particles
      pool.emit(emitter.position, emitter.velocity, currentTime, camera)
    }
    
    // Update particle systems
    this.interceptorPool.update(deltaTime)
    this.missilePool.update(deltaTime)
  }
  
  getStats(): { interceptors: number, missiles: number, totalParticles: number } {
    return {
      interceptors: Array.from(this.activeEmitters.values()).filter(e => e.type === 'interceptor').length,
      missiles: Array.from(this.activeEmitters.values()).filter(e => e.type === 'missile').length,
      totalParticles: this.interceptorPool.getParticleCount() + this.missilePool.getParticleCount()
    }
  }
  
  dispose(): void {
    this.interceptorPool.dispose()
    this.missilePool.dispose()
    this.activeEmitters.clear()
  }
}