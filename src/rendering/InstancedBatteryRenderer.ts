import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { IBattery } from '../entities/IBattery';
import { IronDomeBattery } from '../entities/IronDomeBattery';
import { LaserBattery } from '../entities/LaserBattery';
import { BatteryType } from '../config/BatteryTypes';
import { debug } from '../utils/logger';
import { GeometryOptimizer } from '../utils/GeometryOptimizer';
import { ModelManager } from '../utils/ModelManager';
import { MODEL_IDS } from '../config/ModelRegistry';

interface BatteryInstance {
  battery: IBattery;
  level: number;
  type: BatteryType;
}

export class InstancedBatteryRenderer {
  private scene: THREE.Scene;
  private maxBatteries: number;

  // Instanced meshes for each battery type
  private ironDomeInstancedMesh?: THREE.InstancedMesh;
  private laserCannonInstancedMeshes: THREE.InstancedMesh[] = []; // Multiple meshes for different materials
  private laserFiringEffectMesh?: THREE.InstancedMesh; // Separate mesh for Cube_2 firing effect
  
  // Instanced meshes for launcher tubes (Iron Dome only)
  private launcherTubesMesh?: THREE.InstancedMesh;

  // Temporary object for matrix calculations
  private dummy = new THREE.Object3D();

  // Track active instances per type
  private ironDomeActiveCount = 0;
  private laserActiveCount = 0;

  // Track firing states for laser batteries
  private laserFiringStates: Map<string, boolean> = new Map();
  
  // Store laser cannon offset for position correction
  private laserCannonOffset: THREE.Vector3 = new THREE.Vector3();

  // Loading state
  private isLoaded = false;
  private loadPromise: Promise<void>;

  constructor(scene: THREE.Scene, maxBatteries: number = 50) {
    this.scene = scene;
    this.maxBatteries = maxBatteries;

    // Load all battery models
    this.loadPromise = this.loadBatteryModels();
  }

  private async loadBatteryModels(): Promise<void> {
    try {
      const modelManager = ModelManager.getInstance();
      
      // Load Iron Dome model
      await this.loadIronDomeModel(modelManager);
      
      // Load Laser Cannon model
      await this.loadLaserCannonModel(modelManager);

      this.isLoaded = true;
      debug.log('All battery models loaded for instanced rendering');
    } catch (error) {
      debug.error('Failed to load battery models for instanced rendering:', error);
    }
  }

  private async loadIronDomeModel(modelManager: ModelManager): Promise<void> {
    const loadedModel = await modelManager.loadModel(MODEL_IDS.BATTERY);

    // Analyze model complexity before optimization
    const beforeStats = GeometryOptimizer.analyzeComplexity(loadedModel.scene);
    debug.log('Iron Dome model complexity BEFORE optimization:', beforeStats);

    // Optimize the model but preserve important details
    GeometryOptimizer.optimizeObject(loadedModel.scene, {
      simplify: false, // Disable simplification to keep all geometry
      simplifyRatio: 1.0, // Keep 100% of triangles
      mergeByMaterial: true, // Still merge by material for performance
      removeSmallDetails: false, // Don't remove any details
      smallDetailThreshold: 0.1, // Very small threshold
    });

    const afterStats = GeometryOptimizer.analyzeComplexity(loadedModel.scene);
    debug.log('Iron Dome model complexity AFTER optimization:', afterStats);

    // Merge all geometries
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];

    // Only collect geometries from visible parts
    loadedModel.scene.traverse(child => {
      if (child instanceof THREE.Mesh && child.geometry && child.visible) {
        debug.log(`Adding visible Iron Dome mesh: ${child.name || 'unnamed'}`);
        const geometry = child.geometry.clone();
        geometry.applyMatrix4(child.matrixWorld);
        geometries.push(geometry);
        
        if (!materials.includes(child.material as THREE.Material)) {
          materials.push(child.material as THREE.Material);
        }
      }
    });

    debug.log(`Iron Dome: Collected ${geometries.length} visible geometries`);
    
    if (geometries.length > 0) {
      const mergedGeometry = BufferGeometryUtils.mergeGeometries(geometries);
      
      // Calculate proper scale and position
      const box = new THREE.Box3().setFromBufferAttribute(
        mergedGeometry.attributes.position as THREE.BufferAttribute
      );
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());

      // Scale to appropriate size (matching original dome size)
      const targetHeight = 22.5; // Match the original
      const scaleFactor = targetHeight / size.y;
      mergedGeometry.scale(scaleFactor, scaleFactor, scaleFactor);

      // Center at origin and place on ground
      mergedGeometry.translate(
        -center.x * scaleFactor,
        -box.min.y * scaleFactor,
        -center.z * scaleFactor
      );
      
      // Create material matching the original battery
      const material = new THREE.MeshStandardMaterial({
        color: 0xbbbbbb,
        roughness: 0.7,
        metalness: 0.5,
      });
      
      this.ironDomeInstancedMesh = new THREE.InstancedMesh(
        mergedGeometry,
        material,
        this.maxBatteries
      );

      // Set all instances to invisible initially
      const matrix = new THREE.Matrix4();
      matrix.scale(new THREE.Vector3(0, 0, 0));
      
      for (let i = 0; i < this.maxBatteries; i++) {
        this.ironDomeInstancedMesh.setMatrixAt(i, matrix);
      }

      this.ironDomeInstancedMesh.instanceMatrix.needsUpdate = true;
      this.ironDomeInstancedMesh.frustumCulled = false;
      this.ironDomeInstancedMesh.castShadow = true;
      this.ironDomeInstancedMesh.receiveShadow = true;
      // Initialize instance colors to default
      const colors = new Float32Array(this.maxBatteries * 3);
      for (let i = 0; i < this.maxBatteries; i++) {
        colors[i * 3] = 0x6a / 255;
        colors[i * 3 + 1] = 0x6a / 255;
        colors[i * 3 + 2] = 0x6a / 255;
      }
      this.ironDomeInstancedMesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
      
      this.ironDomeInstancedMesh.count = this.maxBatteries; // Show all instances, visibility controlled by scale

      this.scene.add(this.ironDomeInstancedMesh);
      debug.log('Iron Dome instanced mesh added to scene');
    }

    // Create launcher tubes mesh
    const tubeGeometry = new THREE.CylinderGeometry(0.15, 0.15, 3, 8);
    const tubeMaterial = new THREE.MeshStandardMaterial({
      color: 0x333333,
      metalness: 0.8,
      roughness: 0.2,
    });

    const maxTubes = this.maxBatteries * 20;
    this.launcherTubesMesh = new THREE.InstancedMesh(tubeGeometry, tubeMaterial, maxTubes);
    this.launcherTubesMesh.instanceMatrix.needsUpdate = true;
    this.launcherTubesMesh.frustumCulled = false;
    this.launcherTubesMesh.visible = false;
    this.scene.add(this.launcherTubesMesh);
  }

  private async loadLaserCannonModel(modelManager: ModelManager): Promise<void> {
    const loadedModel = await modelManager.loadModel(MODEL_IDS.LASER_CANNON);

    // Hide permanent parts BEFORE scaling
    const cylinder = loadedModel.scene.getObjectByName('Cylinder007_0');
    if (cylinder) {
      cylinder.visible = false;
    }

    // Find Cube_2 for separate handling
    const cube2 = loadedModel.scene.getObjectByName('Cube_2');
    let cube2Geometry: THREE.BufferGeometry | null = null;
    let cube2Material: THREE.Material | null = null;

    // Calculate bounds before scaling to find center offset
    const box = new THREE.Box3().setFromObject(loadedModel.scene);
    const center = box.getCenter(new THREE.Vector3());
    
    // Store the offset for laser firing position calculation
    this.laserCannonOffset = new THREE.Vector3(-center.x * 10, -box.min.y * 10, -center.z * 10);
    
    // Scale the model
    loadedModel.scene.scale.setScalar(10);
    
    // Apply centering offset after scaling
    loadedModel.scene.position.x = -center.x * 10;
    loadedModel.scene.position.z = -center.z * 10;
    loadedModel.scene.position.y = -box.min.y * 10; // Place on ground
    
    loadedModel.scene.updateMatrixWorld(true);

    // Group geometries by material to preserve material assignments
    const materialGroups = new Map<THREE.Material, THREE.BufferGeometry[]>();

    loadedModel.scene.traverse(child => {
      if (child instanceof THREE.Mesh && child.geometry && child.visible) {
        // Handle Cube_2 separately
        if (child.name === 'Cube_2') {
          cube2Geometry = child.geometry.clone();
          cube2Geometry.applyMatrix4(child.matrixWorld);
          cube2Material = child.material as THREE.Material;
          return; // Don't add to regular mesh groups
        }
        
        const geometry = child.geometry.clone();
        geometry.applyMatrix4(child.matrixWorld);
        
        const material = child.material as THREE.Material;
        if (!materialGroups.has(material)) {
          materialGroups.set(material, []);
        }
        materialGroups.get(material)!.push(geometry);
      }
    });
    
    debug.log(`Laser Cannon: Found ${materialGroups.size} unique materials`);

    // Create a separate instanced mesh for each material
    materialGroups.forEach((geometries, material) => {
      if (geometries.length > 0) {
        const mergedGeometry = BufferGeometryUtils.mergeGeometries(geometries);
        
        // Clone the material to avoid modifying the original
        const instanceMaterial = material.clone();
        
        const instancedMesh = new THREE.InstancedMesh(
          mergedGeometry,
          instanceMaterial,
          this.maxBatteries
        );

        // Set all instances to invisible initially
        const matrix = new THREE.Matrix4();
        matrix.scale(new THREE.Vector3(0, 0, 0));
        
        for (let i = 0; i < this.maxBatteries; i++) {
          instancedMesh.setMatrixAt(i, matrix);
        }

        instancedMesh.instanceMatrix.needsUpdate = true;
        instancedMesh.frustumCulled = false;
        instancedMesh.castShadow = true;
        instancedMesh.receiveShadow = true;
        instancedMesh.count = this.maxBatteries;

        this.scene.add(instancedMesh);
        this.laserCannonInstancedMeshes.push(instancedMesh);
      }
    });
    
    // Create separate instanced mesh for Cube_2 firing effect
    if (cube2Geometry && cube2Material) {
      this.laserFiringEffectMesh = new THREE.InstancedMesh(
        cube2Geometry,
        cube2Material.clone(),
        this.maxBatteries
      );
      
      // Set all instances to invisible initially
      const matrix = new THREE.Matrix4();
      matrix.scale(new THREE.Vector3(0, 0, 0));
      
      for (let i = 0; i < this.maxBatteries; i++) {
        this.laserFiringEffectMesh.setMatrixAt(i, matrix);
      }
      
      this.laserFiringEffectMesh.instanceMatrix.needsUpdate = true;
      this.laserFiringEffectMesh.frustumCulled = false;
      this.laserFiringEffectMesh.castShadow = true;
      this.laserFiringEffectMesh.receiveShadow = true;
      this.laserFiringEffectMesh.count = this.maxBatteries;
      
      this.scene.add(this.laserFiringEffectMesh);
      debug.log('Laser Cannon: Created separate instanced mesh for Cube_2 firing effect');
    }
    
    debug.log(`Laser Cannon: Created ${this.laserCannonInstancedMeshes.length} instanced meshes for different materials`);
  }

  async waitForLoad(): Promise<void> {
    await this.loadPromise;
  }

  updateBatteries(batteries: Map<string, BatteryInstance>): void {
    if (!this.isLoaded) {
      debug.warn('InstancedBatteryRenderer: Models not loaded yet');
      return;
    }

    debug.log(`InstancedBatteryRenderer: Updating ${batteries.size} batteries`);

    // Reset counts
    this.ironDomeActiveCount = 0;
    this.laserActiveCount = 0;

    // Hide all instances first
    const hideMatrix = new THREE.Matrix4();
    hideMatrix.scale(new THREE.Vector3(0, 0, 0));

    // Process each battery
    batteries.forEach((batteryData, id) => {
      const { battery, type } = batteryData;
      
      if (type === BatteryType.IRON_DOME && battery instanceof IronDomeBattery) {
        this.updateIronDomeBattery(battery, this.ironDomeActiveCount);
        this.ironDomeActiveCount++;
      } else if (type === BatteryType.LASER && battery instanceof LaserBattery) {
        this.updateLaserBattery(battery as LaserBattery, this.laserActiveCount, id);
        this.laserActiveCount++;
      }
    });

    // Hide unused Iron Dome instances
    if (this.ironDomeInstancedMesh) {
      for (let i = this.ironDomeActiveCount; i < this.maxBatteries; i++) {
        this.ironDomeInstancedMesh.setMatrixAt(i, hideMatrix);
      }
      this.ironDomeInstancedMesh.instanceMatrix.needsUpdate = true;
      // Update count for culling
      this.ironDomeInstancedMesh.count = this.ironDomeActiveCount;
      
      if (this.ironDomeInstancedMesh.instanceColor) {
        this.ironDomeInstancedMesh.instanceColor.needsUpdate = true;
      }
      
      // Log for debugging
      if (this.ironDomeActiveCount > 0) {
        debug.log(`InstancedBatteryRenderer: Rendering ${this.ironDomeActiveCount} Iron Dome batteries`);
      }
    }

    // Hide unused Laser instances for all material groups
    this.laserCannonInstancedMeshes.forEach(mesh => {
      for (let i = this.laserActiveCount; i < this.maxBatteries; i++) {
        mesh.setMatrixAt(i, hideMatrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.count = this.laserActiveCount;
    });
    
    // Hide unused laser firing effects
    if (this.laserFiringEffectMesh) {
      for (let i = this.laserActiveCount; i < this.maxBatteries; i++) {
        this.laserFiringEffectMesh.setMatrixAt(i, hideMatrix);
      }
      this.laserFiringEffectMesh.instanceMatrix.needsUpdate = true;
      this.laserFiringEffectMesh.count = this.laserActiveCount;
    }
    
    if (this.laserActiveCount > 0) {
      debug.log(`InstancedBatteryRenderer: Rendering ${this.laserActiveCount} Laser Cannon batteries`);
    }
  }

  private updateIronDomeBattery(battery: IronDomeBattery, index: number): void {
    if (!this.ironDomeInstancedMesh || index >= this.maxBatteries) return;

    const position = battery.getPosition();
    const rotation = battery.getRotation ? battery.getRotation() : 0;

    this.dummy.position.copy(position);
    this.dummy.rotation.y = rotation;
    this.dummy.scale.set(1, 1, 1);
    this.dummy.updateMatrix();

    this.ironDomeInstancedMesh.setMatrixAt(index, this.dummy.matrix);
    
    // Update color based on battery health
    const health = battery.getHealth();
    const healthPercent = health.current / health.max;

    if (healthPercent < 0.3) {
      this.ironDomeInstancedMesh.setColorAt(index, new THREE.Color(0xff0000));
    } else if (healthPercent < 0.6) {
      this.ironDomeInstancedMesh.setColorAt(index, new THREE.Color(0xff8800));
    } else {
      this.ironDomeInstancedMesh.setColorAt(index, new THREE.Color(0x6a6a6a)); // Original darker color
    }
    
    debug.log(`Updated Iron Dome battery ${index} at position ${position.x}, ${position.y}, ${position.z}`);

    // Update launcher tubes if needed
    // ... (existing launcher tube logic)
  }

  private updateLaserBattery(battery: LaserBattery, index: number, batteryId: string): void {
    if (this.laserCannonInstancedMeshes.length === 0 || index >= this.maxBatteries) return;

    const position = battery.getPosition();
    
    this.dummy.position.copy(position);
    this.dummy.rotation.y = 0; // Laser batteries might have rotation tracking
    this.dummy.scale.set(1, 1, 1);
    this.dummy.updateMatrix();

    // Update all material groups with the same transform
    this.laserCannonInstancedMeshes.forEach(mesh => {
      mesh.setMatrixAt(index, this.dummy.matrix);
    });
    
    // Update firing effect visibility
    if (this.laserFiringEffectMesh) {
      const isFiring = battery.isFiring();
      const wasFiring = this.laserFiringStates.get(batteryId) || false;
      
      if (isFiring !== wasFiring) {
        this.laserFiringStates.set(batteryId, isFiring);
        
        if (isFiring) {
          // Show firing effect
          this.laserFiringEffectMesh.setMatrixAt(index, this.dummy.matrix);
        } else {
          // Hide firing effect
          const hideMatrix = new THREE.Matrix4();
          hideMatrix.scale(new THREE.Vector3(0, 0, 0));
          this.laserFiringEffectMesh.setMatrixAt(index, hideMatrix);
        }
        
        this.laserFiringEffectMesh.instanceMatrix.needsUpdate = true;
        debug.log(`Laser battery ${index} firing state changed to: ${isFiring}`);
      }
    }
    
    debug.log(`Updated Laser battery ${index} at position ${position.x}, ${position.y}, ${position.z}`);
  }

  getLaserCannonOffset(): THREE.Vector3 {
    return this.laserCannonOffset.clone();
  }

  dispose(): void {
    if (this.ironDomeInstancedMesh) {
      this.ironDomeInstancedMesh.geometry.dispose();
      if (Array.isArray(this.ironDomeInstancedMesh.material)) {
        this.ironDomeInstancedMesh.material.forEach(m => m.dispose());
      } else {
        this.ironDomeInstancedMesh.material.dispose();
      }
      this.scene.remove(this.ironDomeInstancedMesh);
    }

    // Dispose all laser cannon meshes
    this.laserCannonInstancedMeshes.forEach(mesh => {
      mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach(m => m.dispose());
      } else {
        mesh.material.dispose();
      }
      this.scene.remove(mesh);
    });
    this.laserCannonInstancedMeshes = [];
    
    // Dispose laser firing effect mesh
    if (this.laserFiringEffectMesh) {
      this.laserFiringEffectMesh.geometry.dispose();
      if (Array.isArray(this.laserFiringEffectMesh.material)) {
        this.laserFiringEffectMesh.material.forEach(m => m.dispose());
      } else {
        this.laserFiringEffectMesh.material.dispose();
      }
      this.scene.remove(this.laserFiringEffectMesh);
    }

    if (this.launcherTubesMesh) {
      this.launcherTubesMesh.geometry.dispose();
      if (Array.isArray(this.launcherTubesMesh.material)) {
        this.launcherTubesMesh.material.forEach(m => m.dispose());
      } else {
        this.launcherTubesMesh.material.dispose();
      }
      this.scene.remove(this.launcherTubesMesh);
    }
  }
}