import * as THREE from 'three';

interface ExplosionInstance {
  id: string;
  index: number;
  position: THREE.Vector3;
  startTime: number;
  duration: number;
  maxScale: number;
  quality: number;
  active: boolean;
  type: 'air' | 'ground';
  smokeDuration?: number; // Separate duration for smoke
}

export class InstancedExplosionRenderer {
  private scene: THREE.Scene;
  private maxExplosions: number;

  // Separate meshes for different explosion types
  private sphereMesh: THREE.InstancedMesh;
  private flashMesh: THREE.InstancedMesh;
  private smokeMesh: THREE.InstancedMesh;

  private explosions: ExplosionInstance[] = [];
  private availableIndices: number[] = [];
  private activeExplosions = new Map<string, ExplosionInstance>();
  private dummy = new THREE.Object3D();

  // Materials for animated effects
  private explosionMaterial: THREE.MeshBasicMaterial;
  private flashMaterial: THREE.MeshBasicMaterial;
  private smokeMaterial: THREE.MeshBasicMaterial;

  // Launch effect style animations
  private activeEffects: Array<{ update: () => boolean }> = [];

  private cachedSmokeTexture: THREE.Texture | null = null;
  constructor(scene: THREE.Scene, maxExplosions: number = 100) {
    this.scene = scene;
    this.maxExplosions = maxExplosions;

    // Create gradient material with emissive glow
    this.explosionMaterial = new THREE.MeshBasicMaterial({
      color: 0xffaa00, // Orange base
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending, // Additive for bright explosion
    }) as any;

    // Create simple flash material
    this.flashMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffdd,
      transparent: true,
      opacity: 1.0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending, // Additive for bright flash
    }) as any;

    // Simple smoke material
    this.smokeMaterial = new THREE.MeshBasicMaterial({
      color: 0x555555, // Medium gray smoke
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      side: THREE.DoubleSide,
    }) as any;

    // Create geometries with reduced complexity
    const sphereGeometry = new THREE.SphereGeometry(1, 8, 6); // Reduced from 16x8
    const flashGeometry = new THREE.PlaneGeometry(2, 2);
    const smokeGeometry = new THREE.SphereGeometry(1, 6, 4); // Simple sphere for smoke clouds

    // Create instanced meshes
    this.sphereMesh = new THREE.InstancedMesh(
      sphereGeometry,
      this.explosionMaterial,
      maxExplosions
    );
    this.flashMesh = new THREE.InstancedMesh(flashGeometry, this.flashMaterial, maxExplosions);
    this.smokeMesh = new THREE.InstancedMesh(smokeGeometry, this.smokeMaterial, maxExplosions);

    // Configure meshes
    this.sphereMesh.frustumCulled = false;
    this.flashMesh.frustumCulled = false;
    this.smokeMesh.frustumCulled = false;

    // Initialize all instances as invisible
    const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < maxExplosions; i++) {
      this.sphereMesh.setMatrixAt(i, zeroScale);
      this.flashMesh.setMatrixAt(i, zeroScale);
      this.smokeMesh.setMatrixAt(i, zeroScale);
      this.availableIndices.push(i);
    }
    this.sphereMesh.instanceMatrix.needsUpdate = true;
    this.flashMesh.instanceMatrix.needsUpdate = true;
    this.smokeMesh.instanceMatrix.needsUpdate = true;

    // Add to scene with proper render order
    this.sphereMesh.renderOrder = 2; // Render explosion on top
    this.flashMesh.renderOrder = 3; // Flash renders last (brightest)
    this.smokeMesh.renderOrder = 1; // Smoke renders first (background)

    this.scene.add(this.smokeMesh);
    this.scene.add(this.sphereMesh);
    this.scene.add(this.flashMesh);
  }

  createExplosion(
    position: THREE.Vector3,
    quality: number = 1.0,
    type: 'air' | 'ground' = 'ground'
  ): void {
    if (this.availableIndices.length === 0) {
      return;
    }

    const index = this.availableIndices.pop()!;
    const id = `explosion_${Date.now()}_${Math.random()}`;

    const explosion: ExplosionInstance = {
      id,
      index,
      position: position.clone(),
      startTime: Date.now(),
      duration: 600 + quality * 200, // 0.6 to 0.8 seconds (faster main explosion)
      maxScale: 2 + quality * 2.5, // 2 to 4.5 based on quality (smaller)
      quality,
      active: true,
      type,
      smokeDuration: 1000 + quality * 500, // 1.0-1.5 seconds for smoke
    };

    this.activeExplosions.set(id, explosion);

    // Create launch effect style smoke and dust
    this.createLaunchStyleEffects(position, quality, type);
  }

  update(): void {
    const currentTime = Date.now();

    // Update launch style effects
    this.activeEffects = this.activeEffects.filter(effect => effect.update());

    // Performance optimization: Limit active effects
    const maxActiveEffects = 20;
    if (this.activeEffects.length > maxActiveEffects) {
      console.warn(
        `Too many active effects (${this.activeEffects.length}), performance may be impacted`
      );
    }

    // Update all active explosions
    this.activeExplosions.forEach((explosion, id) => {
      const elapsed = currentTime - explosion.startTime;
      const progress = Math.min(elapsed / explosion.duration, 1);
      const smokeProgress = Math.min(elapsed / (explosion.smokeDuration || explosion.duration), 1);

      // Only remove when smoke is also done
      if (smokeProgress >= 1) {
        this.removeExplosion(id);
        return;
      }

      // Calculate scale with easing
      const easeOutQuad = 1 - Math.pow(1 - progress, 2);
      const scale = explosion.maxScale * easeOutQuad;

      // Main explosion sphere (hide after it completes)
      if (progress < 1) {
        // Fade out by reducing scale in the last 20% of animation
        let finalScale = scale;
        if (progress > 0.8) {
          const fadeProgress = (progress - 0.8) / 0.2;
          finalScale = scale * (1 - fadeProgress);
        }

        // Update main explosion sphere
        this.dummy.position.copy(explosion.position);
        this.dummy.scale.setScalar(finalScale);
        this.dummy.updateMatrix();
        this.sphereMesh.setMatrixAt(explosion.index, this.dummy.matrix);
      } else {
        // Hide main explosion after it completes
        const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0);
        this.sphereMesh.setMatrixAt(explosion.index, zeroScale);
      }

      // Update flash (only for first 20% of explosion)
      if (progress < 0.2) {
        const flashScale = scale * 1.5;
        const flashOpacity = 1 - progress / 0.2;
        this.dummy.scale.setScalar(flashScale * flashOpacity);

        // Make flash face camera
        const camera = (window as any).__camera;
        if (camera) {
          this.dummy.lookAt(camera.position);
        }

        this.dummy.updateMatrix();
        this.flashMesh.setMatrixAt(explosion.index, this.dummy.matrix);
      } else {
        // Hide flash
        const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0);
        this.flashMesh.setMatrixAt(explosion.index, zeroScale);
      }

      // Update smoke mesh (appears after explosion, lingers longer)
      if (explosion.quality > 0.3 && progress > 0.7) {
        // Use smokeProgress which has longer duration
        const smokePhase = Math.min((smokeProgress - 0.3) / 0.7, 1); // 0-1 for smoke lifetime

        // Position smoke at explosion center
        this.dummy.position.copy(explosion.position);

        // Smoke starts at explosion size and expands slowly
        const smokeScale = explosion.maxScale * (0.8 + smokePhase * 0.4); // 80% to 120% of explosion size
        const smokeFade = Math.pow(1 - smokePhase, 0.5); // Slower fade

        this.dummy.scale.setScalar(smokeScale * smokeFade);
        this.dummy.rotation.set(0, smokePhase * Math.PI * 0.5, 0);
        this.dummy.updateMatrix();
        this.smokeMesh.setMatrixAt(explosion.index, this.dummy.matrix);
      } else {
        // Hide smoke before it appears
        const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0);
        this.smokeMesh.setMatrixAt(explosion.index, zeroScale);
      }
    });

    // Update instance matrices if there were active explosions
    if (this.activeExplosions.size > 0) {
      this.sphereMesh.instanceMatrix.needsUpdate = true;
      this.flashMesh.instanceMatrix.needsUpdate = true;
      this.smokeMesh.instanceMatrix.needsUpdate = true;
    }
  }

  private removeExplosion(id: string): void {
    const explosion = this.activeExplosions.get(id);
    if (!explosion) return;

    // Hide all instances
    const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0);
    this.sphereMesh.setMatrixAt(explosion.index, zeroScale);
    this.flashMesh.setMatrixAt(explosion.index, zeroScale);
    this.smokeMesh.setMatrixAt(explosion.index, zeroScale);

    // Return index to pool
    this.availableIndices.push(explosion.index);
    this.activeExplosions.delete(id);
  }

  clear(): void {
    const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0);
    this.activeExplosions.forEach(explosion => {
      this.sphereMesh.setMatrixAt(explosion.index, zeroScale);
      this.flashMesh.setMatrixAt(explosion.index, zeroScale);
      this.smokeMesh.setMatrixAt(explosion.index, zeroScale);
    });

    this.sphereMesh.instanceMatrix.needsUpdate = true;
    this.flashMesh.instanceMatrix.needsUpdate = true;
    this.smokeMesh.instanceMatrix.needsUpdate = true;

    // Reset pools
    this.availableIndices = [];
    for (let i = 0; i < this.maxExplosions; i++) {
      this.availableIndices.push(i);
    }
    this.activeExplosions.clear();
  }

  getActiveExplosionCount(): number {
    return this.activeExplosions.size;
  }

  private createLaunchStyleEffects(
    position: THREE.Vector3,
    quality: number,
    type: 'air' | 'ground'
  ): void {
    // For now, we'll rely on the instanced smoke mesh instead of creating separate particles
    // This prevents the layering issue where particles appear over the explosion

    // For ground explosions, just add the dust ring
    if (type === 'ground' && quality > 0.5) {
      setTimeout(() => {
        this.createGroundDustRing(position, quality);
      }, 100); // 100ms delay
    }
  }

  private createSmokeCloud(position: THREE.Vector3, quality: number): void {
    // Performance optimization: Skip smoke particles for low quality or too many explosions
    if (quality < 0.5 || this.activeExplosions.size > 10) {
      return;
    }

    const particleCount = Math.floor(5 + quality * 10); // Reduced from 10-25 to 5-15
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);
    const lifetimes = new Float32Array(particleCount);
    const sizes = new Float32Array(particleCount);

    // Initialize particles
    for (let i = 0; i < particleCount; i++) {
      // Random position around explosion center, starting from the edge
      const angle = Math.random() * Math.PI * 2;
      const radius = 2 + Math.random() * 2; // Start 2-4 units from center
      const offset = new THREE.Vector3(
        Math.cos(angle) * radius,
        Math.random() * 2,
        Math.sin(angle) * radius
      );

      positions[i * 3] = position.x + offset.x;
      positions[i * 3 + 1] = position.y + offset.y;
      positions[i * 3 + 2] = position.z + offset.z;

      // Outward expansion velocity (mostly horizontal)
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 8, // Outward expansion
        (Math.random() - 0.5) * 2, // Very minimal vertical movement
        (Math.random() - 0.5) * 8
      );

      velocities[i * 3] = vel.x;
      velocities[i * 3 + 1] = vel.y;
      velocities[i * 3 + 2] = vel.z;

      lifetimes[i] = Math.random() * 0.5;
      sizes[i] = 3 + Math.random() * 4; // Larger particles for explosions
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
    geometry.setAttribute('lifetime', new THREE.BufferAttribute(lifetimes, 1));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    // Reuse smoke texture if possible
    const smokeTexture = this.getSmokeTexture();

    const material = new THREE.PointsMaterial({
      size: 12,
      color: 0x444444, // Darker smoke
      map: smokeTexture,
      transparent: true,
      opacity: 0.4, // Lower initial opacity
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      sizeAttenuation: true,
      vertexColors: false,
    });

    const points = new THREE.Points(geometry, material);
    points.renderOrder = 0; // Render smoke particles behind everything
    this.scene.add(points);

    // Animate smoke
    const startTime = Date.now();
    const duration = 1500 + quality * 1000; // 1.5-2.5 seconds based on quality
    const effect = {
      update: () => {
        const elapsed = (Date.now() - startTime) / 1000;
        if (elapsed > duration / 1000) {
          this.scene.remove(points);
          geometry.dispose();
          material.dispose();
          // Don't dispose shared texture
          return false;
        }

        const positions = geometry.attributes.position.array as Float32Array;
        const velocities = geometry.attributes.velocity.array as Float32Array;
        const lifetimes = geometry.attributes.lifetime.array as Float32Array;
        const sizes = geometry.attributes.size.array as Float32Array;

        for (let i = 0; i < particleCount; i++) {
          lifetimes[i] += 0.016;

          // Update position
          positions[i * 3] += velocities[i * 3] * 0.016;
          positions[i * 3 + 1] += velocities[i * 3 + 1] * 0.016;
          positions[i * 3 + 2] += velocities[i * 3 + 2] * 0.016;

          // Rapidly slow down particles (high drag)
          velocities[i * 3] *= 0.92;
          velocities[i * 3 + 1] *= 0.92; // No upward drift
          velocities[i * 3 + 2] *= 0.92;

          // Grow over time
          sizes[i] = (3 + Math.random() * 4) * (1 + lifetimes[i] * 0.5);
        }

        geometry.attributes.position.needsUpdate = true;
        geometry.attributes.size.needsUpdate = true;

        // Start fading immediately, fade faster
        const fadeProgress = elapsed / (duration / 1000);
        material.opacity = 0.4 * Math.pow(1 - fadeProgress, 2); // Quadratic fade for faster dissipation

        return true;
      },
    };

    this.activeEffects.push(effect);
  }

  private createGroundDustRing(position: THREE.Vector3, quality: number): void {
    // Just create expanding dust ring without particles (reduced size)
    const ringGeometry = new THREE.RingGeometry(0.5, 3 + quality * 2, 16, 1);
    // Clone material so each ring can fade independently
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x8b7355,
      opacity: 0.4,
      transparent: true,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(position);
    ring.position.y = 0.05;
    ring.renderOrder = -1; // Render dust ring way behind explosion
    this.scene.add(ring);

    console.log(
      `Created explosion dust ring at ${position.x.toFixed(1)}, ${position.z.toFixed(1)}`
    );

    // Animate dust ring
    const startTime = Date.now();
    const effect = {
      update: () => {
        const elapsed = (Date.now() - startTime) / 1000;
        if (elapsed > 2) {
          this.scene.remove(ring);
          ringGeometry.dispose();
          ringMaterial.dispose();
          console.log(
            `Removed explosion dust ring from ${position.x.toFixed(1)}, ${position.z.toFixed(1)}`
          );
          return false;
        }

        // Expand ring (reduced expansion)
        const scale = 1 + elapsed * 2;
        ring.scale.set(scale, scale, 1);
        ringMaterial.opacity = 0.4 * (1 - elapsed / 2);

        return true;
      },
    };

    this.activeEffects.push(effect);
  }

  private createSmokeTexture(): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;

    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(100,100,100,0.8)');
    gradient.addColorStop(0.4, 'rgba(100,100,100,0.4)');
    gradient.addColorStop(1, 'rgba(100,100,100,0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  private getSmokeTexture(): THREE.Texture {
    if (!this.cachedSmokeTexture) {
      this.cachedSmokeTexture = this.createSmokeTexture();
    }
    return this.cachedSmokeTexture;
  }

  // Debug method to clean up any leftover dust rings
  cleanupOrphanedDustRings(): void {
    console.log(`Cleaning up orphaned dust rings. Active effects: ${this.activeEffects.length}`);

    // Force all effects to complete their cleanup
    this.activeEffects.forEach(effect => {
      // Keep calling update until it returns false
      let attempts = 0;
      while (effect.update() && attempts < 1000) {
        attempts++;
      }
    });

    // Clear the array
    this.activeEffects = [];

    // Also scan scene for any untracked dust rings
    const toRemove: THREE.Object3D[] = [];
    this.scene.traverse(child => {
      if (
        child instanceof THREE.Mesh &&
        child.geometry &&
        child.geometry.type === 'RingGeometry' &&
        child.material &&
        (child.material as any).color &&
        (child.material as any).color.getHex() === 0x8b7355
      ) {
        toRemove.push(child);
      }
    });

    console.log(`Found ${toRemove.length} potential orphaned dust rings in scene`);
    toRemove.forEach(mesh => {
      this.scene.remove(mesh);
      if ((mesh as THREE.Mesh).geometry) {
        ((mesh as THREE.Mesh).geometry as THREE.BufferGeometry).dispose();
      }
      if ((mesh as THREE.Mesh).material) {
        ((mesh as THREE.Mesh).material as THREE.Material).dispose();
      }
    });
  }

  dispose(): void {
    this.sphereMesh.geometry.dispose();
    this.flashMesh.geometry.dispose();
    this.smokeMesh.geometry.dispose();

    this.explosionMaterial.dispose();
    this.flashMaterial.dispose();
    this.smokeMaterial.dispose();

    if (this.cachedSmokeTexture) {
      this.cachedSmokeTexture.dispose();
    }

    this.scene.remove(this.sphereMesh);
    this.scene.remove(this.flashMesh);
    this.scene.remove(this.smokeMesh);
  }
}
