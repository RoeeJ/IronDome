import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MaterialCache } from '../utils/MaterialCache';
import { GeometryFactory } from '../utils/GeometryFactory';
import { ExplosionManager, ExplosionType } from '../systems/ExplosionManager';
import { debug } from '../utils/DebugLogger';

interface Building {
  id: string;
  mesh: THREE.Mesh;
  position: THREE.Vector3;
  health: number;
  maxHealth: number;
  isDestroyed: boolean;
  floors: number;
  windowIndices: number[]; // Indices in the instanced window mesh
  windowStates: boolean[]; // Track which windows are broken
  debrisCreated: boolean;
}

export class OptimizedBuildingSystem {
  private scene: THREE.Scene;
  private buildings = new Map<string, Building>();
  private buildingGroup = new THREE.Group();
  private debrisGroup = new THREE.Group();
  
  // Window instancing
  private windowMesh: THREE.InstancedMesh;
  private windowMatrix = new THREE.Matrix4();
  private windowCount = 0;
  private maxWindows = 10000; // Support up to 10k windows
  private windowPool: number[] = [];
  private dummyObject = new THREE.Object3D();
  
  // Merged building geometry
  private mergedBuildingMesh: THREE.Mesh | null = null;
  private buildingGeometries: THREE.BufferGeometry[] = [];
  
  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.buildingGroup.name = 'Buildings';
    this.debrisGroup.name = 'BuildingDebris';
    this.scene.add(this.buildingGroup);
    this.scene.add(this.debrisGroup);
    
    this.initializeWindowInstancing();
  }
  
  private initializeWindowInstancing(): void {
    // Create instanced mesh for all windows
    const windowGeometry = GeometryFactory.getInstance().getPlane(2, 3);
    const windowMaterial = MaterialCache.getInstance().getMeshBasicMaterial({
      color: 0xffff88,
      transparent: true,
      opacity: 0.8,
    });
    
    this.windowMesh = new THREE.InstancedMesh(
      windowGeometry,
      windowMaterial,
      this.maxWindows
    );
    this.windowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Windows don't need shadows
    this.windowMesh.castShadow = false;
    this.windowMesh.receiveShadow = false;
    
    // Initialize all windows as invisible
    const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.maxWindows; i++) {
      this.windowMesh.setMatrixAt(i, zeroScale);
      this.windowPool.push(i);
    }
    
    this.buildingGroup.add(this.windowMesh);
  }
  
  createBuilding(position: THREE.Vector3, width: number, height: number, depth: number): string {
    const materialCache = MaterialCache.getInstance();
    const geometryFactory = GeometryFactory.getInstance();
    
    const id = `building_${Date.now()}_${Math.random()}`;
    const floors = Math.floor(height / 4); // Assume 4m per floor
    
    // Create building mesh
    const geometry = geometryFactory.getBox(width, height, depth);
    const material = materialCache.getMeshStandardMaterial({
      color: new THREE.Color().setHSL(0, 0, 0.3 + Math.random() * 0.2),
      roughness: 0.9,
      metalness: 0.1,
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    mesh.position.y = height / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.buildingId = id;
    
    // Create windows using instancing
    const windowIndices: number[] = [];
    const windowStates: boolean[] = [];
    const windowRows = Math.floor(height / 5);
    const windowCols = Math.floor(width / 4);
    
    for (let row = 0; row < windowRows; row++) {
      for (let col = 0; col < windowCols; col++) {
        if (Math.random() > 0.3 && this.windowPool.length > 0) {
          // Get an available window index
          const windowIndex = this.windowPool.pop()!;
          windowIndices.push(windowIndex);
          windowStates.push(true); // Window is intact
          
          // Calculate world position for window
          const localX = (col - windowCols / 2) * 4 + 2;
          const localY = (row - windowRows / 2) * 5 + 2.5;
          const localZ = depth / 2 + 0.1;
          
          // Set up window transform - add to building center height
          this.dummyObject.position.set(
            position.x + localX,
            height / 2 + localY,  // Use building height, not ground position
            position.z + localZ
          );
          this.dummyObject.rotation.set(0, 0, 0);
          this.dummyObject.scale.set(1, 1, 1);
          this.dummyObject.updateMatrix();
          
          // Apply to instanced mesh
          this.windowMesh.setMatrixAt(windowIndex, this.dummyObject.matrix);
        }
      }
    }
    
    // Update window mesh
    this.windowMesh.instanceMatrix.needsUpdate = true;
    this.windowCount += windowIndices.length;
    
    const building: Building = {
      id,
      mesh,
      position: position.clone(),
      health: 100,
      maxHealth: 100,
      isDestroyed: false,
      floors,
      windowIndices,
      windowStates,
      debrisCreated: false,
    };
    
    this.buildings.set(id, building);
    this.buildingGroup.add(mesh);
    
    // Store geometry for later merging - DON'T apply transform yet
    const clonedGeometry = geometry.clone();
    this.buildingGeometries.push(clonedGeometry);
    
    return id;
  }
  
  // Merge all building geometries into a single mesh
  mergeBuildingGeometries(): void {
    if (this.buildingGeometries.length === 0) return;
    
    // Remove individual building meshes
    this.buildings.forEach(building => {
      if (building.mesh.parent) {
        building.mesh.removeFromParent();
      }
    });
    
    // BufferGeometryUtils is now imported at the top
    
    // Apply world transforms to geometries before merging
    const transformedGeometries: THREE.BufferGeometry[] = [];
    let index = 0;
    this.buildings.forEach(building => {
      if (index < this.buildingGeometries.length) {
        const geometry = this.buildingGeometries[index].clone();
        building.mesh.updateMatrixWorld();
        geometry.applyMatrix4(building.mesh.matrixWorld);
        transformedGeometries.push(geometry);
        index++;
      }
    });
    
    // Merge all building geometries
    const mergedGeometry = BufferGeometryUtils.mergeGeometries(
      transformedGeometries,
      false
    );
    
    // Create merged mesh
    const material = MaterialCache.getInstance().getMeshStandardMaterial({
      color: 0x888888,
      roughness: 0.9,
      metalness: 0.1,
    });
    
    this.mergedBuildingMesh = new THREE.Mesh(mergedGeometry, material);
    this.mergedBuildingMesh.castShadow = true;
    this.mergedBuildingMesh.receiveShadow = true;
    
    // Ensure the mesh casts shadows properly by updating matrix
    this.mergedBuildingMesh.updateMatrix();
    this.mergedBuildingMesh.updateMatrixWorld();
    
    // Enable automatic shadow updates
    this.mergedBuildingMesh.matrixAutoUpdate = true;
    
    this.buildingGroup.add(this.mergedBuildingMesh);
    
    const stats = this.getStats();
    debug.log(`Building optimization complete:`);
    debug.log(`- Buildings: ${this.buildingGeometries.length}`);
    debug.log(`- Windows: ${this.windowCount} (instanced)`);
    debug.log(`- Draw calls: ${stats.drawCalls} (was ${this.buildingGeometries.length + this.windowCount})`);
    debug.log(`- Reduction: ${Math.round(100 - (stats.drawCalls / (this.buildingGeometries.length + this.windowCount)) * 100)}%`);
  }
  
  damageBuilding(buildingId: string, damage: number): void {
    const building = this.buildings.get(buildingId);
    if (!building || building.isDestroyed) return;
    
    building.health = Math.max(0, building.health - damage);
    
    // Update appearance based on damage
    const damageRatio = 1 - building.health / building.maxHealth;
    
    // Break windows progressively
    const windowsToBreak = Math.floor(building.windowIndices.length * damageRatio);
    for (let i = 0; i < windowsToBreak; i++) {
      if (building.windowStates[i]) {
        building.windowStates[i] = false;
        
        // Hide the window in instanced mesh
        const windowIndex = building.windowIndices[i];
        const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0);
        this.windowMesh.setMatrixAt(windowIndex, zeroScale);
        
        // Create glass shatter effect (simplified)
        const localPos = this.getWindowWorldPosition(building, i);
        this.createGlassDebris(localPos, 5);
      }
    }
    
    // Update instanced mesh
    this.windowMesh.instanceMatrix.needsUpdate = true;
    
    // Check if building should collapse
    if (building.health <= 0) {
      this.destroyBuilding(buildingId);
    }
  }
  
  private getWindowWorldPosition(building: Building, windowIndex: number): THREE.Vector3 {
    // Approximate window position based on building
    const offset = new THREE.Vector3(
      (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 20,
      5
    );
    return building.position.clone().add(offset);
  }
  
  private createGlassDebris(position: THREE.Vector3, count: number): void {
    const debrisSystem = (window as any).__debrisSystem;
    if (debrisSystem) {
      debrisSystem.createDebris(position, count, 10, false);
    }
  }
  
  private destroyBuilding(buildingId: string): void {
    const building = this.buildings.get(buildingId);
    if (!building || building.isDestroyed) return;
    
    building.isDestroyed = true;
    
    // Return window indices to pool
    building.windowIndices.forEach(index => {
      const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0);
      this.windowMesh.setMatrixAt(index, zeroScale);
      this.windowPool.push(index);
    });
    this.windowMesh.instanceMatrix.needsUpdate = true;
    
    // Create explosion effect
    const explosionManager = ExplosionManager.getInstance(this.scene);
    explosionManager.createExplosion({
      type: ExplosionType.GROUND_IMPACT,
      position: building.position.clone(),
      radius: 20,
    });
    
    // Note: In merged mode, we can't remove individual buildings
    // Would need a more complex system to handle destruction
    
    this.buildings.delete(buildingId);
  }
  
  getNearbyBuildings(position: THREE.Vector3, radius: number): Building[] {
    const nearby: Building[] = [];
    
    this.buildings.forEach(building => {
      if (!building.isDestroyed) {
        const distance = building.position.distanceTo(position);
        if (distance <= radius) {
          nearby.push(building);
        }
      }
    });
    
    return nearby;
  }
  
  update(deltaTime: number): void {
    // Update any animated elements if needed
  }
  
  dispose(): void {
    this.buildings.forEach(building => {
      if (building.mesh.geometry) building.mesh.geometry.dispose();
      if (building.mesh.material) (building.mesh.material as THREE.Material).dispose();
    });
    
    if (this.windowMesh) {
      this.windowMesh.geometry.dispose();
      if (this.windowMesh.material) (this.windowMesh.material as THREE.Material).dispose();
    }
    
    if (this.mergedBuildingMesh) {
      this.mergedBuildingMesh.geometry.dispose();
      if (this.mergedBuildingMesh.material) {
        (this.mergedBuildingMesh.material as THREE.Material).dispose();
      }
    }
    
    this.buildingGroup.clear();
    this.debrisGroup.clear();
    this.buildings.clear();
  }
  
  getStats() {
    return {
      buildingCount: this.buildings.size,
      windowCount: this.windowCount,
      drawCalls: this.mergedBuildingMesh ? 2 : this.buildings.size + 1, // Buildings + windows
    };
  }
  
  checkExplosionDamage(explosionPos: THREE.Vector3, blastRadius: number): void {
    this.buildings.forEach(building => {
      if (building.isDestroyed) return;
      
      const distance = building.position.distanceTo(explosionPos);
      if (distance <= blastRadius) {
        // Calculate damage based on distance
        const damageFactor = 1 - distance / blastRadius;
        const damage = damageFactor * 50; // Max 50 damage from explosion
        
        if (damage > 0) {
          this.damageBuilding(building.id, damage);
        }
      }
    });
  }
  
  getBuildingAt(position: THREE.Vector3, radius: number = 10): Building | null {
    for (const building of this.buildings.values()) {
      if (!building.isDestroyed) {
        const distance = building.position.distanceTo(position);
        if (distance <= radius) {
          return building;
        }
      }
    }
    return null;
  }
  
  getAllBuildings(): Building[] {
    return Array.from(this.buildings.values());
  }
}