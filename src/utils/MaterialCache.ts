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

  /**
   * Get or create a MeshStandardMaterial with the given properties
   */
  getMeshStandardMaterial(properties: {
    color: number;
    roughness: number;
    metalness: number;
  }): THREE.MeshStandardMaterial {
    const key = `standard_${properties.color}_${properties.roughness}_${properties.metalness}`;

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
  getMeshBasicMaterial(properties: {
    color?: number;
    transparent?: boolean;
    opacity?: number;
    visible?: boolean;
    side?: THREE.Side;
    depthWrite?: boolean;
    blending?: THREE.Blending;
    map?: THREE.Texture;
  }): THREE.MeshBasicMaterial {
    const key = `basic_${properties.color ?? 0}_${properties.transparent ?? false}_${properties.opacity ?? 1}_${properties.visible ?? true}_${properties.side ?? THREE.FrontSide}_${properties.depthWrite ?? true}_${properties.blending ?? THREE.NormalBlending}_${properties.map ? 'textured' : 'untextured'}`;

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
  getMeshEmissiveMaterial(properties: {
    color: number;
    emissive: number;
    emissiveIntensity: number;
    roughness: number;
    metalness: number;
  }): THREE.MeshStandardMaterial {
    const key = `emissive_${properties.color}_${properties.emissive}_${properties.emissiveIntensity}_${properties.roughness}_${properties.metalness}`;

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
  getMeshTransparentMaterial(properties: {
    color: number;
    opacity: number;
    roughness: number;
    metalness: number;
    emissive?: number;
    emissiveIntensity?: number;
  }): THREE.MeshStandardMaterial {
    const key = `transparent_${properties.color}_${properties.opacity}_${properties.roughness}_${properties.metalness}_${properties.emissive ?? 0}_${properties.emissiveIntensity ?? 0}`;

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
  getLineMaterial(properties: {
    color: number;
    linewidth?: number;
    opacity?: number;
    transparent?: boolean;
  }): THREE.LineBasicMaterial {
    const key = `line_${properties.color}_${properties.linewidth ?? 1}_${properties.opacity ?? 1}_${properties.transparent ?? false}`;

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
  getPointsMaterial(properties: {
    color: number;
    size: number;
    sizeAttenuation?: boolean;
    transparent?: boolean;
    opacity?: number;
    vertexColors?: boolean;
    blending?: THREE.Blending;
    depthWrite?: boolean;
  }): THREE.PointsMaterial {
    const key = `points_${properties.color}_${properties.size}_${properties.sizeAttenuation ?? true}_${properties.transparent ?? false}_${properties.opacity ?? 1}_${properties.vertexColors ?? false}_${properties.blending ?? THREE.NormalBlending}_${properties.depthWrite ?? true}`;

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
