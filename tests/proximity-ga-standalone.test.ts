// Mock window before any imports
global.window = { location: { search: '' } } as any

import { describe, test } from 'bun:test'
import { GeneticAlgorithm } from '../src/optimization/GeneticAlgorithm'

// Inline the necessary functions to avoid import issues
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

function simulateInterception(settings: any, scenario: any) {
  const baseAccuracy = 6
  const accuracyVariance = 3
  const achievedDistance = baseAccuracy + (Math.random() - 0.5) * 2 * accuracyVariance
  
  const hit = achievedDistance <= settings.detonationRadius
  
  let detonationDistance = achievedDistance
  if (hit && achievedDistance < settings.optimalRadius) {
    detonationDistance = settings.optimalRadius
  }
  
  return {
    hit,
    detonationDistance: hit ? detonationDistance : null,
    killProbability: hit ? calculateKillProbability(detonationDistance, scenario.threatSpeed) : 0
  }
}

describe('Proximity GA Standalone', () => {
  test('validate current game settings performance', async () => {
    console.log('\n=== CURRENT GAME SETTINGS VALIDATION ===\n')
    
    const currentSettings = {
      armingDistance: 15,
      detonationRadius: 9,
      optimalRadius: 2,
      scanRate: 1
    }
    
    const previousSettings = {
      armingDistance: 20,
      detonationRadius: 8,
      optimalRadius: 3,
      scanRate: 4
    }
    
    const scenarios = [
      { name: 'Ballistic', threatSpeed: 162 },
      { name: 'Drone', threatSpeed: 30 },
      { name: 'Mortar', threatSpeed: 94 },
      { name: 'Cruise', threatSpeed: 200 }
    ]
    
    console.log('Current Settings (9m/2m):')
    let currentTotalKills = 0
    let currentTotalInterceptors = 0
    
    for (const scenario of scenarios) {
      let kills = 0
      let interceptors = 0
      
      for (let i = 0; i < 100; i++) {
        let killed = false
        let attempts = 0
        
        while (!killed && attempts < 5) {
          attempts++
          interceptors++
          
          const result = simulateInterception(currentSettings, scenario)
          if (result.hit && Math.random() < result.killProbability) {
            killed = true
            kills++
          }
        }
      }
      
      currentTotalKills += kills
      currentTotalInterceptors += interceptors
      
      console.log(`  ${scenario.name}: ${kills}% kill rate, ${(interceptors / kills).toFixed(2)} interceptors/kill`)
    }
    
    console.log('\nPrevious Settings (8m/3m):')
    let previousTotalKills = 0
    let previousTotalInterceptors = 0
    
    for (const scenario of scenarios) {
      let kills = 0
      let interceptors = 0
      
      for (let i = 0; i < 100; i++) {
        let killed = false
        let attempts = 0
        
        while (!killed && attempts < 5) {
          attempts++
          interceptors++
          
          const result = simulateInterception(previousSettings, scenario)
          if (result.hit && Math.random() < result.killProbability) {
            killed = true
            kills++
          }
        }
      }
      
      previousTotalKills += kills
      previousTotalInterceptors += interceptors
      
      console.log(`  ${scenario.name}: ${kills}% kill rate, ${(interceptors / kills).toFixed(2)} interceptors/kill`)
    }
    
    console.log('\nSummary:')
    console.log(`Current (9m/2m): ${(currentTotalKills / 4).toFixed(0)}% avg kill rate, ${(currentTotalInterceptors / currentTotalKills).toFixed(2)} avg interceptors/kill`)
    console.log(`Previous (8m/3m): ${(previousTotalKills / 4).toFixed(0)}% avg kill rate, ${(previousTotalInterceptors / previousTotalKills).toFixed(2)} avg interceptors/kill`)
  })
  
  test('run focused GA optimization', async () => {
    console.log('\n=== FOCUSED GA OPTIMIZATION ===\n')
    
    const genes = [
      { name: 'detonationRadius', min: 6, max: 12, step: 0.5, type: 'float' as const },
      { name: 'optimalRadius', min: 1, max: 6, step: 0.5, type: 'float' as const }
    ]
    
    const scenarios = [
      { name: 'Ballistic', threatSpeed: 162, weight: 2 },
      { name: 'Drone', threatSpeed: 30, weight: 1 },
      { name: 'Mortar', threatSpeed: 94, weight: 1 }
    ]
    
    const fitnessFunction = async (genome: any) => {
      const settings = {
        armingDistance: 15,
        detonationRadius: genome.genes.detonationRadius,
        optimalRadius: genome.genes.optimalRadius,
        scanRate: 1
      }
      
      if (settings.optimalRadius >= settings.detonationRadius) return 0
      
      let totalFitness = 0
      let totalWeight = 0
      
      for (const scenario of scenarios) {
        let kills = 0
        let interceptors = 0
        let singleShotKills = 0
        
        const trials = 30
        
        for (let i = 0; i < trials; i++) {
          let killed = false
          let attempts = 0
          
          while (!killed && attempts < 5) {
            attempts++
            interceptors++
            
            const result = simulateInterception(settings, scenario)
            
            if (result.hit && Math.random() < result.killProbability) {
              killed = true
              kills++
              if (attempts === 1) singleShotKills++
            }
          }
        }
        
        const killRate = kills / trials
        const singleShotRate = singleShotKills / trials
        const efficiency = kills > 0 ? kills / interceptors : 0
        
        const scenarioFitness = (
          killRate * 0.4 +
          singleShotRate * 0.4 +
          efficiency * 0.2
        )
        
        totalFitness += scenarioFitness * scenario.weight
        totalWeight += scenario.weight
      }
      
      return totalFitness / totalWeight
    }
    
    const ga = new GeneticAlgorithm(genes, fitnessFunction, {
      populationSize: 20,
      generations: 30,
      mutationRate: 0.15,
      crossoverRate: 0.7,
      verbose: false
    })
    
    const result = await ga.run()
    
    console.log('Best Settings Found:')
    console.log(`  Detonation Radius: ${result.bestGenome.genes.detonationRadius}m`)
    console.log(`  Optimal Radius: ${result.bestGenome.genes.optimalRadius}m`)
    console.log(`  Fitness: ${result.bestGenome.fitness!.toFixed(4)}`)
    console.log(`  Converged: ${result.converged}`)
    
    // Validate against current settings
    const currentFitness = await fitnessFunction({
      genes: { detonationRadius: 9, optimalRadius: 2 }
    })
    
    console.log('\nComparison:')
    console.log(`  Current (9m/2m) fitness: ${currentFitness.toFixed(4)}`)
    console.log(`  GA optimized fitness: ${result.bestGenome.fitness!.toFixed(4)}`)
    console.log(`  Improvement: ${((result.bestGenome.fitness! - currentFitness) / currentFitness * 100).toFixed(1)}%`)
  })
  
  test('parameter sensitivity analysis', async () => {
    console.log('\n=== PARAMETER SENSITIVITY ===\n')
    
    const testSettings = (detonation: number, optimal: number) => {
      let totalKillProb = 0
      let hits = 0
      const trials = 100
      
      for (let i = 0; i < trials; i++) {
        const result = simulateInterception(
          { detonationRadius: detonation, optimalRadius: optimal },
          { threatSpeed: 162 }
        )
        if (result.hit) {
          hits++
          totalKillProb += result.killProbability
        }
      }
      
      return {
        hitRate: hits / trials,
        avgKillProb: hits > 0 ? totalKillProb / hits : 0
      }
    }
    
    console.log('Detonation Radius | Optimal Radius | Hit Rate | Kill Prob')
    console.log('------------------|----------------|----------|----------')
    
    const detonationRadii = [6, 7, 8, 9, 10, 11, 12]
    
    for (const detRadius of detonationRadii) {
      const optRadius = Math.min(detRadius * 0.3, detRadius - 1)
      const stats = testSettings(detRadius, optRadius)
      
      console.log(
        `${detRadius.toString().padStart(17)}m | ` +
        `${optRadius.toFixed(1).padStart(14)}m | ` +
        `${(stats.hitRate * 100).toFixed(0).padStart(8)}% | ` +
        `${(stats.avgKillProb * 100).toFixed(0).padStart(9)}%`
      )
    }
  })
})