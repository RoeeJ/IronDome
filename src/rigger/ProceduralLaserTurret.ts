import * as THREE from 'three';

export class ProceduralLaserTurret extends THREE.Group {
  public base: THREE.Group;
  public yawGroup: THREE.Group;
  public pitchGroup: THREE.Group;
  public emitter: THREE.Group;
  public laserPreview: THREE.Group;
  private laserBeam?: THREE.Mesh;
  private laserTarget?: THREE.Mesh;
  public materials: {
    metal: THREE.MeshStandardMaterial;
    darkMetal: THREE.MeshStandardMaterial;
    emissive: THREE.MeshStandardMaterial;
    glass: THREE.MeshStandardMaterial;
    lens: THREE.MeshPhysicalMaterial;
    laser: THREE.MeshBasicMaterial;
  };

  constructor() {
    super();
    this.name = 'ProceduralLaserTurret';

    // Create materials with better visual quality
    this.materials = {
      metal: new THREE.MeshStandardMaterial({
        color: 0x6b7280,
        metalness: 0.9,
        roughness: 0.15,
        envMapIntensity: 1.0,
      }),
      darkMetal: new THREE.MeshStandardMaterial({
        color: 0x1f2937,
        metalness: 0.95,
        roughness: 0.25,
        envMapIntensity: 0.8,
      }),
      emissive: new THREE.MeshStandardMaterial({
        color: 0x00ff88,
        emissive: 0x00ff88,
        emissiveIntensity: 2.0,
        toneMapped: false,
      }),
      glass: new THREE.MeshPhysicalMaterial({
        color: 0x88ddff,
        metalness: 0.1,
        roughness: 0.1,
        transmission: 0.9,
        thickness: 0.5,
        transparent: true,
        opacity: 0.8,
        emissive: 0x4488ff,
        emissiveIntensity: 0.3,
      }),
      lens: new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 0.0,
        roughness: 0.0,
        transmission: 0.95,
        thickness: 1.0,
        transparent: true,
        opacity: 0.9,
        ior: 2.4, // High index of refraction for lens effect
      }),
      laser: new THREE.MeshBasicMaterial({
        color: 0x00ff88,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    };

    // Create groups first
    this.yawGroup = new THREE.Group();
    this.yawGroup.name = 'yawGroup';
    this.pitchGroup = new THREE.Group();
    this.pitchGroup.name = 'pitchGroup';
    
    // Build the turret components
    this.base = this.createBase();
    this.emitter = this.createEmitter();
    this.laserPreview = this.createLaserPreview();

    // Assemble hierarchy
    this.add(this.base);
    this.base.add(this.yawGroup);
    this.yawGroup.add(this.pitchGroup);
    this.pitchGroup.add(this.emitter);
    this.pitchGroup.add(this.laserPreview);
    
    // Add the ball housing to yaw group
    const housing = this.createBallHousing();
    this.yawGroup.add(housing);
  }

  private createBase(): THREE.Group {
    const base = new THREE.Group();
    base.name = 'base';

    // Cylindrical base with tech details
    const baseRadius = 2;
    const baseHeight = 1;
    
    // Main base cylinder
    const baseGeometry = new THREE.CylinderGeometry(baseRadius, baseRadius * 1.1, baseHeight, 32);
    const baseMesh = new THREE.Mesh(baseGeometry, this.materials.darkMetal);
    baseMesh.position.y = baseHeight / 2;
    base.add(baseMesh);

    // Add raised platform
    const platformGeometry = new THREE.CylinderGeometry(baseRadius * 0.8, baseRadius * 0.9, 0.3, 32);
    const platform = new THREE.Mesh(platformGeometry, this.materials.metal);
    platform.position.y = baseHeight + 0.15;
    base.add(platform);

    // Add detail rings
    for (let i = 0; i < 3; i++) {
      const ringRadius = baseRadius * (0.95 - i * 0.1);
      const ringGeometry = new THREE.TorusGeometry(ringRadius, 0.05, 8, 32);
      const ring = new THREE.Mesh(ringGeometry, this.materials.darkMetal);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = baseHeight + 0.1 + i * 0.1;
      base.add(ring);
    }

    // Add tech panels around edge
    const panelCount = 16;
    for (let i = 0; i < panelCount; i++) {
      const angle = (i / panelCount) * Math.PI * 2;
      const panelGeometry = new THREE.BoxGeometry(0.3, 0.2, 0.05);
      const panel = new THREE.Mesh(
        panelGeometry, 
        i % 4 === 0 ? this.materials.emissive : this.materials.metal
      );
      panel.position.set(
        Math.cos(angle) * baseRadius * 0.85,
        baseHeight * 0.7,
        Math.sin(angle) * baseRadius * 0.85
      );
      panel.rotation.y = angle;
      base.add(panel);
    }

    // Central support column
    const columnGeometry = new THREE.CylinderGeometry(0.5, 0.7, baseHeight + 1, 16);
    const column = new THREE.Mesh(columnGeometry, this.materials.metal);
    column.position.y = (baseHeight + 1) / 2;
    base.add(column);

    // Position yaw rotation point
    this.yawGroup.position.y = baseHeight + 1;

    return base;
  }

  private createBallHousing(): THREE.Group {
    const housing = new THREE.Group();
    housing.name = 'ballHousing';

    // Main ball housing - transparent sphere
    const ballRadius = 1.5;
    const ballGeometry = new THREE.SphereGeometry(ballRadius, 32, 32);
    const ballMesh = new THREE.Mesh(ballGeometry, this.materials.glass);
    housing.add(ballMesh);

    // Structural rings
    const ringCount = 3;
    for (let i = 0; i < ringCount; i++) {
      const phi = ((i + 1) / (ringCount + 1)) * Math.PI;
      const ringRadius = ballRadius * Math.sin(phi);
      const ringY = ballRadius * Math.cos(phi);
      
      const ringGeometry = new THREE.TorusGeometry(ringRadius, 0.05, 8, 32);
      const ring = new THREE.Mesh(ringGeometry, this.materials.darkMetal);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = ringY;
      housing.add(ring);
    }

    // Vertical supports
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      const supportGeometry = new THREE.TorusGeometry(ballRadius, 0.05, 8, 32);
      const support = new THREE.Mesh(supportGeometry, this.materials.darkMetal);
      support.rotation.y = angle;
      housing.add(support);
    }

    // Mounting ring at base
    const mountRingGeometry = new THREE.TorusGeometry(ballRadius * 0.7, 0.1, 8, 32);
    const mountRing = new THREE.Mesh(mountRingGeometry, this.materials.metal);
    mountRing.rotation.x = Math.PI / 2;
    mountRing.position.y = -ballRadius * 0.8;
    housing.add(mountRing);

    return housing;
  }

  private createEmitter(): THREE.Group {
    const emitter = new THREE.Group();
    emitter.name = 'emitter';

    // Core assembly - spherical base
    const coreRadius = 0.6;
    const coreGeometry = new THREE.SphereGeometry(coreRadius, 32, 16);
    const coreMesh = new THREE.Mesh(coreGeometry, this.materials.darkMetal);
    emitter.add(coreMesh);

    // Emitter rings around core
    for (let i = 0; i < 3; i++) {
      const ringGeometry = new THREE.TorusGeometry(coreRadius * (1 + i * 0.2), 0.03, 8, 32);
      const ring = new THREE.Mesh(ringGeometry, this.materials.emissive);
      ring.rotation.x = Math.PI / 2;
      ring.rotation.z = (i * Math.PI) / 6;
      emitter.add(ring);
    }

    // Main focusing lens assembly
    const lensAssembly = new THREE.Group();
    lensAssembly.position.x = coreRadius + 0.5; // Changed from Z to X since laser points along +X

    // Lens housing cone
    const housingGeometry = new THREE.ConeGeometry(0.8, 1, 16);
    const housing = new THREE.Mesh(housingGeometry, this.materials.metal);
    housing.rotation.z = -Math.PI / 2; // Rotate to point along +X
    housing.position.x = 0.5;
    lensAssembly.add(housing);

    // Primary focusing lens
    const primaryLensGeometry = new THREE.SphereGeometry(0.7, 32, 16);
    const primaryLens = new THREE.Mesh(primaryLensGeometry, this.materials.lens);
    primaryLens.scale.x = 0.3; // Flatten along X axis
    primaryLens.position.x = 1;
    lensAssembly.add(primaryLens);

    // Secondary lens array
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const secondaryLensGeometry = new THREE.SphereGeometry(0.15, 16, 16);
      const secondaryLens = new THREE.Mesh(secondaryLensGeometry, this.materials.glass);
      secondaryLens.position.y = Math.cos(angle) * 0.4;
      secondaryLens.position.z = Math.sin(angle) * 0.4;
      secondaryLens.position.x = 0.7;
      secondaryLens.scale.x = 0.5;
      lensAssembly.add(secondaryLens);
    }

    // Lens ring
    const lensRingGeometry = new THREE.TorusGeometry(0.7, 0.05, 8, 32);
    const lensRing = new THREE.Mesh(lensRingGeometry, this.materials.metal);
    lensRing.rotation.y = Math.PI / 2; // Rotate to face along X
    lensRing.position.x = 1;
    lensAssembly.add(lensRing);

    // Energy core (visible through lens)
    const energyCoreGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.5, 16);
    const energyCore = new THREE.Mesh(energyCoreGeometry, this.materials.emissive);
    energyCore.rotation.z = Math.PI / 2; // Rotate to point along X
    energyCore.position.x = 0.3;
    lensAssembly.add(energyCore);

    emitter.add(lensAssembly);

    // Add sensor nodes around the core
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const elevation = (Math.random() - 0.5) * Math.PI * 0.5;
      
      const sensorGeometry = new THREE.SphereGeometry(0.08, 8, 8);
      const sensor = new THREE.Mesh(sensorGeometry, this.materials.emissive);
      
      sensor.position.x = Math.cos(angle) * Math.cos(elevation) * coreRadius * 1.2;
      sensor.position.y = Math.sin(elevation) * coreRadius * 1.2;
      sensor.position.z = Math.sin(angle) * Math.cos(elevation) * coreRadius * 1.2;
      
      emitter.add(sensor);
    }

    // Power conduits connecting to core
    const conduitCount = 4;
    for (let i = 0; i < conduitCount; i++) {
      const angle = (i / conduitCount) * Math.PI * 2;
      const conduitGeometry = new THREE.CylinderGeometry(0.02, 0.04, coreRadius, 8);
      const conduit = new THREE.Mesh(conduitGeometry, this.materials.darkMetal);
      conduit.position.x = Math.cos(angle) * coreRadius * 0.5;
      conduit.position.z = Math.sin(angle) * coreRadius * 0.5;
      conduit.rotation.z = Math.PI / 2;
      conduit.rotation.y = angle;
      emitter.add(conduit);
    }

    return emitter;
  }

  private createLaserPreview(): THREE.Group {
    const laserGroup = new THREE.Group();
    laserGroup.name = 'laserPreview';
    
    // Create laser beam geometry
    const beamLength = 50;
    const beamGeometry = new THREE.CylinderGeometry(0.05, 0.1, beamLength, 8);
    this.laserBeam = new THREE.Mesh(beamGeometry, this.materials.laser);
    this.laserBeam.rotation.z = Math.PI / 2;
    this.laserBeam.position.x = beamLength / 2 + 1.6; // Start from lens position
    laserGroup.add(this.laserBeam);
    
    // Add glow effect around beam
    const glowGeometry = new THREE.CylinderGeometry(0.15, 0.2, beamLength, 8);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    glow.rotation.z = Math.PI / 2;
    glow.position.x = beamLength / 2 + 1.6;
    laserGroup.add(glow);
    
    // Add targeting reticle at end
    const reticleGeometry = new THREE.RingGeometry(0.3, 0.4, 32);
    const reticleMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8,
    });
    this.laserTarget = new THREE.Mesh(reticleGeometry, reticleMaterial);
    this.laserTarget.position.x = beamLength + 1.6;
    laserGroup.add(this.laserTarget);
    
    // Add inner reticle
    const innerReticleGeometry = new THREE.RingGeometry(0.1, 0.15, 32);
    const innerReticle = new THREE.Mesh(innerReticleGeometry, reticleMaterial);
    innerReticle.position.x = beamLength + 1.6;
    laserGroup.add(innerReticle);
    
    // Initially visible
    laserGroup.visible = true;
    
    return laserGroup;
  }

  public setLaserPreviewVisible(visible: boolean): void {
    if (this.laserPreview) {
      this.laserPreview.visible = visible;
    }
  }

  public updateLaserLength(targetDistance: number): void {
    if (!this.laserBeam || !this.laserTarget) return;
    
    // Clamp distance to reasonable range
    const distance = Math.max(2, Math.min(100, targetDistance));
    
    // Update beam length
    const beamGeometry = new THREE.CylinderGeometry(0.05, 0.1, distance, 8);
    this.laserBeam.geometry.dispose();
    this.laserBeam.geometry = beamGeometry;
    // The beam center should be at half the distance from the start point
    this.laserBeam.position.x = distance / 2 + 1.6;
    
    // Update target reticle position - it should be at the end of the beam
    this.laserTarget.position.x = distance + 1.6;
    
    // Update glow
    const glow = this.laserPreview.children.find(child => child !== this.laserBeam && child !== this.laserTarget);
    if (glow && glow instanceof THREE.Mesh) {
      const glowGeometry = new THREE.CylinderGeometry(0.15, 0.2, distance, 8);
      glow.geometry.dispose();
      glow.geometry = glowGeometry;
      glow.position.x = distance / 2 + 1.6;
    }
    
    // Update inner reticle
    const innerReticle = this.laserPreview.children[3];
    if (innerReticle) {
      innerReticle.position.x = distance + 1.6;
    }
  }

  // Helper method to aim the turret
  public aimAt(targetPosition: THREE.Vector3): void {
    // Get world position of the emitter (where the laser starts)
    const emitterWorldPos = new THREE.Vector3();
    this.emitter.getWorldPosition(emitterWorldPos);

    // Calculate direction to target from emitter position
    const direction = new THREE.Vector3().subVectors(targetPosition, emitterWorldPos);
    
    // Normalize direction
    direction.normalize();

    // Create a quaternion that rotates from +X axis to target direction
    const quaternion = new THREE.Quaternion();
    const rotationAxis = new THREE.Vector3(1, 0, 0).cross(direction).normalize();
    
    if (rotationAxis.length() > 0.001) {
      // Normal case: vectors are not parallel
      const angle = Math.acos(Math.max(-1, Math.min(1, new THREE.Vector3(1, 0, 0).dot(direction))));
      quaternion.setFromAxisAngle(rotationAxis, angle);
    } else if (direction.x < 0) {
      // Special case: pointing in opposite direction
      quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    }
    
    // Convert quaternion to Euler angles
    const euler = new THREE.Euler();
    euler.setFromQuaternion(quaternion, 'YZX'); // Y first (yaw), then Z (pitch)
    
    // Apply rotations FIRST
    this.yawGroup.rotation.y = euler.y;
    this.pitchGroup.rotation.z = euler.z;
    
    // The laser is in the pitch group's local space, pointing along +X
    // We need to calculate the distance in the pitch group's local space
    const targetLocal = this.pitchGroup.worldToLocal(targetPosition.clone());
    
    // The laser starts at x=1.6 in local space and extends along +X
    // So the distance is simply the X coordinate of the target in local space minus 1.6
    const laserDistance = targetLocal.x - 1.6;
    
    // Update laser preview length
    this.updateLaserLength(laserDistance);

    // Debug log occasionally
    if (Math.random() < 0.02) {
      console.log('Ball turret aiming:', {
        yaw: THREE.MathUtils.radToDeg(euler.y).toFixed(1),
        pitch: THREE.MathUtils.radToDeg(euler.z).toFixed(1),
        distance: laserDistance.toFixed(1),
        targetLocal: `${targetLocal.x.toFixed(1)}, ${targetLocal.y.toFixed(1)}, ${targetLocal.z.toFixed(1)}`
      });
    }
  }

  public setYaw(angle: number): void {
    this.yawGroup.rotation.y = angle;
  }

  public setPitch(angle: number): void {
    this.pitchGroup.rotation.z = angle;
  }

  public getYaw(): number {
    return this.yawGroup.rotation.y;
  }

  public getPitch(): number {
    return this.pitchGroup.rotation.z;
  }
}