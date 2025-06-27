import * as THREE from 'three';
import { MaterialCache } from '../utils/MaterialCache';
import { GeometryFactory } from '../utils/GeometryFactory';
import { debug } from '../utils/logger';

interface StreetLightInstance {
  index: number;
  position: THREE.Vector3;
  isMajor: boolean;
  bulbLight?: THREE.PointLight;
}

export class StreetLightInstanceManager {
  private scene: THREE.Scene;
  
  // Instanced meshes for each component
  private poleInstancedMesh: THREE.InstancedMesh;
  private fixtureInstancedMesh: THREE.InstancedMesh;
  private bulbInstancedMesh: THREE.InstancedMesh;
  
  // Separate meshes for major street lights (bigger size)
  private majorPoleInstancedMesh: THREE.InstancedMesh;
  private majorFixtureInstancedMesh: THREE.InstancedMesh;
  private majorBulbInstancedMesh: THREE.InstancedMesh;
  
  // Instance tracking
  private instances = new Map<string, StreetLightInstance>();
  private availableIndices: number[] = [];
  private availableMajorIndices: number[] = [];
  private nextId = 0;
  
  private static readonly MAX_LIGHTS = 150; // PERFORMANCE: Reduced from 300
  private static readonly MAX_MAJOR_LIGHTS = 50; // PERFORMANCE: Reduced from 100
  
  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.initializeInstancedMeshes();
  }
  
  private initializeInstancedMeshes(): void {
    const materialCache = MaterialCache.getInstance();
    const geometryFactory = GeometryFactory.getInstance();
    
    // Regular street light components
    const poleHeight = 10;
    const poleRadius = 0.3;
    const poleGeometry = geometryFactory.getCylinder(poleRadius, poleRadius * 1.5, poleHeight);
    const poleMaterial = materialCache.getMeshStandardMaterial({
      color: 0x333333,
      metalness: 0.9,
      roughness: 0.1
    });
    
    this.poleInstancedMesh = new THREE.InstancedMesh(
      poleGeometry,
      poleMaterial,
      StreetLightInstanceManager.MAX_LIGHTS
    );
    this.poleInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.poleInstancedMesh.castShadow = true;
    this.poleInstancedMesh.receiveShadow = true;
    
    // Fixture
    const fixtureSize = 1.5;
    const fixtureHeight = 2;
    const fixtureGeometry = geometryFactory.getCone(fixtureSize, fixtureHeight, 8);
    const fixtureMaterial = materialCache.getMeshStandardMaterial({
      color: 0x222222,
      metalness: 0.8,
      roughness: 0.2
    });
    
    this.fixtureInstancedMesh = new THREE.InstancedMesh(
      fixtureGeometry,
      fixtureMaterial,
      StreetLightInstanceManager.MAX_LIGHTS
    );
    this.fixtureInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    
    // Bulb
    const bulbSize = 1;
    const bulbGeometry = geometryFactory.getSphere(bulbSize);
    const bulbMaterial = materialCache.getMeshBasicMaterial({
      color: 0xffffaa,
      transparent: true,
      opacity: 0.9
    });
    
    this.bulbInstancedMesh = new THREE.InstancedMesh(
      bulbGeometry,
      bulbMaterial,
      StreetLightInstanceManager.MAX_LIGHTS
    );
    this.bulbInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    
    // Major street light components (bigger)
    const majorPoleHeight = 15;
    const majorPoleRadius = 0.6;
    const majorPoleGeometry = geometryFactory.getCylinder(majorPoleRadius, majorPoleRadius * 1.5, majorPoleHeight);
    
    this.majorPoleInstancedMesh = new THREE.InstancedMesh(
      majorPoleGeometry,
      poleMaterial,
      StreetLightInstanceManager.MAX_MAJOR_LIGHTS
    );
    this.majorPoleInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.majorPoleInstancedMesh.castShadow = true;
    this.majorPoleInstancedMesh.receiveShadow = true;
    
    // Major fixture
    const majorFixtureSize = 2.5;
    const majorFixtureHeight = 3;
    const majorFixtureGeometry = geometryFactory.getCone(majorFixtureSize, majorFixtureHeight, 8);
    
    this.majorFixtureInstancedMesh = new THREE.InstancedMesh(
      majorFixtureGeometry,
      fixtureMaterial,
      StreetLightInstanceManager.MAX_MAJOR_LIGHTS
    );
    this.majorFixtureInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    
    // Major bulb
    const majorBulbSize = 1.5;
    const majorBulbGeometry = geometryFactory.getSphere(majorBulbSize);
    const majorBulbMaterial = materialCache.getMeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1.0
    });
    
    this.majorBulbInstancedMesh = new THREE.InstancedMesh(
      majorBulbGeometry,
      majorBulbMaterial,
      StreetLightInstanceManager.MAX_MAJOR_LIGHTS
    );
    this.majorBulbInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    
    // Initialize instance pools
    for (let i = 0; i < StreetLightInstanceManager.MAX_LIGHTS; i++) {
      this.availableIndices.push(i);
      this.hideInstance(this.poleInstancedMesh, i);
      this.hideInstance(this.fixtureInstancedMesh, i);
      this.hideInstance(this.bulbInstancedMesh, i);
    }
    
    for (let i = 0; i < StreetLightInstanceManager.MAX_MAJOR_LIGHTS; i++) {
      this.availableMajorIndices.push(i);
      this.hideInstance(this.majorPoleInstancedMesh, i);
      this.hideInstance(this.majorFixtureInstancedMesh, i);
      this.hideInstance(this.majorBulbInstancedMesh, i);
    }
    
    // Add all meshes to scene
    this.scene.add(this.poleInstancedMesh);
    this.scene.add(this.fixtureInstancedMesh);
    this.scene.add(this.bulbInstancedMesh);
    this.scene.add(this.majorPoleInstancedMesh);
    this.scene.add(this.majorFixtureInstancedMesh);
    this.scene.add(this.majorBulbInstancedMesh);
  }
  
  private hideInstance(mesh: THREE.InstancedMesh, index: number): void {
    const matrix = new THREE.Matrix4();
    matrix.scale(new THREE.Vector3(0, 0, 0));
    mesh.setMatrixAt(index, matrix);
    mesh.instanceMatrix.needsUpdate = true;
  }
  
  createStreetLight(x: number, z: number, isMajor: boolean = false): string {
    const id = `streetlight_${this.nextId++}`;
    const position = new THREE.Vector3(x, 0, z);
    
    let index: number;
    if (isMajor) {
      if (this.availableMajorIndices.length === 0) {
        debug.warn('No available major street light instances');
        return '';
      }
      index = this.availableMajorIndices.pop()!;
    } else {
      if (this.availableIndices.length === 0) {
        debug.warn('No available street light instances');
        return '';
      }
      index = this.availableIndices.pop()!;
    }
    
    // Store instance data
    this.instances.set(id, {
      index,
      position,
      isMajor
    });
    
    // Update transforms for all three components
    this.updateStreetLightTransforms(id);
    
    return id;
  }
  
  private updateStreetLightTransforms(id: string): void {
    const instance = this.instances.get(id);
    if (!instance) return;
    
    const { index, position, isMajor } = instance;
    
    if (isMajor) {
      // Major pole
      const poleMatrix = new THREE.Matrix4();
      poleMatrix.makeTranslation(position.x, 7.5 + 0.5, position.z); // 15/2 + 0.5 ground offset
      this.majorPoleInstancedMesh.setMatrixAt(index, poleMatrix);
      this.majorPoleInstancedMesh.instanceMatrix.needsUpdate = true;
      
      // Major fixture (upside down cone)
      const fixtureMatrix = new THREE.Matrix4();
      fixtureMatrix.makeRotationX(Math.PI);
      fixtureMatrix.setPosition(position.x, 16, position.z); // 15 + 1
      this.majorFixtureInstancedMesh.setMatrixAt(index, fixtureMatrix);
      this.majorFixtureInstancedMesh.instanceMatrix.needsUpdate = true;
      
      // Major bulb
      const bulbMatrix = new THREE.Matrix4();
      bulbMatrix.makeTranslation(position.x, 15.5, position.z);
      this.majorBulbInstancedMesh.setMatrixAt(index, bulbMatrix);
      this.majorBulbInstancedMesh.instanceMatrix.needsUpdate = true;
      
      // Update bounding spheres for major meshes
      this.majorPoleInstancedMesh.computeBoundingSphere();
      this.majorFixtureInstancedMesh.computeBoundingSphere();
      this.majorBulbInstancedMesh.computeBoundingSphere();
    } else {
      // Regular pole
      const poleMatrix = new THREE.Matrix4();
      poleMatrix.makeTranslation(position.x, 5 + 0.5, position.z); // 10/2 + 0.5 ground offset
      this.poleInstancedMesh.setMatrixAt(index, poleMatrix);
      this.poleInstancedMesh.instanceMatrix.needsUpdate = true;
      
      // Regular fixture (upside down cone)
      const fixtureMatrix = new THREE.Matrix4();
      fixtureMatrix.makeRotationX(Math.PI);
      fixtureMatrix.setPosition(position.x, 11, position.z); // 10 + 1
      this.fixtureInstancedMesh.setMatrixAt(index, fixtureMatrix);
      this.fixtureInstancedMesh.instanceMatrix.needsUpdate = true;
      
      // Regular bulb
      const bulbMatrix = new THREE.Matrix4();
      bulbMatrix.makeTranslation(position.x, 10.5, position.z);
      this.bulbInstancedMesh.setMatrixAt(index, bulbMatrix);
      this.bulbInstancedMesh.instanceMatrix.needsUpdate = true;
      
      // Update bounding spheres for regular meshes
      this.poleInstancedMesh.computeBoundingSphere();
      this.fixtureInstancedMesh.computeBoundingSphere();
      this.bulbInstancedMesh.computeBoundingSphere();
    }
  }
  
  removeStreetLight(id: string): void {
    const instance = this.instances.get(id);
    if (!instance) return;
    
    const { index, isMajor, bulbLight } = instance;
    
    // Remove point light if exists
    if (bulbLight) {
      this.scene.remove(bulbLight);
      bulbLight.dispose();
    }
    
    // Hide all components
    if (isMajor) {
      this.hideInstance(this.majorPoleInstancedMesh, index);
      this.hideInstance(this.majorFixtureInstancedMesh, index);
      this.hideInstance(this.majorBulbInstancedMesh, index);
      this.availableMajorIndices.push(index);
    } else {
      this.hideInstance(this.poleInstancedMesh, index);
      this.hideInstance(this.fixtureInstancedMesh, index);
      this.hideInstance(this.bulbInstancedMesh, index);
      this.availableIndices.push(index);
    }
    
    this.instances.delete(id);
  }
  
  // Add point light for a street light (called selectively for nearby lights)
  addPointLight(id: string): THREE.PointLight | null {
    const instance = this.instances.get(id);
    if (!instance || instance.bulbLight) return null;
    
    const { position, isMajor } = instance;
    
    const light = new THREE.PointLight(
      isMajor ? 0xffffff : 0xffffaa,
      isMajor ? 2 : 1.5,
      isMajor ? 40 : 30
    );
    
    light.position.set(position.x, isMajor ? 15 : 10, position.z);
    light.castShadow = false; // Street lights don't cast shadows for performance
    
    this.scene.add(light);
    instance.bulbLight = light;
    
    return light;
  }
  
  removePointLight(id: string): void {
    const instance = this.instances.get(id);
    if (!instance || !instance.bulbLight) return;
    
    this.scene.remove(instance.bulbLight);
    instance.bulbLight.dispose();
    instance.bulbLight = undefined;
  }
  
  // Animation method for gradual appearance
  animateLightAppear(index: number): void {
    // Find the instance by index
    let targetMeshes: THREE.InstancedMesh[] = [];
    let instanceData: StreetLightInstance | null = null;
    
    // Check if it's a regular or major light
    for (const [_, instance] of this.instances) {
      if (instance.index === index) {
        instanceData = instance;
        if (instance.isMajor) {
          targetMeshes = [this.majorPoleInstancedMesh, this.majorFixtureInstancedMesh, this.majorBulbInstancedMesh];
        } else {
          targetMeshes = [this.poleInstancedMesh, this.fixtureInstancedMesh, this.bulbInstancedMesh];
        }
        break;
      }
    }
    
    if (!instanceData || targetMeshes.length === 0) return;
    
    // Store original transforms for each component
    const originalMatrices: THREE.Matrix4[] = [];
    const positions: THREE.Vector3[] = [];
    const quaternions: THREE.Quaternion[] = [];
    
    targetMeshes.forEach(mesh => {
      const matrix = new THREE.Matrix4();
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      
      mesh.getMatrixAt(index, matrix);
      matrix.decompose(pos, quat, scale);
      
      originalMatrices.push(matrix.clone());
      positions.push(pos);
      quaternions.push(quat);
    });
    
    const duration = 300 + Math.random() * 200; // 300-500ms
    const startTime = Date.now();
    const startScale = 0.01;
    
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Bounce easing for a fun pop effect
      const eased = 1 - Math.pow(1 - progress, 3);
      const currentScale = startScale + (1 - startScale) * eased;
      
      // Apply scale to each component individually to preserve their positions
      targetMeshes.forEach((mesh, i) => {
        const scale = new THREE.Vector3(currentScale, currentScale, currentScale);
        const matrix = new THREE.Matrix4();
        matrix.compose(positions[i], quaternions[i], scale);
        
        mesh.setMatrixAt(index, matrix);
        mesh.instanceMatrix.needsUpdate = true;
      });
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };
    
    animate();
  }
  
  // Get total instance count for animation
  getInstanceCount(): number {
    return this.instances.size;
  }
  
  getStreetLightCount(): number {
    return this.instances.size;
  }
  
  getStreetLights(): Map<string, StreetLightInstance> {
    return this.instances;
  }
  
  // Update street light appearance based on time of day
  updateTimeOfDay(isDark: boolean): void {
    const materialCache = MaterialCache.getInstance();
    
    // Update regular bulb material
    const regularBulbMaterial = this.bulbInstancedMesh.material as THREE.MeshBasicMaterial;
    if (isDark) {
      regularBulbMaterial.color.setHex(0xffffaa); // Warm glow
      regularBulbMaterial.opacity = 0.9;
    } else {
      regularBulbMaterial.color.setHex(0x444444); // Dim gray
      regularBulbMaterial.opacity = 0.1;
    }
    
    // Update major bulb material
    const majorBulbMaterial = this.majorBulbInstancedMesh.material as THREE.MeshBasicMaterial;
    if (isDark) {
      majorBulbMaterial.color.setHex(0xffffff); // Bright white
      majorBulbMaterial.opacity = 1.0;
    } else {
      majorBulbMaterial.color.setHex(0x444444); // Dim gray
      majorBulbMaterial.opacity = 0.1;
    }
  }
  
  dispose(): void {
    // Remove all point lights
    this.instances.forEach(instance => {
      if (instance.bulbLight) {
        this.scene.remove(instance.bulbLight);
        instance.bulbLight.dispose();
      }
    });
    
    // Remove all meshes
    this.scene.remove(this.poleInstancedMesh);
    this.scene.remove(this.fixtureInstancedMesh);
    this.scene.remove(this.bulbInstancedMesh);
    this.scene.remove(this.majorPoleInstancedMesh);
    this.scene.remove(this.majorFixtureInstancedMesh);
    this.scene.remove(this.majorBulbInstancedMesh);
    
    // Dispose geometries and materials (handled by cache)
    this.instances.clear();
  }
  
  /**
   * Update bounding spheres for all street light meshes to fix culling
   */
  updateBoundingSpheres(): void {
    // Update regular street light meshes
    this.poleInstancedMesh.computeBoundingSphere();
    this.fixtureInstancedMesh.computeBoundingSphere();
    this.bulbInstancedMesh.computeBoundingSphere();
    
    // Update major street light meshes  
    this.majorPoleInstancedMesh.computeBoundingSphere();
    this.majorFixtureInstancedMesh.computeBoundingSphere();
    this.majorBulbInstancedMesh.computeBoundingSphere();
    
    debug.log('Updated bounding spheres for all street light meshes');
  }
  
  /**
   * Disable frustum culling for all street light meshes
   */
  disableFrustumCulling(): void {
    // Disable for regular meshes
    this.poleInstancedMesh.frustumCulled = false;
    this.fixtureInstancedMesh.frustumCulled = false;
    this.bulbInstancedMesh.frustumCulled = false;
    
    // Disable for major meshes
    this.majorPoleInstancedMesh.frustumCulled = false;
    this.majorFixtureInstancedMesh.frustumCulled = false;
    this.majorBulbInstancedMesh.frustumCulled = false;
    
    debug.log('Disabled frustum culling for all street light meshes');
  }
}