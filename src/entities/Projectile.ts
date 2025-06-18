import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { ProximityFuse } from '../systems/ProximityFuse'
import { ExhaustTrailSystem } from '../systems/ExhaustTrailSystem'

export interface ProjectileOptions {
  position: THREE.Vector3
  velocity: THREE.Vector3
  color?: number
  radius?: number
  mass?: number
  trailLength?: number
  isInterceptor?: boolean
  target?: THREE.Object3D
  useExhaustTrail?: boolean
  failureMode?: 'none' | 'motor' | 'guidance' | 'premature'
  failureTime?: number
}

export class Projectile {
  mesh: THREE.Mesh
  body: CANNON.Body
  trail: THREE.Line
  trailPositions: THREE.Vector3[]
  trailGeometry: THREE.BufferGeometry
  maxTrailLength: number
  isActive: boolean = true
  isInterceptor: boolean
  target?: THREE.Object3D
  proximityFuse?: ProximityFuse
  detonationCallback?: (position: THREE.Vector3, quality: number) => void
  exhaustTrail?: ExhaustTrailSystem
  private scene: THREE.Scene
  private failureMode: string
  private failureTime: number
  private launchTime: number
  private hasFailed: boolean = false
  private radius: number
  
  // Physics scaling factor for simulator world
  private static readonly WORLD_SCALE = 0.3 // 30% of real-world values
  
  // Model orientation debugging
  private static modelForwardVector = new THREE.Vector3(0, 1, 0) // Default: +Y
  private static modelRotationAdjustment = new THREE.Euler(0, 0, 0) // No rotation needed for Y+

  constructor(
    scene: THREE.Scene,
    world: CANNON.World,
    options: ProjectileOptions
  ) {
    const {
      position,
      velocity,
      color = 0x00ff00,
      radius = 0.5,
      mass = 5,
      trailLength = 100,
      isInterceptor = false,
      target,
      useExhaustTrail = true,
      failureMode = 'none',
      failureTime = 0
    } = options
    
    this.scene = scene
    this.isInterceptor = isInterceptor
    this.target = target
    this.failureMode = failureMode
    this.failureTime = failureTime
    this.launchTime = Date.now()
    this.radius = radius

    // Create mesh - use model for interceptor, simple geometry for threats
    if (isInterceptor) {
      // Create temporary cone while model loads
      const geometry = new THREE.ConeGeometry(radius * 0.8, radius * 5, 8)
      const material = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.2,
        roughness: 0.3,
        metalness: 0.8
      })
      this.mesh = new THREE.Mesh(geometry, material)
      this.mesh.rotation.x = Math.PI / 2 // Point forward
      
      // Load Tamir model
      this.loadTamirModel(scene, radius)
    } else {
      // Threat missile - simple sphere
      const geometry = new THREE.SphereGeometry(radius, 16, 8)
      const material = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.2
      })
      this.mesh = new THREE.Mesh(geometry, material)
    }
    
    this.mesh.castShadow = true
    this.mesh.position.copy(position)
    scene.add(this.mesh)

    // Create physics body
    const shape = new CANNON.Sphere(radius)
    this.body = new CANNON.Body({
      mass,
      shape,
      position: new CANNON.Vec3(position.x, position.y, position.z),
      velocity: new CANNON.Vec3(velocity.x, velocity.y, velocity.z),
      linearDamping: 0.01,  // Small amount of drag for stability
      angularDamping: 0.1   // Prevent spinning
    })
    world.addBody(this.body)

    // Create trail
    this.maxTrailLength = trailLength
    this.trailPositions = []
    this.trailGeometry = new THREE.BufferGeometry()
    
    const trailMaterial = new THREE.LineBasicMaterial({
      color: color,
      opacity: 0.6,
      transparent: true
    })
    this.trail = new THREE.Line(this.trailGeometry, trailMaterial)
    scene.add(this.trail)
    
    // Initialize proximity fuse for interceptors with scaled values
    if (isInterceptor && target) {
      this.proximityFuse = new ProximityFuse(position, {
        armingDistance: 20,     // Arms after 20m
        detonationRadius: 8,    // Detonates within 8m (very forgiving)
        optimalRadius: 3,       // Best at 3m
        scanRate: 4             // Check every 4ms for better detection
      })
    }
    
    // Initialize exhaust trail system
    if (useExhaustTrail) {
      this.exhaustTrail = isInterceptor 
        ? ExhaustTrailSystem.createInterceptorTrail(scene)
        : ExhaustTrailSystem.createMissileTrail(scene)
    }
  }

  update(deltaTime: number = 0.016): void {
    if (!this.isActive) return
    
    // Check for failure conditions
    if (!this.hasFailed && this.failureMode !== 'none') {
      const elapsed = (Date.now() - this.launchTime) / 1000
      if (elapsed >= this.failureTime) {
        this.handleFailure()
      }
    }

    // Sync mesh with physics body
    this.mesh.position.copy(this.body.position as any)
    this.mesh.quaternion.copy(this.body.quaternion as any)

    // Update trail
    this.trailPositions.push(this.mesh.position.clone())
    if (this.trailPositions.length > this.maxTrailLength) {
      this.trailPositions.shift()
    }

    // Update trail geometry
    if (this.trailPositions.length > 1) {
      const positions = new Float32Array(this.trailPositions.length * 3)
      this.trailPositions.forEach((pos, i) => {
        positions[i * 3] = pos.x
        positions[i * 3 + 1] = pos.y
        positions[i * 3 + 2] = pos.z
      })
      this.trailGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    }
    
    // Update exhaust trail
    if (this.exhaustTrail && this.body.velocity.length() > 0.1) {
      const currentTime = Date.now()
      const velocity = this.getVelocity()
      
      // Emit from rear of projectile
      const emitPosition = this.mesh.position.clone()
      const velocityNormalized = velocity.clone().normalize()
      emitPosition.sub(velocityNormalized.multiplyScalar(this.radius))
      
      this.exhaustTrail.emit(emitPosition, velocity, currentTime)
      this.exhaustTrail.update(deltaTime)
    }
    
    // Mid-flight guidance for interceptors (if not failed)
    if (this.isInterceptor && this.target && !this.hasFailed && this.failureMode !== 'guidance') {
      this.updateGuidance(deltaTime)
    }
    
    // Check proximity fuse for interceptors
    if (this.isInterceptor && this.proximityFuse && this.target) {
      const targetPosition = this.target.position
      const currentTime = Date.now()
      
      const { shouldDetonate, detonationQuality } = this.proximityFuse.update(
        this.mesh.position,
        targetPosition,
        deltaTime,
        currentTime
      )
      
      if (shouldDetonate) {
        // Stop exhaust trail
        if (this.exhaustTrail) {
          this.exhaustTrail.stop()
        }
        
        // Trigger detonation
        if (this.detonationCallback) {
          this.detonationCallback(this.mesh.position.clone(), detonationQuality)
        }
        this.isActive = false
      }
    }
  }

  destroy(scene: THREE.Scene, world: CANNON.World): void {
    this.isActive = false
    scene.remove(this.mesh)
    scene.remove(this.trail)
    world.removeBody(this.body)
    
    // Dispose geometry and materials based on mesh type
    if (this.mesh instanceof THREE.Mesh) {
      this.mesh.geometry.dispose()
      ;(this.mesh.material as THREE.Material).dispose()
    } else if (this.mesh instanceof THREE.Group) {
      // For GLTF models, traverse and dispose all meshes
      this.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose()
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach(mat => mat.dispose())
            } else {
              child.material.dispose()
            }
          }
        }
      })
    }
    
    this.trailGeometry.dispose()
    ;(this.trail.material as THREE.Material).dispose()
    
    // Clean up exhaust trail
    if (this.exhaustTrail) {
      this.exhaustTrail.dispose()
    }
  }

  getPosition(): THREE.Vector3 {
    return this.mesh.position.clone()
  }

  getVelocity(): THREE.Vector3 {
    return new THREE.Vector3(
      this.body.velocity.x,
      this.body.velocity.y,
      this.body.velocity.z
    )
  }
  
  // Static methods for debugging model orientation
  static setModelOrientation(forwardVector: THREE.Vector3, rotationAdjustment: THREE.Euler): void {
    Projectile.modelForwardVector = forwardVector.clone().normalize()
    Projectile.modelRotationAdjustment = rotationAdjustment.clone()
  }
  
  static getModelOrientation(): { forward: THREE.Vector3, adjustment: THREE.Euler } {
    return {
      forward: Projectile.modelForwardVector.clone(),
      adjustment: Projectile.modelRotationAdjustment.clone()
    }
  }
  
  private handleFailure(): void {
    this.hasFailed = true
    console.log(`Interceptor failure: ${this.failureMode}`)
    
    switch (this.failureMode) {
      case 'motor':
        // Motor failure - stop thrust, let gravity take over
        if (this.exhaustTrail) {
          this.exhaustTrail.stop()
        }
        // Reduce velocity significantly
        this.body.velocity.x *= 0.3
        this.body.velocity.y *= 0.3
        this.body.velocity.z *= 0.3
        // Change color to indicate failure
        ;(this.mesh.material as THREE.MeshStandardMaterial).color.setHex(0x666666)
        ;(this.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0
        break
        
      case 'guidance':
        // Guidance failure - veer off course
        const randomVeer = new THREE.Vector3(
          (Math.random() - 0.5) * 50,
          (Math.random() - 0.5) * 30,
          (Math.random() - 0.5) * 50
        )
        this.body.velocity.x += randomVeer.x
        this.body.velocity.y += randomVeer.y
        this.body.velocity.z += randomVeer.z
        // Disable proximity fuse
        this.proximityFuse = undefined
        break
        
      case 'premature':
        // Premature detonation
        if (this.detonationCallback) {
          this.detonationCallback(this.mesh.position.clone(), 0.3) // Low quality detonation
        }
        this.isActive = false
        break
    }
  }
  
  private updateGuidance(deltaTime: number): void {
    if (!this.target || !this.isActive) return
    
    const currentVelocity = this.getVelocity()
    const currentSpeed = currentVelocity.length()
    
    // Don't guide if moving too slowly
    if (currentSpeed < 10) {
      return
    }
    
    // Check minimum travel distance before guidance kicks in
    const distanceTraveled = this.proximityFuse?.getDistanceTraveled() || 0
    const minGuidanceDistance = 15 // Don't guide for first 15 meters
    if (distanceTraveled < minGuidanceDistance) {
      // Just orient the missile during launch phase
      this.orientMissile(currentVelocity)
      return
    }
    
    // Calculate intercept point prediction
    const targetPos = this.target.position.clone()
    const myPos = this.mesh.position.clone()
    
    // Proportional navigation with realistic constraints
    const toTarget = targetPos.clone().sub(myPos)
    const distance = toTarget.length()
    
    // Only guide if we're not too close (avoid overshooting)
    if (distance < 3) return // Stop guiding when very close
    
    // Calculate time to impact
    const timeToImpact = distance / currentSpeed
    const predictedTargetPos = targetPos.clone()
    
    // Predict target future position
    if ('getVelocity' in this.target) {
      const targetVel = (this.target as any).getVelocity()
      // Simple lead calculation
      const leadTime = timeToImpact * 0.5 // Lead by half the time to impact
      predictedTargetPos.add(targetVel.clone().multiplyScalar(leadTime))
    }
    
    // Calculate line of sight rate
    const los = predictedTargetPos.clone().sub(myPos).normalize()
    const currentDirection = currentVelocity.clone().normalize()
    
    // Realistic missile constraints scaled for simulator
    // Increase turning capability for small world
    const maxGForce = 40 // Higher G-force for better maneuverability
    const gravity = 9.81
    const maxAcceleration = maxGForce * gravity
    const maxTurnRate = maxAcceleration / currentSpeed // v = rω, so ω = a/v
    
    // Simple proportional navigation
    const desiredVelocity = los.multiplyScalar(currentSpeed)
    const velocityError = desiredVelocity.clone().sub(currentVelocity)
    
    // Apply correction force
    const correctionForce = velocityError.multiplyScalar(this.body.mass * 2) // P gain of 2
    
    // Limit maximum force
    const maxForce = this.body.mass * maxAcceleration
    if (correctionForce.length() > maxForce) {
      correctionForce.normalize().multiplyScalar(maxForce)
    }
    
    // Apply the force with gravity compensation
    const gravityCompensation = this.body.mass * 9.81
    this.body.applyForce(
      new CANNON.Vec3(
        correctionForce.x,
        correctionForce.y + gravityCompensation, // Compensate for gravity
        correctionForce.z
      ),
      new CANNON.Vec3(0, 0, 0)
    )
    
    // Add forward thrust to maintain speed
    const thrustDirection = currentVelocity.clone().normalize()
    const targetSpeed = 150 // Target speed for interceptors
    const speedError = targetSpeed - currentSpeed
    const thrustForce = Math.max(0, speedError * this.body.mass * 0.5)
    
    if (thrustForce > 0 && thrustDirection.length() > 0) {
      this.body.applyForce(
        new CANNON.Vec3(
          thrustDirection.x * thrustForce,
          thrustDirection.y * thrustForce,
          thrustDirection.z * thrustForce
        ),
        new CANNON.Vec3(0, 0, 0)
      )
    }
    
    // Orient the missile model
    this.orientMissile(currentVelocity)
  }
  
  private orientMissile(velocity: THREE.Vector3): void {
    if (velocity.length() < 0.1) return
    
    const direction = velocity.clone().normalize()
    
    // For GLTF models, we need to handle orientation differently
    if (this.mesh instanceof THREE.Group || this.mesh.type === 'Group') {
      // Use static debug values for model orientation
      const quaternion = new THREE.Quaternion().setFromUnitVectors(Projectile.modelForwardVector, direction)
      
      // Apply adjustment rotation
      const adjustmentQuat = new THREE.Quaternion().setFromEuler(Projectile.modelRotationAdjustment)
      quaternion.multiply(adjustmentQuat)
      
      this.mesh.quaternion.copy(quaternion)
    } else {
      // For procedural geometry (cone)
      const defaultForward = new THREE.Vector3(0, 0, 1)
      const quaternion = new THREE.Quaternion().setFromUnitVectors(defaultForward, direction)
      this.mesh.quaternion.copy(quaternion)
    }
    
    // Add slight roll based on turn rate for realism
    if (this.isInterceptor) {
      const angularVel = this.body.angularVelocity
      const rollAmount = Math.min(Math.max(-angularVel.y * 0.1, -0.5), 0.5)
      this.mesh.rotateZ(rollAmount)
    }
  }
  
  private loadTamirModel(scene: THREE.Scene, scale: number): void {
    const loader = new GLTFLoader()
    loader.load(
      '/assets/tamir/scene.gltf',
      (gltf) => {
        // Remove temporary cone
        scene.remove(this.mesh)
        this.mesh.geometry.dispose()
        ;(this.mesh.material as THREE.Material).dispose()
        
        // Use the loaded model
        this.mesh = gltf.scene
        
        // Calculate model bounds and scale appropriately
        const box = new THREE.Box3().setFromObject(this.mesh)
        const size = box.getSize(new THREE.Vector3())
        const maxDimension = Math.max(size.x, size.y, size.z)
        
        // Scale to match the desired size (based on radius parameter)
        const targetSize = scale * 8 // Make it proportional to original cone size
        const scaleFactor = targetSize / maxDimension
        this.mesh.scale.setScalar(scaleFactor)
        
        // Apply materials and properties
        this.mesh.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true
            child.receiveShadow = true
            
            // Enhance the material
            if (child.material) {
              const material = child.material as THREE.MeshStandardMaterial
              material.metalness = 0.8
              material.roughness = 0.2
              // Add slight emissive for visibility
              material.emissive = new THREE.Color(0x0066aa)
              material.emissiveIntensity = 0.1
            }
          }
        })
        
        // Position and add to scene
        this.mesh.position.copy(this.body.position as any)
        scene.add(this.mesh)
        
        console.log('Tamir interceptor model loaded')
      },
      (xhr) => {
        // Progress callback
      },
      (error) => {
        console.error('Failed to load Tamir model:', error)
      }
    )
  }
}