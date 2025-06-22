// Global mocks must be set before imports
global.window = { location: { search: '' } } as any

import { describe, test } from 'bun:test'
import { GeneticAlgorithm } from '../src/optimization/GeneticAlgorithm'

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

describe('Proximity Fuse Kill Probability Optimization', () => {
  test('optimize for maximum kill probability', async () => {
    console.log('\n=== KILL PROBABILITY FOCUSED OPTIMIZATION ===\n')
    
    // Define parameter genes
    const genes = [
      { name: 'armingDistance', min: 10, max: 50, step: 5, type: 'int' as const },
      { name: 'detonationRadius', min: 4, max: 15, step: 0.5, type: 'float' as const },
      { name: 'optimalRadius', min: 2, max: 8, step: 0.5, type: 'float' as const },
      { name: 'scanRate', min: 1, max: 8, step: 1, type: 'int' as const }
    ]
    
    // Test scenarios with realistic threat speeds
    const scenarios = [
      { name: 'Ballistic', threatSpeed: 162, weight: 2 },
      { name: 'Drone', threatSpeed: 30, weight: 1.5 },
      { name: 'Mortar', threatSpeed: 94, weight: 1.5 },
      { name: 'Cruise', threatSpeed: 200, weight: 1 }
    ]
    
    // FITNESS FUNCTION FOCUSED ON KILL PROBABILITY
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
        let totalKills = 0
        let totalInterceptors = 0
        let totalSingleShotKills = 0
        
        // Simulate 50 engagements per scenario
        const numEngagements = 50
        
        for (let i = 0; i < numEngagements; i++) {
          let killed = false
          let attempts = 0
          let firstShotKill = false
          
          // Keep firing until killed or max attempts (simulating salvo)
          while (!killed && attempts < 5) {
            attempts++
            totalInterceptors++
            
            const result = simulateInterception(settings, scenario)
            
            // Check if this interceptor kills the threat
            if (result.hit && Math.random() < result.killProbability) {
              killed = true
              totalKills++
              if (attempts === 1) {
                firstShotKill = true
                totalSingleShotKills++
              }
            }
          }
        }
        
        // Calculate metrics
        const killRate = totalKills / numEngagements
        const singleShotKillRate = totalSingleShotKills / numEngagements
        const avgInterceptorsPerKill = totalKills > 0 ? totalInterceptors / totalKills : 10
        
        // FITNESS COMPONENTS (Prioritizing kill probability)
        // 1. Overall kill rate (can we eventually destroy the threat?)
        // 2. Single-shot kill rate (how often do we kill on first try?)
        // 3. Efficiency penalty (fewer interceptors is better)
        
        const efficiencyScore = Math.max(0, 1 - (avgInterceptorsPerKill - 1) / 4) // 1 interceptor = 1.0, 5 interceptors = 0
        
        const scenarioFitness = (
          killRate * 0.4 +              // 40% - Ultimate success rate
          singleShotKillRate * 0.5 +    // 50% - First shot effectiveness
          efficiencyScore * 0.1         // 10% - Resource efficiency
        )
        
        totalFitness += scenarioFitness * scenario.weight
        totalWeight += scenario.weight
      }
      
      return totalFitness / totalWeight
    }
    
    // Run GA with focus on convergence
    const ga = new GeneticAlgorithm(genes, fitnessFunction, {
      populationSize: 60,
      generations: 80,
      mutationRate: 0.12,
      crossoverRate: 0.75,
      elitismRate: 0.15,
      convergenceThreshold: 0.0005,
      verbose: true
    })
    
    const result = await ga.run()
    
    console.log('\n=== OPTIMIZATION RESULTS ===')
    console.log('Best Settings for Maximum Kill Probability:')
    console.log(`  Arming Distance: ${result.bestGenome.genes.armingDistance}m`)
    console.log(`  Detonation Radius: ${result.bestGenome.genes.detonationRadius}m`)
    console.log(`  Optimal Radius: ${result.bestGenome.genes.optimalRadius}m`)
    console.log(`  Scan Rate: ${result.bestGenome.genes.scanRate}`)
    console.log(`  Fitness: ${result.bestGenome.fitness!.toFixed(4)}`)
    console.log(`  Converged: ${result.converged}`)
    
    // Detailed evaluation of best settings
    console.log('\n=== DETAILED KILL PERFORMANCE ===')
    const bestSettings = {
      armingDistance: result.bestGenome.genes.armingDistance,
      detonationRadius: result.bestGenome.genes.detonationRadius,
      optimalRadius: result.bestGenome.genes.optimalRadius,
      scanRate: result.bestGenome.genes.scanRate
    }
    
    for (const scenario of scenarios) {
      let totalKills = 0
      let totalInterceptors = 0
      let singleShotKills = 0
      let detonationDistances: number[] = []
      let killProbabilities: number[] = []
      
      const numTests = 200
      
      for (let i = 0; i < numTests; i++) {
        let killed = false
        let attempts = 0
        
        while (!killed && attempts < 5) {
          attempts++
          totalInterceptors++
          
          const result = simulateInterception(bestSettings, scenario)
          
          if (result.hit) {
            if (result.detonationDistance !== null) {
              detonationDistances.push(result.detonationDistance)
              killProbabilities.push(result.killProbability)
            }
            
            if (Math.random() < result.killProbability) {
              killed = true
              totalKills++
              if (attempts === 1) singleShotKills++
            }
          }
        }
      }
      
      const avgDetonation = detonationDistances.length > 0 
        ? detonationDistances.reduce((a, b) => a + b) / detonationDistances.length 
        : 0
      
      const avgKillProb = killProbabilities.length > 0
        ? killProbabilities.reduce((a, b) => a + b) / killProbabilities.length
        : 0
      
      console.log(`\n${scenario.name} (${scenario.threatSpeed} m/s):`)
      console.log(`  Kill rate: ${(totalKills / numTests * 100).toFixed(1)}%`)
      console.log(`  Single-shot kill rate: ${(singleShotKills / numTests * 100).toFixed(1)}%`)
      console.log(`  Avg kill prob per hit: ${(avgKillProb * 100).toFixed(1)}%`)
      console.log(`  Avg detonation distance: ${avgDetonation.toFixed(1)}m`)
      console.log(`  Interceptors per kill: ${(totalInterceptors / totalKills).toFixed(2)}`)
    }
  })
  
  test('analyze kill probability vs detonation radius tradeoff', async () => {
    console.log('\n=== KILL PROBABILITY VS DETONATION RADIUS ===\n')
    
    const radii = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
    const scenario = { threatSpeed: 162 } // Ballistic missile
    
    console.log('Detonation | Avg Det | Single Kill | Total Kill | Interceptors')
    console.log('Radius (m) | Dist(m) | Rate (%)    | Rate (%)   | per Kill')
    console.log('-----------|---------|-------------|------------|-------------')
    
    for (const radius of radii) {
      const settings = {
        armingDistance: 20,
        detonationRadius: radius,
        optimalRadius: Math.min(radius * 0.4, radius - 1), // Reasonable optimal
        scanRate: 4
      }
      
      let totalKills = 0
      let singleShotKills = 0
      let totalInterceptors = 0
      let detonationDistances: number[] = []
      
      const numTests = 200
      
      for (let i = 0; i < numTests; i++) {
        let killed = false
        let attempts = 0
        
        while (!killed && attempts < 5) {
          attempts++
          totalInterceptors++
          
          const result = simulateInterception(settings, scenario)
          
          if (result.hit) {
            if (result.detonationDistance !== null) {
              detonationDistances.push(result.detonationDistance)
            }
            
            if (Math.random() < result.killProbability) {
              killed = true
              totalKills++
              if (attempts === 1) singleShotKills++
            }
          }
        }
      }
      
      const avgDetonation = detonationDistances.length > 0 
        ? detonationDistances.reduce((a, b) => a + b) / detonationDistances.length 
        : 0
      
      const killRate = totalKills / numTests * 100
      const singleKillRate = singleShotKills / numTests * 100
      const interceptorsPerKill = totalKills > 0 ? totalInterceptors / totalKills : 999
      
      console.log(
        `${radius.toString().padStart(10)} | ` +
        `${avgDetonation.toFixed(1).padStart(7)} | ` +
        `${singleKillRate.toFixed(1).padStart(11)} | ` +
        `${killRate.toFixed(1).padStart(10)} | ` +
        `${interceptorsPerKill.toFixed(2).padStart(11)}`
      )
    }
    
    console.log('\nKey Insights:')
    console.log('- Smaller radii have higher kill probability per hit')
    console.log('- Larger radii have higher hit rates but lower kill probability')
    console.log('- Optimal balance appears to be in the 6-8m range')
  })
})