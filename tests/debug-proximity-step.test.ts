import { describe, test } from 'bun:test'
import { runGuidanceSimulation } from '../src/systems/GuidanceSimulator'
import { calculateProximity, shouldDetonate } from '../src/systems/InterceptionCalculator'
import { calculateInterception } from '../src/systems/InterceptionCalculator'

describe('Debug Proximity Step by Step', () => {
  test('trace every proximity check', () => {
    const scenario = {
      interceptorPosition: { x: 0, y: 0, z: 0 },
      interceptorVelocity: { x: 0, y: 0, z: 0 },
      threatPosition: { x: 2000, y: 800, z: 0 },
      threatVelocity: { x: -150, y: -60, z: 0 },
      interceptorSpeed: 180
    }
    
    const solution = calculateInterception(scenario)
    console.log('Interception solution:', solution)
    
    const initialState = {
      position: { x: 0, y: 0, z: 0 },
      velocity: solution.launchVelocity,
      mass: 5,
      target: { x: 2000, y: 800, z: 0 },
      targetVelocity: { x: -150, y: -60, z: 0 },
      time: 0
    }
    
    const result = runGuidanceSimulation(initialState, {}, 10, 0.1) // 100ms steps
    
    console.log('\n=== PROXIMITY CHECKS ===')
    const settings = { armingDistance: 20, detonationRadius: 8, optimalRadius: 3 }
    let distanceTraveled = 0
    let foundProblem = false
    
    for (let i = 0; i < result.states.length && i < 100; i++) { // Limit to first 100 steps
      const state = result.states[i]
      
      // Calculate distance traveled
      distanceTraveled = Math.sqrt(
        state.position.x ** 2 + state.position.y ** 2 + state.position.z ** 2
      )
      
      const proximity = calculateProximity(
        state.position,
        state.velocity,
        state.target,
        state.targetVelocity
      )
      
      const detonationCheck = shouldDetonate(proximity, settings, distanceTraveled)
      
      // Log when we're getting close or have issues
      if (proximity.distance < 20 || detonationCheck.detonate || (proximity.distance < 8 && !detonationCheck.detonate)) {
        console.log(`\nStep ${i}, Time: ${state.time.toFixed(2)}s`)
        console.log(`  Position: (${state.position.x.toFixed(1)}, ${state.position.y.toFixed(1)}, ${state.position.z.toFixed(1)})`)
        console.log(`  Distance to target: ${proximity.distance.toFixed(2)}m`)
        console.log(`  Closing rate: ${proximity.closingRate.toFixed(2)} m/s`)
        console.log(`  Time to closest: ${proximity.timeToClosestApproach.toFixed(3)}s`)
        console.log(`  Closest approach: ${proximity.closestApproachDistance.toFixed(2)}m`)
        console.log(`  Distance traveled: ${distanceTraveled.toFixed(2)}m`)
        console.log(`  Armed: ${distanceTraveled >= settings.armingDistance}`)
        console.log(`  Should detonate: ${detonationCheck.detonate}`)
        
        if (proximity.distance < 8 && !detonationCheck.detonate && distanceTraveled >= settings.armingDistance) {
          console.log('  >>> PROBLEM: Within detonation radius but not detonating!')
          foundProblem = true
        }
        
        if (detonationCheck.detonate) {
          console.log(`  >>> DETONATION at ${proximity.distance.toFixed(2)}m`)
          break
        }
      }
    }
    
    if (!foundProblem) {
      console.log('\nNo obvious problems found in proximity logic')
    }
  })
})