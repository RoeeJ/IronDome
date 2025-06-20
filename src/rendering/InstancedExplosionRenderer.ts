import * as THREE from 'three'

interface ExplosionInstance {
  id: string
  index: number
  position: THREE.Vector3
  startTime: number
  duration: number
  maxScale: number
  quality: number
  active: boolean
  type: 'air' | 'ground'
}

export class InstancedExplosionRenderer {
  private scene: THREE.Scene
  private maxExplosions: number
  
  // Separate meshes for different explosion types
  private sphereMesh: THREE.InstancedMesh
  private flashMesh: THREE.InstancedMesh
  private smokeMesh: THREE.InstancedMesh
  
  private explosions: ExplosionInstance[] = []
  private availableIndices: number[] = []
  private activeExplosions = new Map<string, ExplosionInstance>()
  private dummy = new THREE.Object3D()
  
  // Shader materials for animated effects
  private explosionMaterial: THREE.ShaderMaterial
  private flashMaterial: THREE.ShaderMaterial
  private smokeMaterial: THREE.ShaderMaterial
  
  constructor(scene: THREE.Scene, maxExplosions: number = 100) {
    this.scene = scene
    this.maxExplosions = maxExplosions
    
    // Create explosion shader material
    this.explosionMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        color1: { value: new THREE.Color(0xff6600) },
        color2: { value: new THREE.Color(0xffaa00) }
      },
      vertexShader: `
        varying vec2 vUv;
        varying float vProgress;
        
        void main() {
          vUv = uv;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          
          // Pass instance progress through instanceMatrix scale
          vProgress = length(instanceMatrix[0].xyz);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform vec3 color1;
        uniform vec3 color2;
        varying vec2 vUv;
        varying float vProgress;
        
        void main() {
          // Create gradient from center
          float dist = length(vUv - 0.5) * 2.0;
          
          // Animate opacity based on progress
          float opacity = (1.0 - vProgress) * (1.0 - dist) * 0.8;
          
          // Mix colors based on progress
          vec3 color = mix(color1, color2, vProgress);
          
          gl_FragColor = vec4(color, opacity);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    })
    
    // Create flash material
    this.flashMaterial = new THREE.ShaderMaterial({
      uniforms: {
        color: { value: new THREE.Color(0xffff88) }
      },
      vertexShader: `
        varying float vOpacity;
        
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          
          // Use scale as opacity (stored in scale)
          vOpacity = length(instanceMatrix[0].xyz);
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        varying float vOpacity;
        
        void main() {
          gl_FragColor = vec4(color, vOpacity);
        }
      `,
      transparent: true,
      depthWrite: false
    })
    
    // Simple smoke material
    this.smokeMaterial = new THREE.MeshBasicMaterial({
      color: 0x666666,
      transparent: true,
      opacity: 0.6,
      depthWrite: false
    })
    
    // Create geometries
    const sphereGeometry = new THREE.SphereGeometry(1, 16, 8)
    const flashGeometry = new THREE.PlaneGeometry(2, 2)
    const smokeGeometry = new THREE.TorusGeometry(1, 0.3, 8, 16)
    
    // Create instanced meshes
    this.sphereMesh = new THREE.InstancedMesh(sphereGeometry, this.explosionMaterial, maxExplosions)
    this.flashMesh = new THREE.InstancedMesh(flashGeometry, this.flashMaterial, maxExplosions)
    this.smokeMesh = new THREE.InstancedMesh(smokeGeometry, this.smokeMaterial, maxExplosions)
    
    // Configure meshes
    this.sphereMesh.frustumCulled = false
    this.flashMesh.frustumCulled = false
    this.smokeMesh.frustumCulled = false
    
    // Initialize all instances as invisible
    const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0)
    for (let i = 0; i < maxExplosions; i++) {
      this.sphereMesh.setMatrixAt(i, zeroScale)
      this.flashMesh.setMatrixAt(i, zeroScale)
      this.smokeMesh.setMatrixAt(i, zeroScale)
      this.availableIndices.push(i)
    }
    this.sphereMesh.instanceMatrix.needsUpdate = true
    this.flashMesh.instanceMatrix.needsUpdate = true
    this.smokeMesh.instanceMatrix.needsUpdate = true
    
    // Add to scene
    this.scene.add(this.sphereMesh)
    this.scene.add(this.flashMesh)
    this.scene.add(this.smokeMesh)
  }
  
  createExplosion(
    position: THREE.Vector3,
    quality: number = 1.0,
    type: 'air' | 'ground' = 'ground'
  ): void {
    if (this.availableIndices.length === 0) return
    
    const index = this.availableIndices.pop()!
    const id = `explosion_${Date.now()}_${Math.random()}`
    
    const explosion: ExplosionInstance = {
      id,
      index,
      position: position.clone(),
      startTime: Date.now(),
      duration: 800 + quality * 400, // 0.8 to 1.2 seconds
      maxScale: 6 + quality * 8, // 6 to 14 based on quality
      quality,
      active: true,
      type
    }
    
    this.activeExplosions.set(id, explosion)
  }
  
  update(): void {
    const currentTime = Date.now()
    
    // Update shader uniforms
    this.explosionMaterial.uniforms.time.value = currentTime * 0.001
    
    // Update all active explosions
    this.activeExplosions.forEach((explosion, id) => {
      const elapsed = currentTime - explosion.startTime
      const progress = Math.min(elapsed / explosion.duration, 1)
      
      if (progress >= 1) {
        this.removeExplosion(id)
        return
      }
      
      // Calculate scale with easing
      const easeOutQuad = 1 - Math.pow(1 - progress, 2)
      const scale = explosion.maxScale * easeOutQuad
      
      // Update main explosion sphere
      this.dummy.position.copy(explosion.position)
      this.dummy.scale.setScalar(scale)
      this.dummy.updateMatrix()
      
      // Store progress in scale for shader
      const matrixWithProgress = this.dummy.matrix.clone()
      matrixWithProgress.elements[0] = progress // Store progress in first element
      
      this.sphereMesh.setMatrixAt(explosion.index, this.dummy.matrix)
      
      // Update flash (only for first 20% of explosion)
      if (progress < 0.2) {
        const flashScale = scale * 1.5
        const flashOpacity = 1 - (progress / 0.2)
        this.dummy.scale.setScalar(flashScale * flashOpacity)
        
        // Make flash face camera
        const camera = (window as any).__camera
        if (camera) {
          this.dummy.lookAt(camera.position)
        }
        
        this.dummy.updateMatrix()
        this.flashMesh.setMatrixAt(explosion.index, this.dummy.matrix)
      } else {
        // Hide flash
        const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0)
        this.flashMesh.setMatrixAt(explosion.index, zeroScale)
      }
      
      // Update smoke ring (starts after 30% progress)
      if (explosion.quality > 0.7 && progress > 0.3) {
        const smokeProgress = (progress - 0.3) / 0.7
        const smokeScale = scale * (1 + smokeProgress * 2)
        const smokeY = explosion.position.y + smokeProgress * scale * 0.5
        
        this.dummy.position.set(explosion.position.x, smokeY, explosion.position.z)
        this.dummy.scale.setScalar(smokeScale)
        this.dummy.rotation.x = -Math.PI / 2
        
        // Fade out smoke
        const smokeOpacity = 0.6 * (1 - smokeProgress)
        this.dummy.scale.multiplyScalar(smokeOpacity)
        
        this.dummy.updateMatrix()
        this.smokeMesh.setMatrixAt(explosion.index, this.dummy.matrix)
      } else {
        // Hide smoke
        const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0)
        this.smokeMesh.setMatrixAt(explosion.index, zeroScale)
      }
    })
    
    // Update instance matrices if there were active explosions
    if (this.activeExplosions.size > 0) {
      this.sphereMesh.instanceMatrix.needsUpdate = true
      this.flashMesh.instanceMatrix.needsUpdate = true
      this.smokeMesh.instanceMatrix.needsUpdate = true
    }
  }
  
  private removeExplosion(id: string): void {
    const explosion = this.activeExplosions.get(id)
    if (!explosion) return
    
    // Hide all instances
    const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0)
    this.sphereMesh.setMatrixAt(explosion.index, zeroScale)
    this.flashMesh.setMatrixAt(explosion.index, zeroScale)
    this.smokeMesh.setMatrixAt(explosion.index, zeroScale)
    
    // Return index to pool
    this.availableIndices.push(explosion.index)
    this.activeExplosions.delete(id)
  }
  
  clear(): void {
    const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0)
    this.activeExplosions.forEach(explosion => {
      this.sphereMesh.setMatrixAt(explosion.index, zeroScale)
      this.flashMesh.setMatrixAt(explosion.index, zeroScale)
      this.smokeMesh.setMatrixAt(explosion.index, zeroScale)
    })
    
    this.sphereMesh.instanceMatrix.needsUpdate = true
    this.flashMesh.instanceMatrix.needsUpdate = true
    this.smokeMesh.instanceMatrix.needsUpdate = true
    
    // Reset pools
    this.availableIndices = []
    for (let i = 0; i < this.maxExplosions; i++) {
      this.availableIndices.push(i)
    }
    this.activeExplosions.clear()
  }
  
  getActiveExplosionCount(): number {
    return this.activeExplosions.size
  }
  
  dispose(): void {
    this.sphereMesh.geometry.dispose()
    this.flashMesh.geometry.dispose()
    this.smokeMesh.geometry.dispose()
    
    this.explosionMaterial.dispose()
    this.flashMaterial.dispose()
    this.smokeMaterial.dispose()
    
    this.scene.remove(this.sphereMesh)
    this.scene.remove(this.flashMesh)
    this.scene.remove(this.smokeMesh)
  }
}