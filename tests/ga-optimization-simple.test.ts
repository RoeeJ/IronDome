// Set up global mocks before any imports
global.window = { location: { search: '' } } as any

import { describe, test, expect } from 'bun:test'
import { GeneticAlgorithm } from '../src/optimization/GeneticAlgorithm'

describe('Simple GA Optimization Test', () => {
  test('optimize simple quadratic function', async () => {
    console.log('\n=== SIMPLE GA TEST - Find minimum of (x-5)² + (y-3)² ===\n')
    
    // Define genes for x and y coordinates
    const genes = [
      { name: 'x', min: -10, max: 10, type: 'float' as const },
      { name: 'y', min: -10, max: 10, type: 'float' as const }
    ]
    
    // Fitness function - we want to minimize distance to (5, 3)
    // GA maximizes fitness, so we use negative distance
    const fitnessFunction = async (genome: any) => {
      const x = genome.genes.x
      const y = genome.genes.y
      const distance = Math.sqrt((x - 5) ** 2 + (y - 3) ** 2)
      return -distance // Negative because GA maximizes
    }
    
    const ga = new GeneticAlgorithm(genes, fitnessFunction, {
      populationSize: 30,
      generations: 50,
      mutationRate: 0.15,
      crossoverRate: 0.7,
      verbose: false
    })
    
    const result = await ga.run()
    
    console.log('\n=== RESULTS ===')
    console.log('Target: (5, 3)')
    console.log(`Found: (${result.bestGenome.genes.x.toFixed(2)}, ${result.bestGenome.genes.y.toFixed(2)})`)
    console.log(`Distance from target: ${Math.abs(result.bestGenome.fitness!).toFixed(4)}`)
    console.log(`Converged: ${result.converged}`)
    
    // Check if we got reasonably close to the target
    expect(Math.abs(result.bestGenome.genes.x - 5)).toBeLessThan(2.0)
    expect(Math.abs(result.bestGenome.genes.y - 3)).toBeLessThan(2.0)
  })
  
  test('optimize proximity fuse parameters with simple fitness', async () => {
    console.log('\n=== PROXIMITY FUSE PARAMETER OPTIMIZATION (SIMPLIFIED) ===\n')
    
    const genes = [
      { name: 'detonationRadius', min: 4, max: 15, step: 0.5, type: 'float' as const },
      { name: 'optimalRadius', min: 2, max: 8, step: 0.5, type: 'float' as const }
    ]
    
    // Simplified fitness function based on blast physics
    const fitnessFunction = async (genome: any) => {
      const detonation = genome.genes.detonationRadius
      const optimal = genome.genes.optimalRadius
      
      // Invalid if optimal >= detonation
      if (optimal >= detonation) return 0
      
      // Simplified kill probability model
      const avgDetonationDist = detonation * 0.8 // Assume 80% of max
      
      // Kill probability based on distance (simplified from BlastPhysics)
      let killProb = 0
      if (avgDetonationDist <= 3) killProb = 0.95
      else if (avgDetonationDist <= 6) killProb = 0.8 - (avgDetonationDist - 3) * 0.15 / 3
      else if (avgDetonationDist <= 10) killProb = 0.5 - (avgDetonationDist - 6) * 0.2 / 4
      else if (avgDetonationDist <= 15) killProb = 0.3 - (avgDetonationDist - 10) * 0.25 / 5
      
      // Hit rate based on detonation radius (larger = easier to hit)
      const hitRate = Math.min(0.95, 0.6 + (detonation - 4) * 0.03)
      
      // Efficiency penalty for oversized detonation radius
      const efficiencyPenalty = 1 - (detonation - 6) / 20
      
      // Combined fitness
      return hitRate * 0.3 + killProb * 0.5 + efficiencyPenalty * 0.2
    }
    
    const ga = new GeneticAlgorithm(genes, fitnessFunction, {
      populationSize: 30,
      generations: 40,
      mutationRate: 0.15,
      crossoverRate: 0.7,
      verbose: false
    })
    
    const result = await ga.run()
    
    console.log('Best Parameters:')
    console.log(`  Detonation Radius: ${result.bestGenome.genes.detonationRadius.toFixed(1)}m`)
    console.log(`  Optimal Radius: ${result.bestGenome.genes.optimalRadius.toFixed(1)}m`)
    console.log(`  Fitness Score: ${result.bestGenome.fitness!.toFixed(4)}`)
    
    // Analyze the result
    const detonation = result.bestGenome.genes.detonationRadius
    const optimal = result.bestGenome.genes.optimalRadius
    const avgDist = detonation * 0.8
    
    console.log('\nAnalysis:')
    console.log(`  Ratio optimal/detonation: ${(optimal / detonation).toFixed(2)}`)
    console.log(`  Expected avg detonation distance: ${avgDist.toFixed(1)}m`)
    
    // Expected behavior: should find a balance between hit rate and kill probability
    expect(detonation).toBeGreaterThanOrEqual(4)
    expect(detonation).toBeLessThan(12)
    expect(optimal).toBeLessThan(detonation)
    expect(optimal / detonation).toBeGreaterThan(0.2)
    expect(optimal / detonation).toBeLessThan(0.95)
  })
})