import * as THREE from 'three'
import { Profiler } from './Profiler'
import { debug } from './DebugLogger'

export class RenderProfiler {
  private renderer: THREE.WebGLRenderer
  private profiler?: Profiler
  private info: THREE.WebGLInfo
  private lastStats: any = {}
  
  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer
    this.info = renderer.info
  }
  
  setProfiler(profiler: Profiler): void {
    this.profiler = profiler
  }
  
  profiledRender(scene: THREE.Scene, camera: THREE.Camera): void {
    if (!this.profiler) {
      this.renderer.render(scene, camera)
      return
    }
    
    // Reset render info for this frame
    this.info.reset()
    
    // Detailed scene traversal with profiling
    this.profiler.startSection('Scene Analysis')
    let meshCount = 0
    let particleCount = 0
    let lineCount = 0
    let totalVertices = 0
    let totalParticles = 0
    let visibleObjects = 0
    let frustumCulled = 0
    let transparentObjects = 0
    
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        meshCount++
        if (object.visible) visibleObjects++
        if (object.frustumCulled) frustumCulled++
        if (object.material && (object.material as any).transparent) transparentObjects++
        
        // Count vertices
        if (object.geometry && object.geometry.attributes.position) {
          totalVertices += object.geometry.attributes.position.count
        }
      } else if (object instanceof THREE.Points) {
        particleCount++
        if (object.visible) visibleObjects++
        
        // Count particles
        if (object.geometry && object.geometry.attributes.position) {
          totalParticles += object.geometry.attributes.position.count
        }
      } else if (object instanceof THREE.Line) {
        lineCount++
        if (object.visible) visibleObjects++
      }
    })
    this.profiler.endSection('Scene Analysis')
    
    // Add detailed object count info
    this.profiler.startSection(`Objects: ${meshCount}M ${particleCount}P ${lineCount}L`)
    this.profiler.endSection(`Objects: ${meshCount}M ${particleCount}P ${lineCount}L`)
    
    if (totalVertices > 10000) {
      this.profiler.startSection(`Vertices: ${totalVertices.toLocaleString()}`)
      this.profiler.endSection(`Vertices: ${totalVertices.toLocaleString()}`)
    }
    
    if (totalParticles > 1000) {
      this.profiler.startSection(`Particles: ${totalParticles.toLocaleString()}`)
      this.profiler.endSection(`Particles: ${totalParticles.toLocaleString()}`)
    }
    
    if (transparentObjects > 10) {
      this.profiler.startSection(`Transparent: ${transparentObjects} objects`)
      this.profiler.endSection(`Transparent: ${transparentObjects} objects`)
    }
    
    // Profile the actual render with more detail
    this.profiler.startSection('Renderer Prepare')
    const renderStart = performance.now()
    this.profiler.endSection('Renderer Prepare')
    
    this.profiler.startSection('WebGL Render')
    this.renderer.render(scene, camera)
    const renderTime = performance.now() - renderStart
    this.profiler.endSection('WebGL Render')
    
    // Get render stats after render
    const renderStats = {
      calls: this.info.render.calls,
      triangles: this.info.render.triangles,
      points: this.info.render.points,
      lines: this.info.render.lines,
      textures: this.info.memory.textures,
      geometries: this.info.memory.geometries,
      programs: this.info.programs?.length || 0
    }
    
    // Add performance warnings
    if (renderStats.calls > 100) {
      this.profiler.startSection(`⚠ Draw Calls: ${renderStats.calls}`)
      this.profiler.endSection(`⚠ Draw Calls: ${renderStats.calls}`)
    } else if (renderStats.calls > 0) {
      this.profiler.startSection(`Draw Calls: ${renderStats.calls}`)
      this.profiler.endSection(`Draw Calls: ${renderStats.calls}`)
    }
    
    if (renderStats.triangles > 100000) {
      this.profiler.startSection(`⚠ Triangles: ${renderStats.triangles.toLocaleString()}`)
      this.profiler.endSection(`⚠ Triangles: ${renderStats.triangles.toLocaleString()}`)
    } else if (renderStats.triangles > 0) {
      this.profiler.startSection(`Triangles: ${renderStats.triangles.toLocaleString()}`)
      this.profiler.endSection(`Triangles: ${renderStats.triangles.toLocaleString()}`)
    }
    
    if (renderStats.points > 0) {
      this.profiler.startSection(`Points: ${renderStats.points.toLocaleString()}`)
      this.profiler.endSection(`Points: ${renderStats.points.toLocaleString()}`)
    }
    
    // Memory stats
    this.profiler.startSection(`Memory: ${renderStats.geometries}G ${renderStats.textures}T ${renderStats.programs}P`)
    this.profiler.endSection(`Memory: ${renderStats.geometries}G ${renderStats.textures}T ${renderStats.programs}P`)
    
    // Store stats for display
    this.lastStats = {
      ...renderStats,
      meshes: meshCount,
      particles: particleCount,
      transparent: transparentObjects,
      vertices: totalVertices,
      totalParticles: totalParticles
    }
    
    // Log detailed stats periodically in debug mode
    if (debug.isEnabled() && Math.random() < 0.02) { // 2% chance
      debug.category('Render', 'Detailed Stats:', {
        renderTime: renderTime.toFixed(2) + 'ms',
        objects: { meshes: meshCount, particles: particleCount, lines: lineCount, visible: visibleObjects },
        geometry: { vertices: totalVertices, particles: totalParticles, transparent: transparentObjects },
        webgl: renderStats
      })
    }
  }
  
  getLastStats() {
    return this.lastStats
  }
  
  getRenderStats() {
    return {
      calls: this.info.render.calls,
      triangles: this.info.render.triangles,
      points: this.info.render.points,
      lines: this.info.render.lines,
      frame: this.info.render.frame,
      textures: this.info.memory.textures,
      geometries: this.info.memory.geometries,
      programs: this.info.programs?.length || 0
    }
  }
}