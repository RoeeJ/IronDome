import * as THREE from 'three'
import { debug } from '../utils/DebugLogger'

export interface ProximityFuseConfig {
  armingDistance: number      // Minimum distance before fuse arms (meters)
  detonationRadius: number    // Maximum distance for detonation (meters)
  optimalRadius: number       // Optimal detonation distance (meters)
  scanRate: number           // How often to check proximity (ms)
}

export class ProximityFuse {
  private config: ProximityFuseConfig
  private armed: boolean = false
  private detonated: boolean = false
  private distanceTraveled: number = 0
  private lastPosition: THREE.Vector3
  private lastScanTime: number = 0

  constructor(startPosition: THREE.Vector3, config: Partial<ProximityFuseConfig> = {}) {
    this.config = {
      armingDistance: 50,      // Arms after 50m of flight
      detonationRadius: 10,    // Detonates within 10m
      optimalRadius: 5,        // Best detonation at 5m
      scanRate: 16,           // Check every frame (~60fps)
      ...config
    }
    
    this.lastPosition = startPosition.clone()
  }

  update(
    currentPosition: THREE.Vector3, 
    targetPosition: THREE.Vector3,
    deltaTime: number,
    currentTime: number
  ): { shouldDetonate: boolean; detonationQuality: number } {
    // Update distance traveled
    const distanceThisFrame = currentPosition.distanceTo(this.lastPosition)
    this.distanceTraveled += distanceThisFrame
    this.lastPosition.copy(currentPosition)

    // Check if fuse should arm
    if (!this.armed && this.distanceTraveled >= this.config.armingDistance) {
      this.armed = true
      debug.category('ProximityFuse', 'Armed at distance:', this.distanceTraveled)
    }

    // Don't check for detonation if not armed or already detonated
    if (!this.armed || this.detonated) {
      return { shouldDetonate: false, detonationQuality: 0 }
    }

    // Rate limit proximity checks
    if (currentTime - this.lastScanTime < this.config.scanRate) {
      return { shouldDetonate: false, detonationQuality: 0 }
    }
    this.lastScanTime = currentTime

    // Calculate distance to target
    const distanceToTarget = currentPosition.distanceTo(targetPosition)

    // Check if within detonation radius
    if (distanceToTarget <= this.config.detonationRadius) {
      this.detonated = true
      
      // Calculate detonation quality (1.0 at optimal radius, decreasing linearly)
      const detonationQuality = this.calculateDetonationQuality(distanceToTarget)
      
      debug.category('ProximityFuse', `Detonation at ${distanceToTarget.toFixed(1)}m, quality: ${(detonationQuality * 100).toFixed(0)}%`)
      
      return { shouldDetonate: true, detonationQuality }
    }

    return { shouldDetonate: false, detonationQuality: 0 }
  }

  private calculateDetonationQuality(distance: number): number {
    if (distance <= this.config.optimalRadius) {
      // Perfect detonation within optimal radius
      return 1.0
    } else {
      // Linear falloff from optimal to max radius
      const falloffRange = this.config.detonationRadius - this.config.optimalRadius
      const distanceFromOptimal = distance - this.config.optimalRadius
      return Math.max(0, 1 - (distanceFromOptimal / falloffRange))
    }
  }

  // Check if we're getting closer or moving away from target
  checkApproach(
    currentPosition: THREE.Vector3,
    targetPosition: THREE.Vector3,
    velocity: THREE.Vector3
  ): { isApproaching: boolean; closestApproachDistance: number } {
    // Vector from current position to target
    const toTarget = targetPosition.clone().sub(currentPosition)
    
    // Check if velocity is pointing towards target
    const dotProduct = velocity.dot(toTarget)
    const isApproaching = dotProduct > 0

    // Calculate closest approach distance
    // This is the minimum distance the projectile will reach if it continues on current trajectory
    const velocityNormalized = velocity.clone().normalize()
    const projection = velocityNormalized.multiplyScalar(toTarget.dot(velocityNormalized))
    const closestPoint = currentPosition.clone().add(projection)
    const closestApproachDistance = closestPoint.distanceTo(targetPosition)

    return { isApproaching, closestApproachDistance }
  }

  isArmed(): boolean {
    return this.armed
  }

  hasDetonated(): boolean {
    return this.detonated
  }

  getDistanceTraveled(): number {
    return this.distanceTraveled
  }
}