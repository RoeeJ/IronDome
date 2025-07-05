import * as THREE from 'three';
// SimplifyModifier import removed - will use decimation approach instead
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export class GeometryOptimizer {
  /**
   * Simplify a geometry by reducing vertex count
   * @param geometry The geometry to simplify
   * @param targetRatio Target ratio of vertices to keep (0.1 = 10% of original)
   * @returns Simplified geometry
   */
  static simplifyGeometry(
    geometry: THREE.BufferGeometry,
    targetRatio: number = 0.1
  ): THREE.BufferGeometry {
    // Basic decimation by skipping vertices
    // This is a very simple approach - for better results, use a proper decimation library

    const positions = geometry.attributes.position;
    const normals = geometry.attributes.normal;
    const uvs = geometry.attributes.uv;
    const indices = geometry.index;

    if (!indices || !positions) {
      return geometry.clone();
    }

    // For indexed geometry, we can decimate by reducing the index count
    const oldIndices = indices.array;
    const step = Math.max(3, Math.floor(1 / targetRatio) * 3); // Ensure multiple of 3 for triangles
    const newIndicesArray: number[] = [];

    // Keep every Nth triangle
    for (let i = 0; i < oldIndices.length; i += step) {
      if (i + 2 < oldIndices.length) {
        newIndicesArray.push(oldIndices[i], oldIndices[i + 1], oldIndices[i + 2]);
      }
    }

    const newGeometry = geometry.clone();
    newGeometry.setIndex(newIndicesArray);

    return newGeometry;
  }

  /**
   * Optimize an entire object by merging and simplifying geometries
   * @param object The object to optimize
   * @param options Optimization options
   */
  static optimizeObject(
    object: THREE.Object3D,
    options: {
      simplify?: boolean;
      simplifyRatio?: number;
      mergeByMaterial?: boolean;
      removeSmallDetails?: boolean;
      smallDetailThreshold?: number;
    } = {}
  ): void {
    const {
      simplify = true,
      simplifyRatio = 0.1,
      mergeByMaterial = true,
      removeSmallDetails = true,
      smallDetailThreshold = 0.5,
    } = options;

    // First pass: remove small details
    if (removeSmallDetails) {
      const toRemove: THREE.Object3D[] = [];

      object.traverse(child => {
        if (child instanceof THREE.Mesh && child.geometry) {
          const box = new THREE.Box3().setFromObject(child);
          const size = box.getSize(new THREE.Vector3());
          const maxDimension = Math.max(size.x, size.y, size.z);

          // Remove very small meshes
          if (maxDimension < smallDetailThreshold) {
            toRemove.push(child);
          }
        }
      });

      toRemove.forEach(child => {
        child.removeFromParent();
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) {
            child.material.dispose();
          }
        }
      });
    }

    // Second pass: merge geometries by material
    if (mergeByMaterial) {
      const materialMap = new Map<THREE.Material, THREE.BufferGeometry[]>();
      const meshesToRemove: THREE.Mesh[] = [];

      object.traverse(child => {
        if (child instanceof THREE.Mesh && child.geometry && child.visible) {
          const material = Array.isArray(child.material) ? child.material[0] : child.material;

          if (!materialMap.has(material)) {
            materialMap.set(material, []);
          }

          // Apply the mesh's world transform to the geometry
          const clonedGeometry = child.geometry.clone();
          clonedGeometry.applyMatrix4(child.matrixWorld);

          materialMap.get(material)!.push(clonedGeometry);
          meshesToRemove.push(child);
        }
      });

      // Remove original meshes
      meshesToRemove.forEach(mesh => {
        mesh.removeFromParent();
        mesh.geometry.dispose();
      });

      // Create merged meshes
      materialMap.forEach((geometries, material) => {
        if (geometries.length > 0) {
          let mergedGeometry = BufferGeometryUtils.mergeGeometries(geometries, false);

          // Simplify if requested
          if (simplify && mergedGeometry) {
            mergedGeometry = this.simplifyGeometry(mergedGeometry, simplifyRatio);
          }

          const mergedMesh = new THREE.Mesh(mergedGeometry, material);
          object.add(mergedMesh);

          // Clean up temporary geometries
          geometries.forEach(g => g.dispose());
        }
      });
    } else if (simplify) {
      // Just simplify without merging
      object.traverse(child => {
        if (child instanceof THREE.Mesh && child.geometry) {
          const simplified = this.simplifyGeometry(child.geometry, simplifyRatio);
          child.geometry.dispose();
          child.geometry = simplified;
        }
      });
    }
  }

  /**
   * Create LOD levels from a high-poly model
   * @param object The high-poly model
   * @param levels Array of simplification ratios for each LOD level
   * @returns THREE.LOD object with multiple detail levels
   */
  static createLODFromModel(
    object: THREE.Object3D,
    levels: number[] = [1.0, 0.5, 0.2, 0.1]
  ): THREE.LOD {
    const lod = new THREE.LOD();

    levels.forEach((ratio, index) => {
      const clonedObject = object.clone(true);

      if (ratio < 1.0) {
        this.optimizeObject(clonedObject, {
          simplify: true,
          simplifyRatio: ratio,
          mergeByMaterial: true,
          removeSmallDetails: index > 1, // Remove small details for lower LODs
          smallDetailThreshold: index > 2 ? 1.0 : 0.5,
        });
      }

      // Calculate distance based on index
      const distance = index === 0 ? 0 : 50 * Math.pow(2, index - 1);
      lod.addLevel(clonedObject, distance);
    });

    return lod;
  }

  /**
   * Analyze geometry complexity
   * @param object The object to analyze
   * @returns Statistics about the geometry
   */
  static analyzeComplexity(object: THREE.Object3D): {
    totalTriangles: number;
    totalVertices: number;
    meshCount: number;
    materialCount: number;
    breakdown: Array<{
      name: string;
      triangles: number;
      vertices: number;
    }>;
  } {
    let totalTriangles = 0;
    let totalVertices = 0;
    let meshCount = 0;
    const materials = new Set<THREE.Material>();
    const breakdown: Array<{ name: string; triangles: number; vertices: number }> = [];

    object.traverse(child => {
      if (child instanceof THREE.Mesh && child.geometry) {
        meshCount++;

        const geometry = child.geometry;
        const vertices = geometry.attributes.position ? geometry.attributes.position.count : 0;
        const indices = geometry.index;
        const triangles = indices ? indices.count / 3 : vertices / 3;

        totalVertices += vertices;
        totalTriangles += triangles;

        if (child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach(m => materials.add(m));
        }

        breakdown.push({
          name: child.name || `Mesh ${meshCount}`,
          triangles: Math.floor(triangles),
          vertices,
        });
      }
    });

    // Sort breakdown by triangle count
    breakdown.sort((a, b) => b.triangles - a.triangles);

    return {
      totalTriangles: Math.floor(totalTriangles),
      totalVertices,
      meshCount,
      materialCount: materials.size,
      breakdown: breakdown.slice(0, 10), // Top 10 meshes
    };
  }
}
