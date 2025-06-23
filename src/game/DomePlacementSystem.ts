import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { IronDomeBattery } from '../entities/IronDomeBattery'
import { GameState } from './GameState'
import { ResourceManager } from './ResourceManager'
import { ThreatManager } from '../scene/ThreatManager'
import { InterceptionSystem } from '../scene/InterceptionSystem'
import { StaticRadarNetwork } from '../scene/StaticRadarNetwork'
import { InstancedOBJDomeRenderer } from '../rendering/InstancedOBJDomeRenderer'

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
  private isSandboxMode: boolean = false
  private instancedRenderer?: InstancedOBJDomeRenderer
  private useInstancedRendering: boolean = true
  private skipInitialBatteryCheck: boolean = false
  
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
    
    // Initialize instanced renderer if enabled
    if (this.useInstancedRendering) {
      this.instancedRenderer = new InstancedOBJDomeRenderer(this.scene, 50)
    }
    
    this.restoreSavedPlacements()
    
    // Ensure at least one battery exists (only if not restoring saved placements)
    if (this.placedDomes.size === 0) {
      setTimeout(() => this.ensureInitialBattery(), 100)
    }
  }
  
  setSandboxMode(isSandbox: boolean): void {
    const previousMode = this.isSandboxMode
    this.isSandboxMode = isSandbox
    
    // If switching from one mode to another, clean up and reset
    if (previousMode !== isSandbox) {
      // Clear all existing batteries
      const batteryIds = Array.from(this.placedDomes.keys())
      batteryIds.forEach(id => {
        this.removeBattery(id, false) // Don't update game state during mode switch
      })
      
      // Clear saved placements from game state
      const placements = this.gameState.getDomePlacements()
      placements.forEach(p => {
        this.gameState.removeDomePlacement(p.id)
      })
      
      // Place initial battery at center
      const initialId = 'battery_initial'
      const initialPosition = new THREE.Vector3(0, 0, 0)
      this.placeBatteryAt(initialPosition, initialId, 1)
      this.gameState.addDomePlacement(initialId, {
        x: initialPosition.x,
        z: initialPosition.z
      })
    }
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
  
  // Public method for external validation checks
  isPositionValid(position: THREE.Vector3): boolean {
    return this.isValidPlacement(position)
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
    if (!this.placementMode) return false
    
    // In sandbox mode, no restrictions
    if (!this.isSandboxMode && !this.canPlaceNewDome()) return false
    
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
    
    // In game mode, check dome limits
    if (!this.isSandboxMode) {
      // Check if we have unlocked domes available
      const unlockedCount = this.gameState.getUnlockedDomes()
      const placedCount = this.placedDomes.size
      
      if (placedCount >= unlockedCount) {
        // Need to purchase a new dome slot
        if (!this.resourceManager.purchaseNewDome()) {
          return false
        }
      }
    }
    
    this.placeBatteryAt(position, batteryId)
    
    // Save placement (even in sandbox mode for persistence)
    this.gameState.addDomePlacement(batteryId, {
      x: position.x,
      z: position.z
    })
    
    // Auto-exit placement mode if we've reached the limit (game mode only)
    if (!this.isSandboxMode && !this.canPlaceNewDome()) {
      this.exitPlacementMode()
    }
    
    return true
  }
  
  placeBatteryAt(position: THREE.Vector3, batteryId: string, level: number = 1): void {
    // Create battery with instanced rendering flag
    const battery = new IronDomeBattery(this.scene, this.world, {
      position: position.clone(),
      maxRange: 150 + (level - 1) * 25, // Increase range with level
      minRange: 4,
      reloadTime: 3000 - (level - 1) * 200, // Faster reload with level
      interceptorSpeed: 150 + (level - 1) * 10, // Faster interceptors with level
      launcherCount: 20 + (level - 1) * 5, // More launchers with level
      successRate: 0.95 + (level - 1) * 0.01, // Better accuracy with level
      maxHealth: 100 + (level - 1) * 50, // More health with level
      useInstancedRendering: this.useInstancedRendering // Pass the flag
    })
    
    // Configure battery
    battery.setResourceManagement(!this.isSandboxMode)
    battery.setLaunchOffset(new THREE.Vector3(-2, 14.5, -0.1))
    battery.setLaunchDirection(new THREE.Vector3(0.6, 1, 0.15).normalize())
    
    // Apply auto-repair rate based on current upgrade level
    const autoRepairLevel = this.gameState.getAutoRepairLevel()
    const repairRates = [0, 0.5, 1.0, 2.0] // Health per second for each level
    battery.setAutoRepairRate(repairRates[autoRepairLevel])
    
    // Listen for battery destruction in game mode
    if (!this.isSandboxMode) {
      battery.on('destroyed', () => {
        // Remove the destroyed battery after a delay for the explosion animation
        setTimeout(() => {
          this.removeBattery(batteryId, true)
        }, 2000)
      })
    }
    
    // Hide individual meshes if using instanced rendering
    if (this.useInstancedRendering) {
      battery.setVisualVisibility(false)
    }
    
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
    
    // Register in game state FIRST before other operations
    const existingPlacement = this.gameState.getDomePlacements().find(p => p.id === batteryId)
    if (!existingPlacement) {
      this.gameState.addDomePlacement(batteryId, {
        x: position.x,
        z: position.z
      })
    }
    
    // Register with threat manager
    if (this.threatManager) {
      this.threatManager.registerBattery(battery)
    }
    
    // Add to interception system (this will register with coordinator)
    if (this.interceptionSystem) {
      this.interceptionSystem.addBattery(battery)
    }
    
    // Add range indicator
    this.addRangeIndicator(battery)
    
    // Visual indicator for battery level
    if (level > 1) {
      this.addLevelIndicator(battery, level)
    }
    
    // Update instanced renderer
    this.updateInstancedRenderer()
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
  
  
  removeBattery(batteryId: string, removeFromGameState: boolean = true): boolean {
    const dome = this.placedDomes.get(batteryId)
    if (!dome) return false
    
    // Prevent removing the last battery (only when actually removing, not upgrading)
    if (removeFromGameState && this.placedDomes.size <= 1) {
      console.warn('Cannot remove the last battery')
      return false
    }
    
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
    
    // Remove from saved state only if requested
    if (removeFromGameState) {
      this.gameState.removeDomePlacement(batteryId)
    }
    
    // Update instanced renderer
    this.updateInstancedRenderer()
    
    return true
  }
  
  sellBattery(batteryId: string): boolean {
    const dome = this.placedDomes.get(batteryId)
    if (!dome) return false
    
    // Get the placement info to calculate sell value
    const placement = this.gameState.getDomePlacements().find(p => p.id === batteryId)
    if (!placement) return false
    
    // Calculate sell value (60% of total investment)
    let totalCost = 0
    for (let i = 1; i < placement.level; i++) {
      totalCost += this.gameState.getDomeUpgradeCost(i)
    }
    const sellValue = Math.floor(totalCost * 0.6)
    
    // Give credits back to player (only in game mode)
    if (!this.isSandboxMode && sellValue > 0) {
      this.gameState.addCredits(sellValue)
    }
    
    // Remove the battery
    return this.removeBattery(batteryId, true)
  }
  
  upgradeBattery(batteryId: string): boolean {
    const dome = this.placedDomes.get(batteryId)
    if (!dome) {
      console.warn('[DomePlacement] Battery not found in placedDomes:', batteryId)
      return false
    }
    
    // In sandbox mode, upgrades are free
    if (this.isSandboxMode) {
      const placement = this.gameState.getDomePlacements().find(p => p.id === batteryId)
      if (placement && placement.level < 5) {
        // Update the level in game state using free upgrade
        this.gameState.upgradeDomeFree(batteryId)
        // Get the updated placement with new level
        const updatedPlacement = this.gameState.getDomePlacements().find(p => p.id === batteryId)
        if (updatedPlacement) {
          // Remove old battery and indicators (but keep in game state)
          const position = dome.position.clone()
          this.removeBattery(batteryId, false)
          // Recreate battery with upgraded stats
          this.placeBatteryAt(position, batteryId, updatedPlacement.level)
          return true
        }
      }
      return false
    }
    
    // Game mode - use resources
    if (this.resourceManager.purchaseDomeUpgrade(batteryId)) {
      const placement = this.gameState.getDomePlacements().find(p => p.id === batteryId)
      if (placement) {
        // Remove old battery and indicators (but keep in game state)
        const position = dome.position.clone()
        this.removeBattery(batteryId, false)
        // Recreate battery with upgraded stats (placement.level is already updated by purchaseDomeUpgrade)
        this.placeBatteryAt(position, batteryId, placement.level)
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
    // In sandbox mode, always allow placement
    if (this.isSandboxMode) return true
    
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
  
  getDomePlacements() {
    return this.gameState.getDomePlacements()
  }
  
  canUpgradeBattery(batteryId: string): boolean {
    if (this.isSandboxMode) return true // Free upgrades in sandbox
    
    const dome = this.placedDomes.get(batteryId)
    if (!dome) {
      return false
    }
    
    const placement = this.gameState.getDomePlacements().find(p => p.id === batteryId)
    if (!placement) {
      return false
    }
    if (placement.level >= 5) {
      return false
    }
    
    const upgradeCost = this.gameState.getDomeUpgradeCost(placement.level)
    const credits = this.gameState.getCredits()
    const canAfford = credits >= upgradeCost
    return canAfford
  }
  
  getUpgradeCost(batteryId: string, level?: number): number {
    if (level !== undefined) {
      return this.gameState.getDomeUpgradeCost(level)
    }
    const placements = this.gameState.getDomePlacements()
    const placement = placements.find(p => p.id === batteryId)
    if (!placement) {
      console.warn(`No placement found for battery ${batteryId}. All placements:`, placements.map(p => p.id))
      // Default to level 1 upgrade cost if no placement found
      return this.gameState.getDomeUpgradeCost(1)
    }
    return this.gameState.getDomeUpgradeCost(placement.level)
  }
  
  getBatteryId(battery: IronDomeBattery): string | null {
    for (const [id, dome] of this.placedDomes) {
      if (dome.battery === battery) {
        return id
      }
    }
    return null
  }
  
  getBattery(batteryId: string): IronDomeBattery | null {
    const dome = this.placedDomes.get(batteryId)
    return dome ? dome.battery : null
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
  
  private ensureInitialBattery(): void {
    // Skip if we're in the middle of a new game setup
    if (this.skipInitialBatteryCheck) {
      return
    }
    
    // Check if we have any batteries
    if (this.placedDomes.size === 0) {
      // Create initial battery at center
      const initialId = 'battery_initial'
      const initialPosition = new THREE.Vector3(0, 0, 0)
      this.placeBatteryAt(initialPosition, initialId, 1)
      // placeBatteryAt already adds to game state
    }
  }
  
  private updateInstancedRenderer(): void {
    if (!this.instancedRenderer) return
    
    // Convert map to format expected by renderer
    const domesData = new Map<string, { battery: IronDomeBattery; level: number }>()
    this.placedDomes.forEach((dome, id) => {
      domesData.set(id, { battery: dome.battery, level: dome.level })
    })
    
    this.instancedRenderer.updateDomes(domesData)
  }
  
  // Call this method from your game loop to update visual states
  update(): void {
    // Update instanced renderer with current dome states
    this.updateInstancedRenderer()
  }
  
  // Method to toggle instanced rendering
  setInstancedRendering(enabled: boolean): void {
    if (this.useInstancedRendering === enabled) return
    
    this.useInstancedRendering = enabled
    
    if (enabled && !this.instancedRenderer) {
      // Create instanced renderer
      this.instancedRenderer = new InstancedOBJDomeRenderer(this.scene, 50)
      
      // Hide all individual dome meshes
      this.placedDomes.forEach(dome => {
        dome.battery.setVisualVisibility(false)
      })
      
      // Update renderer
      this.updateInstancedRenderer()
    } else if (!enabled && this.instancedRenderer) {
      // Dispose instanced renderer
      this.instancedRenderer.dispose()
      this.instancedRenderer = undefined
      
      // Show all individual dome meshes
      this.placedDomes.forEach(dome => {
        dome.battery.setVisualVisibility(true)
      })
    }
  }
  
  canAffordRepair(batteryId: string): boolean {
    const dome = this.placedDomes.get(batteryId)
    if (!dome) return false
    
    const health = dome.battery.getHealth()
    const repairCost = Math.ceil((health.max - health.current) * 2)
    
    return this.gameState.getCredits() >= repairCost
  }
  
  repairBattery(batteryId: string, cost: number): boolean {
    const dome = this.placedDomes.get(batteryId)
    if (!dome) return false
    
    // Only charge in game mode
    if (!this.isSandboxMode) {
      if (!this.gameState.spendCredits(cost)) {
        return false
      }
    }
    
    // Repair to full health
    const health = dome.battery.getHealth()
    dome.battery.repair(health.max - health.current)
    
    return true
  }
  
  setSkipInitialBatteryCheck(skip: boolean): void {
    this.skipInitialBatteryCheck = skip
  }
}