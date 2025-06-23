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
import { GeometryConfig } from '../config/GeometryConfig';
import { debug } from '../utils/DebugLogger';
import { ResourceManager } from '../game/ResourceManager';
import { MaterialCache } from '../utils/MaterialCache';
import { GeometryFactory } from '../utils/GeometryFactory';
import { EventEmitter } from 'events';
import { ExplosionManager, ExplosionType } from '../systems/ExplosionManager';
import { SoundSystem } from '../systems/SoundSystem';

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
      const hitboxGeometry = GeometryFactory.getInstance().getBox(22.5, 22.5, 22.5);
      const hitboxMaterial = MaterialCache.getInstance().getMeshBasicMaterial({
        visible: false,
        transparent: true,
        opacity: 0,
      });
      const hitbox = new THREE.Mesh(hitboxGeometry, hitboxMaterial);
      hitbox.position.y = 6;
      hitbox.userData.isHitbox = true;
      hitbox.userData.battery = this; // Store reference to battery
      this.group.add(hitbox);
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

  private createLauncher(): THREE.Group {
    const launcherGroup = new THREE.Group();

    // If using instanced rendering, create minimal launcher data without meshes
    if (this.useInstancedRendering) {
      // Create launcher tube data without visual meshes
      for (let i = 0; i < this.config.launcherCount; i++) {
        const launcherTube: LauncherTube = {
          index: i,
          mesh: new THREE.Mesh(), // Dummy mesh for compatibility
          isLoaded: true,
          lastFiredTime: 0,
        };
        this.launcherTubes.push(launcherTube);
      }
    } else {
      // Create full visual meshes for non-instanced rendering
      const tubeGeometry = GeometryFactory.getInstance().getCylinder(0.2, 0.2, 3);
      const tubeMaterial = MaterialCache.getInstance().getMeshStandardMaterial({
        color: 0x666666,
        roughness: 0.5,
        metalness: 0.7,
      });

      // Create launch tubes in a circular pattern
      for (let i = 0; i < this.config.launcherCount; i++) {
        const angle = (i / this.config.launcherCount) * Math.PI * 2;
        const tube = new THREE.Mesh(tubeGeometry, tubeMaterial);
        tube.position.x = Math.cos(angle) * 0.8;
        tube.position.z = Math.sin(angle) * 0.8;
        tube.position.y = 0;
        tube.rotation.z = Math.PI / 8; // Slightly angled outward
        tube.castShadow = true;
        launcherGroup.add(tube);

        // Create launcher tube data
        const launcherTube: LauncherTube = {
          index: i,
          mesh: tube,
          isLoaded: true,
          lastFiredTime: 0,
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

    launcherGroup.position.y = 2.5;
    this.group.add(launcherGroup);

    return launcherGroup;
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
    missile.position.copy(tube.mesh.position);
    missile.position.y += 0.5; // Position at top of tube
    missile.rotation.z = tube.mesh.rotation.z;
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
        debug.warn('No interceptors in stock!');
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
    });

    // Mark tube as reloading
    loadedTube.isLoaded = false;
    loadedTube.reloadStartTime = Date.now();
    this.activeInterceptors++;

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

    // Get launch position with offset
    const tubeWorldPos = this.config.position.clone();
    tubeWorldPos.add(this.launchOffset);

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

    // Blend calculated velocity with launch direction for more realistic launch
    // This ensures the missile initially follows the launcher's direction
    const launchSpeed = velocity.length();
    const launchVelocity = this.launchDirection.clone().multiplyScalar(launchSpeed);

    // Blend: 70% launch direction, 30% calculated direction for first moments
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
    });

    // Update tube state
    tube.isLoaded = false;
    tube.lastFiredTime = Date.now();

    // Remove visual missile from tube
    if (tube.missile) {
      this.launcherGroup.remove(tube.missile);
      tube.missile.geometry.dispose();
      (tube.missile.material as THREE.Material).dispose();
      tube.missile = undefined;
    }

    // Animate launcher
    this.animateLaunch(tube);

    return interceptor;
  }

  private animateLaunch(tube: LauncherTube): void {
    // Tube recoil animation
    const originalY = tube.mesh.position.y;
    const originalRotation = tube.mesh.rotation.z;
    tube.mesh.position.y -= 0.15;
    tube.mesh.rotation.z += 0.05; // Slight rotation from recoil

    setTimeout(() => {
      tube.mesh.position.y = originalY;
      tube.mesh.rotation.z = originalRotation;
    }, 300);

    // Get launch position and direction
    const tubeWorldPos = this.config.position.clone();
    tubeWorldPos.add(this.launchOffset);

    // Use configured launch direction
    const launchDirection = this.launchDirection.clone();

    // Create comprehensive launch effects
    this.launchEffects.createLaunchEffect(tubeWorldPos, launchDirection, {
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

  setResourceManagement(enabled: boolean): void {
    console.log(
      '[Battery] setResourceManagement called with:',
      enabled,
      'current useResources:',
      this.useResources
    );
    this.useResources = enabled;

    // In sandbox mode (resources disabled), also disable health system
    if (!enabled) {
      // Remove health bar if it exists
      if (this.healthBar) {
        this.healthBar.visible = false;
        console.log('[Battery] Health bar hidden (sandbox mode)');
      }
      // Reset health to max and prevent damage
      this.currentHealth = this.maxHealth;
      this.isDestroyed = false;
    } else {
      // Re-enable health bar
      if (!this.healthBar) {
        console.log("[Battery] Health bar doesn't exist, creating it");
        // Create health bar if it doesn't exist yet
        this.createHealthBar();
      }
      this.healthBar.visible = true;
      this.updateHealthBar(); // Update to show current health
      console.log('[Battery] Health bar enabled and updated, visible:', this.healthBar.visible);
    }
  }

  private createHealthBar(): void {
    console.log('[HealthBar] Creating health bar, useResources:', this.useResources);

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
    this.healthBar.add(healthFill);

    // Add to scene (not group) so it can rotate independently
    this.scene.add(this.healthBar);
    this.healthBar.position.copy(this.config.position);
    this.healthBar.position.y = 25; // Position above battery

    // Set initial visibility based on resource management mode
    this.healthBar.visible = this.useResources;
    console.log(
      '[HealthBar] Created at position:',
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
    // Skip loading OBJ model if using instanced rendering
    if (this.useInstancedRendering) {
      debug.log('Skipping OBJ model load for instanced rendering');
      return;
    }

    const loader = new OBJLoader();
    loader.load(
      '/assets/Battery.obj',
      object => {
        // Model loaded successfully
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

        // Check if model has valid size
        if (size.x === 0 || size.y === 0 || size.z === 0) {
          debug.error('Battery model has zero size!', size);
          return;
        }

        // If model is too small or too large, scale it
        const targetHeight = 4;
        let scaleFactor = 1;
        if (size.y < 0.1 || size.y > 100) {
          scaleFactor = targetHeight / size.y;
          object.scale.set(scaleFactor, scaleFactor, scaleFactor);
        }
        debug.asset('loading', 'battery-scale', { scaleFactor });

        // Center the model at origin
        box.setFromObject(object);
        const center = box.getCenter(new THREE.Vector3());
        const minY = box.min.y;
        object.position.set(-center.x, -minY, -center.z); // Place on ground
        debug.asset('loading', 'battery-position', { position: object.position });

        // Analyze model complexity before optimization
        const beforeStats = GeometryOptimizer.analyzeComplexity(object);
        debug.log('Battery model complexity BEFORE optimization:', beforeStats);

        // Optimize the model aggressively
        GeometryOptimizer.optimizeObject(object, {
          simplify: true, // Enable our basic simplification
          simplifyRatio: 0.1, // Keep only 10% of triangles
          mergeByMaterial: true, // This is the key optimization
          removeSmallDetails: true,
          smallDetailThreshold: 2.0, // Remove details smaller than 2.0 units
        });

        // Analyze after optimization
        const afterStats = GeometryOptimizer.analyzeComplexity(object);
        debug.log('Battery model complexity AFTER optimization:', afterStats);
        debug.log(
          `Triangle reduction: ${beforeStats.totalTriangles} -> ${afterStats.totalTriangles} (${Math.round((1 - afterStats.totalTriangles / beforeStats.totalTriangles) * 100)}% reduction)`
        );

        // Hide procedurally generated base components but keep launcher tubes
        this.group.children.forEach(child => {
          if (child.userData.isProcedural && child !== this.launcherGroup) {
            child.visible = false;
          }
        });

        // Position launcher group above the model
        this.launcherGroup.position.y = targetHeight;

        // Add the model to the group
        this.group.add(object);

        // Log model info for debugging
        debug.asset('loading', 'battery', 'Model added to scene');
        debug.asset('loading', 'battery-bounds', {
          bounds: new THREE.Box3().setFromObject(object),
        });
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
          console.log('[Battery] Health bar was hidden, making visible');
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

    // Reload individual tubes
    const currentTime = Date.now();
    this.launcherTubes.forEach(tube => {
      if (!tube.isLoaded) {
        const adjustedReloadTime = this.config.reloadTime * reloadTimeMultiplier;
        if (currentTime - tube.lastFiredTime >= adjustedReloadTime) {
          // Reload this tube
          tube.isLoaded = true;
          this.createMissileInTube(tube, this.launcherGroup);
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
