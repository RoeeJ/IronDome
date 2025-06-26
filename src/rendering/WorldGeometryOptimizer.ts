import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { debug } from '../utils/logger';
import { MaterialCache } from '../utils/MaterialCache';

export class WorldGeometryOptimizer {
  /**
   * Merge multiple meshes with the same material into a single mesh
   */
  static mergeMeshesByMaterial(meshes: THREE.Mesh[]): THREE.Mesh[] {
    const materialGroups = new Map<string, {
      material: THREE.Material;
      geometries: THREE.BufferGeometry[];
      transforms: THREE.Matrix4[];
    }>();
    
    // Group meshes by material
    meshes.forEach(mesh => {
      if (!mesh.material || Array.isArray(mesh.material)) return;
      
      const material = mesh.material as THREE.Material;
      const key = material.uuid;
      
      if (!materialGroups.has(key)) {
        materialGroups.set(key, {
          material,
          geometries: [],
          transforms: []
        });
      }
      
      const group = materialGroups.get(key)!;
      
      // Clone geometry and apply transform
      const geometry = mesh.geometry.clone();
      mesh.updateMatrixWorld();
      geometry.applyMatrix4(mesh.matrixWorld);
      
      group.geometries.push(geometry);
      group.transforms.push(mesh.matrixWorld.clone());
    });
    
    // Create merged meshes
    const mergedMeshes: THREE.Mesh[] = [];
    
    materialGroups.forEach((group, key) => {
      if (group.geometries.length === 0) return;
      
      try {
        const mergedGeometry = BufferGeometryUtils.mergeGeometries(
          group.geometries,
          false // Don't use groups
        );
        
        const mergedMesh = new THREE.Mesh(mergedGeometry, group.material);
        mergedMesh.castShadow = false; // Static geometry usually doesn't need to cast shadows
        mergedMesh.receiveShadow = true;
        mergedMesh.name = `merged_${group.material.type}_${key.substring(0, 8)}`;
        
        mergedMeshes.push(mergedMesh);
        
        // Dispose of individual geometries
        group.geometries.forEach(geo => geo.dispose());
      } catch (error) {
        debug.warn('Failed to merge geometries:', error);
      }
    });
    
    return mergedMeshes;
  }
  
  /**
   * Optimize a scene by merging static geometry
   */
  static optimizeStaticGeometry(
    group: THREE.Group,
    options: {
      mergeByMaterial?: boolean;
      excludeNames?: string[];
      castShadows?: boolean;
    } = {}
  ): THREE.Group {
    const {
      mergeByMaterial = true,
      excludeNames = [],
      castShadows = false
    } = options;
    
    const meshesToMerge: THREE.Mesh[] = [];
    const optimizedGroup = new THREE.Group();
    optimizedGroup.name = `${group.name}_optimized`;
    
    // Collect meshes for merging
    group.traverse(object => {
      if (object instanceof THREE.Mesh) {
        // Skip excluded objects
        if (excludeNames.includes(object.name)) {
          // Keep original
          optimizedGroup.add(object.clone());
          return;
        }
        
        // Skip objects with animations or special properties
        if (object.userData.animated || object.userData.dynamic) {
          optimizedGroup.add(object.clone());
          return;
        }
        
        meshesToMerge.push(object);
      } else if (object instanceof THREE.Group && object !== group) {
        // Recursively optimize sub-groups
        const optimizedSubGroup = this.optimizeStaticGeometry(object, options);
        optimizedGroup.add(optimizedSubGroup);
      }
    });
    
    // Merge the collected meshes
    if (meshesToMerge.length > 0) {
      const mergedMeshes = mergeByMaterial 
        ? this.mergeMeshesByMaterial(meshesToMerge)
        : [this.mergeAllMeshes(meshesToMerge)];
      
      mergedMeshes.forEach(mesh => {
        mesh.castShadow = castShadows;
        optimizedGroup.add(mesh);
      });
    }
    
    // Copy group properties
    optimizedGroup.position.copy(group.position);
    optimizedGroup.rotation.copy(group.rotation);
    optimizedGroup.scale.copy(group.scale);
    
    return optimizedGroup;
  }
  
  /**
   * Merge all meshes into a single mesh (ignoring materials)
   */
  private static mergeAllMeshes(meshes: THREE.Mesh[]): THREE.Mesh {
    const geometries: THREE.BufferGeometry[] = [];
    
    meshes.forEach(mesh => {
      const geometry = mesh.geometry.clone();
      mesh.updateMatrixWorld();
      geometry.applyMatrix4(mesh.matrixWorld);
      geometries.push(geometry);
    });
    
    const mergedGeometry = BufferGeometryUtils.mergeGeometries(geometries, false);
    
    // Use cached material
    const material = MaterialCache.getInstance().getMeshStandardMaterial({
      color: 0x888888,
      roughness: 0.8,
      metalness: 0.2
    });
    
    const mergedMesh = new THREE.Mesh(mergedGeometry, material);
    mergedMesh.name = 'merged_all';
    
    // Dispose of individual geometries
    geometries.forEach(geo => geo.dispose());
    
    return mergedMesh;
  }
  
  /**
   * Create an instanced mesh from multiple similar objects
   */
  static createInstancedMesh(
    meshes: THREE.Mesh[],
    geometry: THREE.BufferGeometry,
    material: THREE.Material
  ): THREE.InstancedMesh {
    const count = meshes.length;
    const instancedMesh = new THREE.InstancedMesh(geometry, material, count);
    
    const dummy = new THREE.Object3D();
    
    meshes.forEach((mesh, index) => {
      mesh.updateMatrixWorld();
      dummy.position.setFromMatrixPosition(mesh.matrixWorld);
      dummy.rotation.setFromRotationMatrix(mesh.matrixWorld);
      dummy.scale.setFromMatrixScale(mesh.matrixWorld);
      dummy.updateMatrix();
      
      instancedMesh.setMatrixAt(index, dummy.matrix);
    });
    
    instancedMesh.instanceMatrix.needsUpdate = true;
    instancedMesh.castShadow = false;
    instancedMesh.receiveShadow = true;
    
    return instancedMesh;
  }
  
  /**
   * Analyze a scene and report optimization opportunities
   */
  static analyzeScene(scene: THREE.Scene): {
    totalMeshes: number;
    uniqueMaterials: number;
    duplicateGeometries: number;
    recommendations: string[];
  } {
    const meshes: THREE.Mesh[] = [];
    const materials = new Set<string>();
    const geometries = new Map<string, number>();
    
    scene.traverse(object => {
      if (object instanceof THREE.Mesh) {
        meshes.push(object);
        
        if (object.material) {
          if (Array.isArray(object.material)) {
            object.material.forEach(mat => materials.add(mat.uuid));
          } else {
            materials.add(object.material.uuid);
          }
        }
        
        // Track geometry usage
        const geoKey = `${object.geometry.type}_${JSON.stringify(object.geometry.parameters || {})}`;
        geometries.set(geoKey, (geometries.get(geoKey) || 0) + 1);
      }
    });
    
    // Count duplicate geometries
    let duplicateGeometries = 0;
    geometries.forEach(count => {
      if (count > 1) duplicateGeometries += count - 1;
    });
    
    // Generate recommendations
    const recommendations: string[] = [];
    
    if (meshes.length > 100) {
      recommendations.push(`High mesh count (${meshes.length}). Consider merging static geometry.`);
    }
    
    if (materials.size > 20) {
      recommendations.push(`Many unique materials (${materials.size}). Consider material atlasing.`);
    }
    
    if (duplicateGeometries > 50) {
      recommendations.push(`Many duplicate geometries (${duplicateGeometries}). Consider instancing.`);
    }
    
    return {
      totalMeshes: meshes.length,
      uniqueMaterials: materials.size,
      duplicateGeometries,
      recommendations
    };
  }
}