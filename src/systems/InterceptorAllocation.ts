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
  allocations: Map<string, { battery: IronDomeBattery; interceptorCount: number }>;
  unassignedThreats: Threat[];
  efficiency: number;
}

export class InterceptorAllocation {
  private historicalSuccessRates: Map<string, number> = new Map();
  private readonly defaultSuccessRate = 0.85;

  /**
   * Optimize interceptor allocation across multiple batteries and threats
   */
  optimizeAllocation(threats: Threat[], batteries: IronDomeBattery[]): AllocationResult {
    debug
      .module('InterceptorAllocation')
      .log(`Optimizing allocation for ${threats.length} threats and ${batteries.length} batteries`);

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
    const allocations = this.dynamicAllocation(threatMetrics, batteryCapabilities);

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
    const altitude = threat.getPosition().y;
    if (altitude < 500) priority += 10;
    else if (altitude < 1000) priority += 5;

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

    debug
      .module('InterceptorAllocation')
      .log(
        `Threat ${threat.id} analysis: priority=${priority}, difficulty=${difficulty.toFixed(2)}, successRate=${successRate}, required=${requiredInterceptors}`
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
    return batteries.map(battery => {
      const coverage = new Set<string>();
      let totalInterceptTime = 0;
      let coverageCount = 0;

      // Determine which threats this battery can intercept
      for (const threat of threats) {
        if (battery.canIntercept(threat)) {
          coverage.add(threat.id);

          // Estimate intercept time
          const distance = threat.getPosition().distanceTo(battery.getPosition());
          const interceptTime = distance / battery.config.interceptorSpeed;
          totalInterceptTime += interceptTime;
          coverageCount++;
        }
      }

      return {
        battery,
        availableInterceptors: battery.getInterceptorCount(),
        coverage,
        averageInterceptTime: coverageCount > 0 ? totalInterceptTime / coverageCount : Infinity,
        successRate: this.getBatterySuccessRate(battery),
      };
    });
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
        debug
          .module('InterceptorAllocation')
          .log(`Could not allocate threat ${threatMetric.threat.id}: ${skippedReasons.join(', ')}`);
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
    const resourceEfficiency = availableInterceptors / capability.battery.config.maxInterceptors;
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
