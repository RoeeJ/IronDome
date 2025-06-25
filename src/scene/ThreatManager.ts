import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { EventEmitter } from 'events';
import { Threat, ThreatType, THREAT_CONFIGS } from '../entities/Threat';
import { UnifiedTrajectorySystem as TrajectoryCalculator } from '../systems/UnifiedTrajectorySystem';
import { LaunchEffectsSystem } from '../systems/LaunchEffectsSystem';
import { IronDomeBattery } from '../entities/IronDomeBattery';
import { ExplosionManager, ExplosionType } from '../systems/ExplosionManager';
import { GeometryFactory } from '../utils/GeometryFactory';
import { MaterialCache } from '../utils/MaterialCache';
import { SoundSystem } from '../systems/SoundSystem';
import { 
  AttackIntensity, 
  AttackPattern, 
  AttackParameters,
  ScenarioPreset,
  AttackParameterConverter,
  ScenarioManager 
} from '../game/scenarios/AttackScenarios';
import { ThreatLauncherSystem, LauncherConfig, LauncherSite } from './ThreatLauncherSystem';

export interface ThreatSpawnConfig {
  type: ThreatType;
  spawnRadius: number;
  targetRadius: number;
  minInterval: number; // ms
  maxInterval: number; // ms
}

export class ThreatManager extends EventEmitter {
  private scene: THREE.Scene;
  private world: CANNON.World;
  private threats: Threat[] = [];
  private spawnConfigs: ThreatSpawnConfig[];
  private lastSpawnTime: number = 0;
  private nextSpawnTime: number = 0;
  private isSpawning: boolean = false;
  private impactMarkers: THREE.Mesh[] = [];
  private launchEffects: LaunchEffectsSystem;
  private batteries: IronDomeBattery[] = [];
  private salvoChance: number = 0.3; // Default 30% chance
  private explosionManager: ExplosionManager;
  private activeCraters: Map<
    string,
    {
      mesh: THREE.Mesh;
      position: THREE.Vector3;
      timeout: NodeJS.Timeout | null;
      animationId: number | null;
      material: THREE.Material;
    }
  > = new Map();
  private threatsToRemove: Set<Threat> = new Set(); // Queue for safe removal
  private readonly MAX_CRATERS = 15; // Limit active craters for performance
  
  // Scenario support
  private scenarioManager: ScenarioManager = new ScenarioManager();
  private currentAttackParameters: AttackParameters | null = null;
  private baseSpawnAngle: number = 0; // For pattern-based spawning
  
  // Launcher system for realistic volleys
  private launcherSystem: ThreatLauncherSystem;
  private launcherSiteVisuals: Map<string, THREE.Mesh> = new Map();

  constructor(scene: THREE.Scene, world: CANNON.World) {
    super();
    this.scene = scene;
    this.world = world;

    // Initialize launch effects system
    this.launchEffects = new LaunchEffectsSystem(scene);

    // Initialize explosion manager
    this.explosionManager = ExplosionManager.getInstance(scene);
    
    // Initialize launcher system
    this.launcherSystem = new ThreatLauncherSystem();
    this.createLauncherSiteVisuals();

    // Default spawn configurations with all threat types
    this.spawnConfigs = [
      // Original rockets
      {
        type: ThreatType.SHORT_RANGE,
        spawnRadius: 150,
        targetRadius: 40,
        minInterval: 3000,
        maxInterval: 8000,
      },
      {
        type: ThreatType.MEDIUM_RANGE,
        spawnRadius: 180,
        targetRadius: 60,
        minInterval: 5000,
        maxInterval: 15000,
      },
      // Mortars - frequent, close range
      {
        type: ThreatType.MORTAR,
        spawnRadius: 80,
        targetRadius: 20,
        minInterval: 2000,
        maxInterval: 5000,
      },
      // Drones - less frequent, varied approach
      {
        type: ThreatType.DRONE_SLOW,
        spawnRadius: 200,
        targetRadius: 30,
        minInterval: 10000,
        maxInterval: 20000,
      },
      {
        type: ThreatType.DRONE_FAST,
        spawnRadius: 250,
        targetRadius: 40,
        minInterval: 15000,
        maxInterval: 30000,
      },
      // Cruise missiles - rare, long range
      {
        type: ThreatType.CRUISE_MISSILE,
        spawnRadius: 300,
        targetRadius: 50,
        minInterval: 30000,
        maxInterval: 60000,
      },
      // Specific rocket variants
      {
        type: ThreatType.QASSAM_1,
        spawnRadius: 100,
        targetRadius: 30,
        minInterval: 4000,
        maxInterval: 8000,
      },
      {
        type: ThreatType.GRAD_ROCKET,
        spawnRadius: 150,
        targetRadius: 40,
        minInterval: 8000,
        maxInterval: 15000,
      },
    ];
  }

  startSpawning(): void {
    this.isSpawning = true;
    // Activate default launcher sites
    this.launcherSystem.activateDirection('north');
    this.launcherSystem.activateDirection('south');
  }

  stopSpawning(): void {
    this.isSpawning = false;
  }

  private scheduleNextSpawn(): void {
    if (this.spawnConfigs.length === 0) {
      // If no spawn configs available, schedule a check in 5 seconds
      this.nextSpawnTime = Date.now() + 5000;
      return;
    }

    // Use scenario parameters if active
    let interval: number;
    if (this.currentAttackParameters) {
      const intervals = AttackParameterConverter.getSpawnIntervals(this.currentAttackParameters.intensity);
      interval = intervals.min + Math.random() * (intervals.max - intervals.min);
    } else {
      const config = this.spawnConfigs[Math.floor(Math.random() * this.spawnConfigs.length)];
      interval = config.minInterval + Math.random() * (config.maxInterval - config.minInterval);
    }
    
    this.nextSpawnTime = Date.now() + interval;
  }

  update(): void {
    // Update launch effects
    this.launchEffects.update();

    // Update explosion manager
    this.explosionManager.update(1 / 60);

    // Update all threats
    for (let i = this.threats.length - 1; i >= 0; i--) {
      const threat = this.threats[i];
      if (!threat) {
        console.warn(`Undefined threat at index ${i}, skipping`);
        continue;
      }

      // Skip if threat is no longer active
      if (!threat.isActive) {
        this.threatsToRemove.add(threat);
        continue;
      }

      threat.update();

      // Check if threat has hit ground or reached target
      const threatConfig = THREAT_CONFIGS[threat.type];

      if (threatConfig.isDrone) {
        // For drones, dynamically target nearest operational battery
        const nearestBattery = this.findNearestOperationalBattery(threat.getPosition());
        if (nearestBattery) {
          // Update drone target to battery position
          threat.targetPosition = nearestBattery.getPosition().clone();

          // Adjust velocity to aim for battery
          const currentPos = threat.getPosition();
          const toTarget = new THREE.Vector3().subVectors(threat.targetPosition, currentPos);

          const horizontalDistance = Math.sqrt(toTarget.x * toTarget.x + toTarget.z * toTarget.z);
          const verticalDistance = toTarget.y;

          // If close to target horizontally, start descending
          if (horizontalDistance < 20) {
            // Spiral descent pattern
            const angle = (Date.now() / 1000) * 2; // 2 radians per second
            const radius = Math.max(5, horizontalDistance);

            const targetX = threat.targetPosition.x + Math.cos(angle) * radius;
            const targetZ = threat.targetPosition.z + Math.sin(angle) * radius;
            const targetY = Math.max(threat.targetPosition.y + 5, currentPos.y - 10); // Descend at 10m/s

            const newVelocity = new THREE.Vector3(
              targetX - currentPos.x,
              targetY - currentPos.y,
              targetZ - currentPos.z
            )
              .normalize()
              .multiplyScalar(threatConfig.velocity * 0.7); // Slower during descent

            threat.body.velocity.set(newVelocity.x, newVelocity.y, newVelocity.z);
          } else {
            // Normal flight toward target
            toTarget.normalize();
            const newVelocity = toTarget.multiplyScalar(threatConfig.velocity);
            threat.body.velocity.set(newVelocity.x, 0, newVelocity.z); // Keep altitude constant during approach
          }
        }

        const distanceToTarget = threat.getPosition().distanceTo(threat.targetPosition);
        const timeSinceLaunch = (Date.now() - threat.launchTime) / 1000;

        // Check if drone is close to any battery
        const closestBattery = this.batteries.reduce(
          (closest, battery) => {
            if (!battery.isOperational()) return closest;
            const dist = threat.getPosition().distanceTo(battery.getPosition());
            const closestDist = closest
              ? threat.getPosition().distanceTo(closest.getPosition())
              : Infinity;
            return dist < closestDist ? battery : closest;
          },
          null as IronDomeBattery | null
        );

        const distanceToBattery = closestBattery
          ? threat.getPosition().distanceTo(closestBattery.getPosition())
          : Infinity;

        // Check if drone should explode
        const shouldExplode =
          distanceToBattery < 10 || // Within damage distance of battery
          distanceToTarget < 5 || // Close enough to original target
          threat.getPosition().y <= 1 || // Hit ground
          timeSinceLaunch > 60; // Timeout after 60 seconds

        if (shouldExplode) {
          // Check for battery hit (within explosion radius)
          const explosionRadius = 10; // Drone explosion affects 10m radius
          const nearbyBatteries = this.batteries.filter(
            battery =>
              battery.isOperational() &&
              battery.getPosition().distanceTo(threat.getPosition()) <= explosionRadius
          );

          // Damage all batteries in explosion radius
          nearbyBatteries.forEach(battery => {
            const distance = battery.getPosition().distanceTo(threat.getPosition());
            const damageFalloff = 1 - distance / explosionRadius; // More damage closer to explosion
            const baseDamage = this.getThreatDamage(threat.type);
            const actualDamage = Math.ceil(baseDamage * damageFalloff);

            battery.takeDamage(actualDamage);
            this.emit('batteryHit', { battery, damage: actualDamage });
            console.log(
              `Drone explosion damaged battery at ${distance.toFixed(1)}m for ${actualDamage} damage`
            );
          });

          // Create explosion (in air if still flying)
          if (threat.getPosition().y > 5) {
            this.explosionManager.createExplosion({
              type: ExplosionType.DRONE_DESTRUCTION,
              position: threat.getPosition(),
              radius: 10,
            });
          } else {
            this.explosionManager.createExplosion({
              type: ExplosionType.GROUND_IMPACT,
              position: threat.getPosition(),
              radius: 15,
            });
          }

          // Add to removal queue instead of removing immediately
          this.threatsToRemove.add(threat);
        }
      } else {
        // For other threats, check ground impact
        if (threat.body.position.y <= 0.5 && threat.isActive) {
          // Check if hit a battery or building
          const impactPosition = threat.getPosition();
          const hitBattery = this.checkBatteryHit(impactPosition);

          if (hitBattery) {
            // Deal damage to battery
            const damageAmount = this.getThreatDamage(threat.type);
            hitBattery.takeDamage(damageAmount);
            this.emit('batteryHit', { battery: hitBattery, damage: damageAmount });
          } else {
            // Check if hit a building
            const buildingSystem = (window as any).__buildingSystem;
            if (buildingSystem) {
              const hitBuilding = buildingSystem.getBuildingAt(impactPosition, 15);
              if (hitBuilding) {
                const damageAmount = this.getThreatDamage(threat.type);
                buildingSystem.damageBuilding(hitBuilding.id, damageAmount);
                console.log(`Threat hit building ${hitBuilding.id} for ${damageAmount} damage`);
              }
            }
          }

          // Check for shockwave damage to nearby batteries
          const shockwaveRadius = this.getShockwaveRadius(threat.type);
          const nearbyBatteries = this.batteries.filter(battery => {
            const distance = battery.getPosition().distanceTo(impactPosition);
            return battery.isOperational() && distance <= shockwaveRadius && battery !== hitBattery;
          });

          // Apply shockwave damage with falloff
          nearbyBatteries.forEach(battery => {
            const distance = battery.getPosition().distanceTo(impactPosition);
            const damageFalloff = 1 - distance / shockwaveRadius;
            const baseDamage = this.getThreatDamage(threat.type);
            const shockwaveDamage = Math.ceil(baseDamage * 0.5 * damageFalloff); // 50% of base damage for shockwave

            if (shockwaveDamage > 0) {
              battery.takeDamage(shockwaveDamage);
              this.emit('batteryHit', { battery, damage: shockwaveDamage, isShockwave: true });
              debug.category(
                'Combat',
                `Shockwave damaged battery at ${distance.toFixed(1)}m for ${shockwaveDamage} damage`
              );
            }
          });

          // Create explosion at impact point
          this.explosionManager.createExplosion({
            type: ExplosionType.GROUND_IMPACT,
            position: impactPosition,
            radius: 15,
          });

          // Create crater decal at impact point
          this.createCraterDecal(impactPosition);

          // Play ground impact sound
          SoundSystem.getInstance().playExplosion('ground', impactPosition);
          // Add to removal queue instead of removing immediately
          this.threatsToRemove.add(threat);
        } else if (threat.body.position.y < -5) {
          // Remove if somehow went too far below ground
          // Add to removal queue instead of removing immediately
          this.threatsToRemove.add(threat);
        }
      }
    }

    // Spawn new threats using launcher system
    if (this.isSpawning) {
      this.checkAndFireLaunchers();
    }

    // Update impact markers
    this.updateImpactMarkers();
    
    // Update launcher site visuals
    this.updateLauncherSiteVisuals();

    // Process removal queue - safe to do after main update loop
    if (this.threatsToRemove.size > 0) {
      // Convert to array and sort by index (descending) to avoid index shift issues
      const threatsToRemoveArray = Array.from(this.threatsToRemove);
      const removalData: Array<{ threat: Threat; index: number }> = [];

      for (const threat of threatsToRemoveArray) {
        const index = this.threats.indexOf(threat);
        if (index !== -1) {
          removalData.push({ threat, index });
        }
      }

      // Sort by index descending to remove from end first
      removalData.sort((a, b) => b.index - a.index);

      // Now remove them safely
      for (const data of removalData) {
        // Check if this was an interception (threat was marked but not at ground level)
        const wasIntercepted = data.threat.isActive && data.threat.getPosition().y > 5;
        this.removeThreat(data.index, wasIntercepted);
      }

      this.threatsToRemove.clear();
    }
  }

  private checkAndFireLaunchers(): void {
    const currentTime = Date.now();
    const readyLaunchers = this.launcherSystem.getReadyLaunchers(currentTime);
    
    readyLaunchers.forEach(({ launcher, site }) => {
      this.fireVolleyFromLauncher(launcher, site);
    });
  }
  
  private fireVolleyFromLauncher(launcher: LauncherConfig, site: LauncherSite): void {
    // Determine volley size
    const volleySize = launcher.volleySize.min + 
      Math.floor(Math.random() * (launcher.volleySize.max - launcher.volleySize.min + 1));
    
    // Fire the volley with staggered timing
    for (let i = 0; i < volleySize; i++) {
      setTimeout(() => {
        this.spawnThreatFromLauncher(launcher, site);
      }, i * launcher.volleyDelay);
    }
  }
  
  private spawnThreatFromLauncher(launcher: LauncherConfig, site: LauncherSite): void {
    // Performance limit
    if (this.threats.length > 50) return;
    
    const spawnPosition = launcher.position.clone();
    spawnPosition.y = 5; // Ground level launch
    
    // Select target - prefer operational batteries
    let targetPosition: THREE.Vector3;
    const operationalBatteries = this.batteries.filter(b => b.isOperational());
    
    if (operationalBatteries.length > 0) {
      const targetBattery = operationalBatteries[Math.floor(Math.random() * operationalBatteries.length)];
      targetPosition = targetBattery.getPosition().clone();
      
      // Add spread
      const spreadAngle = Math.random() * Math.PI * 2;
      const spreadDistance = Math.random() * launcher.spread;
      targetPosition.x += Math.cos(spreadAngle) * spreadDistance;
      targetPosition.z += Math.sin(spreadAngle) * spreadDistance;
      targetPosition.y = 0;
    } else {
      // Target city center with spread
      targetPosition = new THREE.Vector3(
        (Math.random() - 0.5) * 100,
        0,
        (Math.random() - 0.5) * 100
      );
    }
    
    // Get threat configuration
    const threatStats = THREAT_CONFIGS[launcher.type];
    
    // Calculate launch parameters based on threat type
    let velocity: THREE.Vector3;
    
    if (threatStats.isMortar) {
      // Mortars use high angle
      const distance = spawnPosition.distanceTo(targetPosition);
      const mortarAngle = 80 + Math.random() * 5; // 80-85 degrees
      const angleRad = (mortarAngle * Math.PI) / 180;
      
      const g = 9.82;
      const mortarVelocity = Math.sqrt((distance * g) / Math.sin(2 * angleRad));
      
      const launchParams = {
        angle: mortarAngle,
        azimuth: Math.atan2(
          targetPosition.z - spawnPosition.z,
          targetPosition.x - spawnPosition.x
        ),
        velocity: Math.min(mortarVelocity, threatStats.velocity),
      };
      velocity = TrajectoryCalculator.getVelocityVector(launchParams);
    } else {
      // Regular rockets - calculate launch parameters
      const launchParams = TrajectoryCalculator.calculateLaunchParameters(
        spawnPosition,
        targetPosition,
        threatStats.velocity
      );
      
      if (launchParams) {
        // Force high angle for ballistic trajectory
        const minAngle = 65;
        const maxAngle = 80;
        launchParams.angle = minAngle + Math.random() * (maxAngle - minAngle);
        
        // Recalculate velocity for the high angle
        const distance = spawnPosition.distanceTo(targetPosition);
        const angleRad = (launchParams.angle * Math.PI) / 180;
        const g = 9.82;
        const requiredVelocity = Math.sqrt((distance * g) / Math.sin(2 * angleRad));
        
        // Use calculated velocity if reasonable
        if (requiredVelocity < threatStats.velocity * 1.5) {
          launchParams.velocity = requiredVelocity;
        }
        
        velocity = TrajectoryCalculator.getVelocityVector(launchParams);
      } else {
        // Fallback if calculation fails
        const direction = targetPosition.clone().sub(spawnPosition).normalize();
        velocity = direction.multiplyScalar(threatStats.velocity);
      }
    }
    
    // Create the threat
    const threat = new Threat(this.scene, this.world, {
      type: launcher.type,
      position: spawnPosition,
      velocity,
      targetPosition,
    });
    this.threats.push(threat);
    
    // Play launch sound - check if it's a valid threat type for sound
    if (Object.values(ThreatType).includes(launcher.type)) {
      SoundSystem.getInstance().playLaunch(launcher.type, spawnPosition);
    }
    
    // Create launch effects
    this.launchEffects.createLaunchEffect(spawnPosition, velocity.clone().normalize());
    
    // Calculate and show impact prediction
    const trajectory = TrajectoryCalculator.predictTrajectory(
      threat.body.position.clone(),
      threat.body.velocity.clone()
    );
    
    if (trajectory.length > 0) {
      const impactPoint = trajectory[trajectory.length - 1];
      if (Math.abs(impactPoint.y) < 1) {
        this.addImpactMarker(impactPoint);
      }
    }
    
    // Emit threat spawned event
    this.emit('threatSpawned', threat);
  }
  
  private spawnThreat(): void {
    // Performance limit: Skip spawning if too many active threats
    if (this.threats.length > 50) {
      return;
    }

    // Chance to spawn multiple threats simultaneously (salvo)
    let isSalvo = Math.random() < this.salvoChance;
    let salvoSize = 1;
    
    if (this.currentAttackParameters) {
      // Use scenario-based salvo configuration
      const salvoConfig = AttackParameterConverter.getSalvoConfig(this.currentAttackParameters.intensity);
      isSalvo = Math.random() < salvoConfig.chance;
      if (isSalvo) {
        salvoSize = salvoConfig.minSize + 
          Math.floor(Math.random() * (salvoConfig.maxSize - salvoConfig.minSize + 1));
      }
    } else {
      // Default salvo behavior
      salvoSize = isSalvo ? 2 + Math.floor(Math.random() * 4) : 1; // 2-5 threats in salvo
    }

    for (let i = 0; i < salvoSize; i++) {
      this.spawnSingleThreat(i * 0.3); // Slight delay between salvo launches
    }
  }

  private spawnSingleThreat(delay: number = 0): void {
    setTimeout(() => {
      const config = this.spawnConfigs[Math.floor(Math.random() * this.spawnConfigs.length)];

      // Use patterned spawn position if scenario is active
      let spawnPosition: THREE.Vector3;
      if (this.currentAttackParameters) {
        spawnPosition = this.getPatternedSpawnPosition(config.spawnRadius);
      } else {
        // Default random spawn
        const spawnAngle = Math.random() * Math.PI * 2;
        const spawnX = Math.cos(spawnAngle) * config.spawnRadius;
        const spawnZ = Math.sin(spawnAngle) * config.spawnRadius;
        spawnPosition = new THREE.Vector3(spawnX, 5, spawnZ);
      }
      
      // Adjust height based on threat type
      const threatStats = THREAT_CONFIGS[config.type];
      if (threatStats.isDrone) {
        spawnPosition.y = 50; // Drones launch from higher altitude
      } else if (config.type === ThreatType.CRUISE_MISSILE) {
        spawnPosition.y = 30; // Cruise missiles launch from medium height
      } else {
        spawnPosition.y = 5; // Ground launch
      }

      // Target an active battery if any exist, otherwise random position
      let targetPosition: THREE.Vector3;
      const operationalBatteries = this.batteries.filter(b => b.isOperational());

      if (operationalBatteries.length > 0) {
        // Pick a random operational battery as target
        const targetBattery =
          operationalBatteries[Math.floor(Math.random() * operationalBatteries.length)];
        targetPosition = targetBattery.getPosition().clone();

        // Add some spread around the battery
        const spread = 10 + Math.random() * 20;
        const spreadAngle = Math.random() * Math.PI * 2;
        targetPosition.x += Math.cos(spreadAngle) * spread;
        targetPosition.z += Math.sin(spreadAngle) * spread;
        targetPosition.y = 0;
      } else {
        // Fallback to random target
        const targetAngle = Math.random() * Math.PI * 2;
        const targetDistance = Math.random() * config.targetRadius;
        const targetX = Math.cos(targetAngle) * targetDistance;
        const targetZ = Math.sin(targetAngle) * targetDistance;
        targetPosition = new THREE.Vector3(targetX, 0, targetZ);
      }

      // Get threat configuration - already declared above

      // Calculate launch parameters based on threat type
      let launchParams: any;
      let velocity: THREE.Vector3;

      if (threatStats.isDrone) {
        // Drones launch horizontally towards target
        const direction = new THREE.Vector3().subVectors(targetPosition, spawnPosition).normalize();

        // Start at higher altitude for drones
        spawnPosition.y = threatStats.cruiseAltitude || 100;

        velocity = direction.multiplyScalar(threatStats.velocity);
      } else if (threatStats.isMortar) {
        // Mortars use very high angle
        const distance = spawnPosition.distanceTo(targetPosition);
        const mortarAngle = 80 + Math.random() * 5; // 80-85 degrees
        const angleRad = (mortarAngle * Math.PI) / 180;

        // Calculate velocity for mortar trajectory
        const g = 9.82;
        const mortarVelocity = Math.sqrt((distance * g) / Math.sin(2 * angleRad));

        launchParams = {
          angle: mortarAngle,
          azimuth: Math.atan2(
            targetPosition.z - spawnPosition.z,
            targetPosition.x - spawnPosition.x
          ),
          velocity: Math.min(mortarVelocity, threatStats.velocity),
        };
        velocity = TrajectoryCalculator.getVelocityVector(launchParams);
      } else if (config.type === ThreatType.CRUISE_MISSILE) {
        // Cruise missiles launch at low angle
        const direction = new THREE.Vector3().subVectors(targetPosition, spawnPosition).normalize();

        // Launch at slight upward angle
        direction.y = 0.2;
        direction.normalize();

        velocity = direction.multiplyScalar(threatStats.velocity);
      } else {
        // Regular rockets - use existing ballistic calculation
        const threatConfig = {
          [ThreatType.SHORT_RANGE]: { velocity: 200, minAngle: 60, maxAngle: 75 },
          [ThreatType.MEDIUM_RANGE]: { velocity: 400, minAngle: 70, maxAngle: 80 },
          [ThreatType.LONG_RANGE]: { velocity: 600, minAngle: 75, maxAngle: 85 },
          [ThreatType.QASSAM_1]: { velocity: 200, minAngle: 65, maxAngle: 75 },
          [ThreatType.QASSAM_2]: { velocity: 280, minAngle: 65, maxAngle: 75 },
          [ThreatType.QASSAM_3]: { velocity: 350, minAngle: 65, maxAngle: 75 },
          [ThreatType.GRAD_ROCKET]: { velocity: 450, minAngle: 70, maxAngle: 80 },
        }[config.type] || { velocity: threatStats.velocity, minAngle: 65, maxAngle: 80 };

        // For ballistic missiles, we want high angle launches (60-85 degrees)
        launchParams = TrajectoryCalculator.calculateLaunchParameters(
          spawnPosition,
          targetPosition,
          threatConfig.velocity
        );

        if (!launchParams) return; // Target out of range

        // Force high angle for ballistic trajectory
        launchParams.angle =
          threatConfig.minAngle + Math.random() * (threatConfig.maxAngle - threatConfig.minAngle);

        // Recalculate velocity to hit target with the high angle
        const distance = spawnPosition.distanceTo(targetPosition);
        const angleRad = (launchParams.angle * Math.PI) / 180;
        const g = 9.82;

        // Calculate required velocity for the given angle
        const requiredVelocity = Math.sqrt((distance * g) / Math.sin(2 * angleRad));

        // Use the calculated velocity if it's reasonable
        if (requiredVelocity < threatConfig.velocity * 1.5) {
          launchParams.velocity = requiredVelocity;
        }

        velocity = TrajectoryCalculator.getVelocityVector(launchParams);
      }

      const threat = new Threat(this.scene, this.world, {
        type: config.type,
        position: spawnPosition,
        velocity,
        targetPosition,
      });

      this.threats.push(threat);
      this.addImpactMarker(threat);

      // Play threat incoming sound
      if (config.type === ThreatType.BALLISTIC_MISSILE) {
        SoundSystem.getInstance().playAlert('critical');
      }

      // Create launch effects for the threat
      const launchDirection = velocity.clone().normalize();
      this.launchEffects.createLaunchEffect(spawnPosition, launchDirection, {
        smokeCloudSize: 10,
        smokeDuration: 3500,
        flashIntensity: 12,
        flashDuration: 250,
        dustRadius: 3, // Reduced for more realistic size
        scorchMarkRadius: 4,
      });
    }, delay * 1000);
  }

  private removeThreat(index: number, wasIntercepted: boolean = false): void {
    // Safety check to ensure threat exists
    if (index < 0 || index >= this.threats.length) {
      console.warn(`Attempted to remove threat at invalid index ${index}`);
      return;
    }

    const threat = this.threats[index];
    if (!threat) {
      console.warn(`Threat at index ${index} is undefined`);
      return;
    }

    // Safely destroy the threat
    try {
      if (threat.destroy && typeof threat.destroy === 'function') {
        threat.destroy(this.scene, this.world);
      }
    } catch (error) {
      console.error(`Error destroying threat at index ${index}:`, error);
    }

    this.threats.splice(index, 1);

    // Emit event based on whether it was intercepted or missed
    if (wasIntercepted) {
      this.emit('threatDestroyed', { threat });
    } else {
      this.emit('threatMissed', { threat });
    }
  }

  private addImpactMarker(threat: Threat): void {
    const impactPoint = threat.getImpactPoint();
    if (!impactPoint) return;

    // Create impact marker
    const geometry = GeometryFactory.getInstance().getRing(2, 3, 32);
    const material = MaterialCache.getInstance().getMeshBasicMaterial({
      color: 0xff0000,
      opacity: 0.5,
      transparent: true,
      side: THREE.DoubleSide,
    });

    const marker = new THREE.Mesh(geometry, material);
    marker.rotation.x = -Math.PI / 2;
    marker.position.copy(impactPoint);
    marker.position.y = 0.1;
    marker.userData = { threat, createdAt: Date.now() };

    this.scene.add(marker);
    this.impactMarkers.push(marker);
  }

  private updateImpactMarkers(): void {
    const now = Date.now();

    for (let i = this.impactMarkers.length - 1; i >= 0; i--) {
      const marker = this.impactMarkers[i];
      const threat = marker.userData.threat as Threat;

      // Remove marker if threat is destroyed or impact time passed
      if (!threat.isActive || threat.getTimeToImpact() < 0) {
        this.scene.remove(marker);
        // Don't dispose geometry and material - they're shared from caches
        this.impactMarkers.splice(i, 1);
        continue;
      }

      // Pulse effect
      const timeToImpact = threat.getTimeToImpact();
      const pulseSpeed = Math.min(10, 1 / (timeToImpact + 0.1));
      const scale = 1 + 0.2 * Math.sin(now * 0.001 * pulseSpeed);
      marker.scale.set(scale, scale, scale);

      // Update opacity based on time to impact
      const material = marker.material as THREE.MeshBasicMaterial;
      material.opacity = Math.min(0.8, 0.3 + 0.5 * (1 - timeToImpact / 10));
    }
  }

  getActiveThreats(): Threat[] {
    return this.threats.filter(t => t.isActive);
  }

  getCraterStats(): { count: number; ids: string[] } {
    return {
      count: this.activeCraters.size,
      ids: Array.from(this.activeCraters.keys()),
    };
  }

  getLaunchEffectsSystem(): LaunchEffectsSystem {
    return this.launchEffects;
  }

  clearAll(): void {
    // Remove all threats
    while (this.threats.length > 0) {
      const threat = this.threats[0];
      threat.destroy(this.scene, this.world);
      this.threats.splice(0, 1);
      // Don't emit events when clearing all
    }

    // Remove all impact markers
    this.impactMarkers.forEach(marker => {
      this.scene.remove(marker);
      // Don't dispose geometry and material - they're shared from caches
    });
    this.impactMarkers = [];

    // Clean up all active craters
    for (const [id, craterData] of this.activeCraters) {
      // Clear the timeout
      if (craterData.timeout) {
        clearTimeout(craterData.timeout);
      }
      // Cancel animation frame
      if (craterData.animationId) {
        cancelAnimationFrame(craterData.animationId);
      }
      // Remove the mesh
      this.scene.remove(craterData.mesh);
      // Dispose the cloned material
      if (craterData.material) {
        craterData.material.dispose();
      }
    }
    this.activeCraters.clear();
  }

  registerBattery(battery: IronDomeBattery): void {
    if (!this.batteries.includes(battery)) {
      this.batteries.push(battery);
    }
  }

  unregisterBattery(battery: IronDomeBattery): void {
    const index = this.batteries.indexOf(battery);
    if (index !== -1) {
      this.batteries.splice(index, 1);
    }
  }

  private checkBatteryHit(impactPosition: THREE.Vector3): IronDomeBattery | null {
    const hitRadius = 15; // Radius within which a battery takes damage

    for (const battery of this.batteries) {
      if (battery.isOperational()) {
        const distance = impactPosition.distanceTo(battery.getPosition());
        if (distance <= hitRadius) {
          return battery;
        }
      }
    }

    return null;
  }

  private getThreatDamage(type: ThreatType): number {
    // Different threat types deal different damage
    switch (type) {
      case ThreatType.GRAD_ROCKET:
        return 15;
      case ThreatType.QASSAM_1:
        return 10;
      case ThreatType.QASSAM_2:
        return 15;
      case ThreatType.QASSAM_3:
        return 20;
      case ThreatType.MORTAR:
        return 10;
      case ThreatType.SHORT_RANGE:
        return 15;
      case ThreatType.MEDIUM_RANGE:
        return 20;
      case ThreatType.LONG_RANGE:
        return 25;
      case ThreatType.DRONE_SLOW:
        return 20;
      case ThreatType.DRONE_FAST:
        return 30;
      case ThreatType.CRUISE_MISSILE:
        return 40;
      case ThreatType.BALLISTIC_MISSILE:
        return 50;
      default:
        return 20;
    }
  }

  private getShockwaveRadius(type: ThreatType): number {
    // Different threat types have different shockwave radii
    switch (type) {
      case ThreatType.MORTAR:
        return 15; // Small shockwave
      case ThreatType.SHORT_RANGE:
      case ThreatType.QASSAM_1:
      case ThreatType.QASSAM_2:
        return 20;
      case ThreatType.MEDIUM_RANGE:
      case ThreatType.QASSAM_3:
      case ThreatType.GRAD_ROCKET:
        return 25;
      case ThreatType.LONG_RANGE:
        return 30;
      case ThreatType.DRONE_SLOW:
        return 20;
      case ThreatType.DRONE_FAST:
        return 25;
      case ThreatType.CRUISE_MISSILE:
        return 35;
      case ThreatType.BALLISTIC_MISSILE:
        return 40; // Large shockwave
      default:
        return 20;
    }
  }

  private findNearestOperationalBattery(position: THREE.Vector3): IronDomeBattery | null {
    let nearestBattery: IronDomeBattery | null = null;
    let minDistance = Infinity;

    for (const battery of this.batteries) {
      if (battery.isOperational()) {
        const distance = position.distanceTo(battery.getPosition());
        if (distance < minDistance) {
          minDistance = distance;
          nearestBattery = battery;
        }
      }
    }

    return nearestBattery;
  }

  // Called when a threat is intercepted by defense system
  markThreatIntercepted(threat: Threat): void {
    // Add to removal queue instead of removing immediately
    this.threatsToRemove.add(threat);
  }

  private removeCrater(craterId: string): void {
    const craterData = this.activeCraters.get(craterId);
    if (!craterData) {
      return;
    }

    // Remove from map first
    this.activeCraters.delete(craterId);

    // Clear timeout if still pending
    if (craterData.timeout) {
      clearTimeout(craterData.timeout);
    }

    // Cancel animation frame
    if (craterData.animationId) {
      cancelAnimationFrame(craterData.animationId);
    }

    // Remove from scene
    if (craterData.mesh && craterData.mesh.parent) {
      this.scene.remove(craterData.mesh);
    }

    // Dispose material
    if (craterData.material) {
      craterData.material.dispose();
    }

    console.log(`Removed crater ${craterId}. Active craters: ${this.activeCraters.size}`);
  }

  // Methods removed - now using ExplosionManager

  createCraterDecal(position: THREE.Vector3): void {
    // Limit total number of craters
    if (this.activeCraters.size >= this.MAX_CRATERS) {
      console.log(`Skipping crater creation - max craters (${this.MAX_CRATERS}) reached`);
      return;
    }

    // Check for existing craters nearby
    const minDistance = 8; // Increased minimum distance between craters
    for (const [id, craterData] of this.activeCraters) {
      const distance = craterData.position.distanceTo(position);
      if (distance < minDistance) {
        // Too close to existing crater, skip creating a new one
        return;
      }
    }

    // Add crater decal (simple dark circle on ground)
    const craterGeometry = GeometryFactory.getInstance().getCircle(3, 32);
    // Clone material to avoid affecting other craters
    const baseMaterial = MaterialCache.getInstance().getMeshBasicMaterial({
      color: 0x222222,
      opacity: 0.7,
      transparent: true,
    });
    const craterMaterial = baseMaterial.clone();

    const crater = new THREE.Mesh(craterGeometry, craterMaterial);
    crater.rotation.x = -Math.PI / 2;
    crater.position.copy(position);
    crater.position.y = 0.02 + Math.random() * 0.02; // Higher offset to prevent Z-fighting with shockwaves
    this.scene.add(crater);

    // Create unique ID for this crater
    const craterId = `crater_${Date.now()}_${Math.random()}`;

    // Store crater data
    const craterData = {
      mesh: crater,
      position: position.clone(),
      timeout: null as NodeJS.Timeout | null,
      animationId: null as number | null,
      material: craterMaterial,
    };
    this.activeCraters.set(craterId, craterData);

    // Add debug log
    console.log(
      `Created crater ${craterId} at ${position.x.toFixed(1)}, ${position.z.toFixed(1)}. Active craters: ${this.activeCraters.size}`
    );

    // Fade out crater over time
    const fadeDelay = setTimeout(() => {
      console.log(`Starting fade for crater ${craterId}`);
      const fadeStart = Date.now();
      const fadeDuration = 5000;

      const fadeCrater = () => {
        // Check if crater was already removed
        const currentCraterData = this.activeCraters.get(craterId);
        if (!currentCraterData) {
          console.log(`Crater ${craterId} already removed, stopping fade`);
          return;
        }

        const elapsed = Date.now() - fadeStart;
        const progress = elapsed / fadeDuration;

        if (progress >= 1) {
          console.log(`Crater ${craterId} fade complete, removing`);
          // Remove crater
          this.removeCrater(craterId);
          return;
        }

        // Update opacity
        if (currentCraterData.material) {
          const newOpacity = 0.7 * (1 - progress);
          (currentCraterData.material as any).opacity = newOpacity;

          // Log progress every second
          if (Math.floor(elapsed / 1000) !== Math.floor((elapsed - 16) / 1000)) {
            console.log(
              `Crater ${craterId} fade progress: ${(progress * 100).toFixed(1)}%, opacity: ${newOpacity.toFixed(2)}`
            );
          }
        }

        // Store animation ID for cancellation
        currentCraterData.animationId = requestAnimationFrame(fadeCrater);
      };

      fadeCrater();
    }, 3000);

    // Store the timeout so we can clear it if needed
    craterData.timeout = fadeDelay;
  }

  // Air explosion method removed - now using ExplosionManager

  private createDroneDebris(position: THREE.Vector3): void {
    // Use debris system if available
    const debrisSystem = (window as any).__debrisSystem;
    if (debrisSystem) {
      debrisSystem.createDebris(
        position,
        new THREE.Vector3(0, -5, 0), // Falling down
        5,
        {
          sizeRange: [0.3, 0.6],
          velocitySpread: 5,
          lifetimeRange: [3, 5],
          explosive: false,
        }
      );
    }
  }

  // Control which threat types to spawn
  setThreatMix(threatTypes: 'rockets' | 'mixed' | 'drones' | 'mortars' | 'all'): void {
    // Store all configs for filtering - spawn from map edges
    const allConfigs = [
      {
        type: ThreatType.SHORT_RANGE,
        spawnRadius: 800,
        targetRadius: 100,
        minInterval: 3000,
        maxInterval: 8000,
      },
      {
        type: ThreatType.MEDIUM_RANGE,
        spawnRadius: 900,
        targetRadius: 150,
        minInterval: 5000,
        maxInterval: 15000,
      },
      {
        type: ThreatType.MORTAR,
        spawnRadius: 300,
        targetRadius: 50,
        minInterval: 2000,
        maxInterval: 5000,
      }, // Mortars still closer
      {
        type: ThreatType.DRONE_SLOW,
        spawnRadius: 850,
        targetRadius: 100,
        minInterval: 10000,
        maxInterval: 20000,
      },
      {
        type: ThreatType.DRONE_FAST,
        spawnRadius: 900,
        targetRadius: 120,
        minInterval: 15000,
        maxInterval: 30000,
      },
      {
        type: ThreatType.CRUISE_MISSILE,
        spawnRadius: 950,
        targetRadius: 150,
        minInterval: 30000,
        maxInterval: 60000,
      },
      {
        type: ThreatType.QASSAM_1,
        spawnRadius: 700,
        targetRadius: 80,
        minInterval: 4000,
        maxInterval: 8000,
      },
      {
        type: ThreatType.GRAD_ROCKET,
        spawnRadius: 850,
        targetRadius: 100,
        minInterval: 8000,
        maxInterval: 15000,
      },
    ];

    switch (threatTypes) {
      case 'rockets':
        this.spawnConfigs = allConfigs.filter(config =>
          [
            ThreatType.SHORT_RANGE,
            ThreatType.MEDIUM_RANGE,
            ThreatType.LONG_RANGE,
            ThreatType.QASSAM_1,
            ThreatType.QASSAM_2,
            ThreatType.QASSAM_3,
            ThreatType.GRAD_ROCKET,
          ].includes(config.type)
        );
        break;
      case 'drones':
        this.spawnConfigs = allConfigs.filter(config =>
          [ThreatType.DRONE_SLOW, ThreatType.DRONE_FAST].includes(config.type)
        );
        break;
      case 'mortars':
        this.spawnConfigs = allConfigs.filter(config => config.type === ThreatType.MORTAR);
        break;
      case 'mixed':
        // Keep a balanced mix
        this.spawnConfigs = [
          {
            type: ThreatType.SHORT_RANGE,
            spawnRadius: 800,
            targetRadius: 100,
            minInterval: 3000,
            maxInterval: 8000,
          },
          {
            type: ThreatType.MORTAR,
            spawnRadius: 300,
            targetRadius: 50,
            minInterval: 2000,
            maxInterval: 5000,
          },
          {
            type: ThreatType.DRONE_SLOW,
            spawnRadius: 850,
            targetRadius: 100,
            minInterval: 10000,
            maxInterval: 20000,
          },
          {
            type: ThreatType.QASSAM_2,
            spawnRadius: 750,
            targetRadius: 80,
            minInterval: 4000,
            maxInterval: 8000,
          },
        ];
        break;
      case 'all':
      default:
        // Reset to all threat types
        this.spawnConfigs = allConfigs;
        break;
    }
  }

  setSalvoChance(chance: number): void {
    this.salvoChance = Math.max(0, Math.min(1, chance));
  }

  // Spawn a specific type of threat on demand
  spawnSpecificThreat(type: 'rocket' | 'mortar' | 'drone' | 'ballistic'): void {
    let threatType: ThreatType;

    switch (type) {
      case 'rocket':
        // Pick a random rocket type
        const rocketTypes = [
          ThreatType.SHORT_RANGE,
          ThreatType.MEDIUM_RANGE,
          ThreatType.QASSAM_1,
          ThreatType.GRAD_ROCKET,
        ];
        threatType = rocketTypes[Math.floor(Math.random() * rocketTypes.length)];
        break;
      case 'mortar':
        threatType = ThreatType.MORTAR;
        break;
      case 'drone':
        // Pick a random drone type
        const droneTypes = [ThreatType.DRONE_SLOW, ThreatType.DRONE_FAST];
        threatType = droneTypes[Math.floor(Math.random() * droneTypes.length)];
        break;
      case 'ballistic':
        threatType = ThreatType.CRUISE_MISSILE;
        break;
    }

    // Create a config for this specific threat
    const config = {
      type: threatType,
      spawnRadius: 800,
      targetRadius: 100,
      minInterval: 0,
      maxInterval: 0,
    };

    // Get threat stats to determine spawn parameters
    const threatStats = THREAT_CONFIGS[threatType];

    // Adjust spawn radius based on threat type
    if (threatStats.isDrone) {
      config.spawnRadius = 850;
    } else if (threatStats.isMortar) {
      config.spawnRadius = 300; // Mortars still closer
    } else if (threatType === ThreatType.CRUISE_MISSILE) {
      config.spawnRadius = 950;
    }

    // Temporarily store current configs
    const originalConfigs = this.spawnConfigs;
    this.spawnConfigs = [config];

    // Spawn the threat
    this.spawnSingleThreat(0);

    // Restore original configs
    this.spawnConfigs = originalConfigs;
  }

  // Spawn a salvo of threats
  spawnSalvo(size: number, type: string = 'mixed'): void {
    // Performance optimization: batch spawn threats without individual timers
    const startTime = Date.now();

    // Determine which threat types to use
    let possibleTypes: ThreatType[] = [];

    switch (type) {
      case 'rocket':
        possibleTypes = [
          ThreatType.SHORT_RANGE,
          ThreatType.MEDIUM_RANGE,
          ThreatType.QASSAM_1,
          ThreatType.GRAD_ROCKET,
        ];
        break;
      case 'mortar':
        possibleTypes = [ThreatType.MORTAR];
        break;
      case 'ballistic':
        possibleTypes = [ThreatType.CRUISE_MISSILE];
        break;
      case 'mixed':
      default:
        possibleTypes = [
          ThreatType.SHORT_RANGE,
          ThreatType.MEDIUM_RANGE,
          ThreatType.MORTAR,
          ThreatType.DRONE_SLOW,
          ThreatType.QASSAM_1,
        ];
        break;
    }

    // Pre-allocate threat configs
    const salvoThreats: Array<{ type: ThreatType; delay: number }> = [];
    for (let i = 0; i < size; i++) {
      const threatType = possibleTypes[Math.floor(Math.random() * possibleTypes.length)];
      salvoThreats.push({
        type: threatType,
        delay: i * 0.2, // 200ms delay between each
      });
    }

    // Use a single timer to spawn all threats
    let currentIndex = 0;
    const spawnNext = () => {
      const elapsed = (Date.now() - startTime) / 1000;

      // Spawn all threats whose delay has passed
      while (currentIndex < salvoThreats.length && salvoThreats[currentIndex].delay <= elapsed) {
        const threat = salvoThreats[currentIndex];
        const config = {
          type: threat.type,
          spawnRadius: 800,
          targetRadius: 100,
          minInterval: 0,
          maxInterval: 0,
        };

        // Adjust spawn radius based on threat type
        const threatStats = THREAT_CONFIGS[threat.type];
        if (threatStats.isDrone) {
          config.spawnRadius = 200;
        } else if (threatStats.isMortar) {
          config.spawnRadius = 80;
        } else if (threat.type === ThreatType.CRUISE_MISSILE) {
          config.spawnRadius = 250;
        }

        // Temporarily set config and spawn
        const originalConfigs = this.spawnConfigs;
        this.spawnConfigs = [config];
        this.spawnSingleThreat(0);
        this.spawnConfigs = originalConfigs;

        currentIndex++;
      }

      // Continue if more threats to spawn
      if (currentIndex < salvoThreats.length) {
        requestAnimationFrame(spawnNext);
      }
    };

    // Start spawning
    requestAnimationFrame(spawnNext);
  }
  
  // ==================== SCENARIO SUPPORT ====================
  
  /**
   * Start an attack scenario with player-friendly parameters
   */
  startScenario(scenario: ScenarioPreset): void {
    console.log(`Starting scenario: ${scenario.name}`);
    
    // Set attack parameters
    this.currentAttackParameters = scenario.parameters;
    
    // Configure threat mix
    if (scenario.parameters.threatMix) {
      this.setThreatMix(scenario.parameters.threatMix);
    }
    
    // Configure salvo chance based on intensity
    const salvoConfig = AttackParameterConverter.getSalvoConfig(scenario.parameters.intensity);
    this.salvoChance = salvoConfig.chance;
    
    // Set base angle for focused attacks
    if (scenario.parameters.pattern === AttackPattern.FOCUSED || 
        scenario.parameters.pattern === AttackPattern.SEQUENTIAL) {
      // Point towards center or first battery
      const targetPos = this.batteries.length > 0 ? 
        this.batteries[0].getPosition() : new THREE.Vector3(0, 0, 0);
      this.baseSpawnAngle = Math.atan2(targetPos.z, targetPos.x) + Math.PI;
    }
    
    // Start the scenario manager
    this.scenarioManager.startScenario(scenario, {
      onComplete: () => {
        console.log(`Scenario ${scenario.name} completed`);
        this.stopScenario();
      },
      onUpdate: (progress) => {
        // Could emit progress events here
      }
    });
    
    // Start spawning if not already
    if (!this.isSpawning) {
      this.startSpawning();
    }
  }
  
  /**
   * Stop the current scenario
   */
  stopScenario(): void {
    this.currentAttackParameters = null;
    this.scenarioManager.stopScenario();
    // Reset to default spawn configs
    this.salvoChance = 0.3;
  }
  
  /**
   * Set attack intensity (for manual control)
   */
  setAttackIntensity(intensity: AttackIntensity): void {
    if (!this.currentAttackParameters) {
      this.currentAttackParameters = {
        intensity,
        pattern: AttackPattern.SPREAD,
        threatMix: 'mixed'
      };
    } else {
      this.currentAttackParameters.intensity = intensity;
    }
    
    // Update salvo configuration
    const salvoConfig = AttackParameterConverter.getSalvoConfig(intensity);
    this.salvoChance = salvoConfig.chance;
  }
  
  /**
   * Set attack pattern (for manual control)
   */
  setAttackPattern(pattern: AttackPattern): void {
    if (!this.currentAttackParameters) {
      this.currentAttackParameters = {
        intensity: AttackIntensity.MODERATE,
        pattern,
        threatMix: 'mixed'
      };
    } else {
      this.currentAttackParameters.pattern = pattern;
    }
  }
  
  /**
   * Override spawn position based on attack pattern
   */
  private getPatternedSpawnPosition(baseRadius: number): THREE.Vector3 {
    if (!this.currentAttackParameters) {
      // Default random spawn
      const angle = Math.random() * Math.PI * 2;
      const distance = baseRadius;
      return new THREE.Vector3(
        Math.cos(angle) * distance,
        50 + Math.random() * 100,
        Math.sin(angle) * distance
      );
    }
    
    const pattern = this.currentAttackParameters.pattern;
    const radiusConfig = AttackParameterConverter.getSpawnRadiusConfig(pattern);
    const adjustedRadius = baseRadius * radiusConfig.radiusMultiplier;
    
    let angle: number;
    
    switch (pattern) {
      case AttackPattern.FOCUSED:
      case AttackPattern.SEQUENTIAL:
        // Spawn from a focused direction
        if (radiusConfig.angleRange) {
          angle = this.baseSpawnAngle + 
            radiusConfig.angleRange.min + 
            Math.random() * (radiusConfig.angleRange.max - radiusConfig.angleRange.min);
        } else {
          angle = this.baseSpawnAngle;
        }
        break;
        
      case AttackPattern.WAVES:
        // Alternate between sectors
        const waveIndex = Math.floor(Date.now() / 10000) % 3; // Change every 10 seconds
        angle = (waveIndex * 2 * Math.PI / 3) + (Math.random() - 0.5) * Math.PI / 3;
        break;
        
      case AttackPattern.SURROUND:
      case AttackPattern.SPREAD:
      default:
        // Random angle
        angle = Math.random() * Math.PI * 2;
        break;
    }
    
    const distance = adjustedRadius + (Math.random() - 0.5) * 50;
    return new THREE.Vector3(
      Math.cos(angle) * distance,
      50 + Math.random() * 100,
      Math.sin(angle) * distance
    );
  }
  
  /**
   * Get current scenario info
   */
  getCurrentScenario(): ScenarioPreset | null {
    return this.scenarioManager.getActiveScenario();
  }
  
  /**
   * Check if a scenario is active
   */
  isScenarioActive(): boolean {
    return this.scenarioManager.isActive();
  }
  
  private createLauncherSiteVisuals(): void {
    const materialCache = MaterialCache.getInstance();
    const geometryFactory = GeometryFactory.getInstance();
    
    // Create visual indicators for all launcher sites
    this.launcherSystem.getAllSites().forEach(site => {
      // Create a simple marker for each launcher site
      const markerGeometry = geometryFactory.getCone(5, 10, 8);
      const markerMaterial = materialCache.getMeshStandardMaterial({
        color: 0xff0000,
        emissive: 0xff0000,
        emissiveIntensity: 0.3,
      });
      
      const marker = new THREE.Mesh(markerGeometry, markerMaterial);
      marker.position.copy(site.position);
      marker.position.y = 5;
      marker.visible = false; // Start hidden, show only when active
      
      this.scene.add(marker);
      this.launcherSiteVisuals.set(site.id, marker);
    });
  }
  
  private updateLauncherSiteVisuals(): void {
    const activeSites = this.launcherSystem.getActiveSites();
    const activeSiteIds = new Set(activeSites.map(site => site.id));
    
    // Update visibility based on active sites
    this.launcherSiteVisuals.forEach((marker, siteId) => {
      marker.visible = activeSiteIds.has(siteId);
      
      // Pulse effect for active sites
      if (marker.visible) {
        const time = Date.now() * 0.001;
        const material = marker.material as THREE.MeshStandardMaterial;
        material.emissiveIntensity = 0.3 + Math.sin(time * 3) * 0.2;
      }
    });
  }
  
  /**
   * Set launcher attack pattern
   */
  setLauncherAttackPattern(pattern: 'concentrated' | 'distributed' | 'sequential' | 'random'): void {
    this.launcherSystem.setAttackPattern(pattern);
  }
  
  /**
   * Activate launchers by direction
   */
  activateLauncherDirection(direction: 'north' | 'south' | 'east' | 'west'): void {
    this.launcherSystem.activateDirection(direction);
  }
  
  /**
   * Deactivate launchers by direction
   */
  deactivateLauncherDirection(direction: 'north' | 'south' | 'east' | 'west'): void {
    this.launcherSystem.deactivateDirection(direction);
  }
}
