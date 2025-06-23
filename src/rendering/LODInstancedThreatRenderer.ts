import * as THREE from 'three';
import { InstancedThreatRenderer, MeshCategory } from './InstancedThreatRenderer';
import { LODSystem } from './LODSystem';
import type { Threat } from '../threats/ThreatTypes';

interface LODMeshSet {
  high: THREE.InstancedMesh;
  medium: THREE.InstancedMesh;
  low: THREE.InstancedMesh;
}

export class LODInstancedThreatRenderer extends InstancedThreatRenderer {
  private lodSystem: LODSystem;
  private lodMeshes: Map<MeshCategory, LODMeshSet> = new Map();
  private threatLODLevel: Map<string, number> = new Map();
  private lodAvailableIndices: Map<string, number[]> = new Map();
  private threatObjects: Map<string, Threat> = new Map();

  constructor(scene: THREE.Scene, camera: THREE.Camera, maxThreatsPerType: number = 100) {
    // Don't call super constructor yet - we need to handle setup differently
    // @ts-ignore - We'll initialize these manually
    super(scene, 0);

    this.scene = scene;
    this.maxThreatsPerType = maxThreatsPerType;
    this.lodSystem = new LODSystem(camera);

    // Register LOD configs
    const threatLODs = LODSystem.createThreatLODs();
    Object.entries(threatLODs).forEach(([type, config]) => {
      this.lodSystem.registerLODConfig(type, config);
    });

    // Create LOD meshes for each threat type
    this.createLODMeshes();
  }

  private createLODMeshes() {
    const threatLODs = LODSystem.createThreatLODs();

    // Materials for each threat type
    const materials = {
      rocket: new THREE.MeshStandardMaterial({
        color: 0xff0000,
        emissive: 0xff0000,
        emissiveIntensity: 0.2,
        roughness: 0.4,
        metalness: 0.6,
      }),
      mortar: new THREE.MeshStandardMaterial({
        color: 0x444444,
        roughness: 0.8,
        metalness: 0.2,
      }),
      drone: new THREE.MeshStandardMaterial({
        color: 0x222222,
        roughness: 0.9,
        metalness: 0.1,
      }),
      ballistic: new THREE.MeshStandardMaterial({
        color: 0xffaa00,
        emissive: 0xffaa00,
        emissiveIntensity: 0.3,
        roughness: 0.3,
        metalness: 0.7,
      }),
    };

    // Create instanced meshes for each LOD level
    Object.entries(threatLODs).forEach(([type, config]) => {
      const material = materials[type as keyof typeof materials];

      const lodSet: LODMeshSet = {
        high: new THREE.InstancedMesh(config.levels[0].geometry, material, this.maxThreatsPerType),
        medium: new THREE.InstancedMesh(
          config.levels[1].geometry,
          material,
          this.maxThreatsPerType
        ),
        low: new THREE.InstancedMesh(config.levels[2].geometry, material, this.maxThreatsPerType),
      };

      // Initialize all instances as invisible
      const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0);
      Object.values(lodSet).forEach(mesh => {
        mesh.castShadow = true;
        mesh.receiveShadow = false;

        for (let i = 0; i < this.maxThreatsPerType; i++) {
          mesh.setMatrixAt(i, zeroScale);
        }
        mesh.instanceMatrix.needsUpdate = true;
        this.scene.add(mesh);
      });

      // Set up available indices for each LOD level
      const baseKey = `${type}_`;
      this.lodAvailableIndices.set(
        `${baseKey}high`,
        Array.from({ length: this.maxThreatsPerType }, (_, i) => i)
      );
      this.lodAvailableIndices.set(
        `${baseKey}medium`,
        Array.from({ length: this.maxThreatsPerType }, (_, i) => i)
      );
      this.lodAvailableIndices.set(
        `${baseKey}low`,
        Array.from({ length: this.maxThreatsPerType }, (_, i) => i)
      );

      this.lodMeshes.set(type as MeshCategory, lodSet);
    });

    // Override parent's threatMeshes with high detail meshes for compatibility
    this.threatMeshes = {
      rocket: this.lodMeshes.get('rocket')!.high,
      mortar: this.lodMeshes.get('mortar')!.high,
      drone: this.lodMeshes.get('drone')!.high,
      ballistic: this.lodMeshes.get('ballistic')!.high,
    };
  }

  override addThreat(threat: Threat): boolean {
    const category = this.getMeshCategory(threat);
    if (!category) return false;

    const lodSet = this.lodMeshes.get(category);
    if (!lodSet) return false;

    // Store threat object reference
    const threatId = threat.id;
    this.threatObjects.set(threatId, threat);

    // Determine initial LOD level
    const lodLevel = this.lodSystem.getLODLevel(category, threat.getPosition());
    this.threatLODLevel.set(threatId, lodLevel);

    // Get appropriate mesh based on LOD
    const mesh = this.getLODMesh(category, lodLevel);
    const lodKey = `${category}_${this.getLODName(lodLevel)}`;
    const availableIndices = this.lodAvailableIndices.get(lodKey);

    if (!availableIndices || availableIndices.length === 0) return false;

    const index = availableIndices.pop()!;
    this.threatToIndex.set(threatId, { meshCategory: category, index, lodLevel });

    // Set initial transform
    this.dummy.position.copy(threat.getPosition());
    this.dummy.rotation.copy(threat.getRotation());
    this.dummy.scale.copy(threat.getScale());
    this.dummy.updateMatrix();

    mesh.setMatrixAt(index, this.dummy.matrix);
    mesh.instanceMatrix.needsUpdate = true;

    return true;
  }

  override removeThreat(threatId: string): void {
    const data = this.threatToIndex.get(threatId);
    if (!data) return;

    const { meshCategory, index, lodLevel } = data as any;
    const mesh = this.getLODMesh(meshCategory, lodLevel);

    // Hide the instance
    const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0);
    mesh.setMatrixAt(index, zeroScale);
    mesh.instanceMatrix.needsUpdate = true;

    // Return index to available pool
    const lodKey = `${meshCategory}_${this.getLODName(lodLevel)}`;
    this.lodAvailableIndices.get(lodKey)?.push(index);

    this.threatToIndex.delete(threatId);
    this.threatLODLevel.delete(threatId);
    this.threatObjects.delete(threatId);
  }

  override updateThreats(threats: Threat[], currentTime: number): void {
    // Check if we should update LOD levels
    const shouldUpdateLOD = this.lodSystem.shouldUpdate(currentTime);

    threats.forEach(threat => {
      const threatId = threat.id;
      const data = this.threatToIndex.get(threatId);
      if (!data) return;

      const { meshCategory: category, index } = data as any;
      let currentLODLevel = this.threatLODLevel.get(threatId) || 0;

      // Update LOD level if needed
      if (shouldUpdateLOD) {
        const newLODLevel = this.lodSystem.getLODLevel(category, threat.getPosition());

        if (newLODLevel !== currentLODLevel) {
          // Transfer to new LOD mesh
          this.transferThreatLOD(threatId, category, index, currentLODLevel, newLODLevel);
          currentLODLevel = newLODLevel;
        }
      }

      // Update position/rotation/scale
      const mesh = this.getLODMesh(category, currentLODLevel);
      this.dummy.position.copy(threat.getPosition());
      this.dummy.rotation.copy(threat.getRotation());
      this.dummy.scale.copy(threat.getScale());
      this.dummy.updateMatrix();

      const actualIndex = (this.threatToIndex.get(threatId) as any).index;
      mesh.setMatrixAt(actualIndex, this.dummy.matrix);
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  private transferThreatLOD(
    threatId: string,
    category: MeshCategory,
    oldIndex: number,
    oldLOD: number,
    newLOD: number
  ) {
    // Hide in old LOD
    const oldMesh = this.getLODMesh(category, oldLOD);
    const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0);
    oldMesh.setMatrixAt(oldIndex, zeroScale);
    oldMesh.instanceMatrix.needsUpdate = true;

    // Return old index
    const oldLodKey = `${category}_${this.getLODName(oldLOD)}`;
    this.lodAvailableIndices.get(oldLodKey)?.push(oldIndex);

    // Get new index
    const newLodKey = `${category}_${this.getLODName(newLOD)}`;
    const availableIndices = this.lodAvailableIndices.get(newLodKey);

    if (!availableIndices || availableIndices.length === 0) {
      // No available indices in new LOD, keep in old LOD
      this.threatLODLevel.set(threatId, oldLOD);
      return;
    }

    const newIndex = availableIndices.pop()!;

    // Update tracking
    this.threatToIndex.set(threatId, { meshCategory: category, index: newIndex, lodLevel: newLOD });
    this.threatLODLevel.set(threatId, newLOD);
  }

  private getLODMesh(category: MeshCategory, lodLevel: number): THREE.InstancedMesh {
    const lodSet = this.lodMeshes.get(category)!;
    switch (lodLevel) {
      case 0:
        return lodSet.high;
      case 1:
        return lodSet.medium;
      case 2:
        return lodSet.low;
      default:
        return lodSet.high;
    }
  }

  private getLODName(lodLevel: number): string {
    switch (lodLevel) {
      case 0:
        return 'high';
      case 1:
        return 'medium';
      case 2:
        return 'low';
      default:
        return 'high';
    }
  }

  override clear(): void {
    // Clear all LOD meshes
    this.lodMeshes.forEach((lodSet, category) => {
      const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0);

      Object.values(lodSet).forEach(mesh => {
        for (let i = 0; i < this.maxThreatsPerType; i++) {
          mesh.setMatrixAt(i, zeroScale);
        }
        mesh.instanceMatrix.needsUpdate = true;
      });
    });

    // Reset available indices
    this.lodAvailableIndices.forEach((indices, key) => {
      indices.length = 0;
      for (let i = 0; i < this.maxThreatsPerType; i++) {
        indices.push(i);
      }
    });

    this.threatToIndex.clear();
    this.threatLODLevel.clear();
    this.threatObjects.clear();
  }

  override dispose(): void {
    // Dispose all LOD meshes
    this.lodMeshes.forEach(lodSet => {
      Object.values(lodSet).forEach(mesh => {
        mesh.geometry.dispose();
        if (mesh.material instanceof THREE.Material) {
          mesh.material.dispose();
        }
        this.scene.remove(mesh);
      });
    });

    this.lodMeshes.clear();
    this.lodAvailableIndices.clear();
    this.threatLODLevel.clear();

    super.dispose();
  }
}
