import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Projectile } from './Projectile';
import { Threat, THREAT_CONFIGS } from './Threat';
import { UnifiedTrajectorySystem } from '../systems/UnifiedTrajectorySystem';
import { StaticRadarNetwork } from '../scene/StaticRadarNetwork';
import { InvisibleRadarSystem } from '../scene/InvisibleRadarSystem';
import { LaunchEffectsSystem } from '../systems/LaunchEffectsSystem';
import { GeometryOptimizer } from '../utils/GeometryOptimizer';
import { debug } from '../utils/logger';
import { ResourceManager } from '../game/ResourceManager';
import { MaterialCache } from '../utils/MaterialCache';
import { GeometryFactory } from '../utils/GeometryFactory';
import { EventEmitter } from 'events';
import { ExplosionManager, ExplosionType } from '../systems/ExplosionManager';
import { SoundSystem } from '../systems/SoundSystem';
import { getTubeVectors } from '../../config/IronDome';

export interface BatteryConfig {
  position: THREE.Vector3;
  maxRange: number;
  minRange: number;
  reloadTime: number; // ms per missile
  interceptorSpeed: number; // m/s
  launcherCount: number; // Number of launch tubes
  successRate: number; // 0.0 to 1.0, default 0.9 (90%)
  aggressiveness: number; // 1.0 to 3.0, how many interceptors per high-value threat
  firingDelay: number; // ms between shots when firing multiple interceptors
  interceptorLimit?: number; // Max interceptors allowed (for mobile performance)
  maxHealth?: number; // Maximum health points
  useInstancedRendering?: boolean; // Use instanced rendering (no individual meshes)
}

interface LauncherTube {
  index: number;
  mesh: THREE.Mesh;
  isLoaded: boolean;
  lastFiredTime: number;
  missile?: THREE.Mesh;
  position: THREE.Vector3; // Tube start position (launch point)
  endPosition: THREE.Vector3; // Tube end position (for smoke effects)
  direction: THREE.Vector3; // Launch direction
  xMarker?: THREE.Group; // X marker for empty tubes
}

export class IronDomeBattery extends EventEmitter {
  private scene: THREE.Scene;
  private world: CANNON.World;
  private config: BatteryConfig;
  private group: THREE.Group;
  private launcherGroup: THREE.Group;
  private radarDome: THREE.Mesh;
  private launcherTubes: LauncherTube[] = [];
  private rangeIndicator: THREE.Line;
  private radarNetwork?: StaticRadarNetwork | InvisibleRadarSystem;
  private launchEffects: LaunchEffectsSystem;
  private launchOffset: THREE.Vector3 = new THREE.Vector3(-2, 14.5, -0.1);
  private launchDirection: THREE.Vector3 = new THREE.Vector3(0.6, 1, 0.15).normalize();
  private resourceManager: ResourceManager;
  private useResources: boolean = false;
  private currentHealth: number = 100;
  private maxHealth: number = 100;
  private healthBar?: THREE.Group;
  private isDestroyed: boolean = false;
  private useInstancedRendering: boolean = false;
  private autoRepairRate: number = 0; // Health per second
  private lastRepairTime: number = 0;
  private instanceManager?: any; // ProjectileInstanceManager reference

  constructor(scene: THREE.Scene, world: CANNON.World, config: Partial<BatteryConfig> = {}) {
    super();
    this.scene = scene;
    this.world = world;
    this.resourceManager = ResourceManager.getInstance();

    // Default configuration
    this.config = {
      position: new THREE.Vector3(0, 0, 0),
      maxRange: 70,
      minRange: 4,
      reloadTime: 3000, // 3 seconds per missile
      interceptorSpeed: 100,
      launcherCount: 6,
      successRate: 0.95, // 95% success rate
      aggressiveness: 1.3, // Default to firing 1-2 interceptors per threat (reduced from 1.5)
      firingDelay: 800, // 800ms between launches for staggered impacts (increased from 150ms)
      maxHealth: 100, // Default 100 HP
      useInstancedRendering: false, // Default to false
      ...config,
    };

    this.maxHealth = this.config.maxHealth || 100;
    this.currentHealth = this.maxHealth;
    this.useInstancedRendering = this.config.useInstancedRendering || false;

    this.group = new THREE.Group();
    this.group.position.copy(this.config.position);

    // Create battery components (will be replaced if model loads)
    this.createBase();
    this.launcherGroup = this.createLauncher();
    this.radarDome = this.createRadarDome();
    this.rangeIndicator = this.createRangeIndicator();

    // Mark components as procedural for later removal
    this.launcherGroup.userData.isProcedural = true;
    if (this.radarDome) this.radarDome.userData.isProcedural = true;

    // Try to load external model
    this.loadBatteryModel();

    // Initialize launch effects system
    this.launchEffects = new LaunchEffectsSystem(scene);

    // Radar system will be set externally

    // Create health bar (will be shown/hidden based on resource management)
    this.createHealthBar();

    scene.add(this.group);
  }

  private createBase(): void {
    // If using instanced rendering, create invisible hitbox for raycasting
    if (this.useInstancedRendering) {
      // Original OBJ model dimensions from model viewer:
      // Width (X): 24.518 units
      // Height (Y): 22.465 units
      // Depth (Z): 16.500 units
      // The model appears at its original size in game with instanced rendering

      const modelWidth = 24.518;
      const modelHeight = 22.465;
      const modelDepth = 16.5;

      const hitboxGeometry = GeometryFactory.getInstance().getBox(
        modelWidth * 1.1, // Add 10% margin for easier targeting
        modelHeight,
        modelDepth * 1.1
      );
      const hitboxMaterial = MaterialCache.getInstance().getMeshBasicMaterial({
        visible: false,
        transparent: true,
        opacity: 0,
      });
      const hitbox = new THREE.Mesh(hitboxGeometry, hitboxMaterial);
      hitbox.position.y = modelHeight / 2; // Center of the model
      hitbox.userData.isHitbox = true;
      hitbox.userData.battery = this; // Store reference to battery
      hitbox.name = 'instanced-hitbox';
      this.group.add(hitbox);

      console.log('Created instanced rendering hitbox with actual OBJ dimensions:', {
        width: modelWidth * 1.1,
        height: modelHeight,
        depth: modelDepth * 1.1,
        position: hitbox.position,
        originalDimensions: {
          width: modelWidth,
          height: modelHeight,
          depth: modelDepth,
        },
      });
      return;
    }

    // Base platform
    const baseGeometry = GeometryFactory.getInstance().getBox(6, 1, 6);
    const baseMaterial = MaterialCache.getInstance().getMeshStandardMaterial({
      color: 0x4a4a4a,
      roughness: 0.8,
      metalness: 0.3,
    });
    const base = new THREE.Mesh(baseGeometry, baseMaterial);
    base.position.y = 0.5;
    base.castShadow = true;
    base.receiveShadow = true;
    this.group.add(base);

    // Support pillars
    const pillarGeometry = GeometryFactory.getInstance().getCylinder(0.3, 0.3, 2);
    const pillarMaterial = MaterialCache.getInstance().getMeshStandardMaterial({
      color: 0x333333,
      roughness: 0.7,
      metalness: 0.4,
    });

    const positions = [
      [-2, 0, -2],
      [2, 0, -2],
      [-2, 0, 2],
      [2, 0, 2],
    ];

    positions.forEach(pos => {
      const pillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
      pillar.position.set(pos[0], pos[1] + 1, pos[2]);
      pillar.castShadow = true;
      this.group.add(pillar);
    });
  }

  private transformTubePosition(position: THREE.Vector3): THREE.Vector3 {
    // The tube positions from the config are in world space where:
    // 1. The model is scaled to height 15 in the editor
    // 2. The model's bottom is at Y=0
    //
    // In our game with instanced rendering:
    // 1. The model appears at its original size (height 22.465)
    // 2. We need to scale the tube positions to match
    //
    // Scale factor: 22.465 / 15 = 1.4977

    if (this.useInstancedRendering) {
      // For instanced rendering, scale up from editor height (15) to actual model height (22.465)
      const editorHeight = 15;
      const actualModelHeight = 22.465;
      const scaleRatio = actualModelHeight / editorHeight;

      const transformed = position.clone();
      transformed.multiplyScalar(scaleRatio);

      return transformed;
    } else {
      // For non-instanced rendering, scale down to height 4
      const editorTargetHeight = 15;
      const gameTargetHeight = 4;
      const scaleRatio = gameTargetHeight / editorTargetHeight;

      const transformed = position.clone();
      transformed.multiplyScalar(scaleRatio);

      return transformed;
    }
  }

  private createLauncher(): THREE.Group {
    const launcherGroup = new THREE.Group();

    // Limit to 20 tubes based on physical model
    const actualTubeCount = Math.min(this.config.launcherCount, 20);

    // If using instanced rendering, create minimal launcher data without meshes
    if (this.useInstancedRendering) {
      // Create launcher tube data without visual meshes
      for (let i = 0; i < actualTubeCount; i++) {
        const tubeConfig = getTubeVectors(i);
        if (!tubeConfig) continue;

        const launcherTube: LauncherTube = {
          index: i,
          mesh: new THREE.Mesh(), // Dummy mesh for compatibility
          isLoaded: true,
          lastFiredTime: -this.config.reloadTime, // Initialize as "already reloaded" so they're ready immediately
          position: this.transformTubePosition(tubeConfig.start),
          endPosition: this.transformTubePosition(tubeConfig.end),
          direction: tubeConfig.direction, // Direction doesn't need transformation
        };
        this.launcherTubes.push(launcherTube);
      }

      // Log tube positions for debugging
      console.log('Launcher tubes created:', this.launcherTubes.length);
      if (this.launcherTubes.length > 0) {
        const firstTube = this.launcherTubes[0];
        console.log('First tube positions:', {
          start: {
            x: firstTube.position.x.toFixed(2),
            y: firstTube.position.y.toFixed(2),
            z: firstTube.position.z.toFixed(2),
          },
          end: {
            x: firstTube.endPosition.x.toFixed(2),
            y: firstTube.endPosition.y.toFixed(2),
            z: firstTube.endPosition.z.toFixed(2),
          },
          direction: firstTube.direction,
        });
      }
    } else {
      // Create full visual meshes for non-instanced rendering
      const tubeGeometry = GeometryFactory.getInstance().getCylinder(0.2, 0.2, 3);
      const tubeMaterial = MaterialCache.getInstance().getMeshStandardMaterial({
        color: 0x666666,
        roughness: 0.5,
        metalness: 0.7,
      });

      // Create launch tubes based on actual tube positions
      for (let i = 0; i < actualTubeCount; i++) {
        const tubeConfig = getTubeVectors(i);
        if (!tubeConfig) continue;

        const tube = new THREE.Mesh(tubeGeometry, tubeMaterial);

        // Transform positions
        const transformedStart = this.transformTubePosition(tubeConfig.start);
        const transformedEnd = this.transformTubePosition(tubeConfig.end);

        // Position tube at midpoint between start and end
        const midpoint = transformedStart.clone().add(transformedEnd).multiplyScalar(0.5);
        tube.position.copy(midpoint);

        // Calculate tube length based on transformed positions
        const tubeLength = transformedStart.distanceTo(transformedEnd);
        tube.scale.y = tubeLength / 3; // Original geometry is 3 units tall

        // Orient tube along its direction
        const quaternion = new THREE.Quaternion();
        const up = new THREE.Vector3(0, 1, 0);
        quaternion.setFromUnitVectors(up, tubeConfig.direction.clone().normalize());
        tube.quaternion.copy(quaternion);

        tube.castShadow = true;
        launcherGroup.add(tube);

        // Create launcher tube data with transformed positions
        const launcherTube: LauncherTube = {
          index: i,
          mesh: tube,
          isLoaded: true,
          lastFiredTime: -this.config.reloadTime, // Initialize as "already reloaded" so they're ready immediately
          position: transformedStart,
          endPosition: transformedEnd,
          direction: tubeConfig.direction,
        };

        // Add visual missile in tube
        this.createMissileInTube(launcherTube, launcherGroup);
        this.launcherTubes.push(launcherTube);
      }

      // Central mounting
      const mountGeometry = GeometryFactory.getInstance().getCylinder(1.2, 1.5, 1);
      const mountMaterial = MaterialCache.getInstance().getMeshStandardMaterial({
        color: 0x555555,
        roughness: 0.6,
        metalness: 0.5,
      });
      const mount = new THREE.Mesh(mountGeometry, mountMaterial);
      mount.castShadow = true;
      launcherGroup.add(mount);
    }

    // Don't offset launcher group - tubes have absolute positions
    this.group.add(launcherGroup);

    return launcherGroup;
  }

  private createXMarker(direction: THREE.Vector3): THREE.Group {
    const group = new THREE.Group();
    const material = MaterialCache.getInstance().getMeshEmissiveMaterial({
      color: 0xff0000,
      emissive: 0xff0000,
      emissiveIntensity: 0.8,
    });

    // Create two crossing bars for X - larger for better visibility
    const thickness = 0.1;
    const length = 1.2;

    const bar1 = new THREE.Mesh(
      GeometryFactory.getInstance().getBox(length, thickness, thickness),
      material
    );
    bar1.rotation.z = Math.PI / 4;

    const bar2 = new THREE.Mesh(
      GeometryFactory.getInstance().getBox(length, thickness, thickness),
      material
    );
    bar2.rotation.z = -Math.PI / 4;

    group.add(bar1);
    group.add(bar2);

    // Orient the X to be perpendicular to the tube direction (flat against the tube opening)
    const normalizedDirection = direction.clone().normalize();
    const defaultNormal = new THREE.Vector3(0, 0, 1); // Default normal of the X plane

    // Calculate the rotation needed to align the default normal with the tube direction
    const quaternion = new THREE.Quaternion();
    quaternion.setFromUnitVectors(defaultNormal, normalizedDirection);

    group.quaternion.copy(quaternion);

    // Offset slightly above the tube opening
    group.position.y += 0.5;

    return group;
  }

  private createMissileInTube(tube: LauncherTube, parent: THREE.Group): void {
    if (!tube.isLoaded || this.useInstancedRendering) return;

    const missileGeometry = GeometryFactory.getInstance().getCone(0.15, 2, 8);
    const missileMaterial = MaterialCache.getInstance().getMeshEmissiveMaterial({
      color: 0x00ffff,
      emissive: 0x00ffff,
      emissiveIntensity: 0.1,
      roughness: 0.3,
      metalness: 0.8,
    });

    const missile = new THREE.Mesh(missileGeometry, missileMaterial);

    // Position missile at tube end position (bottom, where launch happens)
    missile.position.copy(tube.endPosition);

    // Orient missile along reversed tube direction (pointing upward)
    const quaternion = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const upwardDirection = tube.direction.clone().negate().normalize();
    quaternion.setFromUnitVectors(up, upwardDirection);
    missile.quaternion.copy(quaternion);

    parent.add(missile);

    tube.missile = missile;
  }

  private createRadarDome(): THREE.Mesh {
    // Skip creating radar dome meshes if using instanced rendering
    if (this.useInstancedRendering) {
      return new THREE.Mesh(); // Return dummy mesh for compatibility
    }

    // Radar dome
    const domeGeometry = GeometryFactory.getInstance().getSphere(
      1,
      16,
      8,
      0,
      Math.PI * 2,
      0,
      Math.PI / 2
    );
    const domeMaterial = MaterialCache.getInstance().getMeshTransparentMaterial({
      color: 0x888888,
      roughness: 0.3,
      metalness: 0.8,
      opacity: 0.9,
    });
    const dome = new THREE.Mesh(domeGeometry, domeMaterial);
    dome.position.y = 4;
    dome.castShadow = true;
    this.group.add(dome);

    // Radar antenna (simplified)
    const antennaGeometry = GeometryFactory.getInstance().getBox(0.2, 0.8, 0.1);
    const antennaMaterial = MaterialCache.getInstance().getMeshStandardMaterial({
      color: 0xaaaaaa,
      roughness: 0.4,
      metalness: 0.9,
    });
    const antenna = new THREE.Mesh(antennaGeometry, antennaMaterial);
    antenna.position.y = 4;
    this.group.add(antenna);

    return dome;
  }

  private createRangeIndicator(): THREE.Line {
    // Range indicator is now handled by RadarSystem
    // This method is kept for compatibility but returns an empty line
    const geometry = new THREE.BufferGeometry();
    const material = MaterialCache.getInstance().getLineMaterial({});
    return new THREE.Line(geometry, material);
  }

  setRadarNetwork(radarNetwork: StaticRadarNetwork | InvisibleRadarSystem): void {
    this.radarNetwork = radarNetwork;
  }

  setInstanceManager(instanceManager: any): void {
    this.instanceManager = instanceManager;
  }

  // Public method to enable tube position debugging
  public enableTubeDebug(): void {
    this.debugTubePositions();
    // Also log the first tube for analysis
    if (this.launcherTubes.length > 0) {
      const tube = this.launcherTubes[0];
      console.log('First tube analysis:', {
        startLocal: tube.position,
        endLocal: tube.endPosition,
        batteryPos: this.config.position,
        startWorld: tube.position.clone().add(this.config.position),
        endWorld: tube.endPosition.clone().add(this.config.position),
      });
    }

    // Add a visual battery bounds indicator
    const modelWidth = 24.518 * 1.1; // Include the 10% margin
    const modelHeight = 22.465;
    const modelDepth = 16.5 * 1.1; // Include the 10% margin

    const boundGeom = GeometryFactory.getInstance().getBox(modelWidth, modelHeight, modelDepth);
    const boundMat = MaterialCache.getInstance().getMeshBasicMaterial({
      color: 0x00ffff,
      wireframe: true,
      transparent: true,
      opacity: 0.3,
    });
    const boundBox = new THREE.Mesh(boundGeom, boundMat);
    boundBox.position.copy(this.config.position);
    boundBox.position.y = modelHeight / 2; // Center of the model
    this.scene.add(boundBox);
  }

  private recreateLauncherTubes(): void {
    console.log('Recreating launcher tubes after model load');

    // Clear existing tubes
    this.launcherTubes = [];

    // Remove all children from launcher group
    while (this.launcherGroup.children.length > 0) {
      const child = this.launcherGroup.children[0];
      this.launcherGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        // Don't dispose geometry - it's from GeometryFactory
        // Don't dispose materials - they're from MaterialCache
      }
    }

    // Recreate launcher group with correct transformations
    const tempGroup = this.createLauncher();

    // Move all children from temp group to existing launcher group
    while (tempGroup.children.length > 0) {
      const child = tempGroup.children[0];
      tempGroup.remove(child);
      this.launcherGroup.add(child);
    }

    // Keep launcher group hidden when using OBJ model
    this.launcherGroup.visible = false;

    console.log('Recreated launcher tubes - hidden for OBJ model');
  }

  // Debug method to visualize tube positions
  private debugTubePositions(): void {
    console.log('Debugging tube positions');

    this.launcherTubes.forEach((tube, index) => {
      // Start position marker (green)
      const startGeom = GeometryFactory.getInstance().getSphere(0.3, 16, 16);
      const startMat = MaterialCache.getInstance().getMeshBasicMaterial({
        color: 0x00ff00,
        emissive: 0x00ff00,
        emissiveIntensity: 0.5,
      });
      const startMarker = new THREE.Mesh(startGeom, startMat);
      startMarker.position.copy(tube.position);
      this.launcherGroup.add(startMarker);

      // End position marker (red)
      const endGeom = GeometryFactory.getInstance().getSphere(0.3, 16, 16);
      const endMat = MaterialCache.getInstance().getMeshBasicMaterial({
        color: 0xff0000,
        emissive: 0xff0000,
        emissiveIntensity: 0.5,
      });
      const endMarker = new THREE.Mesh(endGeom, endMat);
      endMarker.position.copy(tube.endPosition);
      this.launcherGroup.add(endMarker);

      // Line between them (yellow)
      const points = [tube.position, tube.endPosition];
      const lineGeom = new THREE.BufferGeometry().setFromPoints(points);
      const lineMat = MaterialCache.getInstance().getLineMaterial({ color: 0xffff00 });
      const line = new THREE.Line(lineGeom, lineMat);
      this.launcherGroup.add(line);

      // Add text label
      console.log(
        `Tube ${index}: start=${tube.position.x.toFixed(2)},${tube.position.y.toFixed(2)},${tube.position.z.toFixed(2)} end=${tube.endPosition.x.toFixed(2)},${tube.endPosition.y.toFixed(2)},${tube.endPosition.z.toFixed(2)}`
      );
    });
  }

  canIntercept(threat: Threat): boolean {
    const threatConfig = THREAT_CONFIGS[threat.type];

    debug
      .module('Battery')
      .log(`Checking if can intercept ${threatConfig.isDrone ? 'DRONE' : 'threat'} ${threat.id}:`, {
        type: threat.type,
        position: threat.getPosition(),
        velocity: threat.getVelocity().length(),
        isDrone: threatConfig.isDrone,
      });

    // Check if detected by radar network
    if (!this.radarNetwork || !this.radarNetwork.checkDetection(threat.getPosition())) {
      debug
        .module('Battery')
        .log(
          `${threatConfig.isDrone ? 'DRONE' : 'Threat'} ${threat.id} NOT detected by radar at position:`,
          threat.getPosition()
        );
      return false;
    }
    debug
      .module('Battery')
      .log(`${threatConfig.isDrone ? 'DRONE' : 'Threat'} ${threat.id} detected by radar ✓`);

    // Check if any tube is loaded
    const hasLoadedTube = this.launcherTubes.some(tube => tube.isLoaded);
    if (!hasLoadedTube) {
      debug
        .module('Battery')
        .log(`No loaded tubes for ${threatConfig.isDrone ? 'DRONE' : 'threat'} ${threat.id}`);
      return false;
    }
    debug.module('Battery').log(`Loaded tubes available ✓`);

    // Check range with vertical emphasis
    const threatPos = threat.getPosition();
    const horizontalDistance = Math.sqrt(
      Math.pow(threatPos.x - this.config.position.x, 2) +
        Math.pow(threatPos.z - this.config.position.z, 2)
    );

    // Use horizontal distance for range check to emphasize vertical coverage
    if (horizontalDistance > this.config.maxRange || horizontalDistance < this.config.minRange) {
      debug
        .module('Battery')
        .log(
          `${threatConfig.isDrone ? 'DRONE' : 'Threat'} ${threat.id} out of horizontal range: ${horizontalDistance.toFixed(1)}m (min: ${this.config.minRange}, max: ${this.config.maxRange})`
        );
      return false;
    }

    // Check altitude - batteries can engage very high targets
    const altitude = threatPos.y;
    const maxAltitude = this.config.maxRange * 1.5; // Can engage up to 1.5x range in altitude
    if (altitude > maxAltitude) {
      debug
        .module('Battery')
        .log(
          `${threatConfig.isDrone ? 'DRONE' : 'Threat'} ${threat.id} too high: ${altitude.toFixed(1)}m (max: ${maxAltitude.toFixed(1)}m)`
        );
      return false;
    }

    debug
      .module('Battery')
      .log(
        `${threatConfig.isDrone ? 'DRONE' : 'Threat'} ${threat.id} in range: horiz=${horizontalDistance.toFixed(1)}m, alt=${altitude.toFixed(1)}m ✓`
      );

    // Check if we can reach the threat in time
    // Use unified trajectory system with configurable mode
    const trajectory = new UnifiedTrajectorySystem({
      mode: (window as any).__useImprovedAlgorithms !== false ? 'improved' : 'basic',
    });
    const interceptionPoint = trajectory.calculateInterceptionPoint(
      threat.getPosition(),
      threat.getVelocity(),
      this.config.position,
      this.config.interceptorSpeed,
      threatConfig.isDrone || false
    );

    if (!interceptionPoint) {
      debug
        .module('Battery')
        .log(
          `Cannot calculate interception for ${threatConfig.isDrone ? 'DRONE' : 'threat'} ${threat.id}:`,
          {
            position: threat.getPosition(),
            velocity: threat.getVelocity(),
            speed: threat.getVelocity().length(),
            isDrone: threatConfig.isDrone,
          }
        );
      return false;
    }

    debug
      .module('Battery')
      .log(`CAN INTERCEPT ${threatConfig.isDrone ? 'DRONE' : 'threat'} ${threat.id} ✓✓✓`);
    return true;
  }

  assessThreatLevel(threat: Threat): number {
    // Returns a threat level from 0 to 1
    let threatLevel = 0.5; // Base threat level

    // Factor 1: Speed (faster threats are more dangerous)
    const speed = threat.getVelocity().length();
    if (speed > 300) threatLevel += 0.2;
    else if (speed > 200) threatLevel += 0.1;

    // Factor 2: Time to impact (less time = more urgent)
    const timeToImpact = threat.getTimeToImpact();
    if (timeToImpact < 5) threatLevel += 0.3;
    else if (timeToImpact < 10) threatLevel += 0.2;
    else if (timeToImpact < 15) threatLevel += 0.1;

    // Factor 3: Altitude (lower altitude = harder to intercept)
    const altitude = threat.getPosition().y;
    if (altitude < 50) threatLevel += 0.1;

    // Factor 4: Distance from battery (closer = more urgent)
    const distance = threat.getPosition().distanceTo(this.config.position);
    const rangeRatio = distance / this.config.maxRange;
    if (rangeRatio < 0.3) threatLevel += 0.2;
    else if (rangeRatio < 0.5) threatLevel += 0.1;

    return Math.min(1.0, threatLevel);
  }

  calculateInterceptorCount(threat: Threat, existingInterceptors: number = 0): number {
    // If threat already has interceptors, be very conservative
    if (existingInterceptors > 0) {
      // Only fire more if it's a critical threat and we have very few interceptors
      const threatLevel = this.assessThreatLevel(threat);
      if (threatLevel < 0.9 || existingInterceptors >= 2) {
        return 0; // Let existing interceptors handle it
      }
      // For critical threats with only 1 interceptor, maybe add one more
      const loadedTubes = this.launcherTubes.filter(tube => tube.isLoaded).length;
      return loadedTubes > 0 ? 1 : 0;
    }

    // For new interceptions, determine how many interceptors to fire
    const threatLevel = this.assessThreatLevel(threat);
    const baseCount = Math.floor(this.config.aggressiveness);

    // High threat gets extra interceptor
    let count = threatLevel > 0.7 ? baseCount + 1 : baseCount;

    // Random chance for additional interceptor based on aggressiveness fractional part
    const extraChance = this.config.aggressiveness % 1;
    if (Math.random() < extraChance) {
      count++;
    }

    // Limit by available loaded tubes
    const loadedTubes = this.launcherTubes.filter(tube => tube.isLoaded).length;
    count = Math.min(count, loadedTubes);

    // Performance optimization: limit to 2 simultaneous interceptors
    // to prevent triangle count spikes (each adds ~100 tris + particles)
    return Math.min(count, 2);
  }

  fireInterceptors(
    threat: Threat,
    count: number = 1,
    onLaunch?: (interceptor: Projectile) => void
  ): Projectile[] {
    if (!this.canIntercept(threat)) {
      return [];
    }

    // Check resources if resource management is enabled
    if (this.useResources) {
      // Check if we have enough interceptors in stock
      let availableCount = 0;
      for (let i = 0; i < count; i++) {
        if (this.resourceManager.hasInterceptors()) {
          availableCount++;
        } else {
          break;
        }
      }

      if (availableCount === 0) {
        debug.warn('No interceptors in stock!', {
          useResources: this.useResources,
          hasInterceptors: this.resourceManager.hasInterceptors(),
          interceptorStock: this.resourceManager.getInterceptorStock(),
        });
        return [];
      }

      count = availableCount;
    }

    // Find loaded tubes
    const loadedTubes = this.launcherTubes.filter(tube => tube.isLoaded);
    if (loadedTubes.length === 0) {
      return [];
    }

    // Ammo management: adjust firing based on available interceptors
    const ammoRatio = loadedTubes.length / this.launcherTubes.length;
    const threatLevel = this.assessThreatLevel(threat);

    // Conservative firing when low on ammo, unless threat is critical
    if (ammoRatio < 0.3 && threatLevel < 0.8 && count > 1) {
      debug.category('Battery', 'Low ammo - reducing interceptor count');
      count = 1;
    }

    // Limit count to available tubes
    count = Math.min(count, loadedTubes.length);
    const interceptors: Projectile[] = [];

    // Calculate optimal firing delay for staggered impacts
    const distance = threat.getPosition().distanceTo(this.config.position);
    const timeToImpact = distance / this.config.interceptorSpeed;

    // Base delay should be proportional to flight time to ensure staggered arrivals
    // For a 10 second flight, we want ~1 second between impacts
    const optimalDelay = Math.max(500, Math.min(2000, timeToImpact * 100));

    // Adjust firing delay based on threat urgency
    const urgencyMultiplier = threatLevel > 0.7 ? 0.7 : 1.0;
    const adjustedDelay = optimalDelay * urgencyMultiplier;

    // Fire interceptors with adjusted delay between each
    for (let i = 0; i < count; i++) {
      const tube = loadedTubes[i];
      if (!tube) break;

      // Mark tube as reserved immediately to prevent reuse
      tube.isLoaded = false;

      if (i === 0) {
        // Fire first one immediately
        tube.isLoaded = true; // Temporarily restore for launch
        const interceptor = this.launchFromTube(tube, threat);
        if (interceptor) {
          // Consume resource if enabled
          if (this.useResources) {
            this.resourceManager.consumeInterceptor();
          }
          interceptors.push(interceptor);
          if (onLaunch) onLaunch(interceptor);
        }
      } else {
        // Fire subsequent ones with delay
        const delayMs = i * adjustedDelay;
        setTimeout(() => {
          // Check if tube hasn't been reloaded in the meantime
          if (!tube.isLoaded && tube.lastFiredTime < Date.now() - this.config.reloadTime) {
            tube.isLoaded = true; // Temporarily restore for launch
            const interceptor = this.launchFromTube(tube, threat);
            if (interceptor) {
              // Consume resource if enabled
              if (this.useResources) {
                this.resourceManager.consumeInterceptor();
              }
              if (onLaunch) {
                onLaunch(interceptor);
              }
            }
          }
        }, delayMs);
      }
    }

    return interceptors;
  }

  fireInterceptor(threat: Threat): Projectile | null {
    // Legacy method - fires single interceptor
    const interceptors = this.fireInterceptors(threat, 1);
    return interceptors.length > 0 ? interceptors[0] : null;
  }

  fireInterceptorManual(threat: Threat): Projectile | null {
    // Manual fire - bypasses range checks for player control
    // Check if any tube is loaded
    const loadedTube = this.launcherTubes.find(tube => tube.isLoaded);
    if (!loadedTube) {
      debug.log('No loaded tubes available for manual fire');
      debug.log(
        'Launcher tubes status:',
        this.launcherTubes.map(t => ({
          index: t.index,
          isLoaded: t.isLoaded,
          lastFiredTime: t.lastFiredTime,
          timeSinceFire: Date.now() - t.lastFiredTime,
        }))
      );
      return null;
    }

    // Check resources if resource management is enabled
    if (this.useResources && !this.resourceManager.consumeInterceptor()) {
      debug.warn('No interceptors in stock for manual fire!');
      return null;
    }

    // For manual fire, aim directly at threat's current position with lead prediction
    const threatPos = threat.getPosition();
    const threatVel = threat.getVelocity();

    // Simple lead calculation - estimate time to reach threat
    const distance = this.config.position.distanceTo(threatPos);
    const timeToReach = distance / this.config.interceptorSpeed;

    // Predict where threat will be
    const leadPoint = new THREE.Vector3(
      threatPos.x + threatVel.x * timeToReach * 0.8, // Slight underestimate for better visuals
      threatPos.y + threatVel.y * timeToReach * 0.8,
      threatPos.z + threatVel.z * timeToReach * 0.8
    );

    // Calculate launch velocity to reach the lead point
    let launchParams = UnifiedTrajectorySystem.calculateLaunchParameters(
      this.config.position,
      leadPoint,
      this.config.interceptorSpeed,
      true // Use lofted trajectory
    );

    if (!launchParams) {
      // If can't calculate trajectory, just aim directly
      const direction = new THREE.Vector3().subVectors(leadPoint, this.config.position).normalize();
      launchParams = {
        angle: 45, // Default angle
        azimuth: Math.atan2(direction.z, direction.x),
        velocity: this.config.interceptorSpeed,
      };
    }

    // Get launch position
    const tubeWorldPos = this.config.position.clone();
    tubeWorldPos.add(this.launchOffset);

    // Create interceptor with perfect success rate for manual control
    const velocity = UnifiedTrajectorySystem.getVelocityVector(launchParams);
    const interceptor = new Projectile(this.scene, this.world, {
      position: tubeWorldPos,
      velocity,
      color: 0x00ff00,
      radius: 0.3,
      mass: 10,
      isInterceptor: true,
      target: threat,
      failureMode: 'none', // No failures for manual control
      maxLifetime: 15,
      batteryPosition: this.config.position,
      useInstancing: !!this.instanceManager,
      instanceManager: this.instanceManager,
    });

    // Mark tube as reloading
    loadedTube.isLoaded = false;
    loadedTube.lastFiredTime = Date.now();

    // Visual feedback
    if (loadedTube.missile) {
      loadedTube.missile.visible = false;
    }

    // Note: Manual interceptors need to be tracked separately
    // since Projectile doesn't extend EventEmitter

    // Create launch effects
    this.launchEffects.createLaunchEffect(tubeWorldPos, this.launchDirection);

    // Play launch sound
    SoundSystem.getInstance().playLaunch(tubeWorldPos);

    this.emit('interceptorLaunched', { interceptor, threat });
    return interceptor;
  }

  private launchFromTube(tube: LauncherTube, threat: Threat): Projectile | null {
    // Calculate interception point
    const threatConfig = THREAT_CONFIGS[threat.type];
    const interceptionData = UnifiedTrajectorySystem.calculateInterceptionPoint(
      threat.getPosition(),
      threat.getVelocity(),
      this.config.position,
      this.config.interceptorSpeed,
      threatConfig.isDrone || false
    );

    if (!interceptionData) {
      return null;
    }

    // Calculate launch parameters with lofted trajectory
    const launchParams = UnifiedTrajectorySystem.calculateLaunchParameters(
      this.config.position,
      interceptionData.point,
      this.config.interceptorSpeed,
      true // Use lofted trajectory for interceptors
    );

    if (!launchParams) {
      return null;
    }

    // Get launch position from the specific tube
    // In the tube editor, "start" is the top (where interceptors launch from)
    // "end" is the bottom (where smoke effects appear)
    const tubeWorldPos = tube.position.clone().add(this.config.position);

    // The direction in the editor points from top to bottom, but we need to fire upward
    // So we reverse it
    const actualLaunchDirection = tube.direction.clone().negate();

    // Add offset along the actual launch direction to ensure interceptor spawns outside battery
    const launchOffset = actualLaunchDirection.clone().multiplyScalar(1.5); // 1.5m offset along launch direction
    tubeWorldPos.add(launchOffset);

    // Optional debug logging (enable if needed)
    if ((window as any).__debugLaunchPositions) {
      console.log('Launch debug:', {
        tubeIndex: tube.index,
        tubeEndPos: {
          x: tube.endPosition.x.toFixed(2),
          y: tube.endPosition.y.toFixed(2),
          z: tube.endPosition.z.toFixed(2),
        },
        batteryPos: {
          x: this.config.position.x.toFixed(2),
          y: this.config.position.y.toFixed(2),
          z: this.config.position.z.toFixed(2),
        },
        groupPos: {
          x: this.group.position.x.toFixed(2),
          y: this.group.position.y.toFixed(2),
          z: this.group.position.z.toFixed(2),
        },
        tubeWorldPos: {
          x: tubeWorldPos.x.toFixed(2),
          y: tubeWorldPos.y.toFixed(2),
          z: tubeWorldPos.z.toFixed(2),
        },
        distanceFromBattery: tubeWorldPos.distanceTo(this.config.position).toFixed(2),
        actualLaunchDirection: {
          x: actualLaunchDirection.x.toFixed(2),
          y: actualLaunchDirection.y.toFixed(2),
          z: actualLaunchDirection.z.toFixed(2),
        },
      });
    }

    // Determine if this interceptor will fail
    let failureMode: 'none' | 'motor' | 'guidance' | 'premature' = 'none';
    let failureTime = 0;

    if (Math.random() > this.config.successRate) {
      // Interceptor will fail - determine failure mode
      const failureRoll = Math.random();
      if (failureRoll < 0.4) {
        failureMode = 'motor';
        failureTime = 0.5 + Math.random() * 2; // Motor fails 0.5-2.5s after launch
      } else if (failureRoll < 0.7) {
        failureMode = 'guidance';
        failureTime = 1 + Math.random() * 3; // Guidance fails 1-4s after launch
      } else {
        failureMode = 'premature';
        failureTime = 0.2 + Math.random() * 2; // Premature detonation 0.2-2.2s after launch
      }

      debug.category(
        'Battery',
        `Interceptor will fail: ${failureMode} at ${failureTime.toFixed(1)}s`
      );
    }

    // Create interceptor with adjusted initial velocity based on launch direction
    let velocity = UnifiedTrajectorySystem.getVelocityVector(launchParams);

    // Blend calculated velocity with tube's launch direction for more realistic launch
    // This ensures the missile initially follows the tube's direction
    const launchSpeed = velocity.length();
    const launchVelocity = actualLaunchDirection.clone().multiplyScalar(launchSpeed);

    // Blend: 70% tube direction, 30% calculated direction for first moments
    velocity = launchVelocity.multiplyScalar(0.7).add(velocity.multiplyScalar(0.3));
    velocity.normalize().multiplyScalar(launchSpeed);

    const interceptor = new Projectile(this.scene, this.world, {
      position: tubeWorldPos,
      velocity,
      color: 0x00ffff,
      radius: 0.3,
      mass: 20, // Reduced mass for better maneuverability
      trailLength: 100,
      isInterceptor: true,
      target: threat,
      failureMode,
      failureTime,
      maxLifetime: 10, // 10 second max flight time
      batteryPosition: this.config.position, // Pass battery position for self-destruct check
      useInstancing: !!this.instanceManager,
      instanceManager: this.instanceManager,
    });

    // Update tube state
    tube.isLoaded = false;
    tube.lastFiredTime = Date.now();

    // Create launch effects at the tube's end position (bottom of tube)
    const effectPos = tube.endPosition.clone().add(this.config.position);
    this.launchEffects.createLaunchEffect(effectPos, actualLaunchDirection);

    // Play launch sound
    const soundSystem = SoundSystem.getInstance();
    soundSystem.playLaunch(tubeWorldPos);

    // Emit launch event
    this.emit('interceptorLaunched', { interceptor, threat, battery: this });

    return interceptor;
  }

  private animateLaunch(tube: LauncherTube): void {
    // Tube recoil animation only if mesh exists
    if (tube.mesh && !this.useInstancedRendering) {
      const originalPos = tube.mesh.position.clone();
      // Move tube back along its direction for recoil
      const recoilOffset = tube.direction.clone().multiplyScalar(-0.15);
      tube.mesh.position.add(recoilOffset);

      setTimeout(() => {
        tube.mesh.position.copy(originalPos);
      }, 300);
    }

    // Get launch position at tube end for smoke effects (where the missile actually launches from)
    // Remember: in editor terminology, "end" is the bottom where we launch from
    const smokeWorldPos = tube.endPosition.clone().add(this.config.position);

    // Use tube's specific launch direction (reversed since editor direction points downward)
    const launchDirection = tube.direction.clone().negate();

    // Create comprehensive launch effects at tube end
    this.launchEffects.createLaunchEffect(smokeWorldPos, launchDirection, {
      smokeCloudSize: 4,
      smokeDuration: 2000,
      flashIntensity: 6,
      flashDuration: 120,
      dustRadius: 2, // Further reduced for more realistic size
      scorchMarkRadius: 1.5,
    });
  }

  // This method has been merged into the update method above

  private calculateReloadMultiplier(threats: Threat[]): number {
    // Ammo management: adjust reload speed based on threat situation
    const activeThreats = threats.filter(t => t.isActive);
    const loadedTubes = this.launcherTubes.filter(t => t.isLoaded).length;
    const totalTubes = this.launcherTubes.length;

    // Factor 1: Threat density
    const threatDensity = activeThreats.length;

    // Factor 2: Ammo availability
    const ammoRatio = loadedTubes / totalTubes;

    // Factor 3: Average threat urgency
    let avgTimeToImpact = 20; // Default high value
    if (activeThreats.length > 0) {
      const totalTime = activeThreats.reduce((sum, t) => sum + t.getTimeToImpact(), 0);
      avgTimeToImpact = totalTime / activeThreats.length;
    }

    // Calculate multiplier
    let multiplier = 1.0;

    // Many threats + low ammo = faster reload (up to 50% faster)
    if (threatDensity > 5 && ammoRatio < 0.3) {
      multiplier = 0.5;
    }
    // Moderate threats = normal to slightly faster
    else if (threatDensity > 2) {
      multiplier = 0.7 + ammoRatio * 0.3;
    }
    // Few threats + high ammo = slower reload (conserve readiness)
    else if (threatDensity <= 2 && ammoRatio > 0.7) {
      multiplier = 1.2;
    }

    // Urgent threats override and speed up reload
    if (avgTimeToImpact < 10) {
      multiplier *= 0.7;
    }

    return Math.max(0.5, Math.min(1.5, multiplier));
  }

  getInterceptorCount(): number {
    return this.launcherTubes.filter(tube => tube.isLoaded).length;
  }

  getPosition(): THREE.Vector3 {
    return this.config.position.clone();
  }

  getGroup(): THREE.Group {
    return this.group;
  }

  // Add debug visualization for troubleshooting
  addDebugVisualization(): void {
    // Clear any existing debug visualizations
    const existingDebug = [];
    this.group.traverse(child => {
      if (child.userData.isDebugVisualization) {
        existingDebug.push(child);
      }
    });
    existingDebug.forEach(child => this.group.remove(child));

    // Log all hitboxes found
    const hitboxes = [];
    this.group.traverse(child => {
      if (child.userData.isHitbox) {
        hitboxes.push({
          name: child.name,
          position: child.position,
          scale: child.scale,
          geometry: child.geometry?.parameters || 'unknown',
        });
      }
    });
    console.log('Found hitboxes:', hitboxes);

    // Find the actual hitbox to visualize its bounds - check all possible names
    let hitbox = this.group.getObjectByName('battery-hitbox-accurate'); // New accurate hitbox
    if (!hitbox) {
      hitbox = this.group.getObjectByName('battery-hitbox'); // Regular hitbox
    }

    if (hitbox && hitbox instanceof THREE.Mesh && hitbox.geometry instanceof THREE.BoxGeometry) {
      // Get the actual hitbox dimensions
      const params = hitbox.geometry.parameters;
      console.log(`Using ${hitbox.name} with params:`, params);
      const boundGeom = GeometryFactory.getInstance().getBox(
        params.width,
        params.height,
        params.depth
      );
      const boundMat = MaterialCache.getInstance().getMeshBasicMaterial({
        color: 0x00ffff,
        wireframe: true,
        transparent: true,
        opacity: 0.5,
      });
      const boundBox = new THREE.Mesh(boundGeom, boundMat);
      boundBox.position.copy(hitbox.position);
      boundBox.userData.isDebugVisualization = true;
      this.group.add(boundBox);
    } else {
      // Check for instanced hitbox
      const instancedHitbox = this.group.getObjectByName('instanced-hitbox');
      if (
        instancedHitbox &&
        instancedHitbox instanceof THREE.Mesh &&
        instancedHitbox.geometry instanceof THREE.BoxGeometry
      ) {
        console.log('Using instanced hitbox');
        const params = instancedHitbox.geometry.parameters;
        const boundGeom = GeometryFactory.getInstance().getBox(
          params.width,
          params.height,
          params.depth
        );
        const boundMat = MaterialCache.getInstance().getMeshBasicMaterial({
          color: 0x00ff00, // Green for instanced hitbox
          wireframe: true,
          transparent: true,
          opacity: 0.5,
        });
        const boundBox = new THREE.Mesh(boundGeom, boundMat);
        boundBox.position.copy(instancedHitbox.position);
        this.group.add(boundBox);
      }

      // Check for old procedural hitbox
      const procHitbox = this.group.getObjectByName('procedural-hitbox');
      if (
        procHitbox &&
        procHitbox instanceof THREE.Mesh &&
        procHitbox.geometry instanceof THREE.BoxGeometry
      ) {
        console.log('WARNING: Still using old procedural hitbox!');
        const params = procHitbox.geometry.parameters;
        const boundGeom = GeometryFactory.getInstance().getBox(
          params.width,
          params.height,
          params.depth
        );
        const boundMat = MaterialCache.getInstance().getMeshBasicMaterial({
          color: 0xff0000, // Red to indicate wrong hitbox
          wireframe: true,
          transparent: true,
          opacity: 0.5,
        });
        const boundBox = new THREE.Mesh(boundGeom, boundMat);
        boundBox.position.copy(procHitbox.position);
        this.group.add(boundBox);
      }
    }

    // Add spheres at each tube position
    this.launcherTubes.forEach((tube, index) => {
      // End position (launch point) - RED
      const endSphere = new THREE.Mesh(
        GeometryFactory.getInstance().getSphere(0.3, 16, 16),
        MaterialCache.getInstance().getMeshBasicMaterial({ color: 0xff0000 })
      );
      endSphere.position.copy(tube.endPosition);
      this.group.add(endSphere);

      // Start position (top) - GREEN
      const startSphere = new THREE.Mesh(
        GeometryFactory.getInstance().getSphere(0.3, 16, 16),
        MaterialCache.getInstance().getMeshBasicMaterial({ color: 0x00ff00 })
      );
      startSphere.position.copy(tube.position);
      this.group.add(startSphere);

      // Direction arrow
      const arrow = new THREE.ArrowHelper(
        tube.direction.clone().negate(), // Show upward direction
        tube.endPosition,
        2,
        0xffff00
      );
      this.group.add(arrow);
    });
  }

  getConfig(): BatteryConfig {
    return { ...this.config };
  }

  getStats() {
    const loadedTubes = this.launcherTubes.filter(t => t.isLoaded).length;
    const reloadingTubes = this.launcherTubes.filter(t => !t.isLoaded).length;

    return {
      loadedTubes,
      reloadingTubes,
      totalTubes: this.launcherTubes.length,
      health: {
        current: this.currentHealth,
        max: this.maxHealth,
        percent: this.currentHealth / this.maxHealth,
      },
    };
  }

  getBounds(): THREE.Box3 {
    const box = new THREE.Box3();

    // Try to get bounds from the hitbox first
    const hitbox = this.group.getObjectByName('battery-hitbox');
    if (hitbox && hitbox instanceof THREE.Mesh) {
      box.setFromObject(hitbox);
    } else {
      // Fallback to group bounds
      box.setFromObject(this.group);
    }

    return box;
  }

  setResourceManagement(enabled: boolean): void {
    // Removed excessive setResourceManagement logging
    this.useResources = enabled;

    // In sandbox mode (resources disabled), also disable health system
    if (!enabled) {
      // Remove health bar if it exists
      if (this.healthBar) {
        this.healthBar.visible = false;
        // Health bar hidden (sandbox mode)
      }
      // Reset health to max and prevent damage
      this.currentHealth = this.maxHealth;
      this.isDestroyed = false;
    } else {
      // Re-enable health bar
      if (!this.healthBar) {
        // Health bar doesn't exist, creating it
        // Create health bar if it doesn't exist yet
        this.createHealthBar();
      }
      this.healthBar.visible = true;
      this.updateHealthBar(); // Update to show current health
      // Health bar enabled and updated
    }
  }

  resetInterceptorStock(): void {
    // Reset all launcher tubes to loaded state
    this.launcherTubes.forEach(tube => {
      tube.isLoaded = true;
      tube.lastFiredTime = -this.config.reloadTime; // Ready to fire immediately

      // Show missile if it exists
      if (tube.missile) {
        tube.missile.visible = true;
      }

      // Remove X marker if it exists
      if (tube.xMarker) {
        this.launcherGroup.remove(tube.xMarker);
        tube.xMarker.traverse(child => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            // Don't dispose material - it's from MaterialCache
          }
        });
        tube.xMarker = undefined;
      }
    });

    debug.log(`Battery interceptor stock reset - all ${this.launcherTubes.length} tubes ready`);
  }

  // Initialize X markers for empty tubes (call this after battery creation if needed)
  initializeEmptyTubes(emptyTubeIndices: number[] = []): void {
    this.launcherTubes.forEach((tube, index) => {
      if (emptyTubeIndices.includes(index) || (emptyTubeIndices.length === 0 && !tube.isLoaded)) {
        tube.isLoaded = false;
        tube.lastFiredTime = Date.now();

        // Hide missile if it exists
        if (tube.missile) {
          tube.missile.visible = false;
        }

        // Create X marker
        if (!tube.xMarker) {
          tube.xMarker = this.createXMarker(tube.direction);
          // Position X marker at the top (start) of the tube where interceptors launch from
          tube.xMarker.position.copy(tube.position);
          // Add to main group for visibility with instanced rendering
          this.group.add(tube.xMarker);
        }
      }
    });
  }

  private createHealthBar(): void {
    debug.module('Battery').log('Creating health bar, useResources:', this.useResources);

    // Remove existing health bar if it exists
    if (this.healthBar) {
      this.healthBar.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) {
            child.material.dispose();
          }
        }
      });
      this.scene.remove(this.healthBar);
    }

    this.healthBar = new THREE.Group();

    // Background bar
    const bgGeometry = GeometryFactory.getInstance().getPlane(20, 3);
    const bgMaterial = MaterialCache.getInstance().getMeshBasicMaterial({
      color: 0x333333,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    });
    const bgBar = new THREE.Mesh(bgGeometry, bgMaterial);
    bgBar.position.y = 0; // Relative to group
    // Optimize: UI elements don't need shadows
    bgBar.castShadow = false;
    bgBar.receiveShadow = false;
    this.healthBar.add(bgBar);

    // Health bar
    const healthGeometry = GeometryFactory.getInstance().getPlane(19, 2);
    const healthMaterial = MaterialCache.getInstance().getMeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    });
    const healthFill = new THREE.Mesh(healthGeometry, healthMaterial);
    healthFill.position.y = 0; // Relative to group
    healthFill.position.z = 0.1;
    healthFill.name = 'health-fill';
    // Optimize: UI elements don't need shadows
    healthFill.castShadow = false;
    healthFill.receiveShadow = false;
    this.healthBar.add(healthFill);

    // Add to scene (not group) so it can rotate independently
    this.scene.add(this.healthBar);
    this.healthBar.position.copy(this.config.position);
    this.healthBar.position.y = 25; // Position above battery

    // Set initial visibility based on resource management mode
    this.healthBar.visible = this.useResources;
    debug
      .module('Battery')
      .log(
        'Health bar created at position:',
        this.healthBar.position,
        'visible:',
        this.healthBar.visible
      );
  }

  private updateHealthBar(): void {
    if (!this.healthBar) return;

    const healthFill = this.healthBar.getObjectByName('health-fill') as THREE.Mesh;
    if (!healthFill) return;

    // Update width based on health percentage
    const healthPercent = this.currentHealth / this.maxHealth;
    healthFill.scale.x = healthPercent;
    healthFill.position.x = (-(1 - healthPercent) * 9.5) / 2;

    // Update color based on health
    const material = healthFill.material as THREE.MeshBasicMaterial;
    if (healthPercent > 0.6) {
      material.color.setHex(0x00ff00); // Green
    } else if (healthPercent > 0.3) {
      material.color.setHex(0xffaa00); // Orange
    } else {
      material.color.setHex(0xff0000); // Red
    }

    // Face camera
    const camera = (this.scene as any).__camera;
    if (camera) {
      this.healthBar.lookAt(camera.position);
    }
  }

  takeDamage(amount: number): void {
    if (this.isDestroyed) return;

    // In sandbox mode (resources disabled), ignore damage
    if (!this.useResources) return;

    this.currentHealth = Math.max(0, this.currentHealth - amount);
    this.updateHealthBar();

    // Visual feedback
    const originalColor = (this.radarDome.material as THREE.MeshStandardMaterial).color.getHex();
    (this.radarDome.material as THREE.MeshStandardMaterial).color.setHex(0xff0000);

    setTimeout(() => {
      if (this.radarDome && !this.isDestroyed) {
        (this.radarDome.material as THREE.MeshStandardMaterial).color.setHex(originalColor);
      }
    }, 200);

    // Check if destroyed
    if (this.currentHealth <= 0) {
      this.onDestroyed();
    }
  }

  private onDestroyed(): void {
    // Create explosion effect using ExplosionManager
    const explosionManager = ExplosionManager.getInstance(this.scene);
    explosionManager.createExplosion({
      type: ExplosionType.GROUND_IMPACT,
      position: this.config.position,
      radius: 20,
      intensity: 2,
    });

    // Disable battery
    this.isDestroyed = true;
    this.group.visible = false;
    if (this.healthBar) {
      this.healthBar.visible = false;
    }

    // Emit destroyed event
    this.emit('destroyed', { battery: this });
  }

  repair(amount: number): void {
    if (this.isDestroyed && this.currentHealth + amount >= this.maxHealth * 0.2) {
      // Revive the battery if repaired above 20% health
      this.isDestroyed = false;
      this.group.visible = true;
    }

    this.currentHealth = Math.min(this.maxHealth, this.currentHealth + amount);
    this.updateHealthBar();

    // Show health bar in game mode when repaired
    if (this.healthBar && this.useResources) {
      this.healthBar.visible = true;
    }
  }

  getHealth(): { current: number; max: number } {
    return {
      current: this.currentHealth,
      max: this.maxHealth,
    };
  }

  isOperational(): boolean {
    return !this.isDestroyed && this.currentHealth > 0;
  }

  setAutoRepairRate(healthPerSecond: number): void {
    this.autoRepairRate = healthPerSecond;
    this.lastRepairTime = Date.now();
  }

  getAutoRepairRate(): number {
    return this.autoRepairRate;
  }

  setLaunchOffset(offset: THREE.Vector3): void {
    this.launchOffset = offset.clone();
  }

  setLaunchDirection(direction: THREE.Vector3): void {
    this.launchDirection = direction.clone().normalize();
  }

  // Enable instanced rendering mode (must be called before constructor finishes)
  setInstancedRendering(enabled: boolean): void {
    this.useInstancedRendering = enabled;
  }

  // Hide visual meshes when using instanced rendering
  setVisualVisibility(visible: boolean): void {
    this.group.traverse(child => {
      if (child instanceof THREE.Mesh) {
        child.visible = visible;
      }
    });

    // Also hide launcher tubes and missiles if they exist
    this.launcherTubes.forEach(tube => {
      if (tube.mesh && tube.mesh.geometry) tube.mesh.visible = visible;
      if (tube.missile && tube.missile.geometry) tube.missile.visible = visible;
    });

    // Keep health bar visible if it exists
    if (this.healthBar) {
      this.healthBar.visible = visible && this.useResources;
    }
  }

  private loadBatteryModel(): void {
    // Even with instanced rendering, we need to load the model once to get accurate dimensions
    console.log('Starting OBJ model load...', {
      useInstancedRendering: this.useInstancedRendering,
    });
    const loader = new OBJLoader();
    loader.load(
      '/assets/Battery.obj',
      object => {
        // Model loaded successfully
        console.log('OBJ model loaded successfully');
        debug.asset('loading', 'battery', { object });

        // Log what we loaded
        let meshCount = 0;
        object.traverse(child => {
          if (child instanceof THREE.Mesh) {
            meshCount++;
            debug.asset('loading', 'battery-mesh', {
              name: child.name,
              vertices: child.geometry.attributes.position?.count,
            });
          }
        });
        debug.asset('loading', 'battery-meshes', { count: meshCount });

        // Calculate model bounds to determine proper scale
        const box = new THREE.Box3().setFromObject(object);
        const size = box.getSize(new THREE.Vector3());
        debug.asset('loading', 'battery-size', { size });

        // Log original tube positions for debugging
        const sampleTube = getTubeVectors(0);
        if (sampleTube) {
          console.log('Original tube 0 position:', sampleTube.start);
          console.log('Model original height:', size.y);
        }

        // Check if model has valid size
        if (size.x === 0 || size.y === 0 || size.z === 0) {
          debug.error('Battery model has zero size!', size);
          return;
        }

        // If model is too small or too large, scale it
        const targetHeight = 4;
        const scaleFactor = targetHeight / size.y; // Always calculate scale factor
        if (Math.abs(scaleFactor - 1) > 0.01) {
          // Only apply if significantly different from 1
          object.scale.set(scaleFactor, scaleFactor, scaleFactor);
        }
        debug.asset('loading', 'battery-scale', {
          scaleFactor,
          originalHeight: size.y,
          targetHeight,
        });

        // Center the model at origin BEFORE optimization
        box.setFromObject(object);
        const center = box.getCenter(new THREE.Vector3());
        const minY = box.min.y;
        object.position.set(-center.x, -minY, -center.z); // Place on ground
        debug.asset('loading', 'battery-position-before-opt', { position: object.position, minY });

        // Model transformations are now handled naturally by the group hierarchy

        // Analyze model complexity before optimization
        const beforeStats = GeometryOptimizer.analyzeComplexity(object);
        debug.log('Battery model complexity BEFORE optimization:', beforeStats);

        // Optimize the model but preserve important details like legs
        GeometryOptimizer.optimizeObject(object, {
          simplify: false, // Disable simplification to keep all geometry
          simplifyRatio: 1.0, // Keep 100% of triangles
          mergeByMaterial: true, // Still merge by material for performance
          removeSmallDetails: false, // Don't remove any details
          smallDetailThreshold: 0.1, // Very small threshold
        });

        // Recalculate bounds after optimization as geometry may have changed
        box.setFromObject(object);
        const newMinY = box.min.y;
        const newSize = box.getSize(new THREE.Vector3());

        // Debug: Let's see what's happening
        debug.module('Battery').log('Battery OBJ Debug:', {
          originalMinY: minY,
          newMinY: newMinY,
          sizeBefore: size,
          sizeAfter: newSize,
          groupPosition: this.group.position,
        });

        // Try NOT repositioning after optimization - just use the original position
        // object.position.set(-center.x, -newMinY + domeYOffset, -center.z);
        debug.asset('loading', 'battery-position-after-opt', {
          position: object.position,
          newMinY,
        });

        // Analyze after optimization
        const afterStats = GeometryOptimizer.analyzeComplexity(object);
        debug.log('Battery model complexity AFTER optimization:', afterStats);
        debug.log(
          `Triangle reduction: ${beforeStats.totalTriangles} -> ${afterStats.totalTriangles} (${Math.round((1 - afterStats.totalTriangles / beforeStats.totalTriangles) * 100)}% reduction)`
        );

        // Hide ALL procedurally generated components when model loads
        this.group.children.forEach(child => {
          if (child.userData.isProcedural) {
            child.visible = false;
          }
        });

        // Also hide the launcher group - we'll use the OBJ model's tubes
        if (this.launcherGroup) {
          this.launcherGroup.visible = false;
        }

        // If using instanced rendering, we only need the dimensions, not the visual model
        if (this.useInstancedRendering) {
          // Wait a moment for the model to be fully processed and scaled
          setTimeout(() => {
            // Calculate model dimensions for accurate hitbox AFTER all transformations
            const finalBox = new THREE.Box3().setFromObject(object);
            const finalSize = finalBox.getSize(new THREE.Vector3());
            const finalCenter = finalBox.getCenter(new THREE.Vector3());

            // The model should be scaled to height 4, but we're getting much smaller dimensions
            // This suggests the scale wasn't applied yet or there's an issue with the measurement
            // Let's use the known target height and scale proportionally
            const targetHeight = 4;
            const currentHeight = finalSize.y;
            const heightScale = targetHeight / currentHeight;

            // Apply this scale to get the actual in-game dimensions
            const actualSize = new THREE.Vector3(
              finalSize.x * heightScale,
              targetHeight,
              finalSize.z * heightScale
            );

            console.log('OBJ model dimensions for instanced rendering:', {
              measuredSize: finalSize,
              actualSize: actualSize,
              heightScale: heightScale,
              objectScale: object.scale,
              objectPosition: object.position,
            });

            // Remove the old instanced hitbox
            const oldHitbox = this.group.getObjectByName('instanced-hitbox');
            if (oldHitbox) {
              console.log('Removing old instanced hitbox');
              this.group.remove(oldHitbox);
            }

            // Create accurate hitbox based on actual scaled dimensions
            const hitboxGeometry = GeometryFactory.getInstance().getBox(
              actualSize.x * 1.1, // Slightly larger for easier targeting
              actualSize.y,
              actualSize.z * 1.1
            );
            const hitboxMaterial = MaterialCache.getInstance().getMeshBasicMaterial({
              visible: false,
              transparent: true,
              opacity: 0,
            });
            const hitbox = new THREE.Mesh(hitboxGeometry, hitboxMaterial);
            hitbox.position.y = actualSize.y / 2; // Center vertically with scaled height
            hitbox.userData.isHitbox = true;
            hitbox.userData.battery = this;
            hitbox.name = 'battery-hitbox-accurate';
            this.group.add(hitbox);

            console.log('Created accurate hitbox for instanced rendering:', {
              dimensions: {
                width: actualSize.x * 1.1,
                height: actualSize.y,
                depth: actualSize.z * 1.1,
              },
              position: hitbox.position,
            });
          }, 50); // Small delay to ensure scaling is applied

          // Don't add the visual model to the scene - instanced renderer handles that
          return;
        }

        // Wait for next frame to ensure model is fully loaded
        setTimeout(() => {
          // Create proper hitbox based on OBJ model dimensions
          const finalBox = new THREE.Box3().setFromObject(object);
          const finalSize = finalBox.getSize(new THREE.Vector3());
          const finalCenter = finalBox.getCenter(new THREE.Vector3());

          // Create hitbox that matches the OBJ model
          const hitboxGeometry = GeometryFactory.getInstance().getBox(
            finalSize.x * 1.2, // Slightly larger for easier targeting
            finalSize.y,
            finalSize.z * 1.2
          );
          const hitboxMaterial = MaterialCache.getInstance().getMeshBasicMaterial({
            visible: false,
            transparent: true,
            opacity: 0,
          });
          const hitbox = new THREE.Mesh(hitboxGeometry, hitboxMaterial);
          hitbox.position.copy(finalCenter);
          hitbox.position.y = finalSize.y / 2; // Center vertically
          hitbox.userData.isHitbox = true;
          hitbox.userData.battery = this; // Store reference to battery
          hitbox.name = 'battery-hitbox';
          this.group.add(hitbox);

          // Add the model to the group
          this.group.add(object);

          console.log('Battery OBJ loaded with dimensions:', {
            size: finalSize,
            center: finalCenter,
            hitboxPos: hitbox.position,
          });

          // Remove ALL old hitboxes
          const oldHitboxes = [];
          this.group.traverse(child => {
            if (child.userData.isHitbox && child !== hitbox) {
              oldHitboxes.push(child);
            }
          });

          oldHitboxes.forEach(oldHitbox => {
            console.log('Removing old hitbox:', oldHitbox.name);
            this.group.remove(oldHitbox);
            if (oldHitbox instanceof THREE.Mesh) {
              // Don't dispose geometry/material - they're from factories
            }
          });

          // Now recreate launcher tubes with proper model dimensions
          this.recreateLauncherTubes();
        }, 100); // Wait 100ms to ensure model is fully in scene

        // Log model info for debugging
        debug.asset('loading', 'battery', 'Model added to scene');
        debug.asset('loading', 'battery-bounds', {
          bounds: new THREE.Box3().setFromObject(object),
        });

        // Debug tube positions if in debug mode
        if ((window as any).__debugTubePositions) {
          this.debugTubePositions();
        }
      },
      xhr => {
        // Progress callback
        debug.asset('progress', 'battery', `${((xhr.loaded / xhr.total) * 100).toFixed(0)}%`);
      },
      error => {
        // Error callback - keep procedural model
        debug.error('Failed to load battery model:', error);
        debug.log('Using procedural model');
      }
    );
  }

  private optimizeOBJModel(object: THREE.Object3D): void {
    // Group geometries by material
    const materialMap = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const meshesToRemove: THREE.Mesh[] = [];

    // First pass: collect all geometries grouped by material
    object.traverse(child => {
      if (child instanceof THREE.Mesh && child.geometry) {
        const material = child.material as THREE.Material;
        const geo = child.geometry.clone();

        // Apply the child's world transform to the geometry
        child.updateWorldMatrix(true, false);
        geo.applyMatrix4(child.matrixWorld);

        if (!materialMap.has(material)) {
          materialMap.set(material, []);
        }
        materialMap.get(material)!.push(geo);
        meshesToRemove.push(child);
      }
    });

    debug.log(`Found ${materialMap.size} unique materials in OBJ model`);

    // Second pass: merge geometries by material
    let totalMeshes = 0;
    materialMap.forEach((geometries, material) => {
      if (geometries.length > 0) {
        try {
          // Merge all geometries with the same material
          const mergedGeometry = BufferGeometryUtils.mergeGeometries(geometries);

          // Create a single mesh for this material
          const mergedMesh = new THREE.Mesh(mergedGeometry, material.clone());
          mergedMesh.castShadow = true;
          mergedMesh.receiveShadow = true;
          object.add(mergedMesh);
          totalMeshes++;

          debug.log(`Merged ${geometries.length} geometries into 1 mesh`);
        } catch (error) {
          debug.error('Failed to merge geometries:', error);
        }

        // Clean up temporary geometries
        geometries.forEach(g => g.dispose());
      }
    });

    // Remove original meshes
    meshesToRemove.forEach(mesh => {
      if (mesh.parent) mesh.parent.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
    });

    debug.log(`OBJ model optimized: ${meshesToRemove.length} meshes -> ${totalMeshes} meshes`);
  }

  update(deltaTime: number = 0, threats: Threat[] = []): void {
    // Apply auto-repair if enabled and battery is damaged but not destroyed
    if (this.autoRepairRate > 0 && this.currentHealth < this.maxHealth && !this.isDestroyed) {
      const currentTime = Date.now();
      const repairDelta = (currentTime - this.lastRepairTime) / 1000; // Convert to seconds

      if (repairDelta > 0) {
        const repairAmount = this.autoRepairRate * repairDelta;
        this.repair(repairAmount);
        this.lastRepairTime = currentTime;
      }
    }

    // Update health bar to face camera and follow battery position
    if (this.healthBar && !this.isDestroyed) {
      const camera = (this.scene as any).__camera;
      if (camera) {
        // Update position in case battery moved
        this.healthBar.position.copy(this.config.position);
        this.healthBar.position.y = 25; // Position above battery

        // Look at camera but keep upright
        const cameraPos = camera.position.clone();
        cameraPos.y = this.healthBar.position.y;
        this.healthBar.lookAt(cameraPos);

        // Ensure visibility in game mode
        if (this.useResources && !this.healthBar.visible) {
          // Health bar was hidden, making visible
          this.healthBar.visible = true;
        }
      }
    }

    // Rotate radar dome (visual only)
    if (this.radarDome && deltaTime > 0) {
      this.radarDome.rotation.y += deltaTime * 0.5;
    }

    // Update launch effects
    this.launchEffects.update();

    // Skip reloading if battery is destroyed
    if (this.isDestroyed) return;

    // Ammo management: adjust reload time based on threat environment
    const reloadTimeMultiplier = this.calculateReloadMultiplier(threats);

    // Reload individual tubes and manage X markers
    const currentTime = Date.now();
    this.launcherTubes.forEach(tube => {
      if (!tube.isLoaded) {
        const adjustedReloadTime = this.config.reloadTime * reloadTimeMultiplier;
        const timeSinceFire = currentTime - tube.lastFiredTime;

        // Create X marker if tube just became empty and doesn't have one
        if (!tube.xMarker) {
          tube.xMarker = this.createXMarker(tube.direction);
          // Position X marker at the top (start) of the tube where interceptors launch from
          tube.xMarker.position.copy(tube.position);
          // Add X marker to the main group since launcherGroup might be hidden with instanced rendering
          this.group.add(tube.xMarker);
        }

        // Animate X marker (pulsing)
        if (tube.xMarker) {
          const pulse = Math.sin(currentTime * 0.005) * 0.1 + 1.0;
          tube.xMarker.scale.setScalar(pulse);
        }

        if (timeSinceFire >= adjustedReloadTime) {
          // Reload this tube
          tube.isLoaded = true;

          // Remove X marker
          if (tube.xMarker) {
            this.group.remove(tube.xMarker);
            tube.xMarker.traverse(child => {
              if (child instanceof THREE.Mesh) {
                // Don't dispose geometry - it's from GeometryFactory
                // Don't dispose material - it's from MaterialCache
              }
            });
            tube.xMarker = undefined;
          }

          this.createMissileInTube(tube, this.launcherGroup);
          debug.log(`Tube ${tube.index} reloaded after ${timeSinceFire}ms`);
        }
      }
    });
  }

  destroy(): void {
    this.isDestroyed = true;

    // Remove from scene
    this.scene.remove(this.group);
    this.scene.remove(this.rangeIndicator);

    // Properly dispose health bar
    if (this.healthBar) {
      this.healthBar.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          // Don't dispose materials - they're shared from MaterialCache
        }
      });
      this.scene.remove(this.healthBar);
      this.healthBar = undefined;
    }

    // Dispose geometries only - materials are shared from MaterialCache
    this.group.traverse(child => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        // Don't dispose materials - they're shared from MaterialCache
      }
    });

    // Clean up launcher tubes
    this.launcherTubes = [];
  }
}
