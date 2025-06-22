import { describe, test, expect } from 'bun:test'
import { InterceptionSimulator, TestScenario } from '../src/testing/InterceptionTestUtils'

describe('Interceptor Efficiency Analysis', () => {
  test('measure interceptors per threat destroyed', () => {
    const simulator = new InterceptionSimulator(
      { proportionalGain: 2.0, maxGForce: 40, targetSpeed: 180 },
      { armingDistance: 20, detonationRadius: 12, optimalRadius: 6 }
    )
    
    // Simulate a salvo scenario
    const salvoSize = 20
    const scenarios: TestScenario[] = []
    
    // Create a salvo of threats from different angles
    for (let i = 0; i < salvoSize; i++) {
      const angle = (i / salvoSize) * Math.PI * 2
      scenarios.push({
        name: `Threat ${i + 1}`,
        threat: {
          position: { 
            x: 2000 * Math.cos(angle), 
            y: 800 + Math.random() * 400, // Vary altitude
            z: 2000 * Math.sin(angle) 
          },
          velocity: { 
            x: -120 * Math.cos(angle), 
            y: -40 - Math.random() * 20, // Vary descent rate
            z: -120 * Math.sin(angle) 
          },
          type: 'ballistic'
        },
        battery: {
          position: { x: 0, y: 0, z: 0 },
          interceptorSpeed: 180,
          interceptorMass: 5
        }
      })
    }
    
    // Run scenarios and collect statistics
    let totalInterceptorsFired = 0
    let threatsDestroyed = 0
    let totalDetonations = 0
    
    scenarios.forEach(scenario => {
      // Simulate with multiple interceptors per threat (typical game behavior)
      const interceptorsPerThreat = 3 // Typical game fires 2-3 per threat
      
      for (let i = 0; i < interceptorsPerThreat; i++) {
        const result = simulator.simulateInterception(scenario)
        
        if (result.interceptionSolution.shouldFire) {
          totalInterceptorsFired++
          
          if (result.proximityDetonation.detonated) {
            totalDetonations++
            
            // Only count first successful detonation as threat destroyed
            if (i === 0 && result.success) {
              threatsDestroyed++
            }
          }
        }
      }
    })
    
    console.log('\n=== INTERCEPTOR EFFICIENCY ANALYSIS ===')
    console.log(`Salvo size: ${salvoSize} threats`)
    console.log(`Interceptors fired: ${totalInterceptorsFired}`)
    console.log(`Threats destroyed: ${threatsDestroyed}`)
    console.log(`Total detonations: ${totalDetonations}`)
    console.log(`\nEfficiency metrics:`)
    console.log(`  Interceptors per threat: ${(totalInterceptorsFired / salvoSize).toFixed(1)}`)
    console.log(`  Interceptors per kill: ${threatsDestroyed > 0 ? (totalInterceptorsFired / threatsDestroyed).toFixed(1) : 'N/A'}`)
    console.log(`  Kill rate: ${(threatsDestroyed / salvoSize * 100).toFixed(1)}%`)
    console.log(`  Detonation rate: ${(totalDetonations / totalInterceptorsFired * 100).toFixed(1)}%`)
    console.log(`  Wasted detonations: ${totalDetonations - threatsDestroyed} (${((totalDetonations - threatsDestroyed) / totalDetonations * 100).toFixed(1)}%)`)
  })
  
  test('compare single vs multiple interceptor strategies', () => {
    const simulator = new InterceptionSimulator(
      { proportionalGain: 2.0, maxGForce: 40, targetSpeed: 180 },
      { armingDistance: 20, detonationRadius: 12, optimalRadius: 6 }
    )
    
    const testScenario = {
      name: 'Test Threat',
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
    
    // Test different interceptor counts
    const strategies = [1, 2, 3, 4, 5]
    const trialsPerStrategy = 20
    
    console.log('\n=== INTERCEPTOR STRATEGY COMPARISON ===')
    
    strategies.forEach(interceptorCount => {
      let successes = 0
      let totalFired = 0
      
      for (let trial = 0; trial < trialsPerStrategy; trial++) {
        // Add slight variation to each trial
        const variedScenario = {
          ...testScenario,
          threat: {
            ...testScenario.threat,
            velocity: {
              x: testScenario.threat.velocity.x * (0.9 + Math.random() * 0.2),
              y: testScenario.threat.velocity.y * (0.9 + Math.random() * 0.2),
              z: testScenario.threat.velocity.z * (0.9 + Math.random() * 0.2)
            }
          }
        }
        
        let threatDestroyed = false
        
        for (let i = 0; i < interceptorCount; i++) {
          const result = simulator.simulateInterception(variedScenario)
          
          if (result.interceptionSolution.shouldFire) {
            totalFired++
            
            if (result.success && !threatDestroyed) {
              successes++
              threatDestroyed = true
            }
          }
        }
      }
      
      const successRate = successes / trialsPerStrategy * 100
      const efficiency = successes > 0 ? totalFired / successes : Infinity
      
      console.log(`\n${interceptorCount} interceptor(s) per threat:`)
      console.log(`  Success rate: ${successRate.toFixed(1)}%`)
      console.log(`  Avg interceptors per kill: ${efficiency.toFixed(2)}`)
      console.log(`  Total fired: ${totalFired}`)
    })
  })
})