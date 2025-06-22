import { describe, test } from 'bun:test'
import { InterceptionSimulator } from '../src/testing/InterceptionTestUtils'
import { calculateProximity, shouldDetonate } from '../src/systems/InterceptionCalculator'

describe('Trace Proximity Fuse', () => {
  test('detailed trace of proximity checks', () => {
    const simulator = new InterceptionSimulator()
    
    const scenario = {
      name: 'Trace Test',
      threat: {
        position: { x: 1000, y: 500, z: 0 },
        velocity: { x: -100, y: -50, z: 0 },
        type: 'ballistic' as const
      },
      battery: {
        position: { x: 0, y: 0, z: 0 },
        interceptorSpeed: 180,
        interceptorMass: 5
      }
    }
    
    // Manually trace to see what's happening
    const settings = {
      armingDistance: 20,
      detonationRadius: 8,
      optimalRadius: 3
    }
    
    // Test some specific cases
    console.log('\n=== PROXIMITY FUSE LOGIC TEST ===')
    
    // Case 1: Armed, close, moving towards
    let proximity1 = { distance: 7, closingRate: 50, timeToClosestApproach: 0.1, closestApproachDistance: 2 }
    let result1 = shouldDetonate(proximity1, settings, 100)
    console.log('\nCase 1: Armed, 7m, closing at 50m/s')
    console.log('  Should detonate:', result1.detonate, 'Quality:', result1.quality)
    
    // Case 2: Armed, close, moving away
    let proximity2 = { distance: 7, closingRate: -50, timeToClosestApproach: 0, closestApproachDistance: 7 }
    let result2 = shouldDetonate(proximity2, settings, 100)
    console.log('\nCase 2: Armed, 7m, moving away at -50m/s')
    console.log('  Should detonate:', result2.detonate, 'Quality:', result2.quality)
    
    // Case 3: Armed, optimal range
    let proximity3 = { distance: 2.5, closingRate: 30, timeToClosestApproach: 0.05, closestApproachDistance: 1 }
    let result3 = shouldDetonate(proximity3, settings, 100)
    console.log('\nCase 3: Armed, 2.5m, closing')
    console.log('  Should detonate:', result3.detonate, 'Quality:', result3.quality)
    
    // Case 4: Not armed yet
    let proximity4 = { distance: 2.5, closingRate: 30, timeToClosestApproach: 0.05, closestApproachDistance: 1 }
    let result4 = shouldDetonate(proximity4, settings, 10) // Only 10m traveled
    console.log('\nCase 4: Not armed (10m traveled), 2.5m, closing')
    console.log('  Should detonate:', result4.detonate, 'Quality:', result4.quality)
    
    // Now run the actual simulation and see what happens
    console.log('\n=== ACTUAL SIMULATION ===')
    const result = simulator.simulateInterception(scenario)
    console.log('Min distance:', result.guidanceResult.hitDistance.toFixed(2), 'm')
    console.log('Detonated:', result.proximityDetonation.detonated)
    console.log('Detonation distance:', result.proximityDetonation.detonationDistance)
  })
})