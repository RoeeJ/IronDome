import * as THREE from 'three'
import { IronDomeBattery } from '../entities/IronDomeBattery'
import { Threat } from '../entities/Threat'
import { debug } from '../utils/DebugLogger'

interface ThreatAssignment {
  threatId: string
  assignedBatteryId: string
  interceptorCount: number
  timeAssigned: number
}

interface BatteryStatus {
  battery: IronDomeBattery
  availableInterceptors: number
  activeEngagements: number
  lastFiredTime: number
}

export class BatteryCoordinator {
  private batteries = new Map<string, BatteryStatus>()
  private threatAssignments = new Map<string, ThreatAssignment>()
  private coordinationEnabled: boolean = true
  
  constructor() {
    debug.module('BatteryCoordinator').log('Battery coordination system initialized')
  }
  
  registerBattery(batteryId: string, battery: IronDomeBattery): void {
    this.batteries.set(batteryId, {
      battery,
      availableInterceptors: battery.getInterceptorCount(),
      activeEngagements: 0,
      lastFiredTime: 0
    })
    debug.module('BatteryCoordinator').log(`Registered battery ${batteryId}`)
  }
  
  unregisterBattery(batteryId: string): void {
    this.batteries.delete(batteryId)
    // Remove any assignments for this battery
    this.threatAssignments.forEach((assignment, threatId) => {
      if (assignment.assignedBatteryId === batteryId) {
        this.threatAssignments.delete(threatId)
      }
    })
  }
  
  updateBatteryStatus(batteryId: string): void {
    const status = this.batteries.get(batteryId)
    if (status) {
      status.availableInterceptors = status.battery.getInterceptorCount()
    }
  }
  
  /**
   * Find the optimal battery to engage a threat, considering:
   * - Current assignments (avoid double-targeting)
   * - Battery capabilities and range
   * - Available interceptors
   * - Engagement efficiency
   */
  findOptimalBattery(threat: Threat, existingInterceptors: number = 0): IronDomeBattery | null {
    // If coordination is disabled, fall back to simple closest battery selection
    if (!this.coordinationEnabled) {
      return this.findClosestCapableBattery(threat)
    }
    
    const threatId = threat.id
    
    // Check if threat is already assigned
    const existingAssignment = this.threatAssignments.get(threatId)
    if (existingAssignment) {
      const assignedBattery = this.batteries.get(existingAssignment.assignedBatteryId)
      if (assignedBattery && assignedBattery.battery.canIntercept(threat)) {
        debug.module('BatteryCoordinator').log(`Threat ${threatId} already assigned to battery ${existingAssignment.assignedBatteryId}`)
        return null // Already being handled
      }
    }
    
    // Find all capable batteries
    const capableBatteries: Array<{batteryId: string, status: BatteryStatus, score: number}> = []
    
    this.batteries.forEach((status, batteryId) => {
      if (!status.battery.isOperational() || !status.battery.canIntercept(threat)) {
        return
      }
      
      if (status.availableInterceptors === 0) {
        return
      }
      
      // Calculate engagement score
      const score = this.calculateEngagementScore(threat, status, batteryId)
      capableBatteries.push({ batteryId, status, score })
    })
    
    if (capableBatteries.length === 0) {
      return null
    }
    
    // Sort by score (higher is better)
    capableBatteries.sort((a, b) => b.score - a.score)
    
    const selected = capableBatteries[0]
    debug.module('BatteryCoordinator').log(
      `Selected battery ${selected.batteryId} for threat ${threatId} with score ${selected.score.toFixed(2)}`
    )
    
    return selected.status.battery
  }
  
  /**
   * Calculate engagement score for a battery-threat pair
   * Higher score = better choice
   */
  private calculateEngagementScore(threat: Threat, status: BatteryStatus, batteryId: string): number {
      const battery = status.battery
      const batteryPos = battery.getPosition()
      const threatPos = threat.getPosition()
      const distance = batteryPos.distanceTo(threatPos)
      
      // Performance optimization: Quick rejection for out-of-range threats
      const maxRange = battery.getConfig().maxRange
      if (distance > maxRange) {
        return 0
      }
      
      let score = 100 // Base score
      
      // 1. Distance factor (simplified calculation)
      const rangeFactor = 1 - (distance / maxRange)
      score *= rangeFactor
      
      // 2. Battery load factor (prefer less loaded batteries)
      const loadFactor = 1 - (status.activeEngagements / Math.max(1, status.battery.getConfig().launcherCount))
      score *= loadFactor
      
      // 3. Time to impact check (simple pass/fail)
      const interceptTime = distance / battery.getConfig().interceptorSpeed
      const threatTimeToImpact = threat.getTimeToImpact()
      if (interceptTime >= threatTimeToImpact) {
        return 0 // Can't intercept in time
      }
      
      // 4. Recent firing penalty (avoid overheating)
      const timeSinceLastFire = Date.now() - status.lastFiredTime
      if (timeSinceLastFire < 500) {
        score *= 0.8
      }
      
      return score
    }

  
  /**
   * Record a threat assignment
   */
  assignThreatToBattery(threatId: string, batteryId: string, interceptorCount: number): void {
    this.threatAssignments.set(threatId, {
      threatId,
      assignedBatteryId: batteryId,
      interceptorCount,
      timeAssigned: Date.now()
    })
    
    const status = this.batteries.get(batteryId)
    if (status) {
      status.activeEngagements++
      status.lastFiredTime = Date.now()
    }
    
    debug.module('BatteryCoordinator').log(
      `Assigned threat ${threatId} to battery ${batteryId} with ${interceptorCount} interceptors`
    )
  }
  
  /**
   * Clear assignment when threat is destroyed or missed
   */
  clearThreatAssignment(threatId: string): void {
    const assignment = this.threatAssignments.get(threatId)
    if (assignment) {
      const status = this.batteries.get(assignment.assignedBatteryId)
      if (status) {
        status.activeEngagements = Math.max(0, status.activeEngagements - 1)
      }
      this.threatAssignments.delete(threatId)
    }
  }
  
  /**
   * Get current interceptor count targeting a threat
   */
  getAssignedInterceptorCount(threatId: string): number {
    const assignment = this.threatAssignments.get(threatId)
    return assignment ? assignment.interceptorCount : 0
  }
  
  /**
   * Check if we need more interceptors for a threat
   */
  needsAdditionalInterceptors(threat: Threat, currentInterceptors: number): boolean {
    const assignment = this.threatAssignments.get(threat.id)
    if (!assignment) return true // Not assigned yet
    
    // High-value threats might need more interceptors
    const threatConfig = (threat as any).config
    const isHighValue = threatConfig?.warheadSize > 500 || threatConfig?.isDrone
    const desiredInterceptors = isHighValue ? 2 : 1
    
    return currentInterceptors < desiredInterceptors
  }
  
  /**
   * Clean up old assignments
   */
  cleanup(): void {
    const now = Date.now()
    const maxAge = 30000 // 30 seconds
    
    this.threatAssignments.forEach((assignment, threatId) => {
      if (now - assignment.timeAssigned > maxAge) {
        this.clearThreatAssignment(threatId)
      }
    })
  }
  
  getCoordinationStats() {
    return {
      totalBatteries: this.batteries.size,
      activeAssignments: this.threatAssignments.size,
      totalActiveEngagements: Array.from(this.batteries.values())
        .reduce((sum, status) => sum + status.activeEngagements, 0)
    }
  }
  
  setCoordinationEnabled(enabled: boolean): void {
    this.coordinationEnabled = enabled
    debug.module('BatteryCoordinator').log(`Battery coordination ${enabled ? 'enabled' : 'disabled'}`)
  }
  
  isCoordinationEnabled(): boolean {
    return this.coordinationEnabled
  }
  
  /**
   * Simple fallback method when coordination is disabled
   */
  private findClosestCapableBattery(threat: Threat): IronDomeBattery | null {
    let closestBattery: IronDomeBattery | null = null
    let minDistance = Infinity
    
    this.batteries.forEach((status) => {
      if (!status.battery.isOperational() || !status.battery.canIntercept(threat)) {
        return
      }
      
      if (status.availableInterceptors === 0) {
        return
      }
      
      const distance = threat.getPosition().distanceTo(status.battery.getPosition())
      if (distance < minDistance) {
        minDistance = distance
        closestBattery = status.battery
      }
    })
    
    return closestBattery
  }
}