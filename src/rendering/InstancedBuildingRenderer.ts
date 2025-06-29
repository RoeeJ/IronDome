import * as THREE from 'three';
import { MaterialCache } from '../utils/MaterialCache';
import { GeometryFactory } from '../utils/GeometryFactory';
import { debug } from '../utils/logger';

interface BuildingType {
  width: number;
  height: number;
  depth: number;
  material: THREE.MeshStandardMaterial;
}

interface BuildingInstance {
  id: string;
  typeIndex: number;
  position: THREE.Vector3;
  rotation: number;
  scale: THREE.Vector3;
  instanceIndex: number;
  windowIndices: number[];
  health: number;
  maxHealth: number;
}

/**
 * Instanced rendering system for buildings to dramatically reduce draw calls.
 * Groups buildings by size categories and renders each category as a single instanced mesh.
 */
export class InstancedBuildingRenderer {
  private scene: THREE.Scene;
  private buildingTypes: BuildingType[] = [];
  private instancedMeshes: THREE.InstancedMesh[] = [];
  private buildings = new Map<string, BuildingInstance>();
  private dummy = new THREE.Object3D();

  // Window instancing
  private litWindowMesh: THREE.InstancedMesh;
  private unlitWindowMesh: THREE.InstancedMesh;
  private maxWindowsPerMesh = 50000; // Greatly increased to prevent window concentration
  private windowInstances = new Map<string, { lit: number[]; unlit: number[] }>();
  private litWindowPool: number[] = [];
  private unlitWindowPool: number[] = [];

  // Error throttling
  private lastPoolExhaustionWarning = 0;
  private poolExhaustionWarningInterval = 5000; // Only warn once every 5 seconds

  // Building categories based on size
  private readonly SIZE_CATEGORIES = [
    { name: 'small', maxHeight: 20, maxCount: 500 },
    { name: 'medium', maxHeight: 40, maxCount: 300 },
    { name: 'large', maxHeight: 60, maxCount: 200 },
    { name: 'xlarge', maxHeight: 100, maxCount: 100 },
  ];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.initializeBuildingTypes();
    this.initializeWindowInstancing();
  }

  private initializeBuildingTypes(): void {
    const materialCache = MaterialCache.getInstance();
    const geometryFactory = GeometryFactory.getInstance();

    // Create instanced meshes for each size category
    this.SIZE_CATEGORIES.forEach((category, index) => {
      // Use a standard box geometry - actual size set via instance matrix
      const geometry = geometryFactory.getBox(1, 1, 1);

      // Vary material slightly for each category
      const material = materialCache.getMeshStandardMaterial({
        color: 0x303030 + index * 0x101010,
        roughness: 0.9,
        metalness: 0.1,
      });

      const instancedMesh = new THREE.InstancedMesh(geometry, material, category.maxCount);
      instancedMesh.castShadow = true;
      instancedMesh.receiveShadow = true;
      instancedMesh.name = `buildings_${category.name}`;

      // Initialize all instances as invisible
      const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
      for (let i = 0; i < category.maxCount; i++) {
        instancedMesh.setMatrixAt(i, zeroMatrix);
      }
      instancedMesh.instanceMatrix.needsUpdate = true;

      this.instancedMeshes.push(instancedMesh);
      this.scene.add(instancedMesh);
    });
  }

  private initializeWindowInstancing(): void {
    const windowGeometry = GeometryFactory.getInstance().getPlane(2, 3);

    // Shared materials for windows with polygon offset to fix z-fighting
    const litMaterial = new THREE.MeshBasicMaterial({
      color: 0xffee88,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    const unlitMaterial = new THREE.MeshBasicMaterial({
      color: 0x050508,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    this.litWindowMesh = new THREE.InstancedMesh(
      windowGeometry,
      litMaterial,
      this.maxWindowsPerMesh
    );
    this.unlitWindowMesh = new THREE.InstancedMesh(
      windowGeometry,
      unlitMaterial,
      this.maxWindowsPerMesh
    );

    // Configure window meshes
    this.litWindowMesh.frustumCulled = true;
    this.litWindowMesh.castShadow = false;
    this.litWindowMesh.receiveShadow = false;
    // Lit windows render after buildings to avoid z-fighting
    this.litWindowMesh.renderOrder = 100;

    this.unlitWindowMesh.frustumCulled = true;
    this.unlitWindowMesh.castShadow = false;
    this.unlitWindowMesh.receiveShadow = false;
    // Unlit windows render last (transparent)
    this.unlitWindowMesh.renderOrder = 101;

    // Initialize window pools
    const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.maxWindowsPerMesh; i++) {
      this.litWindowMesh.setMatrixAt(i, zeroMatrix);
      this.unlitWindowMesh.setMatrixAt(i, zeroMatrix);
      this.litWindowPool.push(i);
      this.unlitWindowPool.push(i);
    }

    this.litWindowMesh.instanceMatrix.needsUpdate = true;
    this.unlitWindowMesh.instanceMatrix.needsUpdate = true;

    this.scene.add(this.litWindowMesh);
    this.scene.add(this.unlitWindowMesh);
  }

  /**
   * Create a building instance
   */
  createBuilding(position: THREE.Vector3, width: number, height: number, depth: number): string {
    const id = `building_${Date.now()}_${Math.random()}`;

    // Determine category based on height
    let categoryIndex = 0;
    for (let i = 0; i < this.SIZE_CATEGORIES.length; i++) {
      if (height <= this.SIZE_CATEGORIES[i].maxHeight) {
        categoryIndex = i;
        break;
      }
    }

    // Find available instance in the category
    const instancedMesh = this.instancedMeshes[categoryIndex];
    let instanceIndex = -1;

    // Find first unused instance (scale is 0)
    for (let i = 0; i < this.SIZE_CATEGORIES[categoryIndex].maxCount; i++) {
      const matrix = new THREE.Matrix4();
      instancedMesh.getMatrixAt(i, matrix);
      const scale = new THREE.Vector3();
      scale.setFromMatrixScale(matrix);

      if (scale.x === 0) {
        instanceIndex = i;
        break;
      }
    }

    if (instanceIndex === -1) {
      debug.warn(`Building category ${this.SIZE_CATEGORIES[categoryIndex].name} is full`);
      return id; // Still return ID but building won't be visible
    }

    // Create building instance
    const building: BuildingInstance = {
      id,
      typeIndex: categoryIndex,
      position: position.clone(),
      rotation: 0,
      scale: new THREE.Vector3(width, height, depth),
      instanceIndex,
      windowIndices: [],
      health: 100,
      maxHealth: 100,
    };

    // Set instance matrix
    this.updateBuildingTransform(building);

    // Create windows
    this.createBuildingWindows(building);

    this.buildings.set(id, building);

    return id;
  }

  private updateBuildingTransform(building: BuildingInstance): void {
    const mesh = this.instancedMeshes[building.typeIndex];

    this.dummy.position.copy(building.position);
    this.dummy.position.y = building.scale.y / 2; // Adjust for bottom-centered buildings
    this.dummy.rotation.y = building.rotation;
    this.dummy.scale.copy(building.scale);
    this.dummy.updateMatrix();

    mesh.setMatrixAt(building.instanceIndex, this.dummy.matrix);
    mesh.instanceMatrix.needsUpdate = true;

    // Force compute bounding sphere to fix culling issues
    // This ensures the instanced mesh includes all building positions
    mesh.computeBoundingSphere();
  }

  private createBuildingWindows(building: BuildingInstance): void {
    const { position, scale } = building;
    // DENSE WINDOWS: Previous algorithm with better distribution
    const windowSpacingX = 4; // 4m spacing (previous algorithm)
    const windowSpacingY = 5; // 5m between window rows (previous algorithm)
    const windowRows = Math.floor(scale.y / windowSpacingY);
    const windowColsX = Math.floor(scale.x / windowSpacingX);
    const windowColsZ = Math.floor(scale.z / windowSpacingX);

    // ALL SIDES GET WINDOWS: No random side selection
    const totalWindowsNeeded = (windowColsX * 2 + windowColsZ * 2) * windowRows;
    const availableWindows = this.litWindowPool.length + this.unlitWindowPool.length;

    // Check if we have enough windows available
    if (availableWindows < totalWindowsNeeded * 0.5) {
      debug.warn(
        `Low window pool: ${availableWindows} available, ${totalWindowsNeeded} needed for building ${building.id}`
      );
    }

    const windowIds: { lit: number[]; unlit: number[] } = { lit: [], unlit: [] };

    // Create windows on all four sides
    const sides = [
      { normal: new THREE.Vector3(0, 0, 1), cols: windowColsX, offset: scale.z / 2 },
      { normal: new THREE.Vector3(0, 0, -1), cols: windowColsX, offset: -scale.z / 2 },
      { normal: new THREE.Vector3(1, 0, 0), cols: windowColsZ, offset: scale.x / 2 },
      { normal: new THREE.Vector3(-1, 0, 0), cols: windowColsZ, offset: -scale.x / 2 },
    ];

    sides.forEach((side, sideIndex) => {
      for (let row = 0; row < windowRows; row++) {
        for (let col = 0; col < side.cols; col++) {
          // High window density for full coverage
          const windowDensity = 1.0; // 100% window density like the legacy algorithm
          if (Math.random() > windowDensity) {
            continue;
          }

          // Decide if window should be lit based on current time of day
          let litChance = 0.05; // Default 5% for daytime
          if ((window as any).__optimizedDayNight) {
            const timeObj = (window as any).__optimizedDayNight.getTime();
            const hours = timeObj.hours;
            // Match the time-based percentages from legacy algorithm
            if (hours >= 11 && hours < 14) {
              litChance = 0.02; // Noon - 2% lit
            } else if (hours >= 9 && hours < 17) {
              litChance = 0.05; // Day - 5% lit
            } else if (hours >= 6 && hours < 9) {
              litChance = 0.3; // Morning - 30% lit
            } else if (hours >= 17 && hours < 20) {
              litChance = 0.6; // Evening - 60% lit
            } else if (hours >= 20 && hours < 22) {
              litChance = 0.8; // Night - 80% lit
            } else {
              litChance = 0.5; // Late night - 50% lit
            }
          }
          const isLit = Math.random() < litChance;

          const pool = isLit ? this.litWindowPool : this.unlitWindowPool;
          const mesh = isLit ? this.litWindowMesh : this.unlitWindowMesh;
          const windowList = isLit ? windowIds.lit : windowIds.unlit;

          if (pool.length === 0) {
            const now = Date.now();
            if (now - this.lastPoolExhaustionWarning > this.poolExhaustionWarningInterval) {
              debug.error(
                `Window pool exhausted: ${isLit ? 'lit' : 'unlit'} pool empty at building ${building.id}. Pool size: ${this.maxWindowsPerMesh}`
              );
              this.lastPoolExhaustionWarning = now;
            }
            continue;
          }

          const windowIndex = pool.pop()!;
          windowList.push(windowIndex);

          // Calculate window position using legacy algorithm approach
          const windowPos = new THREE.Vector3();
          if (side.normal.x !== 0) {
            windowPos.x = position.x + side.offset + (side.normal.x > 0 ? 0.5 : -0.5);
            windowPos.z = position.z + (col - side.cols / 2) * 4 + 2;
          } else {
            windowPos.x = position.x + (col - side.cols / 2) * 4 + 2;
            windowPos.z = position.z + side.offset + (side.normal.z > 0 ? 0.5 : -0.5);
          }
          // Position windows from bottom to top of building (not centered)
          windowPos.y = position.y + 2.5 + row * windowSpacingY; // Start 2.5m from base, go up

          // Set window transform
          this.dummy.position.copy(windowPos);
          this.dummy.lookAt(windowPos.clone().add(side.normal));
          this.dummy.scale.set(1, 1, 1);
          this.dummy.updateMatrix();

          mesh.setMatrixAt(windowIndex, this.dummy.matrix);
        }
      }
    });

    this.litWindowMesh.instanceMatrix.needsUpdate = true;
    this.unlitWindowMesh.instanceMatrix.needsUpdate = true;

    // Update window mesh bounding spheres to fix culling
    this.litWindowMesh.computeBoundingSphere();
    this.unlitWindowMesh.computeBoundingSphere();

    this.windowInstances.set(building.id, windowIds);
    building.windowIndices = [...windowIds.lit, ...windowIds.unlit];
  }

  /**
   * Remove a building
   */
  removeBuilding(id: string): void {
    const building = this.buildings.get(id);
    if (!building) return;

    // Hide building instance
    const mesh = this.instancedMeshes[building.typeIndex];
    mesh.setMatrixAt(building.instanceIndex, new THREE.Matrix4().makeScale(0, 0, 0));
    mesh.instanceMatrix.needsUpdate = true;

    // Return windows to pools
    const windows = this.windowInstances.get(id);
    if (windows) {
      windows.lit.forEach(idx => {
        this.litWindowMesh.setMatrixAt(idx, new THREE.Matrix4().makeScale(0, 0, 0));
        this.litWindowPool.push(idx);
      });

      windows.unlit.forEach(idx => {
        this.unlitWindowMesh.setMatrixAt(idx, new THREE.Matrix4().makeScale(0, 0, 0));
        this.unlitWindowPool.push(idx);
      });

      this.litWindowMesh.instanceMatrix.needsUpdate = true;
      this.unlitWindowMesh.instanceMatrix.needsUpdate = true;

      this.windowInstances.delete(id);
    }

    this.buildings.delete(id);
  }

  /**
   * Get statistics about the instanced buildings
   */
  getStats(): {
    totalBuildings: number;
    buildingsByCategory: Record<string, number>;
    totalWindows: number;
    drawCalls: number;
  } {
    const stats = {
      totalBuildings: this.buildings.size,
      buildingsByCategory: {} as Record<string, number>,
      totalWindows: 0,
      drawCalls: 2, // Just window meshes by default
    };

    // Count buildings by category and active draw calls
    this.SIZE_CATEGORIES.forEach((category, index) => {
      let count = 0;
      this.buildings.forEach(building => {
        if (building.typeIndex === index) count++;
      });
      stats.buildingsByCategory[category.name] = count;
      if (count > 0) stats.drawCalls++; // Add building mesh draw call
    });

    // Count windows
    this.windowInstances.forEach(windows => {
      stats.totalWindows += windows.lit.length + windows.unlit.length;
    });

    return stats;
  }

  /**
   * Fix frustum culling issues by updating bounding spheres
   * Call this after all buildings are created
   */
  updateBoundingSpheres(): void {
    // Update bounding spheres for all instanced meshes
    this.instancedMeshes.forEach(mesh => {
      mesh.computeBoundingSphere();
    });

    // Also update window meshes
    this.litWindowMesh.computeBoundingSphere();
    this.unlitWindowMesh.computeBoundingSphere();

    debug.log('Updated bounding spheres for all instanced building meshes');
  }

  /**
   * Disable frustum culling for all building meshes
   * Use this as a last resort if culling issues persist
   */
  disableFrustumCulling(): void {
    this.instancedMeshes.forEach(mesh => {
      mesh.frustumCulled = false;
    });

    this.litWindowMesh.frustumCulled = false;
    this.unlitWindowMesh.frustumCulled = false;

    debug.log('Disabled frustum culling for all building meshes');
  }

  /**
   * Update window lighting based on time of day
   * Transitions windows between lit and unlit states
   * Uses per-building variation for realistic cityscape
   */
  updateWindowLighting(hours: number): void {
    let totalSwitched = 0;

    // Update windows for each building with per-building variation
    this.buildings.forEach(building => {
      const windows = this.windowInstances.get(building.id);
      if (!windows) return;

      // Generate per-building lighting characteristics
      const buildingHash = this.hashBuildingId(building.id);
      const buildingType = this.getBuildingLightingType(building, buildingHash);
      const targetLitPercentage = this.calculateBuildingLitPercentage(
        hours,
        buildingType,
        buildingHash
      );

      const totalWindows = windows.lit.length + windows.unlit.length;
      const targetLitCount = Math.floor(totalWindows * targetLitPercentage);
      const currentLitCount = windows.lit.length;

      if (currentLitCount === targetLitCount) return; // No change needed

      if (currentLitCount < targetLitCount) {
        // Turn on some windows - move from unlit pool to lit pool
        const toTurnOn = Math.min(targetLitCount - currentLitCount, windows.unlit.length);
        for (let i = 0; i < toTurnOn; i++) {
          if (this.litWindowPool.length === 0) break; // No more lit instances available

          const unlitIndex = windows.unlit.pop()!;
          const litIndex = this.litWindowPool.pop()!;
          windows.lit.push(litIndex);

          // Get the transform from the unlit window and apply to lit window
          const matrix = new THREE.Matrix4();
          this.unlitWindowMesh.getMatrixAt(unlitIndex, matrix);
          this.litWindowMesh.setMatrixAt(litIndex, matrix);

          // Hide unlit window
          const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
          this.unlitWindowMesh.setMatrixAt(unlitIndex, zeroMatrix);

          // Return unlit index to pool
          this.unlitWindowPool.push(unlitIndex);
          totalSwitched++;
        }
      } else {
        // Turn off some windows - move from lit pool to unlit pool
        const toTurnOff = Math.min(currentLitCount - targetLitCount, windows.lit.length);
        for (let i = 0; i < toTurnOff; i++) {
          if (this.unlitWindowPool.length === 0) break; // No more unlit instances available

          const litIndex = windows.lit.pop()!;
          const unlitIndex = this.unlitWindowPool.pop()!;
          windows.unlit.push(unlitIndex);

          // Get the transform from the lit window and apply to unlit window
          const matrix = new THREE.Matrix4();
          this.litWindowMesh.getMatrixAt(litIndex, matrix);
          this.unlitWindowMesh.setMatrixAt(unlitIndex, matrix);

          // Hide lit window
          const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
          this.litWindowMesh.setMatrixAt(litIndex, zeroMatrix);

          // Return lit index to pool
          this.litWindowPool.push(litIndex);
          totalSwitched++;
        }
      }
    });

    // Update instance matrices if any changes were made
    if (totalSwitched > 0) {
      this.litWindowMesh.instanceMatrix.needsUpdate = true;
      this.unlitWindowMesh.instanceMatrix.needsUpdate = true;
      debug.log(`Switched ${totalSwitched} windows for time ${hours.toFixed(1)}h`);
    }
  }

  private createWindowTransform(building: BuildingInstance, windowData: any): void {
    // This is a simplified version - you'd need to store window position data
    // For now, just create a basic transform
    this.dummy.position.copy(building.position);
    this.dummy.scale.set(1, 1, 1);
    this.dummy.updateMatrix();
  }

  /**
   * Generate a consistent hash from building ID for per-building randomization
   */
  private hashBuildingId(id: string): number {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      const char = id.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Determine building type based on size and position for lighting behavior
   */
  private getBuildingLightingType(
    building: BuildingInstance,
    hash: number
  ): 'residential' | 'office' | 'commercial' | 'industrial' {
    const { scale, position } = building;
    const distanceFromCenter = Math.sqrt(position.x * position.x + position.z * position.z);
    const heightCategory = scale.y < 30 ? 'low' : scale.y < 60 ? 'medium' : 'high';
    const hashMod = hash % 100;

    // Center area (< 300m) - mostly office/commercial
    if (distanceFromCenter < 300) {
      if (heightCategory === 'high') return hashMod < 70 ? 'office' : 'commercial';
      if (heightCategory === 'medium') return hashMod < 50 ? 'office' : 'commercial';
      return hashMod < 40 ? 'residential' : 'commercial';
    }

    // Mid area (300-600m) - mixed use
    if (distanceFromCenter < 600) {
      if (heightCategory === 'high') return hashMod < 60 ? 'office' : 'residential';
      if (heightCategory === 'medium')
        return hashMod < 40 ? 'residential' : hashMod < 70 ? 'commercial' : 'office';
      return hashMod < 70 ? 'residential' : 'commercial';
    }

    // Outer area (> 600m) - mostly residential/industrial
    if (heightCategory === 'low') return hashMod < 20 ? 'industrial' : 'residential';
    if (heightCategory === 'medium') return hashMod < 80 ? 'residential' : 'industrial';
    return hashMod < 90 ? 'residential' : 'office';
  }

  /**
   * Calculate target lit percentage for a specific building type and time
   */
  private calculateBuildingLitPercentage(
    hours: number,
    type: 'residential' | 'office' | 'commercial' | 'industrial',
    hash: number
  ): number {
    // Base percentages for different building types at different times
    const basePercentages = {
      residential: {
        morning: 0.4, // People getting ready for work
        day: 0.05, // Most people at work
        midday: 0.02, // Minimal activity
        afternoon: 0.08, // Some early returns
        evening: 0.7, // Peak home activity
        night: 0.6, // Evening activities
        lateNight: 0.3, // Some people still awake
      },
      office: {
        morning: 0.1, // Early arrivals
        day: 0.8, // Full work activity
        midday: 0.9, // Peak work hours
        afternoon: 0.7, // Afternoon work
        evening: 0.3, // Overtime workers
        night: 0.1, // Night shift/security
        lateNight: 0.05, // Minimal activity
      },
      commercial: {
        morning: 0.2, // Setup/early opening
        day: 0.6, // Business hours
        midday: 0.7, // Peak business
        afternoon: 0.6, // Continued business
        evening: 0.8, // Peak shopping/dining
        night: 0.4, // Late shopping/entertainment
        lateNight: 0.1, // Closing/cleanup
      },
      industrial: {
        morning: 0.3, // Shift start
        day: 0.6, // Day shift
        midday: 0.6, // Continued operations
        afternoon: 0.6, // Shift continuation
        evening: 0.4, // Evening shift
        night: 0.4, // Night shift
        lateNight: 0.3, // Reduced operations
      },
    };

    // Determine time period
    let period: keyof typeof basePercentages.residential;
    if (hours >= 6 && hours < 9) period = 'morning';
    else if (hours >= 9 && hours < 11) period = 'day';
    else if (hours >= 11 && hours < 14) period = 'midday';
    else if (hours >= 14 && hours < 17) period = 'afternoon';
    else if (hours >= 17 && hours < 20) period = 'evening';
    else if (hours >= 20 && hours < 22) period = 'night';
    else period = 'lateNight';

    const basePercentage = basePercentages[type][period];

    // Add per-building variation (-20% to +20%)
    const variation = ((hash % 40) - 20) / 100; // -0.2 to +0.2
    const finalPercentage = Math.max(0, Math.min(1, basePercentage + variation));

    return finalPercentage;
  }
}
