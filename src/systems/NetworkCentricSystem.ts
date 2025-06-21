import * as THREE from 'three'
import { IronDomeBattery } from '@/entities/IronDomeBattery'
import { Threat } from '@/entities/Threat'
import { ThreatAssessment } from './ThreatAnalyzer'
import { debug } from '@/utils/DebugLogger'

export interface SensorData {
  sensorId: string
  timestamp: number
  position: THREE.Vector3
  velocity: THREE.Vector3
  confidence: number
  sensorType: 'radar' | 'infrared' | 'optical'
  noiseLevel: number
}

export interface FusedTrack {
  trackId: string
  threatId?: string
  position: THREE.Vector3
  velocity: THREE.Vector3
  acceleration: THREE.Vector3
  confidence: number
  lastUpdate: number
  contributors: Map<string, SensorData>
  covariance: number[][] // Position uncertainty matrix
}

export interface NetworkMessage {
  id: string
  type: 'track_update' | 'threat_assignment' | 'handoff_request' | 'status_update'
  sender: string
  timestamp: number
  data: any
}

export interface TaskAllocation {
  batteryId: string
  threats: string[]
  priority: number
  constraints: {
    maxInterceptors?: number
    timeWindow?: number
    preferredStrategy?: string
  }
}

export class NetworkCentricSystem {
  private batteries: Map<string, IronDomeBattery> = new Map()
  private fusedTracks: Map<string, FusedTrack> = new Map()
  private messageQueue: NetworkMessage[] = []
  private taskAllocations: Map<string, TaskAllocation> = new Map()
  
  // Network parameters
  private readonly maxLatency = 100 // ms
  private readonly updateRate = 50 // Hz
  private lastUpdateTime = 0
  
  // Sensor fusion parameters
  private readonly positionNoiseStd = 10 // meters
  private readonly velocityNoiseStd = 2 // m/s
  
  registerBattery(battery: IronDomeBattery): void {
    this.batteries.set(battery.config.id, battery)
    debug.module('Network').log(`Registered battery ${battery.config.id} to network`)
  }
  
  unregisterBattery(batteryId: string): void {
    this.batteries.delete(batteryId)
    
    // Clean up any allocations
    this.taskAllocations.delete(batteryId)
  }
  
  // Distributed sensor fusion using Covariance Intersection
  fuseSensorData(sensorDataArray: SensorData[]): void {
    // Group sensor data by approximate position
    const trackGroups = this.groupSensorData(sensorDataArray)
    
    trackGroups.forEach((group, trackId) => {
      if (group.length === 1) {
        // Single sensor, create simple track
        this.createTrackFromSensor(trackId, group[0])
      } else {
        // Multiple sensors, perform fusion
        this.performSensorFusion(trackId, group)
      }
    })
    
    // Clean old tracks
    this.maintainTracks()
  }
  
  private groupSensorData(sensorData: SensorData[]): Map<string, SensorData[]> {
    const groups = new Map<string, SensorData[]>()
    const associationThreshold = 100 // meters
    
    for (const data of sensorData) {
      let assigned = false
      
      // Try to associate with existing track
      for (const [trackId, track] of this.fusedTracks) {
        const distance = data.position.distanceTo(track.position)
        
        if (distance < associationThreshold) {
          const groupId = trackId
          if (!groups.has(groupId)) {
            groups.set(groupId, [])
          }
          groups.get(groupId)!.push(data)
          assigned = true
          break
        }
      }
      
      // Create new track group
      if (!assigned) {
        const newTrackId = `track_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        groups.set(newTrackId, [data])
      }
    }
    
    return groups
  }
  
  private createTrackFromSensor(trackId: string, sensor: SensorData): void {
    const track: FusedTrack = {
      trackId,
      position: sensor.position.clone(),
      velocity: sensor.velocity.clone(),
      acceleration: new THREE.Vector3(),
      confidence: sensor.confidence,
      lastUpdate: sensor.timestamp,
      contributors: new Map([[sensor.sensorId, sensor]]),
      covariance: this.createCovarianceMatrix(sensor.noiseLevel)
    }
    
    this.fusedTracks.set(trackId, track)
  }
  
  private performSensorFusion(trackId: string, sensors: SensorData[]): void {
    // Covariance Intersection algorithm for distributed fusion
    let fusedPosition = new THREE.Vector3()
    let fusedVelocity = new THREE.Vector3()
    let totalWeight = 0
    
    // Calculate optimal fusion weights
    const weights = this.calculateFusionWeights(sensors)
    
    sensors.forEach((sensor, index) => {
      const weight = weights[index]
      fusedPosition.add(sensor.position.clone().multiplyScalar(weight))
      fusedVelocity.add(sensor.velocity.clone().multiplyScalar(weight))
      totalWeight += weight
    })
    
    // Normalize
    fusedPosition.divideScalar(totalWeight)
    fusedVelocity.divideScalar(totalWeight)
    
    // Update or create track
    const existingTrack = this.fusedTracks.get(trackId)
    if (existingTrack) {
      // Smooth update using exponential filter
      const alpha = 0.7
      existingTrack.position.lerp(fusedPosition, alpha)
      existingTrack.velocity.lerp(fusedVelocity, alpha)
      
      // Update acceleration estimate
      const dt = (Date.now() - existingTrack.lastUpdate) / 1000
      if (dt > 0) {
        const accel = fusedVelocity.clone().sub(existingTrack.velocity).divideScalar(dt)
        existingTrack.acceleration.lerp(accel, 0.5)
      }
      
      existingTrack.confidence = Math.max(...sensors.map(s => s.confidence))
      existingTrack.lastUpdate = Date.now()
      
      // Update contributors
      sensors.forEach(s => existingTrack.contributors.set(s.sensorId, s))
    } else {
      this.createTrackFromSensor(trackId, sensors[0])
    }
  }
  
  private calculateFusionWeights(sensors: SensorData[]): number[] {
    // Weight based on confidence and sensor type quality
    const sensorQuality = {
      'radar': 1.0,
      'infrared': 0.8,
      'optical': 0.6
    }
    
    const weights = sensors.map(s => {
      const typeQuality = sensorQuality[s.sensorType] || 0.5
      const noiseWeight = 1 / (1 + s.noiseLevel)
      return s.confidence * typeQuality * noiseWeight
    })
    
    // Normalize weights
    const sum = weights.reduce((a, b) => a + b, 0)
    return weights.map(w => w / sum)
  }
  
  private createCovarianceMatrix(noiseLevel: number): number[][] {
    const variance = Math.pow(this.positionNoiseStd * noiseLevel, 2)
    return [
      [variance, 0, 0],
      [0, variance, 0],
      [0, 0, variance]
    ]
  }
  
  // Distributed task allocation using Contract Net Protocol
  allocateThreatsToBatteries(
    assessments: ThreatAssessment[],
    batteries: IronDomeBattery[]
  ): Map<string, TaskAllocation> {
    const allocations = new Map<string, TaskAllocation>()
    
    // Phase 1: Announcement - batteries announce capabilities
    const capabilities = this.gatherBatteryCapabilities(batteries)
    
    // Phase 2: Bidding - calculate bids for each threat-battery pair
    const bids = this.calculateBids(assessments, capabilities)
    
    // Phase 3: Award - solve assignment problem using Hungarian algorithm
    const assignments = this.solveAssignment(bids)
    
    // Phase 4: Acknowledgment - create allocations
    assignments.forEach((assignment) => {
      const batteryId = assignment.battery.config.id
      
      if (!allocations.has(batteryId)) {
        allocations.set(batteryId, {
          batteryId,
          threats: [],
          priority: 0,
          constraints: {}
        })
      }
      
      const allocation = allocations.get(batteryId)!
      allocation.threats.push(assignment.threat.id)
      allocation.priority = Math.max(allocation.priority, assignment.priority)
    })
    
    // Broadcast allocations
    this.broadcastAllocations(allocations)
    
    return allocations
  }
  
  private gatherBatteryCapabilities(batteries: IronDomeBattery[]): Map<string, any> {
    const capabilities = new Map()
    
    batteries.forEach(battery => {
      capabilities.set(battery.config.id, {
        battery,
        position: battery.getPosition(),
        availableInterceptors: battery.getInterceptorCount(),
        maxRange: battery.config.maxRange,
        currentLoad: 0 // Would track active engagements
      })
    })
    
    return capabilities
  }
  
  private calculateBids(
    assessments: ThreatAssessment[],
    capabilities: Map<string, any>
  ): number[][] {
    const m = assessments.length
    const n = capabilities.size
    const bids: number[][] = Array(m).fill(null).map(() => Array(n).fill(Infinity))
    
    const batteries = Array.from(capabilities.values())
    
    assessments.forEach((assessment, i) => {
      batteries.forEach((cap, j) => {
        const battery = cap.battery as IronDomeBattery
        
        // Check if battery can engage
        if (!battery.canIntercept(assessment.threat)) {
          bids[i][j] = Infinity
          continue
        }
        
        // Calculate bid (lower is better)
        const distance = assessment.threat.getPosition().distanceTo(cap.position)
        const timeToIntercept = distance / battery.config.interceptorSpeed
        const loadFactor = cap.currentLoad / cap.availableInterceptors
        
        // Bid based on multiple factors
        let bid = 0
        bid += timeToIntercept * 10 // Time criticality
        bid += distance / cap.maxRange * 20 // Range efficiency
        bid += loadFactor * 30 // Load balancing
        bid -= assessment.priority // Threat priority (negative because higher priority = lower bid)
        
        bids[i][j] = bid
      })
    })
    
    return bids
  }
  
  private solveAssignment(bids: number[][]): any[] {
    // Simplified Hungarian algorithm implementation
    // In production, use a proper implementation
    const assignments: any[] = []
    const m = bids.length
    const n = bids[0].length
    
    const rowAssigned = new Array(m).fill(false)
    const colAssigned = new Array(n).fill(false)
    
    // Greedy assignment for simplicity
    for (let iter = 0; iter < Math.min(m, n); iter++) {
      let minBid = Infinity
      let minI = -1
      let minJ = -1
      
      for (let i = 0; i < m; i++) {
        if (rowAssigned[i]) continue
        
        for (let j = 0; j < n; j++) {
          if (colAssigned[j]) continue
          
          if (bids[i][j] < minBid) {
            minBid = bids[i][j]
            minI = i
            minJ = j
          }
        }
      }
      
      if (minI !== -1 && minBid < Infinity) {
        rowAssigned[minI] = true
        colAssigned[minJ] = true
        
        // Note: This is where you'd access the actual assessment and battery
        // For now, creating placeholder
        assignments.push({
          threat: { id: `threat_${minI}` },
          battery: { config: { id: `battery_${minJ}` } },
          priority: 100 - minBid
        })
      }
    }
    
    return assignments
  }
  
  // Sector handoff protocol
  initiateHandoff(
    threatId: string,
    fromBatteryId: string,
    toBatteryId: string
  ): boolean {
    const track = this.getTrackForThreat(threatId)
    if (!track) return false
    
    const fromBattery = this.batteries.get(fromBatteryId)
    const toBattery = this.batteries.get(toBatteryId)
    
    if (!fromBattery || !toBattery) return false
    
    // Create handoff message
    const handoffMsg: NetworkMessage = {
      id: `handoff_${Date.now()}`,
      type: 'handoff_request',
      sender: fromBatteryId,
      timestamp: Date.now(),
      data: {
        threatId,
        track,
        currentEngagement: null, // Would include engagement details
        reason: 'sector_transition'
      }
    }
    
    // Simulate network transmission
    this.sendMessage(handoffMsg, toBatteryId)
    
    debug.module('Network').log(`Initiated handoff of threat ${threatId} from ${fromBatteryId} to ${toBatteryId}`)
    
    return true
  }
  
  private getTrackForThreat(threatId: string): FusedTrack | null {
    for (const track of this.fusedTracks.values()) {
      if (track.threatId === threatId) {
        return track
      }
    }
    return null
  }
  
  private sendMessage(message: NetworkMessage, recipient?: string): void {
    // Simulate network delay
    const delay = Math.random() * this.maxLatency
    
    setTimeout(() => {
      if (recipient) {
        // Direct message
        this.processMessage(message, recipient)
      } else {
        // Broadcast
        this.batteries.forEach((_, batteryId) => {
          if (batteryId !== message.sender) {
            this.processMessage(message, batteryId)
          }
        })
      }
    }, delay)
  }
  
  private processMessage(message: NetworkMessage, batteryId: string): void {
    // Process different message types
    switch (message.type) {
      case 'track_update':
        this.handleTrackUpdate(message.data)
        break
      
      case 'handoff_request':
        this.handleHandoffRequest(message.data, batteryId)
        break
      
      case 'threat_assignment':
        this.handleThreatAssignment(message.data, batteryId)
        break
      
      case 'status_update':
        this.handleStatusUpdate(message.data, batteryId)
        break
    }
  }
  
  private handleTrackUpdate(data: any): void {
    // Update fused track with new sensor data
    if (data.sensorData) {
      this.fuseSensorData([data.sensorData])
    }
  }
  
  private handleHandoffRequest(data: any, batteryId: string): void {
    // Process handoff request
    const battery = this.batteries.get(batteryId)
    if (!battery) return
    
    // Check if battery can accept handoff
    const canAccept = battery.getInterceptorCount() > 0
    
    // Send acknowledgment
    const response: NetworkMessage = {
      id: `handoff_ack_${Date.now()}`,
      type: 'status_update',
      sender: batteryId,
      timestamp: Date.now(),
      data: {
        handoffId: data.handoffId,
        accepted: canAccept,
        batteryStatus: {
          interceptors: battery.getInterceptorCount(),
          position: battery.getPosition()
        }
      }
    }
    
    this.sendMessage(response, data.sender)
  }
  
  private handleThreatAssignment(data: any, batteryId: string): void {
    // Update local allocation
    if (data.allocation) {
      this.taskAllocations.set(batteryId, data.allocation)
    }
  }
  
  private handleStatusUpdate(data: any, batteryId: string): void {
    // Update battery status in capabilities
    // This would update the network's view of battery state
  }
  
  private broadcastAllocations(allocations: Map<string, TaskAllocation>): void {
    allocations.forEach((allocation, batteryId) => {
      const message: NetworkMessage = {
        id: `allocation_${Date.now()}`,
        type: 'threat_assignment',
        sender: 'network_controller',
        timestamp: Date.now(),
        data: { allocation }
      }
      
      this.sendMessage(message, batteryId)
    })
  }
  
  private maintainTracks(): void {
    const now = Date.now()
    const maxAge = 5000 // 5 seconds
    
    const tracksToDelete: string[] = []
    
    this.fusedTracks.forEach((track, trackId) => {
      if (now - track.lastUpdate > maxAge) {
        tracksToDelete.push(trackId)
      }
    })
    
    tracksToDelete.forEach(id => this.fusedTracks.delete(id))
  }
  
  getFusedTracks(): Map<string, FusedTrack> {
    return new Map(this.fusedTracks)
  }
  
  getNetworkStatus(): {
    connectedBatteries: number
    activeTracks: number
    messageQueueSize: number
    averageConfidence: number
  } {
    let totalConfidence = 0
    this.fusedTracks.forEach(track => {
      totalConfidence += track.confidence
    })
    
    return {
      connectedBatteries: this.batteries.size,
      activeTracks: this.fusedTracks.size,
      messageQueueSize: this.messageQueue.length,
      averageConfidence: this.fusedTracks.size > 0 ? 
        totalConfidence / this.fusedTracks.size : 0
    }
  }
}