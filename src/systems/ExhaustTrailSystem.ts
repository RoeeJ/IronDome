import * as THREE from 'three';
import { MaterialCache } from '../utils/MaterialCache';
import { TextureCache } from '../utils/TextureCache';

export interface ExhaustTrailConfig {
  particleCount: number;
  particleSize: number;
  particleLifetime: number; // seconds
  emissionRate: number; // particles per second
  startColor: THREE.Color;
  endColor: THREE.Color;
  startOpacity: number;
  endOpacity: number;
  spread: number; // How much particles spread from emission point
  velocityFactor: number; // How much of projectile velocity to inherit
  gravity: boolean;
  windEffect: boolean;
}

interface TrailParticle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  lifetime: number;
  maxLifetime: number;
  size: number;
}

export class ExhaustTrailSystem {
  private scene: THREE.Scene;
  private particles: TrailParticle[] = [];
  private particleGeometry: THREE.BufferGeometry;
  private particleMaterial: THREE.PointsMaterial;
  private particleSystem?: THREE.Points;
  private config: ExhaustTrailConfig;
  private lastEmissionTime: number = 0;
  private isActive: boolean = true;

  // Buffers for particle system
  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;
  private opacities: Float32Array;

  constructor(scene: THREE.Scene, config: Partial<ExhaustTrailConfig> = {}) {
    this.scene = scene;

    // Default configuration for missile exhaust
    this.config = {
      particleCount: 100, // Further reduced for performance
      particleSize: 0.8, // Slightly larger to compensate
      particleLifetime: 1.0, // Shorter lifetime
      emissionRate: 30, // Much lower emission rate
      startColor: new THREE.Color(0xffaa00),
      endColor: new THREE.Color(0x666666),
      startOpacity: 0.8,
      endOpacity: 0,
      spread: 0.3,
      velocityFactor: -0.3, // Particles move opposite to projectile
      gravity: true,
      windEffect: true,
      ...config,
    };

    this.initializeParticleSystem();
  }

  private initializeParticleSystem(): void {
    const count = this.config.particleCount;

    // Initialize buffers
    this.positions = new Float32Array(count * 3);
    this.colors = new Float32Array(count * 3);
    this.sizes = new Float32Array(count);
    this.opacities = new Float32Array(count);

    // Create geometry
    this.particleGeometry = new THREE.BufferGeometry();
    this.particleGeometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.particleGeometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.particleGeometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));
    this.particleGeometry.setAttribute('opacity', new THREE.BufferAttribute(this.opacities, 1));

    // Use cached material instead of creating new one with shader modifications
    this.particleMaterial = MaterialCache.getInstance().getPointsMaterial({
      size: this.config.particleSize,
      color: 0xffffff,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      sizeAttenuation: true,
    });

    // Set texture from shared cache
    this.particleMaterial.map = TextureCache.getInstance().getParticleTexture(64, {
      inner: 'rgba(255,255,255,1)',
      outer: 'rgba(255,200,100,0)',
    });

    // NOTE: Removed onBeforeCompile to prevent unique shader creation
    // Opacity will be handled through vertex colors instead

    this.particleSystem = new THREE.Points(this.particleGeometry, this.particleMaterial);
    this.particleSystem.frustumCulled = true; // Enable frustum culling
    this.scene.add(this.particleSystem);
  }

  emit(
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    currentTime: number,
    camera?: THREE.Camera
  ): void {
    if (!this.isActive) return;

    // LOD: Reduce particles for distant objects
    let lodMultiplier = 1.0;
    if (camera) {
      const distance = position.distanceTo(camera.position);
      if (distance > 200) return; // Don't emit if too far
      if (distance > 100) lodMultiplier = 0.3;
      else if (distance > 50) lodMultiplier = 0.6;
    }

    // Check emission rate
    const timeSinceLastEmission = currentTime - this.lastEmissionTime;
    const adjustedEmissionRate = this.config.emissionRate * lodMultiplier;
    const particlesToEmit = Math.floor((timeSinceLastEmission * adjustedEmissionRate) / 1000);

    if (particlesToEmit <= 0) return;

    this.lastEmissionTime = currentTime;

    for (let i = 0; i < particlesToEmit && this.particles.length < this.config.particleCount; i++) {
      // Create particle with spread
      const spreadVector = new THREE.Vector3(
        (Math.random() - 0.5) * this.config.spread,
        (Math.random() - 0.5) * this.config.spread,
        (Math.random() - 0.5) * this.config.spread
      );

      // Exhaust should move opposite to projectile with much less speed
      const exhaustDirection = velocity.clone().normalize().multiplyScalar(-8); // -8 m/s backwards
      const particleVelocity = exhaustDirection.add(spreadVector);

      this.particles.push({
        position: position.clone(),
        velocity: particleVelocity,
        lifetime: 0,
        maxLifetime: this.config.particleLifetime * (0.8 + Math.random() * 0.4),
        size: this.config.particleSize * (0.5 + Math.random() * 0.5),
      });
    }
  }

  update(deltaTime: number, windVelocity: THREE.Vector3 = new THREE.Vector3()): void {
    // Update existing particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i];
      particle.lifetime += deltaTime;

      // Remove dead particles
      if (particle.lifetime >= particle.maxLifetime) {
        this.particles.splice(i, 1);
        continue;
      }

      // Update position
      particle.position.add(particle.velocity.clone().multiplyScalar(deltaTime));

      // Apply gravity
      if (this.config.gravity) {
        particle.velocity.y -= 9.8 * deltaTime * 0.1; // Reduced gravity for smoke
      }

      // Apply wind
      if (this.config.windEffect) {
        particle.velocity.add(windVelocity.clone().multiplyScalar(deltaTime));
      }

      // Particle expansion (smoke gets bigger over time)
      const ageRatio = particle.lifetime / particle.maxLifetime;
      particle.size = this.config.particleSize * (1 + ageRatio * 2);
    }

    // Update buffers
    this.updateBuffers();
  }

  private updateBuffers(): void {
    const count = Math.min(this.particles.length, this.config.particleCount);

    for (let i = 0; i < count; i++) {
      const particle = this.particles[i];
      const ageRatio = particle.lifetime / particle.maxLifetime;

      // Update position
      this.positions[i * 3] = particle.position.x;
      this.positions[i * 3 + 1] = particle.position.y;
      this.positions[i * 3 + 2] = particle.position.z;

      // Update color (interpolate from start to end)
      const color = new THREE.Color();
      color.lerpColors(this.config.startColor, this.config.endColor, ageRatio);
      this.colors[i * 3] = color.r;
      this.colors[i * 3 + 1] = color.g;
      this.colors[i * 3 + 2] = color.b;

      // Update size
      this.sizes[i] = particle.size;

      // Update opacity
      this.opacities[i] = THREE.MathUtils.lerp(
        this.config.startOpacity,
        this.config.endOpacity,
        ageRatio
      );
    }

    // Clear remaining buffer space
    for (let i = count; i < this.config.particleCount; i++) {
      this.positions[i * 3] = 0;
      this.positions[i * 3 + 1] = -1000; // Hide below ground
      this.positions[i * 3 + 2] = 0;
      this.opacities[i] = 0;
    }

    // Update geometry attributes
    this.particleGeometry.attributes.position.needsUpdate = true;
    this.particleGeometry.attributes.color.needsUpdate = true;
    this.particleGeometry.attributes.size.needsUpdate = true;
    this.particleGeometry.attributes.opacity.needsUpdate = true;

    // Update bounding sphere for frustum culling
    this.particleGeometry.computeBoundingSphere();
  }

  stop(): void {
    this.isActive = false;
  }

  start(): void {
    this.isActive = true;
  }

  dispose(): void {
    if (this.particleSystem) {
      this.scene.remove(this.particleSystem);
      this.particleGeometry.dispose();
      this.particleMaterial.dispose();
      if (this.particleMaterial.map) {
        this.particleMaterial.map.dispose();
      }
    }
    this.particles = [];
  }

  getParticleCount(): number {
    return this.particles.length;
  }

  // Factory methods for different trail types
  static createMissileTrail(scene: THREE.Scene): ExhaustTrailSystem {
    return new ExhaustTrailSystem(scene, {
      particleCount: 120, // Reduced
      particleSize: 1.0, // Larger particles
      particleLifetime: 1.0,
      emissionRate: 40, // Much lower
      startColor: new THREE.Color(0xffcc00),
      endColor: new THREE.Color(0x444444),
      startOpacity: 0.8,
      endOpacity: 0.1,
      spread: 0.3,
      velocityFactor: -0.5,
    });
  }

  static createInterceptorTrail(scene: THREE.Scene): ExhaustTrailSystem {
    return new ExhaustTrailSystem(scene, {
      particleCount: 80, // Much lower
      particleSize: 0.8,
      particleLifetime: 0.8,
      emissionRate: 50, // Much lower
      startColor: new THREE.Color(0x00ffff),
      endColor: new THREE.Color(0x0066aa),
      startOpacity: 0.6,
      endOpacity: 0,
      spread: 0.2,
      velocityFactor: -0.8,
      gravity: false, // Less gravity effect for interceptor trails
    });
  }
}
