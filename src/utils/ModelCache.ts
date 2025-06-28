import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { debug } from './DebugLogger';

/**
 * Singleton cache for loaded 3D models to prevent duplicate loading
 * and enable efficient instancing
 */
export class ModelCache {
  private static instance: ModelCache;
  private loader: GLTFLoader;
  private cache: Map<string, Promise<THREE.Group>> = new Map();
  private geometryCache: Map<string, THREE.BufferGeometry> = new Map();
  private materialCache: Map<string, THREE.Material[]> = new Map();

  private constructor() {
    this.loader = new GLTFLoader();
  }

  static getInstance(): ModelCache {
    if (!ModelCache.instance) {
      ModelCache.instance = new ModelCache();
    }
    return ModelCache.instance;
  }

  /**
   * Load a model once and return clones for each request
   */
  async loadModel(url: string): Promise<THREE.Group> {
    // If already loading/loaded, return the cached promise
    if (this.cache.has(url)) {
      const model = await this.cache.get(url)!;
      return model.clone(); // Return a clone, not the original
    }

    // Start loading and cache the promise
    const loadPromise = new Promise<THREE.Group>((resolve, reject) => {
      this.loader.load(
        url,
        gltf => {
          const model = gltf.scene;

          // Cache geometries and materials for efficient cloning
          let totalTriangles = 0;
          let meshCount = 0;

          // Remove any debug helpers from the model - but be very careful
          const toRemove: THREE.Object3D[] = [];
          model.traverse(child => {
            // Only remove objects explicitly named as helpers or debug
            // Don't remove based on type - Lines/LineSegments might be part of the model
            if (
              child.name.toLowerCase().includes('helper') ||
              child.name.toLowerCase().includes('debug') ||
              child.name.toLowerCase().includes('bone') // Sometimes bones are left in exports
            ) {
              toRemove.push(child);
              debug.warn(`Removing debug object from model: ${child.name} (${child.type})`);
            } else if (child instanceof THREE.Mesh) {
              const mesh = child as THREE.Mesh;
              meshCount++;

              // Cache geometry
              if (mesh.geometry) {
                const geomId = `${url}_${mesh.name}_geom`;
                this.geometryCache.set(geomId, mesh.geometry);

                // Count triangles
                if (mesh.geometry.index) {
                  totalTriangles += mesh.geometry.index.count / 3;
                } else if (mesh.geometry.attributes.position) {
                  totalTriangles += mesh.geometry.attributes.position.count / 3;
                }
              }

              // Cache materials
              if (mesh.material) {
                const matId = `${url}_${mesh.name}_mat`;
                const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                this.materialCache.set(matId, materials);
              }
            }
          });

          // Remove debug objects
          toRemove.forEach(obj => {
            if (obj.parent) {
              obj.parent.remove(obj);
            }
          });

          debug.asset('Model loaded', url, {
            meshes: meshCount,
            triangles: totalTriangles,
            memory: `${(totalTriangles * 32) / 1024}KB`, // Rough estimate
          });

          // Debug: Check model structure
          if (meshCount === 0) {
            debug.warn('No meshes found in model!', model);
          }
          resolve(model);
        },
        undefined,
        error => {
          debug.error(`Failed to load model: ${url}`, error);
          reject(error);
        }
      );
    });

    this.cache.set(url, loadPromise);
    const model = await loadPromise;
    return model.clone();
  }

  /**
   * Create an efficient instance of a cached model
   * This reuses geometries and materials instead of cloning them
   */
  async createInstance(url: string): Promise<THREE.Group> {
    // Ensure model is loaded
    const originalModel = await this.loadModel(url);

    // Helper function to recursively create instances while preserving hierarchy
    const createInstanceRecursive = (original: THREE.Object3D): THREE.Object3D | null => {
      if (original instanceof THREE.Mesh) {
        // Create new mesh with same geometry but REUSE material
        const newMesh = new THREE.Mesh(original.geometry, original.material);
        newMesh.name = original.name;
        newMesh.position.copy(original.position);
        newMesh.rotation.copy(original.rotation);
        newMesh.scale.copy(original.scale);
        newMesh.castShadow = original.castShadow;
        newMesh.receiveShadow = original.receiveShadow;
        newMesh.visible = original.visible;
        newMesh.frustumCulled = original.frustumCulled;
        return newMesh;
      } else if (original instanceof THREE.Group || original.type === 'Object3D') {
        // Create new group and preserve hierarchy
        const newGroup = new THREE.Group();
        newGroup.name = original.name;
        newGroup.position.copy(original.position);
        newGroup.rotation.copy(original.rotation);
        newGroup.scale.copy(original.scale);
        newGroup.visible = original.visible;
        
        // Recursively add children to preserve hierarchy
        original.children.forEach(child => {
          const newChild = createInstanceRecursive(child);
          if (newChild) {
            newGroup.add(newChild);
          }
        });
        
        return newGroup;
      }
      
      // Skip other types (lights, cameras, etc.)
      return null;
    };
    
    // Create instance preserving full hierarchy
    const instance = createInstanceRecursive(originalModel) as THREE.Group;
    return instance;

    /* Instance creation code - temporarily disabled for debugging
    const instance = new THREE.Group()
    const cachedModel = await this.cache.get(url)!
    
    cachedModel.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const mesh = child as THREE.Mesh
        const geomId = `${url}_${mesh.name}_geom`
        const matId = `${url}_${mesh.name}_mat`
        
        // Reuse cached geometry and materials
        const geometry = this.geometryCache.get(geomId)
        const materials = this.materialCache.get(matId)
        
        if (geometry && materials) {
          const instanceMesh = new THREE.Mesh(
            geometry,  // Shared geometry
            materials.length === 1 ? materials[0].clone() : materials.map(m => m.clone())
          )
          
          // Copy transform
          instanceMesh.position.copy(mesh.position)
          instanceMesh.rotation.copy(mesh.rotation)
          instanceMesh.scale.copy(mesh.scale)
          instanceMesh.name = mesh.name
          instanceMesh.castShadow = mesh.castShadow
          instanceMesh.receiveShadow = mesh.receiveShadow
          
          instance.add(instanceMesh)
        }
      }
    })
    
    return instance
    */
  }

  /**
   * Preload models during initialization
   */
  async preloadModels(urls: string[]): Promise<void> {
    const promises = urls.map(url => this.loadModel(url));
    await Promise.all(promises);
    debug.asset('Preloaded models', `${urls.length} models`, this.getStats());
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      models: this.cache.size,
      geometries: this.geometryCache.size,
      materials: this.materialCache.size,
    };
  }
}
