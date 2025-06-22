import { describe, test, expect } from 'bun:test'
import { InterceptionSimulator, generateStandardScenarios } from '../src/testing/InterceptionTestUtils'

describe('Test with Optimized Settings', () => {
  test('test current game settings (9m radius)', () => {
    const simulator = new InterceptionSimulator(
      {
        proportionalGain: 2.0,
        maxGForce: 40,
        targetSpeed: 180
      },
      {
        armingDistance: 15,
        detonationRadius: 9,
        optimalRadius: 2
      }
    )
    
    const scenarios = generateStandardScenarios()
    const results = simulator.runScenarios(scenarios)
    
    console.log('\n=== CURRENT GAME SETTINGS (9m) ===')
    console.log(`Success rate: ${(results.statistics.successRate * 100).toFixed(1)}%`)
    console.log(`Avg hit distance: ${results.statistics.avgHitDistance.toFixed(2)}m`)
    console.log(`Avg detonation quality: ${(results.statistics.avgDetonationQuality * 100).toFixed(0)}%`)
  })
  
  test('test slightly increased radius (10m)', () => {
    const simulator = new InterceptionSimulator(
      {
        proportionalGain: 2.0,
        maxGForce: 40,
        targetSpeed: 180
      },
      {
        armingDistance: 20,
        detonationRadius: 10,
        optimalRadius: 5
      }
    )
    
    const scenarios = generateStandardScenarios()
    const results = simulator.runScenarios(scenarios)
    
    console.log('\n=== INCREASED RADIUS (10m) ===')
    console.log(`Success rate: ${(results.statistics.successRate * 100).toFixed(1)}%`)
    console.log(`Avg hit distance: ${results.statistics.avgHitDistance.toFixed(2)}m`)
    console.log(`Avg detonation quality: ${(results.statistics.avgDetonationQuality * 100).toFixed(0)}%`)
  })
  
  test('test best guidance + best proximity', () => {
    const simulator = new InterceptionSimulator(
      {
        proportionalGain: 1.5,  // Best from optimization
        maxGForce: 50,          // Best from optimization
        targetSpeed: 180
      },
      {
        armingDistance: 15,     // Current game setting
        detonationRadius: 9,    // Current game setting
        optimalRadius: 2        // Current game setting
      }
    )
    
    const scenarios = generateStandardScenarios()
    const results = simulator.runScenarios(scenarios)
    
    console.log('\n=== OPTIMIZED SETTINGS ===')
    console.log(`Success rate: ${(results.statistics.successRate * 100).toFixed(1)}%`)
    console.log(`Avg hit distance: ${results.statistics.avgHitDistance.toFixed(2)}m`)
    console.log(`Avg detonation quality: ${(results.statistics.avgDetonationQuality * 100).toFixed(0)}%`)
    
    // With current settings, expect lower success in simplified simulator
    expect(results.statistics.successRate).toBeGreaterThan(0.05)
  })
  
  test('parameter sweep for proximity settings', () => {
    const baseScenario = {
      name: 'Parameter Sweep',
      threat: {
        position: { x: 2000, y: 800, z: 0 },
        velocity: { x: -150, y: -60, z: 0 },
        type: 'ballistic' as const
      },
      battery: {
        position: { x: 0, y: 0, z: 0 },
        interceptorSpeed: 180,
        interceptorMass: 5
      }
    }
    
    console.log('\n=== PROXIMITY PARAMETER SWEEP ===')
    
    const detonationRadii = [8, 10, 12, 15]
    const optimalRadii = [3, 5, 6, 8]
    
    for (const detRadius of detonationRadii) {
      for (const optRadius of optimalRadii) {
        if (optRadius >= detRadius) continue // Skip invalid combinations
        
        const simulator = new InterceptionSimulator(
          { proportionalGain: 1.5, maxGForce: 50, targetSpeed: 180 },
          { armingDistance: 20, detonationRadius: detRadius, optimalRadius: optRadius }
        )
        
        // Run 10 variations
        const scenarios = []
        for (let i = 0; i < 10; i++) {
          const variation = 0.9 + Math.random() * 0.2 // 90-110% variation
          scenarios.push({
            ...baseScenario,
            threat: {
              ...baseScenario.threat,
              velocity: {
                x: baseScenario.threat.velocity.x * variation,
                y: baseScenario.threat.velocity.y * variation,
                z: baseScenario.threat.velocity.z * variation
              }
            }
          })
        }
        
        const results = simulator.runScenarios(scenarios)
        console.log(`Det: ${detRadius}m, Opt: ${optRadius}m => Success: ${(results.statistics.successRate * 100).toFixed(0)}%, Avg dist: ${results.statistics.avgHitDistance.toFixed(1)}m`)
      }
    }
  })
})