import * as THREE from 'three';

export class ProceduralLaserTurret extends THREE.Group {
  public base: THREE.Group;
  public yawGroup: THREE.Group;
  public pitchGroup: THREE.Group;
  public emitter: THREE.Group;
  public laserPreview: THREE.Group;
  private laserBeam?: THREE.Mesh;
  private laserTarget?: THREE.Mesh;
  private energyEffects: THREE.Group;
  private plasmaField?: THREE.Mesh;
  private lightningBolts: THREE.Line[] = [];
  private clock = new THREE.Clock();
  
  // Particle system components
  private orbitalParticles: THREE.Points;
  private magneticParticles: THREE.Points;
  private sparkleParticles: THREE.Points;
  private particleData: {
    orbital: Array<{position: THREE.Vector3, velocity: THREE.Vector3, radius: number, speed: number, phase: number}>;
    magnetic: Array<{position: THREE.Vector3, t: number, fieldLine: number, speed: number}>;
    sparkles: Array<{position: THREE.Vector3, life: number, maxLife: number, size: number}>;
  };
  public materials: {
    metal: THREE.MeshStandardMaterial;
    darkMetal: THREE.MeshStandardMaterial;
    emissive: THREE.MeshStandardMaterial;
    glass: THREE.MeshStandardMaterial;
    lens: THREE.MeshPhysicalMaterial;
    laser: THREE.MeshBasicMaterial;
    plasma: THREE.MeshBasicMaterial;
    lightning: THREE.LineBasicMaterial;
  };

  constructor() {
    super();
    this.name = 'ProceduralLaserTurret';
    
    // Initialize particle data
    this.particleData = {
      orbital: [],
      magnetic: [],
      sparkles: []
    };

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
        color: 0xffffff, // Pure white for less tint
        metalness: 0.0,
        roughness: 0.0,
        transmission: 0.95, // More transmission
        thickness: 0.1, // Much thinner
        transparent: true,
        opacity: 0.2, // Much more transparent
        emissive: 0x4488ff,
        emissiveIntensity: 0.1, // Less glow
        depthWrite: false, // Don't write to depth buffer
        side: THREE.DoubleSide, // Render both sides
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
      plasma: new THREE.MeshBasicMaterial({
        color: 0x00ff88,
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        emissive: 0x00ff88,
        emissiveIntensity: 2,
      }),
      lightning: new THREE.LineBasicMaterial({
        color: 0x00ffff, // Brighter cyan
        transparent: true,
        opacity: 1.0, // Full opacity
        blending: THREE.AdditiveBlending,
        linewidth: 3, // Thicker lines
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
    this.energyEffects = this.createEnergyEffects();

    // Assemble hierarchy
    this.add(this.base);
    this.base.add(this.yawGroup);
    this.yawGroup.add(this.pitchGroup);
    this.pitchGroup.add(this.emitter);
    this.pitchGroup.add(this.laserPreview);

    // Add the ball housing to yaw group
    const housing = this.createBallHousing();
    this.yawGroup.add(housing);
    
    // Add energy effects to the housing so they don't rotate with the turret
    housing.add(this.energyEffects);
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

    // Create concave cradle for the sphere using a lathe geometry
    const cradlePoints = [];
    const cradleSegments = 20;
    for (let i = 0; i <= cradleSegments; i++) {
      const t = i / cradleSegments;
      const angle = t * Math.PI * 0.5; // Quarter circle
      const x = Math.sin(angle) * 1.4; // Radius slightly smaller than sphere
      const y = (1 - Math.cos(angle)) * 0.8 + baseHeight; // Height curve
      cradlePoints.push(new THREE.Vector2(x, y));
    }
    
    const cradleGeometry = new THREE.LatheGeometry(cradlePoints, 32);
    const cradle = new THREE.Mesh(cradleGeometry, this.materials.metal);
    base.add(cradle);

    // Add outer ring for the cradle
    const outerRingGeometry = new THREE.TorusGeometry(1.4, 0.1, 8, 32);
    const outerRing = new THREE.Mesh(outerRingGeometry, this.materials.darkMetal);
    outerRing.rotation.x = Math.PI / 2;
    outerRing.position.y = baseHeight + 0.8;
    base.add(outerRing);

    // Add detail rings on the base
    for (let i = 0; i < 3; i++) {
      const ringRadius = baseRadius * (0.95 - i * 0.1);
      const ringGeometry = new THREE.TorusGeometry(ringRadius, 0.05, 8, 32);
      const ring = new THREE.Mesh(ringGeometry, this.materials.darkMetal);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = baseHeight * 0.3 + i * 0.2;
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

    // Position yaw rotation point higher to give the sphere more clearance
    this.yawGroup.position.y = baseHeight + 1.8;

    return base;
  }

  private createBallHousing(): THREE.Group {
    const housing = new THREE.Group();
    housing.name = 'ballHousing';

    // Main ball housing - transparent sphere
    const ballRadius = 1.5;
    const ballGeometry = new THREE.SphereGeometry(ballRadius, 32, 32);
    const ballMesh = new THREE.Mesh(ballGeometry, this.materials.glass);
    ballMesh.renderOrder = 1; // Render after the energy effects
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
      ring.renderOrder = 1; // Same as glass
      housing.add(ring);
    }

    // Vertical supports
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      const supportGeometry = new THREE.TorusGeometry(ballRadius, 0.05, 8, 32);
      const support = new THREE.Mesh(supportGeometry, this.materials.darkMetal);
      support.rotation.y = angle;
      support.renderOrder = 1; // Same as glass
      housing.add(support);
    }

    // Mounting ring at base
    const mountRingGeometry = new THREE.TorusGeometry(ballRadius * 0.7, 0.1, 8, 32);
    const mountRing = new THREE.Mesh(mountRingGeometry, this.materials.metal);
    mountRing.rotation.x = Math.PI / 2;
    mountRing.position.y = -ballRadius * 0.8;
    mountRing.renderOrder = 1; // Same as glass
    housing.add(mountRing);

    return housing;
  }

  private createEmitter(): THREE.Group {
    const emitter = new THREE.Group();
    emitter.name = 'emitter';

    // Ball sphere radius is 1.5, so we need to position the lens assembly to sit flush
    const sphereRadius = 1.5;

    // Main focusing lens assembly
    const lensAssembly = new THREE.Group();
    // Position so the base of the cone sits on the sphere surface
    lensAssembly.position.x = sphereRadius - 0.1; // Slightly embedded for better visual connection

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
    this.laserBeam.position.x = beamLength / 2 + 2.4; // Start from lens position (sphere radius 1.5 + lens offset)
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
    glow.position.x = beamLength / 2 + 2.4;
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
    this.laserTarget.position.x = beamLength + 2.4;
    laserGroup.add(this.laserTarget);

    // Add inner reticle
    const innerReticleGeometry = new THREE.RingGeometry(0.1, 0.15, 32);
    const innerReticle = new THREE.Mesh(innerReticleGeometry, reticleMaterial);
    innerReticle.position.x = beamLength + 2.4;
    laserGroup.add(innerReticle);

    // Initially visible
    laserGroup.visible = true;

    return laserGroup;
  }

  private createEnergyEffects(): THREE.Group {
    const effectsGroup = new THREE.Group();
    effectsGroup.name = 'energyEffects';

    // Create plasma field around the core
    this.createPlasmaField(effectsGroup);

    // Create lightning bolt geometry (we'll animate these later)
    this.createLightningBolts(effectsGroup);
    
    // Create particle systems
    this.createParticleSystems(effectsGroup);

    return effectsGroup;
  }

  private createPlasmaField(parent: THREE.Group): void {
    // Create a semi-transparent sphere with animated plasma texture
    const plasmaGeometry = new THREE.SphereGeometry(0.8, 32, 32);

    // Create custom shader material for plasma effect
    const plasmaShaderMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        color1: { value: new THREE.Color(0x00ff88) },
        color2: { value: new THREE.Color(0x00bbff) },
        opacity: { value: 0.4 },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormal;
        uniform float time;
        
        // 3D Perlin noise function
        vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
        vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
        
        float snoise(vec3 v) {
          const vec2 C = vec2(1.0/6.0, 1.0/3.0);
          const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
          vec3 i = floor(v + dot(v, C.yyy));
          vec3 x0 = v - i + dot(i, C.xxx);
          vec3 g = step(x0.yzx, x0.xyz);
          vec3 l = 1.0 - g;
          vec3 i1 = min(g.xyz, l.zxy);
          vec3 i2 = max(g.xyz, l.zxy);
          vec3 x1 = x0 - i1 + C.xxx;
          vec3 x2 = x0 - i2 + C.yyy;
          vec3 x3 = x0 - D.yyy;
          i = mod289(i);
          vec4 p = permute(permute(permute(
                    i.z + vec4(0.0, i1.z, i2.z, 1.0))
                    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
                    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
          float n_ = 0.142857142857;
          vec3 ns = n_ * D.wyz - D.xzx;
          vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
          vec4 x_ = floor(j * ns.z);
          vec4 y_ = floor(j - 7.0 * x_);
          vec4 x = x_ *ns.x + ns.yyyy;
          vec4 y = y_ *ns.x + ns.yyyy;
          vec4 h = 1.0 - abs(x) - abs(y);
          vec4 b0 = vec4(x.xy, y.xy);
          vec4 b1 = vec4(x.zw, y.zw);
          vec4 s0 = floor(b0)*2.0 + 1.0;
          vec4 s1 = floor(b1)*2.0 + 1.0;
          vec4 sh = -step(h, vec4(0.0));
          vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
          vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
          vec3 p0 = vec3(a0.xy,h.x);
          vec3 p1 = vec3(a0.zw,h.y);
          vec3 p2 = vec3(a1.xy,h.z);
          vec3 p3 = vec3(a1.zw,h.w);
          vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
          p0 *= norm.x;
          p1 *= norm.y;
          p2 *= norm.z;
          p3 *= norm.w;
          vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
          m = m * m;
          return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
        }
        
        void main() {
          vUv = uv;
          vNormal = normalize(normalMatrix * normal);
          
          // Pulsing scale effect
          float pulse = sin(time * 1.5) * 0.05 + 0.95;
          
          // Use 3D noise for organic deformation
          vec3 noisePos = position * 2.0 + time * 0.2;
          float noiseValue = snoise(noisePos) * 0.15;
          
          // Add layered noise for more complexity
          noiseValue += snoise(noisePos * 3.0 + time * 0.5) * 0.05;
          
          // Apply deformation
          vec3 pos = position * pulse;
          pos += normal * noiseValue;
          
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform vec3 color1;
        uniform vec3 color2;
        uniform float opacity;
        varying vec2 vUv;
        varying vec3 vNormal;
        
        void main() {
          // Create plasma-like pattern
          float pattern = sin(vUv.x * 20.0 + time * 2.0) * 
                         sin(vUv.y * 20.0 + time * 1.5) * 
                         sin((vUv.x + vUv.y) * 10.0 + time);
          
          // Mix colors based on pattern
          vec3 color = mix(color1, color2, (pattern + 1.0) * 0.5);
          
          // Add rim lighting effect
          float rim = 1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0)));
          rim = pow(rim, 2.0);
          
          // Pulsing opacity
          float pulse = sin(time * 3.0) * 0.2 + 0.8;
          
          gl_FragColor = vec4(color, opacity * pulse * rim);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.plasmaField = new THREE.Mesh(plasmaGeometry, plasmaShaderMaterial);
    this.plasmaField.renderOrder = -1; // Render before the glass
    parent.add(this.plasmaField);
  }

  private createLightningBolts(parent: THREE.Group): void {
    // Create several lightning bolts that will arc from core to sensors
    const numBolts = 3; // Just a few bolts for subtle effect

    for (let i = 0; i < numBolts; i++) {
      const points = [];
      const segments = 30; // More segments for more detailed lightning

      // Create a segmented line for the lightning bolt
      for (let j = 0; j <= segments; j++) {
        points.push(new THREE.Vector3(0, 0, 0));
      }

      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const bolt = new THREE.Line(geometry, this.materials.lightning);
      bolt.visible = false; // We'll show them during animation
      bolt.renderOrder = -1; // Render before the glass

      this.lightningBolts.push(bolt);
      parent.add(bolt);
    }
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
    const glow = this.laserPreview.children.find(
      child => child !== this.laserBeam && child !== this.laserTarget
    );
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
        targetLocal: `${targetLocal.x.toFixed(1)}, ${targetLocal.y.toFixed(1)}, ${targetLocal.z.toFixed(1)}`,
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

  private createParticleSystems(parent: THREE.Group): void {
    // Create orbital particles
    this.createOrbitalParticles(parent);
    
    // Create magnetic field particles
    this.createMagneticParticles(parent);
    
    // Create sparkle particles
    this.createSparkleParticles(parent);
  }

  private createOrbitalParticles(parent: THREE.Group): void {
    const particleCount = 25;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);
    
    // Initialize orbital particles
    for (let i = 0; i < particleCount; i++) {
      // Random orbital parameters
      const orbitRadius = 0.9 + Math.random() * 0.5;
      const orbitSpeed = 0.3 + Math.random() * 0.7;
      const phase = Math.random() * Math.PI * 2;
      
      this.particleData.orbital.push({
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        radius: orbitRadius,
        speed: orbitSpeed,
        phase: phase
      });
      
      // Initial position
      positions[i * 3] = Math.cos(phase) * orbitRadius;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = Math.sin(phase) * orbitRadius;
      
      // Colors - cyan to green
      const colorMix = Math.random();
      colors[i * 3] = 0;
      colors[i * 3 + 1] = 1;
      colors[i * 3 + 2] = colorMix;
      
      // Sizes
      sizes[i] = 0.02 + Math.random() * 0.03;
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    
    const material = new THREE.PointsMaterial({
      size: 0.05,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.8,
      sizeAttenuation: true
    });
    
    this.orbitalParticles = new THREE.Points(geometry, material);
    this.orbitalParticles.renderOrder = -1;
    parent.add(this.orbitalParticles);
  }

  private createMagneticParticles(parent: THREE.Group): void {
    const particleCount = 80;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);
    
    // Initialize magnetic field particles
    for (let i = 0; i < particleCount; i++) {
      const fieldLine = Math.floor(Math.random() * 8); // 8 different field lines
      const t = Math.random(); // Position along field line
      const speed = 0.5 + Math.random() * 0.5;
      
      this.particleData.magnetic.push({
        position: new THREE.Vector3(),
        t: t,
        fieldLine: fieldLine,
        speed: speed
      });
      
      // Initial positions will be set in update
      positions[i * 3] = 0;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = 0;
      
      // Colors - electric blue
      colors[i * 3] = 0.2;
      colors[i * 3 + 1] = 0.6;
      colors[i * 3 + 2] = 1;
      
      // Sizes
      sizes[i] = 0.015 + Math.random() * 0.01;
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    
    const material = new THREE.PointsMaterial({
      size: 0.03,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.6,
      sizeAttenuation: true
    });
    
    this.magneticParticles = new THREE.Points(geometry, material);
    this.magneticParticles.renderOrder = -1;
    parent.add(this.magneticParticles);
  }

  private createSparkleParticles(parent: THREE.Group): void {
    const particleCount = 200;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);
    
    // Initialize sparkle particles
    for (let i = 0; i < particleCount; i++) {
      this.particleData.sparkles.push({
        position: new THREE.Vector3(),
        life: 0,
        maxLife: 0.1 + Math.random() * 0.4,
        size: 0.005 + Math.random() * 0.01
      });
      
      // Random positions within sphere
      const r = Math.random() * 1.3;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
      
      // Colors - bright cyan to white
      const whiteness = Math.random() * 0.5;
      colors[i * 3] = whiteness;
      colors[i * 3 + 1] = 1;
      colors[i * 3 + 2] = 1;
      
      // Sizes
      sizes[i] = this.particleData.sparkles[i].size;
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    
    const material = new THREE.PointsMaterial({
      size: 0.02,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 1,
      sizeAttenuation: true
    });
    
    this.sparkleParticles = new THREE.Points(geometry, material);
    this.sparkleParticles.renderOrder = -1;
    parent.add(this.sparkleParticles);
  }

  // Update energy effects animation
  public update(): void {
    const time = this.clock.getElapsedTime();

    // Update plasma field shader
    if (this.plasmaField && this.plasmaField.material instanceof THREE.ShaderMaterial) {
      this.plasmaField.material.uniforms.time.value = time;

      // Rotate plasma field slowly
      this.plasmaField.rotation.x = time * 0.1;
      this.plasmaField.rotation.y = time * 0.15;
    }

    // Animate lightning bolts
    this.animateLightning(time);
    
    // Animate particle systems
    this.animateParticles(time);
  }
  
  private animateParticles(time: number): void {
    const deltaTime = this.clock.getDelta();
    
    // Update orbital particles
    if (this.orbitalParticles) {
      const positions = this.orbitalParticles.geometry.attributes.position as THREE.BufferAttribute;
      
      this.particleData.orbital.forEach((particle, i) => {
        // Update orbital position
        const angle = particle.phase + time * particle.speed;
        const tiltAngle = Math.sin(time * 0.3 + i) * 0.3; // Varying tilt for each orbit
        
        // Calculate position with tilted orbit
        const x = Math.cos(angle) * particle.radius;
        const y = Math.sin(tiltAngle) * particle.radius * 0.5;
        const z = Math.sin(angle) * particle.radius;
        
        positions.setXYZ(i, x, y, z);
        
        // Occasional quantum jump
        if (Math.random() < 0.001) {
          particle.radius = 0.9 + Math.random() * 0.5;
          particle.speed = 0.3 + Math.random() * 0.7;
        }
      });
      
      positions.needsUpdate = true;
    }
    
    // Update magnetic field particles
    if (this.magneticParticles) {
      const positions = this.magneticParticles.geometry.attributes.position as THREE.BufferAttribute;
      
      this.particleData.magnetic.forEach((particle, i) => {
        // Update position along toroidal field line
        particle.t += deltaTime * particle.speed * 0.2;
        if (particle.t > 1) particle.t -= 1;
        
        // Calculate toroidal coordinates
        const majorRadius = 1.0;
        const minorRadius = 0.3;
        const fieldAngle = (particle.fieldLine / 8) * Math.PI * 2;
        
        const u = particle.t * Math.PI * 2;
        const v = fieldAngle + Math.sin(u * 3) * 0.3; // Add some twist
        
        const x = (majorRadius + minorRadius * Math.cos(u)) * Math.cos(v);
        const y = minorRadius * Math.sin(u);
        const z = (majorRadius + minorRadius * Math.cos(u)) * Math.sin(v);
        
        positions.setXYZ(i, x, y, z);
      });
      
      positions.needsUpdate = true;
    }
    
    // Update sparkle particles
    if (this.sparkleParticles) {
      const positions = this.sparkleParticles.geometry.attributes.position as THREE.BufferAttribute;
      const sizes = this.sparkleParticles.geometry.attributes.size as THREE.BufferAttribute;
      
      this.particleData.sparkles.forEach((particle, i) => {
        // Update life
        particle.life += deltaTime;
        
        // Respawn if dead
        if (particle.life > particle.maxLife) {
          particle.life = 0;
          particle.maxLife = 0.1 + Math.random() * 0.4;
          
          // New position weighted toward center
          const r = Math.pow(Math.random(), 2) * 1.3; // Square for center weighting
          const theta = Math.random() * Math.PI * 2;
          const phi = Math.acos(2 * Math.random() - 1);
          
          particle.position.set(
            r * Math.sin(phi) * Math.cos(theta),
            r * Math.sin(phi) * Math.sin(theta),
            r * Math.cos(phi)
          );
          
          positions.setXYZ(i, particle.position.x, particle.position.y, particle.position.z);
        }
        
        // Fade in/out
        const lifeFraction = particle.life / particle.maxLife;
        const fade = Math.sin(lifeFraction * Math.PI);
        sizes.setX(i, particle.size * fade);
      });
      
      positions.needsUpdate = true;
      sizes.needsUpdate = true;
    }
  }

  private animateLightning(time: number): void {
    // Lightning arcs from edge of plasma (0.8 radius) to glass sphere (1.3 radius)
    const plasmaRadius = 0.8; // Edge of plasma field
    const sphereRadius = 1.3; // Slightly inside the glass sphere

    // Animate each lightning bolt
    this.lightningBolts.forEach((bolt, index) => {
      // Show bolt based on random chance - much more subtle
      const showBolt = Math.random() < 0.02; // 2% chance per frame

      if (showBolt) {
        bolt.visible = true;

        // Pick random angles for start and end points
        const startTheta = Math.random() * Math.PI * 2;
        const startPhi = Math.acos(2 * Math.random() - 1);

        // End point slightly offset from start for more natural arcs
        const endTheta = startTheta + (Math.random() - 0.5) * Math.PI * 0.5;
        const endPhi = startPhi + (Math.random() - 0.5) * Math.PI * 0.5;

        // Calculate start point on plasma surface
        const startX = plasmaRadius * Math.sin(startPhi) * Math.cos(startTheta);
        const startY = plasmaRadius * Math.sin(startPhi) * Math.sin(startTheta);
        const startZ = plasmaRadius * Math.cos(startPhi);

        // Calculate end point on sphere surface
        const endX = sphereRadius * Math.sin(endPhi) * Math.cos(endTheta);
        const endY = sphereRadius * Math.sin(endPhi) * Math.sin(endTheta);
        const endZ = sphereRadius * Math.cos(endPhi);

        // Update bolt geometry
        const positions = bolt.geometry.attributes.position as THREE.BufferAttribute;
        const segmentCount = positions.count - 1;

        // Create a curved arc path
        const midX = (startX + endX) / 2;
        const midY = (startY + endY) / 2;
        const midZ = (startZ + endZ) / 2;

        // Add arc height
        const arcHeight = 0.3;
        const perpVector = new THREE.Vector3(endX - startX, endY - startY, endZ - startZ);
        perpVector.cross(new THREE.Vector3(0, 1, 0)).normalize();

        for (let i = 0; i <= segmentCount; i++) {
          const t = i / segmentCount;

          // Create arc using quadratic bezier curve
          const s = 1 - t;
          const x = s * s * startX + 2 * s * t * (midX + perpVector.x * arcHeight) + t * t * endX;
          const y = s * s * startY + 2 * s * t * (midY + perpVector.y * arcHeight) + t * t * endY;
          const z = s * s * startZ + 2 * s * t * (midZ + perpVector.z * arcHeight) + t * t * endZ;

          // Add small random displacement for lightning jaggedness
          const randomOffset = 0.05; // Much smaller for cleaner arcs
          const offsetX = (Math.random() - 0.5) * randomOffset;
          const offsetY = (Math.random() - 0.5) * randomOffset;
          const offsetZ = (Math.random() - 0.5) * randomOffset;

          positions.setXYZ(i, x + offsetX, y + offsetY, z + offsetZ);
        }

        positions.needsUpdate = true;

        // Fade out after a short time
        setTimeout(
          () => {
            bolt.visible = false;
          },
          100 + Math.random() * 100
        );
      }
    });
  }
}
