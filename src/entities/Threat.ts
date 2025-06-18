import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { Projectile, ProjectileOptions } from './Projectile'

export enum ThreatType {
  SHORT_RANGE = 'SHORT_RANGE',
  MEDIUM_RANGE = 'MEDIUM_RANGE',
  LONG_RANGE = 'LONG_RANGE'
}

export interface ThreatConfig {
  velocity: number      // m/s
  maxRange: number      // meters
  maxAltitude: number   // meters
  warheadSize: number   // kg
  color: number
  radius: number
}

export const THREAT_CONFIGS: Record<ThreatType, ThreatConfig> = {
  [ThreatType.SHORT_RANGE]: {
    velocity: 300,
    maxRange: 10000,
    maxAltitude: 3000,
    warheadSize: 10,
    color: 0xff0000,
    radius: 0.4
  },
  [ThreatType.MEDIUM_RANGE]: {
    velocity: 600,
    maxRange: 40000,
    maxAltitude: 10000,
    warheadSize: 50,
    color: 0xff6600,
    radius: 0.6
  },
  [ThreatType.LONG_RANGE]: {
    velocity: 1000,
    maxRange: 70000,
    maxAltitude: 20000,
    warheadSize: 100,
    color: 0xff0066,
    radius: 0.8
  }
}

export interface ThreatOptions extends Omit<ProjectileOptions, 'color' | 'radius' | 'mass'> {
  type: ThreatType
  targetPosition: THREE.Vector3
}

export class Threat extends Projectile {
  type: ThreatType
  targetPosition: THREE.Vector3
  launchTime: number
  impactTime: number | null = null
  impactPoint: THREE.Vector3 | null = null

  constructor(
    scene: THREE.Scene,
    world: CANNON.World,
    options: ThreatOptions
  ) {
    const config = THREAT_CONFIGS[options.type]
    
    super(scene, world, {
      ...options,
      color: config.color,
      radius: config.radius,
      mass: config.warheadSize,
      trailLength: 200,
      useExhaustTrail: true,
      isInterceptor: false
    })

    this.type = options.type
    this.targetPosition = options.targetPosition
    this.launchTime = Date.now()

    // Calculate impact prediction
    this.calculateImpactPrediction()
  }

  private calculateImpactPrediction(): void {
    // Simple ballistic prediction (ignoring air resistance for now)
    const v0 = this.getVelocity()
    const p0 = this.getPosition()
    const g = 9.82

    // Solve for time when y = 0 (ground impact)
    // y = y0 + v0y*t - 0.5*g*t^2
    const a = -0.5 * g
    const b = v0.y
    const c = p0.y

    const discriminant = b * b - 4 * a * c
    if (discriminant < 0) return

    const t1 = (-b + Math.sqrt(discriminant)) / (2 * a)
    const t2 = (-b - Math.sqrt(discriminant)) / (2 * a)
    
    const impactTimeSeconds = Math.max(t1, t2)
    if (impactTimeSeconds <= 0) return

    this.impactTime = this.launchTime + impactTimeSeconds * 1000

    // Calculate impact position
    this.impactPoint = new THREE.Vector3(
      p0.x + v0.x * impactTimeSeconds,
      0,
      p0.z + v0.z * impactTimeSeconds
    )
  }

  getTimeToImpact(): number {
    if (!this.impactTime) return -1
    return Math.max(0, (this.impactTime - Date.now()) / 1000)
  }

  getImpactPoint(): THREE.Vector3 | null {
    return this.impactPoint
  }
}