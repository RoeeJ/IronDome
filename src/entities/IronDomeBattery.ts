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
  private launchOffset: THREE.Vector3 = new THREE.Vector3(0, 3, 0)
  private launchDirection: THREE.Vector3 = new THREE.Vector3(0, 1, 0)
  private debugHelper?: THREE.Mesh
  private debugArrow?: THREE.ArrowHelper

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

  fireInterceptor(threat: Threat): Projectile | null {
    if (!this.canIntercept(threat)) {
      return null
    }
    
    // Find first loaded tube
    const loadedTube = this.launcherTubes.find(tube => tube.isLoaded)
    if (!loadedTube) {
      return null
    }
    
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
      failureTime
    })
    
    // Update tube state
    loadedTube.isLoaded = false
    loadedTube.lastFiredTime = Date.now()
    
    // Remove visual missile from tube
    if (loadedTube.missile) {
      this.launcherGroup.remove(loadedTube.missile)
      loadedTube.missile.geometry.dispose()
      ;(loadedTube.missile.material as THREE.Material).dispose()
      loadedTube.missile = undefined
    }
    
    // Animate launcher
    this.animateLaunch(loadedTube)
    
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
    
    // Reload individual tubes
    const currentTime = Date.now()
    this.launcherTubes.forEach(tube => {
      if (!tube.isLoaded && currentTime - tube.lastFiredTime >= this.config.reloadTime) {
        // Reload this tube
        tube.isLoaded = true
        this.createMissileInTube(tube, this.launcherGroup)
      }
    })
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
    this.updateDebugHelper()
  }
  
  setLaunchDirection(direction: THREE.Vector3): void {
    this.launchDirection = direction.clone().normalize()
    this.updateDebugHelper()
  }
  
  setShowDebugHelpers(show: boolean): void {
    if (show) {
      if (!this.debugHelper) {
        // Create debug helper sphere at launch position
        const geometry = new THREE.SphereGeometry(1, 16, 8)
        const material = new THREE.MeshBasicMaterial({ 
          color: 0xff00ff, 
          wireframe: true 
        })
        this.debugHelper = new THREE.Mesh(geometry, material)
        this.group.add(this.debugHelper)
      }
      
      if (!this.debugArrow) {
        // Create arrow showing launch direction
        this.debugArrow = new THREE.ArrowHelper(
          this.launchDirection,
          this.launchOffset,
          10,  // Length
          0xff00ff  // Purple color
        )
        this.group.add(this.debugArrow)
      }
      
      this.updateDebugHelper()
    } else {
      if (this.debugHelper) {
        this.group.remove(this.debugHelper)
        this.debugHelper.geometry.dispose()
        ;(this.debugHelper.material as THREE.Material).dispose()
        this.debugHelper = undefined
      }
      
      if (this.debugArrow) {
        this.group.remove(this.debugArrow)
        this.debugArrow.dispose()
        this.debugArrow = undefined
      }
    }
  }
  
  private updateDebugHelper(): void {
    if (this.debugHelper) {
      this.debugHelper.position.copy(this.launchOffset)
    }
    
    if (this.debugArrow) {
      this.debugArrow.position.copy(this.launchOffset)
      this.debugArrow.setDirection(this.launchDirection)
    }
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