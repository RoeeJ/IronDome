import * as THREE from 'three'
import { debug } from './DebugLogger'

export interface LaunchParameters {
  velocity: number
  angle: number  // degrees
  azimuth: number  // degrees
}

export class TrajectoryCalculator {
  static readonly GRAVITY = 9.82  // m/s²

  /**
   * Calculate launch parameters to hit a target
   */
  static calculateLaunchParameters(
    launchPos: THREE.Vector3,
    targetPos: THREE.Vector3,
    velocity: number,
    preferLofted: boolean = false
  ): LaunchParameters | null {
    const dx = targetPos.x - launchPos.x
    const dy = targetPos.y - launchPos.y
    const dz = targetPos.z - launchPos.z
    const horizontalDistance = Math.sqrt(dx * dx + dz * dz)
    
    // Calculate azimuth (horizontal angle)
    const azimuth = Math.atan2(dz, dx) * 180 / Math.PI

    // Calculate launch angle using ballistic formula
    const v2 = velocity * velocity
    const v4 = v2 * v2
    const g = this.GRAVITY
    const x = horizontalDistance
    const y = dy

    // Ballistic formula: tan(θ) = (v² ± √(v⁴ - g(gx² + 2yv²))) / gx
    const discriminant = v4 - g * (g * x * x + 2 * y * v2)
    
    if (discriminant < 0) {
      // Target is out of range
      return null
    }

    const sqrt = Math.sqrt(discriminant)
    const angle1 = Math.atan((v2 + sqrt) / (g * x)) * 180 / Math.PI
    const angle2 = Math.atan((v2 - sqrt) / (g * x)) * 180 / Math.PI

    let angle: number
    if (preferLofted) {
      // For interceptors, use moderate loft for visibility and realism
      // But not too much to maintain accuracy
      angle = Math.max(angle1, angle2)
      
      // Add gentle loft based on range
      if (horizontalDistance < 40) {
        angle = Math.min(angle + 8, 50) // Close range: max 50 degrees
      } else if (horizontalDistance < 80) {
        angle = Math.min(angle + 5, 45) // Medium range: max 45 degrees
      } else {
        angle = Math.min(angle + 2, 40) // Long range: minimal loft for accuracy
      }
    } else {
      // Choose the lower angle for faster interception
      angle = Math.min(angle1, angle2)
    }

    return {
      velocity,
      angle,
      azimuth
    }
  }

  /**
   * Calculate velocity vector from launch parameters
   */
  static getVelocityVector(params: LaunchParameters): THREE.Vector3 {
    const angleRad = params.angle * Math.PI / 180
    const azimuthRad = params.azimuth * Math.PI / 180
    
    const horizontalVelocity = params.velocity * Math.cos(angleRad)
    const verticalVelocity = params.velocity * Math.sin(angleRad)
    
    return new THREE.Vector3(
      horizontalVelocity * Math.cos(azimuthRad),
      verticalVelocity,
      horizontalVelocity * Math.sin(azimuthRad)
    )
  }

  /**
   * Predict trajectory points for visualization
   */
  static predictTrajectory(
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    timeStep: number = 0.1,
    maxTime: number = 20
  ): THREE.Vector3[] {
    const points: THREE.Vector3[] = []
    const g = this.GRAVITY
    
    for (let t = 0; t <= maxTime; t += timeStep) {
      const x = position.x + velocity.x * t
      const y = position.y + velocity.y * t - 0.5 * g * t * t
      const z = position.z + velocity.z * t
      
      if (y < 0) break  // Stop at ground level
      
      points.push(new THREE.Vector3(x, y, z))
    }
    
    return points
  }

  /**
   * Calculate optimal interception point
   */
  static calculateInterceptionPoint(
    threatPos: THREE.Vector3,
    threatVel: THREE.Vector3,
    interceptorPos: THREE.Vector3,
    interceptorSpeed: number,
    isDrone: boolean = false
  ): { point: THREE.Vector3; time: number } | null {
    if (isDrone) {
      debug.module('Trajectory').log(`Calculating drone interception:`, {
        threatPos: threatPos.toArray().map(n => n.toFixed(1)),
        threatVel: threatVel.toArray().map(n => n.toFixed(1)),
        speed: threatVel.length().toFixed(1),
        interceptorSpeed
      })
    }
    
    // Iterative solution for interception
    let t = 0
    const dt = 0.1
    const maxTime = 30
    
    while (t < maxTime) {
      // Predict threat position at time t
      let futurePos: THREE.Vector3
      
      if (isDrone) {
        // For drones, assume constant velocity (no gravity effect)
        futurePos = new THREE.Vector3(
          threatPos.x + threatVel.x * t,
          threatPos.y + threatVel.y * t,
          threatPos.z + threatVel.z * t
        )
      } else {
        // For ballistic threats, include gravity
        futurePos = new THREE.Vector3(
          threatPos.x + threatVel.x * t,
          threatPos.y + threatVel.y * t - 0.5 * this.GRAVITY * t * t,
          threatPos.z + threatVel.z * t
        )
      }
      
      // Check if threat has hit ground
      if (futurePos.y <= 0) {
        if (isDrone) {
          debug.module('Trajectory').log(`Drone would hit ground at t=${t.toFixed(1)}`)
        }
        return null
      }
      
      // Calculate time for interceptor to reach this position
      const distance = futurePos.distanceTo(interceptorPos)
      const interceptorTime = distance / interceptorSpeed
      
      // Check if times match (within tolerance)
      if (Math.abs(t - interceptorTime) < 0.01) {
        if (isDrone) {
          debug.module('Trajectory').log(`Found drone interception point at t=${t.toFixed(1)}s, distance=${distance.toFixed(1)}m`)
        }
        return { point: futurePos, time: t }
      }
      
      t += dt
    }
    
    if (isDrone) {
      debug.module('Trajectory').log(`Failed to find drone interception solution`)
    }
    return null
  }
}