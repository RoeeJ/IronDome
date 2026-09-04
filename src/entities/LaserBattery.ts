import { EventEmitter } from 'events';
import { simulationClock } from '@/simulation/SimulationClock';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { IBattery } from './IBattery';
import { Threat } from './Threat';
import { ProceduralLaserTurret } from './ProceduralLaserTurret';
import { LaserBeam } from './LaserBeam';
import { debug } from '../utils/logger';
import { ExplosionManager, ExplosionType } from '../systems/ExplosionManager';
import { BatteryType, BATTERY_CONFIGS } from '../config/BatteryTypes';
import { GeometryFactory } from '../utils/GeometryFactory';
import { MaterialCache } from '../utils/MaterialCache';

interface LaserTarget {
  threat: Threat;
  lastDamageTime: number;
}

export class LaserBattery extends EventEmitter implements IBattery {
  // Static tracking of which threats are being targeted by any laser
  private static targetedThreats: Set<string> = new Set();

  private scene: THREE.Scene;
  private world: CANNON.World;
  private position: THREE.Vector3;
  private group: THREE.Group;
  private turret?: ProceduralLaserTurret;
  private firing: boolean = false;
  private currentTarget: LaserTarget | null = null;
  private laserBeam: LaserBeam | null = null;
  private maxRange: number = 500; // 500 meters range to cover more area
  private damagePerSecond: number = 20; // 20 damage per second
  private rotationSpeed: number = 2; // Radians per second
  private operational: boolean = true;
  private currentHealth = 100;
  private readonly maxHealth = 100;
  private autoRepairRate = 0;
  private resourceManagementEnabled: boolean = false;
  private energyPerSecond: number = 10; // Energy cost per second of firing
  private currentEnergy: number = 100;
  private maxEnergy: number = 100;
  private energyRechargeRate: number = 5; // Energy per second when not firing

  constructor(scene: THREE.Scene, world: CANNON.World, position: THREE.Vector3) {
    super();
    this.scene = scene;
    this.world = world;
    this.position = position.clone();
    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.scene.add(this.group);

    // Load config values
    const config = BATTERY_CONFIGS[BatteryType.LASER];
    this.maxRange = config.capabilities.maxRange;
    this.damagePerSecond = config.capabilities.damagePerSecond || 20;

    this.createTurret();
  }

  private createTurret() {
    // Create the procedural laser turret
    this.turret = new ProceduralLaserTurret();

    // Scale to match game scale
    this.turret.scale.setScalar(5);

    // Add to group
    this.group.add(this.turret);

    // Create hitbox for raycasting
    const hitboxGeometry = GeometryFactory.getInstance().getBox(20, 40, 20);
    const hitboxMaterial = MaterialCache.getInstance().getMeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const hitbox = new THREE.Mesh(hitboxGeometry, hitboxMaterial);
    hitbox.position.y = 20; // Center of the turret
    hitbox.userData.isHitbox = true;
    hitbox.userData.battery = this; // Store reference to battery
    hitbox.name = 'laser-hitbox';
    this.group.add(hitbox);

    debug.category('LaserBattery', 'Procedural turret created successfully');
  }

  private selectTarget(threats: Threat[]): Threat | null {
    if (!this.operational) return null;

    // Filter threats within range
    const threatsInRange = threats.filter(threat => {
      if (!this.canIntercept(threat)) return false;
      const distance = threat.getPosition().distanceTo(this.position);
      return distance <= this.maxRange;
    });

    if (threatsInRange.length === 0) {
      if (threats.length > 0) {
        debug.category(
          'LaserBattery',
          `No threats in range. ${threats.length} threats total, max range: ${this.maxRange}`
        );
      }
      return null;
    }

    // Sort by priority: unengaged threats first, then by distance
    threatsInRange.sort((a, b) => {
      // Check if threats are being targeted by other lasers
      const aTargeted = LaserBattery.targetedThreats.has(a.id);
      const bTargeted = LaserBattery.targetedThreats.has(b.id);

      // Prefer unengaged threats
      if (aTargeted && !bTargeted) return 1;
      if (!aTargeted && bTargeted) return -1;

      // If both same engagement status, sort by distance
      const distA = a.getPosition().distanceTo(this.position);
      const distB = b.getPosition().distanceTo(this.position);
      return distA - distB;
    });

    debug.category(
      'LaserBattery',
      `Selected target at ${threatsInRange[0].getPosition().distanceTo(this.position).toFixed(1)}m from ${threatsInRange.length} threats in range`
    );
    return threatsInRange[0];
  }

  private rotateTowardsTarget(target: THREE.Vector3, deltaTime: number) {
    if (!this.turret) return;

    // Use the turret's built-in aiming system
    this.turret.aimAt(target);
  }

  canIntercept(threat: Threat): boolean {
    return (
      this.operational &&
      threat.isActive &&
      threat.getPosition().y > 0 &&
      threat.getPosition().distanceTo(this.position) <= this.maxRange
    );
  }

  public fireAt(threat: Threat) {
    if (!this.canIntercept(threat)) return;

    // Check energy if resource management is enabled
    if (this.resourceManagementEnabled && this.currentEnergy <= 0) {
      this.stopFiring();
      return;
    }

    this.currentTarget = {
      threat,
      lastDamageTime: simulationClock.nowMs,
    };
    this.firing = true;

    // Mark threat as targeted
    LaserBattery.targetedThreats.add(threat.id);

    if (!this.laserBeam && this.turret) {
      // The laser should fire from the emitter position
      const emitterPos = this.turret.getEmitterWorldPosition();
      this.laserBeam = new LaserBeam(this.scene, emitterPos, threat.getPosition());
    }

    // TODO: Play laser sound when audio assets are available
    // const soundSystem = SoundSystem.getInstance();
    // soundSystem.playLaserFire(this.position);
    debug.category(
      'LaserBattery',
      `Engaging threat at ${threat.getPosition().distanceTo(this.position).toFixed(1)}m`
    );
  }

  public stopFiring() {
    // Remove threat from targeted list
    if (this.currentTarget) {
      LaserBattery.targetedThreats.delete(this.currentTarget.threat.id);
    }

    this.firing = false;
    this.currentTarget = null;

    if (this.laserBeam) {
      this.laserBeam.destroy();
      this.laserBeam = null;
    }
  }

  public update(deltaTime: number, threats: Threat[]) {
    if (!Number.isFinite(deltaTime) || deltaTime < 0) throw new RangeError('Invalid laser delta');
    if (!this.operational) return;

    // Update turret animations
    if (this.turret) {
      this.turret.update();
    }

    this.repair(this.autoRepairRate * deltaTime);

    // Check if current target is still valid
    if (this.currentTarget) {
      const threat = this.currentTarget.threat;
      const distance = threat.getPosition().distanceTo(this.position);

      if (!threat.isActive || distance > this.maxRange || threat.isDestroyed()) {
        this.stopFiring();
      }
    }

    // Select new target if not firing
    if (!this.firing) {
      const newTarget = this.selectTarget(threats);
      if (newTarget) {
        this.fireAt(newTarget);
      }
    }

    if (!this.firing && this.resourceManagementEnabled) {
      this.currentEnergy = Math.min(
        this.maxEnergy,
        this.currentEnergy + this.energyRechargeRate * deltaTime
      );
    }
    // Update laser and apply damage
    if (this.firing && this.currentTarget) {
      const threat = this.currentTarget.threat;
      const targetPos = threat.getPosition();

      // Rotate towards target
      this.rotateTowardsTarget(targetPos, deltaTime);

      // Update laser beam position with pulse effect
      // Use the emitter position for accurate laser origin
      const emitterPos = this.turret ? this.turret.getEmitterWorldPosition() : this.position;
      this.laserBeam?.update(emitterPos, targetPos, deltaTime);

      // A partially depleted battery can only fire for the energy-supported duration.
      const firingDuration = this.resourceManagementEnabled
        ? Math.min(deltaTime, this.currentEnergy / this.energyPerSecond)
        : deltaTime;
      threat.takeDamage(this.damagePerSecond * firingDuration);
      if (this.resourceManagementEnabled)
        this.currentEnergy = Math.max(
          0,
          this.currentEnergy - this.energyPerSecond * firingDuration
        );

      // Check if threat should be destroyed
      if (threat.isDestroyed()) {
        debug.category('LaserBattery', `Threat destroyed! Health reached 0`);

        // Create explosion at threat position
        const explosionManager = ExplosionManager.getInstance(this.scene);
        explosionManager.createExplosion({
          type: ExplosionType.AIR_INTERCEPTION,
          position: targetPos,
          radius: 5,
          intensity: 0.8,
        });

        // Destroy the threat
        threat.terminate('intercepted');
        threat.destroy(this.scene, this.world);

        // Stop firing at this target
        this.stopFiring();
      } else if (this.resourceManagementEnabled && this.currentEnergy <= 0) {
        this.stopFiring();
      }
    }
  }

  public getPosition(): THREE.Vector3 {
    return this.position.clone();
  }

  public destroy(): void {
    this.stopFiring();
    if (this.turret) {
      this.turret.destroy();
    }
    this.scene.remove(this.group);
    this.operational = false;
  }

  public setResourceManagement(enabled: boolean): void {
    this.resourceManagementEnabled = enabled;
    if (!enabled) {
      this.currentEnergy = this.maxEnergy;
    }
  }

  public setRadarNetwork(radarNetwork: any): void {
    // Radar network integration can be added here if needed
  }

  public isOperational(): boolean {
    return this.operational;
  }

  public getEnergyLevel(): number {
    return this.currentEnergy / this.maxEnergy;
  }

  public setDamagePerSecond(dps: number): void {
    this.damagePerSecond = dps;
  }

  public setMaxRange(range: number): void {
    this.maxRange = range;
  }

  resetInterceptorStock(): void {
    // Laser batteries don't use interceptors, just reset energy
    this.currentEnergy = this.maxEnergy;
  }

  getConfig(): any {
    return {
      maxRange: this.maxRange,
      position: this.position.clone(),
      damagePerSecond: this.damagePerSecond,
      energyCapacity: this.maxEnergy,
    };
  }

  getStats(): any {
    return {
      energy: {
        current: this.currentEnergy,
        max: this.maxEnergy,
        percent: this.currentEnergy / this.maxEnergy,
      },
      health: {
        current: this.currentHealth,
        max: this.maxHealth,
        percent: this.currentHealth / this.maxHealth,
      },
      isOperational: this.operational,
      isFiring: this.firing,
      currentTarget: this.currentTarget ? this.currentTarget.threat.id : null,
    };
  }

  setVisualVisibility(visible: boolean): void {
    if (this.group) {
      this.group.visible = visible;
    }
  }

  getHealth(): { current: number; max: number } {
    return { current: this.currentHealth, max: this.maxHealth };
  }

  repair(amount: number): void {
    if (this.operational && Number.isFinite(amount) && amount > 0)
      this.currentHealth = Math.min(this.maxHealth, this.currentHealth + amount);
  }

  setAutoRepairRate(rate: number): void {
    this.autoRepairRate = Number.isFinite(rate) ? Math.max(0, rate) : 0;
  }

  takeDamage(amount: number): void {
    if (!this.operational || !Number.isFinite(amount) || amount <= 0) return;
    this.currentHealth = Math.max(0, this.currentHealth - amount);
    if (this.currentHealth === 0) {
      this.operational = false;
      this.stopFiring();
      this.emit('destroyed');
    }
  }

  getGroup(): THREE.Group {
    return this.group;
  }

  public isFiring(): boolean {
    return this.firing;
  }
}
