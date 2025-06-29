import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MaterialCache } from './MaterialCache';

export class StaticGeometryMerger {
  static mergeGeometries(meshes: THREE.Mesh[]): THREE.Mesh | null {
    if (meshes.length === 0) return null;

    // Group meshes by material
    const materialGroups = new Map<THREE.Material, THREE.Mesh[]>();

    meshes.forEach(mesh => {
      if (mesh.geometry && mesh.material && !Array.isArray(mesh.material)) {
        const material = mesh.material as THREE.Material;
        if (!materialGroups.has(material)) {
          materialGroups.set(material, []);
        }
        materialGroups.get(material)!.push(mesh);
      }
    });

    // If we have multiple materials, we need to create a multi-material mesh
    if (materialGroups.size > 1) {
      return this.mergeMultiMaterial(materialGroups);
    }

    // Single material case
    const [material, meshList] = Array.from(materialGroups.entries())[0];
    return this.mergeSingleMaterial(meshList, material);
  }

  private static mergeSingleMaterial(meshes: THREE.Mesh[], material: THREE.Material): THREE.Mesh {
    const geometries: THREE.BufferGeometry[] = [];

    // First, ensure all meshes have updated world matrices
    meshes.forEach(mesh => {
      mesh.updateMatrixWorld(true);
    });

    meshes.forEach(mesh => {
      // Clone geometry to avoid modifying original
      const geometry = mesh.geometry.clone();

      // Always use world transform to get the final position
      geometry.applyMatrix4(mesh.matrixWorld);

      geometries.push(geometry);
    });

    // Merge all geometries
    const mergedGeometry = mergeGeometries(geometries);

    // Create merged mesh - it will inherit parent transforms
    const mergedMesh = new THREE.Mesh(mergedGeometry, material);
    mergedMesh.castShadow = true;
    mergedMesh.receiveShadow = true;

    // Dispose cloned geometries
    geometries.forEach(g => g.dispose());

    return mergedMesh;
  }

  private static mergeMultiMaterial(materialGroups: Map<THREE.Material, THREE.Mesh[]>): THREE.Mesh {
    const mergedGeometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];

    // First, ensure all meshes have updated world matrices
    materialGroups.forEach(meshes => {
      meshes.forEach(mesh => mesh.updateMatrixWorld(true));
    });

    materialGroups.forEach((meshes, material) => {
      const geometries: THREE.BufferGeometry[] = [];

      meshes.forEach(mesh => {
        // Clone geometry to avoid modifying original
        const geometry = mesh.geometry.clone();

        // Always use world transform to get the final position
        geometry.applyMatrix4(mesh.matrixWorld);

        geometries.push(geometry);
      });

      // Merge geometries for this material
      const mergedGeometry = mergeGeometries(geometries);

      // Add material index
      const materialIndex = materials.length;
      const groups =
        mergedGeometry.groups.length > 0
          ? mergedGeometry.groups
          : [
              {
                start: 0,
                count: mergedGeometry.index
                  ? mergedGeometry.index.count
                  : mergedGeometry.attributes.position.count,
                materialIndex: 0,
              },
            ];

      // Update groups to use correct material index
      groups.forEach(group => {
        group.materialIndex = materialIndex;
      });

      mergedGeometries.push(mergedGeometry);
      materials.push(material);

      // Dispose cloned geometries
      geometries.forEach(g => g.dispose());
    });

    // Final merge
    const finalGeometry = mergeGeometries(mergedGeometries);

    // Create multi-material mesh - it will inherit parent transforms
    const mergedMesh = new THREE.Mesh(finalGeometry, materials);
    mergedMesh.castShadow = true;
    mergedMesh.receiveShadow = true;

    // Dispose intermediate geometries
    mergedGeometries.forEach(g => g.dispose());

    return mergedMesh;
  }

  static mergeStaticCity(
    buildingMeshes: THREE.Mesh[],
    roadMeshes: THREE.Mesh[],
    lightMeshes: THREE.Mesh[]
  ): {
    buildings: THREE.Mesh | null;
    roads: THREE.Mesh | null;
    lights: THREE.Mesh | null;
  } {
    // Merge each category separately for better organization
    const mergedBuildings = this.mergeGeometries(buildingMeshes);
    const mergedRoads = this.mergeGeometries(roadMeshes);
    const mergedLights = this.mergeGeometries(lightMeshes);

    return {
      buildings: mergedBuildings,
      roads: mergedRoads,
      lights: mergedLights,
    };
  }
}
