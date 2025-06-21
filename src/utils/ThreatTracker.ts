import * as THREE from 'three'
import { KalmanFilter } from './KalmanFilter'
import { Threat } from '@/entities/Threat'
import { debug } from './DebugLogger'

interface TrackedThreat {
  threat: Threat
  kalmanFilter: KalmanFilter
  lastUpdateTime: number
  trackQuality: number
  predictedTrajectory: THREE.Vector3[]
  missedUpdates: number
}

export class ThreatTracker {
  private trackedThreats: Map<string, TrackedThreat> = new Map()
  private readonly maxMissedUpdates = 5
  private readonly trajectoryPredictionTime = 10 // seconds
  private readonly trajectoryResolution = 0.1 // seconds
  
  startTracking(threat: Threat): void {
    if (this.trackedThreats.has(threat.id)) return
    
    const kalmanFilter = new KalmanFilter()
    kalmanFilter.initializeFromThreat(
      threat.getPosition(),
      threat.getVelocity(),
      threat.type
    )
    
    this.trackedThreats.set(threat.id, {
      threat,
      kalmanFilter,
      lastUpdateTime: Date.now(),
      trackQuality: 1.0,
      predictedTrajectory: [],
      missedUpdates: 0
    })
    
    debug.module('ThreatTracker').log(`Started tracking threat ${threat.id}`)
  }
  
  stopTracking(threatId: string): void {
    this.trackedThreats.delete(threatId)
    debug.module('ThreatTracker').log(`Stopped tracking threat ${threatId}`)
  }
  
  update(threat: Threat): void {
    const tracked = this.trackedThreats.get(threat.id)
    if (!tracked) {
      this.startTracking(threat)
      return
    }
    
    const now = Date.now()
    const deltaTime = (now - tracked.lastUpdateTime) / 1000
    
    // Predict to current time
    const prediction = tracked.kalmanFilter.predict(deltaTime)
    
    // Update with measurement
    const measuredPosition = threat.getPosition()
    tracked.kalmanFilter.update(measuredPosition)
    
    // Calculate track quality based on prediction error
    const predictionError = prediction.position.distanceTo(measuredPosition)
    const uncertainty = tracked.kalmanFilter.getPositionUncertainty()
    tracked.trackQuality = Math.exp(-predictionError / (uncertainty + 1))
    
    // Update trajectory prediction
    this.updatePredictedTrajectory(tracked)
    
    tracked.lastUpdateTime = now
    tracked.missedUpdates = 0
    
    debug.module('ThreatTracker').log(`Updated threat ${threat.id}`, {
      predictionError: predictionError.toFixed(2),
      trackQuality: tracked.trackQuality.toFixed(3),
      uncertainty: uncertainty.toFixed(2)
    })
  }
  
  predictPosition(threatId: string, futureTime: number): THREE.Vector3 | null {
    const tracked = this.trackedThreats.get(threatId)
    if (!tracked) return null
    
    const now = Date.now()
    const deltaTime = (now - tracked.lastUpdateTime) / 1000 + futureTime
    
    const prediction = tracked.kalmanFilter.predict(deltaTime)
    return prediction.position
  }
  
  getPredictedTrajectory(threatId: string): THREE.Vector3[] {
    const tracked = this.trackedThreats.get(threatId)
    return tracked ? [...tracked.predictedTrajectory] : []
  }
  
  getTrackQuality(threatId: string): number {
    const tracked = this.trackedThreats.get(threatId)
    return tracked ? tracked.trackQuality : 0
  }
  
  getTrackedState(threatId: string): { position: THREE.Vector3; velocity: THREE.Vector3; acceleration: THREE.Vector3 } | null {
    const tracked = this.trackedThreats.get(threatId)
    if (!tracked) return null
    
    return tracked.kalmanFilter.getState()
  }
  
  maintainTracks(): void {
    const now = Date.now()
    const threatsToRemove: string[] = []
    
    this.trackedThreats.forEach((tracked, threatId) => {
      const timeSinceUpdate = (now - tracked.lastUpdateTime) / 1000
      
      if (timeSinceUpdate > 0.5) {
        // Predict forward without measurement
        tracked.kalmanFilter.predict(timeSinceUpdate)
        tracked.lastUpdateTime = now
        tracked.missedUpdates++
        
        // Degrade track quality
        tracked.trackQuality *= 0.9
        
        if (tracked.missedUpdates > this.maxMissedUpdates) {
          threatsToRemove.push(threatId)
        }
      }
    })
    
    threatsToRemove.forEach(id => this.stopTracking(id))
  }
  
  private updatePredictedTrajectory(tracked: TrackedThreat): void {
    tracked.predictedTrajectory = []
    const state = tracked.kalmanFilter.getState()
    
    let pos = state.position.clone()
    let vel = state.velocity.clone()
    const acc = state.acceleration.clone()
    
    for (let t = 0; t < this.trajectoryPredictionTime; t += this.trajectoryResolution) {
      // Update position
      pos = pos.add(vel.clone().multiplyScalar(this.trajectoryResolution))
      
      // Update velocity
      vel = vel.add(acc.clone().multiplyScalar(this.trajectoryResolution))
      
      // Store predicted position
      tracked.predictedTrajectory.push(pos.clone())
      
      // Stop if below ground
      if (pos.y <= 0) break
    }
  }
  
  // Get all active tracks for visualization
  getAllTracks(): Map<string, TrackedThreat> {
    return new Map(this.trackedThreats)
  }
}