import * as THREE from 'three';
import { VertexNormalsHelper } from 'three/examples/jsm/helpers/VertexNormalsHelper.js';

export class ViewerControls {
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private renderer: THREE.WebGLRenderer;

  private model?: THREE.Object3D;
  private wireframeEnabled = false;
  private normalsEnabled = false;
  private boundsEnabled = false;

  private normalHelpers: VertexNormalsHelper[] = [];
  private boundingBoxHelper?: THREE.BoxHelper;
  private originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();

  constructor(scene: THREE.Scene, camera: THREE.Camera, renderer: THREE.WebGLRenderer) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
  }

  setModel(model: THREE.Object3D): void {
    this.clearHelpers();
    this.model = model;
    this.originalMaterials.clear();

    model.traverse(child => {
      if (child instanceof THREE.Mesh && child.material) {
        this.originalMaterials.set(child, child.material);
      }
    });
  }

  toggleWireframe(): void {
    if (!this.model) return;

    this.wireframeEnabled = !this.wireframeEnabled;
    const btn = document.getElementById('btn-wireframe');
    btn?.classList.toggle('active', this.wireframeEnabled);

    this.model.traverse(child => {
      if (child instanceof THREE.Mesh && child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(mat => {
            if ('wireframe' in mat) {
              (mat as any).wireframe = this.wireframeEnabled;
            }
          });
        } else if ('wireframe' in child.material) {
          (child.material as any).wireframe = this.wireframeEnabled;
        }
      }
    });
  }

  toggleNormals(): void {
    if (!this.model) return;

    this.normalsEnabled = !this.normalsEnabled;
    const btn = document.getElementById('btn-normals');
    btn?.classList.toggle('active', this.normalsEnabled);

    if (this.normalsEnabled) {
      this.model.traverse(child => {
        if (child instanceof THREE.Mesh && child.geometry) {
          const helper = new VertexNormalsHelper(child, 0.1, 0xff0000);
          this.normalHelpers.push(helper);
          this.scene.add(helper);
        }
      });
    } else {
      this.normalHelpers.forEach(helper => {
        this.scene.remove(helper);
        helper.dispose();
      });
      this.normalHelpers = [];
    }
  }

  toggleBounds(): void {
    if (!this.model) return;

    this.boundsEnabled = !this.boundsEnabled;
    const btn = document.getElementById('btn-bounds');
    btn?.classList.toggle('active', this.boundsEnabled);

    if (this.boundsEnabled) {
      this.boundingBoxHelper = new THREE.BoxHelper(this.model, 0x00ff00);
      this.scene.add(this.boundingBoxHelper);
    } else if (this.boundingBoxHelper) {
      this.scene.remove(this.boundingBoxHelper);
      this.boundingBoxHelper = undefined;
    }
  }

  clearHelpers(): void {
    this.normalHelpers.forEach(helper => {
      this.scene.remove(helper);
      helper.dispose();
    });
    this.normalHelpers = [];

    if (this.boundingBoxHelper) {
      this.scene.remove(this.boundingBoxHelper);
      this.boundingBoxHelper = undefined;
    }

    if (this.model && this.wireframeEnabled) {
      this.model.traverse(child => {
        if (child instanceof THREE.Mesh) {
          const original = this.originalMaterials.get(child);
          if (original) {
            child.material = original;
          }
        }
      });
    }

    this.wireframeEnabled = false;
    this.normalsEnabled = false;
    this.boundsEnabled = false;

    document.getElementById('btn-wireframe')?.classList.remove('active');
    document.getElementById('btn-normals')?.classList.remove('active');
    document.getElementById('btn-bounds')?.classList.remove('active');
  }

  update(): void {
    if (this.boundingBoxHelper && this.model) {
      this.boundingBoxHelper.update();
    }

    this.normalHelpers.forEach(helper => {
      helper.update();
    });
  }
}
