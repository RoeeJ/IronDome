import * as THREE from 'three';

export interface ModelStatistics {
  vertices: number;
  faces: number;
  drawCalls: number;
  textures: number;
  materials: number;
  meshes: number;
  totalTriangles: number;
  boundingBox: {
    min: THREE.Vector3;
    max: THREE.Vector3;
    size: THREE.Vector3;
    center: THREE.Vector3;
  };
  memoryEstimate: string;
}

export class ModelInfo {
  analyze(model: THREE.Object3D): ModelStatistics {
    const stats: ModelStatistics = {
      vertices: 0,
      faces: 0,
      drawCalls: 0,
      textures: 0,
      materials: 0,
      meshes: 0,
      totalTriangles: 0,
      boundingBox: {
        min: new THREE.Vector3(),
        max: new THREE.Vector3(),
        size: new THREE.Vector3(),
        center: new THREE.Vector3(),
      },
      memoryEstimate: '0 KB',
    };

    const textures = new Set<THREE.Texture>();
    const materials = new Set<THREE.Material>();
    const box = new THREE.Box3();

    model.traverse(child => {
      if (child instanceof THREE.Mesh) {
        stats.meshes++;
        stats.drawCalls++;

        if (child.geometry) {
          const geometry = child.geometry;

          if (geometry.attributes.position) {
            stats.vertices += geometry.attributes.position.count;
          }

          if (geometry.index) {
            stats.faces += geometry.index.count / 3;
            stats.totalTriangles += geometry.index.count / 3;
          } else if (geometry.attributes.position) {
            const triangles = geometry.attributes.position.count / 3;
            stats.faces += triangles;
            stats.totalTriangles += triangles;
          }

          const meshBox = new THREE.Box3().setFromObject(child);
          box.union(meshBox);
        }

        if (child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach(mat => {
            materials.add(mat);

            if (
              mat instanceof THREE.MeshStandardMaterial ||
              mat instanceof THREE.MeshPhysicalMaterial ||
              mat instanceof THREE.MeshPhongMaterial ||
              mat instanceof THREE.MeshBasicMaterial
            ) {
              this.collectTextures(mat, textures);
            }
          });
        }
      }
    });

    stats.textures = textures.size;
    stats.materials = materials.size;

    box.getCenter(stats.boundingBox.center);
    box.getSize(stats.boundingBox.size);
    stats.boundingBox.min = box.min;
    stats.boundingBox.max = box.max;

    const vertexSize = 3 * 4;
    const normalSize = 3 * 4;
    const uvSize = 2 * 4;
    const indexSize = 4;

    const vertexMemory = stats.vertices * (vertexSize + normalSize + uvSize);
    const indexMemory = stats.faces * 3 * indexSize;
    const totalMemory = vertexMemory + indexMemory;

    if (totalMemory > 1024 * 1024) {
      stats.memoryEstimate = `${(totalMemory / (1024 * 1024)).toFixed(2)} MB`;
    } else {
      stats.memoryEstimate = `${(totalMemory / 1024).toFixed(2)} KB`;
    }

    return stats;
  }

  private collectTextures(material: any, textures: Set<THREE.Texture>): void {
    const textureProperties = [
      'map',
      'normalMap',
      'roughnessMap',
      'metalnessMap',
      'aoMap',
      'emissiveMap',
      'bumpMap',
      'displacementMap',
      'alphaMap',
      'envMap',
    ];

    textureProperties.forEach(prop => {
      if (material[prop] && material[prop] instanceof THREE.Texture) {
        textures.add(material[prop]);
      }
    });
  }

  formatStats(stats: ModelStatistics): string {
    return `
Model Statistics:
- Vertices: ${stats.vertices.toLocaleString()}
- Faces: ${stats.faces.toLocaleString()}
- Triangles: ${stats.totalTriangles.toLocaleString()}
- Draw Calls: ${stats.drawCalls}
- Meshes: ${stats.meshes}
- Materials: ${stats.materials}
- Textures: ${stats.textures}
- Memory (est.): ${stats.memoryEstimate}
- Bounding Box: ${stats.boundingBox.size.x.toFixed(2)} x ${stats.boundingBox.size.y.toFixed(2)} x ${stats.boundingBox.size.z.toFixed(2)}
    `.trim();
  }
}
