import { describe, test } from 'bun:test'

// Mock the window object for testing
global.window = { location: { search: '' } } as any

describe('Realistic Blast Physics Analysis', () => {
  test('analyze kill probability at different detonation distances', () => {
    console.log('\n=== KILL PROBABILITY BY DISTANCE ===')
    
    // Recreate blast damage zones from game code
    const TAMIR_CONFIG = {
      lethalRadius: 3,
      severeRadius: 6,
      moderateRadius: 10,
      lightRadius: 15
    }
    
    // Calculate damage based on distance
    function calculateKillProbability(distance: number, targetSpeed: number = 150): number {
      const crossingFactor = Math.min(1, 300 / (targetSpeed + 100))
      
      if (distance <= TAMIR_CONFIG.lethalRadius) {
        return 0.95 * crossingFactor
      } else if (distance <= TAMIR_CONFIG.severeRadius) {
        const factor = 1 - Math.pow((distance - TAMIR_CONFIG.lethalRadius) / 
          (TAMIR_CONFIG.severeRadius - TAMIR_CONFIG.lethalRadius), 2)
        return (0.8 + factor * 0.15) * crossingFactor
      } else if (distance <= TAMIR_CONFIG.moderateRadius) {
        const factor = 1 - Math.pow((distance - TAMIR_CONFIG.severeRadius) / 
          (TAMIR_CONFIG.moderateRadius - TAMIR_CONFIG.severeRadius), 2)
        return (0.3 + factor * 0.5) * crossingFactor
      } else if (distance <= TAMIR_CONFIG.lightRadius) {
        const factor = 1 - Math.pow((distance - TAMIR_CONFIG.moderateRadius) / 
          (TAMIR_CONFIG.lightRadius - TAMIR_CONFIG.moderateRadius), 2)
        return factor * 0.3 * crossingFactor
      }
      return 0
    }
    
    const distances = [3, 5, 6, 8, 10, 12, 15]
    
    distances.forEach(distance => {
      const killProb = calculateKillProbability(distance)
      const damageType = 
        distance <= 3 ? 'direct' :
        distance <= 6 ? 'severe' :
        distance <= 10 ? 'moderate' :
        distance <= 15 ? 'light' : 'none'
      
      console.log(`${distance.toString().padStart(2)}m: ${damageType.padEnd(8)} - Kill probability: ${(killProb * 100).toFixed(0)}%`)
    })
  })
  
  test('multiple interceptor requirement analysis', () => {
    console.log('\n=== INTERCEPTORS NEEDED FOR 95% KILL ===')
    
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
    
    const detonationDistances = [3, 6, 8, 10, 12, 15]
    
    detonationDistances.forEach(distance => {
      const singleKillProb = calculateKillProbability(distance)
      
      // Calculate how many interceptors needed for 95% cumulative kill probability
      let interceptorsNeeded = 1
      let cumulativeKillProb = singleKillProb
      
      while (cumulativeKillProb < 0.95 && interceptorsNeeded < 10) {
        interceptorsNeeded++
        cumulativeKillProb = 1 - Math.pow(1 - singleKillProb, interceptorsNeeded)
      }
      
      console.log(`\nDetonation at ${distance}m:`)
      console.log(`  Single interceptor: ${(singleKillProb * 100).toFixed(0)}% kill`)
      console.log(`  Interceptors for 95% kill: ${interceptorsNeeded}`)
      console.log(`  Final kill probability: ${(cumulativeKillProb * 100).toFixed(0)}%`)
    })
  })
  
  test('analyze different threat types', () => {
    console.log('\n=== THREAT TYPE ANALYSIS (12m detonation) ===')
    
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
    
    const threats = [
      { name: 'Ballistic', speed: 162 }, // sqrt(150^2 + 60^2)
      { name: 'Drone', speed: 30 },
      { name: 'Mortar', speed: 94 }, // sqrt(50^2 + 80^2)
      { name: 'Cruise Missile', speed: 200 }
    ]
    
    const detonationDistance = 12
    
    threats.forEach(threat => {
      const killProb = calculateKillProbability(detonationDistance, threat.speed)
      
      // Calculate interceptors needed
      let interceptorsNeeded = 1
      let cumulativeKillProb = killProb
      
      while (cumulativeKillProb < 0.95 && interceptorsNeeded < 10) {
        interceptorsNeeded++
        cumulativeKillProb = 1 - Math.pow(1 - killProb, interceptorsNeeded)
      }
      
      console.log(`\n${threat.name} (${threat.speed} m/s):`)
      console.log(`  Kill probability at ${detonationDistance}m: ${(killProb * 100).toFixed(0)}%`)
      console.log(`  Interceptors needed: ${interceptorsNeeded}`)
      console.log(`  Cumulative kill prob: ${(cumulativeKillProb * 100).toFixed(0)}%`)
    })
  })
  
  test('optimal proximity fuse settings for efficiency', () => {
    console.log('\n=== OPTIMAL SETTINGS FOR SINGLE-SHOT KILL ===')
    
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
    
    const fuseSettings = [
      { detonation: 6, optimal: 3, name: 'Tight (original concept)' },
      { detonation: 8, optimal: 3, name: 'Conservative (original game)' },
      { detonation: 10, optimal: 5, name: 'Balanced' },
      { detonation: 12, optimal: 6, name: 'Forgiving (current)' },
      { detonation: 15, optimal: 8, name: 'Very forgiving' }
    ]
    
    console.log('For ballistic threat (162 m/s):')
    fuseSettings.forEach(setting => {
      // Assume guidance achieves optimal + 20-50% overshoot
      const typicalDetonationDist = setting.optimal * 1.35
      const worstCaseDetonationDist = setting.detonation * 0.9
      
      const typicalKill = calculateKillProbability(typicalDetonationDist, 162)
      const worstKill = calculateKillProbability(worstCaseDetonationDist, 162)
      
      console.log(`\n${setting.name} (${setting.detonation}m/${setting.optimal}m):`)
      console.log(`  Typical detonation at ${typicalDetonationDist.toFixed(1)}m: ${(typicalKill * 100).toFixed(0)}% kill`)
      console.log(`  Worst case at ${worstCaseDetonationDist.toFixed(1)}m: ${(worstKill * 100).toFixed(0)}% kill`)
    })
  })
})