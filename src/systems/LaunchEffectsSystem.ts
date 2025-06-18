import * as THREE from 'three'

export interface LaunchEffectConfig {
  smokeCloudSize: number
  smokeDuration: number
  flashIntensity: number
  flashDuration: number
  dustRadius: number
  shakeIntensity: number
  scorchMarkRadius: number
}

export class LaunchEffectsSystem {
  private scene: THREE.Scene
  private activeEffects: Array<{ update: () => boolean }> = []
  private lastEffectTime: number = 0
  private effectCooldown: number = 100 // Increased cooldown to reduce particle creation
  
  constructor(scene: THREE.Scene) {
    this.scene = scene
  }
  
  createLaunchEffect(
    position: THREE.Vector3,
    direction: THREE.Vector3,
    config: Partial<LaunchEffectConfig> = {}
  ): void {
    // Throttle effects to prevent performance drops
    const now = Date.now()
    const timeSinceLastEffect = now - this.lastEffectTime
    
    const fullConfig: LaunchEffectConfig = {
      smokeCloudSize: 8,
      smokeDuration: 3000,
      flashIntensity: 10,
      flashDuration: 200,
      dustRadius: 15,
      shakeIntensity: 0.5,
      scorchMarkRadius: 3,
      ...config
    }
    
    // Always create muzzle flash (lightweight)
    this.createMuzzleFlash(position, direction, fullConfig)
    
    // Skip heavy effects if too many recent launches
    if (timeSinceLastEffect < this.effectCooldown) {
      return
    }
    
    this.lastEffectTime = now
    
    // Create smoke cloud
    this.createSmokeCloud(position, direction, fullConfig)
    
    // Create ground dust only if we have capacity
    if (this.activeEffects.length < 20) {
      this.createGroundDust(position, fullConfig)
    }
    
    // Create scorch mark
    this.createScorchMark(position, fullConfig)
  }
  
  private createMuzzleFlash(
    position: THREE.Vector3,
    direction: THREE.Vector3,
    config: LaunchEffectConfig
  ): void {
    // Flash light
    const flashLight = new THREE.PointLight(0xffaa00, config.flashIntensity, 20)
    flashLight.position.copy(position)
    flashLight.position.add(direction.clone().multiplyScalar(2))
    this.scene.add(flashLight)
    
    // Flash geometry
    const flashGeometry = new THREE.ConeGeometry(2, 4, 8)
    const flashMaterial = new THREE.MeshBasicMaterial({
      color: 0xffff88,
      opacity: 0.9,
      transparent: true,
      blending: THREE.AdditiveBlending
    })
    const flashMesh = new THREE.Mesh(flashGeometry, flashMaterial)
    flashMesh.position.copy(position)
    flashMesh.position.add(direction.clone().multiplyScalar(2))
    
    // Orient flash along launch direction
    const quaternion = new THREE.Quaternion()
    quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction)
    flashMesh.quaternion.copy(quaternion)
    
    this.scene.add(flashMesh)
    
    // Animate flash
    const startTime = Date.now()
    const effect = {
      update: () => {
        const elapsed = Date.now() - startTime
        if (elapsed > config.flashDuration) {
          this.scene.remove(flashLight)
          this.scene.remove(flashMesh)
          flashMesh.geometry.dispose()
          flashMaterial.dispose()
          return false
        }
        
        const progress = elapsed / config.flashDuration
        flashMaterial.opacity = 0.9 * (1 - progress)
        flashLight.intensity = config.flashIntensity * (1 - progress)
        flashMesh.scale.setScalar(1 + progress * 0.5)
        
        return true
      }
    }
    
    this.activeEffects.push(effect)
  }
  
  private createSmokeCloud(
    position: THREE.Vector3,
    direction: THREE.Vector3,
    config: LaunchEffectConfig
  ): void {
    const particleCount = 10  // Further reduced for performance
    const geometry = new THREE.BufferGeometry()
    const positions = new Float32Array(particleCount * 3)
    const velocities = new Float32Array(particleCount * 3)
    const lifetimes = new Float32Array(particleCount)
    const sizes = new Float32Array(particleCount)
    
    // Initialize particles
    for (let i = 0; i < particleCount; i++) {
      // Random position near launch point
      const offset = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        Math.random() * 0.5,
        (Math.random() - 0.5) * 2
      )
      
      positions[i * 3] = position.x + offset.x
      positions[i * 3 + 1] = position.y + offset.y
      positions[i * 3 + 2] = position.z + offset.z
      
      // Velocity opposite to launch direction (backblast) with spread
      const vel = direction.clone().multiplyScalar(-8 - Math.random() * 12)
      
      // Add lateral spread perpendicular to launch direction
      const right = new THREE.Vector3()
      right.crossVectors(direction, new THREE.Vector3(0, 1, 0)).normalize()
      const up = new THREE.Vector3()
      up.crossVectors(right, direction).normalize()
      
      vel.add(right.multiplyScalar((Math.random() - 0.5) * 6))
      vel.add(up.multiplyScalar((Math.random() - 0.5) * 3))
      
      // Only add slight upward drift if launching horizontally
      if (Math.abs(direction.y) < 0.5) {
        vel.y += Math.random() * 0.5
      }
      
      velocities[i * 3] = vel.x
      velocities[i * 3 + 1] = vel.y
      velocities[i * 3 + 2] = vel.z
      
      lifetimes[i] = Math.random() * 0.5
      sizes[i] = 0.5 + Math.random() * 1.5
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3))
    geometry.setAttribute('lifetime', new THREE.BufferAttribute(lifetimes, 1))
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1))
    
    const material = new THREE.PointsMaterial({
      size: config.smokeCloudSize,
      color: 0x888888,
      map: this.createSmokeTexture(),
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.NormalBlending,
      sizeAttenuation: true
    })
    
    const points = new THREE.Points(geometry, material)
    this.scene.add(points)
    
    // Animate smoke
    const startTime = Date.now()
    const effect = {
      update: () => {
        const elapsed = (Date.now() - startTime) / 1000
        if (elapsed > config.smokeDuration / 1000) {
          this.scene.remove(points)
          geometry.dispose()
          material.dispose()
          if (material.map) material.map.dispose()
          return false
        }
        
        const positions = geometry.attributes.position.array as Float32Array
        const velocities = geometry.attributes.velocity.array as Float32Array
        const lifetimes = geometry.attributes.lifetime.array as Float32Array
        const sizes = geometry.attributes.size.array as Float32Array
        
        for (let i = 0; i < particleCount; i++) {
          lifetimes[i] += 0.016
          
          // Update position
          positions[i * 3] += velocities[i * 3] * 0.016
          positions[i * 3 + 1] += velocities[i * 3 + 1] * 0.016
          positions[i * 3 + 2] += velocities[i * 3 + 2] * 0.016
          
          // Slow down particles
          velocities[i * 3] *= 0.96
          velocities[i * 3 + 1] *= 0.96  // Don't add upward velocity
          velocities[i * 3 + 2] *= 0.96
          
          // Grow over time
          sizes[i] = (0.5 + Math.random() * 1.5) * (1 + lifetimes[i] * 0.5)
        }
        
        geometry.attributes.position.needsUpdate = true
        geometry.attributes.size.needsUpdate = true
        material.opacity = 0.7 * (1 - elapsed / (config.smokeDuration / 1000))
        
        return true
      }
    }
    
    this.activeEffects.push(effect)
  }
  
  private createGroundDust(position: THREE.Vector3, config: LaunchEffectConfig): void {
    // Create expanding dust ring
    const ringGeometry = new THREE.RingGeometry(1, config.dustRadius, 16, 1)  // Reduced segments from 32
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x8b7355,
      opacity: 0.6,
      transparent: true,
      side: THREE.DoubleSide
    })
    const ring = new THREE.Mesh(ringGeometry, ringMaterial)
    ring.rotation.x = -Math.PI / 2
    ring.position.copy(position)
    ring.position.y = 0.1
    this.scene.add(ring)
    
    // Create dust particles
    const particleCount = 8  // Further reduced for performance
    const dustGeometry = new THREE.BufferGeometry()
    const dustPositions = new Float32Array(particleCount * 3)
    const dustVelocities = new Float32Array(particleCount * 3)
    
    for (let i = 0; i < particleCount; i++) {
      const angle = (i / particleCount) * Math.PI * 2
      const radius = 2 + Math.random() * 3
      
      dustPositions[i * 3] = position.x + Math.cos(angle) * radius
      dustPositions[i * 3 + 1] = 0.2
      dustPositions[i * 3 + 2] = position.z + Math.sin(angle) * radius
      
      const vel = 8 + Math.random() * 4
      dustVelocities[i * 3] = Math.cos(angle) * vel
      dustVelocities[i * 3 + 1] = Math.random() * 0.5  // Minimal upward velocity for dust
      dustVelocities[i * 3 + 2] = Math.sin(angle) * vel
    }
    
    dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3))
    
    const dustMaterial = new THREE.PointsMaterial({
      size: 0.5,
      color: 0x8b7355,
      transparent: true,
      opacity: 0.8
    })
    
    const dustPoints = new THREE.Points(dustGeometry, dustMaterial)
    this.scene.add(dustPoints)
    
    // Animate dust
    const startTime = Date.now()
    const effect = {
      update: () => {
        const elapsed = (Date.now() - startTime) / 1000
        if (elapsed > 1.5) {
          this.scene.remove(ring)
          this.scene.remove(dustPoints)
          ringGeometry.dispose()
          ringMaterial.dispose()
          dustGeometry.dispose()
          dustMaterial.dispose()
          return false
        }
        
        // Expand ring more slowly
        const scale = 1 + elapsed * 2  // Reduced from 8 to 2
        ring.scale.set(scale, scale, 1)
        ringMaterial.opacity = 0.6 * (1 - elapsed / 1.5)
        
        // Update dust particles
        const positions = dustGeometry.attributes.position.array as Float32Array
        for (let i = 0; i < particleCount; i++) {
          positions[i * 3] += dustVelocities[i * 3] * 0.016
          positions[i * 3 + 1] += (dustVelocities[i * 3 + 1] - 9.8 * elapsed) * 0.016
          positions[i * 3 + 2] += dustVelocities[i * 3 + 2] * 0.016
          
          // Keep above ground
          if (positions[i * 3 + 1] < 0) positions[i * 3 + 1] = 0
        }
        dustGeometry.attributes.position.needsUpdate = true
        dustMaterial.opacity = 0.8 * (1 - elapsed / 1.5)
        
        return true
      }
    }
    
    this.activeEffects.push(effect)
  }
  
  private createScorchMark(position: THREE.Vector3, config: LaunchEffectConfig): void {
    const geometry = new THREE.CircleGeometry(config.scorchMarkRadius, 16)
    const material = new THREE.MeshBasicMaterial({
      color: 0x222222,
      opacity: 0.7,
      transparent: true
    })
    const scorch = new THREE.Mesh(geometry, material)
    scorch.rotation.x = -Math.PI / 2
    scorch.position.copy(position)
    scorch.position.y = 0.01
    this.scene.add(scorch)
    
    // Fade in then slowly fade out
    const startTime = Date.now()
    const effect = {
      update: () => {
        const elapsed = (Date.now() - startTime) / 1000
        if (elapsed > 10) {
          this.scene.remove(scorch)
          geometry.dispose()
          material.dispose()
          return false
        }
        
        if (elapsed < 0.5) {
          material.opacity = 0.7 * (elapsed / 0.5)
        } else {
          material.opacity = 0.7 * (1 - (elapsed - 0.5) / 9.5)
        }
        
        return true
      }
    }
    
    this.activeEffects.push(effect)
  }
  
  private createSmokeTexture(): THREE.Texture {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const ctx = canvas.getContext('2d')!
    
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    gradient.addColorStop(0, 'rgba(100,100,100,0.8)')
    gradient.addColorStop(0.4, 'rgba(100,100,100,0.4)')
    gradient.addColorStop(1, 'rgba(100,100,100,0)')
    
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 64, 64)
    
    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true
    return texture
  }
  
  update(): void {
    // Update all active effects
    this.activeEffects = this.activeEffects.filter(effect => effect.update())
  }
}