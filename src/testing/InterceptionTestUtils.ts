import {
  calculateInterception,
  calculateProximity,
  shouldDetonate,
  InterceptionScenario,
  InterceptionSolution,
  Vector3Like,
} from '../systems/InterceptionCalculator';
import {
  runGuidanceSimulation,
  GuidanceState,
  GuidanceSettings,
} from '../systems/GuidanceSimulator';

export interface TestScenario {
  name: string;
  threat: {
    position: Vector3Like;
    velocity: Vector3Like;
    type: 'ballistic' | 'cruise' | 'drone';
  };
  battery: {
    position: Vector3Like;
    interceptorSpeed: number;
    interceptorMass: number;
  };
  expectedOutcome?: {
    shouldIntercept: boolean;
    hitDistance?: number;
    hitTime?: number;
  };
}

export interface SimulationResult {
  scenario: TestScenario;
  interceptionSolution: InterceptionSolution;
  guidanceResult: {
    hitDistance: number;
    hitTime: number;
    finalSpeed: number;
  };
  proximityDetonation: {
    detonated: boolean;
    detonationDistance: number;
    detonationQuality: number;
  };
  success: boolean;
}

export interface ParameterRange {
  parameter: string;
  min: number;
  max: number;
  step: number;
}

export interface SweepResult {
  parameters: Record<string, number>;
  successRate: number;
  avgHitDistance: number;
  avgHitTime: number;
}

/**
 * Main test utility for simulating interceptions
 */
export class InterceptionSimulator {
  private guidanceSettings: Partial<GuidanceSettings>;
  private proximitySettings: {
    armingDistance: number;
    detonationRadius: number;
    optimalRadius: number;
  };

  constructor(
    guidanceSettings: Partial<GuidanceSettings> = {},
    proximitySettings = {
      armingDistance: 20,
      detonationRadius: 8,
      optimalRadius: 3,
    }
  ) {
    this.guidanceSettings = guidanceSettings;
    this.proximitySettings = proximitySettings;
  }

  /**
   * Simulate a complete interception scenario
   */
  simulateInterception(scenario: TestScenario): SimulationResult {
    // Step 1: Calculate interception solution
    const interceptionScenario: InterceptionScenario = {
      interceptorPosition: scenario.battery.position,
      interceptorVelocity: { x: 0, y: 0, z: 0 },
      threatPosition: scenario.threat.position,
      threatVelocity: scenario.threat.velocity,
      interceptorSpeed: scenario.battery.interceptorSpeed,
    };

    const interceptionSolution = calculateInterception(interceptionScenario);

    // If no valid interception, return failure
    if (!interceptionSolution.shouldFire) {
      return {
        scenario,
        interceptionSolution,
        guidanceResult: { hitDistance: Infinity, hitTime: 0, finalSpeed: 0 },
        proximityDetonation: {
          detonated: false,
          detonationDistance: Infinity,
          detonationQuality: 0,
        },
        success: false,
      };
    }

    // Step 2: Simulate guided flight
    const initialGuidanceState: GuidanceState = {
      position: scenario.battery.position,
      velocity: interceptionSolution.launchVelocity,
      mass: scenario.battery.interceptorMass,
      target: scenario.threat.position,
      targetVelocity: scenario.threat.velocity,
      time: 0,
    };

    const guidanceResult = runGuidanceSimulation(
      initialGuidanceState,
      this.guidanceSettings,
      interceptionSolution.timeToIntercept * 1.5, // Give some margin
      0.016 / 4 // Use 4x smaller timestep for better accuracy (4ms)
    );

    // Step 3: Check proximity fuse along the trajectory
    let detonated = false;
    let detonationDistance = Infinity;
    let detonationQuality = 0;
    let distanceTraveled = 0;
    let minDistanceAchieved = Infinity;

    // Track initial position for distance calculation
    const launchPosition = { ...scenario.battery.position };

    for (let i = 0; i < guidanceResult.states.length; i++) {
      const state = guidanceResult.states[i];

      // Calculate total distance from launch position
      distanceTraveled = Math.sqrt(
        (state.position.x - launchPosition.x) ** 2 +
          (state.position.y - launchPosition.y) ** 2 +
          (state.position.z - launchPosition.z) ** 2
      );

      // Calculate proximity
      const proximity = calculateProximity(
        state.position,
        state.velocity,
        state.target,
        state.targetVelocity
      );

      // Track minimum distance for debugging
      if (proximity.distance < minDistanceAchieved) {
        minDistanceAchieved = proximity.distance;
      }

      // Check detonation
      const detonationCheck = shouldDetonate(proximity, this.proximitySettings, distanceTraveled);

      if (detonationCheck.detonate) {
        detonated = true;
        detonationDistance = proximity.distance;
        detonationQuality = detonationCheck.quality;
        break;
      }
    }

    // Calculate final speed
    const finalState = guidanceResult.states[guidanceResult.states.length - 1];
    const finalSpeed = Math.sqrt(
      finalState.velocity.x ** 2 + finalState.velocity.y ** 2 + finalState.velocity.z ** 2
    );

    // Determine success
    const success = detonated && detonationDistance <= this.proximitySettings.detonationRadius;

    return {
      scenario,
      interceptionSolution,
      guidanceResult: {
        hitDistance: minDistanceAchieved,
        hitTime: guidanceResult.hitTime,
        finalSpeed,
      },
      proximityDetonation: {
        detonated,
        detonationDistance,
        detonationQuality,
      },
      success,
    };
  }

  /**
   * Run multiple scenarios and calculate statistics
   */
  runScenarios(scenarios: TestScenario[]): {
    results: SimulationResult[];
    statistics: {
      totalScenarios: number;
      successfulInterceptions: number;
      successRate: number;
      avgHitDistance: number;
      avgHitTime: number;
      avgDetonationQuality: number;
    };
  } {
    const results = scenarios.map(scenario => this.simulateInterception(scenario));

    const successful = results.filter(r => r.success);
    const avgHitDistance =
      successful.length > 0
        ? successful.reduce((sum, r) => sum + r.guidanceResult.hitDistance, 0) / successful.length
        : 0;
    const avgHitTime =
      successful.length > 0
        ? successful.reduce((sum, r) => sum + r.guidanceResult.hitTime, 0) / successful.length
        : 0;
    const avgDetonationQuality =
      successful.length > 0
        ? successful.reduce((sum, r) => sum + r.proximityDetonation.detonationQuality, 0) /
          successful.length
        : 0;

    return {
      results,
      statistics: {
        totalScenarios: scenarios.length,
        successfulInterceptions: successful.length,
        successRate: successful.length / scenarios.length,
        avgHitDistance,
        avgHitTime,
        avgDetonationQuality,
      },
    };
  }

  /**
   * Run parameter sweep to find optimal settings
   */
  runParameterSweep(
    baseScenario: TestScenario,
    parameterRanges: ParameterRange[],
    testCount: number = 10
  ): SweepResult[] {
    const results: SweepResult[] = [];

    // Generate parameter combinations
    const combinations = this.generateParameterCombinations(parameterRanges);

    for (const params of combinations) {
      // Update settings with current parameters
      const testSimulator = new InterceptionSimulator(
        { ...this.guidanceSettings, ...params },
        this.proximitySettings
      );

      // Run multiple tests with slight variations
      const testScenarios: TestScenario[] = [];
      for (let i = 0; i < testCount; i++) {
        // Add some variation to the scenario
        const variation = 1 + (Math.random() - 0.5) * 0.1; // ±5% variation
        testScenarios.push({
          ...baseScenario,
          threat: {
            ...baseScenario.threat,
            velocity: {
              x: baseScenario.threat.velocity.x * variation,
              y: baseScenario.threat.velocity.y * variation,
              z: baseScenario.threat.velocity.z * variation,
            },
          },
        });
      }

      const testResults = testSimulator.runScenarios(testScenarios);

      results.push({
        parameters: params,
        successRate: testResults.statistics.successRate,
        avgHitDistance: testResults.statistics.avgHitDistance,
        avgHitTime: testResults.statistics.avgHitTime,
      });
    }

    // Sort by success rate
    results.sort((a, b) => b.successRate - a.successRate);

    return results;
  }

  private generateParameterCombinations(ranges: ParameterRange[]): Record<string, number>[] {
    const combinations: Record<string, number>[] = [];

    const generateRecursive = (index: number, current: Record<string, number>) => {
      if (index >= ranges.length) {
        combinations.push({ ...current });
        return;
      }

      const range = ranges[index];
      for (let value = range.min; value <= range.max; value += range.step) {
        current[range.parameter] = value;
        generateRecursive(index + 1, current);
      }
    };

    generateRecursive(0, {});
    return combinations;
  }
}

/**
 * Generate standard test scenarios
 */
export function generateStandardScenarios(): TestScenario[] {
  const scenarios: TestScenario[] = [];

  // Scenario 1: Direct ballistic threat
  scenarios.push({
    name: 'Direct Ballistic Threat',
    threat: {
      position: { x: 3000, y: 1000, z: 0 },
      velocity: { x: -150, y: -50, z: 0 },
      type: 'ballistic',
    },
    battery: {
      position: { x: 0, y: 0, z: 0 },
      interceptorSpeed: 180,
      interceptorMass: 5,
    },
    expectedOutcome: {
      shouldIntercept: true,
      hitDistance: 8,
      hitTime: 8,
    },
  });

  // Scenario 2: Crossing cruise missile
  scenarios.push({
    name: 'Crossing Cruise Missile',
    threat: {
      position: { x: -2000, y: 500, z: 2000 },
      velocity: { x: 100, y: 0, z: -100 },
      type: 'cruise',
    },
    battery: {
      position: { x: 0, y: 0, z: 0 },
      interceptorSpeed: 180,
      interceptorMass: 5,
    },
  });

  // Scenario 3: Low altitude drone
  scenarios.push({
    name: 'Low Altitude Drone',
    threat: {
      position: { x: 1000, y: 100, z: 1000 },
      velocity: { x: -30, y: 0, z: -30 },
      type: 'drone',
    },
    battery: {
      position: { x: 0, y: 0, z: 0 },
      interceptorSpeed: 180,
      interceptorMass: 5,
    },
  });

  // Scenario 4: High altitude ballistic
  scenarios.push({
    name: 'High Altitude Ballistic',
    threat: {
      position: { x: 5000, y: 3000, z: 0 },
      velocity: { x: -200, y: -100, z: 0 },
      type: 'ballistic',
    },
    battery: {
      position: { x: 0, y: 0, z: 0 },
      interceptorSpeed: 180,
      interceptorMass: 5,
    },
  });

  // Scenario 5: Multiple angles
  for (let angle = 0; angle < 360; angle += 45) {
    const rad = (angle * Math.PI) / 180;
    scenarios.push({
      name: `Threat from ${angle}°`,
      threat: {
        position: {
          x: 2000 * Math.cos(rad),
          y: 800,
          z: 2000 * Math.sin(rad),
        },
        velocity: {
          x: -100 * Math.cos(rad),
          y: -40,
          z: -100 * Math.sin(rad),
        },
        type: 'ballistic',
      },
      battery: {
        position: { x: 0, y: 0, z: 0 },
        interceptorSpeed: 180,
        interceptorMass: 5,
      },
    });
  }

  return scenarios;
}
