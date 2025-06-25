import * as THREE from 'three';
import { MaterialCache } from '../utils/MaterialCache';

interface DebrisInstance {
  id: string;
  index: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  rotation: THREE.Vector3;
  rotationSpeed: THREE.Vector3;
  lifetime: number;
  maxLifetime: number;
  startTime: number;
  active: boolean;
}

export class InstancedDebrisRenderer {
  private scene: THREE.Scene;
  private maxDebris: number;
  private instancedMesh: THREE.InstancedMesh;
  private debris: DebrisInstance[] = [];
  private availableIndices: number[] = [];
  private activeDebris = new Map<string, DebrisInstance>();
  private dummy = new THREE.Object3D();

  constructor(scene: THREE.Scene, maxDebris: number = 1000) {
    this.scene = scene;
    this.maxDebris = maxDebris;

    // Create geometry for debris (small boxes)
    const geometry = new THREE.BoxGeometry(0.3, 0.3, 0.3);

    // Use cached material
    const material = MaterialCache.getInstance().getMeshStandardMaterial({
      color: 0x444444,
      roughness: 0.9,
      metalness: 0.1,
    });

    // Create instanced mesh
    this.instancedMesh = new THREE.InstancedMesh(geometry, material, maxDebris);
    this.instancedMesh.castShadow = true;
    this.instancedMesh.receiveShadow = false;

    // Initialize all instances as invisible
    const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < maxDebris; i++) {
      this.instancedMesh.setMatrixAt(i, zeroScale);
      this.availableIndices.push(i);
    }
    this.instancedMesh.instanceMatrix.needsUpdate = true;

    this.scene.add(this.instancedMesh);
  }

  createDebris(
    position: THREE.Vector3,
    explosionVelocity: THREE.Vector3,
    count: number = 10,
    config?: {
      speedMultiplier?: number;
      lifetimeSeconds?: number;
      sizeVariation?: number;
    }
  ): void {
    const { speedMultiplier = 1, lifetimeSeconds = 3, sizeVariation = 0.3 } = config || {};

    const actualCount = Math.min(count, this.availableIndices.length);

    for (let i = 0; i < actualCount; i++) {
      if (this.availableIndices.length === 0) break;

      const index = this.availableIndices.pop()!;
      const id = `debris_${Date.now()}_${i}`;

      // Random velocity in all directions
      const randomVel = new THREE.Vector3(
        (Math.random() - 0.5) * 20,
        Math.random() * 25 + 10,
        (Math.random() - 0.5) * 20
      );

      // Add explosion velocity influence
      randomVel.add(explosionVelocity.clone().multiplyScalar(0.5));
      randomVel.multiplyScalar(speedMultiplier);

      const debris: DebrisInstance = {
        id,
        index,
        position: position.clone(),
        velocity: randomVel,
        rotation: new THREE.Vector3(
          Math.random() * Math.PI * 2,
          Math.random() * Math.PI * 2,
          Math.random() * Math.PI * 2
        ),
        rotationSpeed: new THREE.Vector3(
          (Math.random() - 0.5) * 10,
          (Math.random() - 0.5) * 10,
          (Math.random() - 0.5) * 10
        ),
        lifetime: 0,
        maxLifetime: lifetimeSeconds,
        startTime: Date.now(),
        active: true,
      };

      this.activeDebris.set(id, debris);
    }
  }

  update(deltaTime: number): void {
    const gravity = -30; // m/s²
    const damping = 0.98;
    const groundY = 0.15; // Small offset above ground

    // Update all active debris
    this.activeDebris.forEach((debris, id) => {
      if (!debris.active) return;

      debris.lifetime += deltaTime;

      // Check if debris should be removed
      if (debris.lifetime >= debris.maxLifetime) {
        this.removeDebris(id);
        return;
      }

      // Update physics
      debris.velocity.y += gravity * deltaTime;
      debris.position.add(debris.velocity.clone().multiplyScalar(deltaTime));

      // Ground collision
      if (debris.position.y <= groundY) {
        debris.position.y = groundY;
        debris.velocity.y *= -0.3; // Bounce with energy loss
        debris.velocity.x *= 0.7; // Friction
        debris.velocity.z *= 0.7;

        // Reduce rotation on ground contact
        debris.rotationSpeed.multiplyScalar(0.8);
      }

      // Air resistance
      debris.velocity.multiplyScalar(damping);

      // Update rotation
      debris.rotation.x += debris.rotationSpeed.x * deltaTime;
      debris.rotation.y += debris.rotationSpeed.y * deltaTime;
      debris.rotation.z += debris.rotationSpeed.z * deltaTime;

      // Update instance matrix
      this.dummy.position.copy(debris.position);
      this.dummy.rotation.set(debris.rotation.x, debris.rotation.y, debris.rotation.z);

      // Fade out near end of life
      const fadeStart = debris.maxLifetime * 0.7;
      let scale = 1;
      if (debris.lifetime > fadeStart) {
        const fadeProgress = (debris.lifetime - fadeStart) / (debris.maxLifetime - fadeStart);
        scale = 1 - fadeProgress;
      }
      this.dummy.scale.setScalar(scale);

      this.dummy.updateMatrix();
      this.instancedMesh.setMatrixAt(debris.index, this.dummy.matrix);
    });

    // Update instance matrix if there were any active debris
    if (this.activeDebris.size > 0) {
      this.instancedMesh.instanceMatrix.needsUpdate = true;
    }
  }

  private removeDebris(id: string): void {
    const debris = this.activeDebris.get(id);
    if (!debris) return;

    // Hide the instance
    const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0);
    this.instancedMesh.setMatrixAt(debris.index, zeroScale);

    // Return index to pool
    this.availableIndices.push(debris.index);
    this.activeDebris.delete(id);
  }

  clear(): void {
    // Hide all debris
    const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0);
    this.activeDebris.forEach(debris => {
      this.instancedMesh.setMatrixAt(debris.index, zeroScale);
    });
    this.instancedMesh.instanceMatrix.needsUpdate = true;

    // Reset pools
    this.availableIndices = [];
    for (let i = 0; i < this.maxDebris; i++) {
      this.availableIndices.push(i);
    }
    this.activeDebris.clear();
  }

  getActiveDebrisCount(): number {
    return this.activeDebris.size;
  }

  dispose(): void {
    this.instancedMesh.geometry.dispose();
    if (this.instancedMesh.material instanceof THREE.Material) {
      this.instancedMesh.material.dispose();
    }
    this.scene.remove(this.instancedMesh);
  }
}
