import * as THREE from 'three'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { IronDomeBattery } from '../entities/IronDomeBattery'
import { debug } from '../utils/DebugLogger'
import { GeometryOptimizer } from '../utils/GeometryOptimizer'

export class InstancedOBJDomeRenderer {
  private scene: THREE.Scene
  private maxDomes: number
  
  // Instanced mesh for the OBJ model
  private objInstancedMesh?: THREE.InstancedMesh
  
  // Instanced meshes for launcher tubes (since they're dynamic)
  private launcherTubesMesh?: THREE.InstancedMesh
  
  // Temporary object for matrix calculations
  private dummy = new THREE.Object3D()
  
  // Track which instances are active
  private activeCount = 0
  
  // Loading state
  private isLoaded = false
  private loadPromise: Promise<void>
  
  constructor(scene: THREE.Scene, maxDomes: number = 50) {
    this.scene = scene
    this.maxDomes = maxDomes
    
    // Load the OBJ model with optimization
    this.loadPromise = this.loadOBJModel()
  }
  
  private async loadOBJModel(): Promise<void> {
    const loader = new OBJLoader()
    
    try {
      const object = await new Promise<THREE.Group>((resolve, reject) => {
        loader.load(
          '/assets/Battery.obj',
          (obj) => resolve(obj),
          (progress) => debug.log('Loading OBJ for instanced rendering...', progress),
          (error) => reject(error)
        )
      })
      
      // Analyze model complexity before optimization
      const beforeStats = GeometryOptimizer.analyzeComplexity(object)
      debug.log('Battery OBJ complexity BEFORE optimization:', beforeStats)
      
      // Optimize the model to reduce triangle count
      GeometryOptimizer.optimizeObject(object, {
        simplify: true, // Enable decimation
        simplifyRatio: 0.05, // Keep only 5% of triangles for instanced rendering
        mergeByMaterial: true,
        removeSmallDetails: true,
        smallDetailThreshold: 3.0 // Remove small details aggressively
      })
      
      const afterStats = GeometryOptimizer.analyzeComplexity(object)
      debug.log('Battery OBJ complexity AFTER optimization:', afterStats)
      
      // Process the optimized OBJ model
      const geometries: THREE.BufferGeometry[] = []
      const materials: THREE.Material[] = []
      
      object.traverse((child) => {
        if (child instanceof THREE.Mesh && child.geometry) {
          const geo = child.geometry.clone()
          geo.applyMatrix4(child.matrixWorld)
          geometries.push(geo)
          
          // Collect unique materials
          if (child.material && !materials.includes(child.material)) {
            materials.push(child.material as THREE.Material)
          }
        }
      })
      
      if (geometries.length === 0) {
        debug.error('No geometries found in OBJ model')
        return
      }
      
      // Merge all geometries
      const mergedGeometry = BufferGeometryUtils.mergeGeometries(geometries)
      
      // Calculate proper scale and position
      const box = new THREE.Box3().setFromBufferAttribute(
        mergedGeometry.attributes.position as THREE.BufferAttribute
      )
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      
      // Scale to appropriate size (matching original dome size)
      const targetHeight = 22.5  // Increased from 4 to match original
      const scaleFactor = targetHeight / size.y
      mergedGeometry.scale(scaleFactor, scaleFactor, scaleFactor)
      
      // Center at origin and place on ground
      mergedGeometry.translate(-center.x * scaleFactor, -box.min.y * scaleFactor, -center.z * scaleFactor)
      
      // Check if we have vertex colors that might be affecting appearance
      if (mergedGeometry.attributes.color) {
        debug.log('Geometry has vertex colors - removing them')
        mergedGeometry.deleteAttribute('color')
      }
      
      // Create material matching the original battery
      const material = new THREE.MeshStandardMaterial({
        color: 0xbbbbbb,  // Try a bit brighter
        roughness: 0.7,
        metalness: 0.5
      })
      
      // Create instanced mesh for the OBJ model
      this.objInstancedMesh = new THREE.InstancedMesh(
        mergedGeometry,
        material,
        this.maxDomes
      )
      this.objInstancedMesh.castShadow = true
      this.objInstancedMesh.receiveShadow = true
      
      // Initialize instance colors to default
      const colors = new Float32Array(this.maxDomes * 3)
      for (let i = 0; i < this.maxDomes; i++) {
        colors[i * 3] = 0x6a / 255
        colors[i * 3 + 1] = 0x6a / 255
        colors[i * 3 + 2] = 0x6a / 255
      }
      this.objInstancedMesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3)
      
      // Don't add launcher tubes - we'll show ammo differently
      // this.createLauncherTubes()
      
      // Add to scene
      this.scene.add(this.objInstancedMesh)
      
      // Initialize all instances as invisible
      const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0)
      for (let i = 0; i < this.maxDomes; i++) {
        this.objInstancedMesh.setMatrixAt(i, zeroScale)
        if (this.launcherTubesMesh) {
          this.launcherTubesMesh.setMatrixAt(i, zeroScale)
        }
      }
      
      this.objInstancedMesh.instanceMatrix.needsUpdate = true
      if (this.launcherTubesMesh) {
        this.launcherTubesMesh.instanceMatrix.needsUpdate = true
      }
      
      this.isLoaded = true
      debug.log('OBJ model loaded and optimized for instanced rendering')
      
    } catch (error) {
      debug.error('Failed to load OBJ for instanced rendering:', error)
      // Fall back to procedural geometry
      this.createProceduralFallback()
    }
  }
  
  private createLauncherTubes(): void {
    // Create merged launcher tubes geometry (20 tubes in a circle)
    const tubeGeometries: THREE.BufferGeometry[] = []
    const tubeGeo = new THREE.CylinderGeometry(0.2, 0.2, 3, 8)
    
    for (let i = 0; i < 20; i++) {
      const angle = (i / 20) * Math.PI * 2
      const tubeClone = tubeGeo.clone()
      const matrix = new THREE.Matrix4()
      matrix.makeTranslation(
        Math.cos(angle) * 0.8,
        2.5,
        Math.sin(angle) * 0.8
      )
      const rotMatrix = new THREE.Matrix4()
      rotMatrix.makeRotationZ(Math.PI / 8)
      matrix.multiply(rotMatrix)
      tubeClone.applyMatrix4(matrix)
      tubeGeometries.push(tubeClone)
    }
    
    const mergedTubesGeometry = BufferGeometryUtils.mergeGeometries(tubeGeometries)
    tubeGeometries.forEach(g => g.dispose())
    tubeGeo.dispose()
    
    // Create material for tubes
    const tubesMaterial = new THREE.MeshStandardMaterial({
      color: 0x666666,
      metalness: 0.7,
      roughness: 0.3
    })
    
    this.launcherTubesMesh = new THREE.InstancedMesh(
      mergedTubesGeometry,
      tubesMaterial,
      this.maxDomes
    )
    this.launcherTubesMesh.castShadow = true
  }
  
  private createProceduralFallback(): void {
    // Create simple fallback geometry if OBJ fails to load
    const geometry = new THREE.BoxGeometry(6, 4, 6)
    const material = new THREE.MeshStandardMaterial({
      color: 0x4a4a4a,
      roughness: 0.7,
      metalness: 0.5
    })
    
    this.objInstancedMesh = new THREE.InstancedMesh(
      geometry,
      material,
      this.maxDomes
    )
    this.objInstancedMesh.castShadow = true
    this.objInstancedMesh.receiveShadow = true
    
    this.createLauncherTubes()
    
    this.scene.add(this.objInstancedMesh)
    if (this.launcherTubesMesh) {
      this.scene.add(this.launcherTubesMesh)
    }
    
    this.isLoaded = true
  }
  
  async waitForLoad(): Promise<void> {
    await this.loadPromise
  }
  
  updateDomes(domes: Map<string, { battery: IronDomeBattery; level: number }>) {
    if (!this.isLoaded || !this.objInstancedMesh) return
    
    let index = 0
    
    domes.forEach(({ battery, level }) => {
      if (index >= this.maxDomes) return
      
      const position = battery.getPosition()
      const scale = 1 + (level - 1) * 0.1 // Slightly larger for higher levels
      
      // Update OBJ model instance
      this.dummy.position.copy(position)
      this.dummy.rotation.set(0, 0, 0)
      this.dummy.scale.setScalar(scale)
      this.dummy.updateMatrix()
      this.objInstancedMesh!.setMatrixAt(index, this.dummy.matrix)
      
      // No launcher tubes in this version
      
      // Set color based on health
      const health = battery.getHealth()
      const healthPercent = health.current / health.max
      
      if (healthPercent < 0.3) {
        this.objInstancedMesh!.setColorAt(index, new THREE.Color(0xff0000))
      } else if (healthPercent < 0.6) {
        this.objInstancedMesh!.setColorAt(index, new THREE.Color(0xff8800))
      } else {
        this.objInstancedMesh!.setColorAt(index, new THREE.Color(0x6a6a6a))  // Original darker color
      }
      
      index++
    })
    
    // Hide unused instances
    const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0)
    for (let i = index; i < this.activeCount; i++) {
      this.objInstancedMesh!.setMatrixAt(i, zeroScale)
      if (this.launcherTubesMesh) {
        this.launcherTubesMesh.setMatrixAt(i, zeroScale)
      }
    }
    
    this.activeCount = index
    
    // Update instance attributes
    this.objInstancedMesh!.instanceMatrix.needsUpdate = true
    if (this.objInstancedMesh!.instanceColor) {
      this.objInstancedMesh!.instanceColor.needsUpdate = true
    }
    
    if (this.launcherTubesMesh) {
      this.launcherTubesMesh.instanceMatrix.needsUpdate = true
    }
    
    // Update count for culling
    this.objInstancedMesh!.count = index
    if (this.launcherTubesMesh) {
      this.launcherTubesMesh.count = index
    }
  }
  
  dispose() {
    // Clean up geometries and materials
    if (this.objInstancedMesh) {
      this.objInstancedMesh.geometry.dispose()
      if (this.objInstancedMesh.material instanceof THREE.Material) {
        this.objInstancedMesh.material.dispose()
      }
      this.scene.remove(this.objInstancedMesh)
    }
    
    if (this.launcherTubesMesh) {
      this.launcherTubesMesh.geometry.dispose()
      if (this.launcherTubesMesh.material instanceof THREE.Material) {
        this.launcherTubesMesh.material.dispose()
      }
      this.scene.remove(this.launcherTubesMesh)
    }
  }
}