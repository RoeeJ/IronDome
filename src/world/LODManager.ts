import * as THREE from 'three'
import { debug } from '../utils/DebugLogger'

export interface LODConfig {
  levels: LODLevel[]
  updateInterval: number  // How often to update LODs (ms)
}

export interface LODLevel {
  distance: number
  detail: 'high' | 'medium' | 'low' | 'billboard'
}

export interface LODObject {
  id: string
  position: THREE.Vector3
  meshes: {
    high?: THREE.Object3D
    medium?: THREE.Object3D
    low?: THREE.Object3D
    billboard?: THREE.Sprite
  }
  currentLevel: string | null
  lod: THREE.LOD
}

export class LODManager {
  private scene: THREE.Scene
  private camera: THREE.Camera | null = null
  private config: LODConfig
  private objects: Map<string, LODObject> = new Map()
  private lastUpdateTime: number = 0
  private updateCounter: number = 0
  
  // Default LOD levels
  private static readonly DEFAULT_LEVELS: LODLevel[] = [
    { distance: 50, detail: 'high' },
    { distance: 150, detail: 'medium' },
    { distance: 300, detail: 'low' },
    { distance: 500, detail: 'billboard' }
  ]
  
  constructor(scene: THREE.Scene, config: Partial<LODConfig> = {}) {
    this.scene = scene
    this.config = {
      levels: LODManager.DEFAULT_LEVELS,
      updateInterval: 100,  // Update every 100ms
      ...config
    }
  }
  
  setCamera(camera: THREE.Camera): void {
    this.camera = camera
  }
  
  createLODObject(
    id: string,
    position: THREE.Vector3,
    meshes: LODObject['meshes']
  ): LODObject {
    // Create THREE.LOD object
    const lod = new THREE.LOD()
    lod.position.copy(position)
    
    // Add levels based on available meshes
    for (const level of this.config.levels) {
      let object: THREE.Object3D | null = null
      
      switch (level.detail) {
        case 'high':
          object = meshes.high || null
          break
        case 'medium':
          object = meshes.medium || meshes.high || null
          break
        case 'low':
          object = meshes.low || meshes.medium || meshes.high || null
          break
        case 'billboard':
          object = meshes.billboard || meshes.low || meshes.medium || meshes.high || null
          break
      }
      
      if (object) {
        lod.addLevel(object, level.distance)
      }
    }
    
    // Create LOD object
    const lodObject: LODObject = {
      id,
      position,
      meshes,
      currentLevel: null,
      lod
    }
    
    this.objects.set(id, lodObject)
    this.scene.add(lod)
    
    return lodObject
  }
  
  // Factory methods for common object types
  createThreatLOD(id: string, position: THREE.Vector3, color: number, radius: number): LODObject {
    const meshes: LODObject['meshes'] = {}
    
    // High detail - full sphere
    const highGeometry = new THREE.SphereGeometry(radius, 16, 12)
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.2
    })
    meshes.high = new THREE.Mesh(highGeometry, material)
    
    // Medium detail - lower poly sphere
    const mediumGeometry = new THREE.SphereGeometry(radius, 8, 6)
    meshes.medium = new THREE.Mesh(mediumGeometry, material.clone())
    
    // Low detail - very low poly
    const lowGeometry = new THREE.SphereGeometry(radius, 6, 4)
    meshes.low = new THREE.Mesh(lowGeometry, material.clone())
    
    // Billboard - sprite
    const spriteMaterial = new THREE.SpriteMaterial({
      color,
      sizeAttenuation: true
    })
    const sprite = new THREE.Sprite(spriteMaterial)
    sprite.scale.set(radius * 2, radius * 2, 1)
    meshes.billboard = sprite
    
    return this.createLODObject(id, position, meshes)
  }
  
  createInterceptorLOD(id: string, position: THREE.Vector3): LODObject {
    const meshes: LODObject['meshes'] = {}
    const color = 0x00ffff
    const radius = 0.3
    
    // High detail - cone
    const highGeometry = new THREE.ConeGeometry(radius * 0.8, radius * 5, 8)
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.2,
      roughness: 0.3,
      metalness: 0.8
    })
    const highMesh = new THREE.Mesh(highGeometry, material)
    highMesh.rotation.x = Math.PI / 2
    meshes.high = highMesh
    
    // Medium detail - simpler cone
    const mediumGeometry = new THREE.ConeGeometry(radius * 0.8, radius * 5, 6)
    const mediumMesh = new THREE.Mesh(mediumGeometry, material.clone())
    mediumMesh.rotation.x = Math.PI / 2
    meshes.medium = mediumMesh
    
    // Low detail - box
    const lowGeometry = new THREE.BoxGeometry(radius * 1.5, radius * 5, radius * 1.5)
    const lowMesh = new THREE.Mesh(lowGeometry, material.clone())
    lowMesh.rotation.x = Math.PI / 2
    meshes.low = lowMesh
    
    // Billboard
    const spriteMaterial = new THREE.SpriteMaterial({
      color,
      sizeAttenuation: true
    })
    const sprite = new THREE.Sprite(spriteMaterial)
    sprite.scale.set(radius * 4, radius * 8, 1)
    meshes.billboard = sprite
    
    return this.createLODObject(id, position, meshes)
  }
  
  updatePosition(id: string, position: THREE.Vector3): void {
    const lodObject = this.objects.get(id)
    if (lodObject) {
      lodObject.position.copy(position)
      lodObject.lod.position.copy(position)
    }
  }
  
  updateRotation(id: string, rotation: THREE.Euler | THREE.Quaternion): void {
    const lodObject = this.objects.get(id)
    if (lodObject) {
      if (rotation instanceof THREE.Euler) {
        lodObject.lod.rotation.copy(rotation)
      } else {
        lodObject.lod.quaternion.copy(rotation)
      }
    }
  }
  
  remove(id: string): void {
    const lodObject = this.objects.get(id)
    if (lodObject) {
      this.scene.remove(lodObject.lod)
      
      // Dispose geometries and materials
      for (const mesh of Object.values(lodObject.meshes)) {
        if (mesh instanceof THREE.Mesh) {
          mesh.geometry.dispose()
          if (mesh.material instanceof THREE.Material) {
            mesh.material.dispose()
          }
        } else if (mesh instanceof THREE.Sprite) {
          if (mesh.material instanceof THREE.Material) {
            mesh.material.dispose()
          }
        }
      }
      
      this.objects.delete(id)
    }
  }
  
  update(): void {
    if (!this.camera) return
    
    const now = Date.now()
    if (now - this.lastUpdateTime < this.config.updateInterval) {
      return
    }
    
    this.lastUpdateTime = now
    
    // Update LODs (THREE.js handles this automatically)
    for (const lodObject of this.objects.values()) {
      lodObject.lod.update(this.camera)
    }
    
    // Log stats occasionally
    this.updateCounter++
    if (this.updateCounter % 100 === 0) {
      debug.category('LOD', `Managing ${this.objects.size} LOD objects`)
    }
  }
  
  getStats(): { total: number; byLevel: Record<string, number> } {
    const stats = {
      total: this.objects.size,
      byLevel: { high: 0, medium: 0, low: 0, billboard: 0 }
    }
    
    // THREE.LOD doesn't expose current level, so we'd need to calculate it
    // For now, just return total count
    return stats
  }
  
  dispose(): void {
    for (const id of this.objects.keys()) {
      this.remove(id)
    }
    this.objects.clear()
  }
}