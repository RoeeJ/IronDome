import Stats from 'stats.js'
import { InterceptionSystem } from '@/scene/InterceptionSystem'
import { ThreatManager } from '@/scene/ThreatManager'
import { ResourceManager } from '@/game/ResourceManager'
import { GameState } from '@/game/GameState'

export class StatsDisplay {
  private fpsStats: Stats
  private msStats: Stats
  private memStats: Stats
  private customStats: Stats
  private visible: boolean = true
  
  private interceptionSystem?: InterceptionSystem
  private threatManager?: ThreatManager
  private resourceManager: ResourceManager
  private gameState: GameState
  
  private customPanel: Stats.Panel
  private lastCustomUpdate = 0
  private customUpdateInterval = 100 // Update custom stats every 100ms
  
  constructor() {
    this.resourceManager = ResourceManager.getInstance()
    this.gameState = GameState.getInstance()
    
    // Create stats monitors
    this.fpsStats = new Stats()
    this.fpsStats.showPanel(0) // FPS
    this.fpsStats.dom.style.position = 'absolute'
    this.fpsStats.dom.style.left = '0px'
    this.fpsStats.dom.style.top = '0px'
    document.body.appendChild(this.fpsStats.dom)
    
    this.msStats = new Stats()
    this.msStats.showPanel(1) // MS
    this.msStats.dom.style.position = 'absolute'
    this.msStats.dom.style.left = '80px'
    this.msStats.dom.style.top = '0px'
    document.body.appendChild(this.msStats.dom)
    
    this.memStats = new Stats()
    this.memStats.showPanel(2) // MB
    this.memStats.dom.style.position = 'absolute'
    this.memStats.dom.style.left = '160px'
    this.memStats.dom.style.top = '0px'
    document.body.appendChild(this.memStats.dom)
    
    // Create custom panel for game stats
    this.customStats = new Stats()
    this.customPanel = this.customStats.addPanel(new Stats.Panel('Game', '#ff8', '#221'))
    this.customStats.showPanel(3) // Show custom panel
    this.customStats.dom.style.position = 'absolute'
    this.customStats.dom.style.left = '240px'
    this.customStats.dom.style.top = '0px'
    document.body.appendChild(this.customStats.dom)
    
    // Keyboard toggle removed - using P key in main.ts instead
  }
  
  setInterceptionSystem(system: InterceptionSystem): void {
    this.interceptionSystem = system
  }
  
  setThreatManager(manager: ThreatManager): void {
    this.threatManager = manager
  }
  
  beginFrame(): void {
    this.fpsStats.begin()
    this.msStats.begin()
    this.memStats.begin()
  }
  
  endFrame(): void {
    this.fpsStats.end()
    this.msStats.end()
    this.memStats.end()
    
    // Update custom stats periodically
    const now = performance.now()
    if (now - this.lastCustomUpdate > this.customUpdateInterval) {
      this.updateCustomStats()
      this.lastCustomUpdate = now
    }
  }
  
  private updateCustomStats(): void {
    if (!this.interceptionSystem || !this.threatManager) return
    
    const stats = this.interceptionSystem.getStats()
    const threats = this.threatManager.getActiveThreats()
    
    // Calculate a composite game intensity metric
    const gameIntensity = Math.min(100, 
      threats.length * 2 + 
      stats.activeInterceptors * 5 + 
      stats.active * 3
    )
    
    this.customPanel.update(gameIntensity, 100)
  }
  
  toggleVisibility(): void {
    const isVisible = this.fpsStats.dom.style.display !== 'none'
    const display = isVisible ? 'none' : 'block'
    
    this.fpsStats.dom.style.display = display
    this.msStats.dom.style.display = display
    this.memStats.dom.style.display = display
    this.customStats.dom.style.display = display
  }
  
  show(): void {
    this.visible = true
    this.fpsStats.dom.style.display = 'block'
    this.msStats.dom.style.display = 'block'
    this.memStats.dom.style.display = 'block'
    this.customStats.dom.style.display = 'block'
  }
  
  hide(): void {
    this.visible = false
    this.fpsStats.dom.style.display = 'none'
    this.msStats.dom.style.display = 'none'
    this.memStats.dom.style.display = 'none'
    this.customStats.dom.style.display = 'none'
  }
  
  isVisible(): boolean {
    return this.visible
  }
  
  destroy(): void {
    document.body.removeChild(this.fpsStats.dom)
    document.body.removeChild(this.msStats.dom)
    document.body.removeChild(this.memStats.dom)
    document.body.removeChild(this.customStats.dom)
  }
}