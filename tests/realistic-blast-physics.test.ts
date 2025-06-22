import { describe, test, expect } from 'bun:test'
import { BlastPhysics } from '../src/systems/BlastPhysics'
import * as THREE from 'three'

describe('Realistic Blast Physics', () => {
  test('analyze kill probability at different detonation distances', () => {
    console.log('\n=== KILL PROBABILITY BY DISTANCE ===')
    
    const distances = [3, 5, 6, 8, 10, 12, 15]
    const targetVelocity = new THREE.Vector3(-150, -60, 0) // Typical ballistic
    
    distances.forEach(distance => {
      const blastPos = new THREE.Vector3(0, 0, 0)
      const targetPos = new THREE.Vector3(distance, 0, 0)
      
      const result = BlastPhysics.calculateDamage(blastPos, targetPos, targetVelocity)
      
      console.log(`${distance}m: ${result.damageType.padEnd(8)} - Kill probability: ${(result.killProbability * 100).toFixed(0)}%`)
    })
  })
  
  test('multiple interceptor requirement analysis', () => {
    console.log('\n=== INTERCEPTORS NEEDED FOR 95% KILL ===')
    
    const detonationDistances = [3, 6, 8, 10, 12, 15]
    const targetVelocity = new THREE.Vector3(-150, -60, 0)
    
    detonationDistances.forEach(distance => {
      const blastPos = new THREE.Vector3(0, 0, 0)
      const targetPos = new THREE.Vector3(distance, 0, 0)
      
      // Calculate single interceptor kill probability
      const result = BlastPhysics.calculateDamage(blastPos, targetPos, targetVelocity)
      const singleKillProb = result.killProbability
      
      // Calculate how many interceptors needed for 95% cumulative kill probability
      // P(kill) = 1 - (1 - p)^n where p is single kill prob, n is number of interceptors
      let interceptorsNeeded = 1
      let cumulativeKillProb = singleKillProb
      
      while (cumulativeKillProb < 0.95 && interceptorsNeeded < 10) {
        interceptorsNeeded++
        cumulativeKillProb = 1 - Math.pow(1 - singleKillProb, interceptorsNeeded)
      }
      
      console.log(`Detonation at ${distance}m:`)
      console.log(`  Single interceptor: ${(singleKillProb * 100).toFixed(0)}% kill`)
      console.log(`  Interceptors for 95% kill: ${interceptorsNeeded}`)
      console.log(`  Final kill probability: ${(cumulativeKillProb * 100).toFixed(0)}%`)
    })
  })
  
  test('analyze different threat types', () => {
    console.log('\n=== THREAT TYPE ANALYSIS ===')
    
    const threats = [
      { name: 'Ballistic', velocity: new THREE.Vector3(-150, -60, 0) },
      { name: 'Drone', velocity: new THREE.Vector3(-30, 0, 0) },
      { name: 'Mortar', velocity: new THREE.Vector3(-50, -80, 0) },
      { name: 'Cruise Missile', velocity: new THREE.Vector3(-200, 0, 0) }
    ]
    
    const detonationDistance = 12 // Current proximity fuse setting
    
    threats.forEach(threat => {
      const blastPos = new THREE.Vector3(0, 0, 0)
      const targetPos = new THREE.Vector3(detonationDistance, 0, 0)
      
      const result = BlastPhysics.calculateDamage(blastPos, targetPos, threat.velocity)
      
      // Calculate interceptors needed
      let interceptorsNeeded = 1
      let cumulativeKillProb = result.killProbability
      
      while (cumulativeKillProb < 0.95 && interceptorsNeeded < 10) {
        interceptorsNeeded++
        cumulativeKillProb = 1 - Math.pow(1 - result.killProbability, interceptorsNeeded)
      }
      
      console.log(`\n${threat.name} (speed: ${threat.velocity.length().toFixed(0)} m/s):`)
      console.log(`  Kill probability at ${detonationDistance}m: ${(result.killProbability * 100).toFixed(0)}%`)
      console.log(`  Crossing factor impact: ${result.damageType}`)
      console.log(`  Interceptors needed: ${interceptorsNeeded}`)
    })
  })
  
  test('optimal proximity fuse settings', () => {
    console.log('\n=== OPTIMAL PROXIMITY FUSE ANALYSIS ===')
    
    const fuseSettings = [
      { detonation: 8, optimal: 3 },
      { detonation: 10, optimal: 5 },
      { detonation: 12, optimal: 6 },
      { detonation: 15, optimal: 8 }
    ]
    
    const targetVelocity = new THREE.Vector3(-150, -60, 0)
    
    fuseSettings.forEach(setting => {
      // Assume average detonation at 80% of max radius
      const avgDetonationDist = setting.detonation * 0.8
      const blastPos = new THREE.Vector3(0, 0, 0)
      const targetPos = new THREE.Vector3(avgDetonationDist, 0, 0)
      
      const result = BlastPhysics.calculateDamage(blastPos, targetPos, targetVelocity)
      
      // Calculate interceptors needed
      let interceptorsNeeded = 1
      let cumulativeKillProb = result.killProbability
      
      while (cumulativeKillProb < 0.95 && interceptorsNeeded < 10) {
        interceptorsNeeded++
        cumulativeKillProb = 1 - Math.pow(1 - result.killProbability, interceptorsNeeded)
      }
      
      const efficiency = 1 / interceptorsNeeded // Higher is better
      
      console.log(`\n${setting.detonation}m/${setting.optimal}m fuse:`)
      console.log(`  Avg detonation: ${avgDetonationDist.toFixed(1)}m`)
      console.log(`  Single kill prob: ${(result.killProbability * 100).toFixed(0)}%`)
      console.log(`  Interceptors needed: ${interceptorsNeeded}`)
      console.log(`  Efficiency score: ${efficiency.toFixed(2)}`)
    })
  })
})