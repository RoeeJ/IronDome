import { describe, test } from 'bun:test'
import { InterceptionSimulator, generateStandardScenarios } from '../src/testing/InterceptionTestUtils'

describe('Analyze Failure Cases', () => {
  test('identify which scenarios are failing', () => {
    const simulator = new InterceptionSimulator(
      {}, // Default guidance
      { armingDistance: 20, detonationRadius: 10, optimalRadius: 5 } // Updated proximity settings
    )
    const scenarios = generateStandardScenarios()
    const results = simulator.runScenarios(scenarios)
    
    console.log('\n=== SCENARIO RESULTS ===')
    console.log(`Total scenarios: ${results.results.length}`)
    console.log(`Successful: ${results.statistics.successfulInterceptions}`)
    console.log(`Success rate: ${(results.statistics.successRate * 100).toFixed(1)}%\n`)
    
    // Group by success/failure
    const failures = results.results.filter(r => !r.success)
    const successes = results.results.filter(r => r.success)
    
    console.log('=== SUCCESSFUL SCENARIOS ===')
    successes.forEach(result => {
      console.log(`✓ ${result.scenario.name}`)
      console.log(`  - Hit distance: ${result.guidanceResult.hitDistance.toFixed(2)}m`)
      console.log(`  - Detonation quality: ${(result.proximityDetonation.detonationQuality * 100).toFixed(0)}%`)
    })
    
    console.log('\n=== FAILED SCENARIOS ===')
    failures.forEach(result => {
      console.log(`✗ ${result.scenario.name}`)
      console.log(`  - Should fire: ${result.interceptionSolution.shouldFire}`)
      if (result.interceptionSolution.shouldFire) {
        console.log(`  - Min distance: ${result.guidanceResult.hitDistance.toFixed(2)}m`)
        console.log(`  - Detonated: ${result.proximityDetonation.detonated}`)
        console.log(`  - Detonation distance: ${result.proximityDetonation.detonationDistance.toFixed(2)}m`)
      }
      console.log(`  - Threat pos: (${result.scenario.threat.position.x}, ${result.scenario.threat.position.y}, ${result.scenario.threat.position.z})`)
      console.log(`  - Threat vel: (${result.scenario.threat.velocity.x}, ${result.scenario.threat.velocity.y}, ${result.scenario.threat.velocity.z})`)
    })
  })
  
  test('test with better proximity settings', () => {
    // Use settings that showed better results in our debug tests
    const simulator = new InterceptionSimulator(
      {
        proportionalGain: 1.5,  // From optimization results
        maxGForce: 50,          // From optimization results
        targetSpeed: 180
      },
      {
        armingDistance: 20,
        detonationRadius: 10,   // Increased from 8
        optimalRadius: 5        // Increased from 3
      }
    )
    
    const scenarios = generateStandardScenarios()
    const results = simulator.runScenarios(scenarios)
    
    console.log('\n=== IMPROVED SETTINGS RESULTS ===')
    console.log(`Success rate: ${(results.statistics.successRate * 100).toFixed(1)}%`)
    console.log(`Avg hit distance: ${results.statistics.avgHitDistance.toFixed(2)}m`)
    console.log(`Avg detonation quality: ${(results.statistics.avgDetonationQuality * 100).toFixed(0)}%`)
  })
})