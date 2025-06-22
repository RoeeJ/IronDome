// Global mocks must be set before imports
global.window = { location: { search: '' } } as any

import { describe, test } from 'bun:test'
import { GeneticAlgorithm } from '../src/optimization/GeneticAlgorithm'
import * as THREE from 'three'

// Inline simplified blast physics to avoid import issues
function calculateKillProbability(distance: number, targetSpeed: number = 150): number {
  const crossingFactor = Math.min(1, 300 / (targetSpeed + 100))
  
  if (distance <= 3) return 0.95 * crossingFactor
  else if (distance <= 6) {
    const factor = 1 - Math.pow((distance - 3) / 3, 2)
    return (0.8 + factor * 0.15) * crossingFactor
  } else if (distance <= 10) {
    const factor = 1 - Math.pow((distance - 6) / 4, 2)
    return (0.3 + factor * 0.5) * crossingFactor
  } else if (distance <= 15) {
    const factor = 1 - Math.pow((distance - 10) / 5, 2)
    return factor * 0.3 * crossingFactor
  }
  return 0
}

// Simplified interception simulation
function simulateInterception(settings: any, scenario: any) {
  // Simulate guidance accuracy - typically achieves 3-12m
  const baseAccuracy = 6 // Base guidance accuracy
  const accuracyVariance = 3
  const achievedDistance = baseAccuracy + (Math.random() - 0.5) * 2 * accuracyVariance
  
  // Check if within detonation radius
  const hit = achievedDistance <= settings.detonationRadius
  
  // Calculate detonation distance
  let detonationDistance = achievedDistance
  if (hit && achievedDistance < settings.optimalRadius) {
    detonationDistance = settings.optimalRadius // Wait for optimal
  }
  
  return {
    hit,
    detonationDistance: hit ? detonationDistance : null,
    killProbability: hit ? calculateKillProbability(detonationDistance, scenario.threatSpeed) : 0
  }
}

describe('Proximity Fuse Optimization Standalone', () => {
  test('genetic algorithm optimization for proximity fuse', async () => {
    console.log('\n=== PROXIMITY FUSE GA OPTIMIZATION ===\n')
    
    // Define parameter genes
    const genes = [
      { name: 'armingDistance', min: 10, max: 50, step: 5, type: 'int' as const },
      { name: 'detonationRadius', min: 4, max: 12, step: 0.5, type: 'float' as const },
      { name: 'optimalRadius', min: 2, max: 6, step: 0.5, type: 'float' as const },
      { name: 'scanRate', min: 1, max: 8, step: 1, type: 'int' as const }
    ]
    
    // Test scenarios
    const scenarios = [
      { name: 'Ballistic', threatSpeed: 162, weight: 2 },
      { name: 'Drone', threatSpeed: 30, weight: 1.5 },
      { name: 'Mortar', threatSpeed: 94, weight: 1.5 },
      { name: 'Cruise', threatSpeed: 200, weight: 1 }
    ]
    
    // Fitness function
    const fitnessFunction = async (genome: any) => {
      const settings = {
        armingDistance: genome.genes.armingDistance,
        detonationRadius: genome.genes.detonationRadius,
        optimalRadius: genome.genes.optimalRadius,
        scanRate: genome.genes.scanRate
      }
      
      // Constraint: optimal must be less than detonation
      if (settings.optimalRadius >= settings.detonationRadius) {
        return 0
      }
      
      let totalFitness = 0
      let totalWeight = 0
      
      // Run multiple simulations per scenario
      for (const scenario of scenarios) {
        let scenarioHits = 0
        let scenarioKills = 0
        let totalKillProb = 0
        let interceptorsUsed = 0
        
        // Simulate 20 intercepts per scenario
        for (let i = 0; i < 20; i++) {
          const result = simulateInterception(settings, scenario)
          
          if (result.hit) {
            scenarioHits++
            interceptorsUsed++
            totalKillProb += result.killProbability
            
            // Check if killed (probabilistic)
            if (Math.random() < result.killProbability) {
              scenarioKills++
            } else {
              // Need another interceptor
              const result2 = simulateInterception(settings, scenario)
              interceptorsUsed++
              if (result2.hit && Math.random() < result2.killProbability) {
                scenarioKills++
              }
            }
          }
        }
        
        const hitRate = scenarioHits / 20
        const killRate = scenarioKills / 20
        const avgKillProb = scenarioHits > 0 ? totalKillProb / scenarioHits : 0
        const efficiency = scenarioKills > 0 ? scenarioKills / interceptorsUsed : 0
        
        // Fitness combines multiple objectives
        const scenarioFitness = (
          hitRate * 0.2 +          // 20% - Can we hit?
          killRate * 0.3 +         // 30% - Do we destroy?
          avgKillProb * 0.3 +      // 30% - How lethal per hit?
          efficiency * 0.2         // 20% - Interceptor efficiency
        )
        
        totalFitness += scenarioFitness * scenario.weight
        totalWeight += scenario.weight
      }
      
      return totalFitness / totalWeight
    }
    
    // Run GA
    const ga = new GeneticAlgorithm(genes, fitnessFunction, {
      populationSize: 40,
      generations: 50,
      mutationRate: 0.15,
      crossoverRate: 0.7,
      elitismRate: 0.1,
      verbose: true
    })
    
    const result = await ga.run()
    
    console.log('\n=== OPTIMIZATION RESULTS ===')
    console.log('Best Settings:')
    console.log(`  Arming Distance: ${result.bestGenome.genes.armingDistance}m`)
    console.log(`  Detonation Radius: ${result.bestGenome.genes.detonationRadius}m`)
    console.log(`  Optimal Radius: ${result.bestGenome.genes.optimalRadius}m`)
    console.log(`  Scan Rate: ${result.bestGenome.genes.scanRate}`)
    console.log(`  Fitness: ${result.bestGenome.fitness!.toFixed(4)}`)
    console.log(`  Converged: ${result.converged}`)
    
    // Detailed evaluation of best settings
    console.log('\n=== DETAILED PERFORMANCE ===')
    const bestSettings = {
      armingDistance: result.bestGenome.genes.armingDistance,
      detonationRadius: result.bestGenome.genes.detonationRadius,
      optimalRadius: result.bestGenome.genes.optimalRadius,
      scanRate: result.bestGenome.genes.scanRate
    }
    
    for (const scenario of scenarios) {
      let hits = 0
      let totalKillProb = 0
      let detonationDistances: number[] = []
      
      for (let i = 0; i < 100; i++) {
        const simResult = simulateInterception(bestSettings, scenario)
        if (simResult.hit) {
          hits++
          totalKillProb += simResult.killProbability
          if (simResult.detonationDistance !== null) {
            detonationDistances.push(simResult.detonationDistance)
          }
        }
      }
      
      const avgDetonation = detonationDistances.length > 0 
        ? detonationDistances.reduce((a, b) => a + b) / detonationDistances.length 
        : 0
      
      console.log(`\n${scenario.name} (${scenario.threatSpeed} m/s):`)
      console.log(`  Hit rate: ${hits}%`)
      console.log(`  Avg kill prob: ${(totalKillProb / Math.max(1, hits) * 100).toFixed(1)}%`)
      console.log(`  Avg detonation: ${avgDetonation.toFixed(1)}m`)
    }
  })
  
  test('compare different proximity fuse configurations', async () => {
    console.log('\n=== CONFIGURATION COMPARISON ===\n')
    
    const configurations = [
      { name: 'Tight (6m/3m)', detonation: 6, optimal: 3 },
      { name: 'Original (8m/3m)', detonation: 8, optimal: 3 },
      { name: 'Balanced (8m/4m)', detonation: 8, optimal: 4 },
      { name: 'Extended (10m/5m)', detonation: 10, optimal: 5 },
      { name: 'Current (12m/6m)', detonation: 12, optimal: 6 }
    ]
    
    const scenario = { threatSpeed: 162 } // Ballistic missile
    
    for (const config of configurations) {
      let totalHits = 0
      let totalKills = 0
      let interceptorsUsed = 0
      let killProbs: number[] = []
      
      for (let i = 0; i < 100; i++) {
        const settings = {
          armingDistance: 20,
          detonationRadius: config.detonation,
          optimalRadius: config.optimal,
          scanRate: 4
        }
        
        let killed = false
        let attempts = 0
        
        // Keep firing until killed or max attempts
        while (!killed && attempts < 5) {
          attempts++
          interceptorsUsed++
          
          const result = simulateInterception(settings, scenario)
          if (result.hit) {
            totalHits++
            killProbs.push(result.killProbability)
            if (Math.random() < result.killProbability) {
              killed = true
              totalKills++
            }
          }
        }
      }
      
      const avgKillProb = killProbs.length > 0 
        ? killProbs.reduce((a, b) => a + b) / killProbs.length 
        : 0
      
      console.log(`\n${config.name}:`)
      console.log(`  Single hit rate: ${(totalHits / interceptorsUsed * 100).toFixed(1)}%`)
      console.log(`  Kill probability per hit: ${(avgKillProb * 100).toFixed(1)}%`)
      console.log(`  Final kill rate: ${totalKills}%`)
      console.log(`  Avg interceptors per kill: ${(interceptorsUsed / Math.max(1, totalKills)).toFixed(2)}`)
      console.log(`  Efficiency score: ${(totalKills / interceptorsUsed).toFixed(3)}`)
    }
  })
})