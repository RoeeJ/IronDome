import * as THREE from 'three';

/**
 * Material cache to prevent shader recompilation when creating multiple objects
 * with the same material properties. This is critical for performance when
 * spawning multiple batteries or other objects.
 *
 * Background: WebGL compiles shaders on first use of a material/lights combination.
 * This compilation can take 1000+ ms and causes frame drops. By reusing materials,
 * we ensure shaders are only compiled once.
 *
 * Usage:
 * ```typescript
 * const material = MaterialCache.getInstance().getMeshStandardMaterial({
 *   color: 0x4a4a4a,
 *   roughness: 0.8,
 *   metalness: 0.3
 * })
 * ```
 */
export class MaterialCache {
  private static instance: MaterialCache;
  private materials = new Map<string, THREE.Material>();

  private constructor() {}

  static getInstance(): MaterialCache {
    if (!this.instance) {
      this.instance = new MaterialCache();
    }
    return this.instance;
  }

  private materialKey(kind: string, properties: object): string {
    const encode = (value: unknown): unknown => {
      if (value instanceof THREE.Texture) return { texture: value.uuid };
      if (value instanceof THREE.Color) return { color: value.toArray() };
      if (Array.isArray(value)) return value.map(encode);
      if (value && typeof value === 'object')
        return Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, encode(item)])
        );
      return value;
    };
    return `${kind}_${JSON.stringify(encode(properties))}`;
  }

  /**
   * Get or create a MeshStandardMaterial with the given properties
   */
  getMeshStandardMaterial(
    properties: THREE.MeshStandardMaterialParameters
  ): THREE.MeshStandardMaterial {
    const key = this.materialKey('standard', properties);

    let material = this.materials.get(key) as THREE.MeshStandardMaterial;
    if (!material) {
      material = new THREE.MeshStandardMaterial(properties);
      this.materials.set(key, material);
    }

    return material;
  }

  /**
   * Get or create a MeshBasicMaterial with the given properties
   */
  getMeshBasicMaterial(properties: THREE.MeshBasicMaterialParameters): THREE.MeshBasicMaterial {
    const key = this.materialKey('basic', properties);

    let material = this.materials.get(key) as THREE.MeshBasicMaterial;
    if (!material) {
      material = new THREE.MeshBasicMaterial(properties);
      this.materials.set(key, material);
    }

    return material;
  }

  /**
   * Get or create a MeshStandardMaterial with emissive properties
   */
  getMeshEmissiveMaterial(
    properties: THREE.MeshStandardMaterialParameters
  ): THREE.MeshStandardMaterial {
    const key = this.materialKey('emissive', properties);

    let material = this.materials.get(key) as THREE.MeshStandardMaterial;
    if (!material) {
      material = new THREE.MeshStandardMaterial(properties);
      this.materials.set(key, material);
    }

    return material;
  }

  /**
   * Get or create a transparent MeshStandardMaterial
   */
  getMeshTransparentMaterial(
    properties: THREE.MeshStandardMaterialParameters
  ): THREE.MeshStandardMaterial {
    const key = this.materialKey('transparent', properties);

    let material = this.materials.get(key) as THREE.MeshStandardMaterial;
    if (!material) {
      material = new THREE.MeshStandardMaterial({
        ...properties,
        transparent: true,
      });
      this.materials.set(key, material);
    }

    return material;
  }

  /**
   * Get or create a LineBasicMaterial
   */
  getLineMaterial(properties: THREE.LineBasicMaterialParameters): THREE.LineBasicMaterial {
    const key = this.materialKey('line', properties);

    let material = this.materials.get(key) as THREE.LineBasicMaterial;
    if (!material) {
      material = new THREE.LineBasicMaterial(properties);
      this.materials.set(key, material);
    }

    return material;
  }

  /**
   * Get or create a PointsMaterial
   */
  getPointsMaterial(properties: THREE.PointsMaterialParameters): THREE.PointsMaterial {
    const key = this.materialKey('points', properties);

    let material = this.materials.get(key) as THREE.PointsMaterial;
    if (!material) {
      material = new THREE.PointsMaterial(properties);
      this.materials.set(key, material);
    }

    return material;
  }

  /**
   * Pre-compile shaders for all cached materials
   * Call this during initialization to avoid runtime compilation
   */
  precompileShaders(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    const tempMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    scene.add(tempMesh);

    this.materials.forEach(material => {
      tempMesh.material = material;
      renderer.compile(scene, camera);
    });

    scene.remove(tempMesh);
    tempMesh.geometry.dispose();
  }

  /**
   * Clear all cached materials
   */
  clear(): void {
    this.materials.forEach(material => material.dispose());
    this.materials.clear();
  }

  /**
   * Get the number of cached materials
   */
  getSize(): number {
    return this.materials.size;
  }
}
