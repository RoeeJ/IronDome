import { describe, test, expect } from 'bun:test'
import { InterceptionSimulator, TestScenario } from '../src/testing/InterceptionTestUtils'

describe('Realistic Interception Scenarios', () => {
  test('should handle realistic threat scenarios', () => {
    // Use the actual game settings
    const simulator = new InterceptionSimulator(
      { proportionalGain: 2.0, maxGForce: 40, targetSpeed: 180 },
      { armingDistance: 20, detonationRadius: 12, optimalRadius: 6 }
    )
    
    // Create realistic scenarios similar to what happens in the game
    const scenarios: TestScenario[] = [
      // Short range rocket
      {
        name: 'Short Range Rocket',
        threat: {
          position: { x: 1500, y: 600, z: 0 },
          velocity: { x: -120, y: -40, z: 0 },
          type: 'ballistic'
        },
        battery: {
          position: { x: 0, y: 0, z: 0 },
          interceptorSpeed: 180,
          interceptorMass: 5
        }
      },
      // Medium range ballistic
      {
        name: 'Medium Range Ballistic',
        threat: {
          position: { x: 3000, y: 1200, z: 0 },
          velocity: { x: -180, y: -80, z: 0 },
          type: 'ballistic'
        },
        battery: {
          position: { x: 0, y: 0, z: 0 },
          interceptorSpeed: 180,
          interceptorMass: 5
        }
      },
      // Cruise missile
      {
        name: 'Cruise Missile',
        threat: {
          position: { x: 2500, y: 400, z: 0 },
          velocity: { x: -150, y: 0, z: 0 },
          type: 'cruise'
        },
        battery: {
          position: { x: 0, y: 0, z: 0 },
          interceptorSpeed: 180,
          interceptorMass: 5
        }
      },
      // Diagonal approach
      {
        name: 'Diagonal Threat',
        threat: {
          position: { x: 2000, y: 800, z: 2000 },
          velocity: { x: -100, y: -30, z: -100 },
          type: 'ballistic'
        },
        battery: {
          position: { x: 0, y: 0, z: 0 },
          interceptorSpeed: 180,
          interceptorMass: 5
        }
      },
      // Multiple angle variations (more reasonable distances)
      ...[0, 45, 90, 135, 180, 225, 270, 315].map(angle => {
        const rad = angle * Math.PI / 180
        return {
          name: `Threat from ${angle}° (realistic)`,
          threat: {
            position: { 
              x: 1500 * Math.cos(rad), 
              y: 600, 
              z: 1500 * Math.sin(rad) 
            },
            velocity: { 
              x: -80 * Math.cos(rad), 
              y: -30, 
              z: -80 * Math.sin(rad) 
            },
            type: 'ballistic' as const
          },
          battery: {
            position: { x: 0, y: 0, z: 0 },
            interceptorSpeed: 180,
            interceptorMass: 5
          }
        }
      })
    ]
    
    const results = simulator.runScenarios(scenarios)
    
    console.log('\n=== REALISTIC SCENARIO RESULTS ===')
    console.log(`Total scenarios: ${results.results.length}`)
    console.log(`Successful: ${results.statistics.successfulInterceptions}`)
    console.log(`Success rate: ${(results.statistics.successRate * 100).toFixed(1)}%`)
    console.log(`Average hit distance: ${results.statistics.avgHitDistance.toFixed(2)}m`)
    console.log(`Average detonation quality: ${(results.statistics.avgDetonationQuality * 100).toFixed(0)}%`)
    
    // Group by outcome
    const successes = results.results.filter(r => r.success)
    const failures = results.results.filter(r => !r.success)
    
    console.log('\n=== SUCCESSFUL INTERCEPTS ===')
    successes.forEach(r => {
      console.log(`✓ ${r.scenario.name}: ${r.guidanceResult.hitDistance.toFixed(1)}m`)
    })
    
    if (failures.length > 0) {
      console.log('\n=== FAILED INTERCEPTS ===')
      failures.forEach(r => {
        console.log(`✗ ${r.scenario.name}: ${r.guidanceResult.hitDistance.toFixed(1)}m`)
      })
    }
    
    // With realistic scenarios and 12m radius, we should achieve high success rate
    expect(results.statistics.successRate).toBeGreaterThan(0.9)
    expect(results.statistics.avgHitDistance).toBeLessThan(12)
    expect(results.statistics.avgDetonationQuality).toBeGreaterThan(0.6)
  })
  
  test('edge case: very close high-speed threat', () => {
    const simulator = new InterceptionSimulator(
      { proportionalGain: 2.0, maxGForce: 40, targetSpeed: 180 },
      { armingDistance: 20, detonationRadius: 12, optimalRadius: 6 }
    )
    
    const scenario = {
      name: 'Close High-Speed',
      threat: {
        position: { x: 500, y: 200, z: 0 },
        velocity: { x: -200, y: -80, z: 0 },
        type: 'ballistic' as const
      },
      battery: {
        position: { x: 0, y: 0, z: 0 },
        interceptorSpeed: 180,
        interceptorMass: 5
      }
    }
    
    const result = simulator.simulateInterception(scenario)
    console.log('\n=== EDGE CASE RESULT ===')
    console.log(`Can intercept: ${result.interceptionSolution.shouldFire}`)
    console.log(`Hit distance: ${result.guidanceResult.hitDistance.toFixed(2)}m`)
    console.log(`Success: ${result.success}`)
  })
})