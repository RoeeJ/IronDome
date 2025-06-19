import { EventEmitter } from 'events'
import { GameState } from './GameState'

export interface ResourceCosts {
  interceptor: number
  domeUnlock: number
  domeUpgrade: (level: number) => number
  interceptorRestock: number
  emergencySupply: number
}

export class ResourceManager extends EventEmitter {
  private static instance: ResourceManager
  private gameState: GameState
  
  private readonly costs: ResourceCosts = {
    interceptor: 10, // Cost per interceptor when restocking
    domeUnlock: 1000, // Base cost, increases exponentially
    domeUpgrade: (level: number) => 500 * level,
    interceptorRestock: 500, // For 50 interceptors
    emergencySupply: 200 // For 10 interceptors during wave
  }
  
  private constructor() {
    super()
    this.gameState = GameState.getInstance()
  }
  
  static getInstance(): ResourceManager {
    if (!ResourceManager.instance) {
      ResourceManager.instance = new ResourceManager()
    }
    return ResourceManager.instance
  }
  
  // Credits management
  getCredits(): number {
    return this.gameState.getCredits()
  }
  
  canAfford(amount: number): boolean {
    return this.getCredits() >= amount
  }
  
  // Interceptor management
  getInterceptorStock(): number {
    return this.gameState.getInterceptorStock()
  }
  
  hasInterceptors(): boolean {
    return this.getInterceptorStock() > 0
  }
  
  consumeInterceptor(): boolean {
    if (this.gameState.useInterceptor()) {
      this.emit('interceptorUsed', this.getInterceptorStock())
      
      // Warning when low on interceptors
      if (this.getInterceptorStock() < 10) {
        this.emit('lowInterceptors', this.getInterceptorStock())
      }
      
      return true
    }
    return false
  }
  
  // Purchase functions
  purchaseInterceptors(amount: number): boolean {
    const cost = amount * this.costs.interceptor
    if (this.gameState.spendCredits(cost)) {
      this.gameState.addInterceptors(amount)
      this.emit('interceptorsPurchased', {
        amount,
        cost,
        newStock: this.getInterceptorStock()
      })
      return true
    }
    this.emit('insufficientCredits', { required: cost, available: this.getCredits() })
    return false
  }
  
  purchaseInterceptorRestock(): boolean {
    if (this.gameState.spendCredits(this.costs.interceptorRestock)) {
      this.gameState.addInterceptors(50)
      this.emit('restockPurchased', {
        amount: 50,
        cost: this.costs.interceptorRestock,
        newStock: this.getInterceptorStock()
      })
      return true
    }
    this.emit('insufficientCredits', { 
      required: this.costs.interceptorRestock, 
      available: this.getCredits() 
    })
    return false
  }
  
  purchaseEmergencySupply(): boolean {
    if (this.gameState.spendCredits(this.costs.emergencySupply)) {
      this.gameState.addInterceptors(10)
      this.emit('emergencySupplyPurchased', {
        amount: 10,
        cost: this.costs.emergencySupply,
        newStock: this.getInterceptorStock()
      })
      return true
    }
    this.emit('insufficientCredits', { 
      required: this.costs.emergencySupply, 
      available: this.getCredits() 
    })
    return false
  }
  
  // Dome management
  canUnlockNewDome(): boolean {
    const cost = this.gameState.getDomeUnlockCost()
    return this.canAfford(cost)
  }
  
  purchaseNewDome(): boolean {
    if (this.gameState.unlockNewDome()) {
      this.emit('domePurchased', {
        newTotal: this.gameState.getUnlockedDomes(),
        cost: this.gameState.getDomeUnlockCost()
      })
      return true
    }
    this.emit('insufficientCredits', { 
      required: this.gameState.getDomeUnlockCost(), 
      available: this.getCredits() 
    })
    return false
  }
  
  canUpgradeDome(domeId: string): boolean {
    const dome = this.gameState.getDomePlacements().find(d => d.id === domeId)
    if (!dome) return false
    
    const cost = this.gameState.getDomeUpgradeCost(dome.level)
    return this.canAfford(cost)
  }
  
  purchaseDomeUpgrade(domeId: string): boolean {
    const dome = this.gameState.getDomePlacements().find(d => d.id === domeId)
    if (!dome) return false
    
    const cost = this.gameState.getDomeUpgradeCost(dome.level)
    if (this.gameState.upgradeDome(domeId)) {
      this.emit('domeUpgraded', {
        domeId,
        newLevel: dome.level + 1,
        cost
      })
      return true
    }
    this.emit('insufficientCredits', { 
      required: cost, 
      available: this.getCredits() 
    })
    return false
  }
  
  // Rewards
  awardWaveCompletion(waveNumber: number, perfectWave: boolean): void {
    const baseReward = 100 * waveNumber
    const perfectBonus = perfectWave ? baseReward * 0.5 : 0
    const totalReward = baseReward + perfectBonus
    
    this.gameState.addCredits(totalReward)
    
    // Bonus interceptors every 5 waves
    if (waveNumber % 5 === 0) {
      const bonusInterceptors = 10 + (waveNumber / 5) * 5
      this.gameState.addInterceptors(bonusInterceptors)
      this.emit('bonusInterceptors', bonusInterceptors)
    }
    
    this.emit('waveReward', {
      credits: totalReward,
      perfectBonus: perfectBonus > 0
    })
  }
  
  awardInterceptionBonus(combo: number): void {
    // Award small credit bonus for interception combos
    if (combo >= 5) {
      const bonus = combo * 5
      this.gameState.addCredits(bonus)
      this.emit('comboBonus', { combo, credits: bonus })
    }
  }
  
  // Get current costs
  getCosts() {
    return {
      interceptor: this.costs.interceptor,
      interceptorRestock: this.costs.interceptorRestock,
      emergencySupply: this.costs.emergencySupply,
      domeUnlock: this.gameState.getDomeUnlockCost(),
      domeUpgrade: this.costs.domeUpgrade
    }
  }
  
  // Get resource summary
  getResourceSummary() {
    return {
      credits: this.getCredits(),
      interceptors: this.getInterceptorStock(),
      unlockedDomes: this.gameState.getUnlockedDomes(),
      placedDomes: this.gameState.getDomePlacements().length
    }
  }
}