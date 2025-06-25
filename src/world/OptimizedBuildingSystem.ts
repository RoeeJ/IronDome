import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MaterialCache } from '../utils/MaterialCache';
import { GeometryFactory } from '../utils/GeometryFactory';
import { ExplosionManager, ExplosionType } from '../systems/ExplosionManager';
import { debug } from '../utils/logger';

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

interface BuildingInfo {
  position: THREE.Vector3;
  width: number;
  height: number;
  depth: number;
}

export class OptimizedBuildingSystem {
  private scene: THREE.Scene;
  private buildings = new Map<string, Building>();
  private buildingGroup = new THREE.Group();
  private debrisGroup = new THREE.Group();
  private buildingInfos: BuildingInfo[] = [];
  
  // Window instancing - separate meshes for lit and unlit windows
  private litWindowMesh: THREE.InstancedMesh;
  private unlitWindowMesh: THREE.InstancedMesh;
  private windowMatrix = new THREE.Matrix4();
  private windowCount = 0;
  private maxWindowsPerMesh = 10000; // 10k windows per mesh to handle all city windows
  private litWindowPool: number[] = [];
  private unlitWindowPool: number[] = [];
  private dummyObject = new THREE.Object3D();
  private lastUpdateHour: number = -1; // Track last update to avoid constant changes
  private windowStates: Map<string, { lit: boolean, litIndex?: number, unlitIndex?: number }> = new Map();
  private switchCount?: number; // For debugging
  private debugCount?: number; // For debugging count issues
  
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
    // Create instanced mesh for lit and unlit windows separately
    const windowGeometry = GeometryFactory.getInstance().getPlane(2, 3);
    
    // Material for lit windows - bright warm glow
    const litWindowMaterial = new THREE.MeshBasicMaterial({
      color: 0xffee88, // Brighter warm yellow
      transparent: true,
      opacity: 1.0, // Full opacity for lit windows
      depthWrite: false,
      renderOrder: 1,
    });
    
    // Material for unlit windows - much darker
    const unlitWindowMaterial = new THREE.MeshBasicMaterial({
      color: 0x050508, // Almost black with slight blue tint
      transparent: true,
      opacity: 0.3, // Lower opacity for unlit windows
      depthWrite: false,
      renderOrder: 1,
    });
    
    // Create separate instanced meshes
    this.litWindowMesh = new THREE.InstancedMesh(
      windowGeometry,
      litWindowMaterial,
      this.maxWindowsPerMesh
    );
    this.litWindowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.litWindowMesh.castShadow = false;
    this.litWindowMesh.receiveShadow = false;
    
    this.unlitWindowMesh = new THREE.InstancedMesh(
      windowGeometry,
      unlitWindowMaterial,
      this.maxWindowsPerMesh
    );
    this.unlitWindowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.unlitWindowMesh.castShadow = false;
    this.unlitWindowMesh.receiveShadow = false;
    
    console.log('Window materials setup:', {
      litMaterial: litWindowMaterial,
      unlitMaterial: unlitWindowMaterial,
      maxWindowsPerMesh: this.maxWindowsPerMesh
    });
    
    // Initialize all windows as invisible
    const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.maxWindowsPerMesh; i++) {
      this.litWindowMesh.setMatrixAt(i, zeroScale);
      this.unlitWindowMesh.setMatrixAt(i, zeroScale);
      this.litWindowPool.push(i);
      this.unlitWindowPool.push(i);
    }
    
    this.buildingGroup.add(this.litWindowMesh);
    this.buildingGroup.add(this.unlitWindowMesh);
  }
  
  createBuilding(position: THREE.Vector3, width: number, height: number, depth: number): string {
    const materialCache = MaterialCache.getInstance();
    const geometryFactory = GeometryFactory.getInstance();
    
    const id = `building_${Date.now()}_${Math.random()}`;
    const floors = Math.floor(height / 4); // Assume 4m per floor
    
    // Store building info for collision detection
    this.buildingInfos.push({
      position: position.clone(),
      width,
      height,
      depth
    });
    
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
    
    // Create windows using instancing - on all 4 sides
    const windowIndices: number[] = [];
    const windowStates: boolean[] = [];
    const windowRows = Math.floor(height / 5);
    const windowColsX = Math.floor(width / 4);
    const windowColsZ = Math.floor(depth / 4);
    
    // Skip first floor for more realistic look (lobby/entrance)
    const startRow = 1;
    
    // Helper function to add a window
    const addWindow = (x: number, y: number, z: number, rotation: number = 0) => {
      // Decide if window should be lit based on current time of day
      // Get current time from the global dayNightCycle if available
      let litChance = 0.05; // Default 5% for daytime
      if ((window as any).__dayNightCycle) {
        const timeObj = (window as any).__dayNightCycle.getTime();
        const hours = timeObj.hours;
        // Debug first building
        if (this.buildings.size === 0) {
          // console.log('First building window creation, time:', hours);
        }
        // Match the time-based percentages
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
      } else {
        console.warn('dayNightCycle not available during building creation');
      }
      const isLit = Math.random() < litChance;
      const pool = isLit ? this.litWindowPool : this.unlitWindowPool;
      const mesh = isLit ? this.litWindowMesh : this.unlitWindowMesh;
      
      if (pool.length > 0) {
        const poolIndex = pool.pop()!;
        const windowKey = `${id}_${windowIndices.length}`; // Unique key for this window
        
        windowIndices.push(windowIndices.length); // Store sequential index
        windowStates.push(true); // Window is intact
        
        // Store window state info
        this.windowStates.set(windowKey, {
          lit: isLit,
          [isLit ? 'litIndex' : 'unlitIndex']: poolIndex
        });
        
        this.dummyObject.position.set(
          position.x + x,
          height / 2 + y,
          position.z + z
        );
        this.dummyObject.rotation.set(0, rotation, 0);
        this.dummyObject.scale.set(1, 1, 1);
        this.dummyObject.updateMatrix();
        
        mesh.setMatrixAt(poolIndex, this.dummyObject.matrix);
        
        // Debug first few windows
        if (windowIndices.length <= 3) {
          // console.log(`Window ${windowIndices.length - 1} created:`, {
          //   isLit,
          //   mesh: isLit ? 'lit' : 'unlit',
          //   poolIndex,
          //   position: this.dummyObject.position
          // });
        }
      }
    };
    
    // Front face (positive Z)
    for (let row = startRow; row < windowRows; row++) {
      for (let col = 0; col < windowColsX; col++) {
        if (Math.random() > 0.2) { // 80% chance of window
          const localX = (col - windowColsX / 2) * 4 + 2;
          const localY = (row - windowRows / 2) * 5 + 2.5;
          const localZ = depth / 2 + 0.5;
          addWindow(localX, localY, localZ, 0);
        }
      }
    }
    
    // Back face (negative Z)
    for (let row = startRow; row < windowRows; row++) {
      for (let col = 0; col < windowColsX; col++) {
        if (Math.random() > 0.2) {
          const localX = (col - windowColsX / 2) * 4 + 2;
          const localY = (row - windowRows / 2) * 5 + 2.5;
          const localZ = -depth / 2 - 0.5;
          addWindow(localX, localY, localZ, Math.PI);
        }
      }
    }
    
    // Right face (positive X)
    for (let row = startRow; row < windowRows; row++) {
      for (let col = 0; col < windowColsZ; col++) {
        if (Math.random() > 0.2) {
          const localX = width / 2 + 0.5;
          const localY = (row - windowRows / 2) * 5 + 2.5;
          const localZ = (col - windowColsZ / 2) * 4 + 2;
          addWindow(localX, localY, localZ, Math.PI / 2);
        }
      }
    }
    
    // Left face (negative X)
    for (let row = startRow; row < windowRows; row++) {
      for (let col = 0; col < windowColsZ; col++) {
        if (Math.random() > 0.2) {
          const localX = -width / 2 - 0.5;
          const localY = (row - windowRows / 2) * 5 + 2.5;
          const localZ = (col - windowColsZ / 2) * 4 + 2;
          addWindow(localX, localY, localZ, -Math.PI / 2);
        }
      }
    }
    
    // Update both window meshes
    this.litWindowMesh.instanceMatrix.needsUpdate = true;
    this.unlitWindowMesh.instanceMatrix.needsUpdate = true;
    // debug.category('BuildingSystem', `Building ${id} created with ${windowIndices.length} windows, total windows: ${this.windowCount + windowIndices.length}`);
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
        
        // Hide the window in the appropriate instanced mesh
        const windowKey = `${building.id}_${i}`;
        const windowState = this.windowStates.get(windowKey);
        if (windowState) {
          const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0);
          if (windowState.lit && windowState.litIndex !== undefined) {
            this.litWindowMesh.setMatrixAt(windowState.litIndex, zeroScale);
          } else if (!windowState.lit && windowState.unlitIndex !== undefined) {
            this.unlitWindowMesh.setMatrixAt(windowState.unlitIndex, zeroScale);
          }
        }
        
        // Create glass shatter effect (simplified)
        const localPos = this.getWindowWorldPosition(building, i);
        this.createGlassDebris(localPos, 5);
      }
    }
    
    // Update both instanced meshes
    this.litWindowMesh.instanceMatrix.needsUpdate = true;
    this.unlitWindowMesh.instanceMatrix.needsUpdate = true;
    
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
    
    // Return window indices to pools
    building.windowIndices.forEach((_, i) => {
      const windowKey = `${building.id}_${i}`;
      const windowState = this.windowStates.get(windowKey);
      if (windowState) {
        const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0);
        if (windowState.lit && windowState.litIndex !== undefined) {
          this.litWindowMesh.setMatrixAt(windowState.litIndex, zeroScale);
          this.litWindowPool.push(windowState.litIndex);
        } else if (!windowState.lit && windowState.unlitIndex !== undefined) {
          this.unlitWindowMesh.setMatrixAt(windowState.unlitIndex, zeroScale);
          this.unlitWindowPool.push(windowState.unlitIndex);
        }
        this.windowStates.delete(windowKey);
      }
    });
    this.litWindowMesh.instanceMatrix.needsUpdate = true;
    this.unlitWindowMesh.instanceMatrix.needsUpdate = true;
    
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
    
    if (this.litWindowMesh) {
      this.litWindowMesh.geometry.dispose();
      if (this.litWindowMesh.material) (this.litWindowMesh.material as THREE.Material).dispose();
    }
    
    if (this.unlitWindowMesh) {
      this.unlitWindowMesh.geometry.dispose();
      if (this.unlitWindowMesh.material) (this.unlitWindowMesh.material as THREE.Material).dispose();
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
      drawCalls: this.mergedBuildingMesh ? 3 : this.buildings.size + 2, // Buildings + lit windows + unlit windows
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
  
  
  // Update window lighting based on time of day (0-24 hours)
  updateTimeOfDay(hours: number): void {
    // Only update when hour changes to avoid constant flickering
    const currentHour = Math.floor(hours);
    
    // Force update if this is the first call or hour has changed significantly (time jump)
    const timeDifference = Math.abs(currentHour - this.lastUpdateHour);
    const forceUpdate = this.lastUpdateHour === -1 || timeDifference > 1;
    
    if (currentHour === this.lastUpdateHour && !forceUpdate) return;
    this.lastUpdateHour = currentHour;
    
    // Determine target lit percentage based on time
    let targetLitPercentage: number;
    if (hours >= 6 && hours < 9) {
      // Early morning - some lights turning off
      targetLitPercentage = 0.3;
    } else if (hours >= 9 && hours < 11) {
      // Late morning - very few lights
      targetLitPercentage = 0.05;
    } else if (hours >= 11 && hours < 14) {
      // Midday/noon - almost no lights (maybe just interior offices without windows)
      targetLitPercentage = 0.02;
    } else if (hours >= 14 && hours < 17) {
      // Afternoon - still very few lights
      targetLitPercentage = 0.05;
    } else if (hours >= 17 && hours < 20) {
      // Evening - lights turning on
      targetLitPercentage = 0.6;
    } else if (hours >= 20 && hours < 22) {
      // Night - most lights on
      targetLitPercentage = 0.8;
    } else {
      // Late night (22-6) - some lights turning off
      targetLitPercentage = 0.5;
    }
    
    // Simple implementation: randomly switch some windows to match target percentage
    const totalWindows = this.windowStates.size;
    const windowStatesArray = Array.from(this.windowStates.values());
    const currentLitCount = windowStatesArray.filter(state => state && state.lit === true).length;
    
    // Extra debugging for the count issue
    if (this.debugCount === undefined) this.debugCount = 0;
    if (this.debugCount++ < 3) {
      const sampleStates = windowStatesArray.slice(0, 10);
      // console.log('Sample window states for debugging:', sampleStates);
      console.log('First state lit check:', sampleStates[0]?.lit, typeof sampleStates[0]?.lit);
    }
    const targetLitCount = Math.floor(totalWindows * targetLitPercentage);
    const difference = targetLitCount - currentLitCount;
    
    // Debug window state distribution on first update
    if (this.lastUpdateHour === -1) {
      const litWithIndex = windowStatesArray.filter(s => s.lit && s.litIndex !== undefined).length;
      const unlitWithIndex = windowStatesArray.filter(s => !s.lit && s.unlitIndex !== undefined).length;
      console.log(`Initial window state distribution:
        Total: ${totalWindows}
        Lit (state.lit=true): ${currentLitCount}
        Lit with index: ${litWithIndex}
        Unlit with index: ${unlitWithIndex}
        Pools - lit available: ${this.litWindowPool.length}, unlit available: ${this.unlitWindowPool.length}`);
    }
    
    // Commented out - too verbose for Seq
    // console.log(`Time of day update: ${hours.toFixed(1)}h, windows: ${currentLitCount}/${totalWindows} lit (${(currentLitCount/totalWindows*100).toFixed(0)}%) → target: ${targetLitCount} (${(targetLitPercentage * 100).toFixed(0)}%), change: ${difference}, forceUpdate: ${forceUpdate}`);
    
    // For force updates (time jumps), update all windows at once
    // For gradual updates, limit to avoid performance issues
    const maxWindowsPerUpdate = forceUpdate ? Math.abs(difference) : 100;
    
    // Skip very small changes unless it's a force update
    if (!forceUpdate && Math.abs(difference) < 5) return;
    
    // Collect all window keys
    const windowKeys = Array.from(this.windowStates.keys());
    // console.log(`Total window keys: ${windowKeys.length}, first few keys:`, windowKeys.slice(0, 3));
    
    if (difference > 0) {
      // Need to turn on more windows
      const unlitWindows = windowKeys.filter(key => {
        const state = this.windowStates.get(key);
        return state && !state.lit;
      });
      const toSwitch = Math.min(Math.abs(difference), unlitWindows.length);
      
      // Randomly select windows to turn on
      let switchedCount = 0;
      for (let i = 0; i < toSwitch && i < maxWindowsPerUpdate; i++) {
        if (unlitWindows.length === 0) break;
        
        const randomIndex = Math.floor(Math.random() * unlitWindows.length);
        const windowKey = unlitWindows.splice(randomIndex, 1)[0];
        const switched = this.switchWindowState(windowKey, true);
        if (switched) switchedCount++;
      }
      if (forceUpdate) {
        // debug.category('WindowUpdate', `Turned ON ${switchedCount} windows (force update)`);
      }
    } else if (difference < 0) {
      // Need to turn off more windows
      const litWindows = windowKeys.filter(key => {
        const state = this.windowStates.get(key);
        return state && state.lit;
      });
      
      if (forceUpdate && litWindows.length === 0) {
        console.error('No lit windows found to turn off! Window states might be corrupted.');
        // Debug: check a sample of window states
        const sampleStates = Array.from(this.windowStates.entries()).slice(0, 5);
        // console.log('Sample window states:', sampleStates);
      }
      const toSwitch = Math.min(Math.abs(difference), litWindows.length);
      
      // Randomly select windows to turn off
      let switchedCount = 0;
      for (let i = 0; i < toSwitch && i < maxWindowsPerUpdate; i++) {
        if (litWindows.length === 0) break;
        
        const randomIndex = Math.floor(Math.random() * litWindows.length);
        const windowKey = litWindows.splice(randomIndex, 1)[0];
        const switched = this.switchWindowState(windowKey, false);
        if (switched) switchedCount++;
      }
      if (forceUpdate) {
        console.log(`Turned OFF ${switchedCount} windows (force update)`);
      }
    }
    
    // Update instance matrices
    this.litWindowMesh.instanceMatrix.needsUpdate = true;
    this.unlitWindowMesh.instanceMatrix.needsUpdate = true;
  }
  
  // Switch a window between lit and unlit state
  private switchWindowState(windowKey: string, toLit: boolean): boolean {
    const state = this.windowStates.get(windowKey);
    if (!state) {
      console.warn(`Window state not found for key: ${windowKey}`);
      return false;
    }
    if (state.lit === toLit) {
      return false; // Already in desired state
    }
    
    // Get the building and window index from the key
    const parts = windowKey.split('_');
    const windowIndexStr = parts[parts.length - 1];
    const buildingIdParts = parts.slice(0, -1);
    
    // Find the building that matches this key
    let building: Building | undefined;
    // The window key format is: buildingId_windowIndex
    // We need to find which building this belongs to
    const lastUnderscore = windowKey.lastIndexOf('_');
    const potentialBuildingId = windowKey.substring(0, lastUnderscore);
    
    building = this.buildings.get(potentialBuildingId);
    
    // If not found by exact match, try the slow way
    if (!building) {
      for (const [id, b] of this.buildings) {
        if (windowKey.startsWith(id + '_')) {
          building = b;
          break;
        }
      }
    }
    
    if (!building) {
      console.warn(`Building not found for window key: ${windowKey}`);
      return false;
    }
    
    const windowIndex = parseInt(windowIndexStr);
    if (!building.windowStates[windowIndex]) {
      return false; // Skip broken windows
    }
    
    // Get current position from the old mesh
    const fromMesh = state.lit ? this.litWindowMesh : this.unlitWindowMesh;
    const fromIndex = state.lit ? state.litIndex : state.unlitIndex;
    
    if (fromIndex === undefined) {
      console.warn(`No index found for window ${windowKey} in ${state.lit ? 'lit' : 'unlit'} mesh`);
      return false;
    }
    
    const matrix = new THREE.Matrix4();
    fromMesh.getMatrixAt(fromIndex, matrix);
    
    // Hide in old mesh
    const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0);
    fromMesh.setMatrixAt(fromIndex, zeroScale);
    
    // Return index to pool
    if (state.lit) {
      this.litWindowPool.push(fromIndex);
    } else {
      this.unlitWindowPool.push(fromIndex);
    }
    
    // Get new index from target pool
    const toPool = toLit ? this.litWindowPool : this.unlitWindowPool;
    const toMesh = toLit ? this.litWindowMesh : this.unlitWindowMesh;
    
    if (toPool.length > 0) {
      const newIndex = toPool.pop()!;
      
      // Set in new mesh
      toMesh.setMatrixAt(newIndex, matrix);
      
      // Update state
      state.lit = toLit;
      if (toLit) {
        state.litIndex = newIndex;
        delete state.unlitIndex; // Clear the old index
      } else {
        state.unlitIndex = newIndex;
        delete state.litIndex; // Clear the old index
      }
      
      // Log first few switches for debugging
      if (this.switchCount === undefined) this.switchCount = 0;
      this.switchCount++;
      if (this.switchCount <= 10 || this.switchCount % 100 === 0) {
        console.log(`Switched window ${windowKey} to ${toLit ? 'lit' : 'unlit'} (${this.switchCount} total)`);
      }
      
      return true;
    }
    
    console.warn(`Failed to switch window ${windowKey} - no indices available in target pool`);
    return false;
  }
  
  /**
   * Get all buildings for collision detection
   */
  getBuildings(): BuildingInfo[] {
    return this.buildingInfos;
  }
}