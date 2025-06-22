import { describe, test } from 'bun:test'
import { InterceptionSimulator } from '../src/testing/InterceptionTestUtils'

describe('Debug Interception Issues', () => {
  test('debug single scenario with detailed output', () => {
    const simulator = new InterceptionSimulator(
      {
        proportionalGain: 2.0,
        maxGForce: 40,
        targetSpeed: 180
      },
      {
        armingDistance: 20,
        detonationRadius: 8,
        optimalRadius: 3
      }
    )
    
    const scenario = {
      name: 'Debug Test',
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
    
    console.log('\n=== SCENARIO ===')
    console.log('Threat position:', scenario.threat.position)
    console.log('Threat velocity:', scenario.threat.velocity)
    console.log('Battery position:', scenario.battery.position)
    
    const result = simulator.simulateInterception(scenario)
    
    console.log('\n=== INTERCEPTION SOLUTION ===')
    console.log('Should fire:', result.interceptionSolution.shouldFire)
    console.log('Aim point:', result.interceptionSolution.aimPoint)
    console.log('Launch velocity:', result.interceptionSolution.launchVelocity)
    console.log('Time to intercept:', result.interceptionSolution.timeToIntercept)
    console.log('Probability:', result.interceptionSolution.probability)
    
    console.log('\n=== GUIDANCE RESULT ===')
    console.log('Hit distance:', result.guidanceResult.hitDistance)
    console.log('Hit time:', result.guidanceResult.hitTime)
    console.log('Final speed:', result.guidanceResult.finalSpeed)
    
    console.log('\n=== PROXIMITY DETONATION ===')
    console.log('Detonated:', result.proximityDetonation.detonated)
    console.log('Detonation distance:', result.proximityDetonation.detonationDistance)
    console.log('Detonation quality:', result.proximityDetonation.detonationQuality)
    
    console.log('\n=== SUCCESS ===')
    console.log('Success:', result.success)
  })
  
  test('test proximity fuse settings variations', () => {
    const baseScenario = {
      name: 'Proximity Test',
      threat: {
        position: { x: 1500, y: 600, z: 0 },
        velocity: { x: -120, y: -40, z: 0 },
        type: 'ballistic' as const
      },
      battery: {
        position: { x: 0, y: 0, z: 0 },
        interceptorSpeed: 180,
        interceptorMass: 5
      }
    }
    
    const proximitySettings = [
      { armingDistance: 20, detonationRadius: 8, optimalRadius: 3 },
      { armingDistance: 20, detonationRadius: 10, optimalRadius: 5 },
      { armingDistance: 20, detonationRadius: 15, optimalRadius: 8 },
      { armingDistance: 15, detonationRadius: 12, optimalRadius: 6 }
    ]
    
    console.log('\n=== PROXIMITY FUSE COMPARISON ===')
    for (const settings of proximitySettings) {
      const simulator = new InterceptionSimulator({}, settings)
      const result = simulator.simulateInterception(baseScenario)
      
      console.log(`\nSettings: arm=${settings.armingDistance}m, det=${settings.detonationRadius}m, opt=${settings.optimalRadius}m`)
      console.log(`  Success: ${result.success}`)
      console.log(`  Detonation distance: ${result.proximityDetonation.detonationDistance.toFixed(2)}m`)
      console.log(`  Quality: ${(result.proximityDetonation.detonationQuality * 100).toFixed(0)}%`)
    }
  })
})