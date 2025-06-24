import * as THREE from 'three';
import { MaterialCache } from '../utils/MaterialCache';
import { GeometryFactory } from '../utils/GeometryFactory';

export enum TrailType {
  LINE = 'line',
  PARTICLE = 'particle',
}

export interface TrailConfig {
  type: TrailType;
  color: number;
  maxPoints?: number; // For line trails
  linewidth?: number; // For line trails
  particleCount?: number; // For particle trails
  particleSize?: number; // For particle trails
  particleLifetime?: number; // For particle trails
  fadeOut?: boolean;
  emissive?: boolean;
  emissiveIntensity?: number;
}

interface TrailInstance {
  id: string;
  type: TrailType;
  config: TrailConfig;
  lineTrail?: LineTrail;
  particleTrail?: ParticleTrail;
  lastUpdateTime: number;
}

interface LineTrail {
  line: THREE.Line;
  positions: Float32Array;
  currentIndex: number;
  maxPoints: number;
  worldPositions: THREE.Vector3[]; // Store actual world positions for proper trail
}

interface ParticleTrail {
  particles: THREE.Points;
  positions: Float32Array;
  lifetimes: Float32Array;
  velocities: Float32Array;
  currentIndex: number;
  maxParticles: number;
}

/**
 * Unified trail system that supports both line-based and particle-based trails.
 * This consolidates the two separate trail implementations to reduce code duplication
 * and provide a consistent API for all trail effects.
 */
export class UnifiedTrailSystem {
  private static instance: UnifiedTrailSystem;
  private scene: THREE.Scene;
  private trails = new Map<string, TrailInstance>();

  private constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  static getInstance(scene: THREE.Scene): UnifiedTrailSystem {
    if (!UnifiedTrailSystem.instance) {
      UnifiedTrailSystem.instance = new UnifiedTrailSystem(scene);
    }
    return UnifiedTrailSystem.instance;
  }

  /**
   * Create a new trail with the specified configuration
   */
  createTrail(id: string, config: TrailConfig): void {
    // Remove existing trail if present
    this.removeTrail(id);

    const trail: TrailInstance = {
      id,
      type: config.type,
      config,
      lastUpdateTime: Date.now(),
    };

    if (config.type === TrailType.LINE) {
      trail.lineTrail = this.createLineTrail(config);
    } else {
      trail.particleTrail = this.createParticleTrail(config);
    }

    this.trails.set(id, trail);
  }

  private createLineTrail(config: TrailConfig): LineTrail {
    const maxPoints = config.maxPoints || 50;
    const positions = new Float32Array(maxPoints * 3);
    const worldPositions: THREE.Vector3[] = [];

    // Initialize positions far away to avoid initial rendering artifacts
    for (let i = 0; i < maxPoints * 3; i += 3) {
      positions[i] = -10000; // x
      positions[i + 1] = -10000; // y
      positions[i + 2] = -10000; // z
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setDrawRange(0, 0); // Start with no points drawn

    const material = MaterialCache.getInstance().getLineMaterial({
      color: config.color,
      linewidth: config.linewidth || 1,
      transparent: config.fadeOut || false,
      opacity: config.fadeOut ? 0.8 : 1,
    });

    const line = new THREE.Line(geometry, material);
    line.frustumCulled = false;
    line.name = `trail_${config.color}`; // Add name for debugging
    // Optimize: Trails don't need shadows
    line.castShadow = false;
    line.receiveShadow = false;
    this.scene.add(line);

    return {
      line,
      positions,
      currentIndex: 0,
      maxPoints,
      worldPositions,
    };
  }

  private createParticleTrail(config: TrailConfig): ParticleTrail {
    const maxParticles = config.particleCount || 100;
    const positions = new Float32Array(maxParticles * 3);
    const lifetimes = new Float32Array(maxParticles);
    const velocities = new Float32Array(maxParticles * 3);

    // Initialize arrays
    for (let i = 0; i < maxParticles; i++) {
      lifetimes[i] = 0;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = MaterialCache.getInstance().getPointsMaterial({
      color: config.color,
      size: config.particleSize || 0.5,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const particles = new THREE.Points(geometry, material);
    particles.frustumCulled = false;
    // Optimize: Particle trails don't need shadows
    particles.castShadow = false;
    particles.receiveShadow = false;
    this.scene.add(particles);

    return {
      particles,
      positions,
      lifetimes,
      velocities,
      currentIndex: 0,
      maxParticles,
    };
  }

  /**
   * Update trail with new position
   */
  updateTrail(
    id: string,
    position: THREE.Vector3,
    velocity?: THREE.Vector3,
    camera?: THREE.Camera
  ): void {
    const trail = this.trails.get(id);
    if (!trail) return;

    const currentTime = Date.now();
    const deltaTime = (currentTime - trail.lastUpdateTime) / 1000;
    trail.lastUpdateTime = currentTime;

    if (trail.type === TrailType.LINE && trail.lineTrail) {
      this.updateLineTrail(trail.lineTrail, position);
    } else if (trail.type === TrailType.PARTICLE && trail.particleTrail) {
      this.updateParticleTrail(
        trail.particleTrail,
        position,
        velocity || new THREE.Vector3(),
        deltaTime,
        trail.config,
        camera
      );
    }
  }

  private updateLineTrail(trail: LineTrail, position: THREE.Vector3): void {
    const { positions, maxPoints, line, worldPositions } = trail;

    // Add new position to world positions array
    worldPositions.push(position.clone());

    // Remove oldest position if we exceed max points
    if (worldPositions.length > maxPoints) {
      worldPositions.shift();
    }

    // Update geometry buffer with all world positions
    const geometry = line.geometry as THREE.BufferGeometry;
    const posAttr = geometry.attributes.position as THREE.BufferAttribute;

    // Copy world positions to buffer
    for (let i = 0; i < worldPositions.length; i++) {
      const pos = worldPositions[i];
      const idx = i * 3;
      positions[idx] = pos.x;
      positions[idx + 1] = pos.y;
      positions[idx + 2] = pos.z;
    }

    // Fill remaining positions with last valid position to avoid artifacts
    if (worldPositions.length > 0) {
      const lastPos = worldPositions[worldPositions.length - 1];
      for (let i = worldPositions.length * 3; i < maxPoints * 3; i += 3) {
        positions[i] = lastPos.x;
        positions[i + 1] = lastPos.y;
        positions[i + 2] = lastPos.z;
      }
    }

    // Copy to GPU buffer
    for (let i = 0; i < positions.length; i++) {
      posAttr.array[i] = positions[i];
    }

    posAttr.needsUpdate = true;

    // Update draw range to only show valid points
    geometry.setDrawRange(0, worldPositions.length);
    trail.currentIndex = worldPositions.length - 1;
  }

  private updateParticleTrail(
    trail: ParticleTrail,
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    deltaTime: number,
    config: TrailConfig,
    camera?: THREE.Camera
  ): void {
    const { positions, lifetimes, velocities, particles } = trail;
    const lifetime = config.particleLifetime || 1.0;

    // Emit new particle
    const emitIndex = trail.currentIndex;
    const idx = emitIndex * 3;

    positions[idx] = position.x;
    positions[idx + 1] = position.y;
    positions[idx + 2] = position.z;

    velocities[idx] = velocity.x * -0.5; // Trail behind
    velocities[idx + 1] = velocity.y * -0.5;
    velocities[idx + 2] = velocity.z * -0.5;

    lifetimes[emitIndex] = lifetime;

    trail.currentIndex = (trail.currentIndex + 1) % trail.maxParticles;

    // Update existing particles
    for (let i = 0; i < trail.maxParticles; i++) {
      if (lifetimes[i] > 0) {
        lifetimes[i] -= deltaTime;

        const vidx = i * 3;
        positions[vidx] += velocities[vidx] * deltaTime;
        positions[vidx + 1] += velocities[vidx + 1] * deltaTime;
        positions[vidx + 2] += velocities[vidx + 2] * deltaTime;

        // Apply gravity if configured
        if (config.type === TrailType.PARTICLE) {
          velocities[vidx + 1] -= 9.8 * deltaTime * 0.1;
        }
      }
    }

    // Update geometry
    const geometry = particles.geometry as THREE.BufferGeometry;
    const posAttr = geometry.attributes.position as THREE.BufferAttribute;
    posAttr.needsUpdate = true;
  }

  /**
   * Clear trail points (for line trails)
   */
  clearTrail(id: string): void {
    const trail = this.trails.get(id);
    if (!trail) return;

    if (trail.type === TrailType.LINE && trail.lineTrail) {
      // Clear world positions array
      trail.lineTrail.worldPositions.length = 0;
      trail.lineTrail.currentIndex = 0;

      const geometry = trail.lineTrail.line.geometry as THREE.BufferGeometry;
      geometry.setDrawRange(0, 0);

      // Reset all positions to far away
      const positions = trail.lineTrail.positions;
      for (let i = 0; i < positions.length; i += 3) {
        positions[i] = -10000; // x
        positions[i + 1] = -10000; // y
        positions[i + 2] = -10000; // z
      }

      // Update the geometry
      const posAttr = geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < positions.length; i++) {
        posAttr.array[i] = positions[i];
      }
      posAttr.needsUpdate = true;
    }
  }

  /**
   * Remove trail completely
   */
  removeTrail(id: string): void {
    const trail = this.trails.get(id);
    if (!trail) return;

    if (trail.lineTrail) {
      trail.lineTrail.line.geometry.dispose();
      this.scene.remove(trail.lineTrail.line);
    }

    if (trail.particleTrail) {
      trail.particleTrail.particles.geometry.dispose();
      this.scene.remove(trail.particleTrail.particles);
    }

    this.trails.delete(id);
  }

  /**
   * Update all particle trails (call in animation loop)
   */
  update(deltaTime: number, camera?: THREE.Camera): void {
    const currentTime = Date.now();

    for (const trail of this.trails.values()) {
      if (trail.type === TrailType.PARTICLE && trail.particleTrail) {
        // Update particle lifetimes and positions
        const { positions, lifetimes, velocities, particles } = trail.particleTrail;
        const lifetime = trail.config.particleLifetime || 1.0;

        let hasActiveParticles = false;

        for (let i = 0; i < trail.particleTrail.maxParticles; i++) {
          if (lifetimes[i] > 0) {
            lifetimes[i] -= deltaTime;

            if (lifetimes[i] > 0) {
              hasActiveParticles = true;

              const idx = i * 3;
              positions[idx] += velocities[idx] * deltaTime;
              positions[idx + 1] += velocities[idx + 1] * deltaTime;
              positions[idx + 2] += velocities[idx + 2] * deltaTime;
            }
          }
        }

        if (hasActiveParticles) {
          const geometry = particles.geometry as THREE.BufferGeometry;
          const posAttr = geometry.attributes.position as THREE.BufferAttribute;
          posAttr.needsUpdate = true;
        }
      }
    }
  }

  /**
   * Get statistics about active trails
   */
  getStats(): {
    totalTrails: number;
    lineTrails: number;
    particleTrails: number;
    totalParticles: number;
  } {
    let lineTrails = 0;
    let particleTrails = 0;
    let totalParticles = 0;

    for (const trail of this.trails.values()) {
      if (trail.type === TrailType.LINE) {
        lineTrails++;
      } else {
        particleTrails++;
        if (trail.particleTrail) {
          totalParticles += trail.particleTrail.maxParticles;
        }
      }
    }

    return {
      totalTrails: this.trails.size,
      lineTrails,
      particleTrails,
      totalParticles,
    };
  }

  /**
   * Dispose of all trails and resources
   */
  dispose(): void {
    for (const id of this.trails.keys()) {
      this.removeTrail(id);
    }
  }
}
