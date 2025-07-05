import * as THREE from 'three';

export interface ModelConfig {
  id: string;
  name: string;
  path: string;
  type: 'obj' | 'gltf' | 'glb';
  scale?: number;
  hiddenParts: string[]; // Parts to hide by default
  dynamicParts?: string[]; // Parts that can be dynamically toggled
  transforms?: {
    position?: { x: number; y: number; z: number };
    rotation?: { x: number; y: number; z: number };
  };
  category?: 'defense' | 'interceptor' | 'threat' | 'effect';
  description?: string;
}

// Type-safe model IDs
export const MODEL_IDS = {
  // Defense Systems
  BATTERY: 'battery',
  RADAR: 'radar',
  LASER_CANNON: 'laser-cannon',

  // Interceptors
  TAMIR_ORIGINAL: 'tamir-original',
  TAMIR_OPTIMIZED: 'tamir-optimized',
  TAMIR_SIMPLE: 'tamir-simple',
  TAMIR_ULTRA: 'tamir-ultra',

  // Strategic Defense
  ARROW_1: 'arrow-1',
  ARROW_2: 'arrow-2',
} as const;

export type ModelId = (typeof MODEL_IDS)[keyof typeof MODEL_IDS];

// Central model configuration repository
export const MODEL_CONFIGS: Record<ModelId, ModelConfig> = {
  // Defense Systems
  [MODEL_IDS.BATTERY]: {
    id: MODEL_IDS.BATTERY,
    name: 'Iron Dome Battery',
    path: '/assets/Battery.obj',
    type: 'obj',
    scale: 0.01,
    hiddenParts: [
      'Part24',
      'Part25',
      'Part26',
      'Part27',
      'Part299',
      'Part300',
      'Part301',
      'Part302',
      'Part303',
      'Part304',
      'Part305',
      'Part306',
      'Part307',
      'Part308',
    ], // Default hidden parts
    category: 'defense',
    description: 'Mobile air defense battery with 20 launch tubes',
  },

  [MODEL_IDS.RADAR]: {
    id: MODEL_IDS.RADAR,
    name: 'Radar System',
    path: '/assets/Radar.obj',
    type: 'obj',
    scale: 0.01,
    hiddenParts: [],
    category: 'defense',
    description: 'Early warning and tracking radar',
  },

  [MODEL_IDS.LASER_CANNON]: {
    id: MODEL_IDS.LASER_CANNON,
    name: 'Laser Cannon',
    path: '/assets/laser_cannon/scene.gltf',
    type: 'gltf',
    hiddenParts: ['Cylinder007_0'], // Hide this specific part
    category: 'defense',
    description: 'Advanced directed energy weapon system',
  },

  // Interceptors
  [MODEL_IDS.TAMIR_ORIGINAL]: {
    id: MODEL_IDS.TAMIR_ORIGINAL,
    name: 'Tamir Original',
    path: '/assets/tamir/scene.gltf',
    type: 'gltf',
    hiddenParts: [],
    category: 'interceptor',
    description: 'Full detail Tamir interceptor missile',
  },

  [MODEL_IDS.TAMIR_OPTIMIZED]: {
    id: MODEL_IDS.TAMIR_OPTIMIZED,
    name: 'Tamir Optimized',
    path: '/assets/tamir/scene_optimized.glb',
    type: 'glb',
    hiddenParts: [],
    category: 'interceptor',
    description: 'Performance-optimized Tamir model',
  },

  [MODEL_IDS.TAMIR_SIMPLE]: {
    id: MODEL_IDS.TAMIR_SIMPLE,
    name: 'Tamir Simple',
    path: '/assets/tamir/scene_simple.glb',
    type: 'glb',
    hiddenParts: [],
    category: 'interceptor',
    description: 'Reduced polygon Tamir for mobile',
  },

  [MODEL_IDS.TAMIR_ULTRA]: {
    id: MODEL_IDS.TAMIR_ULTRA,
    name: 'Tamir Ultra Simple',
    path: '/assets/tamir/scene_ultra_simple.glb',
    type: 'glb',
    hiddenParts: [],
    category: 'interceptor',
    description: 'Minimal geometry Tamir for performance',
  },

  // Strategic Defense
  [MODEL_IDS.ARROW_1]: {
    id: MODEL_IDS.ARROW_1,
    name: 'Arrow-3 System',
    path: '/assets/arrow/israels_arrow-3_missile_defense_system.glb',
    type: 'glb',
    hiddenParts: [],
    category: 'defense',
    description: 'Exo-atmospheric interceptor system',
  },

  [MODEL_IDS.ARROW_2]: {
    id: MODEL_IDS.ARROW_2,
    name: 'Arrow-3 (Alt)',
    path: '/assets/arrow/israels_arrow-3_missile_defense_system (1).glb',
    type: 'glb',
    hiddenParts: [],
    category: 'defense',
    description: 'Alternative Arrow-3 model variant',
  },
};

// Helper function to get config by ID
export function getModelConfig(id: ModelId): ModelConfig {
  const config = MODEL_CONFIGS[id];
  if (!config) {
    throw new Error(`Model config not found for ID: ${id}`);
  }
  return config;
}

// Helper function to get all models in a category
export function getModelsByCategory(category: ModelConfig['category']): ModelConfig[] {
  return Object.values(MODEL_CONFIGS).filter(config => config.category === category);
}

// Runtime configuration for dynamic part hiding
export class ModelPartsConfig {
  private static instance: ModelPartsConfig;
  private runtimeHiddenParts: Map<ModelId, Set<string>> = new Map();

  static getInstance(): ModelPartsConfig {
    if (!ModelPartsConfig.instance) {
      ModelPartsConfig.instance = new ModelPartsConfig();
    }
    return ModelPartsConfig.instance;
  }

  // Add parts to hide at runtime
  addHiddenParts(modelId: ModelId, parts: string[]): void {
    if (!this.runtimeHiddenParts.has(modelId)) {
      this.runtimeHiddenParts.set(modelId, new Set());
    }
    const hiddenSet = this.runtimeHiddenParts.get(modelId)!;
    parts.forEach(part => hiddenSet.add(part));
  }

  // Remove parts from hidden list
  removeHiddenParts(modelId: ModelId, parts: string[]): void {
    const hiddenSet = this.runtimeHiddenParts.get(modelId);
    if (hiddenSet) {
      parts.forEach(part => hiddenSet.delete(part));
    }
  }

  // Get all hidden parts for a model (config + runtime)
  getHiddenParts(modelId: ModelId): string[] {
    const config = MODEL_CONFIGS[modelId];
    const configParts = config?.hiddenParts || [];
    const runtimeParts = Array.from(this.runtimeHiddenParts.get(modelId) || []);
    return [...new Set([...configParts, ...runtimeParts])];
  }

  // Get dynamic parts for a model
  getDynamicParts(modelId: ModelId): string[] {
    const config = MODEL_CONFIGS[modelId];
    return config?.dynamicParts || [];
  }

  // Clear runtime hidden parts
  clearRuntimeHiddenParts(modelId?: ModelId): void {
    if (modelId) {
      this.runtimeHiddenParts.delete(modelId);
    } else {
      this.runtimeHiddenParts.clear();
    }
  }
}
