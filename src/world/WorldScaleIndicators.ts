import * as THREE from 'three';
import { MaterialCache } from '../utils/MaterialCache';
import { GeometryFactory } from '../utils/GeometryFactory';
import { debug } from '../utils/logger';
// CHAINSAW: Removed duplicate BuildingSystem import
import { WorldGeometryOptimizer } from '../rendering/WorldGeometryOptimizer';

export interface ScaleIndicatorConfig {
  showGrid: boolean;
  showDistanceMarkers: boolean;
  showReferenceObjects: boolean;
  showWindParticles: boolean;
  showAltitudeMarkers: boolean;
  gridSize: number;
  gridDivisions: number;
}

export class WorldScaleIndicators {
  private scene: THREE.Scene;
  private indicators: THREE.Group = new THREE.Group();
  private windParticles: THREE.Points | null = null;
  private windParticleVelocities: THREE.Vector3[] = [];
  private config: ScaleIndicatorConfig;
  // CHAINSAW: Removed duplicate buildingSystem - using global one
  private grid: THREE.GridHelper | null = null;
  private time: number = 0;

  // Reference objects
  private buildings: THREE.Group = new THREE.Group();
  private trees: THREE.Group = new THREE.Group();
  private vehicles: THREE.Group = new THREE.Group();

  // Distance markers
  private distanceMarkers: THREE.Group = new THREE.Group();

  // Altitude markers
  private altitudeMarkers: THREE.Group = new THREE.Group();

  constructor(scene: THREE.Scene, config: Partial<ScaleIndicatorConfig> = {}) {
    this.scene = scene;
    this.indicators.name = 'WorldScaleIndicators';

    this.config = {
      showGrid: true,
      showDistanceMarkers: true,
      showReferenceObjects: true,
      showWindParticles: true,
      showAltitudeMarkers: true,
      gridSize: 1000,
      gridDivisions: 50,
      ...config,
    };

    // CHAINSAW: Using global buildingSystem from main.ts - no duplicate creation
  }

  initialize() {
    // CHAINSAW: Removed duplicate grid - main.ts already has terrain with grid

    if (this.config.showDistanceMarkers) {
      this.createDistanceMarkers();
    }

    if (this.config.showReferenceObjects) {
      this.createReferenceObjects();
    }

    if (this.config.showWindParticles) {
      this.createWindParticles();
    }

    if (this.config.showAltitudeMarkers) {
      this.createAltitudeMarkers();
    }

    this.scene.add(this.indicators);
    debug.log('World scale indicators initialized');
  }

  private createEnhancedGrid() {
    const materialCache = MaterialCache.getInstance();

    // Main grid
    this.grid = new THREE.GridHelper(
      this.config.gridSize,
      this.config.gridDivisions,
      0x0038b8,
      0x444444
    );
    this.grid.material.opacity = 0.3;
    this.grid.material.transparent = true;
    this.indicators.add(this.grid);

    // Sub-grid for finer detail
    const subGrid = new THREE.GridHelper(
      this.config.gridSize,
      this.config.gridDivisions * 5,
      0x666666,
      0x666666
    );
    subGrid.material.opacity = 0.1;
    subGrid.material.transparent = true;
    this.indicators.add(subGrid);

    // Coordinate labels at key points
    const labelPositions = [
      { x: 500, z: 0, label: '500m E' },
      { x: -500, z: 0, label: '500m W' },
      { x: 0, z: 500, label: '500m N' },
      { x: 0, z: -500, label: '500m S' },
    ];

    // We'll use 3D text sprites for labels (simplified for now)
    // In a real implementation, you'd use TextGeometry or sprites
  }

  private createDistanceMarkers() {
    const materialCache = MaterialCache.getInstance();
    const geometryFactory = GeometryFactory.getInstance();

    // Create distance rings at 100m intervals
    const distances = [100, 200, 300, 400, 500];

    distances.forEach(distance => {
      // Create ring
      const ringGeometry = new THREE.RingGeometry(distance - 2, distance + 2, 64);
      const ringMaterial = materialCache.getMeshBasicMaterial({
        color: 0x0038b8,
        opacity: 0.2,
        transparent: true,
        side: THREE.DoubleSide,
      });

      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.1;
      this.distanceMarkers.add(ring);

      // Add distance poles at cardinal directions
      const directions = [
        { x: distance, z: 0, angle: 0 },
        { x: 0, z: distance, angle: Math.PI / 2 },
        { x: -distance, z: 0, angle: Math.PI },
        { x: 0, z: -distance, angle: -Math.PI / 2 },
      ];

      directions.forEach(dir => {
        const poleGeometry = geometryFactory.getCylinder(0.5, 0.5, 20, 8);
        const poleMaterial = materialCache.getMeshStandardMaterial({
          color: 0xff0000,
          emissive: 0xff0000,
          emissiveIntensity: 0.2,
        });

        const pole = new THREE.Mesh(poleGeometry, poleMaterial);
        pole.position.set(dir.x, 10, dir.z);
        // Optimize: Disable shadows on markers
        pole.castShadow = false;
        pole.receiveShadow = false;
        this.distanceMarkers.add(pole);

        // Add flashing light on top
        const lightGeometry = geometryFactory.getSphere(1, 8, 6);
        const lightMaterial = materialCache.getMeshBasicMaterial({
          color: 0xff0000,
          transparent: true,
          opacity: 0.8,
        });

        const light = new THREE.Mesh(lightGeometry, lightMaterial);
        light.position.set(dir.x, 21, dir.z);
        light.userData = { baseOpacity: 0.8, phase: Math.random() * Math.PI * 2 };
        // Optimize: Disable shadows on lights
        light.castShadow = false;
        light.receiveShadow = false;
        this.distanceMarkers.add(light);
      });
    });

    this.indicators.add(this.distanceMarkers);
  }

  private createReferenceObjects() {
    const materialCache = MaterialCache.getInstance();
    const geometryFactory = GeometryFactory.getInstance();

    // Create city with better distributed buildings
    const buildingCount = 60; // Reduced count to prevent overlaps with larger spacing

    // Create city clusters with better distribution and spacing
    const cityZones = [
      { x: 0, z: 0, radius: 350, minDistanceFromCenter: 120, density: 0.3 }, // Central city - less dense
      { x: 600, z: 0, radius: 200, minDistanceFromCenter: 0, density: 0.25 }, // East district
      { x: -600, z: 0, radius: 200, minDistanceFromCenter: 0, density: 0.25 }, // West district
      { x: 0, z: 600, radius: 200, minDistanceFromCenter: 0, density: 0.25 }, // North district
      { x: 0, z: -600, radius: 200, minDistanceFromCenter: 0, density: 0.25 }, // South district
      { x: 400, z: 400, radius: 150, minDistanceFromCenter: 0, density: 0.2 }, // NE district
      { x: -400, z: 400, radius: 150, minDistanceFromCenter: 0, density: 0.2 }, // NW district
      { x: 400, z: -400, radius: 150, minDistanceFromCenter: 0, density: 0.2 }, // SE district
      { x: -400, z: -400, radius: 150, minDistanceFromCenter: 0, density: 0.2 }, // SW district
    ];

    // Simple noise function for organic placement
    const noise2D = (x: number, z: number): number => {
      const scale = 0.01;
      return (
        (Math.sin(x * scale) * Math.cos(z * scale) +
          Math.sin(x * scale * 2.1) * Math.cos(z * scale * 1.9) * 0.5 +
          Math.sin(x * scale * 4.3) * Math.cos(z * scale * 3.7) * 0.25) /
        1.75
      );
    };

    let buildingIndex = 0;
    const placedBuildings: THREE.Vector3[] = [];
    const minBuildingDistance = 50; // Increased minimum distance between buildings to prevent overlaps

    cityZones.forEach(zone => {
      const buildingsPerZone = Math.floor(
        (buildingCount * zone.density) / cityZones.reduce((sum, z) => sum + z.density, 0)
      );

      for (let i = 0; i < buildingsPerZone && buildingIndex < buildingCount; i++) {
        let validPosition = false;
        const buildingPos = new THREE.Vector3();
        let attempts = 0;

        while (!validPosition && attempts < 50) { // More attempts for better placement
          // Use noise-based placement for more organic city layout
          const angle = Math.random() * Math.PI * 2;
          const baseDistance =
            zone.minDistanceFromCenter + Math.random() * (zone.radius - zone.minDistanceFromCenter);

          // Apply noise to create clusters and gaps
          const noiseValue = noise2D(zone.x + angle * 100, zone.z + baseDistance);
          const distance = baseDistance * (0.7 + noiseValue * 0.6);

          const x = zone.x + Math.cos(angle) * distance;
          const z = zone.z + Math.sin(angle) * distance;

          // Check constraints
          const distFromOrigin = Math.sqrt(x * x + z * z);
          let tooClose = false;

          // Check distance from other buildings - also consider building size
          const buildingWidth = 12 + Math.random() * 20 + 10; // Estimate building size
          const buildingDepth = 12 + Math.random() * 20 + 10;
          const buildingRadius = Math.max(buildingWidth, buildingDepth) / 2;

          for (const placed of placedBuildings) {
            // Use actual building footprint for distance check
            const minDistance = minBuildingDistance + buildingRadius;
            if (placed.distanceTo(new THREE.Vector3(x, 0, z)) < minDistance) {
              tooClose = true;
              break;
            }
          }

          if (distFromOrigin > 100 && !tooClose && Math.abs(x) < 900 && Math.abs(z) < 900) {
            buildingPos.set(x, 0, z);
            validPosition = true;
          }
          attempts++;
        }

        if (validPosition) {
          // Vary building sizes based on distance from center
          const distFactor = Math.min(buildingPos.length() / 500, 1);
          const width = 12 + Math.random() * 20 + distFactor * 10;
          const height = 20 + Math.random() * 50 + (1 - distFactor) * 30; // Taller buildings in center
          const depth = 12 + Math.random() * 20 + distFactor * 10;

          // CHAINSAW: Buildings created by main.ts BuildingSystem - skip duplicate creation
          placedBuildings.push(buildingPos.clone());
          buildingIndex++;
        }
      }
    });
    
    // CHAINSAW: No geometry merging - keeping individual buildings for collision detection
    debug.log('Buildings created - no merging needed for optimized system');

    // Skip trees and vehicles - focusing only on buildings

    this.indicators.add(this.buildings);
    // Trees and vehicles removed to eliminate cylinder/tube shapes
  }
  
  /**
   * Optimize all static geometry after creation
   */
  optimizeGeometry(): void {
    debug.log('Optimizing world geometry...');
    
    // Optimize distance markers (poles and rings)
    if (this.distanceMarkers.children.length > 0) {
      const optimizedMarkers = WorldGeometryOptimizer.optimizeStaticGeometry(
        this.distanceMarkers,
        {
          mergeByMaterial: true,
          castShadows: false
        }
      );
      
      // Replace with optimized version
      this.indicators.remove(this.distanceMarkers);
      this.distanceMarkers = optimizedMarkers;
      this.indicators.add(this.distanceMarkers);
      
      debug.log(`Optimized distance markers: ${this.distanceMarkers.children.length} draw calls`);
    }
    
    // Report optimization stats
    const stats = WorldGeometryOptimizer.analyzeScene(this.scene);
    debug.log('Scene optimization analysis:', stats);
  }

  private createSimpleTree(): THREE.Group {
    const materialCache = MaterialCache.getInstance();
    const geometryFactory = GeometryFactory.getInstance();

    const tree = new THREE.Group();

    // Trunk
    const trunkGeometry = geometryFactory.getCylinder(1, 1.5, 8, 6);
    const trunkMaterial = materialCache.getMeshStandardMaterial({
      color: 0x4a3929,
      roughness: 1,
    });
    const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
    trunk.position.y = 4;
    trunk.castShadow = true;
    tree.add(trunk);

    // Canopy
    const canopyGeometry = geometryFactory.getSphere(6, 8, 6);
    const canopyMaterial = materialCache.getMeshStandardMaterial({
      color: 0x2d5016,
      roughness: 1,
    });
    const canopy = new THREE.Mesh(canopyGeometry, canopyMaterial);
    canopy.position.y = 10;
    canopy.scale.y = 1.2;
    canopy.castShadow = true;
    tree.add(canopy);

    return tree;
  }

  private createSimpleVehicle(): THREE.Group {
    const materialCache = MaterialCache.getInstance();
    const geometryFactory = GeometryFactory.getInstance();

    const vehicle = new THREE.Group();

    // Body
    const bodyGeometry = geometryFactory.getBox(4, 2, 8);
    const bodyMaterial = materialCache.getMeshStandardMaterial({
      color: new THREE.Color().setHSL(Math.random(), 0.5, 0.5),
      roughness: 0.3,
      metalness: 0.7,
    });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 1.5;
    body.castShadow = true;
    vehicle.add(body);

    // Roof
    const roofGeometry = geometryFactory.getBox(3.5, 1.5, 5);
    const roof = new THREE.Mesh(roofGeometry, bodyMaterial);
    roof.position.y = 3;
    vehicle.add(roof);

    // Wheels
    const wheelGeometry = geometryFactory.getCylinder(0.8, 0.8, 0.5, 12);
    const wheelMaterial = materialCache.getMeshStandardMaterial({
      color: 0x222222,
      roughness: 0.8,
    });

    const wheelPositions = [
      { x: 2, z: 3 },
      { x: -2, z: 3 },
      { x: 2, z: -3 },
      { x: -2, z: -3 },
    ];

    wheelPositions.forEach(pos => {
      const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(pos.x, 0.8, pos.z);
      vehicle.add(wheel);
    });

    return vehicle;
  }

  private createWindParticles() {
    // More particles to cover the larger terrain area
    const particleCount = 1000;
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);

    // Initialize particles
    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;

      // Spread particles across the entire terrain (2000x2000)
      // But stagger their initial positions to avoid wall effect
      const staggerOffset = (i / particleCount) * 500; // Spread initial positions along wind direction
      positions[i3] = (Math.random() - 0.5) * 2000 + staggerOffset;
      positions[i3 + 1] = Math.random() * 200;
      positions[i3 + 2] = (Math.random() - 0.5) * 2000;

      // White to light blue particles
      colors[i3] = 0.9 + Math.random() * 0.1;
      colors[i3 + 1] = 0.9 + Math.random() * 0.1;
      colors[i3 + 2] = 1;

      sizes[i] = Math.random() * 2 + 1;

      // Store velocity for each particle - more random variation for natural movement
      // Each particle gets different speed and slight direction variation
      const speedVariation = 0.5 + Math.random() * 1.0; // 50% to 150% of base speed
      const angleVariation = (Math.random() - 0.5) * 0.3; // ±15 degrees variation
      
      this.windParticleVelocities.push(
        new THREE.Vector3(
          (Math.random() - 0.5) * 2.0,  // More random drift
          (Math.random() - 0.5) * 0.5,  // Some vertical movement
          (Math.random() - 0.5) * 2.0   // More random drift
        ).multiplyScalar(speedVariation)
      );
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const material = MaterialCache.getInstance().getPointsMaterial({
      size: 2,
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.windParticles = new THREE.Points(geometry, material);
    this.indicators.add(this.windParticles);
  }

  private createAltitudeMarkers() {
    const materialCache = MaterialCache.getInstance();

    // Create horizontal planes at different altitudes
    const altitudes = [50, 100, 150, 200];

    altitudes.forEach(altitude => {
      // Create a ring at this altitude
      const ringGeometry = new THREE.RingGeometry(400, 410, 64);
      const ringMaterial = materialCache.getMeshBasicMaterial({
        color: 0x00ff00,
        opacity: 0.1,
        transparent: true,
        side: THREE.DoubleSide,
      });

      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = altitude;
      this.altitudeMarkers.add(ring);

      // Add altitude indicators
      const indicatorCount = 8;
      for (let i = 0; i < indicatorCount; i++) {
        const angle = (i / indicatorCount) * Math.PI * 2;
        const x = Math.cos(angle) * 405;
        const z = Math.sin(angle) * 405;

        // Create small pyramid as indicator
        const indicatorGeometry = new THREE.ConeGeometry(3, 6, 4);
        const indicatorMaterial = materialCache.getMeshBasicMaterial({
          color: 0x00ff00,
          transparent: true,
          opacity: 0.5,
        });

        const indicator = new THREE.Mesh(indicatorGeometry, indicatorMaterial);
        indicator.position.set(x, altitude, z);
        indicator.userData = { altitude, phase: Math.random() * Math.PI * 2 };
        this.altitudeMarkers.add(indicator);
      }
    });

    this.indicators.add(this.altitudeMarkers);
  }

  update(deltaTime: number, windVector?: THREE.Vector3) {
    // Clamp deltaTime to prevent large jumps when tab regains focus
    const clampedDeltaTime = Math.min(deltaTime, 0.1); // Max 100ms per frame
    this.time += clampedDeltaTime;
    // Update wind particles
    if (this.windParticles && this.config.showWindParticles) {
      const positions = this.windParticles.geometry.attributes.position.array as Float32Array;

      for (let i = 0; i < this.windParticleVelocities.length; i++) {
        const i3 = i * 3;
        const velocity = this.windParticleVelocities[i];

        // Apply wind if provided - blend wind with particle's own movement
        if (windVector) {
          // Blend global wind with particle's individual movement for more natural flow
          // Each particle responds differently to wind based on its "weight"
          const particleWeight = 0.3 + (i % 7) * 0.1; // Different particles have different wind response
          
          positions[i3] += (windVector.x * particleWeight + velocity.x) * clampedDeltaTime * 10;
          positions[i3 + 1] += (windVector.y * 0.1 * particleWeight + velocity.y) * clampedDeltaTime * 10;
          positions[i3 + 2] += (windVector.z * particleWeight + velocity.z) * clampedDeltaTime * 10;
          
          // Add some swirling motion based on position
          const swirl = Math.sin(positions[i3] * 0.01 + this.time * 0.5) * 0.2;
          positions[i3 + 2] += swirl * clampedDeltaTime * 10;
        } else {
          // Without wind, particles just drift with their random velocities
          positions[i3] += velocity.x * clampedDeltaTime * 10;
          positions[i3 + 1] += velocity.y * clampedDeltaTime * 10;
          positions[i3 + 2] += velocity.z * clampedDeltaTime * 10;
        }

        // Wrap around entire terrain area
        if (positions[i3] > 1000) positions[i3] = -1000;
        if (positions[i3] < -1000) positions[i3] = 1000;
        if (positions[i3 + 1] > 200) positions[i3 + 1] = 0;
        if (positions[i3 + 1] < 0) positions[i3 + 1] = 200;
        if (positions[i3 + 2] > 1000) positions[i3 + 2] = -1000;
        if (positions[i3 + 2] < -1000) positions[i3 + 2] = 1000;
      }

      this.windParticles.geometry.attributes.position.needsUpdate = true;
    }

    // Animate flashing lights
    const time = Date.now() * 0.001;
    this.distanceMarkers.traverse(child => {
      if (child.userData.phase !== undefined) {
        const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
        material.opacity =
          child.userData.baseOpacity * (0.5 + 0.5 * Math.sin(time * 2 + child.userData.phase));
      }
    });

    // Animate altitude indicators
    this.altitudeMarkers.traverse(child => {
      if (child.userData.altitude !== undefined) {
        child.position.y = child.userData.altitude + Math.sin(time + child.userData.phase) * 2;
      }
    });
  }

  setVisibility(indicators: Partial<ScaleIndicatorConfig>) {
    Object.assign(this.config, indicators);

    if (this.distanceMarkers) {
      this.distanceMarkers.visible =
        indicators.showDistanceMarkers ?? this.config.showDistanceMarkers;
    }

    if (this.buildings) {
      this.buildings.visible = indicators.showReferenceObjects ?? this.config.showReferenceObjects;
      this.trees.visible = indicators.showReferenceObjects ?? this.config.showReferenceObjects;
      this.vehicles.visible = indicators.showReferenceObjects ?? this.config.showReferenceObjects;
    }

    if (this.windParticles) {
      this.windParticles.visible = indicators.showWindParticles ?? this.config.showWindParticles;
    }

    if (this.altitudeMarkers) {
      this.altitudeMarkers.visible =
        indicators.showAltitudeMarkers ?? this.config.showAltitudeMarkers;
    }
  }

  dispose() {
    this.indicators.traverse(child => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        // Don't dispose materials from MaterialCache
      }
    });

    if (this.windParticles) {
      this.windParticles.geometry.dispose();
      (this.windParticles.material as THREE.Material).dispose();
    }

    this.scene.remove(this.indicators);
  }
  
  /**
   * Update visibility of different indicator types dynamically
   */
  updateVisibility(config: Partial<ScaleIndicatorConfig>): void {
    // Update internal config
    Object.assign(this.config, config);
    
    // Toggle grid visibility
    if (this.grid) {
      this.grid.visible = config.showGrid !== undefined ? config.showGrid : this.config.showGrid;
    }
    
    // Toggle distance markers
    if (this.distanceMarkers) {
      this.distanceMarkers.visible = config.showDistanceMarkers !== undefined ? 
        config.showDistanceMarkers : this.config.showDistanceMarkers;
    }
    
    // Toggle reference objects (buildings)
    if (this.buildings) {
      this.buildings.visible = config.showReferenceObjects !== undefined ? 
        config.showReferenceObjects : this.config.showReferenceObjects;
    }
    
    // Toggle wind particles
    if (this.windParticles) {
      this.windParticles.visible = config.showWindParticles !== undefined ? 
        config.showWindParticles : this.config.showWindParticles;
    }
    
    // Toggle altitude markers
    if (this.altitudeMarkers) {
      this.altitudeMarkers.visible = config.showAltitudeMarkers !== undefined ? 
        config.showAltitudeMarkers : this.config.showAltitudeMarkers;
    }
  }
  
  // Update building window lighting based on time of day
  updateTimeOfDay(hours: number) {
    // CHAINSAW: Using global buildingSystem from main.ts
    const buildingSystem = (window as any).__buildingSystem;
    if (buildingSystem) {
      buildingSystem.updateTimeOfDay(hours);
    }
  }
}
