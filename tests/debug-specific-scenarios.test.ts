import { describe, test } from 'bun:test'
import { InterceptionSimulator } from '../src/testing/InterceptionTestUtils'
import { runGuidanceSimulation } from '../src/systems/GuidanceSimulator'
import { calculateInterception } from '../src/systems/InterceptionCalculator'

describe('Debug Specific Failing Scenarios', () => {
  test('debug crossing cruise missile', () => {
    const scenario = {
      name: 'Crossing Cruise Missile',
      threat: {
        position: { x: -2000, y: 500, z: 2000 },
        velocity: { x: 100, y: 0, z: -100 },
        type: 'cruise' as const
      },
      battery: {
        position: { x: 0, y: 0, z: 0 },
        interceptorSpeed: 180,
        interceptorMass: 5
      }
    }
    
    console.log('\n=== CROSSING CRUISE MISSILE DEBUG ===')
    
    // First, check if we can even intercept
    const interceptionSolution = calculateInterception({
      interceptorPosition: scenario.battery.position,
      interceptorVelocity: { x: 0, y: 0, z: 0 },
      threatPosition: scenario.threat.position,
      threatVelocity: scenario.threat.velocity,
      interceptorSpeed: scenario.battery.interceptorSpeed
    })
    
    console.log('Can intercept:', interceptionSolution.shouldFire)
    console.log('Time to intercept:', interceptionSolution.timeToIntercept)
    console.log('Aim point:', interceptionSolution.aimPoint)
    
    // Simulate with different settings
    const settings = [
      { det: 8, opt: 3 },
      { det: 8, opt: 5 },
      { det: 10, opt: 5 },
      { det: 15, opt: 8 }
    ]
    
    for (const setting of settings) {
      const simulator = new InterceptionSimulator(
        { proportionalGain: 1.5, maxGForce: 50, targetSpeed: 180 },
        { armingDistance: 20, detonationRadius: setting.det, optimalRadius: setting.opt }
      )
      
      const result = simulator.simulateInterception(scenario)
      console.log(`\n${setting.det}m/${setting.opt}m: Success=${result.success}, MinDist=${result.guidanceResult.hitDistance.toFixed(2)}m, Detonated=${result.proximityDetonation.detonated}`)
    }
  })
  
  test('debug low altitude drone', () => {
    const scenario = {
      name: 'Low Altitude Drone',
      threat: {
        position: { x: 1000, y: 100, z: 1000 },
        velocity: { x: -30, y: 0, z: -30 },
        type: 'drone' as const
      },
      battery: {
        position: { x: 0, y: 0, z: 0 },
        interceptorSpeed: 180,
        interceptorMass: 5
      }
    }
    
    console.log('\n=== LOW ALTITUDE DRONE DEBUG ===')
    
    const interceptionSolution = calculateInterception({
      interceptorPosition: scenario.battery.position,
      interceptorVelocity: { x: 0, y: 0, z: 0 },
      threatPosition: scenario.threat.position,
      threatVelocity: scenario.threat.velocity,
      interceptorSpeed: scenario.battery.interceptorSpeed
    })
    
    console.log('Can intercept:', interceptionSolution.shouldFire)
    if (!interceptionSolution.shouldFire) {
      console.log('Reason: Likely too slow or trajectory not interceptable')
    }
  })
  
  test('debug threat angle scenarios', () => {
    console.log('\n=== ANGLE SCENARIO DEBUG ===')
    
    // These all showed 10.21m min distance
    const angle = 45
    const rad = angle * Math.PI / 180
    const scenario = {
      name: `Threat from ${angle}°`,
      threat: {
        position: { 
          x: 2000 * Math.cos(rad), 
          y: 800, 
          z: 2000 * Math.sin(rad) 
        },
        velocity: { 
          x: -100 * Math.cos(rad), 
          y: -40, 
          z: -100 * Math.sin(rad) 
        },
        type: 'ballistic' as const
      },
      battery: {
        position: { x: 0, y: 0, z: 0 },
        interceptorSpeed: 180,
        interceptorMass: 5
      }
    }
    
    // Test with original settings
    const simulator1 = new InterceptionSimulator(
      { proportionalGain: 2.0, maxGForce: 40, targetSpeed: 180 },
      { armingDistance: 20, detonationRadius: 8, optimalRadius: 3 }
    )
    
    const result1 = simulator1.simulateInterception(scenario)
    console.log('\nOriginal settings (8m/3m):')
    console.log('  Min distance:', result1.guidanceResult.hitDistance.toFixed(2), 'm')
    console.log('  Detonated:', result1.proximityDetonation.detonated)
    
    // Test with optimized settings
    const simulator2 = new InterceptionSimulator(
      { proportionalGain: 1.5, maxGForce: 50, targetSpeed: 180 },
      { armingDistance: 20, detonationRadius: 12, optimalRadius: 5 }
    )
    
    const result2 = simulator2.simulateInterception(scenario)
    console.log('\nOptimized settings (12m/5m):')
    console.log('  Min distance:', result2.guidanceResult.hitDistance.toFixed(2), 'm')
    console.log('  Detonated:', result2.proximityDetonation.detonated)
    console.log('  Success:', result2.success)
  })
})