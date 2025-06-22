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
      armingDistance: 20,      // Arms after 20m of flight
      detonationRadius: 12,    // Detonates within 12m
      optimalRadius: 6,        // Best detonation at 6m
      scanRate: 4,            // Check every 4 frames
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

    // DEBUG: Log distance traveled and current distance to target
    const distanceToTarget = currentPosition.distanceTo(targetPosition)
    debug.category('ProximityFuse', `[UPDATE] Distance traveled: ${this.distanceTraveled.toFixed(1)}m, Distance to target: ${distanceToTarget.toFixed(1)}m, Armed: ${this.armed}, Detonated: ${this.detonated}`)

    // Check if fuse should arm
    if (!this.armed && this.distanceTraveled >= this.config.armingDistance) {
      this.armed = true
      debug.category('ProximityFuse', `[ARMED] Fuse armed at distance: ${this.distanceTraveled.toFixed(1)}m, Current distance to target: ${distanceToTarget.toFixed(1)}m`)
    }

    // Don't check for detonation if not armed or already detonated
    if (!this.armed || this.detonated) {
      debug.category('ProximityFuse', `[SKIP CHECK] Not checking detonation - Armed: ${this.armed}, Detonated: ${this.detonated}`)
      return { shouldDetonate: false, detonationQuality: 0 }
    }

    // Rate limit proximity checks
    if (currentTime - this.lastScanTime < this.config.scanRate) {
      debug.category('ProximityFuse', `[RATE LIMIT] Skipping scan - Time since last: ${(currentTime - this.lastScanTime).toFixed(1)}ms, Required: ${this.config.scanRate}ms`)
      return { shouldDetonate: false, detonationQuality: 0 }
    }
    this.lastScanTime = currentTime

    // DEBUG: Log proximity check details
    debug.category('ProximityFuse', `[PROXIMITY CHECK] Distance: ${distanceToTarget.toFixed(1)}m, Detonation radius: ${this.config.detonationRadius}m, Within range: ${distanceToTarget <= this.config.detonationRadius}`)

    // Check if within detonation radius
    if (distanceToTarget <= this.config.detonationRadius) {
      this.detonated = true
      
      // Calculate detonation quality (1.0 at optimal radius, decreasing linearly)
      const detonationQuality = this.calculateDetonationQuality(distanceToTarget)
      
      debug.category('ProximityFuse', `[DETONATION] Triggering detonation at ${distanceToTarget.toFixed(1)}m, quality: ${(detonationQuality * 100).toFixed(0)}%, Optimal radius: ${this.config.optimalRadius}m`)
      
      return { shouldDetonate: true, detonationQuality }
    }

    debug.category('ProximityFuse', `[NO DETONATION] Target too far: ${distanceToTarget.toFixed(1)}m > ${this.config.detonationRadius}m`)
    return { shouldDetonate: false, detonationQuality: 0 }
  }

  private calculateDetonationQuality(distance: number): number {
    // Quality based on how close to optimal the detonation is
    // This affects visual explosion size but not damage (damage uses BlastPhysics)
    if (distance <= this.config.optimalRadius) {
      // Near-optimal detonation
      return 0.9 + (1 - distance / this.config.optimalRadius) * 0.1
    } else {
      // Sub-optimal but still effective
      const falloffRange = this.config.detonationRadius - this.config.optimalRadius
      const distanceFromOptimal = distance - this.config.optimalRadius
      return Math.max(0.5, 0.9 - (distanceFromOptimal / falloffRange) * 0.4)
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
    const currentDistance = currentPosition.distanceTo(targetPosition)
    
    // Check if velocity is pointing towards target
    const dotProduct = velocity.dot(toTarget)
    const isApproaching = dotProduct > 0

    // Calculate closest approach distance
    // This is the minimum distance the projectile will reach if it continues on current trajectory
    const velocityNormalized = velocity.clone().normalize()
    const projection = velocityNormalized.multiplyScalar(toTarget.dot(velocityNormalized))
    const closestPoint = currentPosition.clone().add(projection)
    const closestApproachDistance = closestPoint.distanceTo(targetPosition)

    // DEBUG: Log approach analysis
    debug.category('ProximityFuse', `[APPROACH CHECK] Current distance: ${currentDistance.toFixed(1)}m, Approaching: ${isApproaching}, Closest approach: ${closestApproachDistance.toFixed(1)}m, Velocity dot: ${dotProduct.toFixed(2)}`)

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