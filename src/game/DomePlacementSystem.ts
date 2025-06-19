import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { IronDomeBattery } from '../entities/IronDomeBattery'
import { GameState } from './GameState'
import { ResourceManager } from './ResourceManager'
import { ThreatManager } from '../scene/ThreatManager'
import { InterceptionSystem } from '../scene/InterceptionSystem'
import { StaticRadarNetwork } from '../scene/StaticRadarNetwork'

export interface PlacedDome {
  id: string
  position: THREE.Vector3
  battery: IronDomeBattery
  level: number
}

export class DomePlacementSystem {
  private scene: THREE.Scene
  private world: CANNON.World
  private placedDomes: Map<string, PlacedDome> = new Map()
  private gameState: GameState
  private resourceManager: ResourceManager
  private placementMode: boolean = false
  private placementPreview?: THREE.Mesh
  private rangePreview?: THREE.Mesh
  private validPlacementMaterial: THREE.MeshStandardMaterial
  private invalidPlacementMaterial: THREE.MeshStandardMaterial
  private minDistanceBetweenDomes: number = 40 // Minimum distance between domes
  private threatManager?: ThreatManager
  private interceptionSystem?: InterceptionSystem
  private radarNetwork?: StaticRadarNetwork
  
  constructor(scene: THREE.Scene, world: CANNON.World) {
    this.scene = scene
    this.world = world
    this.gameState = GameState.getInstance()
    this.resourceManager = ResourceManager.getInstance()
    
    // Create placement materials
    this.validPlacementMaterial = new THREE.MeshStandardMaterial({
      color: 0x0038b8,
      transparent: true,
      opacity: 0.5,
      emissive: 0x0038b8,
      emissiveIntensity: 0.3
    })
    
    this.invalidPlacementMaterial = new THREE.MeshStandardMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.5,
      emissive: 0xff0000,
      emissiveIntensity: 0.3
    })
    
    this.createRangePreview()
    this.restoreSavedPlacements()
    
    // Ensure at least one battery exists
    setTimeout(() => this.ensureInitialBattery(), 100)
  }
  
  private createRangePreview(): void {
    // Create range indicator ring
    const geometry = new THREE.RingGeometry(148, 152, 64)
    const material = new THREE.MeshBasicMaterial({
      color: 0x0038b8,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide
    })
    
    this.rangePreview = new THREE.Mesh(geometry, material)
    this.rangePreview.rotation.x = -Math.PI / 2
    this.rangePreview.visible = false
    this.scene.add(this.rangePreview)
  }
  
  private isValidPlacement(position: THREE.Vector3): boolean {
    // Check if position is within map bounds
    const mapRadius = 190 // Slightly less than ground size / 2
    if (position.length() > mapRadius) {
      return false
    }
    
    // Check distance from other domes
    for (const [_, dome] of this.placedDomes) {
      const distance = position.distanceTo(dome.position)
      if (distance < this.minDistanceBetweenDomes) {
        return false
      }
    }
    
    return true
  }
  
  private restoreSavedPlacements(): void {
    const placements = this.gameState.getDomePlacements()
    
    // Place initial battery at center if no saved placements
    if (placements.length === 0) {
      const initialId = 'battery_initial'
      const initialPosition = new THREE.Vector3(0, 0, 0)
      this.placeBatteryAt(initialPosition, initialId, 1)
      this.gameState.addDomePlacement(initialId, {
        x: initialPosition.x,
        z: initialPosition.z
      })
    } else {
      // Restore saved placements
      placements.forEach(placement => {
        const position = new THREE.Vector3(placement.position.x, 0, placement.position.z)
        this.placeBatteryAt(position, placement.id, placement.level)
      })
    }
  }
  
  enterPlacementMode(): void {
    if (!this.canPlaceNewDome()) {
      return
    }
    
    this.placementMode = true
    
    // Create placement preview that looks like a dome
    const previewGroup = new THREE.Group()
    
    // Base platform
    const baseGeometry = new THREE.BoxGeometry(6, 1, 6)
    const baseMesh = new THREE.Mesh(baseGeometry, this.validPlacementMaterial)
    baseMesh.position.y = 0.5
    previewGroup.add(baseMesh)
    
    // Launcher base
    const launcherBaseGeometry = new THREE.CylinderGeometry(4, 4, 0.5, 8)
    const launcherBase = new THREE.Mesh(launcherBaseGeometry, this.validPlacementMaterial)
    launcherBase.position.y = 1.25
    previewGroup.add(launcherBase)
    
    // Radar dome
    const domeGeometry = new THREE.SphereGeometry(2, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2)
    const dome = new THREE.Mesh(domeGeometry, this.validPlacementMaterial)
    dome.position.y = 3
    previewGroup.add(dome)
    
    this.placementPreview = previewGroup as any
    this.scene.add(this.placementPreview)
    
    // Show range preview
    if (this.rangePreview) {
      this.rangePreview.visible = true
    }
  }
  
  exitPlacementMode(): void {
    this.placementMode = false
    
    if (this.placementPreview) {
      this.scene.remove(this.placementPreview)
      // Dispose of group children
      this.placementPreview.traverse((child: any) => {
        if (child.geometry) child.geometry.dispose()
        if (child.material) child.material.dispose()
      })
      this.placementPreview = undefined
    }
    
    // Hide range preview
    if (this.rangePreview) {
      this.rangePreview.visible = false
    }
  }
  
  private showNearbyDomeRanges(position: THREE.Vector3): void {
    // Temporarily show range circles for nearby domes
    for (const [_, dome] of this.placedDomes) {
      const distance = position.distanceTo(dome.position)
      if (distance < 200) { // Show ranges within 200m
        // Could add visual range indicators here if needed
      }
    }
  }
  
  updatePlacementPreview(worldPosition: THREE.Vector3): void {
    if (!this.placementMode || !this.placementPreview) return
    
    // Snap to ground (y = 0)
    const snappedPosition = new THREE.Vector3(
      worldPosition.x,
      0,
      worldPosition.z
    )
    
    // Update preview position
    this.placementPreview.position.copy(snappedPosition)
    this.placementPreview.position.y = 5
    
    // Update range preview position
    if (this.rangePreview) {
      this.rangePreview.position.copy(snappedPosition)
      this.rangePreview.position.y = 0.1
    }
    
    // Check if placement is valid
    const isValid = this.isValidPlacement(snappedPosition)
    const material = isValid ? this.validPlacementMaterial : this.invalidPlacementMaterial
    
    // Update all meshes in the preview group
    this.placementPreview.traverse((child: any) => {
      if (child.isMesh) {
        child.material = material
      }
    })
    
    // Show nearby dome ranges
    this.showNearbyDomeRanges(snappedPosition)
  }
  
  attemptPlacement(worldPosition: THREE.Vector3): boolean {
    if (!this.placementMode || !this.canPlaceNewDome()) return false
    
    // Snap to ground
    const position = new THREE.Vector3(
      worldPosition.x,
      0,
      worldPosition.z
    )
    
    if (!this.isValidPlacement(position)) {
      return false
    }
    
    const batteryId = `battery_${Date.now()}`
    
    // Check if we have unlocked domes available
    const unlockedCount = this.gameState.getUnlockedDomes()
    const placedCount = this.placedDomes.size
    
    if (placedCount >= unlockedCount) {
      // Need to purchase a new dome slot
      if (!this.resourceManager.purchaseNewDome()) {
        return false
      }
    }
    
    this.placeBatteryAt(position, batteryId)
    
    // Save placement
    this.gameState.addDomePlacement(batteryId, {
      x: position.x,
      z: position.z
    })
    
    // Auto-exit placement mode if we've reached the limit
    if (!this.canPlaceNewDome()) {
      this.exitPlacementMode()
    }
    
    return true
  }
  
  private placeBatteryAt(position: THREE.Vector3, batteryId: string, level: number = 1): void {
    const battery = new IronDomeBattery(this.scene, this.world, {
      position: position.clone(),
      maxRange: 150 + (level - 1) * 25, // Increase range with level
      minRange: 4,
      reloadTime: 3000 - (level - 1) * 200, // Faster reload with level
      interceptorSpeed: 150 + (level - 1) * 10, // Faster interceptors with level
      launcherCount: 20 + (level - 1) * 5, // More launchers with level
      successRate: 0.95 + (level - 1) * 0.01, // Better accuracy with level
      maxHealth: 100 + (level - 1) * 50 // More health with level
    })
    
    // Configure battery
    battery.setResourceManagement(true)
    battery.setLaunchOffset(new THREE.Vector3(-2, 14.5, -0.1))
    battery.setLaunchDirection(new THREE.Vector3(0.6, 1, 0.15).normalize())
    
    // Set radar network if available
    if (this.radarNetwork) {
      battery.setRadarNetwork(this.radarNetwork)
    }
    
    this.placedDomes.set(batteryId, {
      id: batteryId,
      position: position.clone(),
      battery,
      level
    })
    
    // Register with threat manager
    if (this.threatManager) {
      this.threatManager.registerBattery(battery)
    }
    
    // Add to interception system
    if (this.interceptionSystem) {
      this.interceptionSystem.addBattery(battery)
    }
    
    // Add range indicator
    this.addRangeIndicator(battery)
    
    // Visual indicator for battery level
    if (level > 1) {
      this.addLevelIndicator(battery, level)
    }
  }
  
  private addLevelIndicator(battery: IronDomeBattery, level: number): void {
    const geometry = new THREE.RingGeometry(15, 18, 32)
    const material = new THREE.MeshBasicMaterial({
      color: level >= 3 ? 0xffff00 : 0x0095ff,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide
    })
    
    const ring = new THREE.Mesh(geometry, material)
    ring.rotation.x = -Math.PI / 2
    ring.position.copy(battery.getPosition())
    ring.position.y = 0.2
    ring.name = `battery-level-indicator-${level}`
    this.scene.add(ring)
  }
  
  private addRangeIndicator(battery: IronDomeBattery): void {
    const config = battery.getConfig()
    const geometry = new THREE.RingGeometry(config.maxRange - 2, config.maxRange, 64)
    const material = new THREE.MeshBasicMaterial({
      color: 0x0038b8,
      transparent: true,
      opacity: 0.1,
      side: THREE.DoubleSide
    })
    
    const ring = new THREE.Mesh(geometry, material)
    ring.rotation.x = -Math.PI / 2
    ring.position.copy(battery.getPosition())
    ring.position.y = 0.05
    ring.name = `battery-range-indicator`
    this.scene.add(ring)
  }
  
  
  removeBattery(batteryId: string): boolean {
    const dome = this.placedDomes.get(batteryId)
    if (!dome) return false
    
    // Remove range and level indicators
    const toRemove: THREE.Object3D[] = []
    this.scene.children.forEach((child) => {
      if (child.name && (child.name.includes('battery-range-indicator') || 
          child.name.includes(`battery-level-indicator`))) {
        const mesh = child as THREE.Mesh
        if (mesh.position.distanceTo(dome.position) < 1) {
          toRemove.push(mesh)
        }
      }
    })
    
    // Remove found indicators
    toRemove.forEach(mesh => {
      this.scene.remove(mesh)
      if ((mesh as THREE.Mesh).geometry) (mesh as THREE.Mesh).geometry.dispose()
      if ((mesh as THREE.Mesh).material) {
        const material = (mesh as THREE.Mesh).material
        if (Array.isArray(material)) {
          material.forEach(m => m.dispose())
        } else {
          material.dispose()
        }
      }
    })
    
    // Unregister from threat manager
    if (this.threatManager) {
      this.threatManager.unregisterBattery(dome.battery)
    }
    
    // Remove from scene
    dome.battery.destroy()
    this.placedDomes.delete(batteryId)
    
    // Remove from saved state
    this.gameState.removeDomePlacement(batteryId)
    
    return true
  }
  
  upgradeBattery(batteryId: string): boolean {
    const dome = this.placedDomes.get(batteryId)
    if (!dome) return false
    
    if (this.resourceManager.purchaseDomeUpgrade(batteryId)) {
      const placement = this.gameState.getDomePlacements().find(p => p.id === batteryId)
      if (placement) {
        // Remove old battery and indicators
        this.removeBattery(batteryId)
        // Recreate battery with upgraded stats
        this.placeBatteryAt(dome.position, batteryId, placement.level)
      }
      return true
    }
    
    return false
  }
  
  getAllBatteries(): IronDomeBattery[] {
    return Array.from(this.placedDomes.values()).map(dome => dome.battery)
  }
  
  getBattery(id: string): IronDomeBattery | undefined {
    const dome = this.placedDomes.get(id)
    return dome ? dome.battery : undefined
  }
  
  canPlaceNewDome(): boolean {
    const unlockedCount = this.gameState.getUnlockedDomes()
    const placedCount = this.placedDomes.size
    
    return placedCount < unlockedCount || this.resourceManager.canUnlockNewDome()
  }
  
  getPlacementInfo() {
    return {
      totalZones: 999, // Unlimited with free placement
      occupiedZones: this.placedDomes.size,
      unlockedDomes: this.gameState.getUnlockedDomes(),
      placedDomes: this.placedDomes.size,
      canPlace: this.canPlaceNewDome()
    }
  }
  
  isInPlacementMode(): boolean {
    return this.placementMode
  }
  
  setThreatManager(threatManager: ThreatManager): void {
    this.threatManager = threatManager
    
    // Register existing batteries
    for (const dome of this.placedDomes.values()) {
      threatManager.registerBattery(dome.battery)
    }
  }
  
  setInterceptionSystem(interceptionSystem: InterceptionSystem): void {
    this.interceptionSystem = interceptionSystem
    
    // Add existing batteries
    for (const dome of this.placedDomes.values()) {
      interceptionSystem.addBattery(dome.battery)
    }
  }
  
  setRadarNetwork(radarNetwork: StaticRadarNetwork): void {
    this.radarNetwork = radarNetwork
    
    // Set for existing batteries
    for (const dome of this.placedDomes.values()) {
      dome.battery.setRadarNetwork(radarNetwork)
    }
  }
  
  getBatteryId(battery: IronDomeBattery): string | null {
    for (const [id, dome] of this.placedDomes) {
      if (dome.battery === battery) {
        return id
      }
    }
    return null
  }
  
  private ensureInitialBattery(): void {
    // Check if we have any batteries
    if (this.placedDomes.size === 0) {
      // Create initial battery at center
      const initialId = 'battery_initial'
      const initialPosition = new THREE.Vector3(0, 0, 0)
      this.placeBatteryAt(initialPosition, initialId, 1)
      this.gameState.addDomePlacement(initialId, {
        x: initialPosition.x,
        z: initialPosition.z
      })
    }
  }
}