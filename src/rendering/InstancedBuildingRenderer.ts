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
  private maxWindowsPerMesh = 10000; // Increased for better city coverage
  private windowInstances = new Map<string, { lit: number[]; unlit: number[] }>();
  private litWindowPool: number[] = [];
  private unlitWindowPool: number[] = [];
  
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
    
    // Shared materials for windows
    const litMaterial = MaterialCache.getInstance().getMeshBasicMaterial({
      color: 0xffee88,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
    });
    
    const unlitMaterial = MaterialCache.getInstance().getMeshBasicMaterial({
      color: 0x050508,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    });
    
    this.litWindowMesh = new THREE.InstancedMesh(windowGeometry, litMaterial, this.maxWindowsPerMesh);
    this.unlitWindowMesh = new THREE.InstancedMesh(windowGeometry, unlitMaterial, this.maxWindowsPerMesh);
    
    // Configure window meshes
    [this.litWindowMesh, this.unlitWindowMesh].forEach(mesh => {
      mesh.frustumCulled = true; // Enable culling for windows
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.renderOrder = 1;
    });
    
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
  createBuilding(
    position: THREE.Vector3,
    width: number,
    height: number,
    depth: number
  ): string {
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
  }

  private createBuildingWindows(building: BuildingInstance): void {
    const { position, scale } = building;
    const windowSpacingX = 4;
    const windowSpacingY = 5;
    const windowRows = Math.floor(scale.y / windowSpacingY);
    const windowColsX = Math.floor(scale.x / windowSpacingX);
    const windowColsZ = Math.floor(scale.z / windowSpacingX);
    
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
          // Randomly decide if window is lit (higher floors more likely to be dark)
          const isLit = Math.random() > (row / windowRows) * 0.3;
          
          const pool = isLit ? this.litWindowPool : this.unlitWindowPool;
          const mesh = isLit ? this.litWindowMesh : this.unlitWindowMesh;
          const windowList = isLit ? windowIds.lit : windowIds.unlit;
          
          if (pool.length === 0) continue;
          
          const windowIndex = pool.pop()!;
          windowList.push(windowIndex);
          
          // Calculate window position
          const windowPos = new THREE.Vector3();
          if (side.normal.x !== 0) {
            windowPos.x = position.x + side.offset;
            windowPos.z = position.z + (col - side.cols / 2 + 0.5) * windowSpacingX;
          } else {
            windowPos.x = position.x + (col - side.cols / 2 + 0.5) * windowSpacingX;
            windowPos.z = position.z + side.offset;
          }
          windowPos.y = (row + 0.5) * windowSpacingY + 2; // Start windows 2m up
          
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
    
    this.windowInstances.set(building.id, windowIds);
    building.windowIndices = [...windowIds.lit, ...windowIds.unlit];
  }

  /**
   * Update window lighting based on time of day
   */
  updateWindowLighting(hour: number): void {
    const isNightTime = hour < 6 || hour >= 18;
    const transitionHours = [5, 6, 18, 19]; // Dawn and dusk
    const isTransition = transitionHours.includes(Math.floor(hour));
    
    if (!isNightTime && !isTransition) return;
    
    // During transition, randomly switch some windows
    if (isTransition) {
      const switchProbability = isNightTime ? 0.1 : 0.05; // More switching at night
      
      this.windowInstances.forEach((windows, buildingId) => {
        // Randomly switch some windows between lit and unlit
        const toSwitch = Math.floor((windows.lit.length + windows.unlit.length) * switchProbability);
        
        for (let i = 0; i < toSwitch; i++) {
          if (Math.random() > 0.5 && windows.lit.length > 0) {
            // Switch a lit window to unlit
            const idx = Math.floor(Math.random() * windows.lit.length);
            const windowIndex = windows.lit.splice(idx, 1)[0];
            
            // Hide in lit mesh
            this.litWindowMesh.setMatrixAt(windowIndex, new THREE.Matrix4().makeScale(0, 0, 0));
            this.litWindowPool.push(windowIndex);
            
            // Show in unlit mesh (if pool available)
            if (this.unlitWindowPool.length > 0) {
              const newIndex = this.unlitWindowPool.pop()!;
              windows.unlit.push(newIndex);
              // Copy transform logic would go here
            }
          }
        }
      });
      
      this.litWindowMesh.instanceMatrix.needsUpdate = true;
      this.unlitWindowMesh.instanceMatrix.needsUpdate = true;
    }
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
}