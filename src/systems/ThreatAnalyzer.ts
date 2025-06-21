import * as THREE from 'three'
import { Threat } from '@/entities/Threat'
import { TrajectoryCalculator } from '@/utils/TrajectoryCalculator'
import { debug } from '@/utils/DebugLogger'

export interface ImpactAnalysis {
  impactPoint: THREE.Vector3
  impactTime: number
  impactVelocity: number
  populationAtRisk: number
  infrastructureValue: number
  strategicImportance: number
  damageRadius: number
}

export interface ThreatCluster {
  id: string
  threats: Threat[]
  center: THREE.Vector3
  radius: number
  pattern: 'saturation' | 'distributed' | 'sequential' | 'mixed'
  timeSpan: number
}

export interface ThreatAssessment {
  threat: Threat
  priority: number
  impact: ImpactAnalysis
  interceptProbability: number
  optimalInterceptTime: number
  requiredInterceptors: number
}

interface ProtectedAsset {
  position: THREE.Vector3
  radius: number
  population: number
  strategicValue: number
  type: 'city' | 'military' | 'infrastructure' | 'industrial'
}

export class ThreatAnalyzer {
  private protectedAssets: ProtectedAsset[] = []
  private readonly clusteringDistance = 1000 // meters
  private readonly clusteringTimeWindow = 5 // seconds
  
  constructor() {
    this.initializeProtectedAssets()
  }
  
  private initializeProtectedAssets(): void {
    // Initialize with default protected areas
    // In real system, this would come from GIS data
    this.protectedAssets = [
      {
        position: new THREE.Vector3(0, 0, 0),
        radius: 2000,
        population: 50000,
        strategicValue: 0.8,
        type: 'city'
      },
      {
        position: new THREE.Vector3(5000, 0, 3000),
        radius: 1000,
        population: 10000,
        strategicValue: 0.5,
        type: 'industrial'
      },
      {
        position: new THREE.Vector3(-3000, 0, -2000),
        radius: 500,
        population: 500,
        strategicValue: 0.9,
        type: 'military'
      }
    ]
  }
  
  analyzeThreat(threat: Threat, batteryPosition: THREE.Vector3): ThreatAssessment {
    const impact = this.calculateImpactAnalysis(threat)
    const priority = this.calculateThreatPriority(threat, impact)
    const interceptProbability = this.estimateInterceptProbability(threat, batteryPosition)
    const optimalTime = this.calculateOptimalInterceptTime(threat, batteryPosition)
    const requiredInterceptors = this.calculateRequiredInterceptors(threat, interceptProbability)
    
    return {
      threat,
      priority,
      impact,
      interceptProbability,
      optimalInterceptTime: optimalTime,
      requiredInterceptors
    }
  }
  
  private calculateImpactAnalysis(threat: Threat): ImpactAnalysis {
    // Calculate impact point using current velocity and position
    const trajectory = TrajectoryCalculator.predictTrajectory(
      threat.getPosition(),
      threat.getVelocity()
    )
    
    const impactPoint = trajectory[trajectory.length - 1] || threat.getPosition()
    const impactTime = threat.getTimeToImpact()
    const impactVelocity = threat.getVelocity().length()
    
    // Calculate damage radius based on threat type
    const damageRadius = this.calculateDamageRadius(threat)
    
    // Analyze affected assets
    let totalPopulation = 0
    let totalInfrastructureValue = 0
    let maxStrategicImportance = 0
    
    for (const asset of this.protectedAssets) {
      const distance = impactPoint.distanceTo(asset.position)
      
      if (distance < damageRadius + asset.radius) {
        // Asset is within damage zone
        const overlapFactor = this.calculateOverlapFactor(
          distance,
          damageRadius,
          asset.radius
        )
        
        totalPopulation += asset.population * overlapFactor
        totalInfrastructureValue += asset.strategicValue * overlapFactor
        maxStrategicImportance = Math.max(maxStrategicImportance, asset.strategicValue)
      }
    }
    
    debug.module('ThreatAnalyzer').log(`Impact analysis for threat ${threat.id}:`, {
      impactPoint: impactPoint.toArray().map(n => n.toFixed(1)),
      populationAtRisk: totalPopulation,
      damageRadius: damageRadius.toFixed(1)
    })
    
    return {
      impactPoint,
      impactTime,
      impactVelocity,
      populationAtRisk: totalPopulation,
      infrastructureValue: totalInfrastructureValue,
      strategicImportance: maxStrategicImportance,
      damageRadius
    }
  }
  
  private calculateDamageRadius(threat: Threat): number {
    // Damage radius based on threat type and warhead
    const baseRadius = {
      'ballistic_missile': 500,
      'cruise_missile': 300,
      'rocket': 200,
      'mortar': 100,
      'drone': 50
    }
    
    return baseRadius[threat.type] || 150
  }
  
  private calculateOverlapFactor(distance: number, radius1: number, radius2: number): number {
    // Calculate how much two circles overlap
    if (distance >= radius1 + radius2) return 0
    if (distance <= Math.abs(radius1 - radius2)) return 1
    
    // Partial overlap - simplified calculation
    const overlap = (radius1 + radius2 - distance) / (2 * Math.min(radius1, radius2))
    return Math.min(1, Math.max(0, overlap))
  }
  
  private calculateThreatPriority(threat: Threat, impact: ImpactAnalysis): number {
    let priority = 0
    
    // Population risk (0-40 points)
    if (impact.populationAtRisk > 10000) priority += 40
    else if (impact.populationAtRisk > 1000) priority += 30
    else if (impact.populationAtRisk > 100) priority += 20
    else if (impact.populationAtRisk > 0) priority += 10
    
    // Time criticality (0-30 points)
    if (impact.impactTime < 10) priority += 30
    else if (impact.impactTime < 20) priority += 20
    else if (impact.impactTime < 30) priority += 10
    
    // Strategic importance (0-20 points)
    priority += impact.strategicImportance * 20
    
    // Threat characteristics (0-10 points)
    if (threat.type === 'ballistic_missile') priority += 10
    else if (threat.type === 'cruise_missile') priority += 8
    else if (threat.type === 'rocket') priority += 5
    
    return Math.min(100, priority)
  }
  
  private estimateInterceptProbability(threat: Threat, batteryPosition: THREE.Vector3): number {
    const distance = threat.getPosition().distanceTo(batteryPosition)
    const altitude = threat.getPosition().y
    const speed = threat.getVelocity().length()
    
    let probability = 0.9 // Base probability
    
    // Distance factor
    if (distance > 15000) probability *= 0.7
    else if (distance > 10000) probability *= 0.85
    
    // Altitude factor
    if (altitude < 100) probability *= 0.8
    else if (altitude > 5000) probability *= 0.9
    
    // Speed factor
    if (speed > 1000) probability *= 0.7
    else if (speed > 500) probability *= 0.85
    
    // Threat type factor
    const typeFactor = {
      'ballistic_missile': 0.85,
      'cruise_missile': 0.9,
      'rocket': 0.95,
      'mortar': 0.98,
      'drone': 0.99
    }
    
    probability *= typeFactor[threat.type] || 0.9
    
    return Math.max(0.1, Math.min(0.99, probability))
  }
  
  private calculateOptimalInterceptTime(threat: Threat, batteryPosition: THREE.Vector3): number {
    // Calculate optimal intercept window
    const currentDistance = threat.getPosition().distanceTo(batteryPosition)
    const interceptorSpeed = 1000 // m/s typical
    
    // Minimum time to reach threat
    const minInterceptTime = currentDistance / interceptorSpeed
    
    // Maximum effective time (before getting too close)
    const maxInterceptTime = threat.getTimeToImpact() * 0.7
    
    // Optimal is usually 1/3 into the window for better geometry
    return minInterceptTime + (maxInterceptTime - minInterceptTime) * 0.33
  }
  
  private calculateRequiredInterceptors(threat: Threat, singleShotPk: number): number {
    // Calculate interceptors needed for 95% cumulative Pk
    const requiredPk = 0.95
    
    // Pk_cumulative = 1 - (1 - Pk_single)^n
    // n = log(1 - Pk_cumulative) / log(1 - Pk_single)
    const n = Math.log(1 - requiredPk) / Math.log(1 - singleShotPk)
    
    // Round up and apply threat-specific adjustments
    let required = Math.ceil(n)
    
    // High-value threats get extra interceptor
    if (threat.type === 'ballistic_missile') required += 1
    
    return Math.min(required, 4) // Cap at 4 interceptors
  }
  
  detectClusters(threats: Threat[]): ThreatCluster[] {
    const clusters: ThreatCluster[] = []
    const assigned = new Set<string>()
    
    for (const threat of threats) {
      if (assigned.has(threat.id)) continue
      
      const cluster: Threat[] = [threat]
      assigned.add(threat.id)
      
      // Find nearby threats
      for (const other of threats) {
        if (assigned.has(other.id)) continue
        
        const distance = threat.getPosition().distanceTo(other.getPosition())
        const timeDiff = Math.abs(threat.getTimeToImpact() - other.getTimeToImpact())
        
        if (distance < this.clusteringDistance && timeDiff < this.clusteringTimeWindow) {
          cluster.push(other)
          assigned.add(other.id)
        }
      }
      
      if (cluster.length > 1) {
        clusters.push(this.analyzeCluster(cluster))
      }
    }
    
    return clusters
  }
  
  private analyzeCluster(threats: Threat[]): ThreatCluster {
    // Calculate cluster center
    const center = new THREE.Vector3()
    threats.forEach(t => center.add(t.getPosition()))
    center.divideScalar(threats.length)
    
    // Calculate radius
    let maxDistance = 0
    threats.forEach(t => {
      const dist = t.getPosition().distanceTo(center)
      maxDistance = Math.max(maxDistance, dist)
    })
    
    // Analyze pattern
    const times = threats.map(t => t.getTimeToImpact()).sort((a, b) => a - b)
    const timeSpan = times[times.length - 1] - times[0]
    
    let pattern: ThreatCluster['pattern'] = 'mixed'
    if (timeSpan < 2) {
      pattern = 'saturation'
    } else if (timeSpan > 10) {
      pattern = 'sequential'
    } else if (maxDistance > 2000) {
      pattern = 'distributed'
    }
    
    return {
      id: `cluster_${Date.now()}`,
      threats,
      center,
      radius: maxDistance,
      pattern,
      timeSpan
    }
  }
  
  prioritizeThreats(assessments: ThreatAssessment[]): ThreatAssessment[] {
    // Sort by priority, but also consider clustering
    return assessments.sort((a, b) => {
      // Primary sort by priority
      if (Math.abs(a.priority - b.priority) > 10) {
        return b.priority - a.priority
      }
      
      // Secondary sort by time to impact
      return a.impact.impactTime - b.impact.impactTime
    })
  }
}