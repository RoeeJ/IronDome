/**
 * Texture cache to prevent texture duplication and shader program explosion
 */

import * as THREE from 'three';

export class TextureCache {
  private static instance: TextureCache;
  private textures: Map<string, THREE.Texture> = new Map();

  static getInstance(): TextureCache {
    if (!TextureCache.instance) {
      TextureCache.instance = new TextureCache();
    }
    return TextureCache.instance;
  }

  private constructor() {}

  /**
   * Get or create a particle texture for trails/effects
   */
  getParticleTexture(
    size: number = 64,
    colors: { inner: string; outer: string } = {
      inner: 'rgba(255,255,255,1)',
      outer: 'rgba(255,200,100,0)',
    }
  ): THREE.Texture {
    const key = `particle_${size}_${colors.inner}_${colors.outer}`;

    let texture = this.textures.get(key);
    if (!texture) {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d')!;

      const gradient = context.createRadialGradient(
        size / 2,
        size / 2,
        0,
        size / 2,
        size / 2,
        size / 2
      );
      gradient.addColorStop(0, colors.inner);
      gradient.addColorStop(1, colors.outer);

      context.fillStyle = gradient;
      context.fillRect(0, 0, size, size);

      texture = new THREE.CanvasTexture(canvas);
      texture.needsUpdate = true;
      this.textures.set(key, texture);
    }

    return texture;
  }

  /**
   * Get or create an explosion texture
   */
  getExplosionTexture(size: number = 128): THREE.Texture {
    const key = `explosion_${size}`;

    let texture = this.textures.get(key);
    if (!texture) {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d')!;

      // Create explosion texture with multiple rings
      const centerX = size / 2;
      const centerY = size / 2;
      const radius = size / 2;

      const gradient = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.1, 'rgba(255,200,100,0.8)');
      gradient.addColorStop(0.4, 'rgba(255,100,0,0.4)');
      gradient.addColorStop(1, 'rgba(100,0,0,0)');

      context.fillStyle = gradient;
      context.fillRect(0, 0, size, size);

      texture = new THREE.CanvasTexture(canvas);
      texture.needsUpdate = true;
      this.textures.set(key, texture);
    }

    return texture;
  }

  /**
   * Get or create a gradient texture
   */
  getGradientTexture(width: number, height: number, colors: string[]): THREE.Texture {
    const key = `gradient_${width}_${height}_${colors.join('_')}`;

    let texture = this.textures.get(key);
    if (!texture) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d')!;

      const gradient = context.createLinearGradient(0, 0, 0, height);
      colors.forEach((color, index) => {
        gradient.addColorStop(index / (colors.length - 1), color);
      });

      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);

      texture = new THREE.CanvasTexture(canvas);
      texture.needsUpdate = true;
      this.textures.set(key, texture);
    }

    return texture;
  }

  /**
   * Get cache statistics
   */
  getStats(): { textureCount: number; keys: string[] } {
    return {
      textureCount: this.textures.size,
      keys: Array.from(this.textures.keys()),
    };
  }

  /**
   * Clear all cached textures (for cleanup)
   */
  clear(): void {
    this.textures.forEach(texture => texture.dispose());
    this.textures.clear();
  }
}
