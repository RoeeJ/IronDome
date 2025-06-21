import * as THREE from 'three'
import { Threat } from '@/entities/Threat'
import { debug } from './DebugLogger'

export interface PredictedPath {
  positions: THREE.Vector3[]
  velocities: THREE.Vector3[]
  times: number[]
  confidence: number[]
}

export class PredictiveTargeting {
  private threatHistory: Map<string, Array<{ position: THREE.Vector3; velocity: THREE.Vector3; time: number }>> = new Map()
  private readonly maxHistorySize = 10
  
  /**
   * Update threat tracking history
   */
  updateThreatTracking(threat: Threat): void {
    const history = this.threatHistory.get(threat.id) || []
    
    history.push({
      position: threat.getPosition().clone(),
      velocity: threat.getVelocity().clone(),
      time: Date.now() / 1000
    })
    
    // Keep only recent history
    if (history.length > this.maxHistorySize) {
      history.shift()
    }
    
    this.threatHistory.set(threat.id, history)
  }
  
  /**
   * Calculate lead prediction for interceptor launch
   */
  calculateLeadPrediction(
    threat: Threat,
    interceptorPos: THREE.Vector3,
    interceptorSpeed: number,
    interceptorAccelTime: number = 2.0 // Time to reach max speed
  ): { aimPoint: THREE.Vector3; timeToIntercept: number; confidence: number } | null {
    const history = this.threatHistory.get(threat.id)
    
    if (!history || history.length < 2) {
      // Fallback to simple prediction
      return this.simpleLeadCalculation(threat, interceptorPos, interceptorSpeed)
    }
    
    // Calculate acceleration from history
    const acceleration = this.estimateAcceleration(history)
    
    // Iterative prediction with acceleration
    let t = 0
    const dt = 0.1
    const maxTime = 30
    let bestSolution: { aimPoint: THREE.Vector3; timeToIntercept: number; confidence: number } | null = null
    let minTimeDiff = Infinity
    
    while (t < maxTime) {
      // Predict future position with acceleration
      const futurePos = this.predictPositionWithAcceleration(
        threat.getPosition(),
        threat.getVelocity(),
        acceleration,
        t
      )
      
      if (futurePos.y <= 0) break
      
      // Account for interceptor acceleration phase
      const effectiveDistance = this.calculateEffectiveDistance(
        interceptorPos,
        futurePos,
        interceptorSpeed,
        interceptorAccelTime
      )
      
      const interceptTime = effectiveDistance.time
      const timeDiff = Math.abs(t - interceptTime)
      
      if (timeDiff < minTimeDiff) {
        minTimeDiff = timeDiff
        bestSolution = {
          aimPoint: futurePos,
          timeToIntercept: t,
          confidence: this.calculateConfidence(history, acceleration)
        }
      }
      
      if (timeDiff < 0.01) break
      
      t += dt
    }
    
    return bestSolution
  }
  
  private simpleLeadCalculation(
    threat: Threat,
    interceptorPos: THREE.Vector3,
    interceptorSpeed: number
  ): { aimPoint: THREE.Vector3; timeToIntercept: number; confidence: number } | null {
    const threatPos = threat.getPosition()
    const threatVel = threat.getVelocity()
    
    // Simple iterative solution
    let t = threatPos.distanceTo(interceptorPos) / interceptorSpeed
    
    for (let i = 0; i < 5; i++) {
      const futurePos = threatPos.clone().add(threatVel.clone().multiplyScalar(t))
      futurePos.y -= 0.5 * 9.81 * t * t // Gravity
      
      const newTime = futurePos.distanceTo(interceptorPos) / interceptorSpeed
      if (Math.abs(newTime - t) < 0.1) {
        return {
          aimPoint: futurePos,
          timeToIntercept: t,
          confidence: 0.7
        }
      }
      t = newTime
    }
    
    return null
  }
  
  private estimateAcceleration(
    history: Array<{ position: THREE.Vector3; velocity: THREE.Vector3; time: number }>
  ): THREE.Vector3 {
    if (history.length < 2) return new THREE.Vector3(0, -9.81, 0)
    
    const recent = history[history.length - 1]
    const previous = history[history.length - 2]
    const dt = recent.time - previous.time
    
    if (dt <= 0) return new THREE.Vector3(0, -9.81, 0)
    
    const accel = recent.velocity.clone().sub(previous.velocity).divideScalar(dt)
    
    // Sanity check - limit to reasonable values
    const maxAccel = 50 // m/s²
    if (accel.length() > maxAccel) {
      accel.normalize().multiplyScalar(maxAccel)
    }
    
    return accel
  }
  
  private predictPositionWithAcceleration(
    currentPos: THREE.Vector3,
    currentVel: THREE.Vector3,
    acceleration: THREE.Vector3,
    time: number
  ): THREE.Vector3 {
    return currentPos.clone()
      .add(currentVel.clone().multiplyScalar(time))
      .add(acceleration.clone().multiplyScalar(0.5 * time * time))
  }
  
  private calculateEffectiveDistance(
    interceptorPos: THREE.Vector3,
    targetPos: THREE.Vector3,
    maxSpeed: number,
    accelTime: number
  ): { distance: number; time: number } {
    const directDistance = interceptorPos.distanceTo(targetPos)
    
    // Distance covered during acceleration
    const accelDistance = 0.5 * maxSpeed * accelTime
    
    if (directDistance <= accelDistance) {
      // Target reached during acceleration phase
      const time = Math.sqrt(2 * directDistance / (maxSpeed / accelTime))
      return { distance: directDistance, time }
    }
    
    // Time = acceleration time + cruise time
    const cruiseDistance = directDistance - accelDistance
    const cruiseTime = cruiseDistance / maxSpeed
    const totalTime = accelTime + cruiseTime
    
    return { distance: directDistance, time: totalTime }
  }
  
  private calculateConfidence(
    history: Array<{ position: THREE.Vector3; velocity: THREE.Vector3; time: number }>,
    acceleration: THREE.Vector3
  ): number {
    // Base confidence on history quality
    let confidence = Math.min(1.0, history.length / 5)
    
    // Reduce confidence for high acceleration (less predictable)
    const accelMagnitude = acceleration.length()
    if (accelMagnitude > 20) {
      confidence *= 0.8
    } else if (accelMagnitude > 10) {
      confidence *= 0.9
    }
    
    // Check consistency of recent measurements
    if (history.length >= 3) {
      const variance = this.calculateTrajectoryVariance(history)
      confidence *= Math.exp(-variance / 100) // Exponential decay with variance
    }
    
    return Math.max(0.5, confidence)
  }
  
  private calculateTrajectoryVariance(
    history: Array<{ position: THREE.Vector3; velocity: THREE.Vector3; time: number }>
  ): number {
    if (history.length < 3) return 0
    
    let totalVariance = 0
    
    for (let i = 2; i < history.length; i++) {
      const predicted = this.predictPositionWithAcceleration(
        history[i-2].position,
        history[i-2].velocity,
        new THREE.Vector3(0, -9.81, 0),
        history[i].time - history[i-2].time
      )
      
      const actual = history[i].position
      const error = predicted.distanceTo(actual)
      totalVariance += error * error
    }
    
    return totalVariance / (history.length - 2)
  }
  
  /**
   * Predict future trajectory for visualization
   */
  predictTrajectory(
    threat: Threat,
    duration: number = 10,
    resolution: number = 0.1
  ): PredictedPath {
    const positions: THREE.Vector3[] = []
    const velocities: THREE.Vector3[] = []
    const times: number[] = []
    const confidence: number[] = []
    
    const history = this.threatHistory.get(threat.id)
    const acceleration = history && history.length >= 2 
      ? this.estimateAcceleration(history)
      : new THREE.Vector3(0, -9.81, 0)
    
    const baseConfidence = history ? this.calculateConfidence(history, acceleration) : 0.5
    
    let currentPos = threat.getPosition().clone()
    let currentVel = threat.getVelocity().clone()
    
    for (let t = 0; t < duration; t += resolution) {
      positions.push(currentPos.clone())
      velocities.push(currentVel.clone())
      times.push(t)
      
      // Confidence decreases with prediction distance
      confidence.push(baseConfidence * Math.exp(-t / 10))
      
      // Update position and velocity
      currentPos.add(currentVel.clone().multiplyScalar(resolution))
      currentPos.add(acceleration.clone().multiplyScalar(0.5 * resolution * resolution))
      currentVel.add(acceleration.clone().multiplyScalar(resolution))
      
      // Stop at ground
      if (currentPos.y <= 0) break
    }
    
    return { positions, velocities, times, confidence }
  }
  
  cleanup(): void {
    // Remove old threat histories
    const now = Date.now() / 1000
    const maxAge = 30 // seconds
    
    this.threatHistory.forEach((history, threatId) => {
      if (history.length > 0) {
        const lastUpdate = history[history.length - 1].time
        if (now - lastUpdate > maxAge) {
          this.threatHistory.delete(threatId)
        }
      }
    })
  }
}