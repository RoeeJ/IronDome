import * as THREE from 'three';
import { MaterialCache } from '../utils/MaterialCache';
import { debug } from '../utils/logger';
import { StaticGeometryMerger } from '../utils/StaticGeometryMerger';
import { StreetLightInstanceManager } from '../rendering/StreetLightInstanceManager';
import { InstancedBuildingRenderer } from '../rendering/InstancedBuildingRenderer';

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

export class BuildingSystem {
  private scene: THREE.Scene;
  private buildings = new Map<string, Building>();
  private buildingGroup = new THREE.Group();
  private debrisGroup = new THREE.Group();
  private cityGenerated = false; // Flag to prevent multiple city generations
  private buildingInfos: BuildingInfo[] = [];
  private buildingPositions: { x: number; z: number; width: number; depth: number }[] = [];
  private roadPositions: { start: { x: number; z: number }; end: { x: number; z: number } }[] = [];
  private neighborhoods: { center: { x: number; z: number }; buildings: any[]; radius: number }[] =
    [];

  // Window instancing - separate meshes for lit and unlit windows
  private litWindowMesh: THREE.InstancedMesh;
  private unlitWindowMesh: THREE.InstancedMesh;
  private windowMatrix = new THREE.Matrix4();
  private windowCount = 0;
  private maxWindowsPerMesh = 5000; // Increased for larger city (was 2000)
  private maxWindowsPerBuilding = 200; // Increased limit since we're using instancing efficiently
  private litWindowPool: number[] = [];
  private unlitWindowPool: number[] = [];
  private poolExhaustedWarned: boolean = false;
  private dummyObject = new THREE.Object3D();
  private lastUpdateHour: number = -1; // Track last update to avoid constant changes
  private windowStates: Map<string, { lit: boolean; litIndex?: number; unlitIndex?: number }> =
    new Map();
  private switchCount?: number; // For debugging
  private debugCount?: number; // For debugging count issues

  // CHAINSAW: Removed geometry merging complexity
  // Roads and street lights
  private streetLights: THREE.Group = new THREE.Group();
  private roads: THREE.Group = new THREE.Group();
  private lastLightingUpdate = 0;
  private streetLightManager?: StreetLightInstanceManager;

  // Merged static geometry
  private mergedStaticGeometry: {
    buildings?: THREE.Mesh;
    roads?: THREE.Mesh;
    lights?: THREE.Mesh;
  } = {};

  // Instanced building renderer (optional optimization)
  private instancedRenderer?: InstancedBuildingRenderer;
  private useInstancedBuildings = true; // Enable by default for better performance

  constructor(scene: THREE.Scene, useInstancedBuildings = true) {
    this.scene = scene;
    this.buildingGroup.name = 'Buildings';
    this.debrisGroup.name = 'BuildingDebris';
    this.streetLights.name = 'StreetLights';
    this.roads.name = 'Roads';

    // SUPER SAIYAN FIX: ADD ALL GROUPS TO SCENE!
    this.scene.add(this.buildingGroup);
    this.scene.add(this.debrisGroup);
    this.scene.add(this.streetLights);
    this.scene.add(this.roads);

    this.useInstancedBuildings = useInstancedBuildings;

    if (this.useInstancedBuildings) {
      // Use instanced building renderer for better performance
      this.instancedRenderer = new InstancedBuildingRenderer(scene);
      debug.log('BuildingSystem: Using instanced building renderer for improved performance');
    } else {
      // Fall back to old window instancing system
      this.initializeWindowInstancing();
    }

    // Initialize street light instance manager
    this.streetLightManager = new StreetLightInstanceManager(scene);
  }

  private initializeWindowInstancing(): void {
    // Create instanced mesh for lit and unlit windows separately
    const windowGeometry = new THREE.PlaneGeometry(2, 3);

    // Material for lit windows - bright warm glow (SHARED)
    const litWindowMaterial = MaterialCache.getInstance().getMeshBasicMaterial({
      color: 0xffee88, // Brighter warm yellow
      // No transparency needed - saves render passes
    });

    // Material for unlit windows - much darker (SHARED)
    const unlitWindowMaterial = MaterialCache.getInstance().getMeshBasicMaterial({
      color: 0x050508, // Almost black with slight blue tint
      transparent: true,
      opacity: 0.3, // Lower opacity for unlit windows
      depthWrite: false,
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
    this.litWindowMesh.renderOrder = 0; // Render opaque first

    this.unlitWindowMesh = new THREE.InstancedMesh(
      windowGeometry,
      unlitWindowMaterial,
      this.maxWindowsPerMesh
    );
    this.unlitWindowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.unlitWindowMesh.castShadow = false;
    this.unlitWindowMesh.receiveShadow = false;
    this.unlitWindowMesh.renderOrder = 10; // Render transparent after

    debug.log('Window materials setup:', {
      litMaterial: litWindowMaterial,
      unlitMaterial: unlitWindowMaterial,
      maxWindowsPerMesh: this.maxWindowsPerMesh,
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
    // Store building info for collision detection
    this.buildingInfos.push({
      position: position.clone(),
      width,
      height,
      depth,
    });

    // Use instanced renderer if available
    if (this.useInstancedBuildings && this.instancedRenderer) {
      return this.instancedRenderer.createBuilding(position, width, height, depth);
    }

    // Legacy non-instanced building creation
    const materialCache = MaterialCache.getInstance();
    const id = `building_${Date.now()}_${Math.random()}`;
    const floors = Math.floor(height / 4); // Assume 4m per floor

    // UNIFORM WINDOWS: Calculate windows based on building surface area, not location
    const windowDensity = 0.85; // 85% chance of window per possible slot (increased from 70%)

    // Create building mesh - CHAINSAW: Use standard geometry
    const geometry = new THREE.BoxGeometry(width, height, depth);
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
    // BALANCED WINDOWS: Calculate based on building size but cap total
    const baseRows = Math.floor(height / 5); // Tighter vertical spacing (was 8)
    const baseColsX = Math.floor(width / 4); // Tighter horizontal spacing (was 6)
    const baseColsZ = Math.floor(depth / 4); // Tighter horizontal spacing (was 6)

    // Calculate total potential windows
    const potentialWindows = baseRows * (baseColsX * 2 + baseColsZ * 2) * windowDensity;

    // Scale down if too many
    let scaleFactor = 1.0;
    if (potentialWindows > this.maxWindowsPerBuilding) {
      scaleFactor = Math.sqrt(this.maxWindowsPerBuilding / potentialWindows);
    }

    const windowRows = Math.max(2, Math.floor(baseRows * scaleFactor));
    const windowColsX = Math.max(2, Math.floor(baseColsX * scaleFactor));
    const windowColsZ = Math.max(2, Math.floor(baseColsZ * scaleFactor));

    // Skip first floor for more realistic look (lobby/entrance)
    const startRow = 1;

    // Helper function to add a window
    const addWindow = (x: number, y: number, z: number, rotation: number = 0) => {
      // Decide if window should be lit based on current time of day
      // Get current time from optimized day/night cycle
      let litChance = 0.05; // Default 5% for daytime
      if ((window as any).__optimizedDayNight) {
        const timeObj = (window as any).__optimizedDayNight.getTime();
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
        debug.warn('optimizedDayNight not available during building creation');
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
          [isLit ? 'litIndex' : 'unlitIndex']: poolIndex,
        });

        this.dummyObject.position.set(position.x + x, height / 2 + y, position.z + z);
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
        if (Math.random() < windowDensity) {
          // Uniform density
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
        if (Math.random() < windowDensity) {
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
        if (Math.random() < windowDensity) {
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
        if (Math.random() < windowDensity) {
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

    // CHAINSAW: No geometry merging - keep simple

    return id;
  }

  // CHAINSAW OPTIMIZED: Generate complete city with roads and street lights
  generateCity(centerX: number = 0, centerZ: number = 0, radius: number = 800): void {
    // Check if city has already been generated
    if (this.cityGenerated) {
      debug.warn('City already generated, skipping duplicate generation');
      return;
    }
    
    // Mark as generated to prevent race conditions
    this.cityGenerated = true;
    
    // Create all the data structures first
    this.createBuildings(centerX, centerZ, radius);
    this.createRoadNetwork(centerX, centerZ, radius);
    this.createStreetLights(centerX, centerZ, radius);
    
    // Now animate them appearing gradually
    this.animateCityGeneration();

    debug.log(`City generation started: ${this.buildings.size} buildings, roads, and street lights`);
  }
  
  private animateCityGeneration(): void {
    // Hide all buildings initially
    this.buildings.forEach(building => {
      building.mesh.visible = false;
      building.mesh.scale.y = 0.01; // Start flat
    });
    
    // Hide roads and lights
    this.roads.visible = false;
    this.streetLights.visible = false;
    
    // Sort buildings by distance from center for ripple effect
    const buildingArray = Array.from(this.buildings.values()).sort((a, b) => {
      const distA = Math.sqrt(a.position.x * a.position.x + a.position.z * a.position.z);
      const distB = Math.sqrt(b.position.x * b.position.x + b.position.z * b.position.z);
      return distA - distB;
    });
    
    // Track animation completion
    let allBuildingsStarted = false;
    let roadsStarted = false;
    let lightsStarted = false;
    let allAnimationsComplete = 0;
    const totalAnimations = 3; // buildings, roads, lights
    
    const checkAllComplete = () => {
      allAnimationsComplete++;
      if (allAnimationsComplete >= totalAnimations) {
        // All animations complete - now merge static geometry for performance
        setTimeout(() => {
          this.mergeStaticGeometry();
          debug.log('City generation animations complete, static geometry merged');
        }, 200);
      }
    };
    
    // Animate buildings rising from the ground
    let buildingIndex = 0;
    const buildingsPerBatch = 3; // How many buildings appear at once
    
    const buildingInterval = setInterval(() => {
      // Process a batch of buildings
      for (let i = 0; i < buildingsPerBatch && buildingIndex < buildingArray.length; i++) {
        const building = buildingArray[buildingIndex];
        building.mesh.visible = true;
        
        // Animate the building rising
        this.animateBuildingRise(building.mesh);
        
        buildingIndex++;
      }
      
      // Start roads once we have some buildings (after 25% are started)
      if (!roadsStarted && buildingIndex >= buildingArray.length * 0.25) {
        roadsStarted = true;
        setTimeout(() => {
          this.animateRoadsAppear(() => checkAllComplete());
        }, 200);
      }
      
      // Start street lights once we have more buildings (after 50% are started)
      if (!lightsStarted && buildingIndex >= buildingArray.length * 0.5) {
        lightsStarted = true;
        setTimeout(() => {
          this.animateStreetLightsAppear(() => checkAllComplete());
        }, 400);
      }
      
      // When all buildings are started
      if (buildingIndex >= buildingArray.length) {
        clearInterval(buildingInterval);
        allBuildingsStarted = true;
        
        // Wait for all building animations to complete
        setTimeout(() => {
          checkAllComplete();
        }, 1000); // Max building animation time
      }
    }, 50); // 50ms between batches = smooth appearance
  }
  
  private animateBuildingRise(mesh: THREE.Mesh): void {
    const targetScale = 1; // Buildings should have scale.y = 1
    const targetY = mesh.position.y;
    const startY = targetY - 10;
    
    // Start below ground
    mesh.position.y = startY;
    mesh.scale.y = 0.01;
    
    const duration = 600 + Math.random() * 400; // 600-1000ms
    const startTime = Date.now();
    
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Easing function for smooth animation
      const eased = 1 - Math.pow(1 - progress, 3); // Cubic ease-out
      
      mesh.scale.y = 0.01 + (targetScale - 0.01) * eased;
      mesh.position.y = startY + (targetY - startY) * eased;
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };
    
    animate();
  }
  
  private animateRoadsAppear(onComplete?: () => void): void {
    this.roads.visible = true;
    
    let completedRoads = 0;
    const totalRoads = this.roads.children.length;
    
    // Fade in roads
    this.roads.children.forEach((road, index) => {
      if (road instanceof THREE.Mesh && road.material) {
        const material = road.material as THREE.MeshBasicMaterial;
        
        // Don't animate opacity on basic materials - just show them
        // MeshBasicMaterial doesn't support transparency well during animation
        material.visible = true;
        
        // Small delay for stagger effect without opacity animation
        setTimeout(() => {
          completedRoads++;
          if (completedRoads >= totalRoads && onComplete) {
            onComplete();
          }
        }, index * 20); // Stagger by 20ms per road segment
      }
    });
    
    // Fallback in case there are no roads
    if (totalRoads === 0 && onComplete) {
      onComplete();
    }
  }
  
  private animateStreetLightsAppear(onComplete?: () => void): void {
    this.streetLights.visible = true;
    
    // Make lights pop in with a scale animation
    if (this.streetLightManager) {
      const count = this.streetLightManager.getInstanceCount();
      const batchSize = 5;
      let currentIndex = 0;
      
      const lightInterval = setInterval(() => {
        // Animate a batch of lights
        for (let i = 0; i < batchSize && currentIndex < count; i++) {
          this.streetLightManager!.animateLightAppear(currentIndex);
          currentIndex++;
        }
        
        if (currentIndex >= count) {
          clearInterval(lightInterval);
          
          // All lights animation complete
          if (onComplete) {
            setTimeout(onComplete, 300); // Wait for last animations to finish
          }
        }
      }, 30); // 30ms between batches
    } else if (onComplete) {
      // No street lights to animate
      onComplete();
    }
  }

  private createBuildings(centerX: number, centerZ: number, radius: number): void {
    // HEXAGONAL PACKING FOR MAXIMUM EFFICIENCY!
    const buildingCount = 80; // Reasonable for performance

    // Generate hexagonal packed districts
    const districts: any[] = [];

    // RING 0: Skip center (that's where the battery is)

    // USING FULL 1000m RADIUS TERRAIN!

    // RING 1: 6 districts at 350m (increased spacing)
    const ring1Radius = 350;
    const ring1Count = 6;
    for (let i = 0; i < ring1Count; i++) {
      const angle = (i / ring1Count) * Math.PI * 2;
      districts.push({
        center: {
          x: centerX + Math.cos(angle) * ring1Radius,
          z: centerZ + Math.sin(angle) * ring1Radius,
        },
        buildings: 5, // Minimum 5 for inner ring
        heightMult: 2.0,
        spread: 80, // Increased from 60
        ring: 1,
      });
    }

    // RING 2: 10 districts at 650m (reduced count, increased spacing)
    const ring2Radius = 650;
    const ring2Count = 10; // Reduced from 12
    const ring2Offset = Math.PI / ring2Count; // Offset for hex packing
    for (let i = 0; i < ring2Count; i++) {
      const angle = (i / ring2Count) * Math.PI * 2 + ring2Offset;
      districts.push({
        center: {
          x: centerX + Math.cos(angle) * ring2Radius,
          z: centerZ + Math.sin(angle) * ring2Radius,
        },
        buildings: 4, // Minimum 4 for middle ring
        heightMult: 1.5,
        spread: 70, // Increased from 50
        ring: 2,
      });
    }

    // RING 3: 12 districts at 900m (reduced count, near edge)
    const ring3Radius = 900;
    const ring3Count = 12; // Reduced from 18
    for (let i = 0; i < ring3Count; i++) {
      const angle = (i / ring3Count) * Math.PI * 2;
      districts.push({
        center: {
          x: centerX + Math.cos(angle) * ring3Radius,
          z: centerZ + Math.sin(angle) * ring3Radius,
        },
        buildings: 3, // Minimum 3 for outer ring
        heightMult: 1.0,
        spread: 60, // Increased from 40
        ring: 3,
      });
    }

    // Less aggressive randomization for cleaner look
    districts.forEach(district => {
      const jitter = 20; // Reduced from 40
      district.center.x += (Math.random() - 0.5) * jitter;
      district.center.z += (Math.random() - 0.5) * jitter;

      // Remove building count variation for consistency
    });

    // Track building positions for road generation
    this.buildingPositions = [];

    districts.forEach(district => {
      let placedInDistrict = 0;
      const maxAttempts = 200; // Increased attempts
      let totalAttempts = 0;
      const districtBuildings: typeof this.buildingPositions = [];

      while (placedInDistrict < district.buildings && totalAttempts < maxAttempts) {
        totalAttempts++;

        // Spread buildings across district
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * district.spread;
        const x = district.center.x + Math.cos(angle) * distance;
        const z = district.center.z + Math.sin(angle) * distance;

        // Generate building dimensions first
        const width = 20 + Math.random() * 30;
        const depth = 20 + Math.random() * 30;

        // Check minimum distance from other buildings - account for building dimensions
        let tooClose = false;

        // Check against all previously placed buildings
        for (const pos of this.buildingPositions) {
          // Calculate minimum distance: half of each building's size + clearance
          const halfWidth1 = width / 2;
          const halfDepth1 = depth / 2;
          const halfWidth2 = pos.width / 2;
          const halfDepth2 = pos.depth / 2;

          // Use max of width/depth for safety
          const minDist = Math.max(halfWidth1 + halfWidth2, halfDepth1 + halfDepth2) + 5; // 5m edge-to-edge clearance

          if (Math.sqrt((x - pos.x) ** 2 + (z - pos.z) ** 2) < minDist) {
            tooClose = true;
            break;
          }
        }

        // Also check against buildings in current district
        if (!tooClose) {
          for (const pos of districtBuildings) {
            const halfWidth1 = width / 2;
            const halfDepth1 = depth / 2;
            const halfWidth2 = pos.width / 2;
            const halfDepth2 = pos.depth / 2;

            const minDist = Math.max(halfWidth1 + halfWidth2, halfDepth1 + halfDepth2) + 5;

            if (Math.sqrt((x - pos.x) ** 2 + (z - pos.z) ** 2) < minDist) {
              tooClose = true;
              break;
            }
          }
        }

        // Also avoid center area where Iron Dome is
        const centerDist = Math.sqrt(x ** 2 + z ** 2);
        if (centerDist < 100) tooClose = true;

        // Keep within terrain bounds
        if (Math.abs(x) > 950 || Math.abs(z) > 950) continue;

        if (!tooClose) {
          // SUPER SAIYAN 2: MUCH TALLER BUILDINGS!
          const baseHeight = 40 + Math.random() * 60;
          const height = baseHeight * district.heightMult;

          const pos = new THREE.Vector3(x, 0, z);
          const buildingId = this.createBuilding(pos, width, height, depth);
          districtBuildings.push({ x, z, width, depth });
          placedInDistrict++;
        }
      }

      // Only commit the district if we placed at least 3 buildings
      if (placedInDistrict >= 3) {
        this.buildingPositions.push(...districtBuildings);
      } else {
        // Cancel this district - remove any buildings we created
        debug.warn(
          `Cancelling district at (${district.center.x}, ${district.center.z}) - only placed ${placedInDistrict} buildings`
        );
        // Remove the buildings we just created from the scene
        for (let i = 0; i < placedInDistrict; i++) {
          const buildingId = `building_${this.buildings.size - placedInDistrict + i}`;
          const building = this.buildings.get(buildingId);
          if (building) {
            this.buildingGroup.remove(building.mesh);
            building.mesh.geometry.dispose();
            this.buildings.delete(buildingId);
          }
        }
      }
    });
  }

  // Helper function to create flat rectangular roads
  private createFlatRoad(
    start: THREE.Vector3,
    end: THREE.Vector3,
    width: number = 15,
    thickness: number = 0.2,
    material?: THREE.Material
  ): THREE.Mesh {
    // 1. full dir (we'll use only XZ)
    const fullDir = new THREE.Vector3().subVectors(end, start);

    // 2. flatten it - remove Y component for purely horizontal alignment
    const flatDir = new THREE.Vector3(fullDir.x, 0, fullDir.z);
    const length = flatDir.length();
    if (length < 1e-6) throw new Error('Zero-length road');

    // 3. build a box length-long on X, thickness on Y, width on Z
    const geo = new THREE.BoxGeometry(length, thickness, width);
    const mat =
      material ??
      MaterialCache.getInstance().getMeshBasicMaterial({
        color: 0x444444,
        side: THREE.DoubleSide,
      });
    const road = new THREE.Mesh(geo, mat);

    // 4. rotate X→flatDir using quaternion for proper alignment
    const quat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(1, 0, 0), // box's local +X
      flatDir.normalize() // target horizontal dir
    );
    road.applyQuaternion(quat);

    // 5. position at midpoint
    const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    road.position.copy(midpoint);
    road.position.y = 2.0; // Match the circular road height

    return road;
  }

  private createRoadNetwork(centerX: number, centerZ: number, radius: number): void {
    // SIMPLIFIED NEIGHBORHOOD ROADS!
    const roadMaterial = MaterialCache.getInstance().getMeshBasicMaterial({
      color: 0x444444, // Darker asphalt color
      side: THREE.DoubleSide,
      transparent: false,
    });

    const roadWidth = 15;
    const roadHeight = 2.0; // Much higher to prevent z-fighting at max zoom

    const segments: { start: { x: number; z: number }; end: { x: number; z: number } }[] = [];

    // Main city center hub - Using RingGeometry for flat road
    const hubRadius = 100;
    const hubRingGeometry = new THREE.RingGeometry(
      hubRadius - roadWidth / 2,
      hubRadius + roadWidth / 2,
      64
    );
    const hubMesh = new THREE.Mesh(hubRingGeometry, roadMaterial);
    hubMesh.rotation.x = -Math.PI / 2; // Rotate to be horizontal
    hubMesh.position.set(centerX, roadHeight, centerZ);
    this.roads.add(hubMesh);

    // Group buildings into neighborhoods - ensure minimum size
    const neighborhoods: {
      center: { x: number; z: number };
      buildings: typeof this.buildingPositions;
      radius: number;
    }[] = [];
    const neighborhoodRadius = 120; // Reduced for better separation
    const usedBuildings = new Set<(typeof this.buildingPositions)[0]>();

    // First pass: create neighborhoods with at least 3 buildings
    for (const building of this.buildingPositions) {
      if (usedBuildings.has(building)) continue;

      // Find nearby buildings to form a neighborhood
      const nearbyBuildings = [building];
      usedBuildings.add(building);

      // Look for closest buildings to form a group
      const candidates = this.buildingPositions
        .filter(b => !usedBuildings.has(b))
        .map(b => ({
          building: b,
          dist: Math.sqrt(Math.pow(b.x - building.x, 2) + Math.pow(b.z - building.z, 2)),
        }))
        .sort((a, b) => a.dist - b.dist);

      // Add closest buildings until we have at least 3
      for (const candidate of candidates) {
        if (nearbyBuildings.length >= 3 && candidate.dist > neighborhoodRadius) break;
        if (candidate.dist < neighborhoodRadius * 1.5) {
          // Slightly larger radius to ensure grouping
          nearbyBuildings.push(candidate.building);
          usedBuildings.add(candidate.building);
        }
      }

      // Only create neighborhood if we have at least 3 buildings
      if (nearbyBuildings.length >= 3) {
        const centerX = nearbyBuildings.reduce((sum, b) => sum + b.x, 0) / nearbyBuildings.length;
        const centerZ = nearbyBuildings.reduce((sum, b) => sum + b.z, 0) / nearbyBuildings.length;

        neighborhoods.push({
          center: { x: centerX, z: centerZ },
          buildings: nearbyBuildings,
          radius: 60, // Default radius
        });
      }
    }

    // Handle any remaining ungrouped buildings
    const ungrouped = this.buildingPositions.filter(b => !usedBuildings.has(b));
    if (ungrouped.length > 0) {
      // Try to add them to nearest existing neighborhood
      for (const building of ungrouped) {
        let nearest = null;
        let minDist = Infinity;

        for (const hood of neighborhoods) {
          const dist = Math.sqrt(
            Math.pow(building.x - hood.center.x, 2) + Math.pow(building.z - hood.center.z, 2)
          );
          if (dist < minDist && dist < neighborhoodRadius * 2) {
            minDist = dist;
            nearest = hood;
          }
        }

        if (nearest) {
          nearest.buildings.push(building);
          // Recalculate center
          nearest.center.x =
            nearest.buildings.reduce((sum, b) => sum + b.x, 0) / nearest.buildings.length;
          nearest.center.z =
            nearest.buildings.reduce((sum, b) => sum + b.z, 0) / nearest.buildings.length;
        }
      }
    }

    // Calculate proper radius for each neighborhood
    neighborhoods.forEach(hood => {
      let maxDist = 50; // Minimum radius
      hood.buildings.forEach(building => {
        const dist = Math.sqrt(
          Math.pow(building.x - hood.center.x, 2) + Math.pow(building.z - hood.center.z, 2)
        );
        // Account for building size
        const buildingRadius =
          Math.sqrt(building.width * building.width + building.depth * building.depth) / 2;
        maxDist = Math.max(maxDist, dist + buildingRadius + 20); // 20m clearance
      });
      hood.radius = Math.min(maxDist, 150); // Cap at 150
    });

    // Create circular roads around neighborhoods
    neighborhoods.forEach((hood, index) => {
      // All neighborhoods now have at least 3 buildings
      const centerDist = Math.sqrt(hood.center.x * hood.center.x + hood.center.z * hood.center.z);
      if (centerDist < hubRadius + 30) return; // Only skip if too close to hub

      debug.category('Building', 
        `Creating road for neighborhood at (${hood.center.x.toFixed(0)}, ${hood.center.z.toFixed(0)}), dist=${centerDist.toFixed(0)}, buildings=${hood.buildings.length}`
      );

      // PROPER CIRCULAR ROAD using RingGeometry
      const roadRingGeometry = new THREE.RingGeometry(
        hood.radius - roadWidth / 2,
        hood.radius + roadWidth / 2,
        48
      );
      const roadMesh = new THREE.Mesh(roadRingGeometry, roadMaterial);
      roadMesh.rotation.x = -Math.PI / 2; // Rotate to be horizontal
      roadMesh.position.set(hood.center.x, roadHeight, hood.center.z);
      this.roads.add(roadMesh);

      // Connect neighborhood to center hub - prioritize inner ring connections
      const isInnerRing = centerDist < 500;

      if (isInnerRing) {
        // Inner ring ALWAYS connects to hub
        const angleToCenter = Math.atan2(hood.center.z - centerZ, hood.center.x - centerX);

        // Start point on neighborhood circle
        const startX = hood.center.x - Math.cos(angleToCenter) * hood.radius;
        const startZ = hood.center.z - Math.sin(angleToCenter) * hood.radius;

        // End point on hub circle
        const endX = centerX + Math.cos(angleToCenter) * hubRadius;
        const endZ = centerZ + Math.sin(angleToCenter) * hubRadius;

        // Direct connection for inner ring using flat road
        const connectionMesh = this.createFlatRoad(
          new THREE.Vector3(startX, 0, startZ),
          new THREE.Vector3(endX, 0, endZ),
          roadWidth,
          0.2,
          roadMaterial
        );

        this.roads.add(connectionMesh);
        debug.category('Building', `Connected inner neighborhood to hub`);
      }

      // CITIZEN ROADS: Connect each building in the neighborhood to the circular road
      hood.buildings.forEach(building => {
        // Find closest point on circle to building
        const buildingAngle = Math.atan2(building.z - hood.center.z, building.x - hood.center.x);
        const circleX = hood.center.x + Math.cos(buildingAngle) * hood.radius;
        const circleZ = hood.center.z + Math.sin(buildingAngle) * hood.radius;

        // Create small driveway from building to circular road
        const drivewayMesh = this.createFlatRoad(
          new THREE.Vector3(building.x, 0, building.z),
          new THREE.Vector3(circleX, 0, circleZ),
          6, // Narrower than main roads
          0.15,
          roadMaterial
        );

        this.roads.add(drivewayMesh);
      });
    });

    // NEIGHBORHOOD CONNECTIONS: Connect within rings for clean layout
    const connectedPairs = new Set<string>();

    // Group neighborhoods by ring distance - matching our district placement
    const innerRing = neighborhoods.filter(h => {
      const dist = Math.sqrt(h.center.x * h.center.x + h.center.z * h.center.z);
      return dist < 500; // Between hub and ring 1 (350m)
    });
    const middleRing = neighborhoods.filter(h => {
      const dist = Math.sqrt(h.center.x * h.center.x + h.center.z * h.center.z);
      return dist >= 500 && dist < 775; // Between ring 1 and 2
    });
    const outerRing = neighborhoods.filter(h => {
      const dist = Math.sqrt(h.center.x * h.center.x + h.center.z * h.center.z);
      return dist >= 775; // Ring 3 (900m)
    });

    // Debug: log ring sizes
    debug.category('Building',
      `Ring distribution: Inner=${innerRing.length}, Middle=${middleRing.length}, Outer=${outerRing.length}`
    );

    // Connect neighborhoods within same ring - only to immediate neighbors
    [innerRing, middleRing, outerRing].forEach((ring, ringIndex) => {
      const ringNames = ['Inner', 'Middle', 'Outer'];
      debug.category('Building', `Processing ${ringNames[ringIndex]} ring with ${ring.length} neighborhoods`);

      if (ring.length === 0) {
        debug.category('Building', `Ring ${ringIndex} is empty!`);
        return;
      }

      if (ring.length === 1) {
        debug.category('Building', `Ring ${ringIndex} has only 1 neighborhood, skipping connections`);
        return;
      }

      // Sort ring by angle from center for proper adjacency
      const sortedRing = ring
        .map(hood => ({
          hood,
          angle: Math.atan2(hood.center.z, hood.center.x),
        }))
        .sort((a, b) => a.angle - b.angle);

      debug.category('Building',
        `Sorted ${ringNames[ringIndex]} ring angles:`,
        sortedRing.map(s => ((s.angle * 180) / Math.PI).toFixed(0))
      );

      // Connect each neighborhood to its adjacent neighbors only
      sortedRing.forEach((current, index) => {
        // Connect to next neighbor in the ring (wrapping around)
        const next = sortedRing[(index + 1) % sortedRing.length];

        const dist = Math.sqrt(
          Math.pow(current.hood.center.x - next.hood.center.x, 2) +
            Math.pow(current.hood.center.z - next.hood.center.z, 2)
        );

        debug.category('Building',
          `${ringNames[ringIndex]} ring: Checking connection ${index} -> ${(index + 1) % sortedRing.length}, dist=${dist.toFixed(0)}`
        );

        // Adjust distance threshold based on ring size
        const distThreshold = ringIndex === 0 ? 400 : ringIndex === 1 ? 500 : 600;

        // Only connect if they're reasonably close (not on opposite sides)
        if (dist < distThreshold) {
          debug.category('Building', `  -> Connecting!`);
          // Calculate connection points on both circles
          const angle = Math.atan2(
            next.hood.center.z - current.hood.center.z,
            next.hood.center.x - current.hood.center.x
          );

          const startX = current.hood.center.x + Math.cos(angle) * current.hood.radius;
          const startZ = current.hood.center.z + Math.sin(angle) * current.hood.radius;
          const endX = next.hood.center.x - Math.cos(angle) * next.hood.radius;
          const endZ = next.hood.center.z - Math.sin(angle) * next.hood.radius;

          // Create straight connection between neighborhoods using flat road
          const interHoodMesh = this.createFlatRoad(
            new THREE.Vector3(startX, 0, startZ),
            new THREE.Vector3(endX, 0, endZ),
            roadWidth,
            0.2,
            roadMaterial
          );

          this.roads.add(interHoodMesh);
          debug.category('Building', `  -> Road created!`);
        } else {
          debug.category('Building', `  -> Too far apart (${dist.toFixed(0)} > ${distThreshold})`);
        }
      });
    });

    // INTER-RING CONNECTIONS: Connect rings to each other
    debug.category('Building', 'Creating inter-ring connections...');

    // Connect inner ring to middle ring
    innerRing.forEach(innerHood => {
      // Find closest neighborhood in middle ring
      let closest = null;
      let minDist = Infinity;

      middleRing.forEach(middleHood => {
        const dist = Math.sqrt(
          Math.pow(innerHood.center.x - middleHood.center.x, 2) +
            Math.pow(innerHood.center.z - middleHood.center.z, 2)
        );
        if (dist < minDist) {
          minDist = dist;
          closest = middleHood;
        }
      });

      if (closest && minDist < 400) {
        // Reasonable distance for inter-ring
        const angle = Math.atan2(
          closest.center.z - innerHood.center.z,
          closest.center.x - innerHood.center.x
        );

        const startX = innerHood.center.x + Math.cos(angle) * innerHood.radius;
        const startZ = innerHood.center.z + Math.sin(angle) * innerHood.radius;
        const endX = closest.center.x - Math.cos(angle) * closest.radius;
        const endZ = closest.center.z - Math.sin(angle) * closest.radius;

        const interRingLength = Math.sqrt((endX - startX) ** 2 + (endZ - startZ) ** 2);
        const interRingMesh = this.createFlatRoad(
          new THREE.Vector3(startX, 0, startZ),
          new THREE.Vector3(endX, 0, endZ),
          roadWidth,
          0.2,
          roadMaterial
        );

        this.roads.add(interRingMesh);
        debug.category('Building', `Connected inner->middle: dist=${minDist.toFixed(0)}`);
      }
    });

    // Connect middle ring to outer ring
    middleRing.forEach(middleHood => {
      // Find closest neighborhood in outer ring
      let closest = null;
      let minDist = Infinity;

      outerRing.forEach(outerHood => {
        const dist = Math.sqrt(
          Math.pow(middleHood.center.x - outerHood.center.x, 2) +
            Math.pow(middleHood.center.z - outerHood.center.z, 2)
        );
        if (dist < minDist) {
          minDist = dist;
          closest = outerHood;
        }
      });

      if (closest && minDist < 400) {
        // Reasonable distance for inter-ring
        const angle = Math.atan2(
          closest.center.z - middleHood.center.z,
          closest.center.x - middleHood.center.x
        );

        const startX = middleHood.center.x + Math.cos(angle) * middleHood.radius;
        const startZ = middleHood.center.z + Math.sin(angle) * middleHood.radius;
        const endX = closest.center.x - Math.cos(angle) * closest.radius;
        const endZ = closest.center.z - Math.sin(angle) * closest.radius;

        const interRingLength = Math.sqrt((endX - startX) ** 2 + (endZ - startZ) ** 2);
        const interRingMesh = this.createFlatRoad(
          new THREE.Vector3(startX, 0, startZ),
          new THREE.Vector3(endX, 0, endZ),
          roadWidth,
          0.2,
          roadMaterial
        );

        this.roads.add(interRingMesh);
        debug.category('Building', `Connected middle->outer: dist=${minDist.toFixed(0)}`);
      }
    });

    // Store actual neighborhoods for street light placement
    this.neighborhoods = neighborhoods;
  }

  private createStreetLights(centerX: number, centerZ: number, radius: number): void {
    // CIRCULAR STREET LIGHTS: Place along our circular roads

    // Lights around central hub
    const hubRadius = 100;
    const hubLights = 16; // More lights for the hub
    for (let i = 0; i < hubLights; i++) {
      const angle = (i / hubLights) * Math.PI * 2;
      const x = centerX + Math.cos(angle) * (hubRadius + 10);
      const z = centerZ + Math.sin(angle) * (hubRadius + 10);
      this.createStreetLight(x, z);
    }

    // Use the actual neighborhoods we created for roads
    this.neighborhoods.forEach(hood => {
      // Skip neighborhoods too close to hub (they're handled above)
      const centerDist = Math.sqrt(hood.center.x * hood.center.x + hood.center.z * hood.center.z);
      if (centerDist < hubRadius + 30) return;

      // More lights for larger neighborhoods
      const lightsPerHood = Math.max(8, Math.floor(hood.radius / 20));
      for (let i = 0; i < lightsPerHood; i++) {
        const angle = (i / lightsPerHood) * Math.PI * 2;
        const x = hood.center.x + Math.cos(angle) * (hood.radius + 5);
        const z = hood.center.z + Math.sin(angle) * (hood.radius + 5);
        this.createStreetLight(x, z);
      }
    });

    // INTERCONNECT LIGHTS: Add bigger lights on major road connections
    // Place lights on radial roads from hub to inner ring
    const innerRing = this.neighborhoods.filter(h => {
      const dist = Math.sqrt(h.center.x * h.center.x + h.center.z * h.center.z);
      return dist < 500 && dist > hubRadius + 30;
    });

    innerRing.forEach(hood => {
      const angleToCenter = Math.atan2(hood.center.z - centerZ, hood.center.x - centerX);

      // Place 2-3 lights along the radial road
      for (let i = 1; i <= 2; i++) {
        const t = i / 3; // Position along the road
        const x = centerX + Math.cos(angleToCenter) * (hubRadius + (hood.radius + 100) * t);
        const z = centerZ + Math.sin(angleToCenter) * (hubRadius + (hood.radius + 100) * t);
        this.createStreetLight(x, z, true); // true = bigger light
      }
    });
  }

  private createStreetLight(x: number, z: number, isMajorLight: boolean = false): void {
    // Use the instance manager to create street lights
    if (this.streetLightManager) {
      this.streetLightManager.createStreetLight(x, z, isMajorLight);
    }
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
    const offset = new THREE.Vector3((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 20, 5);
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

    // CHAINSAW: Simple explosion effect - just remove the building mesh
    if (building.mesh.parent) {
      building.mesh.removeFromParent();
    }

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
      if (this.unlitWindowMesh.material)
        (this.unlitWindowMesh.material as THREE.Material).dispose();
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
      drawCalls: this.buildings.size + 2, // Buildings + lit windows + unlit windows
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

  // CHAINSAW OPTIMIZED: Time-sliced lighting updates every 10 seconds (but force on manual time changes)
  updateTimeOfDay(hours: number, forceUpdate: boolean = false): void {
    // Use instanced renderer if available
    if (this.useInstancedBuildings && this.instancedRenderer) {
      this.instancedRenderer.updateWindowLighting(hours);
      this.updateStreetLights(hours);
      return;
    }

    // Legacy lighting update
    const now = Date.now();
    const currentHour = Math.floor(hours);

    // Skip if too soon unless forced or hour changed significantly
    const timeDifference = Math.abs(currentHour - this.lastUpdateHour);
    const shouldUpdate =
      forceUpdate ||
      this.lastUpdateHour === -1 ||
      timeDifference > 1 ||
      now - this.lastLightingUpdate > 10000;

    if (!shouldUpdate) return;

    this.lastUpdateHour = currentHour;
    this.lastLightingUpdate = now;

    // Update street lights
    this.updateStreetLights(hours);

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
      debug.category('Building', 'First state lit check:', sampleStates[0]?.lit, typeof sampleStates[0]?.lit);
    }
    const targetLitCount = Math.floor(totalWindows * targetLitPercentage);
    const difference = targetLitCount - currentLitCount;

    // Debug window state distribution on first update
    if (this.lastUpdateHour === -1) {
      const litWithIndex = windowStatesArray.filter(s => s.lit && s.litIndex !== undefined).length;
      const unlitWithIndex = windowStatesArray.filter(
        s => !s.lit && s.unlitIndex !== undefined
      ).length;
      debug.category('Building', `Initial window state distribution:
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
        debug.error('No lit windows found to turn off! Window states might be corrupted.');
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

  private updateStreetLights(hours: number): void {
    const isDark = hours < 6 || hours >= 18; // Street lights on 6 PM - 6 AM

    if (!this.streetLightManager) return;

    // First, remove all existing point lights from street lights
    this.streetLightManager.getStreetLights().forEach((instance, id) => {
      this.streetLightManager!.removePointLight(id);
    });

    // Update street light appearance based on time
    this.streetLightManager.updateTimeOfDay(isDark);

    // SMART LIGHTING: Only add a FEW key intersection lights when dark
    if (isDark) {
      const keyLightPositions = [
        { x: 0, z: 0 }, // Main intersection
        { x: -400, z: -400 },
        { x: 400, z: -400 },
        { x: -400, z: 400 },
        { x: 400, z: 400 },
        { x: 0, z: -400 },
        { x: 0, z: 400 },
        { x: -400, z: 0 },
        { x: 400, z: 0 },
      ];

      // Find the closest street lights to these positions and add point lights
      const streetLights = Array.from(this.streetLightManager.getStreetLights().entries());
      let addedLights = 0;

      keyLightPositions.forEach(targetPos => {
        if (addedLights >= 8) return; // Maximum 8 lights

        // Find closest street light to this position
        let closestId = '';
        let closestDist = Infinity;

        streetLights.forEach(([id, instance]) => {
          const dist = Math.sqrt(
            Math.pow(instance.position.x - targetPos.x, 2) +
              Math.pow(instance.position.z - targetPos.z, 2)
          );
          if (dist < closestDist && !instance.bulbLight) {
            closestDist = dist;
            closestId = id;
          }
        });

        // Add point light to closest street light
        if (closestId && closestDist < 100) {
          this.streetLightManager.addPointLight(closestId);
          addedLights++;
        }
      });
    }
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
        console.log(
          `Switched window ${windowKey} to ${toLit ? 'lit' : 'unlit'} (${this.switchCount} total)`
        );
      }

      return true;
    }

    // Pool exhausted - log once and stop trying
    if (!this.poolExhaustedWarned) {
      this.poolExhaustedWarned = true;
      console.warn(`Window pool exhausted! Total windows: ${this.windowCount}, max per mesh: ${this.maxWindowsPerMesh}`);
      console.warn(`Lit pool: ${this.litWindowPool.length}, Unlit pool: ${this.unlitWindowPool.length}`);
      console.warn(`This usually means more windows were created than the pool size allows.`);
    }
    return false;
  }

  /**
   * Get all buildings for collision detection
   */
  getBuildings(): BuildingInfo[] {
    return this.buildingInfos;
  }

  /**
   * Merge all static city geometry to reduce draw calls
   */
  mergeStaticGeometry(): void {
    console.log('🔥 MERGING CITY GEOMETRY FOR PERFORMANCE!');

    // IMPORTANT: Do NOT merge buildings as it breaks window instancing
    // Buildings need to maintain their identity for window positioning
    // ALSO: Do NOT merge street lights as it breaks their visibility

    // Update all world matrices first
    this.roads.updateMatrixWorld(true);

    // Collect all road meshes
    const roadMeshes: THREE.Mesh[] = [];
    this.roads.children.forEach(child => {
      if (child instanceof THREE.Mesh) {
        roadMeshes.push(child);
      }
    });

    debug.category('Building', `Merging: ${roadMeshes.length} roads`);
    debug.category('Building',
      `Keeping separate: ${this.buildings.length} buildings (for windows), all street lights (for visibility)`
    );

    // Perform merge on roads only
    const mergedRoads =
      roadMeshes.length > 0 ? StaticGeometryMerger.mergeGeometries(roadMeshes) : null;

    // Replace road meshes with merged version
    if (mergedRoads) {
      // Clear all road meshes
      this.roads.clear();

      // Add merged road mesh
      this.roads.add(mergedRoads);
      this.mergedStaticGeometry.roads = mergedRoads;
      debug.category('Building', `✅ Roads merged: ${roadMeshes.length} meshes → 1 draw call`);
    }

    const stats = this.getStats();
    const streetLightCount = this.streetLightManager
      ? this.streetLightManager.getStreetLightCount()
      : 0;
    // Street lights now use 6 instanced meshes (3 components x 2 types)
    const totalDrawCalls = stats.buildingCount + 1 + 6 + 2; // buildings + roads + street light instances + windows
    debug.category('Building', `🏆 CITY OPTIMIZATION COMPLETE!`);
    debug.category('Building', `   Buildings: ${stats.buildingCount} (preserved for windows)`);
    debug.category('Building', `   Roads: 1 merged mesh`);
    debug.category('Building', `   Street lights: ${streetLightCount} lights using 6 instanced meshes`);
    debug.category('Building', `   Windows: 2 instanced meshes`);
    debug.category('Building', `   Estimated total: ~${totalDrawCalls} draw calls`);
  }
}
