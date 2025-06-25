import * as THREE from 'three';
import { IronDomeBattery } from '../entities/IronDomeBattery';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MaterialCache } from '../utils/MaterialCache';

export class InstancedDomeRenderer {
  private scene: THREE.Scene;
  private maxDomes: number;

  // Instanced meshes for different parts
  private basePlatformMesh: THREE.InstancedMesh;
  private launcherBaseMesh: THREE.InstancedMesh;
  private radarDomeMesh: THREE.InstancedMesh;
  private launcherTubesMesh: THREE.InstancedMesh;

  // Temporary object for matrix calculations
  private dummy = new THREE.Object3D();

  // Track which instances are active
  private activeCount = 0;

  constructor(scene: THREE.Scene, maxDomes: number = 50) {
    this.scene = scene;
    this.maxDomes = maxDomes;

    // Create geometries (shared by all instances)
    const basePlatformGeometry = new THREE.BoxGeometry(12, 2, 12);
    const launcherBaseGeometry = new THREE.CylinderGeometry(8, 8, 1, 8);
    const radarDomeGeometry = new THREE.SphereGeometry(4, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2);

    // Create merged launcher tubes geometry (20 tubes in a circle)
    const tubeGeometries: THREE.BufferGeometry[] = [];
    const tubeGeo = new THREE.CylinderGeometry(0.4, 0.4, 6, 8);
    for (let i = 0; i < 20; i++) {
      const angle = (i / 20) * Math.PI * 2;
      const tubeClone = tubeGeo.clone();
      const matrix = new THREE.Matrix4();
      matrix.makeTranslation(Math.cos(angle) * 5, 0, Math.sin(angle) * 5);
      const rotMatrix = new THREE.Matrix4();
      rotMatrix.makeRotationZ(Math.PI / 8);
      matrix.multiply(rotMatrix);
      tubeClone.applyMatrix4(matrix);
      tubeGeometries.push(tubeClone);
    }
    const mergedTubesGeometry = BufferGeometryUtils.mergeGeometries(tubeGeometries);
    tubeGeometries.forEach(g => g.dispose());
    tubeGeo.dispose();

    // Use cached materials to prevent shader recompilation
    const materialCache = MaterialCache.getInstance();
    const baseMaterial = materialCache.getMeshStandardMaterial({
      color: 0x4a5568,
      metalness: 0.7,
      roughness: 0.3,
    });

    const domeMaterial = materialCache.getMeshEmissiveMaterial({
      color: 0x0038b8,
      metalness: 0.3,
      roughness: 0.7,
      emissive: 0x0038b8,
      emissiveIntensity: 0.1,
    });

    // Create instanced meshes
    this.basePlatformMesh = new THREE.InstancedMesh(basePlatformGeometry, baseMaterial, maxDomes);
    this.basePlatformMesh.castShadow = true;
    this.basePlatformMesh.receiveShadow = true;

    this.launcherBaseMesh = new THREE.InstancedMesh(
      launcherBaseGeometry,
      baseMaterial, // Use same material instead of cloning
      maxDomes
    );
    this.launcherBaseMesh.castShadow = true;

    this.radarDomeMesh = new THREE.InstancedMesh(radarDomeGeometry, domeMaterial, maxDomes);
    this.radarDomeMesh.castShadow = true;

    // Create instanced launcher tubes
    const tubesMaterial = materialCache.getMeshStandardMaterial({
      color: 0x666666,
      metalness: 0.7,
      roughness: 0.3,
    });

    this.launcherTubesMesh = new THREE.InstancedMesh(mergedTubesGeometry, tubesMaterial, maxDomes);
    this.launcherTubesMesh.castShadow = true;

    // Add to scene
    this.scene.add(this.basePlatformMesh);
    this.scene.add(this.launcherBaseMesh);
    this.scene.add(this.radarDomeMesh);
    this.scene.add(this.launcherTubesMesh);

    // Initialize all instances as invisible
    const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < maxDomes; i++) {
      this.basePlatformMesh.setMatrixAt(i, zeroScale);
      this.launcherBaseMesh.setMatrixAt(i, zeroScale);
      this.radarDomeMesh.setMatrixAt(i, zeroScale);
      this.launcherTubesMesh.setMatrixAt(i, zeroScale);
    }

    this.basePlatformMesh.instanceMatrix.needsUpdate = true;
    this.launcherBaseMesh.instanceMatrix.needsUpdate = true;
    this.radarDomeMesh.instanceMatrix.needsUpdate = true;
    this.launcherTubesMesh.instanceMatrix.needsUpdate = true;
  }

  updateDomes(domes: Map<string, { battery: IronDomeBattery; level: number }>) {
    let index = 0;

    domes.forEach(({ battery, level }) => {
      if (index >= this.maxDomes) return;

      const position = battery.getPosition();
      const scale = 1 + (level - 1) * 0.1; // Slightly larger for higher levels

      // Update base platform
      this.dummy.position.set(position.x, 1, position.z);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();
      this.basePlatformMesh.setMatrixAt(index, this.dummy.matrix);

      // Update launcher base
      this.dummy.position.set(position.x, 2.5, position.z);
      this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();
      this.launcherBaseMesh.setMatrixAt(index, this.dummy.matrix);

      // Update radar dome
      this.dummy.position.set(position.x, 6, position.z);
      this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();
      this.radarDomeMesh.setMatrixAt(index, this.dummy.matrix);

      // Update launcher tubes
      this.dummy.position.set(position.x, 2.5, position.z);
      this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();
      this.launcherTubesMesh.setMatrixAt(index, this.dummy.matrix);

      // Set color based on health (using emissive for damage indication)
      const health = battery.getHealth();
      const healthPercent = health.current / health.max;

      if (healthPercent < 0.3) {
        this.radarDomeMesh.setColorAt(index, new THREE.Color(0xff0000));
      } else if (healthPercent < 0.6) {
        this.radarDomeMesh.setColorAt(index, new THREE.Color(0xff8800));
      } else {
        this.radarDomeMesh.setColorAt(index, new THREE.Color(0x0038b8));
      }

      index++;
    });

    // Hide unused instances
    const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = index; i < this.activeCount; i++) {
      this.basePlatformMesh.setMatrixAt(i, zeroScale);
      this.launcherBaseMesh.setMatrixAt(i, zeroScale);
      this.radarDomeMesh.setMatrixAt(i, zeroScale);
      this.launcherTubesMesh.setMatrixAt(i, zeroScale);
    }

    this.activeCount = index;

    // Update instance attributes
    this.basePlatformMesh.instanceMatrix.needsUpdate = true;
    this.launcherBaseMesh.instanceMatrix.needsUpdate = true;
    this.radarDomeMesh.instanceMatrix.needsUpdate = true;
    this.launcherTubesMesh.instanceMatrix.needsUpdate = true;

    if (this.radarDomeMesh.instanceColor) {
      this.radarDomeMesh.instanceColor.needsUpdate = true;
    }

    // Update count for culling
    this.basePlatformMesh.count = index;
    this.launcherBaseMesh.count = index;
    this.radarDomeMesh.count = index;
    this.launcherTubesMesh.count = index;
  }

  dispose() {
    // Clean up geometries and materials
    this.basePlatformMesh.geometry.dispose();
    this.launcherBaseMesh.geometry.dispose();
    this.radarDomeMesh.geometry.dispose();
    this.launcherTubesMesh.geometry.dispose();

    if (this.basePlatformMesh.material instanceof THREE.Material) {
      this.basePlatformMesh.material.dispose();
    }
    if (this.launcherBaseMesh.material instanceof THREE.Material) {
      this.launcherBaseMesh.material.dispose();
    }
    if (this.radarDomeMesh.material instanceof THREE.Material) {
      this.radarDomeMesh.material.dispose();
    }
    if (this.launcherTubesMesh.material instanceof THREE.Material) {
      this.launcherTubesMesh.material.dispose();
    }

    // Remove from scene
    this.scene.remove(this.basePlatformMesh);
    this.scene.remove(this.launcherBaseMesh);
    this.scene.remove(this.radarDomeMesh);
    this.scene.remove(this.launcherTubesMesh);
  }
}
