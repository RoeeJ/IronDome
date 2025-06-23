import * as THREE from 'three';

export interface FragmentationConfig {
  fragmentCount: number;
  coneAngle: number; // Cone spread angle in degrees
  coneDirection: THREE.Vector3;
  fragmentSpeed: number; // m/s
  fragmentLifetime: number; // seconds
  damageRadius: number; // meters
  visualScale: number;
}

interface Fragment {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  lifetime: number;
  mesh: THREE.Mesh;
}

export class FragmentationSystem {
  private scene: THREE.Scene;
  private fragments: Fragment[] = [];
  private fragmentGeometry: THREE.SphereGeometry;
  private fragmentMaterial: THREE.MeshBasicMaterial;
  private shrapnelCloud?: THREE.Points;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Reusable geometry and material for fragments
    this.fragmentGeometry = new THREE.SphereGeometry(0.05, 4, 2);
    this.fragmentMaterial = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      emissive: 0xff6600,
      emissiveIntensity: 0.5,
    });
  }

  createFragmentation(
    position: THREE.Vector3,
    targetDirection: THREE.Vector3,
    quality: number = 1.0,
    config: Partial<FragmentationConfig> = {}
  ): void {
    const fullConfig: FragmentationConfig = {
      fragmentCount: Math.floor(30 * quality), // Further reduced
      coneAngle: 45,
      coneDirection: targetDirection.normalize(),
      fragmentSpeed: 150,
      fragmentLifetime: 0.3, // Reduced from 0.5
      damageRadius: 15,
      visualScale: 1,
      ...config,
    };

    // Create shrapnel cloud visualization
    this.createShrapnelCloud(position, fullConfig);

    // Create individual tracked fragments for damage calculation
    this.createTrackedFragments(position, fullConfig);

    // Create cone visualization
    this.createConeVisualization(position, fullConfig);
  }

  private createShrapnelCloud(position: THREE.Vector3, config: FragmentationConfig): void {
    const particleCount = config.fragmentCount; // Use same count as fragments
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);

    const coneAngleRad = (config.coneAngle * Math.PI) / 180;

    for (let i = 0; i < particleCount; i++) {
      // Random position within small sphere
      positions[i * 3] = position.x + (Math.random() - 0.5) * 0.5;
      positions[i * 3 + 1] = position.y + (Math.random() - 0.5) * 0.5;
      positions[i * 3 + 2] = position.z + (Math.random() - 0.5) * 0.5;

      // Generate velocity within cone
      const theta = Math.random() * coneAngleRad;
      const phi = Math.random() * Math.PI * 2;

      // Create random direction within cone
      const dir = new THREE.Vector3(
        Math.sin(theta) * Math.cos(phi),
        Math.sin(theta) * Math.sin(phi),
        Math.cos(theta)
      );

      // Rotate to align with cone direction
      const quaternion = new THREE.Quaternion();
      quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), config.coneDirection);
      dir.applyQuaternion(quaternion);

      const speed = config.fragmentSpeed * (0.5 + Math.random() * 0.5);
      velocities[i * 3] = dir.x * speed;
      velocities[i * 3 + 1] = dir.y * speed;
      velocities[i * 3 + 2] = dir.z * speed;

      sizes[i] = Math.random() * 2 + 1;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.PointsMaterial({
      size: 0.1,
      color: 0xffcc00,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.8,
      sizeAttenuation: true,
    });

    this.shrapnelCloud = new THREE.Points(geometry, material);
    this.scene.add(this.shrapnelCloud);

    // Animate shrapnel cloud
    const startTime = Date.now();
    const animate = () => {
      const elapsed = (Date.now() - startTime) / 1000;

      if (elapsed > config.fragmentLifetime) {
        this.scene.remove(this.shrapnelCloud!);
        geometry.dispose();
        material.dispose();
        return;
      }

      const positions = geometry.attributes.position.array as Float32Array;
      const velocities = geometry.attributes.velocity.array as Float32Array;

      for (let i = 0; i < particleCount; i++) {
        positions[i * 3] += velocities[i * 3] * 0.016;
        positions[i * 3 + 1] += velocities[i * 3 + 1] * 0.016 - 9.8 * 0.016;
        positions[i * 3 + 2] += velocities[i * 3 + 2] * 0.016;
      }

      geometry.attributes.position.needsUpdate = true;
      material.opacity = 0.8 * (1 - elapsed / config.fragmentLifetime);

      requestAnimationFrame(animate);
    };

    animate();
  }

  private createTrackedFragments(position: THREE.Vector3, config: FragmentationConfig): void {
    // Create a subset of fragments for actual damage calculation
    const trackedCount = Math.min(20, config.fragmentCount / 10);
    const coneAngleRad = (config.coneAngle * Math.PI) / 180;

    for (let i = 0; i < trackedCount; i++) {
      // Generate direction within cone
      const theta = Math.random() * coneAngleRad;
      const phi = Math.random() * Math.PI * 2;

      const dir = new THREE.Vector3(
        Math.sin(theta) * Math.cos(phi),
        Math.sin(theta) * Math.sin(phi),
        Math.cos(theta)
      );

      // Rotate to align with cone direction
      const quaternion = new THREE.Quaternion();
      quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), config.coneDirection);
      dir.applyQuaternion(quaternion);

      const speed = config.fragmentSpeed * (0.7 + Math.random() * 0.3);
      const velocity = dir.multiplyScalar(speed);

      const mesh = new THREE.Mesh(this.fragmentGeometry, this.fragmentMaterial);
      mesh.position.copy(position);
      this.scene.add(mesh);

      this.fragments.push({
        position: position.clone(),
        velocity: velocity,
        lifetime: config.fragmentLifetime,
        mesh: mesh,
      });
    }
  }

  private createConeVisualization(position: THREE.Vector3, config: FragmentationConfig): void {
    // Create a brief cone flash to show fragmentation pattern
    const coneAngleRad = (config.coneAngle * Math.PI) / 180;
    const coneLength = config.damageRadius;
    const coneRadius = Math.tan(coneAngleRad) * coneLength;

    const geometry = new THREE.ConeGeometry(coneRadius, coneLength, 16, 1, true);
    const material = new THREE.MeshBasicMaterial({
      color: 0xff6600,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    });

    const cone = new THREE.Mesh(geometry, material);
    cone.position.copy(position);

    // Orient cone to face target direction
    const quaternion = new THREE.Quaternion();
    quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), config.coneDirection);
    cone.quaternion.copy(quaternion);
    cone.translateY(-coneLength / 2);

    this.scene.add(cone);

    // Fade out and remove
    const fadeOut = () => {
      material.opacity -= 0.02;
      if (material.opacity <= 0) {
        this.scene.remove(cone);
        geometry.dispose();
        material.dispose();
        return;
      }
      requestAnimationFrame(fadeOut);
    };

    setTimeout(fadeOut, 100);
  }

  update(deltaTime: number): { fragmentPositions: THREE.Vector3[] } {
    const activePositions: THREE.Vector3[] = [];

    for (let i = this.fragments.length - 1; i >= 0; i--) {
      const fragment = this.fragments[i];
      fragment.lifetime -= deltaTime;

      if (fragment.lifetime <= 0) {
        this.scene.remove(fragment.mesh);
        fragment.mesh.geometry.dispose();
        this.fragments.splice(i, 1);
        continue;
      }

      // Update position
      fragment.position.add(fragment.velocity.clone().multiplyScalar(deltaTime));
      fragment.velocity.y -= 9.8 * deltaTime; // Gravity
      fragment.mesh.position.copy(fragment.position);

      // Fade out
      const material = fragment.mesh.material as THREE.MeshBasicMaterial;
      material.opacity = fragment.lifetime / 0.5;

      activePositions.push(fragment.position.clone());
    }

    return { fragmentPositions: activePositions };
  }

  checkFragmentHits(targetPosition: THREE.Vector3, targetRadius: number = 2): boolean {
    for (const fragment of this.fragments) {
      const distance = fragment.position.distanceTo(targetPosition);
      if (distance <= targetRadius) {
        return true;
      }
    }
    return false;
  }

  dispose(): void {
    // Clean up all fragments
    this.fragments.forEach(fragment => {
      this.scene.remove(fragment.mesh);
      fragment.mesh.geometry.dispose();
    });
    this.fragments = [];

    if (this.shrapnelCloud) {
      this.scene.remove(this.shrapnelCloud);
      this.shrapnelCloud.geometry.dispose();
      (this.shrapnelCloud.material as THREE.Material).dispose();
    }
  }
}
