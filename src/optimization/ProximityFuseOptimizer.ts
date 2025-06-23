/**
 * Genetic Algorithm implementation for optimizing proximity fuse parameters
 */

import { GeneticAlgorithm, Gene, Genome } from './GeneticAlgorithm';
import { InterceptionSimulator } from '../testing/InterceptionTestUtils';
import {
  createRealisticScenario,
  createMultipleThreatScenarios,
} from '../testing/InterceptionScenarios';
import { BlastPhysics } from '../systems/BlastPhysics';

export interface OptimizationResult {
  bestSettings: {
    armingDistance: number;
    detonationRadius: number;
    optimalRadius: number;
    scanRate: number;
  };
  performance: {
    hitRate: number;
    avgInterceptorsPerKill: number;
    avgDetonationDistance: number;
    avgKillProbability: number;
  };
  fitness: number;
}

export class ProximityFuseOptimizer {
  private simulator: InterceptionSimulator;
  private scenarioCache: Map<string, any> = new Map();

  constructor() {
    this.simulator = new InterceptionSimulator();
  }

  /**
   * Define the genes (parameters) to optimize
   */
  private getGeneDefinitions(): Gene[] {
    return [
      {
        name: 'armingDistance',
        min: 10,
        max: 50,
        step: 5,
        type: 'int',
      },
      {
        name: 'detonationRadius',
        min: 4,
        max: 15,
        step: 0.5,
        type: 'float',
      },
      {
        name: 'optimalRadius',
        min: 2,
        max: 8,
        step: 0.5,
        type: 'float',
      },
      {
        name: 'scanRate',
        min: 1,
        max: 10,
        step: 1,
        type: 'int',
      },
    ];
  }

  /**
   * Create fitness function that evaluates proximity fuse settings
   */
  private createFitnessFunction(): (genome: Genome) => Promise<number> {
    return async (genome: Genome): Promise<number> => {
      const settings = {
        armingDistance: genome.genes.armingDistance,
        detonationRadius: genome.genes.detonationRadius,
        optimalRadius: genome.genes.optimalRadius,
        scanRate: genome.genes.scanRate,
      };

      // Validate constraints
      if (settings.optimalRadius > settings.detonationRadius) {
        return 0; // Invalid configuration
      }

      // Test against multiple scenarios
      const scenarios = this.getTestScenarios();
      let totalFitness = 0;
      let totalWeight = 0;

      for (const { scenario, weight } of scenarios) {
        const result = this.simulator.simulateInterception({
          ...scenario,
          proximityFuseSettings: settings,
        });

        // Calculate fitness components
        const hitRate = result.hit ? 1 : 0;

        // Calculate kill probability at detonation distance
        let killProbability = 0;
        if (result.proximityData.detonationDistance !== null) {
          const blastResult = BlastPhysics.calculateDamage(
            result.interceptorPath[result.interceptorPath.length - 1].position,
            result.threatPath[
              Math.min(
                Math.floor(result.proximityData.detonationTime! * 60),
                result.threatPath.length - 1
              )
            ].position,
            scenario.threat.velocity
          );
          killProbability = blastResult.killProbability;
        }

        // Fitness components:
        // 1. Hit rate (did we detonate?)
        // 2. Kill probability (how effective was the detonation?)
        // 3. Efficiency (closer to optimal is better)
        // 4. Reliability (consistent detonation timing)

        const detonationDistance =
          result.proximityData.detonationDistance || settings.detonationRadius;
        const efficiencyScore =
          1 - Math.abs(detonationDistance - settings.optimalRadius) / settings.detonationRadius;

        // Combined fitness
        const scenarioFitness =
          hitRate * 0.3 + // 30% weight on hitting
          killProbability * 0.5 + // 50% weight on kill probability
          efficiencyScore * 0.2; // 20% weight on efficiency

        totalFitness += scenarioFitness * weight;
        totalWeight += weight;
      }

      // Store metadata for analysis
      genome.metadata = { settings };

      return totalWeight > 0 ? totalFitness / totalWeight : 0;
    };
  }

  /**
   * Get test scenarios with weights
   */
  private getTestScenarios(): Array<{ scenario: any; weight: number }> {
    const cacheKey = 'test-scenarios';
    if (this.scenarioCache.has(cacheKey)) {
      return this.scenarioCache.get(cacheKey);
    }

    const scenarios = [
      // High-value scenarios (more weight)
      { scenario: createRealisticScenario('ballistic', 'head-on'), weight: 2 },
      { scenario: createRealisticScenario('ballistic', 'crossing'), weight: 2 },
      { scenario: createRealisticScenario('drone', 'head-on'), weight: 1.5 },
      { scenario: createRealisticScenario('mortar', 'high-angle'), weight: 1.5 },

      // Edge cases (less weight)
      { scenario: createRealisticScenario('cruise', 'crossing'), weight: 1 },
      { scenario: createRealisticScenario('ballistic', 'tail-chase'), weight: 0.5 },

      // Failure modes to ensure robustness
      {
        scenario: {
          ...createRealisticScenario('ballistic', 'head-on'),
          interceptor: {
            ...createRealisticScenario('ballistic', 'head-on').interceptor,
            guidance: {
              ...createRealisticScenario('ballistic', 'head-on').interceptor.guidance,
              proportionalGain: 1.5, // Slightly degraded guidance
            },
          },
        },
        weight: 1,
      },
    ];

    this.scenarioCache.set(cacheKey, scenarios);
    return scenarios;
  }

  /**
   * Run optimization to find best proximity fuse settings
   */
  async optimize(config?: {
    populationSize?: number;
    generations?: number;
    verbose?: boolean;
  }): Promise<OptimizationResult> {
    const ga = new GeneticAlgorithm(this.getGeneDefinitions(), this.createFitnessFunction(), {
      populationSize: config?.populationSize || 50,
      generations: config?.generations || 100,
      mutationRate: 0.15,
      crossoverRate: 0.7,
      elitismRate: 0.1,
      convergenceThreshold: 0.001,
      verbose: config?.verbose ?? true,
    });

    console.log('Starting proximity fuse optimization...');
    console.log('Testing against', this.getTestScenarios().length, 'scenarios');

    const result = await ga.run();

    // Evaluate best genome performance in detail
    const bestSettings = {
      armingDistance: result.bestGenome.genes.armingDistance,
      detonationRadius: result.bestGenome.genes.detonationRadius,
      optimalRadius: result.bestGenome.genes.optimalRadius,
      scanRate: result.bestGenome.genes.scanRate,
    };

    // Run detailed performance analysis
    const performance = await this.evaluatePerformance(bestSettings);

    return {
      bestSettings,
      performance,
      fitness: result.bestGenome.fitness!,
    };
  }

  /**
   * Evaluate detailed performance metrics for given settings
   */
  private async evaluatePerformance(settings: any): Promise<any> {
    const scenarios = this.getTestScenarios();
    let totalHits = 0;
    let totalKills = 0;
    let totalInterceptors = 0;
    let totalDetonationDistance = 0;
    let totalKillProbability = 0;
    let validDetonations = 0;

    for (const { scenario } of scenarios) {
      // Simulate multiple times for statistical significance
      for (let i = 0; i < 10; i++) {
        const result = this.simulator.simulateInterception({
          ...scenario,
          proximityFuseSettings: settings,
        });

        if (result.hit) {
          totalHits++;
          totalInterceptors++; // One interceptor per simulation

          if (result.proximityData.detonationDistance !== null) {
            totalDetonationDistance += result.proximityData.detonationDistance;
            validDetonations++;

            // Calculate kill probability
            const blastResult = BlastPhysics.calculateDamage(
              result.interceptorPath[result.interceptorPath.length - 1].position,
              result.threatPath[
                Math.min(
                  Math.floor(result.proximityData.detonationTime! * 60),
                  result.threatPath.length - 1
                )
              ].position,
              scenario.threat.velocity
            );

            totalKillProbability += blastResult.killProbability;
            if (blastResult.hit) {
              totalKills++;
            }
          }
        }
      }
    }

    const totalTests = scenarios.length * 10;

    return {
      hitRate: totalHits / totalTests,
      avgInterceptorsPerKill: totalKills > 0 ? totalInterceptors / totalKills : Infinity,
      avgDetonationDistance: validDetonations > 0 ? totalDetonationDistance / validDetonations : 0,
      avgKillProbability: validDetonations > 0 ? totalKillProbability / validDetonations : 0,
    };
  }

  /**
   * Compare multiple settings configurations
   */
  async compareSettings(
    settingsArray: Array<{
      name: string;
      settings: {
        armingDistance: number;
        detonationRadius: number;
        optimalRadius: number;
        scanRate: number;
      };
    }>
  ): Promise<void> {
    console.log('\n=== PROXIMITY FUSE SETTINGS COMPARISON ===\n');

    for (const { name, settings } of settingsArray) {
      console.log(`\nTesting: ${name}`);
      console.log(`Settings: ${JSON.stringify(settings, null, 2)}`);

      const performance = await this.evaluatePerformance(settings);

      console.log('Performance:');
      console.log(`  Hit Rate: ${(performance.hitRate * 100).toFixed(1)}%`);
      console.log(`  Avg Kill Probability: ${(performance.avgKillProbability * 100).toFixed(1)}%`);
      console.log(`  Interceptors per Kill: ${performance.avgInterceptorsPerKill.toFixed(2)}`);
      console.log(`  Avg Detonation Distance: ${performance.avgDetonationDistance.toFixed(1)}m`);

      // Calculate efficiency score
      const efficiency =
        (performance.hitRate * performance.avgKillProbability) /
        Math.max(1, performance.avgInterceptorsPerKill);
      console.log(`  Efficiency Score: ${efficiency.toFixed(3)}`);
    }
  }
}

// Export convenience function for running optimization
export async function optimizeProximityFuse(config?: {
  populationSize?: number;
  generations?: number;
  verbose?: boolean;
}): Promise<OptimizationResult> {
  const optimizer = new ProximityFuseOptimizer();
  return optimizer.optimize(config);
}
