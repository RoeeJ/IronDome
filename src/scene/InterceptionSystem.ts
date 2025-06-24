import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { IronDomeBattery } from '../entities/IronDomeBattery';
import { Threat } from '../entities/Threat';
import { Projectile } from '../entities/Projectile';
import { FragmentationSystem } from '../systems/FragmentationSystem';
import { DebrisSystem } from '../systems/DebrisSystem';
import { Profiler } from '../utils/Profiler';
import { debug } from '../utils/DebugLogger';
import { ResourceManager } from '../game/ResourceManager';
import { GameState } from '../game/GameState';
import { ThreatManager } from './ThreatManager';
import { BatteryCoordinator } from '../game/BatteryCoordinator';
import { ImprovedTrajectoryCalculator } from '../utils/ImprovedTrajectoryCalculator';
import { PredictiveTargeting } from '../utils/PredictiveTargeting';
import { InterceptorAllocation } from '../systems/InterceptorAllocation';
import { InterceptionOptimizer } from '../systems/InterceptionOptimizer';
import { BlastPhysics } from '../systems/BlastPhysics';
import { ExplosionManager, ExplosionType } from '../systems/ExplosionManager';
import { SoundSystem } from '../systems/SoundSystem';

interface Interception {
  interceptor: Projectile;
  threat: Threat;
  targetPoint: THREE.Vector3;
  launchTime: number;
}

export class InterceptionSystem {
  private scene: THREE.Scene;
  private world: CANNON.World;
  private batteries: IronDomeBattery[] = [];
  private activeInterceptions: Interception[] = [];
  private interceptors: Projectile[] = [];
  private successfulInterceptions: number = 0;
  private failedInterceptions: number = 0;
  private totalInterceptorsFired: number = 0;
  private fragmentationSystem: FragmentationSystem;
  private debrisSystem: DebrisSystem;
  private currentThreats: Threat[] = [];
  private profiler?: Profiler;
  private resourceManager: ResourceManager;
  private gameState: GameState;
  private threatManager?: ThreatManager;
  private comboCount: number = 0;
  private lastInterceptionTime: number = 0;
  private batteryCoordinator: BatteryCoordinator;

  // New algorithm components
  private predictiveTargeting: PredictiveTargeting;
  private interceptorAllocation: InterceptorAllocation;
  private interceptionOptimizer: InterceptionOptimizer;
  private useImprovedAlgorithms: boolean = true;

  constructor(scene: THREE.Scene, world: CANNON.World) {
    this.scene = scene;
    this.world = world;
    this.fragmentationSystem = new FragmentationSystem(scene);
    this.debrisSystem = new DebrisSystem(scene, world);
    this.resourceManager = ResourceManager.getInstance();
    this.gameState = GameState.getInstance();
    this.batteryCoordinator = new BatteryCoordinator();

    // Initialize improved algorithms
    this.predictiveTargeting = new PredictiveTargeting();
    this.interceptorAllocation = new InterceptorAllocation();
    this.interceptionOptimizer = new InterceptionOptimizer();
  }

  setThreatManager(threatManager: ThreatManager): void {
    this.threatManager = threatManager;
  }

  addBattery(battery: IronDomeBattery): void {
    this.batteries.push(battery);
    // Register with coordinator using array index as ID for now
    const batteryId = `battery_${this.batteries.length - 1}`;
    this.batteryCoordinator.registerBattery(batteryId, battery);
  }

  setProfiler(profiler: Profiler): void {
    this.profiler = profiler;
  }

  update(threats: Threat[]): Projectile[] {
    const deltaTime = 1 / 60;

    // Store threats for repurposing
    this.currentThreats = threats;

    // Update predictive tracking for improved algorithms
    if (this.useImprovedAlgorithms) {
      if (this.profiler) this.profiler.startSection('Predictive Tracking');
      threats.forEach(threat => {
        this.predictiveTargeting.updateThreatTracking(threat);
      });
      // Periodic cleanup
      if (Math.random() < 0.01) {
        this.predictiveTargeting.cleanup();
      }
      if (this.profiler) this.profiler.endSection('Predictive Tracking');
    }

    // Update batteries with threat information
    if (this.profiler) this.profiler.startSection('Battery Updates');
    this.batteries.forEach((battery, index) => {
      battery.update(deltaTime, threats);
      // Update coordinator with current battery status
      this.batteryCoordinator.updateBatteryStatus(`battery_${index}`);
    });
    if (this.profiler) this.profiler.endSection('Battery Updates');

    // Periodic coordinator cleanup and validation
    if (Math.random() < 0.05) {
      // ~3 times per second at 60fps
      this.batteryCoordinator.cleanup();

      // Also clear assignments for threats with no active interceptors
      const assignedThreats = new Set<string>();
      this.activeInterceptions.forEach(interception => {
        assignedThreats.add(interception.threat.id);
      });

      threats.forEach(threat => {
        if (!assignedThreats.has(threat.id) && this.getInterceptorCount(threat) === 0) {
          const assignment = this.batteryCoordinator.getAssignedInterceptorCount(threat.id);
          if (assignment > 0) {
            debug.module('Interception').log(`Clearing stale assignment for threat ${threat.id}`);
            this.batteryCoordinator.clearThreatAssignment(threat.id);
          }

          // Safety check: unmark threats that have no active interceptors
          if (threat.isBeingIntercepted() && !assignedThreats.has(threat.id)) {
            debug
              .module('Interception')
              .log(`Clearing stale interception mark for threat ${threat.id}`);
            threat.unmarkAsBeingIntercepted();
          }
        }
      });
    }

    // Update fragmentation system
    if (this.profiler) this.profiler.startSection('Fragmentation System');
    const { fragmentPositions } = this.fragmentationSystem.update(deltaTime);
    if (this.profiler) this.profiler.endSection('Fragmentation System');

    // Update debris system
    if (this.profiler) this.profiler.startSection('Debris System');
    this.debrisSystem.update(deltaTime);
    if (this.profiler) this.profiler.endSection('Debris System');

    // Check if fragments hit any threats
    if (this.profiler) this.profiler.startSection('Fragment Hit Detection');
    for (const threat of threats) {
      if (threat.isActive && this.fragmentationSystem.checkFragmentHits(threat.getPosition(), 3)) {
        this.handleFragmentHit(threat);
      }
    }
    if (this.profiler) this.profiler.endSection('Fragment Hit Detection');

    // Update interceptors
    if (this.profiler) this.profiler.startSection('Interceptor Updates');
    for (let i = this.interceptors.length - 1; i >= 0; i--) {
      const interceptor = this.interceptors[i];
      interceptor.update(deltaTime);

      // Remove interceptors that fall below ground or have detonated
      if (interceptor.body.position.y < -10 || !interceptor.isActive) {
        // Remove from instanced renderer if available
        const renderer = (window as any).__instancedProjectileRenderer;
        if (renderer) {
          renderer.removeProjectile(interceptor.id);
        }
        
        // Remove from trail renderer
        const trailRenderer = (window as any).__instancedTrailRenderer;
        if (trailRenderer) {
          trailRenderer.removeTrail(interceptor);
        }

        interceptor.destroy(this.scene, this.world);
        this.interceptors.splice(i, 1);
      }
    }
    if (this.profiler) this.profiler.endSection('Interceptor Updates');

    // Check for new threats to intercept
    if (this.profiler) this.profiler.startSection('Evaluate Threats');
    this.evaluateThreats(threats);
    if (this.profiler) this.profiler.endSection('Evaluate Threats');

    // Check for successful interceptions
    if (this.profiler) this.profiler.startSection('Check Interceptions');
    this.checkInterceptions();
    if (this.profiler) this.profiler.endSection('Check Interceptions');

    // Clean up completed interceptions
    if (this.profiler) this.profiler.startSection('Cleanup');
    this.cleanupInterceptions();
    if (this.profiler) this.profiler.endSection('Cleanup');

    return this.interceptors;
  }

  private evaluateThreats(threats: Threat[]): void {
    if (this.useImprovedAlgorithms) {
      this.evaluateThreatsImproved(threats);
    } else {
      this.evaluateThreatsLegacy(threats);
    }
  }

  private evaluateThreatsImproved(threats: Threat[]): void {
    // Performance check: limit total active interceptors
    const maxActiveInterceptors = 8;
    if (this.interceptors.length >= maxActiveInterceptors) {
      return;
    }

    debug
      .module('Interception')
      .log(`Evaluating ${threats.length} threats with improved algorithms`);

    // Filter out threats that are already sufficiently engaged
    const unassignedThreats = threats.filter(t => {
      if (!t.isActive || t.getTimeToImpact() <= 0) return false;
      // Check if threat needs more interceptors
      const existingCount = this.getInterceptorCount(t);
      const existingAssignment = this.batteryCoordinator.getAssignedInterceptorCount(t.id);

      if (existingCount > 0 || existingAssignment > 0) {
        debug
          .module('Interception')
          .log(
            `Skipping threat ${t.id}: existingCount=${existingCount}, existingAssignment=${existingAssignment}`
          );
      }

      // Only engage if no interceptors are currently assigned or in flight
      return existingCount === 0 && existingAssignment === 0;
    });

    if (unassignedThreats.length === 0) {
      debug.module('Interception').log('No unassigned threats to evaluate');
      return;
    }

    debug
      .module('Interception')
      .log(`Found ${unassignedThreats.length} unassigned threats out of ${threats.length} total`);

    // Use the improved allocation system
    const allocationResult = this.interceptorAllocation.optimizeAllocation(
      unassignedThreats,
      this.batteries
    );

    debug
      .module('Interception')
      .log(
        `Allocation result: ${allocationResult.allocations.size} threats allocated, ${allocationResult.unassignedThreats.length} unassigned`
      );
    debug
      .module('Interception')
      .log(`Allocation efficiency: ${(allocationResult.efficiency * 100).toFixed(1)}%`);

    // Process allocations
    allocationResult.allocations.forEach((allocation, threatId) => {
      // Check interceptor limit
      if (this.interceptors.length >= maxActiveInterceptors) {
        return;
      }

      const threat = threats.find(t => t.id === threatId);
      if (!threat) return;

      const battery = allocation.battery;
      const batteryIndex = this.batteries.indexOf(battery);
      const batteryId = `battery_${batteryIndex}`;

      // Fire interceptors with improved targeting
      let interceptorsFired = 0;
      battery.fireInterceptors(threat, allocation.interceptorCount, interceptor => {
        interceptorsFired++;
        // Use predictive targeting for lead calculation
        const leadPrediction = this.predictiveTargeting.calculateLeadPrediction(
          threat,
          battery.getPosition(),
          battery.config.interceptorSpeed
        );

        // Don't use setTargetPoint - it creates a static target!
        // The interceptor should track the actual moving threat
        // Lead prediction is handled in the guidance system itself

        // Set up proximity detonation callback
        interceptor.detonationCallback = (position: THREE.Vector3, quality: number) => {
          this.handleProximityDetonation(interceptor, threat, position, quality);
        };

        this.interceptors.push(interceptor);
        this.totalInterceptorsFired++;
        this.activeInterceptions.push({
          interceptor,
          threat,
          targetPoint: leadPrediction?.aimPoint || threat.getImpactPoint() || threat.getPosition(),
          launchTime: Date.now(),
        });

        // Add to instanced renderer if available
        const renderer = (window as any).__instancedProjectileRenderer;
        if (renderer) {
          renderer.addProjectile(interceptor);
        }
        
        // Add trail to batched renderer
        const trailRenderer = (window as any).__instancedTrailRenderer;
        if (trailRenderer) {
          const trailColor = new THREE.Color(0, 1, 1); // Cyan for interceptors
          trailRenderer.addTrail(interceptor, trailColor);
        }
      });

      // Only record assignment if interceptors were actually fired
      if (interceptorsFired > 0) {
        this.batteryCoordinator.assignThreatToBattery(threat.id, batteryId, interceptorsFired);
        debug
          .module('Interception')
          .log(`Assigned ${interceptorsFired} interceptors to threat ${threat.id}`);
      } else {
        debug
          .module('Interception')
          .log(`Failed to fire interceptors at threat ${threat.id} - no assignment recorded`);
      }
    });

    // Update success rates based on results
    if (Math.random() < 0.1) {
      // Periodic updates
      this.updateLearningData();
    }
  }

  private evaluateThreatsLegacy(threats: Threat[]): void {
    // Original implementation
    const maxActiveInterceptors = 8;
    if (this.interceptors.length >= maxActiveInterceptors) {
      return;
    }

    debug.module('Interception').log(`Evaluating ${threats.length} threats (legacy)`);

    const maxThreatsToEvaluate = 20;
    const threatsToProcess =
      threats.length > maxThreatsToEvaluate ? threats.slice(0, maxThreatsToEvaluate) : threats;

    const sortedThreats = threatsToProcess
      .filter(t => t.isActive && t.getTimeToImpact() > 0)
      .sort((a, b) => a.getTimeToImpact() - b.getTimeToImpact());

    for (const threat of sortedThreats) {
      if (this.interceptors.length >= maxActiveInterceptors) {
        break;
      }

      const threatConfig = (threat as any).config;
      const isDrone = threatConfig?.isDrone || false;
      debug.module('Interception').log(`Evaluating ${isDrone ? 'DRONE' : 'threat'} ${threat.id}`);

      const existingInterceptors = this.getInterceptorCount(threat);

      // Skip if threat already has interceptors
      if (existingInterceptors > 0) {
        debug
          .module('Interception')
          .log(`Threat ${threat.id} already has ${existingInterceptors} interceptors`);
        continue;
      }

      const battery = this.batteryCoordinator.findOptimalBattery(threat, existingInterceptors);
      if (!battery) {
        debug
          .module('Interception')
          .log(`No capable battery for ${isDrone ? 'DRONE' : 'threat'} ${threat.id}`);
        continue;
      }
      if (battery.getInterceptorCount() === 0) {
        debug.module('Interception').log(`Battery has no loaded interceptors`);
        continue;
      }

      const interceptorsToFire = battery.calculateInterceptorCount(threat, existingInterceptors);

      if (interceptorsToFire > 0) {
        debug.category('Interception', `Firing ${interceptorsToFire} interceptor(s) at threat`);

        const batteryIndex = this.batteries.indexOf(battery);
        const batteryId = `battery_${batteryIndex}`;

        this.batteryCoordinator.assignThreatToBattery(threat.id, batteryId, interceptorsToFire);

        battery.fireInterceptors(threat, interceptorsToFire, interceptor => {
          interceptor.detonationCallback = (position: THREE.Vector3, quality: number) => {
            this.handleProximityDetonation(interceptor, threat, position, quality);
          };

          this.interceptors.push(interceptor);
          this.totalInterceptorsFired++;
          this.activeInterceptions.push({
            interceptor,
            threat,
            targetPoint: threat.getImpactPoint() || threat.getPosition(),
            launchTime: Date.now(),
          });

          const renderer = (window as any).__instancedProjectileRenderer;
          if (renderer) {
            renderer.addProjectile(interceptor);
          }
        });
      }
    }
  }

  private isBeingIntercepted(threat: Threat): boolean {
    return this.activeInterceptions.some(i => i.threat === threat && i.interceptor.isActive);
  }

  private getInterceptorCount(threat: Threat): number {
    return this.activeInterceptions.filter(i => i.threat === threat && i.interceptor.isActive)
      .length;
  }

  private findBestBattery(threat: Threat): IronDomeBattery | null {
    // Find all batteries that can intercept
    const capableBatteries = this.batteries.filter(b => b.canIntercept(threat));

    if (capableBatteries.length === 0) {
      return null;
    }

    // Choose closest battery
    return capableBatteries.reduce((closest, battery) => {
      const closestDist = threat.getPosition().distanceTo(closest.getPosition());
      const batteryDist = threat.getPosition().distanceTo(battery.getPosition());
      return batteryDist < closestDist ? battery : closest;
    });
  }

  private checkInterceptions(): void {
    // Proximity detonations are now handled by the proximity fuse system
    // This method now just cleans up inactive interceptions
    for (let i = this.activeInterceptions.length - 1; i >= 0; i--) {
      const interception = this.activeInterceptions[i];

      // Remove if either is inactive
      if (!interception.interceptor.isActive || !interception.threat.isActive) {
        this.activeInterceptions.splice(i, 1);
      }
    }
  }

  private handleProximityDetonation(
    interceptor: Projectile,
    threat: Threat,
    position: THREE.Vector3,
    quality: number
  ): void {
    debug.category(
      'Combat',
      `Proximity detonation at ${position.distanceTo(threat.getPosition()).toFixed(1)}m`
    );

    // Create explosion visual
    this.createExplosion(position, Math.max(0.8, quality));

    // Play explosion sound
    SoundSystem.getInstance().playExplosion('intercept', position);

    // Check if threat is still active before counting hits/misses
    if (!threat.isActive) {
      debug.category(
        'Combat',
        'Interceptor detonated near already destroyed threat - not counting'
      );
      // Remove from active interceptions
      const index = this.activeInterceptions.findIndex(i => i.interceptor === interceptor);
      if (index !== -1) {
        this.activeInterceptions.splice(index, 1);
      }
      return;
    }

    // Try to mark threat as being intercepted (atomic operation)
    const wasMarked = threat.markAsBeingIntercepted();

    // Use physics-based blast damage calculation
    const damage = BlastPhysics.calculateDamage(
      position,
      threat.getPosition(),
      threat.getVelocity()
    );

    debug.category(
      'Combat',
      `Blast damage: ${damage.damageType}, Kill probability: ${(damage.killProbability * 100).toFixed(0)}%`
    );

    if (damage.hit && wasMarked) {
      this.successfulInterceptions++;

      // Track stats
      this.gameState.recordInterception();
      this.gameState.recordThreatDestroyed();

      // Update combo
      const now = Date.now();
      if (now - this.lastInterceptionTime < 5000) {
        // 5 second combo window
        this.comboCount++;
        this.resourceManager.awardInterceptionBonus(this.comboCount);
      } else {
        this.comboCount = 1;
      }
      this.lastInterceptionTime = now;

      // Create debris from successful interception
      const threatVelocity = threat.getVelocity();
      this.debrisSystem.createInterceptionDebris(position, threatVelocity);

      // Mark threat as intercepted in ThreatManager
      if (this.threatManager) {
        this.threatManager.markThreatIntercepted(threat);
      } else {
        threat.destroy(this.scene, this.world);
      }

      // Clear assignment from coordinator
      this.batteryCoordinator.clearThreatAssignment(threat.id);

      // Trigger repurposing check for other interceptors targeting this threat
      this.repurposeInterceptors(threat);

      // Remove from active interceptions
      const index = this.activeInterceptions.findIndex(i => i.interceptor === interceptor);
      if (index !== -1) {
        this.activeInterceptions.splice(index, 1);
      }
    } else if (wasMarked) {
      // Only count as failure if we actually tried to intercept (wasMarked = true)
      this.failedInterceptions++;
      this.gameState.recordMiss();
      debug.category('Combat', 'Proximity detonation failed to destroy threat');

      // IMPORTANT: Unmark the threat so other interceptors can try
      threat.unmarkAsBeingIntercepted();

      // Create some debris even on failed interception
      const threatVelocity = threat.getVelocity();
      this.debrisSystem.createDebris(position, threatVelocity.clone().multiplyScalar(0.2), 5);
    } else {
      // Another interceptor is already handling this threat
      debug.category(
        'Combat',
        'Interceptor detonated on threat already being intercepted - not counting'
      );
      // Remove from active interceptions
      const index = this.activeInterceptions.findIndex(i => i.interceptor === interceptor);
      if (index !== -1) {
        this.activeInterceptions.splice(index, 1);
      }
    }
  }

  private handleFragmentHit(threat: Threat): void {
    debug.category('Combat', 'Threat destroyed by fragments!');
    this.successfulInterceptions++;

    // Track stats
    this.gameState.recordInterception();
    this.gameState.recordThreatDestroyed();

    // Mark threat as intercepted in ThreatManager
    if (this.threatManager) {
      this.threatManager.markThreatIntercepted(threat);
    } else {
      threat.destroy(this.scene, this.world);
    }

    // Clear assignment from coordinator
    this.batteryCoordinator.clearThreatAssignment(threat.id);

    // Trigger repurposing for interceptors targeting this threat
    this.repurposeInterceptors(threat);

    // Small explosion at threat position
    this.createExplosion(threat.getPosition(), 0.8);
  }

  private repurposeInterceptors(destroyedThreat: Threat): void {
    // Find all interceptors targeting the destroyed threat
    const interceptorsToRepurpose = this.activeInterceptions.filter(
      i => i.threat === destroyedThreat && i.interceptor.isActive
    );

    if (interceptorsToRepurpose.length === 0) return;

    debug.category('Interception', `Repurposing ${interceptorsToRepurpose.length} interceptor(s)`);

    // Use all active threats from the system
    const activeThreats = this.currentThreats.filter(t => t.isActive && t !== destroyedThreat);

    for (const interception of interceptorsToRepurpose) {
      // Find nearest untargeted or lightly targeted threat
      let bestNewTarget: Threat | null = null;
      let bestScore = -Infinity;

      for (const threat of activeThreats) {
        if (!threat.isActive) continue;

        // Calculate retargeting score based on:
        // - Distance from interceptor
        // - Time to impact
        // - Number of interceptors already targeting it
        const distance = interception.interceptor.getPosition().distanceTo(threat.getPosition());
        const timeToImpact = threat.getTimeToImpact();
        const interceptorCount = this.getInterceptorCount(threat);

        // Skip if too far or too many interceptors already
        if (distance > 50 || interceptorCount >= 3) continue;

        // Score: prefer closer threats with less time and fewer interceptors
        const score =
          (1 / distance) * (1 / Math.max(timeToImpact, 1)) * (1 / (interceptorCount + 1));

        if (score > bestScore) {
          bestScore = score;
          bestNewTarget = threat;
        }
      }

      if (bestNewTarget) {
        // Retarget the interceptor
        interception.interceptor.retarget(bestNewTarget.mesh);
        interception.threat = bestNewTarget;
        interception.targetPoint = bestNewTarget.getImpactPoint() || bestNewTarget.getPosition();
        debug.category('Interception', 'Interceptor successfully retargeted');
      } else {
        // No suitable target found - self-destruct to avoid friendly fire
        debug.category(
          'Interception',
          'No suitable retarget found - interceptor will self-destruct'
        );
        interception.interceptor.isActive = false;
        this.createExplosion(interception.interceptor.getPosition(), 0.8);
      }
    }
  }

  private handleSuccessfulInterception(interception: Interception): void {
    this.successfulInterceptions++;

    // Create explosion effect
    this.createExplosion(
      interception.interceptor
        .getPosition()
        .add(interception.threat.getPosition())
        .multiplyScalar(0.5)
    );

    // Destroy both projectiles
    // Remove from instanced renderer if available
    const renderer = (window as any).__instancedProjectileRenderer;
    if (renderer) {
      renderer.removeProjectile(interception.interceptor.id);
    }
    
    // Remove from trail renderer
    const trailRenderer = (window as any).__instancedTrailRenderer;
    if (trailRenderer) {
      trailRenderer.removeTrail(interception.interceptor);
    }

    interception.interceptor.destroy(this.scene, this.world);
    interception.threat.destroy(this.scene, this.world);
  }

  public createExplosion(position: THREE.Vector3, quality: number = 1.0): void {
    // Use centralized explosion manager
    const radius = 10 + quality * 5;
    ExplosionManager.getInstance(this.scene).createExplosion({
      type: position.y > 5 ? ExplosionType.AIR_INTERCEPTION : ExplosionType.GROUND_IMPACT,
      position: position,
      radius: radius,
      intensity: quality,
    });
  }

  private createSmokeRing(position: THREE.Vector3): void {
    const ringGeometry = new THREE.TorusGeometry(2, 0.5, 8, 16);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x666666,
      opacity: 0.6,
      transparent: true,
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.position.copy(position);
    ring.rotation.x = Math.PI / 2;
    this.scene.add(ring);

    const startTime = Date.now();
    const animate = () => {
      const elapsed = (Date.now() - startTime) / 1000;
      if (elapsed > 2) {
        this.scene.remove(ring);
        ring.geometry.dispose();
        ringMaterial.dispose();
        return;
      }

      const scale = 1 + elapsed * 3;
      ring.scale.set(scale, scale, scale);
      ring.position.y += elapsed * 2;
      ringMaterial.opacity = 0.6 * (1 - elapsed / 2);

      requestAnimationFrame(animate);
    };
    animate();
  }

  private createInterceptionVisual(threat: Threat): void {
    // Create line showing interception trajectory
    const targetPoint = threat.getImpactPoint();
    if (!targetPoint) return;

    const points = [
      this.batteries[0].getPosition().add(new THREE.Vector3(0, 3, 0)),
      threat.getPosition(),
    ];

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: 0x00ffff,
      opacity: 0.5,
      transparent: true,
    });

    const line = new THREE.Line(geometry, material);
    this.scene.add(line);

    // Remove after 2 seconds
    setTimeout(() => {
      this.scene.remove(line);
      geometry.dispose();
      material.dispose();
    }, 2000);
  }

  private cleanupInterceptions(): void {
    // Remove completed interceptions
    this.activeInterceptions = this.activeInterceptions.filter(interception => {
      // Check if interceptor went too low or too much time passed
      if (
        interception.interceptor.body.position.y < -5 ||
        Date.now() - interception.launchTime > 30000
      ) {
        this.failedInterceptions++;
        return false;
      }
      return interception.interceptor.isActive && interception.threat.isActive;
    });
  }

  private updateLearningData(): void {
    // Update allocation system with recent interception results
    this.activeInterceptions.forEach(interception => {
      if (!interception.interceptor.isActive) {
        // Interceptor has detonated, check if it was successful
        const threatStillActive = this.currentThreats.find(
          t => t.id === interception.threat.id
        )?.isActive;
        const wasSuccessful = !threatStillActive;

        this.interceptorAllocation.updateSuccessRate(interception.threat.type, wasSuccessful);
      }
    });
  }

  getStats() {
    const coordinatorStats = this.batteryCoordinator.getCoordinationStats();
    const operationalBatteries = this.batteries.filter(b => b.isOperational());
    return {
      successful: this.successfulInterceptions,
      failed: this.failedInterceptions,
      totalFired: this.totalInterceptorsFired,
      active: this.interceptors.length,
      batteries: operationalBatteries.length,
      totalInterceptors: operationalBatteries.reduce((sum, b) => sum + b.getInterceptorCount(), 0),
      activeInterceptors: this.interceptors.length,
      coordination: coordinatorStats,
      algorithmMode: this.useImprovedAlgorithms ? 'improved' : 'legacy',
    };
  }

  getActiveInterceptorCount(): number {
    return this.activeInterceptions.length;
  }

  getInterceptors(): Projectile[] {
    return [...this.interceptors];
  }

  getActiveInterceptors(): Projectile[] {
    return this.interceptors.filter(i => i.isActive);
  }

  setBatteryCoordination(enabled: boolean): void {
    this.batteryCoordinator.setCoordinationEnabled(enabled);
  }

  getNearestBattery(threat: Threat): IronDomeBattery | null {
    let nearestBattery: IronDomeBattery | null = null;
    let minDistance = Infinity;

    for (const battery of this.batteries) {
      if (battery.isOperational() && battery.canIntercept(threat)) {
        const distance = battery.getPosition().distanceTo(threat.getPosition());
        if (distance < minDistance) {
          minDistance = distance;
          nearestBattery = battery;
        }
      }
    }

    return nearestBattery;
  }

  getBatteries(): IronDomeBattery[] {
    return [...this.batteries];
  }
}
