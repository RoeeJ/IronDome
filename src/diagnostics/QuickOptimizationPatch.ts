/**
 * Quick optimization patch to reduce draw calls by preventing duplicate rendering
 * This is a temporary solution that can be applied immediately while working on
 * the full optimization plan.
 */

export class RenderingOptimizationFlags {
  static useInstancedRendering = true;
  static skipIndividualMeshes = true;
  static reducedTrailPoints = true;
  static disableParticleShadows = true;
  static frustumCullingEnabled = false; // Not yet implemented
  static batchedWorldGeometry = false; // Not yet implemented
}

/**
 * Patches to apply to existing entity classes to skip mesh creation
 * when instanced rendering is active
 */
export function applyRenderingOptimizations() {
  // Monkey patch console.warn to track skipped meshes
  let skippedMeshCount = 0;
  const originalWarn = console.warn;
  console.warn = function(...args: any[]) {
    if (args[0]?.includes('Skipping mesh creation')) {
      skippedMeshCount++;
      return; // Don't spam console
    }
    originalWarn.apply(console, args);
  };

  // Log optimization status
  console.log('[RenderOptimization] Optimizations applied:', {
    instancedRendering: RenderingOptimizationFlags.useInstancedRendering,
    skipIndividualMeshes: RenderingOptimizationFlags.skipIndividualMeshes,
    reducedTrailPoints: RenderingOptimizationFlags.reducedTrailPoints,
    disableParticleShadows: RenderingOptimizationFlags.disableParticleShadows,
  });

  // Return stats function
  return () => ({
    skippedMeshes: skippedMeshCount,
    flags: { ...RenderingOptimizationFlags },
  });
}

/**
 * Modified entity constructor options to support skipping mesh creation
 */
export interface OptimizedEntityOptions {
  skipMeshCreation?: boolean;
  useReducedTrails?: boolean;
  disableShadows?: boolean;
}

/**
 * Helper to check if we should skip creating individual meshes
 */
export function shouldSkipMeshCreation(): boolean {
  return (
    RenderingOptimizationFlags.useInstancedRendering &&
    RenderingOptimizationFlags.skipIndividualMeshes
  );
}

/**
 * Helper to get optimized trail point count
 */
export function getOptimizedTrailPoints(defaultPoints: number): number {
  if (RenderingOptimizationFlags.reducedTrailPoints) {
    // Reduce trail points by 50% for better performance
    return Math.max(10, Math.floor(defaultPoints * 0.5));
  }
  return defaultPoints;
}

/**
 * Helper to determine if an object should cast shadows
 */
export function shouldCastShadows(objectType: 'particle' | 'debris' | 'trail' | 'main'): boolean {
  if (RenderingOptimizationFlags.disableParticleShadows) {
    return objectType === 'main'; // Only main objects cast shadows
  }
  return true;
}

/**
 * Draw call estimation helper
 */
export function estimateDrawCalls(scene: THREE.Scene): {
  meshes: number;
  instances: number;
  lights: number;
  total: number;
} {
  let meshCount = 0;
  let instanceCount = 0;
  let lightCount = 0;

  scene.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      meshCount++;
    } else if (object instanceof THREE.InstancedMesh) {
      instanceCount++;
    } else if (object instanceof THREE.Light && object.visible) {
      lightCount++;
    }
  });

  // Rough estimation including shadow passes
  const shadowMultiplier = 2; // Assumes directional light with shadows
  const total = (meshCount + instanceCount) * shadowMultiplier + lightCount;

  return {
    meshes: meshCount,
    instances: instanceCount,
    lights: lightCount,
    total,
  };
}

/**
 * Performance monitoring helper
 */
export class DrawCallMonitor {
  private renderer: THREE.WebGLRenderer;
  private history: number[] = [];
  private maxHistory = 60;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
  }

  update(): void {
    const drawCalls = this.renderer.info.render.calls;
    this.history.push(drawCalls);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  getStats() {
    if (this.history.length === 0) return { current: 0, average: 0, max: 0, min: 0 };

    const current = this.history[this.history.length - 1];
    const average = this.history.reduce((a, b) => a + b, 0) / this.history.length;
    const max = Math.max(...this.history);
    const min = Math.min(...this.history);

    return { current, average, max, min };
  }

  reset(): void {
    this.renderer.info.reset();
  }
}