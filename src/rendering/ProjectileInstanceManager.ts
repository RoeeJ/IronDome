import * as THREE from 'three';
import { ThreatType, THREAT_CONFIGS } from '../entities/Threat';
import { MaterialCache } from '../utils/MaterialCache';
import { GeometryFactory } from '../utils/GeometryFactory';

interface ProjectileInstance {
  id: string;
  index: number;
  type: 'threat' | 'interceptor';
  threatType?: ThreatType;
  active: boolean;
}

export class ProjectileInstanceManager {
  private scene: THREE.Scene;
  private instances = new Map<string, ProjectileInstance>();
  
  // Separate instanced meshes for each threat type and interceptors
  private instancedMeshes = new Map<string, THREE.InstancedMesh>();
  private instancePools = new Map<string, number[]>();
  
  // Constants
  private static readonly MAX_INSTANCES_PER_TYPE = 50; // PERFORMANCE: Reduced from 100
  private static readonly INTERCEPTOR_KEY = 'interceptor';
  
  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.initializeInstancedMeshes();
  }
  
  private initializeInstancedMeshes(): void {
    const materialCache = MaterialCache.getInstance();
    const geometryFactory = GeometryFactory.getInstance();
    
    // Initialize interceptor instanced mesh
    const interceptorGeometry = geometryFactory.getCone(0.3, 1.5, 8);
    const interceptorMaterial = materialCache.getMeshStandardMaterial({
      color: 0x00ff00,
      emissive: 0x00ff00,
      emissiveIntensity: 0.2,
      metalness: 0.8,
      roughness: 0.2,
    });
    
    const interceptorMesh = new THREE.InstancedMesh(
      interceptorGeometry,
      interceptorMaterial,
      ProjectileInstanceManager.MAX_INSTANCES_PER_TYPE
    );
    interceptorMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    interceptorMesh.castShadow = true;
    interceptorMesh.receiveShadow = false;
    this.scene.add(interceptorMesh);
    
    this.instancedMeshes.set(ProjectileInstanceManager.INTERCEPTOR_KEY, interceptorMesh);
    
    // Initialize pool for interceptors
    const interceptorPool: number[] = [];
    for (let i = 0; i < ProjectileInstanceManager.MAX_INSTANCES_PER_TYPE; i++) {
      interceptorPool.push(i);
      // Hide all instances initially
      const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
      interceptorMesh.setMatrixAt(i, zeroMatrix);
    }
    interceptorMesh.instanceMatrix.needsUpdate = true;
    this.instancePools.set(ProjectileInstanceManager.INTERCEPTOR_KEY, interceptorPool);
    
    // Initialize threat type instanced meshes
    Object.entries(THREAT_CONFIGS).forEach(([type, config]) => {
      const geometry = this.getThreatGeometry(type as ThreatType);
      const material = materialCache.getMeshStandardMaterial({
        color: config.color,
        emissive: config.color,
        emissiveIntensity: 0.1,
        metalness: 0.7,
        roughness: 0.3,
      });
      
      const instancedMesh = new THREE.InstancedMesh(
        geometry,
        material,
        ProjectileInstanceManager.MAX_INSTANCES_PER_TYPE
      );
      instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      instancedMesh.castShadow = true;
      instancedMesh.receiveShadow = false;
      this.scene.add(instancedMesh);
      
      this.instancedMeshes.set(type, instancedMesh);
      
      // Initialize pool
      const pool: number[] = [];
      for (let i = 0; i < ProjectileInstanceManager.MAX_INSTANCES_PER_TYPE; i++) {
        pool.push(i);
        // Hide all instances initially
        const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
        instancedMesh.setMatrixAt(i, zeroMatrix);
      }
      instancedMesh.instanceMatrix.needsUpdate = true;
      this.instancePools.set(type, pool);
    });
  }
  
  private getThreatGeometry(type: ThreatType): THREE.BufferGeometry {
    const geometryFactory = GeometryFactory.getInstance();
    const config = THREAT_CONFIGS[type];
    
    // Use different geometries based on threat type
    if (config.isDrone) {
      // Simple box for drones
      return geometryFactory.getBox(config.radius * 2, config.radius, config.radius * 3);
    } else if (config.isMortar) {
      // Sphere for mortars
      return geometryFactory.getSphere(config.radius);
    } else if (type === ThreatType.CRUISE_MISSILE) {
      // Elongated cylinder for cruise missiles
      return geometryFactory.getCylinder(config.radius * 0.5, config.radius * 0.5, config.radius * 4);
    } else {
      // Cone for regular rockets
      return geometryFactory.getCone(config.radius, config.radius * 3, 8);
    }
  }
  
  allocateInstance(id: string, type: 'threat' | 'interceptor', threatType?: ThreatType): number | null {
    const key = type === 'interceptor' ? ProjectileInstanceManager.INTERCEPTOR_KEY : threatType!;
    const pool = this.instancePools.get(key);
    const mesh = this.instancedMeshes.get(key);
    
    if (!pool || !mesh || pool.length === 0) {
      console.warn(`No available instances for ${key}`);
      return null;
    }
    
    const index = pool.pop()!;
    const instance: ProjectileInstance = {
      id,
      index,
      type,
      threatType,
      active: true,
    };
    
    this.instances.set(id, instance);
    return index;
  }
  
  updateInstance(id: string, position: THREE.Vector3, rotation: THREE.Euler, scale: THREE.Vector3 = new THREE.Vector3(1, 1, 1)): void {
    const instance = this.instances.get(id);
    if (!instance || !instance.active) return;
    
    const key = instance.type === 'interceptor' ? ProjectileInstanceManager.INTERCEPTOR_KEY : instance.threatType!;
    const mesh = this.instancedMeshes.get(key);
    if (!mesh) return;
    
    // Create transformation matrix
    const matrix = new THREE.Matrix4();
    matrix.compose(position, new THREE.Quaternion().setFromEuler(rotation), scale);
    
    mesh.setMatrixAt(instance.index, matrix);
    mesh.instanceMatrix.needsUpdate = true;
  }
  
  releaseInstance(id: string): void {
    const instance = this.instances.get(id);
    if (!instance) return;
    
    const key = instance.type === 'interceptor' ? ProjectileInstanceManager.INTERCEPTOR_KEY : instance.threatType!;
    const pool = this.instancePools.get(key);
    const mesh = this.instancedMeshes.get(key);
    
    if (pool && mesh) {
      // Hide the instance
      const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
      mesh.setMatrixAt(instance.index, zeroMatrix);
      mesh.instanceMatrix.needsUpdate = true;
      
      // Return index to pool
      pool.push(instance.index);
    }
    
    this.instances.delete(id);
  }
  
  getStats(): { active: number; pools: Record<string, number> } {
    const pools: Record<string, number> = {};
    this.instancePools.forEach((pool, key) => {
      pools[key] = pool.length;
    });
    
    return {
      active: this.instances.size,
      pools,
    };
  }
  
  dispose(): void {
    this.instancedMeshes.forEach(mesh => {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      if (mesh.material instanceof THREE.Material) {
        mesh.material.dispose();
      }
    });
    
    this.instancedMeshes.clear();
    this.instancePools.clear();
    this.instances.clear();
  }
}