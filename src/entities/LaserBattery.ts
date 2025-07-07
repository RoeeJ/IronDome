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

export class LaserBattery implements IBattery {
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
  private resourceManagementEnabled: boolean = false;
  private energyPerSecond: number = 10; // Energy cost per second of firing
  private currentEnergy: number = 100;
  private maxEnergy: number = 100;
  private energyRechargeRate: number = 5; // Energy per second when not firing

  constructor(scene: THREE.Scene, world: CANNON.World, position: THREE.Vector3) {
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
      if (!threat.isActive) return false;
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

  public fireAt(threat: Threat) {
    if (!this.operational) return;

    // Check energy if resource management is enabled
    if (this.resourceManagementEnabled && this.currentEnergy <= 0) {
      this.stopFiring();
      return;
    }

    this.currentTarget = {
      threat,
      lastDamageTime: Date.now(),
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
    if (!this.operational) return;

    // Update turret animations
    if (this.turret) {
      this.turret.update();
    }

    // Recharge energy when not firing
    if (!this.firing && this.resourceManagementEnabled) {
      this.currentEnergy = Math.min(
        this.maxEnergy,
        this.currentEnergy + this.energyRechargeRate * deltaTime
      );
    }

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

    // Update laser and apply damage
    if (this.firing && this.currentTarget && this.laserBeam) {
      const threat = this.currentTarget.threat;
      const targetPos = threat.getPosition();

      // Rotate towards target
      this.rotateTowardsTarget(targetPos, deltaTime);

      // Update laser beam position with pulse effect
      // Use the emitter position for accurate laser origin
      const emitterPos = this.turret ? this.turret.getEmitterWorldPosition() : this.position;
      this.laserBeam.update(emitterPos, targetPos, deltaTime);

      // Apply DoT
      const damageThisFrame = this.damagePerSecond * deltaTime;
      threat.takeDamage(damageThisFrame);

      // Debug logging
      if (Math.random() < 0.1) {
        // Log 10% of the time to avoid spam
        const healthPercent = ((threat.getHealth() / threat.getMaxHealth()) * 100).toFixed(1);
        debug.category(
          'LaserBattery',
          `Damage: ${damageThisFrame.toFixed(2)}/frame, Threat health: ${healthPercent}%, DPS: ${this.damagePerSecond}`
        );
      }

      // Consume energy if resource management is enabled
      if (this.resourceManagementEnabled) {
        this.currentEnergy = Math.max(0, this.currentEnergy - this.energyPerSecond * deltaTime);
        if (this.currentEnergy <= 0) {
          this.stopFiring();
          debug.category('LaserBattery', 'Energy depleted, stopping fire');
          return;
        }
      }

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
        threat.destroy(this.scene, this.world);

        // Stop firing at this target
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
        current: 100,
        max: 100,
        percent: 1.0,
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
    return { current: 100, max: 100 }; // Laser batteries don't have health system yet
  }

  repair(amount: number): void {
    // Laser batteries don't have health system yet
  }

  setAutoRepairRate(rate: number): void {
    // Laser batteries don't have auto-repair yet
  }

  getGroup(): THREE.Group {
    return this.group;
  }

  public isFiring(): boolean {
    return this.firing;
  }
}
