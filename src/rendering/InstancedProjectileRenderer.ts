import * as THREE from 'three';
import { Projectile } from '../entities/Projectile';
import { GeometryFactory } from '../utils/GeometryFactory';
import { MaterialCache } from '../utils/MaterialCache';

export class InstancedProjectileRenderer {
  private scene: THREE.Scene;
  private maxProjectiles: number;

  // Instanced mesh for interceptors
  private interceptorMesh: THREE.InstancedMesh;

  // Temporary object for matrix calculations
  private dummy = new THREE.Object3D();

  // Map projectile IDs to instance indices
  private projectileToIndex = new Map<string, number>();
  private availableIndices: number[] = [];

  constructor(scene: THREE.Scene, maxProjectiles: number = 200) {
    this.scene = scene;
    this.maxProjectiles = maxProjectiles;

    // Get interceptor geometry from factory (cone shape)
    const interceptorGeometry = GeometryFactory.getInstance().getCone(0.3, 2, 8);
    // Clone and rotate to avoid modifying the shared geometry
    const rotatedGeometry = interceptorGeometry.clone();
    rotatedGeometry.rotateX(Math.PI / 2); // Point forward

    const interceptorMaterial = MaterialCache.getInstance().getMeshStandardMaterial({
      color: 0x00ffff,
      emissive: 0x00ffff,
      emissiveIntensity: 0.3,
      roughness: 0.3,
      metalness: 0.8,
    });

    // Create instanced mesh
    this.interceptorMesh = new THREE.InstancedMesh(
      rotatedGeometry,
      interceptorMaterial,
      maxProjectiles
    );
    // Optimize: Disable shadows for better performance
    this.interceptorMesh.castShadow = false;
    this.interceptorMesh.receiveShadow = false;

    // Initialize all instances as invisible
    const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < maxProjectiles; i++) {
      this.interceptorMesh.setMatrixAt(i, zeroScale);
      this.availableIndices.push(i);
    }
    this.interceptorMesh.instanceMatrix.needsUpdate = true;

    // Add to scene
    this.scene.add(this.interceptorMesh);
  }

  addProjectile(projectile: Projectile): boolean {
    if (this.availableIndices.length === 0) {
      console.warn('No available instance slots for projectile');
      return false;
    }

    const index = this.availableIndices.pop()!;
    this.projectileToIndex.set(projectile.id, index);

    // CRITICAL: Remove mesh from scene to prevent double rendering
    if (projectile.mesh && projectile.mesh.parent) {
      projectile.mesh.removeFromParent();
    }
    projectile.mesh.visible = false;

    return true;
  }

  removeProjectile(projectileId: string): void {
    const index = this.projectileToIndex.get(projectileId);
    if (index === undefined) return;

    // Return index to available pool
    this.availableIndices.push(index);
    this.projectileToIndex.delete(projectileId);

    // Hide this instance
    const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0);
    this.interceptorMesh.setMatrixAt(index, zeroScale);
    this.interceptorMesh.instanceMatrix.needsUpdate = true;
  }

  updateProjectiles(projectiles: Projectile[]): void {
    let needsUpdate = false;

    projectiles.forEach(projectile => {
      const index = this.projectileToIndex.get(projectile.id);
      if (index === undefined) return;

      // Get projectile position and velocity for orientation
      const position = projectile.getPosition();
      const velocity = projectile.getVelocity();

      // Update position
      this.dummy.position.copy(position);

      // Orient the cone to point in the direction of travel
      if (velocity.length() > 0) {
        const direction = velocity.clone().normalize();
        this.dummy.lookAt(
          position.x + direction.x,
          position.y + direction.y,
          position.z + direction.z
        );
      }

      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();

      this.interceptorMesh.setMatrixAt(index, this.dummy.matrix);
      needsUpdate = true;
    });

    if (needsUpdate) {
      this.interceptorMesh.instanceMatrix.needsUpdate = true;
    }
  }

  clear(): void {
    // Hide all instances
    const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.maxProjectiles; i++) {
      this.interceptorMesh.setMatrixAt(i, zeroScale);
    }
    this.interceptorMesh.instanceMatrix.needsUpdate = true;

    // Reset tracking
    this.projectileToIndex.clear();
    this.availableIndices = [];
    for (let i = 0; i < this.maxProjectiles; i++) {
      this.availableIndices.push(i);
    }
  }

  dispose(): void {
    // Dispose the cloned geometry (it's not shared)
    this.interceptorMesh.geometry.dispose();
    // Don't dispose shared material from MaterialCache
    this.scene.remove(this.interceptorMesh);
  }
}
