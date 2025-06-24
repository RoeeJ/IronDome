import * as THREE from 'three';
import * as CANNON from 'cannon-es';

interface DebrisParticle {
  mesh: THREE.Mesh;
  body: CANNON.Body;
  lifetime: number;
  maxLifetime: number;
}

export class DebrisSystem {
  private scene: THREE.Scene;
  private world: CANNON.World;
  private debris: DebrisParticle[] = [];
  private debrisGeometry: THREE.BoxGeometry;
  private debrisMaterials: THREE.MeshStandardMaterial[];

  constructor(scene: THREE.Scene, world: CANNON.World) {
    this.scene = scene;
    this.world = world;

    // Create reusable geometry
    this.debrisGeometry = new THREE.BoxGeometry(0.3, 0.3, 0.3);

    // Create variety of debris materials
    this.debrisMaterials = [
      new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.8 }),
      new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.95 }),
      new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.85 }),
    ];
  }

  createDebris(
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    count: number = 10,
    options: {
      sizeRange?: [number, number];
      velocitySpread?: number;
      lifetimeRange?: [number, number];
      explosive?: boolean;
    } = {}
  ): void {
    const {
      sizeRange = [0.2, 0.5],
      velocitySpread = 10,
      lifetimeRange = [5, 10],
      explosive = false,
    } = options;

    // Check if instanced renderer is available
    const instancedRenderer = (window as any).__instancedDebrisRenderer;
    if (instancedRenderer) {
      // Use instanced renderer for better performance
      instancedRenderer.createDebris(position, velocity, count, {
        speedMultiplier: explosive ? 1.5 : 1,
        lifetimeSeconds: lifetimeRange[1],
        sizeVariation: sizeRange[1] - sizeRange[0],
      });
      return;
    }

    for (let i = 0; i < count; i++) {
      // Random size
      const size = sizeRange[0] + Math.random() * (sizeRange[1] - sizeRange[0]);

      // Create mesh
      const material =
        this.debrisMaterials[Math.floor(Math.random() * this.debrisMaterials.length)];
      const mesh = new THREE.Mesh(this.debrisGeometry, material);
      mesh.scale.setScalar(size);
      mesh.position.copy(position);
      // Optimize: Small debris doesn't need shadows
      mesh.castShadow = size > 0.5; // Only large debris casts shadows
      mesh.receiveShadow = false;

      // Random rotation
      mesh.rotation.set(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2
      );

      // Create physics body
      const shape = new CANNON.Box(new CANNON.Vec3(size / 2, size / 2, size / 2));
      const body = new CANNON.Body({
        mass: size * 2, // Mass proportional to size
        shape,
        position: new CANNON.Vec3(position.x, position.y, position.z),
      });

      // Apply velocity with spread
      const spreadVel = new THREE.Vector3(
        (Math.random() - 0.5) * velocitySpread,
        Math.random() * velocitySpread * 0.5,
        (Math.random() - 0.5) * velocitySpread
      );

      if (explosive) {
        // Explosive pattern - debris flies outward
        const outwardDir = new THREE.Vector3(
          Math.random() - 0.5,
          Math.random() * 0.5,
          Math.random() - 0.5
        ).normalize();
        spreadVel.add(outwardDir.multiplyScalar(velocitySpread * 2));
      }

      const finalVelocity = velocity.clone().add(spreadVel);
      body.velocity.set(finalVelocity.x, finalVelocity.y, finalVelocity.z);

      // Add angular velocity for tumbling effect
      body.angularVelocity.set(
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10
      );

      // Add to scene and physics
      this.scene.add(mesh);
      this.world.addBody(body);

      // Store debris particle
      this.debris.push({
        mesh,
        body,
        lifetime: 0,
        maxLifetime: lifetimeRange[0] + Math.random() * (lifetimeRange[1] - lifetimeRange[0]),
      });
    }
  }

  update(deltaTime: number): void {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const particle = this.debris[i];
      particle.lifetime += deltaTime;

      // Remove old debris
      if (particle.lifetime > particle.maxLifetime) {
        this.removeDebris(i);
        continue;
      }

      // Sync mesh with physics body
      particle.mesh.position.copy(particle.body.position as any);
      particle.mesh.quaternion.copy(particle.body.quaternion as any);

      // Create impact effect when debris hits ground
      if (particle.body.position.y <= 0.2 && particle.body.velocity.y < -2) {
        this.createImpactEffect(particle.body.position as any);
        // Reduce velocity on impact
        particle.body.velocity.y *= -0.3;
        particle.body.velocity.x *= 0.7;
        particle.body.velocity.z *= 0.7;
      }

      // Fade out near end of lifetime
      const fadeStart = particle.maxLifetime * 0.8;
      if (particle.lifetime > fadeStart) {
        const fadeProgress = (particle.lifetime - fadeStart) / (particle.maxLifetime - fadeStart);
        (particle.mesh.material as THREE.MeshStandardMaterial).opacity = 1 - fadeProgress;
        (particle.mesh.material as THREE.MeshStandardMaterial).transparent = true;
      }
    }
  }

  private createImpactEffect(position: CANNON.Vec3): void {
    // Small dust puff when debris hits ground
    const geometry = new THREE.CircleGeometry(0.5, 8);
    const material = new THREE.MeshBasicMaterial({
      color: 0x8b7355,
      opacity: 0.5,
      transparent: true,
    });
    const impact = new THREE.Mesh(geometry, material);
    impact.rotation.x = -Math.PI / 2;
    impact.position.set(position.x, 0.01, position.z);
    this.scene.add(impact);

    // Animate and remove
    const startTime = Date.now();
    const animate = () => {
      const elapsed = (Date.now() - startTime) / 1000;
      if (elapsed > 0.5) {
        this.scene.remove(impact);
        geometry.dispose();
        material.dispose();
        return;
      }

      impact.scale.setScalar(1 + elapsed * 2);
      material.opacity = 0.5 * (1 - elapsed * 2);
      requestAnimationFrame(animate);
    };
    animate();
  }

  private removeDebris(index: number): void {
    const particle = this.debris[index];
    this.scene.remove(particle.mesh);
    this.world.removeBody(particle.body);
    particle.mesh.geometry.dispose();
    this.debris.splice(index, 1);
  }

  createInterceptionDebris(position: THREE.Vector3, threatVelocity: THREE.Vector3): void {
    // Create debris from successful interception
    // Some debris continues in threat direction, some scattered
    this.createDebris(
      position,
      threatVelocity.clone().multiplyScalar(0.3), // 30% of original velocity
      15,
      {
        sizeRange: [0.3, 0.8],
        velocitySpread: 20,
        lifetimeRange: [4, 8],
        explosive: true,
      }
    );
  }

  getDebrisCount(): number {
    return this.debris.length;
  }

  clear(): void {
    while (this.debris.length > 0) {
      this.removeDebris(0);
    }
  }
}
