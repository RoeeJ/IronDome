import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { IronDomeBattery } from '../entities/IronDomeBattery';
import { GameState } from './GameState';
import { ResourceManager } from './ResourceManager';
import { ThreatManager } from '../scene/ThreatManager';
import { InterceptionSystem } from '../scene/InterceptionSystem';
import { StaticRadarNetwork } from '../scene/StaticRadarNetwork';
import { InvisibleRadarSystem } from '../scene/InvisibleRadarSystem';
import { InstancedOBJDomeRenderer } from '../rendering/InstancedOBJDomeRenderer';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { debug } from '../utils/logger';
import { MaterialCache } from '../utils/MaterialCache';

export interface PlacedDome {
  id: string;
  position: THREE.Vector3;
  battery: IronDomeBattery;
  level: number;
}

export class DomePlacementSystem {
  private scene: THREE.Scene;
  private world: CANNON.World;
  private placedDomes: Map<string, PlacedDome> = new Map();
  private gameState: GameState;
  private resourceManager: ResourceManager;
  private placementMode: boolean = false;
  private placementPreview?: THREE.Group;
  private rangePreview?: THREE.Mesh;
  private validPlacementMaterial: THREE.MeshStandardMaterial;
  private invalidPlacementMaterial: THREE.MeshStandardMaterial;
  private minDistanceBetweenDomes: number = 40; // Minimum distance between domes
  private threatManager?: ThreatManager;
  private interceptionSystem?: InterceptionSystem;
  private radarNetwork?: StaticRadarNetwork | InvisibleRadarSystem;
  private isSandboxMode: boolean = false;
  private instancedRenderer?: InstancedOBJDomeRenderer;
  private useInstancedRendering: boolean = true;
  private skipInitialBatteryCheck: boolean = false;
  private loadedBatteryModel?: THREE.Object3D;
  private isModelLoading: boolean = false;

  constructor(scene: THREE.Scene, world: CANNON.World) {
    this.scene = scene;
    this.world = world;
    this.gameState = GameState.getInstance();
    this.resourceManager = ResourceManager.getInstance();

    // Create placement materials (SHARED)
    this.validPlacementMaterial = MaterialCache.getInstance().getMeshStandardMaterial({
      color: 0x0038b8,
      transparent: true,
      opacity: 0.5,
      emissive: 0x0038b8,
      emissiveIntensity: 0.3,
    });

    this.invalidPlacementMaterial = MaterialCache.getInstance().getMeshStandardMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.5,
      emissive: 0xff0000,
      emissiveIntensity: 0.3,
    });

    this.createRangePreview();

    // Initialize instanced renderer if enabled
    if (this.useInstancedRendering) {
      this.instancedRenderer = new InstancedOBJDomeRenderer(this.scene, 50);
    }

    // Load the battery OBJ model for placement preview
    this.loadBatteryModel();

    // Don't restore yet - wait for sandbox mode to be set from main.ts
    // This prevents the initial state mismatch
  }

  private loadBatteryModel(): void {
    if (this.isModelLoading || this.loadedBatteryModel) {
      return;
    }

    this.isModelLoading = true;
    const loader = new OBJLoader();

    loader.load(
      '/assets/Battery.obj',
      object => {
        // Model loaded successfully
        debug.log('Battery OBJ model loaded for placement preview');

        // Calculate model bounds to determine proper scale
        const box = new THREE.Box3().setFromObject(object);
        const size = box.getSize(new THREE.Vector3());

        // Scale model to appropriate size (matching IronDomeBattery logic)
        const targetHeight = 4;
        let scaleFactor = 1;
        if (size.y < 0.1 || size.y > 100) {
          scaleFactor = targetHeight / size.y;
          object.scale.set(scaleFactor, scaleFactor, scaleFactor);
        }

        // Center the model at origin
        box.setFromObject(object);
        const center = box.getCenter(new THREE.Vector3());
        const minY = box.min.y;
        object.position.set(-center.x, -minY, -center.z);

        // Store the loaded model
        this.loadedBatteryModel = object;
        this.isModelLoading = false;
      },
      xhr => {
        // Progress callback
        debug.log(`Loading battery model: ${((xhr.loaded / xhr.total) * 100).toFixed(0)}%`);
      },
      error => {
        // Error callback
        debug.error('Failed to load battery model for preview:', error);
        this.isModelLoading = false;
      }
    );
  }

  setSandboxMode(isSandbox: boolean): void {
    const previousMode = this.isSandboxMode;
    this.isSandboxMode = isSandbox;

    // On first call (previousMode undefined), just set the mode and restore placements
    if (previousMode === undefined || this.placedDomes.size === 0) {
      debug.log(
        `Initial setSandboxMode call - setting to ${isSandbox ? 'sandbox' : 'game'} mode and restoring placements`
      );
      this.restoreSavedPlacements();
      return;
    }

    // Always reconfigure existing batteries when mode changes
    if (previousMode !== isSandbox) {
      debug.log(
        `Mode changed from ${previousMode ? 'sandbox' : 'game'} to ${isSandbox ? 'sandbox' : 'game'}, reconfiguring all batteries`
      );

      // First reconfigure all existing batteries
      this.placedDomes.forEach((dome, id) => {
        debug.log(`Reconfiguring battery ${id} for ${isSandbox ? 'sandbox' : 'game'} mode`);
        dome.battery.setResourceManagement(!isSandbox);

        // In sandbox mode, reset interceptor stock to ensure batteries work
        if (isSandbox) {
          dome.battery.resetInterceptorStock();
        }
      });

      // Only clear and reset if there are issues or if explicitly needed
      if (this.placedDomes.size === 0) {
        // Place initial battery at center if none exist
        const initialId = 'battery_initial';
        const initialPosition = new THREE.Vector3(0, 0, 0);
        this.placeBatteryAt(initialPosition, initialId, 1);
        this.gameState.addDomePlacement(initialId, {
          x: initialPosition.x,
          z: initialPosition.z,
        });
      }
    }
  }

  private createRangePreview(): void {
    // Create range indicator ring - updated for city-wide coverage
    const geometry = new THREE.RingGeometry(998, 1002, 64); // 1000m range
    const material = MaterialCache.getInstance().getMeshBasicMaterial({
      color: 0x0038b8,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
    });

    this.rangePreview = new THREE.Mesh(geometry, material);
    this.rangePreview.rotation.x = -Math.PI / 2;
    this.rangePreview.visible = false;
    this.scene.add(this.rangePreview);
  }

  private isValidPlacement(position: THREE.Vector3): boolean {
    // Check if position is within map bounds - updated for larger world
    const mapRadius = 900; // Slightly less than ground size / 2 (1000m)
    if (position.length() > mapRadius) {
      return false;
    }

    // Check distance from other domes
    for (const [_, dome] of this.placedDomes) {
      const distance = position.distanceTo(dome.position);
      if (distance < this.minDistanceBetweenDomes) {
        return false;
      }
    }

    // Check for building collisions
    const buildingSystem = (window as any).__buildingSystem;
    if (buildingSystem) {
      const batteryRadius = 15; // Battery footprint radius
      const buildings = buildingSystem.getBuildings();

      for (const building of buildings) {
        const buildingPos = building.position;
        const buildingWidth = building.width / 2;
        const buildingDepth = building.depth / 2;

        // Check if battery circle overlaps with building rectangle
        // Find closest point on building to battery center
        const closestX = Math.max(
          buildingPos.x - buildingWidth,
          Math.min(position.x, buildingPos.x + buildingWidth)
        );
        const closestZ = Math.max(
          buildingPos.z - buildingDepth,
          Math.min(position.z, buildingPos.z + buildingDepth)
        );

        // Check distance from battery center to closest point on building
        const distX = position.x - closestX;
        const distZ = position.z - closestZ;
        const distanceSquared = distX * distX + distZ * distZ;

        if (distanceSquared < batteryRadius * batteryRadius) {
          return false; // Collision detected
        }
      }
    }

    return true;
  }

  // Public method for external validation checks
  isPositionValid(position: THREE.Vector3): boolean {
    return this.isValidPlacement(position);
  }

  private restoreSavedPlacements(): void {
    const placements = this.gameState.getDomePlacements();

    // Place initial battery at center if no saved placements
    if (placements.length === 0) {
      const initialId = 'battery_initial';
      const initialPosition = new THREE.Vector3(0, 0, 0);
      this.placeBatteryAt(initialPosition, initialId, 1);
      this.gameState.addDomePlacement(initialId, {
        x: initialPosition.x,
        z: initialPosition.z,
      });
    } else {
      // Restore saved placements
      placements.forEach(placement => {
        const position = new THREE.Vector3(placement.position.x, 0, placement.position.z);
        this.placeBatteryAt(position, placement.id, placement.level);
      });
    }

    // Ensure all batteries are configured for the current mode after restoration
    debug.log(
      `After restoring placements, ensuring all batteries are in ${this.isSandboxMode ? 'sandbox' : 'game'} mode`
    );
    this.placedDomes.forEach((dome, id) => {
      dome.battery.setResourceManagement(!this.isSandboxMode);
      if (this.isSandboxMode) {
        dome.battery.resetInterceptorStock();
      }
    });
  }

  enterPlacementMode(): void {
    if (!this.canPlaceNewDome()) {
      return;
    }

    this.placementMode = true;

    // Create placement preview group
    const previewGroup = new THREE.Group();

    // If OBJ model is loaded, use it
    if (this.loadedBatteryModel) {
      // Clone the loaded model
      const modelClone = this.loadedBatteryModel.clone();

      // Apply placement material to all meshes in the model
      modelClone.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.material = this.validPlacementMaterial;
          child.castShadow = false;
          child.receiveShadow = false;
        }
      });

      previewGroup.add(modelClone);
    } else {
      // Fallback to simple geometry if model hasn't loaded yet
      // Create a simple placeholder
      const placeholderGeometry = new THREE.CylinderGeometry(8, 10, 8, 16);
      const placeholderMesh = new THREE.Mesh(placeholderGeometry, this.validPlacementMaterial);
      placeholderMesh.position.y = 4;
      previewGroup.add(placeholderMesh);

      // Add a simple dome on top
      const domeGeometry = new THREE.SphereGeometry(4, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      const domeMesh = new THREE.Mesh(domeGeometry, this.validPlacementMaterial);
      domeMesh.position.y = 8;
      previewGroup.add(domeMesh);

      debug.log('Using placeholder geometry - OBJ model not loaded yet');
    }

    this.placementPreview = previewGroup;
    this.scene.add(this.placementPreview);

    // Show range preview
    if (this.rangePreview) {
      this.rangePreview.visible = true;
    }
  }

  exitPlacementMode(): void {
    this.placementMode = false;

    if (this.placementPreview) {
      this.scene.remove(this.placementPreview);
      // Don't dispose of the OBJ model geometries - they're shared
      // Only dispose of placeholder geometries
      this.placementPreview.traverse(child => {
        if (child instanceof THREE.Mesh) {
          // Only dispose if it's not part of the loaded OBJ model
          if (!this.loadedBatteryModel || !this.isChildOfModel(child, this.loadedBatteryModel)) {
            if (child.geometry) child.geometry.dispose();
            if (
              child.material &&
              child.material !== this.validPlacementMaterial &&
              child.material !== this.invalidPlacementMaterial
            ) {
              child.material.dispose();
            }
          }
        }
      });
      this.placementPreview = undefined;
    }

    // Hide range preview
    if (this.rangePreview) {
      this.rangePreview.visible = false;
    }
  }

  private isChildOfModel(object: THREE.Object3D, model: THREE.Object3D): boolean {
    let parent = object.parent;
    while (parent) {
      if (parent === model) return true;
      parent = parent.parent;
    }
    return false;
  }

  private showNearbyDomeRanges(position: THREE.Vector3): void {
    // Temporarily show range circles for nearby domes
    for (const [_, dome] of this.placedDomes) {
      const distance = position.distanceTo(dome.position);
      if (distance < 200) {
        // Show ranges within 200m
        // Could add visual range indicators here if needed
      }
    }
  }

  updatePlacementPreview(worldPosition: THREE.Vector3): void {
    if (!this.placementMode || !this.placementPreview) return;

    // Snap to ground (y = 0)
    const snappedPosition = new THREE.Vector3(worldPosition.x, 0, worldPosition.z);

    // Update preview position
    this.placementPreview.position.copy(snappedPosition);
    this.placementPreview.position.y = 0; // Ground level to match placement

    // Update range preview position
    if (this.rangePreview) {
      this.rangePreview.position.copy(snappedPosition);
      this.rangePreview.position.y = 0.1;
    }

    // Check if placement is valid
    const isValid = this.isValidPlacement(snappedPosition);
    const material = isValid ? this.validPlacementMaterial : this.invalidPlacementMaterial;

    // Update all meshes in the preview group
    this.placementPreview.traverse(child => {
      if (child instanceof THREE.Mesh) {
        child.material = material;
      }
    });

    // Show nearby dome ranges
    this.showNearbyDomeRanges(snappedPosition);
  }

  attemptPlacement(worldPosition: THREE.Vector3): boolean {
    if (!this.placementMode) return false;

    // In sandbox mode, no restrictions
    if (!this.isSandboxMode && !this.canPlaceNewDome()) return false;

    // Snap to ground
    const position = new THREE.Vector3(worldPosition.x, 0, worldPosition.z);

    if (!this.isValidPlacement(position)) {
      return false;
    }

    const batteryId = `battery_${Date.now()}`;

    // In game mode, check dome limits
    if (!this.isSandboxMode) {
      // Check if we have unlocked domes available
      const unlockedCount = this.gameState.getUnlockedDomes();
      const placedCount = this.placedDomes.size;

      if (placedCount >= unlockedCount) {
        // Need to purchase a new dome slot
        if (!this.resourceManager.purchaseNewDome()) {
          return false;
        }
      }
    }

    this.placeBatteryAt(position, batteryId);

    // Save placement (even in sandbox mode for persistence)
    this.gameState.addDomePlacement(batteryId, {
      x: position.x,
      z: position.z,
    });

    // Auto-exit placement mode if we've reached the limit (game mode only)
    if (!this.isSandboxMode && !this.canPlaceNewDome()) {
      this.exitPlacementMode();
    }

    return true;
  }

  placeBatteryAt(position: THREE.Vector3, batteryId: string, level: number = 1): void {
    // Adjust position to raise the battery so legs are visible
    const adjustedPosition = position.clone();
    // Place at ground level for now to test
    adjustedPosition.y = 0; // Ground level

    // Create battery with instanced rendering flag - extended range to cover entire city
    const battery = new IronDomeBattery(this.scene, this.world, {
      position: adjustedPosition,
      maxRange: 1000 + (level - 1) * 100, // Extended to cover entire city (900m radius) plus buffer
      minRange: 10,
      reloadTime: 3000 - (level - 1) * 400, // Much faster reload with level (3s → 1.4s at max)
      interceptorSpeed: 250 + (level - 1) * 30, // Faster interceptors for extended range
      launcherCount: 20, // Fixed 20 tubes based on physical model
      successRate: 0.95 + (level - 1) * 0.01, // Better accuracy with level
      maxHealth: 100 + (level - 1) * 50, // More health with level
      useInstancedRendering: this.useInstancedRendering, // Pass the flag
    });

    // Configure battery
    debug.log(
      `Configuring battery ${batteryId}: isSandboxMode=${this.isSandboxMode}, setting resourceManagement=${!this.isSandboxMode}`
    );
    battery.setResourceManagement(!this.isSandboxMode);
    battery.setLaunchOffset(new THREE.Vector3(-2, 14.5, -0.1));
    battery.setLaunchDirection(new THREE.Vector3(0.3, 1.5, 0.1).normalize()); // More vertical launch angle

    // Apply auto-repair rate based on current upgrade level
    const autoRepairLevel = this.gameState.getAutoRepairLevel();
    const repairRates = [0, 0.5, 1.0, 2.0]; // Health per second for each level
    battery.setAutoRepairRate(repairRates[autoRepairLevel]);

    // Listen for battery destruction in game mode
    if (!this.isSandboxMode) {
      battery.on('destroyed', () => {
        // Remove the destroyed battery after a delay for the explosion animation
        setTimeout(() => {
          this.removeBattery(batteryId, true);
        }, 2000);
      });
    }

    // Hide individual meshes if using instanced rendering
    if (this.useInstancedRendering) {
      battery.setVisualVisibility(false);
    }

    // Set radar network if available
    if (this.radarNetwork) {
      battery.setRadarNetwork(this.radarNetwork);
    }

    this.placedDomes.set(batteryId, {
      id: batteryId,
      position: position.clone(),
      battery,
      level,
    });

    // Register in game state FIRST before other operations
    const existingPlacement = this.gameState.getDomePlacements().find(p => p.id === batteryId);
    if (!existingPlacement) {
      this.gameState.addDomePlacement(batteryId, {
        x: position.x,
        z: position.z,
      });
    }

    // Register with threat manager
    if (this.threatManager) {
      this.threatManager.registerBattery(battery);
    }

    // Add to interception system with proper ID (this will register with coordinator)
    if (this.interceptionSystem) {
      this.interceptionSystem.addBattery(battery, batteryId);
    }

    // Add range indicator
    this.addRangeIndicator(battery);

    // Visual indicator for battery level
    if (level > 1) {
      this.addLevelIndicator(battery, level);
    }

    // Update instanced renderer
    this.updateInstancedRenderer();
  }

  private addLevelIndicator(battery: IronDomeBattery, level: number): void {
    const geometry = new THREE.RingGeometry(15, 18, 32);
    const material = MaterialCache.getInstance().getMeshBasicMaterial({
      color: level >= 3 ? 0xffff00 : 0x0095ff,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
    });

    const ring = new THREE.Mesh(geometry, material);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(battery.getPosition());
    ring.position.y = 0.2; // This is already relative to battery position which is raised
    ring.name = `battery-level-indicator-${level}`;
    this.scene.add(ring);
  }

  private addRangeIndicator(battery: IronDomeBattery): void {
    const config = battery.getConfig();
    const geometry = new THREE.RingGeometry(config.maxRange - 2, config.maxRange, 64);
    const material = MaterialCache.getInstance().getMeshBasicMaterial({
      color: 0x0038b8,
      transparent: true,
      opacity: 0.1,
      side: THREE.DoubleSide,
    });

    const ring = new THREE.Mesh(geometry, material);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(battery.getPosition());
    ring.position.y = 0.05; // This is already relative to battery position which is raised
    ring.name = `battery-range-indicator`;
    this.scene.add(ring);
  }

  removeBattery(batteryId: string, removeFromGameState: boolean = true): boolean {
    const dome = this.placedDomes.get(batteryId);
    if (!dome) return false;

    // Prevent removing the last battery (only when actually removing, not upgrading)
    if (removeFromGameState && this.placedDomes.size <= 1) {
      debug.warn('Cannot remove the last battery');
      return false;
    }

    // Remove range and level indicators
    const toRemove: THREE.Object3D[] = [];
    this.scene.children.forEach(child => {
      if (
        child.name &&
        (child.name.includes('battery-range-indicator') ||
          child.name.includes(`battery-level-indicator`))
      ) {
        const mesh = child as THREE.Mesh;
        if (mesh.position.distanceTo(dome.position) < 1) {
          toRemove.push(mesh);
        }
      }
    });

    // Remove found indicators
    toRemove.forEach(mesh => {
      this.scene.remove(mesh);
      if ((mesh as THREE.Mesh).geometry) (mesh as THREE.Mesh).geometry.dispose();
      if ((mesh as THREE.Mesh).material) {
        const material = (mesh as THREE.Mesh).material;
        if (Array.isArray(material)) {
          material.forEach(m => m.dispose());
        } else {
          material.dispose();
        }
      }
    });

    // Unregister from threat manager
    if (this.threatManager) {
      this.threatManager.unregisterBattery(dome.battery);
    }

    // Remove from interception system and coordinator
    if (this.interceptionSystem) {
      this.interceptionSystem.removeBattery(dome.battery, batteryId);
    }

    // Remove from scene
    dome.battery.destroy();
    this.placedDomes.delete(batteryId);

    // Remove from saved state only if requested
    if (removeFromGameState) {
      this.gameState.removeDomePlacement(batteryId);
    }

    // Update instanced renderer
    this.updateInstancedRenderer();

    return true;
  }

  sellBattery(batteryId: string): boolean {
    const dome = this.placedDomes.get(batteryId);
    if (!dome) return false;

    // Get the placement info to calculate sell value
    const placement = this.gameState.getDomePlacements().find(p => p.id === batteryId);
    if (!placement) return false;

    // Calculate sell value (60% of total investment)
    let totalCost = 0;
    for (let i = 1; i < placement.level; i++) {
      totalCost += this.gameState.getDomeUpgradeCost(i);
    }
    const sellValue = Math.floor(totalCost * 0.6);

    // Give credits back to player (only in game mode)
    if (!this.isSandboxMode && sellValue > 0) {
      this.gameState.addCredits(sellValue);
    }

    // Remove the battery
    return this.removeBattery(batteryId, true);
  }

  upgradeBattery(batteryId: string): boolean {
    const dome = this.placedDomes.get(batteryId);
    if (!dome) {
      debug.warn('[DomePlacement] Battery not found in placedDomes:', batteryId);
      return false;
    }

    // In sandbox mode, upgrades are free
    if (this.isSandboxMode) {
      const placement = this.gameState.getDomePlacements().find(p => p.id === batteryId);
      if (placement && placement.level < 5) {
        // Update the level in game state using free upgrade
        this.gameState.upgradeDomeFree(batteryId);
        // Get the updated placement with new level
        const updatedPlacement = this.gameState.getDomePlacements().find(p => p.id === batteryId);
        if (updatedPlacement) {
          // Remove old battery and indicators (but keep in game state)
          const position = dome.position.clone();
          this.removeBattery(batteryId, false);
          // Recreate battery with upgraded stats
          this.placeBatteryAt(position, batteryId, updatedPlacement.level);

          // Dispatch event to notify UI of battery upgrade
          window.dispatchEvent(new CustomEvent('batteryUpgraded', { detail: { batteryId } }));

          return true;
        }
      }
      return false;
    }

    // Game mode - use resources
    if (this.resourceManager.purchaseDomeUpgrade(batteryId)) {
      const placement = this.gameState.getDomePlacements().find(p => p.id === batteryId);
      if (placement) {
        // Remove old battery and indicators (but keep in game state)
        const position = dome.position.clone();
        this.removeBattery(batteryId, false);
        // Recreate battery with upgraded stats (placement.level is already updated by purchaseDomeUpgrade)
        this.placeBatteryAt(position, batteryId, placement.level);

        // Dispatch event to notify UI of battery upgrade
        window.dispatchEvent(new CustomEvent('batteryUpgraded', { detail: { batteryId } }));
      }
      return true;
    }

    return false;
  }

  getAllBatteries(): IronDomeBattery[] {
    return Array.from(this.placedDomes.values()).map(dome => dome.battery);
  }

  getBattery(id: string): IronDomeBattery | undefined {
    const dome = this.placedDomes.get(id);
    return dome ? dome.battery : undefined;
  }

  canPlaceNewDome(): boolean {
    // In sandbox mode, always allow placement
    if (this.isSandboxMode) return true;

    const unlockedCount = this.gameState.getUnlockedDomes();
    const placedCount = this.placedDomes.size;

    return placedCount < unlockedCount || this.resourceManager.canUnlockNewDome();
  }

  getPlacementInfo() {
    return {
      totalZones: 999, // Unlimited with free placement
      occupiedZones: this.placedDomes.size,
      unlockedDomes: this.gameState.getUnlockedDomes(),
      placedDomes: this.placedDomes.size,
      canPlace: this.canPlaceNewDome(),
    };
  }

  getDomePlacements() {
    return this.gameState.getDomePlacements();
  }

  canUpgradeBattery(batteryId: string): boolean {
    if (this.isSandboxMode) return true; // Free upgrades in sandbox

    const dome = this.placedDomes.get(batteryId);
    if (!dome) {
      return false;
    }

    const placement = this.gameState.getDomePlacements().find(p => p.id === batteryId);
    if (!placement) {
      return false;
    }
    if (placement.level >= 5) {
      return false;
    }

    const upgradeCost = this.gameState.getDomeUpgradeCost(placement.level);
    const credits = this.gameState.getCredits();
    const canAfford = credits >= upgradeCost;
    return canAfford;
  }

  getUpgradeCost(batteryId: string, level?: number): number {
    if (level !== undefined) {
      return this.gameState.getDomeUpgradeCost(level);
    }
    const placements = this.gameState.getDomePlacements();
    const placement = placements.find(p => p.id === batteryId);
    if (!placement) {
      debug.warn(
        `No placement found for battery ${batteryId}. All placements:`,
        placements.map(p => p.id)
      );
      // Default to level 1 upgrade cost if no placement found
      return this.gameState.getDomeUpgradeCost(1);
    }
    return this.gameState.getDomeUpgradeCost(placement.level);
  }

  getBatteryId(battery: IronDomeBattery): string | null {
    for (const [id, dome] of this.placedDomes) {
      if (dome.battery === battery) {
        return id;
      }
    }
    return null;
  }

  getBattery(batteryId: string): IronDomeBattery | null {
    const dome = this.placedDomes.get(batteryId);
    return dome ? dome.battery : null;
  }

  isInPlacementMode(): boolean {
    return this.placementMode;
  }

  setThreatManager(threatManager: ThreatManager): void {
    this.threatManager = threatManager;

    // Register existing batteries
    for (const dome of this.placedDomes.values()) {
      threatManager.registerBattery(dome.battery);
    }
  }

  setInterceptionSystem(interceptionSystem: InterceptionSystem): void {
    this.interceptionSystem = interceptionSystem;

    // Add existing batteries with their proper IDs
    for (const [batteryId, dome] of this.placedDomes) {
      interceptionSystem.addBattery(dome.battery, batteryId);
    }
  }

  setRadarNetwork(radarNetwork: StaticRadarNetwork | InvisibleRadarSystem): void {
    this.radarNetwork = radarNetwork;

    // Set for existing batteries
    for (const dome of this.placedDomes.values()) {
      dome.battery.setRadarNetwork(radarNetwork);
    }
  }

  private ensureInitialBattery(): void {
    // Skip if we're in the middle of a new game setup
    if (this.skipInitialBatteryCheck) {
      return;
    }

    // Check if we have any batteries
    if (this.placedDomes.size === 0) {
      // Create initial battery at center
      const initialId = 'battery_initial';
      const initialPosition = new THREE.Vector3(0, 0, 0);
      this.placeBatteryAt(initialPosition, initialId, 1);
      // placeBatteryAt already adds to game state
    }
  }

  private updateInstancedRenderer(): void {
    if (!this.instancedRenderer) return;

    // Convert map to format expected by renderer
    const domesData = new Map<string, { battery: IronDomeBattery; level: number }>();
    this.placedDomes.forEach((dome, id) => {
      domesData.set(id, { battery: dome.battery, level: dome.level });
    });

    this.instancedRenderer.updateDomes(domesData);
  }

  // Call this method from your game loop to update visual states
  update(): void {
    // Update instanced renderer with current dome states
    this.updateInstancedRenderer();
  }

  // Method to toggle instanced rendering
  setInstancedRendering(enabled: boolean): void {
    if (this.useInstancedRendering === enabled) return;

    this.useInstancedRendering = enabled;

    if (enabled && !this.instancedRenderer) {
      // Create instanced renderer
      this.instancedRenderer = new InstancedOBJDomeRenderer(this.scene, 50);

      // Hide all individual dome meshes
      this.placedDomes.forEach(dome => {
        dome.battery.setVisualVisibility(false);
      });

      // Update renderer
      this.updateInstancedRenderer();
    } else if (!enabled && this.instancedRenderer) {
      // Dispose instanced renderer
      this.instancedRenderer.dispose();
      this.instancedRenderer = undefined;

      // Show all individual dome meshes
      this.placedDomes.forEach(dome => {
        dome.battery.setVisualVisibility(true);
      });
    }
  }

  canAffordRepair(batteryId: string): boolean {
    const dome = this.placedDomes.get(batteryId);
    if (!dome) return false;

    const health = dome.battery.getHealth();
    const repairCost = Math.ceil((health.max - health.current) * 2);

    return this.gameState.getCredits() >= repairCost;
  }

  repairBattery(batteryId: string, cost: number): boolean {
    const dome = this.placedDomes.get(batteryId);
    if (!dome) return false;

    // Only charge in game mode
    if (!this.isSandboxMode) {
      if (!this.gameState.spendCredits(cost)) {
        return false;
      }
    }

    // Repair to full health
    const health = dome.battery.getHealth();
    dome.battery.repair(health.max - health.current);

    return true;
  }

  setSkipInitialBatteryCheck(skip: boolean): void {
    this.skipInitialBatteryCheck = skip;
  }
}
