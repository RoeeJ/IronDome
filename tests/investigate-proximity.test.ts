import { describe, test } from 'bun:test'
import { runGuidanceSimulation } from '../src/systems/GuidanceSimulator'
import { calculateProximity, shouldDetonate } from '../src/systems/InterceptionCalculator'

describe('Investigate Proximity Fuse Issues', () => {
  test('trace full interception trajectory', () => {
    // Simple head-on scenario
    const initialState = {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 135.71, y: 54.29, z: 0 }, // From previous test
      mass: 5,
      target: { x: 2000, y: 800, z: 0 },
      targetVelocity: { x: -150, y: -60, z: 0 },
      time: 0
    }
    
    const settings = {
      armingDistance: 20,
      detonationRadius: 8,
      optimalRadius: 3
    }
    
    const result = runGuidanceSimulation(initialState, {}, 10, 0.1) // 100ms steps
    
    console.log('\n=== TRAJECTORY TRACE ===')
    let distanceTraveled = 0
    let detonated = false
    
    for (let i = 0; i < result.states.length; i++) {
      const state = result.states[i]
      
      // Calculate distance traveled
      if (i > 0) {
        const prev = result.states[i - 1]
        const step = Math.sqrt(
          (state.position.x - prev.position.x) ** 2 +
          (state.position.y - prev.position.y) ** 2 +
          (state.position.z - prev.position.z) ** 2
        )
        distanceTraveled += step
      }
      
      // Calculate proximity
      const proximity = calculateProximity(
        state.position,
        state.velocity,
        state.target,
        state.targetVelocity
      )
      
      // Check detonation
      const detonationCheck = shouldDetonate(proximity, settings, distanceTraveled)
      
      // Log every 5th step or important events
      if (i % 5 === 0 || proximity.distance < 20 || detonationCheck.detonate) {
        console.log(`\nTime: ${state.time.toFixed(2)}s`)
        console.log(`  Distance to target: ${proximity.distance.toFixed(2)}m`)
        console.log(`  Closing rate: ${proximity.closingRate.toFixed(2)} m/s`)
        console.log(`  Distance traveled: ${distanceTraveled.toFixed(2)}m`)
        console.log(`  Armed: ${distanceTraveled >= settings.armingDistance}`)
        console.log(`  Should detonate: ${detonationCheck.detonate}`)
        
        if (detonationCheck.detonate && !detonated) {
          console.log(`  >>> DETONATION at ${proximity.distance.toFixed(2)}m with quality ${(detonationCheck.quality * 100).toFixed(0)}%`)
          detonated = true
          break
        }
      }
    }
    
    if (!detonated) {
      console.log('\n>>> NO DETONATION - Min distance was', result.hitDistance.toFixed(2), 'm')
    }
  })
  
  test('test different guidance gains', () => {
    const initialState = {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 135.71, y: 54.29, z: 0 },
      mass: 5,
      target: { x: 2000, y: 800, z: 0 },
      targetVelocity: { x: -150, y: -60, z: 0 },
      time: 0
    }
    
    const gains = [1.0, 1.5, 2.0, 2.5, 3.0]
    
    console.log('\n=== GUIDANCE GAIN COMPARISON ===')
    for (const gain of gains) {
      const result = runGuidanceSimulation(
        initialState, 
        { proportionalGain: gain },
        10
      )
      
      console.log(`\nGain ${gain}:`)
      console.log(`  Min distance: ${result.hitDistance.toFixed(2)}m`)
      console.log(`  Hit time: ${result.hitTime.toFixed(2)}s`)
      
      // Check if it would detonate with 8m radius
      const wouldDetonate = result.hitDistance <= 8
      console.log(`  Would detonate (8m): ${wouldDetonate}`)
    }
  })
})