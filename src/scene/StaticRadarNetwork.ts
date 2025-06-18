import * as THREE from 'three'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'

export interface RadarStation {
  position: THREE.Vector3
  model?: THREE.Object3D
  detectionRadius: number
  group: THREE.Group
}

export class StaticRadarNetwork {
  private scene: THREE.Scene
  private radars: RadarStation[] = []
  private detectionRadius: number
  private coverageMaterial: THREE.MeshBasicMaterial
  private showCoverage: boolean = false
  private coverageMeshes: THREE.Mesh[] = []
  private modelFacingDirection: THREE.Vector3 = new THREE.Vector3(1, 0, 0) // Model faces +X

  constructor(scene: THREE.Scene, detectionRadius: number = 100) {
    this.scene = scene
    this.detectionRadius = detectionRadius
    
    
    // Material for coverage visualization
    this.coverageMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      opacity: 0.1,
      transparent: true,
      side: THREE.DoubleSide
    })
    
    this.setupRadarStations()
  }

  private setupRadarStations(): void {
    // Place radars at four corners of the ground plane (400x400 plane)
    const positions = [
      new THREE.Vector3(-188, 0, -188),  // Front-left
      new THREE.Vector3(188, 0, -188),   // Front-right
      new THREE.Vector3(-188, 0, 188),   // Back-left
      new THREE.Vector3(188, 0, 188)     // Back-right
    ]
    
    positions.forEach((position, index) => {
      this.createRadarStation(position, index)
    })
  }

  private createRadarStation(position: THREE.Vector3, index: number): void {
    const group = new THREE.Group()
    group.position.copy(position)
    
    // Calculate rotation to face inward toward center for overlapping coverage
    const angle = Math.atan2(-position.z, -position.x)
    group.rotation.y = angle
    
    // Determine corner name
    
    const radar: RadarStation = {
      position,
      detectionRadius: this.detectionRadius,
      group
    }
    
    // Create coverage dome
    this.createCoverageDome(radar)
    
    // Create base (will be replaced by model if it loads)
    this.createProceduralRadar(radar, index)
    
    // Try to load radar model
    this.loadRadarModel(radar, index)
    
    this.scene.add(group)
    this.radars.push(radar)
    
  }

  private createCoverageDome(radar: RadarStation): void {
    // Create static coverage dome
    const domeGeometry = new THREE.SphereGeometry(
      this.detectionRadius,
      32,
      16,
      0,
      Math.PI * 2,
      0,
      Math.PI / 2  // Half sphere
    )
    
    const domeMesh = new THREE.Mesh(domeGeometry, this.coverageMaterial)
    domeMesh.visible = this.showCoverage
    radar.group.add(domeMesh)
    this.coverageMeshes.push(domeMesh)
    
    // Add wireframe overlay
    const wireframeMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      opacity: 0.2,
      transparent: true,
      wireframe: true
    })
    
    const wireframeMesh = new THREE.Mesh(domeGeometry, wireframeMaterial)
    wireframeMesh.visible = this.showCoverage
    radar.group.add(wireframeMesh)
    this.coverageMeshes.push(wireframeMesh)
    
    // Add range ring
    const ringGeometry = new THREE.RingGeometry(
      this.detectionRadius - 1,
      this.detectionRadius,
      64
    )
    
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      opacity: 0.3,
      transparent: true,
      side: THREE.DoubleSide
    })
    
    const ring = new THREE.Mesh(ringGeometry, ringMaterial)
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.1
    ring.visible = this.showCoverage
    radar.group.add(ring)
    this.coverageMeshes.push(ring)
  }

  private createProceduralRadar(radar: RadarStation, index: number): void {
    // Tower base - positioned to sit on ground
    const baseGeometry = new THREE.CylinderGeometry(3, 4, 12)
    const baseMaterial = new THREE.MeshStandardMaterial({
      color: 0x2a2a2a,
      roughness: 0.8,
      metalness: 0.3,
      emissive: 0x111111,
      emissiveIntensity: 0.5
    })
    const base = new THREE.Mesh(baseGeometry, baseMaterial)
    base.position.y = 6  // Half the height (12/2) to sit on ground
    base.castShadow = true
    base.receiveShadow = true
    base.userData.isProcedural = true
    radar.group.add(base)
    
    // Radar dish (half sphere facing forward)
    const dishGeometry = new THREE.SphereGeometry(6, 16, 8, 0, Math.PI)
    const dishMaterial = new THREE.MeshStandardMaterial({
      color: 0x888888,
      roughness: 0.4,
      metalness: 0.7,
      emissive: 0x444444,
      emissiveIntensity: 0.3
    })
    const dish = new THREE.Mesh(dishGeometry, dishMaterial)
    dish.rotation.x = -Math.PI / 2  // Point dish forward
    dish.rotation.z = Math.PI  // Face inward (toward center)
    dish.position.y = 12  // On top of base
    dish.castShadow = true
    dish.userData.isProcedural = true
    radar.group.add(dish)
    
    // Add a bright beacon light on top for visibility
    const beaconGeometry = new THREE.SphereGeometry(1, 16, 8)
    const beaconMaterial = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      emissive: 0xff0000,
      emissiveIntensity: 1
    })
    const beacon = new THREE.Mesh(beaconGeometry, beaconMaterial)
    beacon.position.y = 15
    beacon.userData.isProcedural = true
    radar.group.add(beacon)
    
    // Add point light for visibility
    const light = new THREE.PointLight(0xff0000, 2, 50)
    light.position.y = 15
    radar.group.add(light)
    
    
    // Add a tall antenna for extra visibility
    const antennaGeometry = new THREE.CylinderGeometry(0.2, 0.3, 20)
    const antennaMaterial = new THREE.MeshStandardMaterial({
      color: 0xaaaaaa,
      metalness: 0.9,
      roughness: 0.2
    })
    const antenna = new THREE.Mesh(antennaGeometry, antennaMaterial)
    antenna.position.y = 10
    antenna.userData.isProcedural = true
    radar.group.add(antenna)
    
  }

  private loadRadarModel(radar: RadarStation, index: number): void {
    const loader = new OBJLoader()
    loader.load(
      '/assets/Radar.obj',
      (object) => {
        
        // Log what we loaded
        let meshCount = 0
        object.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            meshCount++
          }
        })
        
        // Calculate scale
        const box = new THREE.Box3().setFromObject(object)
        const size = box.getSize(new THREE.Vector3())
        
        // Check if model has valid size
        if (size.x === 0 || size.y === 0 || size.z === 0) {
          console.error('Model has zero size!', size)
          return
        }
        
        const targetHeight = 15
        const scaleFactor = targetHeight / size.y
        object.scale.set(scaleFactor, scaleFactor, scaleFactor)
        
        // Center and position model on ground
        box.setFromObject(object)
        const center = box.getCenter(new THREE.Vector3())
        const minY = box.min.y
        object.position.set(-center.x, -minY, -center.z)
        
        // Apply materials
        object.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.material = new THREE.MeshStandardMaterial({
              color: 0x666666,
              roughness: 0.6,
              metalness: 0.4,
              emissive: 0x111111,
              emissiveIntensity: 0.2
            })
            child.castShadow = true
            child.receiveShadow = true
          }
        })
        
        // Hide procedural model
        radar.group.children.forEach(child => {
          if (child.userData.isProcedural) {
            child.visible = false
          }
        })
        
        radar.model = object
        radar.group.add(object)
        
        
        
      },
      (xhr) => {
      },
      (error) => {
        console.error('Failed to load radar model:', error)
      }
    )
  }

  checkDetection(position: THREE.Vector3): boolean {
    // Check if position is within any radar's detection range
    return this.radars.some(radar => {
      // Calculate 3D distance including height
      const distance = position.distanceTo(radar.position)
      // Check if within spherical detection volume (not just hemisphere)
      // This ensures threats coming from directly above are detected
      return distance <= radar.detectionRadius
    })
  }
  
  setShowCoverage(show: boolean): void {
    this.showCoverage = show
    this.coverageMeshes.forEach(mesh => {
      mesh.visible = show
    })
  }

  getDetectingRadars(position: THREE.Vector3): RadarStation[] {
    // Get all radars that can detect this position
    return this.radars.filter(radar => {
      const distance = position.distanceTo(radar.position)
      return distance <= radar.detectionRadius
    })
  }

  update(threats: Array<{ getPosition(): THREE.Vector3 }>): void {
    // Visual feedback for detected threats
    threats.forEach(threat => {
      if (this.checkDetection(threat.getPosition())) {
        // Could add visual indication here
      }
    })
  }
  
  
  setModelFacingDirection(direction: THREE.Vector3): void {
    this.modelFacingDirection = direction.clone().normalize()
    // Update all radar rotations
    this.updateAllRadarRotations()
  }
  
  private updateAllRadarRotations(): void {
    this.radars.forEach((radar, index) => {
      // Calculate desired direction (toward center)
      const toCenter = new THREE.Vector3(0, 0, 0).sub(radar.position).normalize()
      toCenter.y = 0 // Keep it horizontal
      toCenter.normalize()
      
      // Calculate rotation needed to align model facing direction with center direction
      const currentAngle = Math.atan2(this.modelFacingDirection.z, this.modelFacingDirection.x)
      const desiredAngle = Math.atan2(toCenter.z, toCenter.x)
      let rotationNeeded = desiredAngle - currentAngle
      
      // Pattern detection for automatic correction
      // When model faces +X (90°), we observed that Front-Right and Back-Left need 180° flip
      // This creates a diagonal pattern that we can generalize
      let autoCorrection = 0
      
      const cornerName = this.getCornerName(radar.position)
      
      // The pattern: opposite diagonal corners share the same orientation
      // We can detect this by checking if X and Z have opposite signs
      const needsFlip = (radar.position.x > 0) !== (radar.position.z > 0)
      
      if (needsFlip) {
        autoCorrection = Math.PI
      }
      
      // Apply rotation with automatic correction
      radar.group.rotation.y = rotationNeeded + autoCorrection
    })
  }
  
  
  private getCornerName(position: THREE.Vector3): string {
    const x = position.x > 0 ? 'Right' : 'Left'
    const z = position.z > 0 ? 'Back' : 'Front'
    return `${z}-${x}`
  }
  
}