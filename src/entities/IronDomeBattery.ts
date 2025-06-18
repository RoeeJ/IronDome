import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { Projectile } from './Projectile'
import { Threat } from './Threat'
import { TrajectoryCalculator } from '../utils/TrajectoryCalculator'
import { StaticRadarNetwork } from '../scene/StaticRadarNetwork'
import { LaunchEffectsSystem } from '../systems/LaunchEffectsSystem'

export interface BatteryConfig {
  position: THREE.Vector3
  maxRange: number
  minRange: number
  reloadTime: number  // ms per missile
  interceptorSpeed: number  // m/s
  launcherCount: number  // Number of launch tubes
  successRate: number  // 0.0 to 1.0, default 0.9 (90%)
  aggressiveness: number  // 1.0 to 3.0, how many interceptors per high-value threat
  firingDelay: number  // ms between shots when firing multiple interceptors
}

interface LauncherTube {
  index: number
  mesh: THREE.Mesh
  isLoaded: boolean
  lastFiredTime: number
  missile?: THREE.Mesh
}

export class IronDomeBattery {
  private scene: THREE.Scene
  private world: CANNON.World
  private config: BatteryConfig
  private group: THREE.Group
  private launcherGroup: THREE.Group
  private radarDome: THREE.Mesh
  private launcherTubes: LauncherTube[] = []
  private rangeIndicator: THREE.Line
  private radarNetwork?: StaticRadarNetwork
  private launchEffects: LaunchEffectsSystem
  private launchOffset: THREE.Vector3 = new THREE.Vector3(-2, 14.5, -0.1)
  private launchDirection: THREE.Vector3 = new THREE.Vector3(0.6, 1, 0.15).normalize()

  constructor(scene: THREE.Scene, world: CANNON.World, config: Partial<BatteryConfig> = {}) {
    this.scene = scene
    this.world = world
    
    // Default configuration
    this.config = {
      position: new THREE.Vector3(0, 0, 0),
      maxRange: 70,
      minRange: 4,
      reloadTime: 3000,  // 3 seconds per missile
      interceptorSpeed: 100,
      launcherCount: 6,
      successRate: 0.95,  // 95% success rate
      aggressiveness: 1.3,  // Default to firing 1-2 interceptors per threat (reduced from 1.5)
      firingDelay: 800,  // 800ms between launches for staggered impacts (increased from 150ms)
      ...config
    }
    
    this.group = new THREE.Group()
    this.group.position.copy(this.config.position)
    
    // Create battery components (will be replaced if model loads)
    this.createBase()
    this.launcherGroup = this.createLauncher()
    this.radarDome = this.createRadarDome()
    this.rangeIndicator = this.createRangeIndicator()
    
    // Mark components as procedural for later removal
    this.launcherGroup.userData.isProcedural = true
    if (this.radarDome) this.radarDome.userData.isProcedural = true
    
    // Try to load external model
    this.loadBatteryModel()
    
    // Initialize launch effects system
    this.launchEffects = new LaunchEffectsSystem(scene)
    
    // Radar system will be set externally
    
    scene.add(this.group)
  }

  private createBase(): void {
    // Base platform
    const baseGeometry = new THREE.BoxGeometry(6, 1, 6)
    const baseMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a4a4a,
      roughness: 0.8,
      metalness: 0.3
    })
    const base = new THREE.Mesh(baseGeometry, baseMaterial)
    base.position.y = 0.5
    base.castShadow = true
    base.receiveShadow = true
    this.group.add(base)

    // Support pillars
    const pillarGeometry = new THREE.CylinderGeometry(0.3, 0.3, 2)
    const pillarMaterial = new THREE.MeshStandardMaterial({
      color: 0x333333,
      roughness: 0.7,
      metalness: 0.4
    })
    
    const positions = [
      [-2, 0, -2], [2, 0, -2], [-2, 0, 2], [2, 0, 2]
    ]
    
    positions.forEach(pos => {
      const pillar = new THREE.Mesh(pillarGeometry, pillarMaterial)
      pillar.position.set(pos[0], pos[1] + 1, pos[2])
      pillar.castShadow = true
      this.group.add(pillar)
    })
  }

  private createLauncher(): THREE.Group {
    const launcherGroup = new THREE.Group()
    
    // Launcher tubes
    const tubeGeometry = new THREE.CylinderGeometry(0.2, 0.2, 3)
    const tubeMaterial = new THREE.MeshStandardMaterial({
      color: 0x666666,
      roughness: 0.5,
      metalness: 0.7
    })
    
    // Create launch tubes in a circular pattern
    for (let i = 0; i < this.config.launcherCount; i++) {
      const angle = (i / this.config.launcherCount) * Math.PI * 2
      const tube = new THREE.Mesh(tubeGeometry, tubeMaterial)
      tube.position.x = Math.cos(angle) * 0.8
      tube.position.z = Math.sin(angle) * 0.8
      tube.position.y = 0
      tube.rotation.z = Math.PI / 8  // Slightly angled outward
      tube.castShadow = true
      launcherGroup.add(tube)
      
      // Create launcher tube data
      const launcherTube: LauncherTube = {
        index: i,
        mesh: tube,
        isLoaded: true,
        lastFiredTime: 0
      }
      
      // Add visual missile in tube
      this.createMissileInTube(launcherTube, launcherGroup)
      this.launcherTubes.push(launcherTube)
    }
    
    // Central mounting
    const mountGeometry = new THREE.CylinderGeometry(1.2, 1.5, 1)
    const mountMaterial = new THREE.MeshStandardMaterial({
      color: 0x555555,
      roughness: 0.6,
      metalness: 0.5
    })
    const mount = new THREE.Mesh(mountGeometry, mountMaterial)
    mount.castShadow = true
    launcherGroup.add(mount)
    
    launcherGroup.position.y = 2.5
    this.group.add(launcherGroup)
    
    return launcherGroup
  }

  private createMissileInTube(tube: LauncherTube, parent: THREE.Group): void {
    if (!tube.isLoaded) return
    
    const missileGeometry = new THREE.ConeGeometry(0.15, 2, 8)
    const missileMaterial = new THREE.MeshStandardMaterial({
      color: 0x00ffff,
      emissive: 0x00ffff,
      emissiveIntensity: 0.1,
      roughness: 0.3,
      metalness: 0.8
    })
    
    const missile = new THREE.Mesh(missileGeometry, missileMaterial)
    missile.position.copy(tube.mesh.position)
    missile.position.y += 0.5  // Position at top of tube
    missile.rotation.z = tube.mesh.rotation.z
    parent.add(missile)
    
    tube.missile = missile
  }

  private createRadarDome(): THREE.Mesh {
    // Radar dome
    const domeGeometry = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)
    const domeMaterial = new THREE.MeshStandardMaterial({
      color: 0x888888,
      roughness: 0.3,
      metalness: 0.8,
      opacity: 0.9,
      transparent: true
    })
    const dome = new THREE.Mesh(domeGeometry, domeMaterial)
    dome.position.y = 4
    dome.castShadow = true
    this.group.add(dome)
    
    // Radar antenna (simplified)
    const antennaGeometry = new THREE.BoxGeometry(0.2, 0.8, 0.1)
    const antennaMaterial = new THREE.MeshStandardMaterial({
      color: 0xaaaaaa,
      roughness: 0.4,
      metalness: 0.9
    })
    const antenna = new THREE.Mesh(antennaGeometry, antennaMaterial)
    antenna.position.y = 4
    this.group.add(antenna)
    
    return dome
  }

  private createRangeIndicator(): THREE.Line {
    // Range indicator is now handled by RadarSystem
    // This method is kept for compatibility but returns an empty line
    const geometry = new THREE.BufferGeometry()
    const material = new THREE.LineBasicMaterial()
    return new THREE.Line(geometry, material)
  }

  setRadarNetwork(radarNetwork: StaticRadarNetwork): void {
    this.radarNetwork = radarNetwork
  }

  canIntercept(threat: Threat): boolean {
    // Check if detected by radar network
    if (!this.radarNetwork || !this.radarNetwork.checkDetection(threat.getPosition())) {
      return false
    }
    
    // Check if any tube is loaded
    const hasLoadedTube = this.launcherTubes.some(tube => tube.isLoaded)
    if (!hasLoadedTube) {
      return false
    }
    
    // Check range
    const distance = threat.getPosition().distanceTo(this.config.position)
    if (distance > this.config.maxRange || distance < this.config.minRange) {
      return false
    }
    
    // Check if we can reach the threat in time
    const interceptionPoint = TrajectoryCalculator.calculateInterceptionPoint(
      threat.getPosition(),
      threat.getVelocity(),
      this.config.position,
      this.config.interceptorSpeed
    )
    
    return interceptionPoint !== null
  }

  assessThreatLevel(threat: Threat): number {
    // Returns a threat level from 0 to 1
    let threatLevel = 0.5  // Base threat level
    
    // Factor 1: Speed (faster threats are more dangerous)
    const speed = threat.getVelocity().length()
    if (speed > 300) threatLevel += 0.2
    else if (speed > 200) threatLevel += 0.1
    
    // Factor 2: Time to impact (less time = more urgent)
    const timeToImpact = threat.getTimeToImpact()
    if (timeToImpact < 5) threatLevel += 0.3
    else if (timeToImpact < 10) threatLevel += 0.2
    else if (timeToImpact < 15) threatLevel += 0.1
    
    // Factor 3: Altitude (lower altitude = harder to intercept)
    const altitude = threat.getPosition().y
    if (altitude < 50) threatLevel += 0.1
    
    // Factor 4: Distance from battery (closer = more urgent)
    const distance = threat.getPosition().distanceTo(this.config.position)
    const rangeRatio = distance / this.config.maxRange
    if (rangeRatio < 0.3) threatLevel += 0.2
    else if (rangeRatio < 0.5) threatLevel += 0.1
    
    return Math.min(1.0, threatLevel)
  }

  calculateInterceptorCount(threat: Threat, existingInterceptors: number = 0): number {
    // Determine how many interceptors to fire based on threat assessment
    const threatLevel = this.assessThreatLevel(threat)
    const baseCount = Math.floor(this.config.aggressiveness)
    
    // High threat gets extra interceptor
    let count = threatLevel > 0.7 ? baseCount + 1 : baseCount
    
    // Random chance for additional interceptor based on aggressiveness fractional part
    const extraChance = this.config.aggressiveness % 1
    if (Math.random() < extraChance) {
      count++
    }
    
    // Subtract already fired interceptors
    count = Math.max(0, count - existingInterceptors)
    
    // Limit by available loaded tubes
    const loadedTubes = this.launcherTubes.filter(tube => tube.isLoaded).length
    count = Math.min(count, loadedTubes)
    
    // Performance optimization: limit to 2 simultaneous interceptors
    // to prevent triangle count spikes (each adds ~100 tris + particles)
    return Math.min(count, 2)
  }

  fireInterceptors(threat: Threat, count: number = 1, onLaunch?: (interceptor: Projectile) => void): Projectile[] {
    if (!this.canIntercept(threat)) {
      return []
    }
    
    // Find loaded tubes
    const loadedTubes = this.launcherTubes.filter(tube => tube.isLoaded)
    if (loadedTubes.length === 0) {
      return []
    }
    
    // Ammo management: adjust firing based on available interceptors
    const ammoRatio = loadedTubes.length / this.launcherTubes.length
    const threatLevel = this.assessThreatLevel(threat)
    
    // Conservative firing when low on ammo, unless threat is critical
    if (ammoRatio < 0.3 && threatLevel < 0.8 && count > 1) {
      console.log('Low ammo - reducing interceptor count')
      count = 1
    }
    
    // Limit count to available tubes
    count = Math.min(count, loadedTubes.length)
    const interceptors: Projectile[] = []
    
    // Calculate optimal firing delay for staggered impacts
    const distance = threat.getPosition().distanceTo(this.config.position)
    const timeToImpact = distance / this.config.interceptorSpeed
    
    // Base delay should be proportional to flight time to ensure staggered arrivals
    // For a 10 second flight, we want ~1 second between impacts
    const optimalDelay = Math.max(500, Math.min(2000, timeToImpact * 100))
    
    // Adjust firing delay based on threat urgency
    const urgencyMultiplier = threatLevel > 0.7 ? 0.7 : 1.0
    const adjustedDelay = optimalDelay * urgencyMultiplier
    
    // Fire interceptors with adjusted delay between each
    for (let i = 0; i < count; i++) {
      const tube = loadedTubes[i]
      if (!tube) break
      
      if (i === 0) {
        // Fire first one immediately
        const interceptor = this.launchFromTube(tube, threat)
        if (interceptor) {
          interceptors.push(interceptor)
          if (onLaunch) onLaunch(interceptor)
        }
      } else {
        // Fire subsequent ones with delay
        setTimeout(() => {
          const interceptor = this.launchFromTube(tube, threat)
          if (interceptor && onLaunch) {
            onLaunch(interceptor)
          }
        }, i * adjustedDelay)
      }
    }
    
    return interceptors
  }

  fireInterceptor(threat: Threat): Projectile | null {
    // Legacy method - fires single interceptor
    const interceptors = this.fireInterceptors(threat, 1)
    return interceptors.length > 0 ? interceptors[0] : null
  }
  
  private launchFromTube(tube: LauncherTube, threat: Threat): Projectile | null {
    // Calculate interception point
    const interceptionData = TrajectoryCalculator.calculateInterceptionPoint(
      threat.getPosition(),
      threat.getVelocity(),
      this.config.position,
      this.config.interceptorSpeed
    )
    
    if (!interceptionData) {
      return null
    }
    
    // Calculate launch parameters with lofted trajectory
    const launchParams = TrajectoryCalculator.calculateLaunchParameters(
      this.config.position,
      interceptionData.point,
      this.config.interceptorSpeed,
      true  // Use lofted trajectory for interceptors
    )
    
    if (!launchParams) {
      return null
    }
    
    // Get launch position with offset
    const tubeWorldPos = this.config.position.clone()
    tubeWorldPos.add(this.launchOffset)
    
    // Determine if this interceptor will fail
    let failureMode: 'none' | 'motor' | 'guidance' | 'premature' = 'none'
    let failureTime = 0
    
    if (Math.random() > this.config.successRate) {
      // Interceptor will fail - determine failure mode
      const failureRoll = Math.random()
      if (failureRoll < 0.4) {
        failureMode = 'motor'
        failureTime = 0.5 + Math.random() * 2  // Motor fails 0.5-2.5s after launch
      } else if (failureRoll < 0.7) {
        failureMode = 'guidance'
        failureTime = 1 + Math.random() * 3    // Guidance fails 1-4s after launch
      } else {
        failureMode = 'premature'
        failureTime = 0.2 + Math.random() * 2  // Premature detonation 0.2-2.2s after launch
      }
      
      console.log(`Interceptor will fail: ${failureMode} at ${failureTime.toFixed(1)}s`)
    }
    
    // Create interceptor with adjusted initial velocity based on launch direction
    let velocity = TrajectoryCalculator.getVelocityVector(launchParams)
    
    // Blend calculated velocity with launch direction for more realistic launch
    // This ensures the missile initially follows the launcher's direction
    const launchSpeed = velocity.length()
    const launchVelocity = this.launchDirection.clone().multiplyScalar(launchSpeed)
    
    // Blend: 70% launch direction, 30% calculated direction for first moments
    velocity = launchVelocity.multiplyScalar(0.7).add(velocity.multiplyScalar(0.3))
    velocity.normalize().multiplyScalar(launchSpeed)
    
    const interceptor = new Projectile(this.scene, this.world, {
      position: tubeWorldPos,
      velocity,
      color: 0x00ffff,
      radius: 0.3,
      mass: 20,  // Reduced mass for better maneuverability
      trailLength: 100,
      isInterceptor: true,
      target: threat.mesh,
      failureMode,
      failureTime,
      maxLifetime: 10  // 10 second max flight time
    })
    
    // Update tube state
    tube.isLoaded = false
    tube.lastFiredTime = Date.now()
    
    // Remove visual missile from tube
    if (tube.missile) {
      this.launcherGroup.remove(tube.missile)
      tube.missile.geometry.dispose()
      ;(tube.missile.material as THREE.Material).dispose()
      tube.missile = undefined
    }
    
    // Animate launcher
    this.animateLaunch(tube)
    
    return interceptor
  }

  private animateLaunch(tube: LauncherTube): void {
    // Tube recoil animation
    const originalY = tube.mesh.position.y
    const originalRotation = tube.mesh.rotation.z
    tube.mesh.position.y -= 0.15
    tube.mesh.rotation.z += 0.05  // Slight rotation from recoil
    
    setTimeout(() => {
      tube.mesh.position.y = originalY
      tube.mesh.rotation.z = originalRotation
    }, 300)
    
    // Get launch position and direction
    const tubeWorldPos = this.config.position.clone()
    tubeWorldPos.add(this.launchOffset)
    
    // Use configured launch direction
    const launchDirection = this.launchDirection.clone()
    
    // Create comprehensive launch effects
    this.launchEffects.createLaunchEffect(tubeWorldPos, launchDirection, {
      smokeCloudSize: 4,
      smokeDuration: 2000,
      flashIntensity: 6,
      flashDuration: 120,
      dustRadius: 2,  // Further reduced for more realistic size
      scorchMarkRadius: 1.5
    })
  }

  update(deltaTime: number, threats: Threat[]): void {
    // Rotate radar dome (visual only)
    if (this.radarDome) {
      this.radarDome.rotation.y += deltaTime * 0.5
    }
    
    // Update launch effects
    this.launchEffects.update()
    
    // Ammo management: adjust reload time based on threat environment
    const reloadTimeMultiplier = this.calculateReloadMultiplier(threats)
    
    // Reload individual tubes
    const currentTime = Date.now()
    this.launcherTubes.forEach(tube => {
      if (!tube.isLoaded) {
        const adjustedReloadTime = this.config.reloadTime * reloadTimeMultiplier
        if (currentTime - tube.lastFiredTime >= adjustedReloadTime) {
          // Reload this tube
          tube.isLoaded = true
          this.createMissileInTube(tube, this.launcherGroup)
        }
      }
    })
  }
  
  private calculateReloadMultiplier(threats: Threat[]): number {
    // Ammo management: adjust reload speed based on threat situation
    const activeThreats = threats.filter(t => t.isActive)
    const loadedTubes = this.launcherTubes.filter(t => t.isLoaded).length
    const totalTubes = this.launcherTubes.length
    
    // Factor 1: Threat density
    const threatDensity = activeThreats.length
    
    // Factor 2: Ammo availability
    const ammoRatio = loadedTubes / totalTubes
    
    // Factor 3: Average threat urgency
    let avgTimeToImpact = 20 // Default high value
    if (activeThreats.length > 0) {
      const totalTime = activeThreats.reduce((sum, t) => sum + t.getTimeToImpact(), 0)
      avgTimeToImpact = totalTime / activeThreats.length
    }
    
    // Calculate multiplier
    let multiplier = 1.0
    
    // Many threats + low ammo = faster reload (up to 50% faster)
    if (threatDensity > 5 && ammoRatio < 0.3) {
      multiplier = 0.5
    }
    // Moderate threats = normal to slightly faster
    else if (threatDensity > 2) {
      multiplier = 0.7 + ammoRatio * 0.3
    }
    // Few threats + high ammo = slower reload (conserve readiness)
    else if (threatDensity <= 2 && ammoRatio > 0.7) {
      multiplier = 1.2
    }
    
    // Urgent threats override and speed up reload
    if (avgTimeToImpact < 10) {
      multiplier *= 0.7
    }
    
    return Math.max(0.5, Math.min(1.5, multiplier))
  }

  getInterceptorCount(): number {
    return this.launcherTubes.filter(tube => tube.isLoaded).length
  }

  getPosition(): THREE.Vector3 {
    return this.config.position.clone()
  }
  
  getConfig(): BatteryConfig {
    return this.config
  }
  
  setLaunchOffset(offset: THREE.Vector3): void {
    this.launchOffset = offset.clone()
  }
  
  setLaunchDirection(direction: THREE.Vector3): void {
    this.launchDirection = direction.clone().normalize()
  }

  private loadBatteryModel(): void {
    const loader = new OBJLoader()
    loader.load(
      '/assets/Battery.obj',
      (object) => {
        // Model loaded successfully
        console.log('Battery model loaded:', object)
        
        // Log what we loaded
        let meshCount = 0
        object.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            meshCount++
            console.log('Found battery mesh:', child.name, 'vertices:', child.geometry.attributes.position?.count)
          }
        })
        console.log('Total meshes in battery model:', meshCount)
        
        // Calculate model bounds to determine proper scale
        const box = new THREE.Box3().setFromObject(object)
        const size = box.getSize(new THREE.Vector3())
        console.log('Original battery model size:', size)
        
        // Check if model has valid size
        if (size.x === 0 || size.y === 0 || size.z === 0) {
          console.error('Battery model has zero size!', size)
          return
        }
        
        // If model is too small or too large, scale it
        const targetHeight = 4
        let scaleFactor = 1
        if (size.y < 0.1 || size.y > 100) {
          scaleFactor = targetHeight / size.y
          object.scale.set(scaleFactor, scaleFactor, scaleFactor)
        }
        console.log('Battery scale factor:', scaleFactor)
        
        // Center the model at origin
        box.setFromObject(object)
        const center = box.getCenter(new THREE.Vector3())
        const minY = box.min.y
        object.position.set(-center.x, -minY, -center.z)  // Place on ground
        console.log('Battery model positioned at:', object.position)
        
        // Apply material to all meshes in the model
        object.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.material = new THREE.MeshStandardMaterial({
              color: 0x4a4a4a,
              roughness: 0.7,
              metalness: 0.5
            })
            child.castShadow = true
            child.receiveShadow = true
          }
        })
        
        // Hide procedurally generated base components but keep launcher tubes
        this.group.children.forEach(child => {
          if (child.userData.isProcedural && child !== this.launcherGroup) {
            child.visible = false
          }
        })
        
        // Position launcher group above the model
        this.launcherGroup.position.y = targetHeight
        
        // Add the model to the group
        this.group.add(object)
        
        // Log model info for debugging
        console.log('Battery model added to scene')
        console.log('Battery model bounds:', new THREE.Box3().setFromObject(object))
      },
      (xhr) => {
        // Progress callback
        console.log('Loading battery model...', (xhr.loaded / xhr.total * 100).toFixed(0) + '%')
      },
      (error) => {
        // Error callback - keep procedural model
        console.error('Failed to load battery model:', error)
        console.log('Using procedural model')
      }
    )
  }
}