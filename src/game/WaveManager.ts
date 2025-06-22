import { EventEmitter } from 'events'
import { ThreatManager } from '../scene/ThreatManager'
import { GameState } from './GameState'

export interface WaveConfig {
  waveNumber: number
  threatCount: number
  threatTypes: string[]
  spawnRate: number // threats per second
  duration: number // seconds
  difficultyMultiplier: number
  salvoChance?: number // chance of salvo attacks
}

export class WaveManager extends EventEmitter {
  private currentWave: number = 0
  private isWaveActive: boolean = false
  private threatsSpawnedInWave: number = 0
  private threatsDestroyedInWave: number = 0
  private waveStartTime: number = 0
  private spawnTimer: NodeJS.Timeout | null = null
  private waveTimer: NodeJS.Timeout | null = null
  private threatManager: ThreatManager
  private gameState: GameState
  private isPaused: boolean = false
  
  // Wave preparation phase
  private preparationTime: number = 15000 // 15 seconds between waves
  private preparationTimer: NodeJS.Timeout | null = null
  private nextWaveTimer: NodeJS.Timeout | null = null
  
  constructor(threatManager: ThreatManager) {
    super()
    this.threatManager = threatManager
    this.gameState = GameState.getInstance()
    
    // Listen to threat destruction
    this.threatManager.on('threatDestroyed', () => {
      if (this.isWaveActive) {
        this.threatsDestroyedInWave++
        this.checkWaveCompletion()
      }
    })
    
    this.threatManager.on('threatMissed', () => {
      if (this.isWaveActive) {
        this.checkWaveCompletion()
      }
    })
  }
  
  startGame(): void {
    // Clear any existing threats first
    this.threatManager.clearAll()
    
    // Reset wave state
    this.currentWave = 0
    this.isWaveActive = false
    this.threatsSpawnedInWave = 0
    this.threatsDestroyedInWave = 0
    
    // Clear any existing timers
    if (this.spawnTimer) {
      clearInterval(this.spawnTimer)
      this.spawnTimer = null
    }
    if (this.waveTimer) {
      clearTimeout(this.waveTimer)
      this.waveTimer = null
    }
    if (this.preparationTimer) {
      clearTimeout(this.preparationTimer)
      this.preparationTimer = null
    }
    if (this.nextWaveTimer) {
      clearTimeout(this.nextWaveTimer)
      this.nextWaveTimer = null
    }
    
    // Start first wave
    this.nextWave()
  }
  
  private generateWaveConfig(waveNumber: number): WaveConfig {
    // Base configuration
    const baseThreats = 5
    const threatsPerWave = 3
    const baseDuration = 30
    
    // More gradual difficulty scaling
    const difficultyFactor = Math.pow(1.08, waveNumber - 1) // 8% harder each wave (was 15%)
    
    // Calculate wave parameters with exponential growth
    const threatCount = Math.floor(baseThreats + (waveNumber - 1) * threatsPerWave * difficultyFactor)
    const duration = baseDuration + Math.floor(waveNumber / 3) * 5 // Slightly longer waves
    
    // Spawn rate increases moderately with waves
    const baseSpawnRate = 0.5
    const spawnRate = Math.min(baseSpawnRate + (waveNumber * 0.1), 2.0) // Cap at 2 threats/second
    
    // Determine threat types based on wave
    let threatTypes: string[] = ['rockets']
    
    if (waveNumber >= 2) {
      threatTypes.push('mortars')
    }
    if (waveNumber >= 4) {
      threatTypes.push('drones')
    }
    if (waveNumber >= 6) {
      threatTypes.push('rockets') // Double rockets
    }
    if (waveNumber >= 8) {
      threatTypes = ['mixed'] // All types
    }
    
    // Every 10th wave is a "boss" wave with increased difficulty
    const isBossWave = waveNumber % 10 === 0
    const bossMultiplier = isBossWave ? 2.0 : 1.0 // Boss waves are significantly harder
    
    // Salvo attacks become more common in later waves
    const salvoChance = Math.min(0.1 + (waveNumber * 0.05), 0.6) // Up to 60% salvo chance
    
    return {
      waveNumber,
      threatCount: Math.floor(threatCount * bossMultiplier),
      threatTypes,
      spawnRate: spawnRate * bossMultiplier,
      duration,
      difficultyMultiplier: difficultyFactor * bossMultiplier,
      salvoChance // Store for threat manager
    }
  }
  
  private nextWave(): void {
    // Clear any existing preparation timer
    if (this.preparationTimer) {
      clearTimeout(this.preparationTimer)
      this.preparationTimer = null
    }
    
    this.currentWave++
    this.gameState.setCurrentWave(this.currentWave)
    
    const waveConfig = this.generateWaveConfig(this.currentWave)
    
    // Emit wave preparation event
    this.emit('wavePreparation', {
      waveNumber: this.currentWave,
      preparationTime: this.preparationTime / 1000,
      waveConfig
    })
    
    // Start preparation phase
    this.preparationTimer = setTimeout(() => {
      this.startWave(waveConfig)
    }, this.preparationTime)
  }
  
  private startWave(config: WaveConfig): void {
    this.isWaveActive = true
    this.threatsSpawnedInWave = 0
    this.threatsDestroyedInWave = 0
    this.waveStartTime = Date.now()
    
    // Stop any existing threat spawning
    this.threatManager.stopSpawning()
    
    // Configure threat manager for this wave
    if (config.threatTypes.includes('mixed')) {
      this.threatManager.setThreatMix('all')
    } else {
      this.threatManager.setThreatMix(config.threatTypes[0] as any)
    }
    
    // Set salvo chance if specified
    if (config.salvoChance !== undefined) {
      this.threatManager.setSalvoChance(config.salvoChance)
    }
    
    this.emit('waveStarted', {
      waveNumber: this.currentWave,
      totalThreats: config.threatCount,
      duration: config.duration
    })
    
    // Start spawning threats
    const spawnInterval = 1000 / config.spawnRate
    let threatsToSpawn = config.threatCount
    
    this.spawnTimer = setInterval(() => {
      if (!this.isPaused && threatsToSpawn > 0) {
        this.threatManager['spawnSingleThreat']()
        threatsToSpawn--
        this.threatsSpawnedInWave++
        
        this.emit('waveProgress', {
          spawned: this.threatsSpawnedInWave,
          destroyed: this.threatsDestroyedInWave,
          total: config.threatCount
        })
        
        if (threatsToSpawn === 0) {
          clearInterval(this.spawnTimer!)
          this.spawnTimer = null
        }
      }
    }, spawnInterval)
    
    // End wave after duration
    this.waveTimer = setTimeout(() => {
      this.endWave()
    }, config.duration * 1000)
  }
  
  private checkWaveCompletion(): void {
    const activeThreats = this.threatManager.getActiveThreats().length
    const allSpawned = this.threatsSpawnedInWave >= this.generateWaveConfig(this.currentWave).threatCount
    
    this.emit('waveProgress', {
      spawned: this.threatsSpawnedInWave,
      destroyed: this.threatsDestroyedInWave,
      total: this.generateWaveConfig(this.currentWave).threatCount,
      active: activeThreats
    })
    
    // Check if wave is complete (all threats spawned and dealt with)
    if (allSpawned && activeThreats === 0) {
      this.endWave()
    }
  }
  
  private endWave(): void {
    // Guard against multiple calls
    if (!this.isWaveActive) {
      return
    }
    
    this.isWaveActive = false
    
    // Clear timers
    if (this.spawnTimer) {
      clearInterval(this.spawnTimer)
      this.spawnTimer = null
    }
    if (this.waveTimer) {
      clearTimeout(this.waveTimer)
      this.waveTimer = null
    }
    
    // Stop threat spawning
    this.threatManager.stopSpawning()
    
    // Calculate wave results
    const waveConfig = this.generateWaveConfig(this.currentWave)
    const destroyedRatio = this.threatsDestroyedInWave / waveConfig.threatCount
    const isPerfectWave = destroyedRatio === 1.0
    
    // Award credits based on performance
    const baseCredits = 100 * this.currentWave
    const performanceBonus = Math.floor(baseCredits * destroyedRatio)
    const perfectBonus = isPerfectWave ? baseCredits * 0.5 : 0
    const totalCredits = baseCredits + performanceBonus + perfectBonus
    
    this.gameState.addCredits(totalCredits)
    
    if (isPerfectWave) {
      this.gameState.recordPerfectWave()
    }
    
    // Calculate score
    const waveScore = Math.floor(
      (this.threatsDestroyedInWave * 100) * 
      this.currentWave * 
      (isPerfectWave ? 1.5 : 1.0)
    )
    this.gameState.addScore(waveScore)
    
    this.emit('waveCompleted', {
      waveNumber: this.currentWave,
      threatsDestroyed: this.threatsDestroyedInWave,
      totalThreats: waveConfig.threatCount,
      creditsEarned: totalCredits,
      scoreEarned: waveScore,
      isPerfect: isPerfectWave
    })
    
    // Clear any existing next wave timer
    if (this.nextWaveTimer) {
      clearTimeout(this.nextWaveTimer)
      this.nextWaveTimer = null
    }
    
    // Start next wave after delay
    this.nextWaveTimer = setTimeout(() => {
      this.nextWave()
      this.nextWaveTimer = null
    }, 3000) // 3 second delay before preparation phase
  }
  
  pauseWave(): void {
    this.isPaused = true
    this.threatManager.stopSpawning()
    this.emit('wavePaused')
  }
  
  resumeWave(): void {
    this.isPaused = false
    this.emit('waveResumed')
  }
  
  skipPreparation(): void {
    if (this.preparationTimer) {
      clearTimeout(this.preparationTimer)
      this.preparationTimer = null
      const waveConfig = this.generateWaveConfig(this.currentWave)
      this.startWave(waveConfig)
    }
  }
  
  getCurrentWaveInfo() {
    const config = this.generateWaveConfig(this.currentWave)
    return {
      waveNumber: this.currentWave,
      isActive: this.isWaveActive,
      threatsSpawned: this.threatsSpawnedInWave,
      threatsDestroyed: this.threatsDestroyedInWave,
      totalThreats: config.threatCount,
      timeElapsed: this.isWaveActive ? (Date.now() - this.waveStartTime) / 1000 : 0
    }
  }
  
  destroy(): void {
    if (this.spawnTimer) clearInterval(this.spawnTimer)
    if (this.waveTimer) clearTimeout(this.waveTimer)
    if (this.preparationTimer) clearTimeout(this.preparationTimer)
    if (this.nextWaveTimer) clearTimeout(this.nextWaveTimer)
    this.removeAllListeners()
  }
}