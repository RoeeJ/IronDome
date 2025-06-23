import * as THREE from 'three';
import { Threat, ThreatType, THREAT_CONFIGS } from '../entities/Threat';
import { GeometryFactory } from '../utils/GeometryFactory';
import { MaterialCache } from '../utils/MaterialCache';

interface ThreatMeshes {
  rocket: THREE.InstancedMesh;
  mortar: THREE.InstancedMesh;
  drone: THREE.InstancedMesh;
  ballistic: THREE.InstancedMesh;
}

type MeshCategory = 'rocket' | 'mortar' | 'drone' | 'ballistic';

export class InstancedThreatRenderer {
  private scene: THREE.Scene;
  private maxThreatsPerType: number;

  // Instanced meshes for each threat type
  private threatMeshes: ThreatMeshes;

  // Temporary object for matrix calculations
  private dummy = new THREE.Object3D();

  // Map threat IDs to instance indices per type
  private threatToIndex = new Map<
    string,
    { type: ThreatType; meshCategory: MeshCategory; index: number }
  >();
  private availableIndices: Map<MeshCategory, number[]> = new Map();

  constructor(scene: THREE.Scene, maxThreatsPerType: number = 100) {
    this.scene = scene;
    this.maxThreatsPerType = maxThreatsPerType;

    // Get geometries from factory for each threat type
    const rocketGeometry = GeometryFactory.getInstance().getCone(0.3, 3, 6).clone();
    rocketGeometry.rotateX(Math.PI / 2);

    const mortarGeometry = GeometryFactory.getInstance().getSphere(0.4, 8, 6);

    const droneGeometry = GeometryFactory.getInstance().getBox(1.5, 0.3, 1.5);

    const ballisticGeometry = GeometryFactory.getInstance().getCone(0.5, 4, 8).clone();
    ballisticGeometry.rotateX(Math.PI / 2);

    // Get materials from cache for each type
    const rocketMaterial = MaterialCache.getInstance().getMeshStandardMaterial({
      color: 0xff0000,
      emissive: 0xff0000,
      emissiveIntensity: 0.2,
      roughness: 0.4,
      metalness: 0.6,
    });

    const mortarMaterial = MaterialCache.getInstance().getMeshStandardMaterial({
      color: 0x444444,
      roughness: 0.8,
      metalness: 0.2,
    });

    const droneMaterial = MaterialCache.getInstance().getMeshStandardMaterial({
      color: 0x222222,
      roughness: 0.9,
      metalness: 0.1,
    });

    const ballisticMaterial = MaterialCache.getInstance().getMeshStandardMaterial({
      color: 0xffaa00,
      emissive: 0xffaa00,
      emissiveIntensity: 0.3,
      roughness: 0.3,
      metalness: 0.7,
    });

    // Create instanced meshes
    this.threatMeshes = {
      rocket: new THREE.InstancedMesh(rocketGeometry, rocketMaterial, maxThreatsPerType),
      mortar: new THREE.InstancedMesh(mortarGeometry, mortarMaterial, maxThreatsPerType),
      drone: new THREE.InstancedMesh(droneGeometry, droneMaterial, maxThreatsPerType),
      ballistic: new THREE.InstancedMesh(ballisticGeometry, ballisticMaterial, maxThreatsPerType),
    };

    // Initialize all instances as invisible and set up available indices
    const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0);
    Object.entries(this.threatMeshes).forEach(([type, mesh]) => {
      mesh.castShadow = true;
      mesh.receiveShadow = false;

      const indices: number[] = [];
      for (let i = 0; i < maxThreatsPerType; i++) {
        mesh.setMatrixAt(i, zeroScale);
        indices.push(i);
      }
      mesh.instanceMatrix.needsUpdate = true;

      this.availableIndices.set(type as MeshCategory, indices);
      this.scene.add(mesh);
    });
  }

  private getMeshCategory(threatType: ThreatType): MeshCategory {
    // Map threat types to mesh categories
    switch (threatType) {
      case ThreatType.MORTAR:
        return 'mortar';

      case ThreatType.DRONE_SLOW:
      case ThreatType.DRONE_FAST:
        return 'drone';

      case ThreatType.CRUISE_MISSILE:
        return 'ballistic';

      // All rocket types use the rocket mesh
      case ThreatType.SHORT_RANGE:
      case ThreatType.MEDIUM_RANGE:
      case ThreatType.LONG_RANGE:
      case ThreatType.QASSAM_1:
      case ThreatType.QASSAM_2:
      case ThreatType.QASSAM_3:
      case ThreatType.GRAD_ROCKET:
      default:
        return 'rocket';
    }
  }

  addThreat(threat: Threat): boolean {
    const type = threat.type;
    const meshCategory = this.getMeshCategory(type);
    const availableForType = this.availableIndices.get(meshCategory);

    if (!availableForType || availableForType.length === 0) {
      console.warn(
        `No available instance slots for threat type: ${type} (mesh category: ${meshCategory})`
      );
      return false;
    }

    const index = availableForType.pop()!;
    this.threatToIndex.set(threat.id, { type, meshCategory, index });

    // Hide the threat's own mesh
    threat.mesh.visible = false;

    return true;
  }

  removeThreat(threatId: string): void {
    const data = this.threatToIndex.get(threatId);
    if (!data) return;

    const { meshCategory, index } = data;

    // Return index to available pool
    this.availableIndices.get(meshCategory)?.push(index);
    this.threatToIndex.delete(threatId);

    // Hide this instance
    const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0);
    this.threatMeshes[meshCategory].setMatrixAt(index, zeroScale);
    this.threatMeshes[meshCategory].instanceMatrix.needsUpdate = true;
  }

  updateThreats(threats: Threat[]): void {
    const needsUpdate: Set<MeshCategory> = new Set();

    threats.forEach(threat => {
      const data = this.threatToIndex.get(threat.id);
      if (!data) return;

      const { type, meshCategory, index } = data;
      const mesh = this.threatMeshes[meshCategory];

      // Get threat position and velocity for orientation
      const position = threat.getPosition();
      const velocity = threat.getVelocity();

      // Update position
      this.dummy.position.copy(position);

      // Orient based on mesh category
      if (meshCategory === 'drone') {
        // Drones stay level
        this.dummy.rotation.set(0, 0, 0);
      } else if (velocity.length() > 0) {
        // Other threats point in direction of travel
        const direction = velocity.clone().normalize();
        this.dummy.lookAt(
          position.x + direction.x,
          position.y + direction.y,
          position.z + direction.z
        );
      }

      // Scale based on threat config
      const config = THREAT_CONFIGS[type];
      const scale = config.radius ? config.radius * 2 : 1;
      this.dummy.scale.set(scale, scale, scale);

      this.dummy.updateMatrix();
      mesh.setMatrixAt(index, this.dummy.matrix);
      needsUpdate.add(meshCategory);
    });

    // Update only the meshes that changed
    needsUpdate.forEach(meshCategory => {
      this.threatMeshes[meshCategory].instanceMatrix.needsUpdate = true;
    });
  }

  clear(): void {
    // Hide all instances
    const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0);

    Object.entries(this.threatMeshes).forEach(([type, mesh]) => {
      for (let i = 0; i < this.maxThreatsPerType; i++) {
        mesh.setMatrixAt(i, zeroScale);
      }
      mesh.instanceMatrix.needsUpdate = true;

      // Reset available indices
      const indices: number[] = [];
      for (let i = 0; i < this.maxThreatsPerType; i++) {
        indices.push(i);
      }
      this.availableIndices.set(type as MeshCategory, indices);
    });

    // Reset tracking
    this.threatToIndex.clear();
  }

  dispose(): void {
    Object.values(this.threatMeshes).forEach(mesh => {
      // Dispose cloned geometries (rocket and ballistic are cloned)
      mesh.geometry.dispose();
      // Don't dispose shared materials from MaterialCache
      this.scene.remove(mesh);
    });
  }
}
