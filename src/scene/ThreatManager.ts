import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { Threat, ThreatType } from '../entities/Threat'
import { TrajectoryCalculator } from '../utils/TrajectoryCalculator'
import { LaunchEffectsSystem } from '../systems/LaunchEffectsSystem'

export interface ThreatSpawnConfig {
  type: ThreatType
  spawnRadius: number
  targetRadius: number
  minInterval: number  // ms
  maxInterval: number  // ms
}

export class ThreatManager {
  private scene: THREE.Scene
  private world: CANNON.World
  private threats: Threat[] = []
  private spawnConfigs: ThreatSpawnConfig[]
  private lastSpawnTime: number = 0
  private nextSpawnTime: number = 0
  private isSpawning: boolean = false
  private impactMarkers: THREE.Mesh[] = []
  private launchEffects: LaunchEffectsSystem

  constructor(scene: THREE.Scene, world: CANNON.World) {
    this.scene = scene
    this.world = world
    
    // Initialize launch effects system
    this.launchEffects = new LaunchEffectsSystem(scene)
    
    // Default spawn configurations
    this.spawnConfigs = [
      {
        type: ThreatType.SHORT_RANGE,
        spawnRadius: 150,  // Increased from 80
        targetRadius: 40,
        minInterval: 3000,
        maxInterval: 8000
      },
      {
        type: ThreatType.MEDIUM_RANGE,
        spawnRadius: 180,  // Increased from 150
        targetRadius: 60,
        minInterval: 5000,
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

      // Check if threat has hit ground
      if (threat.body.position.y <= 0.5 && threat.isActive) {
        // Create explosion at impact point
        this.createGroundExplosion(threat.getPosition())
        this.removeThreat(i)
      } else if (threat.body.position.y < -5) {
        // Remove if somehow went too far below ground
        this.removeThreat(i)
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
    // Chance to spawn multiple threats simultaneously (salvo)
    const isSalvo = Math.random() < 0.3  // 30% chance for salvo
    const salvoSize = isSalvo ? 2 + Math.floor(Math.random() * 3) : 1  // 2-4 threats in salvo
    
    for (let i = 0; i < salvoSize; i++) {
      this.spawnSingleThreat(i * 0.5)  // Slight delay between salvo launches
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
    
    // Random target position within target radius
    const targetAngle = Math.random() * Math.PI * 2
    const targetDistance = Math.random() * config.targetRadius
    const targetX = Math.cos(targetAngle) * targetDistance
    const targetZ = Math.sin(targetAngle) * targetDistance
    
    const targetPosition = new THREE.Vector3(targetX, 0, targetZ)
    
    // Calculate launch parameters for ballistic trajectory
    const threatConfig = {
      [ThreatType.SHORT_RANGE]: { velocity: 200, minAngle: 60, maxAngle: 75 },
      [ThreatType.MEDIUM_RANGE]: { velocity: 400, minAngle: 70, maxAngle: 80 },
      [ThreatType.LONG_RANGE]: { velocity: 600, minAngle: 75, maxAngle: 85 }
    }[config.type]
    
    // For ballistic missiles, we want high angle launches (60-85 degrees)
    const launchParams = TrajectoryCalculator.calculateLaunchParameters(
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
    
    const velocity = TrajectoryCalculator.getVelocityVector(launchParams)
    
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

  private removeThreat(index: number): void {
    const threat = this.threats[index]
    threat.destroy(this.scene, this.world)
    this.threats.splice(index, 1)
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
      this.removeThreat(0)
    }
    
    // Remove all impact markers
    this.impactMarkers.forEach(marker => {
      this.scene.remove(marker)
      marker.geometry.dispose()
      ;(marker.material as THREE.Material).dispose()
    })
    this.impactMarkers = []
  }

  private createGroundExplosion(position: THREE.Vector3): void {
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

    // Debris particles
    const debrisCount = 15
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

      // Expand shockwave
      const ringScale = 1 + progress * 15
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
}