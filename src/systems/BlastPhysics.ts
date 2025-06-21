import * as THREE from 'three'
import { debug } from '../utils/DebugLogger'

export interface BlastConfig {
  // Warhead characteristics
  warheadMass: number           // kg of explosive
  fragmentationRadius: number   // Effective radius for fragments (meters)
  blastRadius: number          // Overpressure damage radius (meters)
  
  // Damage zones
  lethalRadius: number         // 100% kill probability (meters)
  severeRadius: number         // High damage, >80% kill probability (meters) 
  moderateRadius: number       // Medium damage, 50-80% kill probability (meters)
  lightRadius: number          // Light damage, <50% kill probability (meters)
}

export class BlastPhysics {
  // Tamir interceptor warhead specifications (based on public info)
  static readonly TAMIR_CONFIG: BlastConfig = {
    warheadMass: 11,             // ~11kg warhead
    fragmentationRadius: 20,      // Effective fragment range
    blastRadius: 15,             // Blast overpressure range
    
    // Damage zones for fragmentation warhead
    lethalRadius: 3,             // Direct hit zone
    severeRadius: 6,             // High fragment density
    moderateRadius: 10,          // Medium fragment density  
    lightRadius: 15              // Low fragment density
  }
  
  /**
   * Calculate damage probability based on distance from blast center
   * Uses realistic fragmentation pattern and blast physics
   */
  static calculateDamage(
    blastPosition: THREE.Vector3,
    targetPosition: THREE.Vector3,
    targetVelocity: THREE.Vector3,
    config: BlastConfig = BlastPhysics.TAMIR_CONFIG
  ): {
    hit: boolean
    damage: number
    killProbability: number
    damageType: 'direct' | 'severe' | 'moderate' | 'light' | 'none'
  } {
    const distance = blastPosition.distanceTo(targetPosition)
    
    // Account for relative velocity (crossing targets are harder to hit)
    const relativeSpeed = targetVelocity.length()
    const crossingFactor = Math.min(1, 300 / (relativeSpeed + 100)) // Penalty for fast targets
    
    let killProbability = 0
    let damageType: 'direct' | 'severe' | 'moderate' | 'light' | 'none' = 'none'
    
    if (distance <= config.lethalRadius) {
      // Direct hit zone - fragments + blast
      killProbability = 0.95 * crossingFactor
      damageType = 'direct'
    } else if (distance <= config.severeRadius) {
      // High fragment density zone
      // Probability decreases with square of distance (fragment dispersal)
      const factor = 1 - Math.pow((distance - config.lethalRadius) / 
        (config.severeRadius - config.lethalRadius), 2)
      killProbability = (0.8 + factor * 0.15) * crossingFactor
      damageType = 'severe'
    } else if (distance <= config.moderateRadius) {
      // Medium fragment density
      const factor = 1 - Math.pow((distance - config.severeRadius) / 
        (config.moderateRadius - config.severeRadius), 2)
      killProbability = (0.3 + factor * 0.5) * crossingFactor
      damageType = 'moderate'
    } else if (distance <= config.lightRadius) {
      // Low fragment density - only lucky hits
      const factor = 1 - Math.pow((distance - config.moderateRadius) / 
        (config.lightRadius - config.moderateRadius), 2)
      killProbability = factor * 0.3 * crossingFactor
      damageType = 'light'
    }
    
    // Add some randomness for edge cases
    const randomFactor = 0.9 + Math.random() * 0.2
    killProbability *= randomFactor
    
    // Determine if hit based on probability
    const hit = Math.random() < killProbability
    
    debug.category('BlastPhysics', 
      `Distance: ${distance.toFixed(1)}m, Type: ${damageType}, ` +
      `Kill%: ${(killProbability * 100).toFixed(0)}%, Hit: ${hit}`
    )
    
    return {
      hit,
      damage: killProbability,
      killProbability: Math.min(1, killProbability),
      damageType
    }
  }
  
  /**
   * Calculate optimal detonation point for moving target
   * Accounts for fragment travel time and target motion
   */
  static calculateOptimalDetonationPoint(
    interceptorPos: THREE.Vector3,
    interceptorVel: THREE.Vector3,
    targetPos: THREE.Vector3,
    targetVel: THREE.Vector3,
    fuseConfig: { detonationRadius: number, optimalRadius: number }
  ): {
    shouldDetonate: boolean
    detonationPoint: THREE.Vector3
    timeToDetonation: number
    predictedDistance: number
  } {
    // Fragment velocity (~1000 m/s for modern warheads)
    const FRAGMENT_VELOCITY = 1000
    
    // Calculate relative motion
    const relPos = targetPos.clone().sub(interceptorPos)
    const relVel = targetVel.clone().sub(interceptorVel)
    
    // Calculate closest approach
    const timeToClosest = -relPos.dot(relVel) / relVel.lengthSq()
    
    if (timeToClosest < 0) {
      // Already passed closest approach
      const currentDistance = relPos.length()
      return {
        shouldDetonate: currentDistance <= fuseConfig.detonationRadius,
        detonationPoint: interceptorPos.clone(),
        timeToDetonation: 0,
        predictedDistance: currentDistance
      }
    }
    
    // Predict positions at closest approach
    const futureInterceptorPos = interceptorPos.clone()
      .add(interceptorVel.clone().multiplyScalar(timeToClosest))
    const futureTargetPos = targetPos.clone()
      .add(targetVel.clone().multiplyScalar(timeToClosest))
    
    const closestDistance = futureInterceptorPos.distanceTo(futureTargetPos)
    
    // Account for fragment travel time
    const fragmentTravelTime = closestDistance / FRAGMENT_VELOCITY
    const adjustedTargetPos = futureTargetPos.clone()
      .add(targetVel.clone().multiplyScalar(fragmentTravelTime))
    
    const adjustedDistance = futureInterceptorPos.distanceTo(adjustedTargetPos)
    
    return {
      shouldDetonate: adjustedDistance <= fuseConfig.detonationRadius,
      detonationPoint: futureInterceptorPos,
      timeToDetonation: timeToClosest,
      predictedDistance: adjustedDistance
    }
  }
  
  /**
   * Check if a target would be damaged by blast at given position
   */
  static checkBlastDamage(
    blastPosition: THREE.Vector3,
    targets: Array<{ position: THREE.Vector3, velocity: THREE.Vector3, id: string }>,
    config: BlastConfig = BlastPhysics.TAMIR_CONFIG
  ): Array<{
    targetId: string
    damage: number
    willBeDestroyed: boolean
    damageType: string
  }> {
    const results = []
    
    for (const target of targets) {
      const damage = this.calculateDamage(
        blastPosition,
        target.position,
        target.velocity,
        config
      )
      
      results.push({
        targetId: target.id,
        damage: damage.killProbability,
        willBeDestroyed: damage.hit,
        damageType: damage.damageType
      })
    }
    
    return results
  }
}