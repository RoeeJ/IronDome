import * as THREE from 'three';
import { GeometryFactory } from '../utils/GeometryFactory';

export interface LODLevel {
  distance: number;
  geometry: THREE.BufferGeometry;
  material?: THREE.Material;
}

export interface LODConfig {
  levels: LODLevel[];
  updateInterval?: number; // How often to update LOD in ms
}

export class LODSystem {
  private camera: THREE.Camera;
  private lodConfigs: Map<string, LODConfig> = new Map();
  private lastUpdateTime: number = 0;
  private updateInterval: number = 100; // Default 100ms update interval

  constructor(camera: THREE.Camera) {
    this.camera = camera;
  }

  /**
   * Register LOD configuration for a specific object type
   */
  registerLODConfig(type: string, config: LODConfig) {
    this.lodConfigs.set(type, config);
    if (config.updateInterval) {
      this.updateInterval = Math.min(this.updateInterval, config.updateInterval);
    }
  }

  /**
   * Get the appropriate LOD level based on distance from camera
   */
  getLODLevel(type: string, worldPosition: THREE.Vector3): number {
    const config = this.lodConfigs.get(type);
    if (!config) return 0;

    const distance = this.camera.position.distanceTo(worldPosition);

    // Find appropriate LOD level
    for (let i = config.levels.length - 1; i >= 0; i--) {
      if (distance >= config.levels[i].distance) {
        return i;
      }
    }

    return 0; // Highest detail
  }

  /**
   * Get LOD geometry and material for a specific type and distance
   */
  getLODAssets(
    type: string,
    worldPosition: THREE.Vector3
  ): { geometry: THREE.BufferGeometry; material?: THREE.Material } | null {
    const config = this.lodConfigs.get(type);
    if (!config) return null;

    const lodLevel = this.getLODLevel(type, worldPosition);
    return config.levels[lodLevel];
  }

  /**
   * Check if LOD update is needed based on update interval
   */
  shouldUpdate(currentTime: number): boolean {
    if (currentTime - this.lastUpdateTime >= this.updateInterval) {
      this.lastUpdateTime = currentTime;
      return true;
    }
    return false;
  }

  /**
   * Create simplified geometries for threats
   */
  static createThreatLODs(): { [key: string]: LODConfig } {
    const factory = GeometryFactory.getInstance();

    // High detail geometries (LOD 0)
    const rocketGeometryHigh = factory.getCone(0.3, 3, 6).clone();
    rocketGeometryHigh.rotateX(Math.PI / 2);

    const mortarGeometryHigh = factory.getSphere(0.4, 8, 6);

    const droneGeometryHigh = factory.getBox(1.5, 0.3, 1.5);

    const ballisticGeometryHigh = factory.getCone(0.5, 4, 8).clone();
    ballisticGeometryHigh.rotateX(Math.PI / 2);

    // Medium detail geometries (LOD 1)
    const rocketGeometryMed = factory.getCone(0.3, 3, 4).clone();
    rocketGeometryMed.rotateX(Math.PI / 2);

    const mortarGeometryMed = factory.getSphere(0.4, 6, 4);

    const droneGeometryMed = factory.getBox(1.5, 0.3, 1.5, 1, 1, 1);

    const ballisticGeometryMed = factory.getCone(0.5, 4, 5).clone();
    ballisticGeometryMed.rotateX(Math.PI / 2);

    // Low detail geometries (LOD 2)
    const rocketGeometryLow = factory.getCone(0.3, 3, 3).clone();
    rocketGeometryLow.rotateX(Math.PI / 2);

    const mortarGeometryLow = factory.getSphere(0.4, 4, 3);

    const droneGeometryLow = factory.getBox(1.5, 0.3, 1.5, 1, 1, 1);

    const ballisticGeometryLow = factory.getCone(0.5, 4, 3).clone();
    ballisticGeometryLow.rotateX(Math.PI / 2);

    return {
      rocket: {
        levels: [
          { distance: 0, geometry: rocketGeometryHigh },
          { distance: 150, geometry: rocketGeometryMed },
          { distance: 300, geometry: rocketGeometryLow },
        ],
      },
      mortar: {
        levels: [
          { distance: 0, geometry: mortarGeometryHigh },
          { distance: 150, geometry: mortarGeometryMed },
          { distance: 300, geometry: mortarGeometryLow },
        ],
      },
      drone: {
        levels: [
          { distance: 0, geometry: droneGeometryHigh },
          { distance: 150, geometry: droneGeometryMed },
          { distance: 300, geometry: droneGeometryLow },
        ],
      },
      ballistic: {
        levels: [
          { distance: 0, geometry: ballisticGeometryHigh },
          { distance: 150, geometry: ballisticGeometryMed },
          { distance: 300, geometry: ballisticGeometryLow },
        ],
      },
    };
  }

  /**
   * Create simplified geometries for batteries
   */
  static createBatteryLODs(): LODConfig {
    // For batteries, we'll create progressively simpler versions
    // Note: This is a placeholder - actual implementation would need the real battery geometries
    const factory = GeometryFactory.getInstance();

    return {
      levels: [
        { distance: 0, geometry: factory.getBox(10, 5, 10) }, // Full detail
        { distance: 200, geometry: factory.getBox(10, 5, 10, 2, 2, 2) }, // Medium
        { distance: 400, geometry: factory.getBox(10, 5, 10, 1, 1, 1) }, // Low
      ],
      updateInterval: 150, // Batteries update less frequently
    };
  }
}
