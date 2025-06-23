import * as THREE from 'three';
import { Threat } from '@/entities/Threat';
import { IronDomeBattery } from '@/entities/IronDomeBattery';
import { debug } from '@/utils/DebugLogger';

interface OptimizationMetrics {
  avgCalculationTime: number;
  threatProcessingRate: number;
  memoryUsage: number;
  cpuUtilization: number;
}

interface CachedInterception {
  threatId: string;
  batteryId: string;
  solution: { point: THREE.Vector3; time: number } | null;
  timestamp: number;
}

export class InterceptionOptimizer {
  private calculationCache: Map<string, CachedInterception> = new Map();
  private readonly cacheTimeout = 100; // ms
  private readonly spatialGrid: Map<string, Set<string>> = new Map();
  private readonly gridSize = 1000; // meters

  // Performance metrics
  private calculationTimes: number[] = [];
  private readonly maxMetricHistory = 100;

  /**
   * Batch process multiple interception calculations efficiently
   */
  batchCalculateInterceptions(
    threats: Threat[],
    batteries: IronDomeBattery[]
  ): Map<string, Map<string, { point: THREE.Vector3; time: number }>> {
    const startTime = performance.now();
    const results = new Map<string, Map<string, { point: THREE.Vector3; time: number }>>();

    // Update spatial index
    this.updateSpatialIndex(threats);

    // Process threats in priority order
    const sortedThreats = this.prioritizeThreatsForCalculation(threats);

    for (const battery of batteries) {
      const batteryResults = new Map<string, { point: THREE.Vector3; time: number }>();

      // Get threats in range using spatial index
      const nearbyThreats = this.getThreatsInRange(battery.getPosition(), battery.config.maxRange);

      for (const threatId of nearbyThreats) {
        const threat = sortedThreats.find(t => t.id === threatId);
        if (!threat) continue;

        // Check cache first
        const cached = this.getCachedSolution(threat.id, battery.config.id);
        if (cached) {
          batteryResults.set(threat.id, cached);
          continue;
        }

        // Calculate new solution
        const solution = this.calculateInterceptionFast(threat, battery);
        if (solution) {
          batteryResults.set(threat.id, solution);
          this.cacheSolution(threat.id, battery.config.id, solution);
        }
      }

      results.set(battery.config.id, batteryResults);
    }

    // Update performance metrics
    const calculationTime = performance.now() - startTime;
    this.updateMetrics(calculationTime, threats.length);

    return results;
  }

  /**
   * Fast interception calculation with early exit conditions
   */
  private calculateInterceptionFast(
    threat: Threat,
    battery: IronDomeBattery
  ): { point: THREE.Vector3; time: number } | null {
    const threatPos = threat.getPosition();
    const threatVel = threat.getVelocity();
    const batteryPos = battery.getPosition();
    const interceptorSpeed = battery.config.interceptorSpeed;

    // Early exit checks
    const directDistance = threatPos.distanceTo(batteryPos);
    if (directDistance > battery.config.maxRange) return null;

    // Quick feasibility check
    const minTime = directDistance / interceptorSpeed;
    const maxTime = threat.getTimeToImpact();

    if (minTime > maxTime) return null;

    // Use bisection method for faster convergence on average
    let low = minTime;
    let high = Math.min(maxTime, 30);
    const tolerance = 0.01;

    while (high - low > tolerance) {
      const mid = (low + high) / 2;

      // Predict threat position
      const futurePos = new THREE.Vector3(
        threatPos.x + threatVel.x * mid,
        threatPos.y + threatVel.y * mid - 0.5 * 9.81 * mid * mid,
        threatPos.z + threatVel.z * mid
      );

      if (futurePos.y <= 0) {
        high = mid;
        continue;
      }

      const interceptTime = futurePos.distanceTo(batteryPos) / interceptorSpeed;

      if (interceptTime < mid) {
        high = mid;
      } else {
        low = mid;
      }
    }

    const finalTime = (low + high) / 2;
    const interceptPoint = new THREE.Vector3(
      threatPos.x + threatVel.x * finalTime,
      threatPos.y + threatVel.y * finalTime - 0.5 * 9.81 * finalTime * finalTime,
      threatPos.z + threatVel.z * finalTime
    );

    return { point: interceptPoint, time: finalTime };
  }

  /**
   * Spatial indexing for O(1) range queries
   */
  private updateSpatialIndex(threats: Threat[]): void {
    this.spatialGrid.clear();

    for (const threat of threats) {
      const pos = threat.getPosition();
      const gridKey = this.getGridKey(pos);

      if (!this.spatialGrid.has(gridKey)) {
        this.spatialGrid.set(gridKey, new Set());
      }

      this.spatialGrid.get(gridKey)!.add(threat.id);
    }
  }

  private getGridKey(position: THREE.Vector3): string {
    const x = Math.floor(position.x / this.gridSize);
    const z = Math.floor(position.z / this.gridSize);
    return `${x},${z}`;
  }

  private getThreatsInRange(position: THREE.Vector3, range: number): Set<string> {
    const threats = new Set<string>();
    const cellsToCheck = Math.ceil(range / this.gridSize);

    const centerX = Math.floor(position.x / this.gridSize);
    const centerZ = Math.floor(position.z / this.gridSize);

    for (let dx = -cellsToCheck; dx <= cellsToCheck; dx++) {
      for (let dz = -cellsToCheck; dz <= cellsToCheck; dz++) {
        const gridKey = `${centerX + dx},${centerZ + dz}`;
        const cellThreats = this.spatialGrid.get(gridKey);

        if (cellThreats) {
          cellThreats.forEach(id => threats.add(id));
        }
      }
    }

    return threats;
  }

  /**
   * Prioritize threats for calculation order
   */
  private prioritizeThreatsForCalculation(threats: Threat[]): Threat[] {
    return threats.sort((a, b) => {
      // Process closer-to-impact threats first
      const timeDiff = a.getTimeToImpact() - b.getTimeToImpact();
      if (Math.abs(timeDiff) > 5) return timeDiff;

      // Then by velocity (faster threats)
      const velA = a.getVelocity().length();
      const velB = b.getVelocity().length();
      return velB - velA;
    });
  }

  /**
   * Cache management
   */
  private getCachedSolution(
    threatId: string,
    batteryId: string
  ): { point: THREE.Vector3; time: number } | null {
    const key = `${threatId}_${batteryId}`;
    const cached = this.calculationCache.get(key);

    if (!cached) return null;

    const age = Date.now() - cached.timestamp;
    if (age > this.cacheTimeout) {
      this.calculationCache.delete(key);
      return null;
    }

    return cached.solution;
  }

  private cacheSolution(
    threatId: string,
    batteryId: string,
    solution: { point: THREE.Vector3; time: number } | null
  ): void {
    const key = `${threatId}_${batteryId}`;

    this.calculationCache.set(key, {
      threatId,
      batteryId,
      solution,
      timestamp: Date.now(),
    });

    // Limit cache size
    if (this.calculationCache.size > 1000) {
      // Remove oldest entries
      const sortedEntries = Array.from(this.calculationCache.entries()).sort(
        (a, b) => a[1].timestamp - b[1].timestamp
      );

      for (let i = 0; i < 100; i++) {
        this.calculationCache.delete(sortedEntries[i][0]);
      }
    }
  }

  /**
   * Performance monitoring
   */
  private updateMetrics(calculationTime: number, threatCount: number): void {
    this.calculationTimes.push(calculationTime);

    if (this.calculationTimes.length > this.maxMetricHistory) {
      this.calculationTimes.shift();
    }

    if (this.calculationTimes.length >= 10) {
      const avgTime =
        this.calculationTimes.reduce((a, b) => a + b, 0) / this.calculationTimes.length;
      const rate = threatCount / (calculationTime / 1000); // threats per second

      debug.module('Optimizer').log('Performance metrics:', {
        avgCalculationTime: avgTime.toFixed(2) + 'ms',
        threatProcessingRate: rate.toFixed(0) + '/s',
        cacheSize: this.calculationCache.size,
        spatialGridCells: this.spatialGrid.size,
      });
    }
  }

  getMetrics(): OptimizationMetrics {
    const avgTime =
      this.calculationTimes.length > 0
        ? this.calculationTimes.reduce((a, b) => a + b, 0) / this.calculationTimes.length
        : 0;

    return {
      avgCalculationTime: avgTime,
      threatProcessingRate: 0, // Would need to track this
      memoryUsage: this.calculationCache.size * 100, // Rough estimate in bytes
      cpuUtilization: 0, // Would need system metrics
    };
  }

  /**
   * Clear caches and reset metrics
   */
  reset(): void {
    this.calculationCache.clear();
    this.spatialGrid.clear();
    this.calculationTimes = [];
  }
}
