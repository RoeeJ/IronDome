import * as THREE from 'three'
import { Threat } from '../entities/Threat'

export class TacticalDisplay {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private radarCenter: { x: number, y: number }
  private radarRadius: number
  private scale: number = 0.5 // World units to pixels
  private threatTracks: Map<Threat, { id: string, positions: THREE.Vector2[], firstDetected: number, pinged: boolean }> = new Map()
  private nextId: number = 1
  private radarPings: { position: THREE.Vector2, time: number }[] = []
  
  constructor() {
    // Create canvas overlay
    this.canvas = document.createElement('canvas')
    this.canvas.style.position = 'absolute'
    this.canvas.style.top = '10px'
    this.canvas.style.left = '10px'  // Changed from right to left
    this.canvas.style.width = '300px'
    this.canvas.style.height = '300px'
    this.canvas.style.pointerEvents = 'none'
    this.canvas.style.zIndex = '1000'
    this.canvas.width = 300
    this.canvas.height = 300
    
    document.body.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')!
    
    this.radarCenter = { x: 150, y: 150 }
    this.radarRadius = 140
  }
  
  update(
    threats: Threat[],
    batteryPosition: THREE.Vector3,
    interceptorCount: number,
    successRate: number
  ): void {
    // Clear canvas
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)'
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    
    // Draw radar circles
    this.drawRadarGrid()
    
    // Draw battery at center
    this.drawBattery()
    
    // Update and draw threats
    this.updateThreatTracks(threats, batteryPosition)
    
    // Draw radar pings
    this.drawRadarPings()
    
    // Draw info panel
    this.drawInfoPanel(threats.length, interceptorCount, successRate)
  }
  
  private drawRadarGrid(): void {
    const ctx = this.ctx
    
    // Draw concentric circles
    ctx.strokeStyle = 'rgba(0, 255, 0, 0.3)'
    ctx.lineWidth = 1
    
    for (let i = 1; i <= 4; i++) {
      ctx.beginPath()
      ctx.arc(this.radarCenter.x, this.radarCenter.y, this.radarRadius * i / 4, 0, Math.PI * 2)
      ctx.stroke()
    }
    
    // Draw cross lines
    ctx.beginPath()
    ctx.moveTo(this.radarCenter.x - this.radarRadius, this.radarCenter.y)
    ctx.lineTo(this.radarCenter.x + this.radarRadius, this.radarCenter.y)
    ctx.moveTo(this.radarCenter.x, this.radarCenter.y - this.radarRadius)
    ctx.lineTo(this.radarCenter.x, this.radarCenter.y + this.radarRadius)
    ctx.stroke()
    
    // Draw range labels
    ctx.fillStyle = 'rgba(0, 255, 0, 0.5)'
    ctx.font = '10px monospace'
    ctx.fillText('50m', this.radarCenter.x + this.radarRadius / 4 - 10, this.radarCenter.y - 5)
    ctx.fillText('100m', this.radarCenter.x + this.radarRadius / 2 - 15, this.radarCenter.y - 5)
    ctx.fillText('150m', this.radarCenter.x + this.radarRadius * 3/4 - 15, this.radarCenter.y - 5)
    
    // Draw rotating sweep line
    const sweepAngle = (Date.now() / 1000) % (Math.PI * 2)
    const sweepGradient = ctx.createLinearGradient(
      this.radarCenter.x,
      this.radarCenter.y,
      this.radarCenter.x + Math.cos(sweepAngle) * this.radarRadius,
      this.radarCenter.y + Math.sin(sweepAngle) * this.radarRadius
    )
    sweepGradient.addColorStop(0, 'rgba(0, 255, 0, 0)')
    sweepGradient.addColorStop(0.5, 'rgba(0, 255, 0, 0.3)')
    sweepGradient.addColorStop(1, 'rgba(0, 255, 0, 0.6)')
    
    ctx.strokeStyle = sweepGradient
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(this.radarCenter.x, this.radarCenter.y)
    ctx.lineTo(
      this.radarCenter.x + Math.cos(sweepAngle) * this.radarRadius,
      this.radarCenter.y + Math.sin(sweepAngle) * this.radarRadius
    )
    ctx.stroke()
  }
  
  private drawBattery(): void {
    const ctx = this.ctx
    
    // Draw battery icon
    ctx.fillStyle = '#00ffff'
    ctx.strokeStyle = '#00ffff'
    ctx.lineWidth = 2
    
    // Draw hexagon
    const size = 8
    ctx.beginPath()
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i
      const x = this.radarCenter.x + Math.cos(angle) * size
      const y = this.radarCenter.y + Math.sin(angle) * size
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.stroke()
    ctx.fillStyle = 'rgba(0, 255, 255, 0.3)'
    ctx.fill()
  }
  
  private updateThreatTracks(threats: Threat[], batteryPosition: THREE.Vector3): void {
    const ctx = this.ctx
    
    // Clean up old tracks
    const activeThreats = new Set(threats)
    for (const [threat, track] of this.threatTracks) {
      if (!activeThreats.has(threat)) {
        this.threatTracks.delete(threat)
      }
    }
    
    // Update tracks
    threats.forEach(threat => {
      if (!this.threatTracks.has(threat)) {
        const screenPos = this.worldToScreen(threat.getPosition(), batteryPosition)
        
        // New threat detected - create radar ping
        this.radarPings.push({
          position: screenPos,
          time: Date.now()
        })
        
        this.threatTracks.set(threat, {
          id: `T${this.nextId++}`,
          positions: [],
          firstDetected: Date.now(),
          pinged: false
        })
      }
      
      const track = this.threatTracks.get(threat)!
      const screenPos = this.worldToScreen(threat.getPosition(), batteryPosition)
      
      // Add to track history
      track.positions.push(screenPos.clone())
      if (track.positions.length > 20) {
        track.positions.shift()
      }
      
      // Draw threat trail
      if (track.positions.length > 1) {
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.3)'
        ctx.lineWidth = 1
        ctx.beginPath()
        track.positions.forEach((pos, i) => {
          if (i === 0) ctx.moveTo(pos.x, pos.y)
          else ctx.lineTo(pos.x, pos.y)
        })
        ctx.stroke()
      }
      
      // Draw threat icon
      const relativePos = threat.getPosition().clone().sub(batteryPosition)
      const isInRange = relativePos.length() < this.radarRadius / this.scale
      if (isInRange) {
        // Threat triangle
        ctx.fillStyle = '#ff0000'
        ctx.strokeStyle = '#ff0000'
        ctx.lineWidth = 2
        
        ctx.save()
        ctx.translate(screenPos.x, screenPos.y)
        
        // Rotate based on velocity
        const vel = threat.getVelocity()
        const angle = Math.atan2(-vel.z, vel.x)
        ctx.rotate(angle)
        
        // Draw triangle
        ctx.beginPath()
        ctx.moveTo(5, 0)
        ctx.lineTo(-3, -3)
        ctx.lineTo(-3, 3)
        ctx.closePath()
        ctx.fill()
        ctx.restore()
        
        // Draw threat ID and info
        ctx.fillStyle = '#ff0000'
        ctx.font = 'bold 10px monospace'
        ctx.fillText(track.id, screenPos.x + 8, screenPos.y - 5)
        
        // Time to impact
        const tti = threat.getTimeToImpact()
        if (tti > 0) {
          ctx.font = '9px monospace'
          ctx.fillText(`${tti.toFixed(1)}s`, screenPos.x + 8, screenPos.y + 5)
        }
        
        // Altitude and speed
        const speed = threat.getVelocity().length()
        ctx.fillText(`${threat.getPosition().y.toFixed(0)}m`, screenPos.x + 8, screenPos.y + 15)
        ctx.fillText(`${speed.toFixed(0)}m/s`, screenPos.x + 8, screenPos.y + 25)
        
        // Threat classification based on speed/trajectory
        let classification = 'UNK'
        if (speed < 50) classification = 'MRT' // Mortar
        else if (speed < 100) classification = 'RKT' // Rocket
        else classification = 'MSL' // Missile
        
        ctx.font = '8px monospace'
        ctx.fillStyle = '#ffaa00'
        ctx.fillText(classification, screenPos.x - 15, screenPos.y - 10)
      }
    })
  }
  
  private drawInfoPanel(threatCount: number, interceptorCount: number, successRate: number): void {
    const ctx = this.ctx
    
    // Info background - larger panel
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
    ctx.fillRect(5, 5, 120, 90)
    
    // Header
    ctx.fillStyle = '#00ff00'
    ctx.font = 'bold 11px monospace'
    ctx.fillText('TACTICAL DISPLAY', 10, 18)
    
    // System status
    ctx.font = '10px monospace'
    ctx.fillStyle = interceptorCount > 0 ? '#00ff00' : '#ff0000'
    ctx.fillText('STATUS: ' + (interceptorCount > 0 ? 'ACTIVE' : 'DEPLETED'), 10, 32)
    
    // Stats
    ctx.fillStyle = '#00ff00'
    ctx.fillText(`Threats: ${threatCount}`, 10, 46)
    ctx.fillText(`Ready: ${interceptorCount}/20`, 10, 58)
    ctx.fillText(`P(hit): ${(successRate * 100).toFixed(0)}%`, 10, 70)
    
    // Alert level
    const alertLevel = threatCount === 0 ? 'GREEN' : threatCount < 3 ? 'YELLOW' : 'RED'
    const alertColor = threatCount === 0 ? '#00ff00' : threatCount < 3 ? '#ffff00' : '#ff0000'
    ctx.fillStyle = alertColor
    ctx.fillText(`ALERT: ${alertLevel}`, 10, 84)
  }
  
  private worldToScreen(worldPos: THREE.Vector3, batteryPosition: THREE.Vector3): THREE.Vector2 {
    const relativePos = worldPos.clone().sub(batteryPosition)
    return new THREE.Vector2(
      this.radarCenter.x + relativePos.x * this.scale,
      this.radarCenter.y - relativePos.z * this.scale // Flip Z for top-down view
    )
  }
  
  private drawRadarPings(): void {
    const ctx = this.ctx
    const currentTime = Date.now()
    
    // Update and draw pings
    this.radarPings = this.radarPings.filter(ping => {
      const age = currentTime - ping.time
      if (age > 2000) return false // Remove old pings
      
      const opacity = 1 - (age / 2000)
      const radius = 5 + (age / 100) // Expanding ring
      
      ctx.strokeStyle = `rgba(255, 255, 0, ${opacity})`
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(ping.position.x, ping.position.y, radius, 0, Math.PI * 2)
      ctx.stroke()
      
      // Inner bright dot
      if (age < 500) {
        ctx.fillStyle = `rgba(255, 255, 0, ${opacity * 2})`
        ctx.beginPath()
        ctx.arc(ping.position.x, ping.position.y, 2, 0, Math.PI * 2)
        ctx.fill()
      }
      
      return true
    })
  }
  
  destroy(): void {
    if (this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas)
    }
  }
}