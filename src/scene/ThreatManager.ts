import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { EventEmitter } from 'events'
import { Threat, ThreatType, THREAT_CONFIGS } from '../entities/Threat'
import { UnifiedTrajectorySystem as TrajectoryCalculator } from '../systems/UnifiedTrajectorySystem'
import { LaunchEffectsSystem } from '../systems/LaunchEffectsSystem'
import { IronDomeBattery } from '../entities/IronDomeBattery'

export interface ThreatSpawnConfig {
  type: ThreatType
  spawnRadius: number
  targetRadius: number
  minInterval: number  // ms
  maxInterval: number  // ms
}

export class ThreatManager extends EventEmitter {
  private scene: THREE.Scene
  private world: CANNON.World
  private threats: Threat[] = []
  private spawnConfigs: ThreatSpawnConfig[]
  private lastSpawnTime: number = 0
  private nextSpawnTime: number = 0
  private isSpawning: boolean = false
  private impactMarkers: THREE.Mesh[] = []
  private launchEffects: LaunchEffectsSystem
  private batteries: IronDomeBattery[] = []
  private salvoChance: number = 0.3  // Default 30% chance

  constructor(scene: THREE.Scene, world: CANNON.World) {
    super()
    this.scene = scene
    this.world = world
    
    // Initialize launch effects system
    this.launchEffects = new LaunchEffectsSystem(scene)
    
    // Default spawn configurations with all threat types
    this.spawnConfigs = [
      // Original rockets
      {
        type: ThreatType.SHORT_RANGE,
        spawnRadius: 150,
        targetRadius: 40,
        minInterval: 3000,
        maxInterval: 8000
      },
      {
        type: ThreatType.MEDIUM_RANGE,
        spawnRadius: 180,
        targetRadius: 60,
        minInterval: 5000,
        maxInterval: 15000
      },
      // Mortars - frequent, close range
      {
        type: ThreatType.MORTAR,
        spawnRadius: 80,
        targetRadius: 20,
        minInterval: 2000,
        maxInterval: 5000
      },
      // Drones - less frequent, varied approach
      {
        type: ThreatType.DRONE_SLOW,
        spawnRadius: 200,
        targetRadius: 30,
        minInterval: 10000,
        maxInterval: 20000
      },
      {
        type: ThreatType.DRONE_FAST,
        spawnRadius: 250,
        targetRadius: 40,
        minInterval: 15000,
        maxInterval: 30000
      },
      // Cruise missiles - rare, long range
      {
        type: ThreatType.CRUISE_MISSILE,
        spawnRadius: 300,
        targetRadius: 50,
        minInterval: 30000,
        maxInterval: 60000
      },
      // Specific rocket variants
      {
        type: ThreatType.QASSAM_1,
        spawnRadius: 100,
        targetRadius: 30,
        minInterval: 4000,
        maxInterval: 8000
      },
      {
        type: ThreatType.GRAD_ROCKET,
        spawnRadius: 150,
        targetRadius: 40,
        minInterval: 8000,
        maxInterval: 15000
      }
    ]
  }

  startSpawning(): void {
    this.isSpawning = true
    this.scheduleNextSpawn()
  }

  stopSpawning(): void {
    this.isSpawning = false
  }

  private scheduleNextSpawn(): void {
    if (this.spawnConfigs.length === 0) {
      // If no spawn configs available, schedule a check in 5 seconds
      this.nextSpawnTime = Date.now() + 5000
      return
    }
    
    const config = this.spawnConfigs[Math.floor(Math.random() * this.spawnConfigs.length)]
    const interval = config.minInterval + Math.random() * (config.maxInterval - config.minInterval)
    this.nextSpawnTime = Date.now() + interval
  }

  update(): void {
    // Update launch effects
    this.launchEffects.update()
    
    // Update all threats
    for (let i = this.threats.length - 1; i >= 0; i--) {
      const threat = this.threats[i]
      threat.update()

      // Check if threat has hit ground or reached target
      const threatConfig = THREAT_CONFIGS[threat.type]
      
      if (threatConfig.isDrone) {
        // For drones, dynamically target nearest operational battery
        const nearestBattery = this.findNearestOperationalBattery(threat.getPosition())
        if (nearestBattery) {
          // Update drone target to battery position
          threat.targetPosition = nearestBattery.getPosition().clone()
          
          // Adjust velocity to aim for battery
          const currentPos = threat.getPosition()
          const toTarget = new THREE.Vector3()
            .subVectors(threat.targetPosition, currentPos)
          
          const horizontalDistance = Math.sqrt(toTarget.x * toTarget.x + toTarget.z * toTarget.z)
          const verticalDistance = toTarget.y
          
          // If close to target horizontally, start descending
          if (horizontalDistance < 20) {
            // Spiral descent pattern
            const angle = (Date.now() / 1000) * 2 // 2 radians per second
            const radius = Math.max(5, horizontalDistance)
            
            const targetX = threat.targetPosition.x + Math.cos(angle) * radius
            const targetZ = threat.targetPosition.z + Math.sin(angle) * radius
            const targetY = Math.max(threat.targetPosition.y + 5, currentPos.y - 10) // Descend at 10m/s
            
            const newVelocity = new THREE.Vector3(
              targetX - currentPos.x,
              targetY - currentPos.y,
              targetZ - currentPos.z
            ).normalize().multiplyScalar(threatConfig.velocity * 0.7) // Slower during descent
            
            threat.body.velocity.set(newVelocity.x, newVelocity.y, newVelocity.z)
          } else {
            // Normal flight toward target
            toTarget.normalize()
            const newVelocity = toTarget.multiplyScalar(threatConfig.velocity)
            threat.body.velocity.set(newVelocity.x, 0, newVelocity.z) // Keep altitude constant during approach
          }
        }
        
        const distanceToTarget = threat.getPosition().distanceTo(threat.targetPosition)
        const timeSinceLaunch = (Date.now() - threat.launchTime) / 1000
        
        // Check if drone is close to any battery
        const closestBattery = this.batteries.reduce((closest, battery) => {
          if (!battery.isOperational()) return closest
          const dist = threat.getPosition().distanceTo(battery.getPosition())
          const closestDist = closest ? threat.getPosition().distanceTo(closest.getPosition()) : Infinity
          return dist < closestDist ? battery : closest
        }, null as IronDomeBattery | null)
        
        const distanceToBattery = closestBattery 
          ? threat.getPosition().distanceTo(closestBattery.getPosition())
          : Infinity
        
        // Check if drone should explode
        const shouldExplode = 
          distanceToBattery < 10 ||  // Within damage distance of battery
          distanceToTarget < 5 ||  // Close enough to original target
          threat.getPosition().y <= 1 ||  // Hit ground
          timeSinceLaunch > 60  // Timeout after 60 seconds
        
        if (shouldExplode) {
          // Check for battery hit (within explosion radius)
          const explosionRadius = 10 // Drone explosion affects 10m radius
          const nearbyBatteries = this.batteries.filter(battery => 
            battery.isOperational() && 
            battery.getPosition().distanceTo(threat.getPosition()) <= explosionRadius
          )
          
          // Damage all batteries in explosion radius
          nearbyBatteries.forEach(battery => {
            const distance = battery.getPosition().distanceTo(threat.getPosition())
            const damageFalloff = 1 - (distance / explosionRadius) // More damage closer to explosion
            const baseDamage = this.getThreatDamage(threat.type)
            const actualDamage = Math.ceil(baseDamage * damageFalloff)
            
            battery.takeDamage(actualDamage)
            this.emit('batteryHit', { battery, damage: actualDamage })
            console.log(`Drone explosion damaged battery at ${distance.toFixed(1)}m for ${actualDamage} damage`)
          })
          
          // Create explosion (in air if still flying)
          if (threat.getPosition().y > 5) {
            this.createAirExplosion(threat.getPosition())
          } else {
            this.createGroundExplosion(threat.getPosition())
          }
          
          this.removeThreat(i, false) // Drone attack
        }
      } else {
        // For other threats, check ground impact
        if (threat.body.position.y <= 0.5 && threat.isActive) {
          // Check if hit a battery
          const impactPosition = threat.getPosition()
          const hitBattery = this.checkBatteryHit(impactPosition)
          
          if (hitBattery) {
            // Deal damage to battery
            const damageAmount = this.getThreatDamage(threat.type)
            hitBattery.takeDamage(damageAmount)
            this.emit('batteryHit', { battery: hitBattery, damage: damageAmount })
          }
          
          // Check for shockwave damage to nearby batteries
          const shockwaveRadius = this.getShockwaveRadius(threat.type)
          const nearbyBatteries = this.batteries.filter(battery => {
            const distance = battery.getPosition().distanceTo(impactPosition)
            return battery.isOperational() && distance <= shockwaveRadius && battery !== hitBattery
          })
          
          // Apply shockwave damage with falloff
          nearbyBatteries.forEach(battery => {
            const distance = battery.getPosition().distanceTo(impactPosition)
            const damageFalloff = 1 - (distance / shockwaveRadius)
            const baseDamage = this.getThreatDamage(threat.type)
            const shockwaveDamage = Math.ceil(baseDamage * 0.5 * damageFalloff) // 50% of base damage for shockwave
            
            if (shockwaveDamage > 0) {
              battery.takeDamage(shockwaveDamage)
              this.emit('batteryHit', { battery, damage: shockwaveDamage, isShockwave: true })
              console.log(`Shockwave damaged battery at ${distance.toFixed(1)}m for ${shockwaveDamage} damage`)
            }
          })
          
          // Create explosion at impact point
          this.createGroundExplosion(impactPosition)
          this.removeThreat(i, false) // Missed - hit ground
        } else if (threat.body.position.y < -5) {
          // Remove if somehow went too far below ground
          this.removeThreat(i, false) // Missed - went below ground
        }
      }
    }

    // Spawn new threats
    if (this.isSpawning && Date.now() >= this.nextSpawnTime) {
      this.spawnThreat()
      this.scheduleNextSpawn()
    }

    // Update impact markers
    this.updateImpactMarkers()
  }

  private spawnThreat(): void {
    // Performance limit: Skip spawning if too many active threats
    if (this.threats.length > 50) {
      return
    }
    
    // Chance to spawn multiple threats simultaneously (salvo)
    const isSalvo = Math.random() < this.salvoChance
    const salvoSize = isSalvo ? 2 + Math.floor(Math.random() * 4) : 1  // 2-5 threats in salvo
    
    for (let i = 0; i < salvoSize; i++) {
      this.spawnSingleThreat(i * 0.3)  // Slight delay between salvo launches
    }
  }
  
  private spawnSingleThreat(delay: number = 0): void {
    setTimeout(() => {
      const config = this.spawnConfigs[Math.floor(Math.random() * this.spawnConfigs.length)]
    
    // Random spawn position on circle perimeter at ground level
    const spawnAngle = Math.random() * Math.PI * 2
    const spawnX = Math.cos(spawnAngle) * config.spawnRadius
    const spawnZ = Math.sin(spawnAngle) * config.spawnRadius
    const spawnY = 1  // Launch from ground level
    
    const spawnPosition = new THREE.Vector3(spawnX, spawnY, spawnZ)
    
    // Target an active battery if any exist, otherwise random position
    let targetPosition: THREE.Vector3
    const operationalBatteries = this.batteries.filter(b => b.isOperational())
    
    if (operationalBatteries.length > 0) {
      // Pick a random operational battery as target
      const targetBattery = operationalBatteries[Math.floor(Math.random() * operationalBatteries.length)]
      targetPosition = targetBattery.getPosition().clone()
      
      // Add some spread around the battery
      const spread = 10 + Math.random() * 20
      const spreadAngle = Math.random() * Math.PI * 2
      targetPosition.x += Math.cos(spreadAngle) * spread
      targetPosition.z += Math.sin(spreadAngle) * spread
      targetPosition.y = 0
    } else {
      // Fallback to random target
      const targetAngle = Math.random() * Math.PI * 2
      const targetDistance = Math.random() * config.targetRadius
      const targetX = Math.cos(targetAngle) * targetDistance
      const targetZ = Math.sin(targetAngle) * targetDistance
      targetPosition = new THREE.Vector3(targetX, 0, targetZ)
    }
    
    // Get threat configuration
    const threatStats = THREAT_CONFIGS[config.type]
    
    // Calculate launch parameters based on threat type
    let launchParams: any
    let velocity: THREE.Vector3
    
    if (threatStats.isDrone) {
      // Drones launch horizontally towards target
      const direction = new THREE.Vector3()
        .subVectors(targetPosition, spawnPosition)
        .normalize()
      
      // Start at higher altitude for drones
      spawnPosition.y = threatStats.cruiseAltitude || 100
      
      velocity = direction.multiplyScalar(threatStats.velocity)
    } else if (threatStats.isMortar) {
      // Mortars use very high angle
      const distance = spawnPosition.distanceTo(targetPosition)
      const mortarAngle = 80 + Math.random() * 5 // 80-85 degrees
      const angleRad = mortarAngle * Math.PI / 180
      
      // Calculate velocity for mortar trajectory
      const g = 9.82
      const mortarVelocity = Math.sqrt((distance * g) / Math.sin(2 * angleRad))
      
      launchParams = {
        angle: mortarAngle,
        azimuth: Math.atan2(targetPosition.z - spawnPosition.z, targetPosition.x - spawnPosition.x),
        velocity: Math.min(mortarVelocity, threatStats.velocity)
      }
      velocity = TrajectoryCalculator.getVelocityVector(launchParams)
    } else if (config.type === ThreatType.CRUISE_MISSILE) {
      // Cruise missiles launch at low angle
      const direction = new THREE.Vector3()
        .subVectors(targetPosition, spawnPosition)
        .normalize()
      
      // Launch at slight upward angle
      direction.y = 0.2
      direction.normalize()
      
      velocity = direction.multiplyScalar(threatStats.velocity)
    } else {
      // Regular rockets - use existing ballistic calculation
      const threatConfig = {
        [ThreatType.SHORT_RANGE]: { velocity: 200, minAngle: 60, maxAngle: 75 },
        [ThreatType.MEDIUM_RANGE]: { velocity: 400, minAngle: 70, maxAngle: 80 },
        [ThreatType.LONG_RANGE]: { velocity: 600, minAngle: 75, maxAngle: 85 },
        [ThreatType.QASSAM_1]: { velocity: 200, minAngle: 65, maxAngle: 75 },
        [ThreatType.QASSAM_2]: { velocity: 280, minAngle: 65, maxAngle: 75 },
        [ThreatType.QASSAM_3]: { velocity: 350, minAngle: 65, maxAngle: 75 },
        [ThreatType.GRAD_ROCKET]: { velocity: 450, minAngle: 70, maxAngle: 80 }
      }[config.type] || { velocity: threatStats.velocity, minAngle: 65, maxAngle: 80 }
    
      // For ballistic missiles, we want high angle launches (60-85 degrees)
      launchParams = TrajectoryCalculator.calculateLaunchParameters(
        spawnPosition,
        targetPosition,
        threatConfig.velocity
      )
      
      if (!launchParams) return  // Target out of range
      
      // Force high angle for ballistic trajectory
      launchParams.angle = threatConfig.minAngle + Math.random() * (threatConfig.maxAngle - threatConfig.minAngle)
      
      // Recalculate velocity to hit target with the high angle
      const distance = spawnPosition.distanceTo(targetPosition)
      const angleRad = launchParams.angle * Math.PI / 180
      const g = 9.82
      
      // Calculate required velocity for the given angle
      const requiredVelocity = Math.sqrt((distance * g) / Math.sin(2 * angleRad))
      
      // Use the calculated velocity if it's reasonable
      if (requiredVelocity < threatConfig.velocity * 1.5) {
        launchParams.velocity = requiredVelocity
      }
      
      velocity = TrajectoryCalculator.getVelocityVector(launchParams)
    }
    
    const threat = new Threat(this.scene, this.world, {
      type: config.type,
      position: spawnPosition,
      velocity,
      targetPosition
    })
    
    this.threats.push(threat)
    this.addImpactMarker(threat)
    
    // Create launch effects for the threat
    const launchDirection = velocity.clone().normalize()
    this.launchEffects.createLaunchEffect(spawnPosition, launchDirection, {
      smokeCloudSize: 10,
      smokeDuration: 3500,
      flashIntensity: 12,
      flashDuration: 250,
      dustRadius: 3,  // Reduced for more realistic size
      scorchMarkRadius: 4
    })
    }, delay * 1000)
  }

  private removeThreat(index: number, wasIntercepted: boolean = false): void {
    const threat = this.threats[index]
    threat.destroy(this.scene, this.world)
    this.threats.splice(index, 1)
    
    // Emit event based on whether it was intercepted or missed
    if (wasIntercepted) {
      this.emit('threatDestroyed', { threat })
    } else {
      this.emit('threatMissed', { threat })
    }
  }

  private addImpactMarker(threat: Threat): void {
    const impactPoint = threat.getImpactPoint()
    if (!impactPoint) return
    
    // Create impact marker
    const geometry = new THREE.RingGeometry(2, 3, 32)
    const material = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      opacity: 0.5,
      transparent: true,
      side: THREE.DoubleSide
    })
    
    const marker = new THREE.Mesh(geometry, material)
    marker.rotation.x = -Math.PI / 2
    marker.position.copy(impactPoint)
    marker.position.y = 0.1
    marker.userData = { threat, createdAt: Date.now() }
    
    this.scene.add(marker)
    this.impactMarkers.push(marker)
  }

  private updateImpactMarkers(): void {
    const now = Date.now()
    
    for (let i = this.impactMarkers.length - 1; i >= 0; i--) {
      const marker = this.impactMarkers[i]
      const threat = marker.userData.threat as Threat
      
      // Remove marker if threat is destroyed or impact time passed
      if (!threat.isActive || threat.getTimeToImpact() < 0) {
        this.scene.remove(marker)
        marker.geometry.dispose()
        ;(marker.material as THREE.Material).dispose()
        this.impactMarkers.splice(i, 1)
        continue
      }
      
      // Pulse effect
      const timeToImpact = threat.getTimeToImpact()
      const pulseSpeed = Math.min(10, 1 / (timeToImpact + 0.1))
      const scale = 1 + 0.2 * Math.sin(now * 0.001 * pulseSpeed)
      marker.scale.set(scale, scale, scale)
      
      // Update opacity based on time to impact
      const material = marker.material as THREE.MeshBasicMaterial
      material.opacity = Math.min(0.8, 0.3 + 0.5 * (1 - timeToImpact / 10))
    }
  }

  getActiveThreats(): Threat[] {
    return this.threats.filter(t => t.isActive)
  }

  clearAll(): void {
    // Remove all threats
    while (this.threats.length > 0) {
      const threat = this.threats[0]
      threat.destroy(this.scene, this.world)
      this.threats.splice(0, 1)
      // Don't emit events when clearing all
    }
    
    // Remove all impact markers
    this.impactMarkers.forEach(marker => {
      this.scene.remove(marker)
      marker.geometry.dispose()
      ;(marker.material as THREE.Material).dispose()
    })
    this.impactMarkers = []
  }
  
  registerBattery(battery: IronDomeBattery): void {
    if (!this.batteries.includes(battery)) {
      this.batteries.push(battery)
    }
  }
  
  unregisterBattery(battery: IronDomeBattery): void {
    const index = this.batteries.indexOf(battery)
    if (index !== -1) {
      this.batteries.splice(index, 1)
    }
  }
  
  private checkBatteryHit(impactPosition: THREE.Vector3): IronDomeBattery | null {
    const hitRadius = 15 // Radius within which a battery takes damage
    
    for (const battery of this.batteries) {
      if (battery.isOperational()) {
        const distance = impactPosition.distanceTo(battery.getPosition())
        if (distance <= hitRadius) {
          return battery
        }
      }
    }
    
    return null
  }
  
  private getThreatDamage(type: ThreatType): number {
    // Different threat types deal different damage
    switch (type) {
      case ThreatType.GRAD_ROCKET:
        return 15
      case ThreatType.QASSAM_1:
        return 10
      case ThreatType.QASSAM_2:
        return 15
      case ThreatType.QASSAM_3:
        return 20
      case ThreatType.MORTAR:
        return 10
      case ThreatType.SHORT_RANGE:
        return 15
      case ThreatType.MEDIUM_RANGE:
        return 20
      case ThreatType.LONG_RANGE:
        return 25
      case ThreatType.DRONE_SLOW:
        return 20
      case ThreatType.DRONE_FAST:
        return 30
      case ThreatType.CRUISE_MISSILE:
        return 40
      case ThreatType.BALLISTIC_MISSILE:
        return 50
      default:
        return 20
    }
  }
  
  private getShockwaveRadius(type: ThreatType): number {
    // Different threat types have different shockwave radii
    switch (type) {
      case ThreatType.MORTAR:
        return 15 // Small shockwave
      case ThreatType.SHORT_RANGE:
      case ThreatType.QASSAM_1:
      case ThreatType.QASSAM_2:
        return 20
      case ThreatType.MEDIUM_RANGE:
      case ThreatType.QASSAM_3:
      case ThreatType.GRAD_ROCKET:
        return 25
      case ThreatType.LONG_RANGE:
        return 30
      case ThreatType.DRONE_SLOW:
        return 20
      case ThreatType.DRONE_FAST:
        return 25
      case ThreatType.CRUISE_MISSILE:
        return 35
      case ThreatType.BALLISTIC_MISSILE:
        return 40 // Large shockwave
      default:
        return 20
    }
  }
  
  private findNearestOperationalBattery(position: THREE.Vector3): IronDomeBattery | null {
    let nearestBattery: IronDomeBattery | null = null
    let minDistance = Infinity
    
    for (const battery of this.batteries) {
      if (battery.isOperational()) {
        const distance = position.distanceTo(battery.getPosition())
        if (distance < minDistance) {
          minDistance = distance
          nearestBattery = battery
        }
      }
    }
    
    return nearestBattery
  }
  
  // Called when a threat is intercepted by defense system
  markThreatIntercepted(threat: Threat): void {
    const index = this.threats.indexOf(threat)
    if (index !== -1) {
      this.removeThreat(index, true)
    }
  }

  private createGroundExplosion(position: THREE.Vector3): void {
    // Check if instanced explosion renderer is available
    const instancedRenderer = (window as any).__instancedExplosionRenderer
    if (instancedRenderer) {
      instancedRenderer.createExplosion(position, 0.8, 'ground')
      
      // Performance optimization: Limit point lights
      const activeLights = this.scene.children.filter(c => c instanceof THREE.PointLight).length
      if (activeLights < 10) {
        // Add point light flash
        const flash = new THREE.PointLight(0xff6600, 10, 30)
        flash.position.copy(position)
        flash.position.y = 2
        this.scene.add(flash)
        
        setTimeout(() => {
          this.scene.remove(flash)
        }, 200)
      }
      
      // Still create crater effect
      this.createCraterDecal(position)
      return
    }
    
    // Fallback to old method
    // Main explosion sphere
    const explosionGeometry = new THREE.SphereGeometry(1, 16, 8)
    const explosionMaterial = new THREE.MeshBasicMaterial({
      color: 0xff6600,
      opacity: 1,
      transparent: true
    })
    const explosion = new THREE.Mesh(explosionGeometry, explosionMaterial)
    explosion.position.copy(position)
    explosion.position.y = 0.5
    this.scene.add(explosion)

    // Shockwave ring
    const ringGeometry = new THREE.RingGeometry(0.1, 1, 32)
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      opacity: 0.8,
      transparent: true,
      side: THREE.DoubleSide
    })
    const shockwave = new THREE.Mesh(ringGeometry, ringMaterial)
    shockwave.rotation.x = -Math.PI / 2
    shockwave.position.copy(position)
    shockwave.position.y = 0.1
    this.scene.add(shockwave)

    // Debris particles (reduced for performance)
    const debrisCount = 8
    const debris: THREE.Mesh[] = []
    
    for (let i = 0; i < debrisCount; i++) {
      const debrisGeometry = new THREE.BoxGeometry(0.2, 0.2, 0.2)
      const debrisMaterial = new THREE.MeshBasicMaterial({
        color: 0x333333
      })
      const debrisPiece = new THREE.Mesh(debrisGeometry, debrisMaterial)
      debrisPiece.position.copy(position)
      debrisPiece.position.y = 0.5
      
      // Random initial velocity
      debrisPiece.userData.velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 10,
        Math.random() * 15 + 5,
        (Math.random() - 0.5) * 10
      )
      
      debris.push(debrisPiece)
      this.scene.add(debrisPiece)
    }

    // Animate explosion
    const startTime = Date.now()
    const duration = 2000

    const animate = () => {
      const elapsed = Date.now() - startTime
      const progress = elapsed / duration

      if (progress >= 1) {
        // Clean up
        this.scene.remove(explosion)
        this.scene.remove(shockwave)
        explosion.geometry.dispose()
        explosionMaterial.dispose()
        shockwave.geometry.dispose()
        ringMaterial.dispose()
        
        debris.forEach(piece => {
          this.scene.remove(piece)
          piece.geometry.dispose()
          ;(piece.material as THREE.Material).dispose()
        })
        return
      }

      // Expand and fade explosion
      const scale = 1 + progress * 8
      explosion.scale.set(scale, scale, scale)
      explosionMaterial.opacity = 1 - progress

      // Expand shockwave (reduced size)
      const ringScale = 1 + progress * 6
      shockwave.scale.set(ringScale, ringScale, 1)
      ringMaterial.opacity = 0.8 * (1 - progress)

      // Animate debris
      debris.forEach(piece => {
        if (piece.position.y > 0) {
          piece.userData.velocity.y -= 30 * 0.016 // Gravity
          piece.position.add(piece.userData.velocity.clone().multiplyScalar(0.016))
          piece.rotation.x += 0.1
          piece.rotation.y += 0.15
          
          if (piece.position.y <= 0) {
            piece.position.y = 0
            piece.userData.velocity.multiplyScalar(0.3) // Damping on ground hit
          }
        }
      })

      requestAnimationFrame(animate)
    }

    animate()

    // Add point light flash
    const flash = new THREE.PointLight(0xff6600, 10, 30)
    flash.position.copy(position)
    flash.position.y = 2
    this.scene.add(flash)

    setTimeout(() => {
      this.scene.remove(flash)
    }, 200)

    // Add crater decal (simple dark circle on ground)
    const craterGeometry = new THREE.CircleGeometry(3, 32)
    const craterMaterial = new THREE.MeshBasicMaterial({
      color: 0x222222,
      opacity: 0.7,
      transparent: true
    })
    const crater = new THREE.Mesh(craterGeometry, craterMaterial)
    crater.rotation.x = -Math.PI / 2
    crater.position.copy(position)
    crater.position.y = 0.01
    this.scene.add(crater)

    // Fade out crater over time
    setTimeout(() => {
      const fadeStart = Date.now()
      const fadeDuration = 5000
      
      const fadeCrater = () => {
        const elapsed = Date.now() - fadeStart
        const progress = elapsed / fadeDuration
        
        if (progress >= 1) {
          this.scene.remove(crater)
          crater.geometry.dispose()
          craterMaterial.dispose()
          return
        }
        
        craterMaterial.opacity = 0.7 * (1 - progress)
        requestAnimationFrame(fadeCrater)
      }
      
      fadeCrater()
    }, 3000)
  }
  
  private createCraterDecal(position: THREE.Vector3): void {
    // Add crater decal (simple dark circle on ground)
    const craterGeometry = new THREE.CircleGeometry(3, 32)
    const craterMaterial = new THREE.MeshBasicMaterial({
      color: 0x222222,
      opacity: 0.7,
      transparent: true
    })
    const crater = new THREE.Mesh(craterGeometry, craterMaterial)
    crater.rotation.x = -Math.PI / 2
    crater.position.copy(position)
    crater.position.y = 0.01
    this.scene.add(crater)

    // Fade out crater over time
    setTimeout(() => {
      const fadeStart = Date.now()
      const fadeDuration = 5000
      
      const fadeCrater = () => {
        const elapsed = Date.now() - fadeStart
        const progress = elapsed / fadeDuration
        
        if (progress >= 1) {
          this.scene.remove(crater)
          crater.geometry.dispose()
          craterMaterial.dispose()
          return
        }
        
        craterMaterial.opacity = 0.7 * (1 - progress)
        requestAnimationFrame(fadeCrater)
      }
      
      fadeCrater()
    }, 3000)
  }
  
  private createAirExplosion(position: THREE.Vector3): void {
    // Check if instanced explosion renderer is available
    const instancedRenderer = (window as any).__instancedExplosionRenderer
    if (instancedRenderer) {
      instancedRenderer.createExplosion(position, 0.8, 'air')
      
      // Performance optimization: Limit point lights
      const activeLights = this.scene.children.filter(c => c instanceof THREE.PointLight).length
      if (activeLights < 10) {
        // Add point light flash
        const flash = new THREE.PointLight(0xffaa00, 10, 50)
        flash.position.copy(position)
        this.scene.add(flash)
        
        setTimeout(() => {
          this.scene.remove(flash)
        }, 200)
      }
      
      // Create falling debris for drone
      this.createDroneDebris(position)
      return
    }
    
    // Fallback to old method
    // Create explosion effect in air (for drones)
    const explosionGeometry = new THREE.SphereGeometry(3, 16, 8)
    const explosionMaterial = new THREE.MeshBasicMaterial({
      color: 0xff6600,
      opacity: 0.8,
      transparent: true
    })
    const explosion = new THREE.Mesh(explosionGeometry, explosionMaterial)
    explosion.position.copy(position)
    this.scene.add(explosion)
    
    // Flash effect
    const flash = new THREE.PointLight(0xffaa00, 10, 50)
    flash.position.copy(position)
    this.scene.add(flash)
    
    // Animate explosion
    const startTime = Date.now()
    const animate = () => {
      const elapsed = Date.now() - startTime
      const progress = elapsed / 800
      
      if (progress >= 1) {
        this.scene.remove(explosion)
        this.scene.remove(flash)
        explosion.geometry.dispose()
        explosionMaterial.dispose()
        return
      }
      
      // Expand and fade
      const scale = 1 + progress * 3
      explosion.scale.set(scale, scale, scale)
      explosionMaterial.opacity = 0.8 * (1 - progress)
      flash.intensity = 10 * (1 - progress)
      
      requestAnimationFrame(animate)
    }
    animate()
    
    // Create falling debris for drone
    const debrisCount = 5
    for (let i = 0; i < debrisCount; i++) {
      const debrisGeometry = new THREE.BoxGeometry(0.3, 0.3, 0.3)
      const debrisMaterial = new THREE.MeshBasicMaterial({
        color: 0x333333
      })
      const debris = new THREE.Mesh(debrisGeometry, debrisMaterial)
      debris.position.copy(position)
      debris.position.x += (Math.random() - 0.5) * 2
      debris.position.z += (Math.random() - 0.5) * 2
      
      this.scene.add(debris)
      
      // Animate falling debris
      const fallSpeed = 5 + Math.random() * 5
      const rotSpeed = new THREE.Vector3(
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10
      )
      
      const animateDebris = () => {
        debris.position.y -= fallSpeed * 0.016
        debris.rotation.x += rotSpeed.x * 0.016
        debris.rotation.y += rotSpeed.y * 0.016
        debris.rotation.z += rotSpeed.z * 0.016
        
        if (debris.position.y < 0) {
          this.scene.remove(debris)
          debris.geometry.dispose()
          debrisMaterial.dispose()
        } else {
          requestAnimationFrame(animateDebris)
        }
      }
      animateDebris()
    }
  }
  
  private createDroneDebris(position: THREE.Vector3): void {
    // Use debris system if available
    const debrisSystem = (window as any).__debrisSystem
    if (debrisSystem) {
      debrisSystem.createDebris(
        position,
        new THREE.Vector3(0, -5, 0), // Falling down
        5,
        {
          sizeRange: [0.3, 0.6],
          velocitySpread: 5,
          lifetimeRange: [3, 5],
          explosive: false
        }
      )
    }
  }
  
  // Control which threat types to spawn
  setThreatMix(threatTypes: 'rockets' | 'mixed' | 'drones' | 'mortars' | 'all'): void {
    // Store all configs for filtering
    const allConfigs = [
      { type: ThreatType.SHORT_RANGE, spawnRadius: 150, targetRadius: 40, minInterval: 3000, maxInterval: 8000 },
      { type: ThreatType.MEDIUM_RANGE, spawnRadius: 180, targetRadius: 60, minInterval: 5000, maxInterval: 15000 },
      { type: ThreatType.MORTAR, spawnRadius: 80, targetRadius: 20, minInterval: 2000, maxInterval: 5000 },
      { type: ThreatType.DRONE_SLOW, spawnRadius: 200, targetRadius: 30, minInterval: 10000, maxInterval: 20000 },
      { type: ThreatType.DRONE_FAST, spawnRadius: 250, targetRadius: 40, minInterval: 15000, maxInterval: 30000 },
      { type: ThreatType.CRUISE_MISSILE, spawnRadius: 300, targetRadius: 50, minInterval: 30000, maxInterval: 60000 },
      { type: ThreatType.QASSAM_1, spawnRadius: 100, targetRadius: 30, minInterval: 4000, maxInterval: 8000 },
      { type: ThreatType.GRAD_ROCKET, spawnRadius: 150, targetRadius: 40, minInterval: 8000, maxInterval: 15000 }
    ]
    
    switch(threatTypes) {
      case 'rockets':
        this.spawnConfigs = allConfigs.filter(config => 
          [ThreatType.SHORT_RANGE, ThreatType.MEDIUM_RANGE, ThreatType.LONG_RANGE,
           ThreatType.QASSAM_1, ThreatType.QASSAM_2, ThreatType.QASSAM_3, 
           ThreatType.GRAD_ROCKET].includes(config.type)
        )
        break
      case 'drones':
        this.spawnConfigs = allConfigs.filter(config => 
          [ThreatType.DRONE_SLOW, ThreatType.DRONE_FAST].includes(config.type)
        )
        break
      case 'mortars':
        this.spawnConfigs = allConfigs.filter(config => 
          config.type === ThreatType.MORTAR
        )
        break
      case 'mixed':
        // Keep a balanced mix
        this.spawnConfigs = [
          { type: ThreatType.SHORT_RANGE, spawnRadius: 150, targetRadius: 40, minInterval: 3000, maxInterval: 8000 },
          { type: ThreatType.MORTAR, spawnRadius: 80, targetRadius: 20, minInterval: 2000, maxInterval: 5000 },
          { type: ThreatType.DRONE_SLOW, spawnRadius: 200, targetRadius: 30, minInterval: 10000, maxInterval: 20000 },
          { type: ThreatType.QASSAM_2, spawnRadius: 100, targetRadius: 30, minInterval: 4000, maxInterval: 8000 }
        ]
        break
      case 'all':
      default:
        // Reset to all threat types
        this.spawnConfigs = [
          { type: ThreatType.SHORT_RANGE, spawnRadius: 150, targetRadius: 40, minInterval: 3000, maxInterval: 8000 },
          { type: ThreatType.MEDIUM_RANGE, spawnRadius: 180, targetRadius: 60, minInterval: 5000, maxInterval: 15000 },
          { type: ThreatType.MORTAR, spawnRadius: 80, targetRadius: 20, minInterval: 2000, maxInterval: 5000 },
          { type: ThreatType.DRONE_SLOW, spawnRadius: 200, targetRadius: 30, minInterval: 10000, maxInterval: 20000 },
          { type: ThreatType.DRONE_FAST, spawnRadius: 250, targetRadius: 40, minInterval: 15000, maxInterval: 30000 },
          { type: ThreatType.CRUISE_MISSILE, spawnRadius: 300, targetRadius: 50, minInterval: 30000, maxInterval: 60000 },
          { type: ThreatType.QASSAM_1, spawnRadius: 100, targetRadius: 30, minInterval: 4000, maxInterval: 8000 },
          { type: ThreatType.GRAD_ROCKET, spawnRadius: 150, targetRadius: 40, minInterval: 8000, maxInterval: 15000 }
        ]
        break
    }
  }
  
  setSalvoChance(chance: number): void {
    this.salvoChance = Math.max(0, Math.min(1, chance))
  }
  
  // Spawn a specific type of threat on demand
  spawnSpecificThreat(type: 'rocket' | 'mortar' | 'drone' | 'ballistic'): void {
    let threatType: ThreatType
    
    switch(type) {
      case 'rocket':
        // Pick a random rocket type
        const rocketTypes = [ThreatType.SHORT_RANGE, ThreatType.MEDIUM_RANGE, ThreatType.QASSAM_1, ThreatType.GRAD_ROCKET]
        threatType = rocketTypes[Math.floor(Math.random() * rocketTypes.length)]
        break
      case 'mortar':
        threatType = ThreatType.MORTAR
        break
      case 'drone':
        // Pick a random drone type
        const droneTypes = [ThreatType.DRONE_SLOW, ThreatType.DRONE_FAST]
        threatType = droneTypes[Math.floor(Math.random() * droneTypes.length)]
        break
      case 'ballistic':
        threatType = ThreatType.CRUISE_MISSILE
        break
    }
    
    // Create a config for this specific threat
    const config = {
      type: threatType,
      spawnRadius: 150,
      targetRadius: 40,
      minInterval: 0,
      maxInterval: 0
    }
    
    // Get threat stats to determine spawn parameters
    const threatStats = THREAT_CONFIGS[threatType]
    
    // Adjust spawn radius based on threat type
    if (threatStats.isDrone) {
      config.spawnRadius = 200
    } else if (threatStats.isMortar) {
      config.spawnRadius = 80
    } else if (threatType === ThreatType.CRUISE_MISSILE) {
      config.spawnRadius = 250
    }
    
    // Temporarily store current configs
    const originalConfigs = this.spawnConfigs
    this.spawnConfigs = [config]
    
    // Spawn the threat
    this.spawnSingleThreat(0)
    
    // Restore original configs
    this.spawnConfigs = originalConfigs
  }
  
  // Spawn a salvo of threats
  spawnSalvo(size: number, type: string = 'mixed'): void {
      // Performance optimization: batch spawn threats without individual timers
      const startTime = Date.now()
      
      // Determine which threat types to use
      let possibleTypes: ThreatType[] = []
      
      switch(type) {
        case 'rocket':
          possibleTypes = [ThreatType.SHORT_RANGE, ThreatType.MEDIUM_RANGE, ThreatType.QASSAM_1, ThreatType.GRAD_ROCKET]
          break
        case 'mortar':
          possibleTypes = [ThreatType.MORTAR]
          break
        case 'ballistic':
          possibleTypes = [ThreatType.CRUISE_MISSILE]
          break
        case 'mixed':
        default:
          possibleTypes = [
            ThreatType.SHORT_RANGE, ThreatType.MEDIUM_RANGE,
            ThreatType.MORTAR, ThreatType.DRONE_SLOW,
            ThreatType.QASSAM_1
          ]
          break
      }
      
      // Pre-allocate threat configs
      const salvoThreats: Array<{type: ThreatType, delay: number}> = []
      for (let i = 0; i < size; i++) {
        const threatType = possibleTypes[Math.floor(Math.random() * possibleTypes.length)]
        salvoThreats.push({
          type: threatType,
          delay: i * 0.2 // 200ms delay between each
        })
      }
      
      // Use a single timer to spawn all threats
      let currentIndex = 0
      const spawnNext = () => {
        const elapsed = (Date.now() - startTime) / 1000
        
        // Spawn all threats whose delay has passed
        while (currentIndex < salvoThreats.length && salvoThreats[currentIndex].delay <= elapsed) {
          const threat = salvoThreats[currentIndex]
          const config = {
            type: threat.type,
            spawnRadius: 150,
            targetRadius: 40,
            minInterval: 0,
            maxInterval: 0
          }
          
          // Adjust spawn radius based on threat type
          const threatStats = THREAT_CONFIGS[threat.type]
          if (threatStats.isDrone) {
            config.spawnRadius = 200
          } else if (threatStats.isMortar) {
            config.spawnRadius = 80
          } else if (threat.type === ThreatType.CRUISE_MISSILE) {
            config.spawnRadius = 250
          }
          
          // Temporarily set config and spawn
          const originalConfigs = this.spawnConfigs
          this.spawnConfigs = [config]
          this.spawnSingleThreat(0)
          this.spawnConfigs = originalConfigs
          
          currentIndex++
        }
        
        // Continue if more threats to spawn
        if (currentIndex < salvoThreats.length) {
          requestAnimationFrame(spawnNext)
        }
      }
      
      // Start spawning
      requestAnimationFrame(spawnNext)
    }

}