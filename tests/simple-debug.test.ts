import { describe, test } from 'bun:test'
import { InterceptionSimulator } from '../src/testing/InterceptionTestUtils'

describe('Simple Debug', () => {
  test('single simple scenario', () => {
    const simulator = new InterceptionSimulator()
    
    const scenario = {
      name: 'Simple Direct',
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
    
    const result = simulator.simulateInterception(scenario)
    
    console.log('Should fire:', result.interceptionSolution.shouldFire)
    console.log('Launch velocity:', result.interceptionSolution.launchVelocity)
    console.log('Time to intercept:', result.interceptionSolution.timeToIntercept)
    console.log('Min distance achieved:', result.guidanceResult.hitDistance)
    console.log('Detonated:', result.proximityDetonation.detonated)
    console.log('Detonation distance:', result.proximityDetonation.detonationDistance)
    console.log('Success:', result.success)
  })
})