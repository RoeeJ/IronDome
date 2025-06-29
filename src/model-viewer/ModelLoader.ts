import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

export class ModelLoader {
  private objLoader: OBJLoader;
  private gltfLoader: GLTFLoader;
  private textureLoader: THREE.TextureLoader;

  constructor() {
    this.objLoader = new OBJLoader();
    this.gltfLoader = new GLTFLoader();
    this.textureLoader = new THREE.TextureLoader();

    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('/node_modules/three/examples/jsm/libs/draco/');
    this.gltfLoader.setDRACOLoader(dracoLoader);
  }

  async load(path: string, type: 'obj' | 'gltf' | 'glb'): Promise<THREE.Object3D> {
    switch (type) {
      case 'obj':
        return this.loadOBJ(path);
      case 'gltf':
      case 'glb':
        return this.loadGLTF(path);
      default:
        throw new Error(`Unsupported model type: ${type}`);
    }
  }

  private loadOBJ(path: string): Promise<THREE.Object3D> {
    return new Promise((resolve, reject) => {
      this.objLoader.load(
        path,
        object => {
          // First pass: compute bounds and find meshes
          const box = new THREE.Box3();
          const meshes: THREE.Mesh[] = [];

          object.traverse(child => {
            if (child instanceof THREE.Mesh) {
              meshes.push(child);
              if (child.geometry) {
                child.geometry.computeBoundingBox();
                box.expandByObject(child);
              }
            }
          });

          // Don't center here - let the main app handle positioning

          // Second pass: apply materials and settings
          meshes.forEach(mesh => {
            if (!mesh.material || (mesh.material as any).name === '') {
              mesh.material = new THREE.MeshPhongMaterial({
                color: 0x8b8b8b,
                specular: 0x111111,
                shininess: 10,
                side: THREE.DoubleSide,
              });
            }

            mesh.castShadow = true;
            mesh.receiveShadow = true;

            if (mesh.geometry) {
              mesh.geometry.computeVertexNormals();
            }
          });

          // Remove any debug planes or helpers
          const toRemove: THREE.Object3D[] = [];
          object.traverse(child => {
            if (
              child.name.toLowerCase().includes('plane') ||
              child.name.toLowerCase().includes('helper') ||
              (child instanceof THREE.Mesh && child.geometry instanceof THREE.PlaneGeometry)
            ) {
              toRemove.push(child);
            }

            // Also check for extremely large or flat geometries that might be debug planes
            if (child instanceof THREE.Mesh && child.geometry) {
              const geomBox = new THREE.Box3().setFromObject(child);
              const size = geomBox.getSize(new THREE.Vector3());
              const minDim = Math.min(size.x, size.y, size.z);
              const maxDim = Math.max(size.x, size.y, size.z);

              // If one dimension is very small compared to others, it might be a plane
              if (
                minDim < maxDim * 0.01 &&
                maxDim > box.getSize(new THREE.Vector3()).length() * 0.5
              ) {
                console.log(`Removing potential debug plane: ${child.name}`, size);
                toRemove.push(child);
              }
            }
          });

          toRemove.forEach(child => {
            if (child.parent) {
              child.parent.remove(child);
            }
          });

          resolve(object);
        },
        progress => {
          const percent = (progress.loaded / progress.total) * 100;
          console.log(`Loading OBJ: ${percent.toFixed(0)}%`);
        },
        error => {
          console.error('Error loading OBJ:', error);
          reject(error);
        }
      );
    });
  }

  private loadGLTF(path: string): Promise<THREE.Object3D> {
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(
        path,
        gltf => {
          const model = gltf.scene;

          model.traverse(child => {
            if (child instanceof THREE.Mesh) {
              child.castShadow = true;
              child.receiveShadow = true;

              if (child.material) {
                if (Array.isArray(child.material)) {
                  child.material.forEach(mat => this.setupMaterial(mat));
                } else {
                  this.setupMaterial(child.material);
                }
              }
            }
          });

          if (gltf.animations && gltf.animations.length > 0) {
            console.log(`Model has ${gltf.animations.length} animations`);
          }

          resolve(model);
        },
        progress => {
          const percent = (progress.loaded / progress.total) * 100;
          console.log(`Loading GLTF: ${percent.toFixed(0)}%`);
        },
        error => {
          console.error('Error loading GLTF:', error);
          reject(error);
        }
      );
    });
  }

  private setupMaterial(material: THREE.Material): void {
    if (
      material instanceof THREE.MeshStandardMaterial ||
      material instanceof THREE.MeshPhysicalMaterial
    ) {
      material.side = THREE.FrontSide;
      material.envMapIntensity = 0.5;

      if (material.metalness > 0.8) {
        material.metalness = 0.8;
      }

      if (material.roughness < 0.1) {
        material.roughness = 0.1;
      }
    }
  }

  async loadTexture(path: string): Promise<THREE.Texture> {
    return new Promise((resolve, reject) => {
      this.textureLoader.load(
        path,
        texture => {
          texture.encoding = THREE.sRGBEncoding;
          texture.anisotropy = 16;
          resolve(texture);
        },
        undefined,
        error => {
          console.error('Error loading texture:', error);
          reject(error);
        }
      );
    });
  }
}
