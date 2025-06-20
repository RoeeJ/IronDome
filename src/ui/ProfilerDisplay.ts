import { Profiler } from '../utils/Profiler'

export class ProfilerDisplay {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private profiler: Profiler
  private visible: boolean = false
  private updateInterval: number = 100 // ms
  private lastUpdate: number = 0
  private expandedSections: Set<string> = new Set(['Frame', 'Render', 'Interception System']) // Auto-expand these
  private renderStats: any = null
  
  constructor(profiler: Profiler) {
    this.profiler = profiler
    
    // Create canvas
    this.canvas = document.createElement('canvas')
    this.canvas.style.position = 'absolute'
    this.canvas.style.top = '320px'
    this.canvas.style.left = '10px'
    this.canvas.style.width = '500px'
    this.canvas.style.height = '600px'
    this.canvas.style.backgroundColor = 'rgba(0, 0, 0, 0.8)'
    this.canvas.style.border = '1px solid #00ff00'
    this.canvas.style.display = 'none'
    this.canvas.style.pointerEvents = 'none'
    this.canvas.style.zIndex = '1001'
    this.canvas.width = 500
    this.canvas.height = 600
    
    document.body.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')!
    
    // Set up keyboard toggle
    window.addEventListener('keydown', (e) => {
      if (e.key === 'p' || e.key === 'P') {
        this.toggle()
      }
    })
  }
  
  toggle(): void {
    this.visible = !this.visible
    this.canvas.style.display = this.visible ? 'block' : 'none'
    // Save visibility state to localStorage
    localStorage.setItem('ironDome_profilerVisible', this.visible.toString())
  }
  
  show(): void {
    this.visible = true
    this.canvas.style.display = 'block'
    localStorage.setItem('ironDome_profilerVisible', 'true')
  }
  
  hide(): void {
    this.visible = false
    this.canvas.style.display = 'none'
    localStorage.setItem('ironDome_profilerVisible', 'false')
  }
  
  isVisible(): boolean {
    return this.visible
  }
  
  update(): void {
    if (!this.visible) return
    
    const now = performance.now()
    if (now - this.lastUpdate < this.updateInterval) return
    this.lastUpdate = now
    
    // Clear canvas
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.9)'
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    
    // Draw header
    this.ctx.fillStyle = '#00ff00'
    this.ctx.font = 'bold 14px monospace'
    this.ctx.fillText('PERFORMANCE PROFILER (Press P to toggle)', 10, 20)
    
    // Get profiler data
    const averages = this.profiler.getAverages()
    const hotspots = this.profiler.getHotspots(1) // Show everything above 1ms
    
    // Draw hierarchical timing data
    let y = 50
    const barHeight = 18
    const maxBarWidth = 450
    const indentWidth = 20
    
    // Find max time for scaling
    const maxTime = Math.max(...Array.from(averages.values()), 16.67) // At least one frame time
    
    // Draw frame time reference line (60 FPS = 16.67ms)
    this.ctx.strokeStyle = '#ffff00'
    this.ctx.lineWidth = 1
    this.ctx.setLineDash([5, 5])
    const frameLineX = 10 + (16.67 / maxTime) * maxBarWidth
    this.ctx.beginPath()
    this.ctx.moveTo(frameLineX, 40)
    this.ctx.lineTo(frameLineX, this.canvas.height - 40)
    this.ctx.stroke()
    this.ctx.setLineDash([])
    
    this.ctx.font = '10px monospace'
    this.ctx.fillStyle = '#ffff00'
    this.ctx.fillText('16.67ms (60 FPS)', frameLineX + 5, 45)
    
    // Draw hierarchical sections
    const sectionsEndY = this.drawHierarchicalSections(y, barHeight, maxBarWidth, indentWidth, maxTime)
    
    // Draw render stats if available
    this.drawRenderStats(sectionsEndY + 20)
    
    // Draw summary
    const totalTime = Array.from(averages.values()).reduce((a, b) => a + b, 0)
    this.ctx.fillStyle = '#00ff00'
    this.ctx.font = '12px monospace'
    this.ctx.fillText(`Total Frame Time: ${totalTime.toFixed(2)}ms`, 10, this.canvas.height - 35)
    this.ctx.fillText(`Estimated FPS: ${(1000 / totalTime).toFixed(0)}`, 250, this.canvas.height - 35)
    
    // Draw warning if over budget
    if (totalTime > 16.67) {
      this.ctx.fillStyle = '#ff0000'
      this.ctx.font = 'bold 12px monospace'
      this.ctx.fillText('⚠ FRAME BUDGET EXCEEDED', 10, this.canvas.height - 20)
    }
    
    // Draw help text
    this.ctx.fillStyle = '#888888'
    this.ctx.font = '10px monospace'
    this.ctx.fillText('Press P to toggle profiler', 10, this.canvas.height - 5)
  }
  
  private drawHierarchicalSections(
    startY: number,
    barHeight: number,
    maxBarWidth: number,
    indentWidth: number,
    maxTime: number
  ): number {
    const averages = this.profiler.getAverages()
    let y = startY
    
    // Define hierarchy
    const hierarchy = [
      {
        name: 'Frame',
        children: [
          'Performance Monitor',
          'Physics',
          'Threat Manager',
          'Radar Network',
          'Projectiles',
          {
            name: 'Interception System',
            children: [
              'Battery Updates',
              'Fragmentation System',
              'Debris System',
              'Fragment Hit Detection',
              'Interceptor Updates',
              'Evaluate Threats',
              'Check Interceptions',
              'Cleanup'
            ]
          },
          'GUI Update',
          'Controls',
          {
            name: 'Render',
            children: [
              'Scene Analysis',
              'Renderer Prepare',
              'WebGL Render'
            ]
          }
        ]
      }
    ]
    
    // Draw sections recursively
    const drawSection = (section: any, indent: number) => {
      if (y > this.canvas.height - 60) return
      
      const sectionName = typeof section === 'string' ? section : section.name
      const avgTime = averages.get(sectionName) || 0
      
      if (avgTime > 0.01) { // Only show if > 0.01ms
        const barWidth = (avgTime / maxTime) * maxBarWidth
        const x = 10 + indent * indentWidth
        
        // Color based on performance impact
        let color = '#00ff00' // Green
        if (avgTime > 16.67) color = '#ff0000' // Red if over frame budget
        else if (avgTime > 8) color = '#ffaa00' // Orange if over half frame
        else if (avgTime > 4) color = '#ffff00' // Yellow if significant
        else if (avgTime > 2) color = '#aaffaa' // Light green
        
        // Draw bar
        this.ctx.fillStyle = color
        this.ctx.globalAlpha = 0.7
        this.ctx.fillRect(x, y, barWidth, barHeight - 2)
        this.ctx.globalAlpha = 1.0
        
        // Draw text
        this.ctx.font = indent > 0 ? '11px monospace' : '12px monospace'
        this.ctx.fillStyle = '#ffffff'
        const prefix = indent > 0 ? '└─ ' : ''
        this.ctx.fillText(
          `${prefix}${sectionName}: ${avgTime.toFixed(2)}ms`,
          x + 5, y + 13
        )
        
        y += barHeight
        
        // Draw children if expanded
        if (typeof section === 'object' && section.children && this.expandedSections.has(sectionName)) {
          section.children.forEach((child: any) => {
            drawSection(child, indent + 1)
          })
        }
      }
    }
    
    hierarchy.forEach(section => drawSection(section, 0))
    
    return y
  }
  
  setRenderStats(stats: any): void {
    this.renderStats = stats
  }
  
  private drawRenderStats(startY: number): void {
    if (!this.renderStats) return
    
    let y = startY
    
    // Draw header
    this.ctx.fillStyle = '#00ffff'
    this.ctx.font = 'bold 12px monospace'
    this.ctx.fillText('RENDER STATISTICS', 10, y)
    y += 20
    
    // Draw stats
    this.ctx.fillStyle = '#aaaaaa'
    this.ctx.font = '11px monospace'
    
    const stats = [
      `Draw Calls: ${this.renderStats.calls || 0}`,
      `Triangles: ${(this.renderStats.triangles || 0).toLocaleString()}`,
      `Points: ${(this.renderStats.points || 0).toLocaleString()}`,
      `Meshes: ${this.renderStats.meshes || 0}`,
      `Particles: ${this.renderStats.particles || 0}`,
      `Transparent: ${this.renderStats.transparent || 0}`
    ]
    
    stats.forEach(stat => {
      this.ctx.fillText(stat, 20, y)
      y += 15
    })
  }
  
  destroy(): void {
    if (this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas)
    }
  }
}