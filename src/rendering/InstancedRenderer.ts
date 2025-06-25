import * as THREE from 'three';
import { debug } from '../utils/logger';

export interface InstancedGroup {
  mesh: THREE.InstancedMesh;
  activeCount: number;
  maxCount: number;
  freeIndices: number[];
  usedIndices: Set<number>;
  type: string;
}

export class InstancedRenderer {
  private scene: THREE.Scene;
  private groups: Map<string, InstancedGroup> = new Map();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  createInstancedGroup(
    type: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    maxCount: number = 1000
  ): void {
    // Create instanced mesh
    const mesh = new THREE.InstancedMesh(geometry, material, maxCount);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // Initialize all instances as invisible
    const dummy = new THREE.Object3D();
    dummy.scale.set(0, 0, 0);
    for (let i = 0; i < maxCount; i++) {
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = 0;

    // Create group
    const group: InstancedGroup = {
      mesh,
      activeCount: 0,
      maxCount,
      freeIndices: Array.from({ length: maxCount }, (_, i) => i),
      usedIndices: new Set(),
      type,
    };

    this.groups.set(type, group);
    this.scene.add(mesh);

    debug.category('Instanced', `Created ${type} group with ${maxCount} instances`);
  }

  addInstance(
    type: string,
    position: THREE.Vector3,
    rotation?: THREE.Euler | THREE.Quaternion,
    scale: THREE.Vector3 = new THREE.Vector3(1, 1, 1)
  ): number | null {
    const group = this.groups.get(type);
    if (!group || group.freeIndices.length === 0) {
      debug.warn(`No free instances for type ${type}`);
      return null;
    }

    // Get a free index
    const index = group.freeIndices.pop()!;
    group.usedIndices.add(index);

    // Set transform
    const dummy = new THREE.Object3D();
    dummy.position.copy(position);
    if (rotation instanceof THREE.Euler) {
      dummy.rotation.copy(rotation);
    } else if (rotation instanceof THREE.Quaternion) {
      dummy.quaternion.copy(rotation);
    }
    dummy.scale.copy(scale);
    dummy.updateMatrix();

    group.mesh.setMatrixAt(index, dummy.matrix);
    group.mesh.instanceMatrix.needsUpdate = true;

    // Update count
    group.activeCount++;
    group.mesh.count = Math.max(group.mesh.count, index + 1);

    return index;
  }

  updateInstance(
    type: string,
    index: number,
    position?: THREE.Vector3,
    rotation?: THREE.Euler | THREE.Quaternion,
    scale?: THREE.Vector3
  ): boolean {
    const group = this.groups.get(type);
    if (!group || !group.usedIndices.has(index)) {
      return false;
    }

    // Get current matrix
    const matrix = new THREE.Matrix4();
    group.mesh.getMatrixAt(index, matrix);

    // Decompose to get current transform
    const dummy = new THREE.Object3D();
    dummy.matrix.copy(matrix);
    dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);

    // Update transform
    if (position) dummy.position.copy(position);
    if (rotation instanceof THREE.Euler) {
      dummy.rotation.copy(rotation);
    } else if (rotation instanceof THREE.Quaternion) {
      dummy.quaternion.copy(rotation);
    }
    if (scale) dummy.scale.copy(scale);

    dummy.updateMatrix();
    group.mesh.setMatrixAt(index, dummy.matrix);
    group.mesh.instanceMatrix.needsUpdate = true;

    return true;
  }

  removeInstance(type: string, index: number): boolean {
    const group = this.groups.get(type);
    if (!group || !group.usedIndices.has(index)) {
      return false;
    }

    // Hide instance by scaling to zero
    const dummy = new THREE.Object3D();
    dummy.scale.set(0, 0, 0);
    dummy.updateMatrix();
    group.mesh.setMatrixAt(index, dummy.matrix);
    group.mesh.instanceMatrix.needsUpdate = true;

    // Return index to free pool
    group.usedIndices.delete(index);
    group.freeIndices.push(index);
    group.activeCount--;

    // Update count if this was the last instance
    if (index === group.mesh.count - 1) {
      // Find new max index
      let newCount = 0;
      for (const usedIndex of group.usedIndices) {
        newCount = Math.max(newCount, usedIndex + 1);
      }
      group.mesh.count = newCount;
    }

    return true;
  }

  // Batch update for better performance
  batchUpdate(
    type: string,
    updates: Array<{
      index: number;
      position?: THREE.Vector3;
      rotation?: THREE.Euler | THREE.Quaternion;
      scale?: THREE.Vector3;
    }>
  ): void {
    const group = this.groups.get(type);
    if (!group) return;

    const dummy = new THREE.Object3D();

    for (const update of updates) {
      if (!group.usedIndices.has(update.index)) continue;

      // Get current matrix
      const matrix = new THREE.Matrix4();
      group.mesh.getMatrixAt(update.index, matrix);
      dummy.matrix.copy(matrix);
      dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);

      // Apply updates
      if (update.position) dummy.position.copy(update.position);
      if (update.rotation instanceof THREE.Euler) {
        dummy.rotation.copy(update.rotation);
      } else if (update.rotation instanceof THREE.Quaternion) {
        dummy.quaternion.copy(update.rotation);
      }
      if (update.scale) dummy.scale.copy(update.scale);

      dummy.updateMatrix();
      group.mesh.setMatrixAt(update.index, dummy.matrix);
    }

    group.mesh.instanceMatrix.needsUpdate = true;
  }

  // Set custom attribute for instances (e.g., color)
  setInstanceAttribute(
    type: string,
    attributeName: string,
    index: number,
    value: number[]
  ): boolean {
    const group = this.groups.get(type);
    if (!group) return false;

    const attribute = group.mesh.geometry.getAttribute(attributeName);
    if (!attribute || !(attribute instanceof THREE.InstancedBufferAttribute)) {
      return false;
    }

    for (let i = 0; i < value.length; i++) {
      attribute.setX(index * value.length + i, value[i]);
    }
    attribute.needsUpdate = true;

    return true;
  }

  getStats(): Record<string, { active: number; max: number; utilization: number }> {
    const stats: Record<string, any> = {};

    for (const [type, group] of this.groups) {
      stats[type] = {
        active: group.activeCount,
        max: group.maxCount,
        utilization: (group.activeCount / group.maxCount) * 100,
      };
    }

    return stats;
  }

  dispose(): void {
    for (const group of this.groups.values()) {
      group.mesh.geometry.dispose();
      if (group.mesh.material instanceof THREE.Material) {
        group.mesh.material.dispose();
      } else if (Array.isArray(group.mesh.material)) {
        group.mesh.material.forEach(mat => mat.dispose());
      }
      this.scene.remove(group.mesh);
    }

    this.groups.clear();
  }
}
