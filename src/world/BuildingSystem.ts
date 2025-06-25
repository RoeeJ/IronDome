import * as THREE from 'three';
import { MaterialCache } from '../utils/MaterialCache';
import { GeometryFactory } from '../utils/GeometryFactory';
import { ExplosionManager, ExplosionType } from '../systems/ExplosionManager';
import { debug } from '../utils/logger';

export interface Building {
  id: string;
  mesh: THREE.Mesh;
  position: THREE.Vector3;
  health: number;
  maxHealth: number;
  isDestroyed: boolean;
  floors: number;
  windows: THREE.Mesh[];
  debrisCreated: boolean;
}

export class BuildingSystem {
  private scene: THREE.Scene;
  private buildings: Map<string, Building> = new Map();
  private buildingGroup: THREE.Group = new THREE.Group();
  private debrisGroup: THREE.Group = new THREE.Group();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.buildingGroup.name = 'Buildings';
    this.debrisGroup.name = 'BuildingDebris';
    this.scene.add(this.buildingGroup);
    this.scene.add(this.debrisGroup);
  }

  createBuilding(position: THREE.Vector3, width: number, height: number, depth: number): string {
    const materialCache = MaterialCache.getInstance();
    const geometryFactory = GeometryFactory.getInstance();

    const id = `building_${Date.now()}_${Math.random()}`;
    const floors = Math.floor(height / 4); // Assume 4m per floor

    // Create building mesh
    const geometry = geometryFactory.getBox(width, height, depth);
    const material = materialCache.getMeshStandardMaterial({
      color: new THREE.Color().setHSL(0, 0, 0.3 + Math.random() * 0.2),
      roughness: 0.9,
      metalness: 0.1,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    mesh.position.y = height / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.buildingId = id;

    // Add windows
    const windows: THREE.Mesh[] = [];
    const windowRows = Math.floor(height / 5);
    const windowCols = Math.floor(width / 4);

    for (let row = 0; row < windowRows; row++) {
      for (let col = 0; col < windowCols; col++) {
        if (Math.random() > 0.3) {
          // Some windows are "off"
          const windowGeometry = geometryFactory.getPlane(2, 3);
          const windowMaterial = materialCache.getMeshBasicMaterial({
            color: 0xffff88,
            transparent: true,
            opacity: 0.8,
          });

          const window = new THREE.Mesh(windowGeometry, windowMaterial);
          window.position.set(
            (col - windowCols / 2) * 4 + 2,
            (row - windowRows / 2) * 5 + 2.5 - height / 2,
            depth / 2 + 0.1
          );
          mesh.add(window);
          windows.push(window);
        }
      }
    }

    const building: Building = {
      id,
      mesh,
      position: position.clone(),
      health: 100,
      maxHealth: 100,
      isDestroyed: false,
      floors,
      windows,
      debrisCreated: false,
    };

    this.buildings.set(id, building);
    this.buildingGroup.add(mesh);

    return id;
  }

  damageBuilding(buildingId: string, damage: number): void {
    const building = this.buildings.get(buildingId);
    if (!building || building.isDestroyed) return;

    building.health = Math.max(0, building.health - damage);

    // Update appearance based on damage
    const damageRatio = 1 - building.health / building.maxHealth;

    // Darken building as it takes damage
    const material = building.mesh.material as THREE.MeshStandardMaterial;
    material.color.setHSL(0, 0, 0.3 * (1 - damageRatio * 0.7));

    // Break windows progressively
    const windowsToBreak = Math.floor(building.windows.length * damageRatio);
    for (let i = 0; i < windowsToBreak; i++) {
      const window = building.windows[i];
      if (window.visible) {
        window.visible = false;

        // Create glass shatter effect
        this.createGlassDebris(building.mesh.position.clone().add(window.position), 5);
      }
    }

    // Check if building should collapse
    if (building.health <= 0) {
      this.destroyBuilding(buildingId);
    } else if (building.health < 30 && Math.random() < 0.3) {
      // Chance of partial collapse at low health
      this.createPartialCollapse(building);
    }

    debug.log(
      `Building ${buildingId} damaged: ${damage} (Health: ${building.health}/${building.maxHealth})`
    );
  }

  private destroyBuilding(buildingId: string): void {
    const building = this.buildings.get(buildingId);
    if (!building || building.isDestroyed) return;

    building.isDestroyed = true;

    // Create collapse animation
    const startY = building.mesh.position.y;
    const collapseTime = 2000; // 2 seconds
    const startTime = Date.now();

    const animateCollapse = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / collapseTime, 1);

      // Sink into ground with some rotation
      building.mesh.position.y = startY * (1 - progress);
      building.mesh.rotation.x = (Math.random() - 0.5) * 0.2 * progress;
      building.mesh.rotation.z = (Math.random() - 0.5) * 0.2 * progress;

      // Scale down slightly
      const scale = 1 - progress * 0.2;
      building.mesh.scale.set(scale, scale, scale);

      if (progress < 1) {
        requestAnimationFrame(animateCollapse);
      } else {
        // Create rubble and remove building
        this.createRubble(building);
        this.buildingGroup.remove(building.mesh);
        this.buildings.delete(buildingId);
      }
    };

    animateCollapse();

    // Create dust cloud
    const explosionManager = ExplosionManager.getInstance(this.scene);
    explosionManager.createExplosion({
      type: ExplosionType.GROUND_IMPACT,
      position: building.position.clone(),
      radius: 20,
    });

    // Create debris
    if (!building.debrisCreated) {
      building.debrisCreated = true;
      this.createBuildingDebris(building);
    }
  }

  private createPartialCollapse(building: Building): void {
    // Add some tilt to the building
    building.mesh.rotation.x += (Math.random() - 0.5) * 0.05;
    building.mesh.rotation.z += (Math.random() - 0.5) * 0.05;

    // Create some falling debris
    this.createFallingDebris(building.position, 3);
  }

  private createBuildingDebris(building: Building): void {
    const debrisSystem = (window as any).__debrisSystem;
    if (!debrisSystem) return;

    // Create multiple debris pieces
    const debrisCount = 10 + Math.floor(building.floors * 2);

    for (let i = 0; i < debrisCount; i++) {
      const offset = new THREE.Vector3(
        (Math.random() - 0.5) * 10,
        Math.random() * building.mesh.scale.y * 10,
        (Math.random() - 0.5) * 10
      );

      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 20,
        10 + Math.random() * 20,
        (Math.random() - 0.5) * 20
      );

      debrisSystem.createDebris(building.position.clone().add(offset), velocity, 1, {
        sizeRange: [1, 3],
        velocitySpread: 10,
        lifetimeRange: [5, 10],
        explosive: true,
      });
    }
  }

  private createGlassDebris(position: THREE.Vector3, count: number): void {
    const materialCache = MaterialCache.getInstance();
    const geometryFactory = GeometryFactory.getInstance();

    for (let i = 0; i < count; i++) {
      const size = 0.1 + Math.random() * 0.3;
      const geometry = geometryFactory.getBox(size, size, 0.05);
      const material = materialCache.getMeshBasicMaterial({
        color: 0x88ccff,
        transparent: true,
        opacity: 0.6,
      });

      const shard = new THREE.Mesh(geometry, material);
      shard.position.copy(position);
      shard.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);

      // Animate falling
      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        -2 - Math.random() * 3,
        (Math.random() - 0.5) * 2
      );

      this.debrisGroup.add(shard);

      // Remove after a short time
      setTimeout(() => {
        this.debrisGroup.remove(shard);
      }, 2000);

      // Simple animation
      const animateShard = () => {
        shard.position.add(velocity.clone().multiplyScalar(0.016));
        velocity.y -= 0.3; // Gravity

        if (shard.position.y > 0) {
          requestAnimationFrame(animateShard);
        } else {
          this.debrisGroup.remove(shard);
        }
      };

      animateShard();
    }
  }

  private createFallingDebris(position: THREE.Vector3, count: number): void {
    const materialCache = MaterialCache.getInstance();
    const geometryFactory = GeometryFactory.getInstance();

    for (let i = 0; i < count; i++) {
      const size = 0.5 + Math.random() * 1.5;
      const geometry = geometryFactory.getBox(size, size, size);
      const material = materialCache.getMeshStandardMaterial({
        color: 0x666666,
        roughness: 1,
      });

      const debris = new THREE.Mesh(geometry, material);
      debris.position.copy(position);
      debris.position.y += 10 + Math.random() * 20;
      debris.position.x += (Math.random() - 0.5) * 10;
      debris.position.z += (Math.random() - 0.5) * 10;

      this.debrisGroup.add(debris);

      // Animate falling
      const fallSpeed = 5 + Math.random() * 5;
      const rotateSpeeds = new THREE.Vector3(
        (Math.random() - 0.5) * 5,
        (Math.random() - 0.5) * 5,
        (Math.random() - 0.5) * 5
      );

      const animateDebris = () => {
        debris.position.y -= fallSpeed * 0.016;
        debris.rotation.x += rotateSpeeds.x * 0.016;
        debris.rotation.y += rotateSpeeds.y * 0.016;
        debris.rotation.z += rotateSpeeds.z * 0.016;

        if (debris.position.y > 0) {
          requestAnimationFrame(animateDebris);
        } else {
          // Leave on ground for a while
          setTimeout(() => {
            this.debrisGroup.remove(debris);
          }, 10000);
        }
      };

      animateDebris();
    }
  }

  private createRubble(building: Building): void {
    const materialCache = MaterialCache.getInstance();
    const geometryFactory = GeometryFactory.getInstance();

    // Create low rubble pile
    const rubbleGeometry = geometryFactory.getBox(
      building.mesh.scale.x * 15,
      2,
      building.mesh.scale.z * 15
    );
    const rubbleMaterial = materialCache.getMeshStandardMaterial({
      color: 0x444444,
      roughness: 1,
    });

    const rubble = new THREE.Mesh(rubbleGeometry, rubbleMaterial);
    rubble.position.copy(building.position);
    rubble.position.y = 1;

    this.debrisGroup.add(rubble);

    // Remove rubble after some time
    setTimeout(() => {
      this.debrisGroup.remove(rubble);
    }, 60000); // 1 minute
  }

  checkExplosionDamage(explosionPos: THREE.Vector3, blastRadius: number): void {
    this.buildings.forEach(building => {
      if (building.isDestroyed) return;

      const distance = building.position.distanceTo(explosionPos);
      if (distance <= blastRadius) {
        // Calculate damage based on distance
        const damageFactor = 1 - distance / blastRadius;
        const damage = damageFactor * 50; // Max 50 damage from explosion

        if (damage > 0) {
          this.damageBuilding(building.id, damage);
        }
      }
    });
  }

  getBuildingAt(position: THREE.Vector3, radius: number = 10): Building | null {
    for (const building of this.buildings.values()) {
      if (!building.isDestroyed) {
        const distance = building.position.distanceTo(position);
        if (distance <= radius) {
          return building;
        }
      }
    }
    return null;
  }

  getAllBuildings(): Building[] {
    return Array.from(this.buildings.values());
  }

  dispose(): void {
    this.buildings.forEach(building => {
      this.buildingGroup.remove(building.mesh);
    });
    this.buildings.clear();

    this.debrisGroup.traverse(child => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
      }
    });
    this.debrisGroup.clear();

    this.scene.remove(this.buildingGroup);
    this.scene.remove(this.debrisGroup);
  }
}
