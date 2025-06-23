import { EventEmitter } from 'events';

export interface GameData {
  // Player progress
  currentWave: number;
  highestWave: number;
  totalScore: number;
  highScore: number;

  // Resources
  credits: number;
  interceptorStock: number;

  // Unlocks and upgrades
  unlockedDomes: number;
  domePlacements: Array<{
    id: string;
    position: { x: number; z: number };
    level: number;
  }>;
  autoRepairLevel: number; // 0 = off, 1 = slow, 2 = medium, 3 = fast

  // Statistics
  totalInterceptions: number;
  totalMisses: number;
  totalThreatsDestroyed: number;
  perfectWaves: number;

  // Settings
  soundEnabled: boolean;
  effectsQuality: 'low' | 'medium' | 'high';
}

export class GameState extends EventEmitter {
  private static instance: GameState;
  private data: GameData;
  private readonly STORAGE_KEY = 'ironDomeGameState';
  private readonly DEFAULT_STATE: GameData = {
    currentWave: 1,
    highestWave: 1,
    totalScore: 0,
    highScore: 0,
    credits: 1000,
    interceptorStock: 100,
    unlockedDomes: 1,
    domePlacements: [],
    autoRepairLevel: 0,
    totalInterceptions: 0,
    totalMisses: 0,
    totalThreatsDestroyed: 0,
    perfectWaves: 0,
    soundEnabled: true,
    effectsQuality: 'medium',
  };

  private constructor() {
    super();
    this.data = this.loadState();

    // Ensure we have at least one battery placement
    if (!this.data.domePlacements || this.data.domePlacements.length === 0) {
      this.data.domePlacements = [
        {
          id: 'battery_initial',
          position: { x: 0, z: 0 },
          level: 1,
        },
      ];
      this.saveState();
    }
  }

  static getInstance(): GameState {
    if (!GameState.instance) {
      GameState.instance = new GameState();
    }
    return GameState.instance;
  }

  private loadState(): GameData {
    try {
      const saved = localStorage.getItem(this.STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Merge with defaults to handle new fields
        return { ...this.DEFAULT_STATE, ...parsed };
      }
    } catch (error) {
      console.error('Failed to load game state:', error);
    }
    return { ...this.DEFAULT_STATE };
  }

  private saveState(): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.data));
      this.emit('stateSaved');
    } catch (error) {
      console.error('Failed to save game state:', error);
    }
  }

  // Wave management
  setCurrentWave(wave: number): void {
    this.data.currentWave = wave;
    if (wave > this.data.highestWave) {
      this.data.highestWave = wave;
      this.emit('newHighWave', wave);
    }
    this.saveState();
    this.emit('waveChanged', wave);
  }

  getCurrentWave(): number {
    return this.data.currentWave;
  }

  getHighestWave(): number {
    return this.data.highestWave;
  }

  // Score management
  addScore(points: number): void {
    this.data.totalScore += points;
    if (this.data.totalScore > this.data.highScore) {
      this.data.highScore = this.data.totalScore;
      this.emit('newHighScore', this.data.highScore);
    }
    this.saveState();
    this.emit('scoreChanged', this.data.totalScore);
  }

  getScore(): number {
    return this.data.totalScore;
  }

  getHighScore(): number {
    return this.data.highScore;
  }

  // Resource management
  getCredits(): number {
    return this.data.credits;
  }

  addCredits(amount: number): void {
    this.data.credits += amount;
    this.saveState();
    this.emit('creditsChanged', this.data.credits);
  }

  spendCredits(amount: number): boolean {
    if (this.data.credits >= amount) {
      this.data.credits -= amount;
      this.saveState();
      this.emit('creditsChanged', this.data.credits);
      return true;
    }
    return false;
  }

  getInterceptorStock(): number {
    return this.data.interceptorStock;
  }

  addInterceptors(amount: number): void {
    this.data.interceptorStock += amount;
    this.saveState();
    this.emit('interceptorsChanged', this.data.interceptorStock);
  }

  useInterceptor(): boolean {
    if (this.data.interceptorStock > 0) {
      this.data.interceptorStock--;
      this.saveState();
      this.emit('interceptorsChanged', this.data.interceptorStock);
      return true;
    }
    return false;
  }

  // Dome management
  getUnlockedDomes(): number {
    return this.data.unlockedDomes;
  }

  unlockNewDome(): boolean {
    const cost = this.getDomeUnlockCost();
    if (this.spendCredits(cost)) {
      this.data.unlockedDomes++;
      this.saveState();
      this.emit('domeUnlocked', this.data.unlockedDomes);
      return true;
    }
    return false;
  }

  getDomeUnlockCost(): number {
    // Exponential cost increase
    return 1000 * Math.pow(2, this.data.unlockedDomes - 1);
  }

  getDomePlacements(): Array<{ id: string; position: { x: number; z: number }; level: number }> {
    return [...this.data.domePlacements];
  }

  addDomePlacement(id: string, position: { x: number; z: number }): void {
    // Check if already exists
    const existing = this.data.domePlacements.find(d => d.id === id);
    if (existing) {
      return;
    }

    this.data.domePlacements.push({ id, position, level: 1 });
    this.saveState();
    this.emit('domePlaced', { id, position });
  }

  removeDomePlacement(id: string): void {
    this.data.domePlacements = this.data.domePlacements.filter(d => d.id !== id);
    this.saveState();
    this.emit('domeRemoved', id);
  }

  upgradeDome(id: string): boolean {
    const dome = this.data.domePlacements.find(d => d.id === id);
    if (dome) {
      const cost = this.getDomeUpgradeCost(dome.level);
      if (this.spendCredits(cost)) {
        dome.level++;
        this.saveState();
        this.emit('domeUpgraded', { id, level: dome.level });
        return true;
      }
    }
    return false;
  }

  upgradeDomeFree(id: string): boolean {
    const dome = this.data.domePlacements.find(d => d.id === id);
    if (dome && dome.level < 5) {
      dome.level++;
      this.saveState();
      this.emit('domeUpgraded', { id, level: dome.level });
      return true;
    }
    return false;
  }

  getDomeUpgradeCost(currentLevel: number): number {
    return 500 * currentLevel;
  }

  // Statistics
  recordInterception(): void {
    this.data.totalInterceptions++;
    this.saveState();
  }

  recordMiss(): void {
    this.data.totalMisses++;
    this.saveState();
  }

  recordThreatDestroyed(): void {
    this.data.totalThreatsDestroyed++;
    this.saveState();
  }

  recordPerfectWave(): void {
    this.data.perfectWaves++;
    this.saveState();
  }

  getStats() {
    return {
      totalInterceptions: this.data.totalInterceptions,
      totalMisses: this.data.totalMisses,
      totalThreatsDestroyed: this.data.totalThreatsDestroyed,
      perfectWaves: this.data.perfectWaves,
      accuracy:
        this.data.totalInterceptions > 0
          ? ((this.data.totalThreatsDestroyed / this.data.totalInterceptions) * 100).toFixed(1)
          : 0,
    };
  }

  // Game reset
  resetProgress(): void {
    this.data = { ...this.DEFAULT_STATE };
    this.saveState();
    this.emit('gameReset');
  }

  // New game (resets everything except high scores)
  startNewGame(): void {
    this.data.currentWave = 1;
    this.data.totalScore = 0;
    this.data.credits = 1000;
    this.data.interceptorStock = 100;
    this.data.domePlacements = [];
    this.data.unlockedDomes = 1; // Reset to 1 dome
    this.data.autoRepairLevel = 0; // Reset auto-repair
    this.saveState();
    this.emit('newGame');
  }

  // Auto-repair methods
  getAutoRepairLevel(): number {
    return this.data.autoRepairLevel;
  }

  setAutoRepairLevel(level: number): void {
    this.data.autoRepairLevel = Math.max(0, Math.min(3, level));
    this.saveState();
    this.emit('autoRepairChanged', this.data.autoRepairLevel);
  }

  upgradeAutoRepair(): boolean {
    if (this.data.autoRepairLevel < 3) {
      this.data.autoRepairLevel++;
      this.saveState();
      this.emit('autoRepairChanged', this.data.autoRepairLevel);
      return true;
    }
    return false;
  }
}
