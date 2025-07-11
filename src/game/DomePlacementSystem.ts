import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { IBattery } from '../entities/IBattery';
import { IronDomeBattery } from '../entities/IronDomeBattery';
import { LaserBattery } from '../entities/LaserBattery';
import { BatteryType, BATTERY_CONFIGS } from '../config/BatteryTypes';
import { GameState } from './GameState';
import { ResourceManager } from './ResourceManager';
import { ThreatManager } from '../scene/ThreatManager';
import { InterceptionSystem } from '../scene/InterceptionSystem';
import { StaticRadarNetwork } from '../scene/StaticRadarNetwork';
import { InvisibleRadarSystem } from '../scene/InvisibleRadarSystem';
import { InstancedBatteryRenderer } from '../rendering/InstancedBatteryRenderer';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { debug } from '../utils/logger';
import { MaterialCache } from '../utils/MaterialCache';
import { ModelManager } from '../utils/ModelManager';
import { MODEL_IDS } from '../config/ModelRegistry';

export interface PlacedDome {
  id: string;
  position: THREE.Vector3;
  battery: IBattery;
  level: number;
  type: BatteryType;
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
  private instancedRenderer?: InstancedBatteryRenderer;
  private useInstancedRendering: boolean = true;
  private skipInitialBatteryCheck: boolean = false;
  private loadedBatteryModel?: THREE.Object3D;
  private loadedLaserModel?: THREE.Object3D;
  private isModelLoading: boolean = false;
  private selectedBatteryType: BatteryType = BatteryType.IRON_DOME;

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
      this.instancedRenderer = new InstancedBatteryRenderer(this.scene, 50);
    }

    // Load battery models for placement preview
    this.loadBatteryModels();

    // Don't restore yet - wait for sandbox mode to be set from main.ts
    // This prevents the initial state mismatch
  }

  private async loadBatteryModels(): Promise<void> {
    if (this.isModelLoading) {
      return;
    }

    this.isModelLoading = true;
    const modelManager = ModelManager.getInstance();

    try {
      // Load Iron Dome model using ModelManager
      if (!this.loadedBatteryModel) {
        const { scene: batteryModel } = await modelManager.loadModel(MODEL_IDS.BATTERY);
        this.loadedBatteryModel = batteryModel.clone();
        
        // Apply hidden parts configuration from ModelRegistry
        const hiddenParts = ['Part24', 'Part25', 'Part26', 'Part27', 'Part299', 'Part300', 
                           'Part301', 'Part302', 'Part303', 'Part304', 'Part305', 'Part306', 
                           'Part307', 'Part308'];
        
        hiddenParts.forEach(partName => {
          const part = this.loadedBatteryModel!.getObjectByName(partName);
          if (part) {
            part.visible = false;
          }
        });
        
        debug.log('Iron Dome model loaded for placement preview');
      }

      // Load Laser Cannon model using ModelManager
      if (!this.loadedLaserModel) {
        const { scene: laserModel } = await modelManager.loadModel(MODEL_IDS.LASER_CANNON);
        this.loadedLaserModel = laserModel.clone();
        
        // Apply hidden parts configuration first
        const cylinder = this.loadedLaserModel.getObjectByName('Cylinder007_0');
        if (cylinder) {
          cylinder.visible = false;
        }
        
        // Hide Cube_2 for preview (only shows when firing)
        const cube2 = this.loadedLaserModel.getObjectByName('Cube_2');
        if (cube2) {
          cube2.visible = false;
        }
        
        // Calculate bounds to find center offset BEFORE scaling
        const box = new THREE.Box3().setFromObject(this.loadedLaserModel);
        const center = box.getCenter(new THREE.Vector3());
        
        // Scale to match actual laser battery size
        this.loadedLaserModel.scale.setScalar(10);
        
        // Center the model
        this.loadedLaserModel.position.x = -center.x * 10;
        this.loadedLaserModel.position.z = -center.z * 10;
        this.loadedLaserModel.position.y = -box.min.y * 10; // Place on ground
        
        debug.log('Laser cannon model loaded for placement preview');
      }
    } catch (error) {
      debug.error('Failed to load models for preview:', error);
    } finally {
      this.isModelLoading = false;
    }
  }

  setSelectedBatteryType(type: BatteryType): void {
    this.selectedBatteryType = type;
  }

  getSelectedBatteryType(): BatteryType {
    return this.selectedBatteryType;
  }

  private createBattery(
    type: BatteryType,
    position: THREE.Vector3,
    level: number = 1
  ): IBattery {
    const config = BATTERY_CONFIGS[type];
    
    switch (type) {
      case BatteryType.LASER:
        const laserBattery = new LaserBattery(this.scene, this.world, position);
        laserBattery.setMaxRange(config.capabilities.maxRange + (level - 1) * 50);
        laserBattery.setDamagePerSecond(config.capabilities.damagePerSecond! + (level - 1) * 10);
        return laserBattery;
        
      case BatteryType.IRON_DOME:
      default:
        return new IronDomeBattery(this.scene, this.world, {
          position,
          maxRange: config.capabilities.maxRange + (level - 1) * 100,
          minRange: config.capabilities.minRange,
          reloadTime: 3000 - (level - 1) * 400,
          interceptorSpeed: 250 + (level - 1) * 30,
          launcherCount: 20,
          successRate: 0.95 + (level - 1) * 0.01,
          maxHealth: 100 + (level - 1) * 50,
          useInstancedRendering: this.useInstancedRendering,
        });
    }
  }

  setSandboxMode(isSandbox: boolean): void {
    const previousMode = this.isSandboxMode;
    this.isSandboxMode = isSandbox;

    // On first call (previousMode undefined), just set the mode and restore placements
    if (previousMode === undefined || this.placedDomes.size === 0) {
      debug.log(
        `Initial setSandboxMode call - setting to ${isSandbox ? 'sandbox' : 'game'} mode and restoring placements`
      );
      this.restoreSavedPlacements().catch(error => {
        debug.error('Failed to restore saved placements:', error);
      });
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
        this.placeBatteryAt(initialPosition, initialId, 1, BatteryType.IRON_DOME);
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

  private async restoreSavedPlacements(): Promise<void> {
    const placements = this.gameState.getDomePlacements();

    // Ensure instanced renderer is ready before placing batteries
    if (this.instancedRenderer) {
      await this.instancedRenderer.waitForLoad();
    }

    // Place initial battery at center if no saved placements
    if (placements.length === 0) {
      const initialId = 'battery_initial';
      const initialPosition = new THREE.Vector3(0, 0, 0);
      this.placeBatteryAt(initialPosition, initialId, 1);
      this.gameState.addDomePlacement(initialId, {
        x: initialPosition.x,
        z: initialPosition.z,
      }, BatteryType.IRON_DOME);
    } else {
      // Restore saved placements
      placements.forEach(placement => {
        const position = new THREE.Vector3(placement.position.x, 0, placement.position.z);
        // Use saved battery type or default to IRON_DOME for backwards compatibility
        const batteryType = placement.type ? placement.type as BatteryType : BatteryType.IRON_DOME;
        this.placeBatteryAt(position, placement.id, placement.level, batteryType);
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

    // Update instanced renderer after all batteries are placed
    this.updateInstancedRenderer();
  }

  async enterPlacementMode(): Promise<void> {
    if (!this.canPlaceNewDome()) {
      return;
    }

    // Ensure models are loaded before entering placement mode
    await this.loadBatteryModels();

    this.placementMode = true;

    // Create placement preview group
    const previewGroup = new THREE.Group();

    // Select the appropriate model based on battery type
    let modelToUse: THREE.Object3D | undefined;
    
    if (this.selectedBatteryType === BatteryType.LASER) {
      modelToUse = this.loadedLaserModel;
    } else {
      modelToUse = this.loadedBatteryModel;
    }

    if (modelToUse) {
      // Clone the loaded model
      const modelClone = modelToUse.clone();

      // Apply placement material to all meshes in the model
      modelClone.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.material = this.validPlacementMaterial;
          child.castShadow = false;
          child.receiveShadow = false;
        }
      });

      // Re-apply hidden parts for laser model
      if (this.selectedBatteryType === BatteryType.LASER) {
        const cylinder = modelClone.getObjectByName('Cylinder007_0');
        if (cylinder) {
          cylinder.visible = false;
        }
        const cube2 = modelClone.getObjectByName('Cube_2');
        if (cube2) {
          cube2.visible = false;
        }
      }

      previewGroup.add(modelClone);
    } else {
      // Fallback to simple geometry if model hasn't loaded yet
      // Create a simple placeholder
      const placeholderGeometry = new THREE.CylinderGeometry(8, 10, 8, 16);
      const placeholderMesh = new THREE.Mesh(placeholderGeometry, this.validPlacementMaterial);
      placeholderMesh.position.y = 4;
      previewGroup.add(placeholderMesh);

      // Add a simple dome on top for Iron Dome
      if (this.selectedBatteryType === BatteryType.IRON_DOME) {
        const domeGeometry = new THREE.SphereGeometry(4, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
        const domeMesh = new THREE.Mesh(domeGeometry, this.validPlacementMaterial);
        domeMesh.position.y = 8;
        previewGroup.add(domeMesh);
      }

      debug.log(`Using placeholder geometry - ${this.selectedBatteryType} model not loaded yet`);
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
          // Only dispose if it's not part of the loaded models
          if (!this.isPartOfLoadedModels(child)) {
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
  
  private isPartOfLoadedModels(child: THREE.Mesh): boolean {
    return (this.loadedBatteryModel && this.isChildOfModel(child, this.loadedBatteryModel)) ||
           (this.loadedLaserModel && this.isChildOfModel(child, this.loadedLaserModel));
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
    }, this.selectedBatteryType);

    // Auto-exit placement mode if we've reached the limit (game mode only)
    if (!this.isSandboxMode && !this.canPlaceNewDome()) {
      this.exitPlacementMode();
    }

    return true;
  }

  placeBatteryAt(position: THREE.Vector3, batteryId: string, level: number = 1, type?: BatteryType): void {
    const batteryType = type || this.selectedBatteryType;
    // Adjust position to raise the battery so legs are visible
    const adjustedPosition = position.clone();
    // Place at ground level for now to test
    adjustedPosition.y = 0; // Ground level

    // Create battery using factory method
    const battery = this.createBattery(batteryType, adjustedPosition, level);

    // Configure battery
    debug.log(
      `Configuring battery ${batteryId}: type=${batteryType}, isSandboxMode=${this.isSandboxMode}, setting resourceManagement=${!this.isSandboxMode}`
    );
    battery.setResourceManagement(!this.isSandboxMode);
    
    // Configure IronDome-specific settings
    if (battery instanceof IronDomeBattery) {
      battery.setLaunchOffset(new THREE.Vector3(-2, 14.5, -0.1));
      battery.setLaunchDirection(new THREE.Vector3(0.3, 1.5, 0.1).normalize()); // More vertical launch angle
    }

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

    // Hide individual meshes if using instanced rendering (except laser batteries)
    if (this.useInstancedRendering && batteryType !== BatteryType.LASER) {
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
      type: batteryType,
    });

    // Register in game state FIRST before other operations
    const existingPlacement = this.gameState.getDomePlacements().find(p => p.id === batteryId);
    if (!existingPlacement) {
      this.gameState.addDomePlacement(batteryId, {
        x: position.x,
        z: position.z,
      }, batteryType);
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

  private addLevelIndicator(battery: IBattery, level: number): void {
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

  private addRangeIndicator(battery: IBattery): void {
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
          const batteryType = dome.type;
          this.removeBattery(batteryId, false);
          // Recreate battery with upgraded stats
          this.placeBatteryAt(position, batteryId, updatedPlacement.level, batteryType);

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
        const batteryType = dome.type;
        this.removeBattery(batteryId, false);
        // Recreate battery with upgraded stats (placement.level is already updated by purchaseDomeUpgrade)
        this.placeBatteryAt(position, batteryId, placement.level, batteryType);

        // Dispatch event to notify UI of battery upgrade
        window.dispatchEvent(new CustomEvent('batteryUpgraded', { detail: { batteryId } }));
      }
      return true;
    }

    return false;
  }

  getAllBatteries(): IBattery[] {
    return Array.from(this.placedDomes.values()).map(dome => dome.battery);
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

  getBattery(batteryId: string): IBattery | null {
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
    const batteriesData = new Map<string, { battery: IBattery; level: number; type: BatteryType }>();
    this.placedDomes.forEach((dome, id) => {
      batteriesData.set(id, { 
        battery: dome.battery, 
        level: dome.level,
        type: dome.type
      });
    });

    this.instancedRenderer.updateBatteries(batteriesData);
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
      this.instancedRenderer = new InstancedBatteryRenderer(this.scene, 50);

      // Hide all individual dome meshes (except laser batteries)
      this.placedDomes.forEach(dome => {
        if (dome.batteryType !== BatteryType.LASER) {
          dome.battery.setVisualVisibility(false);
        }
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
