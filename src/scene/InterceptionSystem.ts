import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { IronDomeBattery } from '../entities/IronDomeBattery'
import { Threat } from '../entities/Threat'
import { Projectile } from '../entities/Projectile'
import { FragmentationSystem } from '../systems/FragmentationSystem'
import { DebrisSystem } from '../systems/DebrisSystem'

interface Interception {
  interceptor: Projectile
  threat: Threat
  targetPoint: THREE.Vector3
  launchTime: number
}

export class InterceptionSystem {
  private scene: THREE.Scene
  private world: CANNON.World
  private batteries: IronDomeBattery[] = []
  private activeInterceptions: Interception[] = []
  private interceptors: Projectile[] = []
  private successfulInterceptions: number = 0
  private failedInterceptions: number = 0
  private fragmentationSystem: FragmentationSystem
  private debrisSystem: DebrisSystem

  constructor(scene: THREE.Scene, world: CANNON.World) {
    this.scene = scene
    this.world = world
    this.fragmentationSystem = new FragmentationSystem(scene)
    this.debrisSystem = new DebrisSystem(scene, world)
  }

  addBattery(battery: IronDomeBattery): void {
    this.batteries.push(battery)
  }

  update(threats: Threat[]): Projectile[] {
    const deltaTime = 1/60
    
    // Update batteries with threat information
    this.batteries.forEach(battery => battery.update(deltaTime, threats))
    
    // Update fragmentation system
    const { fragmentPositions } = this.fragmentationSystem.update(deltaTime)
    
    // Update debris system
    this.debrisSystem.update(deltaTime)
    
    // Check if fragments hit any threats
    for (const threat of threats) {
      if (threat.isActive && this.fragmentationSystem.checkFragmentHits(threat.getPosition(), 3)) {
        this.handleFragmentHit(threat)
      }
    }

    // Update interceptors
    for (let i = this.interceptors.length - 1; i >= 0; i--) {
      const interceptor = this.interceptors[i]
      interceptor.update(deltaTime)

      // Remove interceptors that fall below ground or have detonated
      if (interceptor.body.position.y < -10 || !interceptor.isActive) {
        interceptor.destroy(this.scene, this.world)
        this.interceptors.splice(i, 1)
      }
    }

    // Check for new threats to intercept
    this.evaluateThreats(threats)

    // Check for successful interceptions
    this.checkInterceptions()

    // Clean up completed interceptions
    this.cleanupInterceptions()

    return this.interceptors
  }

  private evaluateThreats(threats: Threat[]): void {
    // Sort threats by time to impact (most urgent first)
    const sortedThreats = threats
      .filter(t => t.isActive && t.getTimeToImpact() > 0)
      .sort((a, b) => a.getTimeToImpact() - b.getTimeToImpact())

    for (const threat of sortedThreats) {
      // Check if threat is already being intercepted
      if (this.isBeingIntercepted(threat)) {
        continue
      }

      // Find best battery to intercept
      const battery = this.findBestBattery(threat)
      if (battery && battery.getInterceptorCount() > 0) {
        const interceptor = battery.fireInterceptor(threat)
        if (interceptor) {
          // Set up proximity detonation callback
          interceptor.detonationCallback = (position: THREE.Vector3, quality: number) => {
            this.handleProximityDetonation(interceptor, threat, position, quality)
          }
          
          this.interceptors.push(interceptor)
          this.activeInterceptions.push({
            interceptor,
            threat,
            targetPoint: threat.getImpactPoint() || threat.getPosition(),
            launchTime: Date.now()
          })
          // Removed visual line - this.createInterceptionVisual(threat)
        }
      }
    }
  }

  private isBeingIntercepted(threat: Threat): boolean {
    return this.activeInterceptions.some(i => i.threat === threat && i.interceptor.isActive)
  }
  
  private getInterceptorCount(threat: Threat): number {
    return this.activeInterceptions.filter(i => i.threat === threat && i.interceptor.isActive).length
  }

  private findBestBattery(threat: Threat): IronDomeBattery | null {
    // Find all batteries that can intercept
    const capableBatteries = this.batteries.filter(b => b.canIntercept(threat))
    
    if (capableBatteries.length === 0) {
      return null
    }

    // Choose closest battery
    return capableBatteries.reduce((closest, battery) => {
      const closestDist = threat.getPosition().distanceTo(closest.getPosition())
      const batteryDist = threat.getPosition().distanceTo(battery.getPosition())
      return batteryDist < closestDist ? battery : closest
    })
  }

  private checkInterceptions(): void {
    // Proximity detonations are now handled by the proximity fuse system
    // This method now just cleans up inactive interceptions
    for (let i = this.activeInterceptions.length - 1; i >= 0; i--) {
      const interception = this.activeInterceptions[i]
      
      // Remove if either is inactive
      if (!interception.interceptor.isActive || !interception.threat.isActive) {
        this.activeInterceptions.splice(i, 1)
      }
    }
  }
  
  private handleProximityDetonation(
    interceptor: Projectile, 
    threat: Threat, 
    position: THREE.Vector3, 
    quality: number
  ): void {
    console.log(`Proximity detonation! Quality: ${(quality * 100).toFixed(0)}%`)
    
    // Create simple explosion instead of cone fragmentation
    // Higher quality = larger explosion
    // this.fragmentationSystem.createFragmentation(position, direction, quality)
    
    // Create explosion visual
    this.createExplosion(position, quality)
    
    // Determine if threat is destroyed based on quality
    const destroyProbability = 0.7 + quality * 0.3  // 70% to 100% based on quality
    if (Math.random() < destroyProbability) {
      this.successfulInterceptions++
      
      // Create debris from successful interception
      const threatVelocity = threat.getVelocity()
      this.debrisSystem.createInterceptionDebris(position, threatVelocity)
      
      threat.destroy(this.scene, this.world)
      
      // Remove from active interceptions
      const index = this.activeInterceptions.findIndex(i => i.interceptor === interceptor)
      if (index !== -1) {
        this.activeInterceptions.splice(index, 1)
      }
    } else {
      this.failedInterceptions++
      console.log('Proximity detonation failed to destroy threat')
      
      // Create some debris even on failed interception
      const threatVelocity = threat.getVelocity()
      this.debrisSystem.createDebris(position, threatVelocity.clone().multiplyScalar(0.2), 5)
    }
  }
  
  private handleFragmentHit(threat: Threat): void {
    console.log('Threat destroyed by fragments!')
    this.successfulInterceptions++
    threat.destroy(this.scene, this.world)
    
    // Small explosion at threat position
    this.createExplosion(threat.getPosition(), 0.3)
  }

  private handleSuccessfulInterception(interception: Interception): void {
    this.successfulInterceptions++

    // Create explosion effect
    this.createExplosion(
      interception.interceptor.getPosition()
        .add(interception.threat.getPosition())
        .multiplyScalar(0.5)
    )

    // Destroy both projectiles
    interception.interceptor.destroy(this.scene, this.world)
    interception.threat.destroy(this.scene, this.world)
  }

  private createExplosion(position: THREE.Vector3, quality: number = 1.0): void {
    // Create expanding sphere for explosion
    const geometry = new THREE.SphereGeometry(1, 16, 8)
    const material = new THREE.MeshBasicMaterial({
      color: quality > 0.8 ? 0xffaa00 : 0xff6600,
      opacity: 0.8,
      transparent: true
    })
    const explosion = new THREE.Mesh(geometry, material)
    explosion.position.copy(position)
    this.scene.add(explosion)

    // Animate explosion
    const startTime = Date.now()
    const duration = 800 + quality * 400  // 0.8 to 1.2 seconds based on quality
    const maxScale = 6 + quality * 8  // 6 to 14 based on quality

    const animate = () => {
      const elapsed = Date.now() - startTime
      const progress = elapsed / duration

      if (progress >= 1) {
        this.scene.remove(explosion)
        explosion.geometry.dispose()
        material.dispose()
        return
      }

      // Expand and fade
      const scale = 1 + (maxScale - 1) * progress
      explosion.scale.set(scale, scale, scale)
      material.opacity = 0.8 * (1 - progress)

      requestAnimationFrame(animate)
    }

    animate()

    // Add flash effect
    const flash = new THREE.PointLight(0xffaa00, 3 + quality * 4, 30 + quality * 30)
    flash.position.copy(position)
    this.scene.add(flash)

    setTimeout(() => {
      this.scene.remove(flash)
    }, 200)
    
    // Add smoke ring for high quality detonations
    if (quality > 0.7) {
      this.createSmokeRing(position)
    }
  }
  
  private createSmokeRing(position: THREE.Vector3): void {
    const ringGeometry = new THREE.TorusGeometry(2, 0.5, 8, 16)
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x666666,
      opacity: 0.6,
      transparent: true
    })
    const ring = new THREE.Mesh(ringGeometry, ringMaterial)
    ring.position.copy(position)
    ring.rotation.x = Math.PI / 2
    this.scene.add(ring)
    
    const startTime = Date.now()
    const animate = () => {
      const elapsed = (Date.now() - startTime) / 1000
      if (elapsed > 2) {
        this.scene.remove(ring)
        ring.geometry.dispose()
        ringMaterial.dispose()
        return
      }
      
      const scale = 1 + elapsed * 3
      ring.scale.set(scale, scale, scale)
      ring.position.y += elapsed * 2
      ringMaterial.opacity = 0.6 * (1 - elapsed / 2)
      
      requestAnimationFrame(animate)
    }
    animate()
  }

  private createInterceptionVisual(threat: Threat): void {
    // Create line showing interception trajectory
    const targetPoint = threat.getImpactPoint()
    if (!targetPoint) return

    const points = [
      this.batteries[0].getPosition().add(new THREE.Vector3(0, 3, 0)),
      threat.getPosition()
    ]

    const geometry = new THREE.BufferGeometry().setFromPoints(points)
    const material = new THREE.LineBasicMaterial({
      color: 0x00ffff,
      opacity: 0.5,
      transparent: true
    })

    const line = new THREE.Line(geometry, material)
    this.scene.add(line)

    // Remove after 2 seconds
    setTimeout(() => {
      this.scene.remove(line)
      geometry.dispose()
      material.dispose()
    }, 2000)
  }

  private cleanupInterceptions(): void {
    // Remove completed interceptions
    this.activeInterceptions = this.activeInterceptions.filter(interception => {
      // Check if interceptor went too low or too much time passed
      if (interception.interceptor.body.position.y < -5 ||
          Date.now() - interception.launchTime > 30000) {
        this.failedInterceptions++
        return false
      }
      return interception.interceptor.isActive && interception.threat.isActive
    })
  }

  getStats() {
    return {
      successful: this.successfulInterceptions,
      failed: this.failedInterceptions,
      active: this.activeInterceptions.length,
      batteries: this.batteries.length,
      totalInterceptors: this.batteries.reduce((sum, b) => sum + b.getInterceptorCount(), 0),
      activeInterceptors: this.interceptors.length
    }
  }
}