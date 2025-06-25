import { Threat } from '@/entities/Threat';
import { IronDomeBattery } from '@/entities/IronDomeBattery';
import { debug } from '@/utils/DebugLogger';

interface ThreatMetrics {
  threat: Threat;
  priority: number;
  timeToImpact: number;
  estimatedDamage: number;
  interceptDifficulty: number;
  requiredInterceptors: number;
}

interface BatteryCapability {
  battery: IronDomeBattery;
  availableInterceptors: number;
  coverage: Set<string>; // Threat IDs this battery can intercept
  averageInterceptTime: number;
  successRate: number;
}

interface AllocationResult {
  allocations: Map<string, { battery: IronDomeBattery; interceptorCount: number; batteryIndex?: number }>;
  unassignedThreats: Threat[];
  efficiency: number;
}

export class InterceptorAllocation {
  private historicalSuccessRates: Map<string, number> = new Map();
  private readonly defaultSuccessRate = 0.85;
  private batteries: IronDomeBattery[] = [];

  /**
   * Optimize interceptor allocation across multiple batteries and threats
   */
  optimizeAllocation(threats: Threat[], batteries: IronDomeBattery[]): AllocationResult {
    // Store batteries for threat analysis
    this.batteries = batteries;
    
    // Create a map to track battery indices
    const batteryIndexMap = new Map<IronDomeBattery, number>();
    batteries.forEach((battery, index) => {
      batteryIndexMap.set(battery, index);
    });

    // Step 1: Analyze all threats
    const threatMetrics = threats
      .map(threat => this.analyzeThreat(threat))
      .sort((a, b) => b.priority - a.priority); // Sort by priority

    // Step 2: Assess battery capabilities
    const batteryCapabilities = this.assessBatteries(batteries, threats);

    debug.module('InterceptorAllocation').log(
      `Battery capabilities:`,
      batteryCapabilities.map(cap => ({
        batteryInterceptors: cap.availableInterceptors,
        coverage: cap.coverage.size,
        successRate: cap.successRate,
      }))
    );

    // Step 3: Use dynamic programming for optimal allocation
    const allocations = this.dynamicAllocation(threatMetrics, batteryCapabilities, batteryIndexMap);

    // Step 4: Identify unassigned threats
    const assignedThreatIds = new Set(allocations.keys());
    const unassignedThreats = threats.filter(t => !assignedThreatIds.has(t.id));

    // Calculate efficiency metric
    const efficiency = this.calculateAllocationEfficiency(allocations, threatMetrics);

    debug
      .module('InterceptorAllocation')
      .log(
        `Allocation complete: ${allocations.size} allocated, ${unassignedThreats.length} unassigned`
      );

    return { allocations, unassignedThreats, efficiency };
  }

  private analyzeThreat(threat: Threat): ThreatMetrics {
    const timeToImpact = threat.getTimeToImpact();
    const velocity = threat.getVelocity().length();
    const threatPos = threat.getPosition();

    // Priority calculation
    let priority = 100;

    // Time criticality (0-40 points)
    if (timeToImpact < 10) priority += 40;
    else if (timeToImpact < 20) priority += 25;
    else if (timeToImpact < 30) priority += 10;

    // Threat type (0-30 points)
    const typeScores = {
      ballistic_missile: 30,
      cruise_missile: 25,
      rocket: 15,
      mortar: 10,
      drone: 5,
    };
    priority += typeScores[threat.type] || 10;

    // Velocity factor (0-20 points)
    if (velocity > 800) priority += 20;
    else if (velocity > 400) priority += 10;
    else if (velocity > 200) priority += 5;

    // Altitude factor (0-10 points)
    const altitude = threatPos.y;
    if (altitude < 500) priority += 10;
    else if (altitude < 1000) priority += 5;
    
    // CRITICAL: Battery proximity factor (0-100+ points)
    // Check if threat is approaching any battery
    let minDistanceToBattery = Infinity;
    let closestBattery: IronDomeBattery | null = null;
    
    for (const battery of this.batteries) {
      const batteryPos = battery.getPosition();
      const distance = threatPos.distanceTo(batteryPos);
      
      if (distance < minDistanceToBattery) {
        minDistanceToBattery = distance;
        closestBattery = battery;
      }
    }
    
    // Exponentially increase priority as threat gets closer to batteries
    if (minDistanceToBattery < 200) {
      // Critical range - battery in immediate danger
      priority += 150;
    } else if (minDistanceToBattery < 300) {
      // High danger range
      priority += 80;
    } else if (minDistanceToBattery < 400) {
      // Moderate danger range
      priority += 40;
    } else if (minDistanceToBattery < 500) {
      // Low danger range
      priority += 20;
    }
    
    // Additional priority if threat is on collision course with battery
    if (closestBattery && minDistanceToBattery < 400) {
      const impactPoint = threat.getImpactPoint();
      if (impactPoint) {
        const impactDistanceToBattery = impactPoint.distanceTo(closestBattery.getPosition());
        if (impactDistanceToBattery < 50) {
          // Direct hit trajectory
          priority += 100;
        } else if (impactDistanceToBattery < 100) {
          // Near miss trajectory
          priority += 50;
        }
      }
    }

    // Calculate interception difficulty
    let difficulty = 0;
    if (velocity > 600) difficulty += 0.3;
    if (altitude < 300) difficulty += 0.2;
    if (timeToImpact < 15) difficulty += 0.2;
    if (threat.type === 'cruise_missile') difficulty += 0.1; // Maneuvering

    // Estimate required interceptors based on difficulty and success rate
    const successRate = this.getHistoricalSuccessRate(threat.type);
    const requiredForHighPk = Math.ceil(-Math.log(0.05) / -Math.log(1 - successRate));
    const requiredInterceptors = Math.min(
      Math.ceil(requiredForHighPk * (1 + difficulty)),
      4 // Cap at 4
    );


    return {
      threat,
      priority,
      timeToImpact,
      estimatedDamage: this.estimateDamage(threat),
      interceptDifficulty: difficulty,
      requiredInterceptors,
    };
  }

  private assessBatteries(batteries: IronDomeBattery[], threats: Threat[]): BatteryCapability[] {
    const batteryCapabilities = batteries.map((battery, index) => {
      const coverage = new Set<string>();
      let totalInterceptTime = 0;
      let coverageCount = 0;
      const interceptorCount = battery.getInterceptorCount();

      // Determine which threats this battery can intercept
      for (const threat of threats) {
        const canIntercept = battery.canIntercept(threat);
        if (canIntercept) {
          coverage.add(threat.id);

          // Estimate intercept time
          const distance = threat.getPosition().distanceTo(battery.getPosition());
          const interceptTime = distance / battery.getConfig().interceptorSpeed;
          totalInterceptTime += interceptTime;
          coverageCount++;
        }
      }

      return {
        battery,
        availableInterceptors: interceptorCount,
        coverage,
        averageInterceptTime: coverageCount > 0 ? totalInterceptTime / coverageCount : Infinity,
        successRate: this.getBatterySuccessRate(battery),
      };
    });
    
    return batteryCapabilities;
  }

  private dynamicAllocation(
    threats: ThreatMetrics[],
    capabilities: BatteryCapability[]
  ): Map<string, { battery: IronDomeBattery; interceptorCount: number }> {
    const allocations = new Map<string, { battery: IronDomeBattery; interceptorCount: number }>();

    // Track remaining interceptors per battery
    const remainingInterceptors = new Map<IronDomeBattery, number>();
    capabilities.forEach(cap => {
      remainingInterceptors.set(cap.battery, cap.availableInterceptors);
    });

    // Greedy allocation with look-ahead
    for (const threatMetric of threats) {
      let bestAllocation: { battery: IronDomeBattery; score: number } | null = null;
      const skippedReasons: string[] = [];

      // Find best battery for this threat
      for (const capability of capabilities) {
        if (!capability.coverage.has(threatMetric.threat.id)) {
          skippedReasons.push(`Battery doesn't cover threat ${threatMetric.threat.id}`);
          continue;
        }

        const available = remainingInterceptors.get(capability.battery) || 0;
        if (available < threatMetric.requiredInterceptors) {
          skippedReasons.push(
            `Battery has ${available} interceptors, needs ${threatMetric.requiredInterceptors}`
          );
          continue;
        }

        // Score this allocation
        const score = this.scoreAllocation(threatMetric, capability, available, threats.length);

        if (!bestAllocation || score > bestAllocation.score) {
          bestAllocation = { battery: capability.battery, score };
        }
      }

      // Make allocation if found
      if (bestAllocation) {
        allocations.set(threatMetric.threat.id, {
          battery: bestAllocation.battery,
          interceptorCount: threatMetric.requiredInterceptors,
        });

        // Update remaining interceptors
        const current = remainingInterceptors.get(bestAllocation.battery) || 0;
        remainingInterceptors.set(
          bestAllocation.battery,
          current - threatMetric.requiredInterceptors
        );
      } else {
        // Could not allocate threat
      }
    }

    return allocations;
  }

  private scoreAllocation(
    threat: ThreatMetrics,
    capability: BatteryCapability,
    availableInterceptors: number,
    totalThreats: number
  ): number {
    let score = 0;

    // Priority weight (0-100)
    score += threat.priority;

    // Success rate factor (0-50)
    score += capability.successRate * 50;

    // Time efficiency (0-30)
    const timeFactor = Math.max(0, 30 - capability.averageInterceptTime);
    score += timeFactor;

    // Resource efficiency (0-20)
    const batteryConfig = capability.battery.getConfig();
    const maxInterceptors = batteryConfig.launcherCount || 20; // Use launcher count as max
    const resourceEfficiency = availableInterceptors / maxInterceptors;
    score += resourceEfficiency * 20;

    // Coverage bonus - batteries that can cover fewer threats should prioritize them
    const coverageRatio = capability.coverage.size / totalThreats;
    score += (1 - coverageRatio) * 10;

    return score;
  }

  private estimateDamage(threat: Threat): number {
    const damageFactors = {
      ballistic_missile: 1000,
      cruise_missile: 800,
      rocket: 400,
      mortar: 200,
      drone: 100,
    };

    return damageFactors[threat.type] || 300;
  }

  private getHistoricalSuccessRate(threatType: string): number {
    return this.historicalSuccessRates.get(threatType) || this.defaultSuccessRate;
  }

  private getBatterySuccessRate(battery: IronDomeBattery): number {
    // Could track per-battery success rates
    return this.defaultSuccessRate;
  }

  private calculateAllocationEfficiency(
    allocations: Map<string, { battery: IronDomeBattery; interceptorCount: number }>,
    threats: ThreatMetrics[]
  ): number {
    if (threats.length === 0) return 1;

    let totalPriorityAssigned = 0;
    let totalPriority = 0;

    for (const threat of threats) {
      totalPriority += threat.priority;
      if (allocations.has(threat.threat.id)) {
        totalPriorityAssigned += threat.priority;
      }
    }

    return totalPriority > 0 ? totalPriorityAssigned / totalPriority : 0;
  }

  /**
   * Update success rates based on actual interception results
   */
  updateSuccessRate(threatType: string, wasSuccessful: boolean): void {
    const current = this.historicalSuccessRates.get(threatType) || this.defaultSuccessRate;

    // Exponential moving average
    const alpha = 0.1; // Learning rate
    const newRate = current * (1 - alpha) + (wasSuccessful ? 1 : 0) * alpha;

    this.historicalSuccessRates.set(threatType, newRate);

    debug.module('Allocation').log(`Updated success rate for ${threatType}: ${newRate.toFixed(3)}`);
  }
}
