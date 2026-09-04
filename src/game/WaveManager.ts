import { EventEmitter } from 'events';
import { ThreatManager } from '../scene/ThreatManager';
import { GameState } from './GameState';

export interface WaveConfig {
  waveNumber: number;
  threatCount: number;
  threatTypes: string[];
  spawnRate: number; // threats per second
  duration: number; // seconds
  difficultyMultiplier: number;
  salvoChance?: number; // chance of salvo attacks
}

/** Wave progression advances only by executed simulation steps. Duration is a pacing
 * estimate; completion additionally requires all scheduled threats and payloads to resolve. */
export class WaveManager extends EventEmitter {
  private currentWave = 0;
  private isWaveActive = false;
  private threatsSpawnedInWave = 0;
  private threatsDestroyedInWave = 0;
  private elapsed = 0;
  private failedResolutions = 0;
  private isPaused = false;
  private phase: 'idle' | 'preparing' | 'active' | 'intermission' = 'idle';
  private remaining = 0;
  private spawnRemaining = 0;
  private config: WaveConfig | null = null;
  private readonly preparationTime = 15;
  private gameState: GameState;
  private readonly onOutcome = ({
    threat,
    reason,
  }: {
    threat: { waveId: number | null };
    reason: string;
  }) => {
    if (!this.isWaveActive || threat.waveId !== this.currentWave) return;
    if (reason === 'intercepted') this.threatsDestroyedInWave++;
    if (reason === 'impact' || reason === 'expired' || reason === 'capacity-removed')
      this.failedResolutions++;
  };

  constructor(
    private threatManager: ThreatManager,
    gameState = GameState.getInstance()
  ) {
    super();
    this.gameState = gameState;
    this.threatManager.on('threatTerminated', this.onOutcome);
  }

  startGame(): void {
    this.phase = 'idle';
    this.isWaveActive = false;
    this.threatManager.clearAll();
    this.currentWave = 0;
    this.isPaused = false;
    this.nextWave();
  }

  update(deltaTime: number): void {
    if (!Number.isFinite(deltaTime) || deltaTime < 0) throw new RangeError('Invalid wave delta');
    if (this.isPaused || this.phase === 'idle') return;
    if (this.phase === 'preparing' || this.phase === 'intermission') {
      this.remaining = Math.max(0, this.remaining - deltaTime);
      if (this.phase === 'preparing')
        this.emit('preparationProgress', { remaining: this.remaining });
      if (this.remaining <= 1e-9) {
        if (this.phase === 'preparing') this.startWave(this.generateWaveConfig(this.currentWave));
        else this.nextWave();
      }
      return;
    }
    const config = this.config!;
    this.elapsed += deltaTime;
    this.spawnRemaining -= deltaTime;
    while (this.spawnRemaining <= 1e-9 && this.threatsSpawnedInWave < config.threatCount) {
      // Preserve configured categories (including duplicate weights) instead of selecting only index zero.
      const type = config.threatTypes[this.threatsSpawnedInWave % config.threatTypes.length];
      this.threatManager.setThreatMix(
        type === 'rockets' || type === 'mortars' || type === 'drones' ? type : 'all'
      );
      this.threatManager.spawnSingleThreat(0, this.currentWave);
      this.threatsSpawnedInWave++;
      this.spawnRemaining += 1 / config.spawnRate;
    }
    this.checkWaveCompletion();
  }

  private generateWaveConfig(waveNumber: number): WaveConfig {
    // Base configuration
    const baseThreats = 5;
    const threatsPerWave = 3;
    const baseDuration = 30;

    // More gradual difficulty scaling
    const difficultyFactor = Math.pow(1.08, waveNumber - 1); // 8% harder each wave (was 15%)

    // Calculate wave parameters with exponential growth
    const threatCount = Math.floor(
      baseThreats + (waveNumber - 1) * threatsPerWave * difficultyFactor
    );
    const duration = baseDuration + Math.floor(waveNumber / 3) * 5; // Slightly longer waves

    // Spawn rate increases moderately with waves
    const baseSpawnRate = 0.5;
    const spawnRate = Math.min(baseSpawnRate + waveNumber * 0.1, 2.0); // Cap at 2 threats/second

    // Determine threat types based on wave
    let threatTypes: string[] = ['rockets'];

    if (waveNumber >= 2) {
      threatTypes.push('mortars');
    }
    if (waveNumber >= 4) {
      threatTypes.push('drones');
    }
    if (waveNumber >= 6) {
      threatTypes.push('rockets'); // Double rockets
    }
    if (waveNumber >= 8) {
      threatTypes = ['mixed']; // All types
    }

    // Every 10th wave is a "boss" wave with increased difficulty
    const isBossWave = waveNumber % 10 === 0;
    const bossMultiplier = isBossWave ? 2.0 : 1.0; // Boss waves are significantly harder

    // Salvo attacks become more common in later waves
    const salvoChance = Math.min(0.1 + waveNumber * 0.05, 0.6); // Up to 60% salvo chance

    return {
      waveNumber,
      threatCount: Math.floor(threatCount * bossMultiplier),
      threatTypes,
      spawnRate: spawnRate * bossMultiplier,
      duration,
      difficultyMultiplier: difficultyFactor * bossMultiplier,
      salvoChance, // Store for threat manager
    };
  }

  private nextWave(): void {
    this.currentWave++;
    this.gameState.setCurrentWave(this.currentWave);
    this.phase = 'preparing';
    this.remaining = this.preparationTime;
    this.emit('wavePreparation', {
      waveNumber: this.currentWave,
      preparationTime: this.preparationTime,
      waveConfig: this.generateWaveConfig(this.currentWave),
    });
  }

  private startWave(config: WaveConfig): void {
    this.config = config;
    this.phase = 'active';
    this.isWaveActive = true;
    this.threatsSpawnedInWave = 0;
    this.threatsDestroyedInWave = 0;
    this.failedResolutions = 0;
    this.elapsed = 0;
    this.spawnRemaining = 1 / config.spawnRate;
    this.threatManager.stopSpawning();
    this.threatManager.setSalvoChance(config.salvoChance ?? 0);
    this.emit('waveStarted', {
      waveNumber: this.currentWave,
      totalThreats: config.threatCount,
      duration: config.duration,
    });
  }

  private checkWaveCompletion(): void {
    if (!this.isWaveActive || !this.config || this.isPaused) return;
    const active = this.threatManager
      .getActiveThreats()
      .filter(threat => threat.waveId === this.currentWave).length;
    this.emit('waveProgress', {
      spawned: this.threatsSpawnedInWave,
      destroyed: this.threatsDestroyedInWave,
      total: this.config.threatCount,
      active,
    });
    if (this.threatsSpawnedInWave >= this.config.threatCount && active === 0) this.endWave();
  }

  private endWave(): void {
    if (!this.isWaveActive || !this.config || this.isPaused) return;
    this.isWaveActive = false;
    this.phase = 'intermission';
    this.remaining = 3;
    this.threatManager.stopSpawning();
    const total = this.config.threatCount;
    // Payload kills may exceed parent launches; rewards stay bounded by the configured wave budget.
    const ratio = Math.min(1, this.threatsDestroyedInWave / total);
    const perfect = ratio === 1 && this.failedResolutions === 0;
    const base = 100 * this.currentWave;
    const credits = base + Math.floor(base * ratio) + (perfect ? base * 0.5 : 0);
    const score = Math.floor(
      Math.min(total, this.threatsDestroyedInWave) * 100 * this.currentWave * (perfect ? 1.5 : 1)
    );
    this.gameState.addCredits(credits);
    this.gameState.addScore(score);
    if (perfect) this.gameState.recordPerfectWave();
    this.emit('waveCompleted', {
      waveNumber: this.currentWave,
      threatsDestroyed: this.threatsDestroyedInWave,
      totalThreats: total,
      creditsEarned: credits,
      scoreEarned: score,
      isPerfect: perfect,
    });
  }

  pauseWave(): void {
    this.isPaused = true;
    this.emit('wavePaused');
  }
  resumeWave(): void {
    this.isPaused = false;
    this.emit('waveResumed');
  }
  skipPreparation(): void {
    if (this.phase === 'preparing' && !this.isPaused)
      this.startWave(this.generateWaveConfig(this.currentWave));
  }
  getCurrentWaveInfo() {
    return {
      waveNumber: this.currentWave,
      isActive: this.isWaveActive,
      threatsSpawned: this.threatsSpawnedInWave,
      threatsDestroyed: this.threatsDestroyedInWave,
      totalThreats:
        this.config?.threatCount ?? this.generateWaveConfig(this.currentWave).threatCount,
      timeElapsed: this.elapsed,
      preparationRemaining: this.phase === 'preparing' ? this.remaining : 0,
    };
  }
  destroy(): void {
    this.phase = 'idle';
    this.isWaveActive = false;
    this.threatManager.off('threatTerminated', this.onOutcome);
    this.removeAllListeners();
  }
}
