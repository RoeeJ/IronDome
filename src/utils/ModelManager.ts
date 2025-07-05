import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ModelConfig, ModelId, ModelPartsConfig, getModelConfig } from '../config/ModelRegistry';
import { debug } from './logger';

export interface LoadedModel {
  scene: THREE.Object3D;
  animations?: THREE.AnimationClip[];
  originalConfig: ModelConfig;
  hiddenParts: string[];
  dynamicParts: string[];
}

export class ModelManager {
  private static instance: ModelManager;
  private modelCache: Map<ModelId, LoadedModel> = new Map();
  private objLoader: OBJLoader;
  private gltfLoader: GLTFLoader;
  private partsConfig: ModelPartsConfig;

  private constructor() {
    this.objLoader = new OBJLoader();
    this.gltfLoader = new GLTFLoader();
    this.partsConfig = ModelPartsConfig.getInstance();
  }

  static getInstance(): ModelManager {
    if (!ModelManager.instance) {
      ModelManager.instance = new ModelManager();
    }
    return ModelManager.instance;
  }

  async loadModel(
    modelId: ModelId,
    options?: {
      forceReload?: boolean;
      additionalHiddenParts?: string[];
      applyTransforms?: boolean;
    }
  ): Promise<LoadedModel> {
    const config = getModelConfig(modelId);

    if (!options?.forceReload && this.modelCache.has(modelId)) {
      debug.module('ModelManager').log(`Loading ${modelId} from cache`);
      const cached = this.modelCache.get(modelId)!;
      const cloned = this.cloneModel(cached);

      if (options?.additionalHiddenParts) {
        this.hidePartsInModel(cloned.scene, options.additionalHiddenParts);
      }

      return cloned;
    }

    debug.module('ModelManager').log(`Loading model: ${modelId} from ${config.path}`);

    try {
      const model = await this.loadModelByType(config);

      if (config.scale) {
        model.scene.scale.setScalar(config.scale);
      }

      if (options?.applyTransforms && config.transforms) {
        if (config.transforms.position) {
          model.scene.position.set(
            config.transforms.position.x,
            config.transforms.position.y,
            config.transforms.position.z
          );
        }
        if (config.transforms.rotation) {
          model.scene.rotation.set(
            config.transforms.rotation.x,
            config.transforms.rotation.y,
            config.transforms.rotation.z
          );
        }
      }

      const hiddenParts = this.partsConfig.getHiddenParts(modelId);
      const dynamicParts = this.partsConfig.getDynamicParts(modelId);

      if (options?.additionalHiddenParts) {
        hiddenParts.push(...options.additionalHiddenParts);
      }

      if (hiddenParts.length > 0) {
        debug.module('ModelManager').log(`Hiding parts for ${modelId}:`, hiddenParts);
        this.hidePartsInModel(model.scene, hiddenParts);
      }

      model.hiddenParts = hiddenParts;
      model.dynamicParts = dynamicParts;
      this.modelCache.set(modelId, model);

      return this.cloneModel(model);
    } catch (error) {
      debug.error(`Failed to load model ${modelId}:`, error);
      throw error;
    }
  }

  private async loadModelByType(config: ModelConfig): Promise<LoadedModel> {
    return new Promise((resolve, reject) => {
      switch (config.type) {
        case 'obj':
          this.objLoader.load(
            config.path,
            object => {
              resolve({
                scene: object,
                originalConfig: config,
                hiddenParts: [],
                dynamicParts: [],
              });
            },
            xhr => {
              debug
                .module('ModelManager')
                .log(`Loading ${config.name}: ${((xhr.loaded / xhr.total) * 100).toFixed(0)}%`);
            },
            error => reject(error)
          );
          break;

        case 'gltf':
        case 'glb':
          this.gltfLoader.load(
            config.path,
            gltf => {
              resolve({
                scene: gltf.scene,
                animations: gltf.animations,
                originalConfig: config,
                hiddenParts: [],
                dynamicParts: [],
              });
            },
            xhr => {
              debug
                .module('ModelManager')
                .log(`Loading ${config.name}: ${((xhr.loaded / xhr.total) * 100).toFixed(0)}%`);
            },
            error => reject(error)
          );
          break;

        default:
          reject(new Error(`Unsupported model type: ${config.type}`));
      }
    });
  }

  private hidePartsInModel(model: THREE.Object3D, partNames: string[]): void {
    const partsSet = new Set(partNames);
    let hiddenCount = 0;

    model.traverse(child => {
      if (child.name && partsSet.has(child.name)) {
        child.visible = false;
        hiddenCount++;
        debug.module('ModelManager').log(`Hidden part: ${child.name}, visible = ${child.visible}`);
      }
    });

    debug
      .module('ModelManager')
      .log(`Hidden ${hiddenCount} parts out of ${partNames.length} requested`);
  }

  showPartsInModel(model: THREE.Object3D, partNames: string[]): void {
    const partsSet = new Set(partNames);

    model.traverse(child => {
      if (child.name && partsSet.has(child.name)) {
        child.visible = true;
        debug.module('ModelManager').log(`Shown part: ${child.name}`);
      }
    });
  }

  togglePartsInModel(model: THREE.Object3D, partNames: string[]): void {
    const partsSet = new Set(partNames);

    model.traverse(child => {
      if (child.name && partsSet.has(child.name)) {
        child.visible = !child.visible;
        debug.module('ModelManager').log(`Toggled part: ${child.name} (visible: ${child.visible})`);
      }
    });
  }

  getModelParts(model: THREE.Object3D): string[] {
    const parts: string[] = [];

    model.traverse(child => {
      if (
        child.name &&
        child !== model &&
        !child.name.includes('Scene') &&
        !child.name.includes('RootNode')
      ) {
        parts.push(child.name);
      }
    });

    return parts;
  }

  private cloneModel(model: LoadedModel): LoadedModel {
    const newScene = model.scene.clone(true);

    // Debug: Check if visibility was preserved after clone
    if (model.hiddenParts.length > 0) {
      debug.module('ModelManager').log('Checking cloned model visibility:');
      model.hiddenParts.forEach(partName => {
        newScene.traverse(child => {
          if (child.name === partName) {
            debug.module('ModelManager').log(`Cloned part ${partName}: visible = ${child.visible}`);
          }
        });
      });

      // Re-hide parts after cloning (THREE.js clone doesn't preserve visibility correctly)
      this.hidePartsInModel(newScene, model.hiddenParts);
    }

    return {
      scene: newScene,
      animations: model.animations ? [...model.animations] : undefined,
      originalConfig: model.originalConfig,
      hiddenParts: [...model.hiddenParts],
      dynamicParts: [...model.dynamicParts],
    };
  }

  async preloadModels(modelIds: ModelId[]): Promise<void> {
    debug.module('ModelManager').log(`Preloading ${modelIds.length} models...`);

    const promises = modelIds.map(id =>
      this.loadModel(id).catch(err => {
        debug.error(`Failed to preload ${id}:`, err);
      })
    );

    await Promise.all(promises);
    debug.module('ModelManager').log('Preloading complete');
  }

  clearCache(modelId?: ModelId): void {
    if (modelId) {
      this.modelCache.delete(modelId);
      debug.module('ModelManager').log(`Cleared cache for ${modelId}`);
    } else {
      this.modelCache.clear();
      debug.module('ModelManager').log('Cleared entire model cache');
    }
  }

  getCachedModels(): ModelId[] {
    return Array.from(this.modelCache.keys());
  }

  getDynamicParts(modelId: ModelId): string[] {
    const model = this.modelCache.get(modelId);
    return model ? model.dynamicParts : [];
  }
}
