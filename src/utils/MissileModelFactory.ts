import * as THREE from 'three'
import { ThreatType, ThreatConfig } from '../entities/Threat'
import { GeometryFactory } from './GeometryFactory'
import { MaterialCache } from './MaterialCache'

export class MissileModelFactory {
  private static instance: MissileModelFactory | null = null
  private geometryFactory: GeometryFactory
  private materialCache: MaterialCache

  private constructor() {
    this.geometryFactory = GeometryFactory.getInstance()
    this.materialCache = MaterialCache.getInstance()
  }

  static getInstance(): MissileModelFactory {
    if (!MissileModelFactory.instance) {
      MissileModelFactory.instance = new MissileModelFactory()
    }
    return MissileModelFactory.instance
  }

  createThreatModel(type: ThreatType, config: ThreatConfig): THREE.Object3D {
    switch (type) {
      case ThreatType.SHORT_RANGE:
      case ThreatType.QASSAM_1:
      case ThreatType.QASSAM_2:
      case ThreatType.QASSAM_3:
        return this.createRocketModel(config, 'short')
      
      case ThreatType.MEDIUM_RANGE:
      case ThreatType.GRAD_ROCKET:
        return this.createRocketModel(config, 'medium')
      
      case ThreatType.LONG_RANGE:
        return this.createRocketModel(config, 'long')
      
      case ThreatType.MORTAR:
        return this.createMortarModel(config)
      
      case ThreatType.DRONE_SLOW:
      case ThreatType.DRONE_FAST:
        return this.createDroneModel(config)
      
      case ThreatType.CRUISE_MISSILE:
        return this.createCruiseMissileModel(config)
      
      default:
        return this.createDefaultModel(config)
    }
  }

  createInterceptorModel(color: number = 0x00ffff): THREE.Object3D {
    const group = new THREE.Group()
    
    // Main body - sleek cylinder (no rotation, keep it along Y axis)
    const bodyGeometry = this.geometryFactory.getCylinder(0.15, 0.2, 1.5, 8)
    const bodyMaterial = this.materialCache.getMeshStandardMaterial({
      color: color,
      roughness: 0.2,
      metalness: 0.8,
      emissive: color,
      emissiveIntensity: 0.1
    })
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial)
    // No rotation - cylinder is already along Y axis
    group.add(body)
    
    // Nose cone - position at top
    const noseGeometry = this.geometryFactory.getCone(0.15, 0.5, 8)
    const noseMaterial = this.materialCache.getMeshStandardMaterial({
      color: 0xcccccc,
      roughness: 0.3,
      metalness: 0.9
    })
    const nose = new THREE.Mesh(noseGeometry, noseMaterial)
    nose.position.y = 1 // Position at top of body
    // No rotation - cone already points up
    group.add(nose)
    
    // Control fins at bottom
    const finGeometry = this.geometryFactory.getBox(0.3, 0.02, 0.15)
    const finMaterial = this.materialCache.getMeshStandardMaterial({
      color: 0x666666,
      roughness: 0.4,
      metalness: 0.6
    })
    
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.Mesh(finGeometry, finMaterial)
      const angle = (i / 4) * Math.PI * 2
      fin.position.x = Math.sin(angle) * 0.1
      fin.position.z = Math.cos(angle) * 0.1
      fin.position.y = -0.6 // Position at bottom
      fin.rotation.y = angle
      group.add(fin)
    }
    
    // Exhaust nozzle at bottom
    const nozzleGeometry = this.geometryFactory.getCone(0.2, 0.3, 8)
    const nozzleMaterial = this.materialCache.getMeshStandardMaterial({
      color: 0x333333,
      roughness: 0.8,
      metalness: 0.2
    })
    const nozzle = new THREE.Mesh(nozzleGeometry, nozzleMaterial)
    nozzle.position.y = -0.9 // Position at bottom
    nozzle.rotation.x = Math.PI // Flip to point down
    group.add(nozzle)
    
    return group
  }

  private createRocketModel(config: ThreatConfig, size: 'short' | 'medium' | 'long'): THREE.Object3D {
    const group = new THREE.Group()
    
    // Scale factors based on size
    const scaleFactor = size === 'short' ? 0.8 : size === 'medium' ? 1.0 : 1.2
    const lengthFactor = size === 'short' ? 2.5 : size === 'medium' ? 3.5 : 4.5
    
    // Main body
    const bodyRadius = config.radius * scaleFactor
    const bodyLength = config.radius * lengthFactor
    const bodyGeometry = this.geometryFactory.getCylinder(
      bodyRadius * 0.8,
      bodyRadius,
      bodyLength,
      8
    )
    const bodyMaterial = this.materialCache.getMeshStandardMaterial({
      color: config.color,
      roughness: 0.6,
      metalness: 0.4
    })
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial)
    body.rotation.x = Math.PI / 2
    group.add(body)
    
    // Warhead (nose cone)
    const warheadGeometry = this.geometryFactory.getCone(
      bodyRadius * 0.8,
      bodyLength * 0.3,
      8
    )
    const warheadMaterial = this.materialCache.getMeshStandardMaterial({
      color: this.darkenColor(config.color, 0.7),
      roughness: 0.5,
      metalness: 0.5
    })
    const warhead = new THREE.Mesh(warheadGeometry, warheadMaterial)
    warhead.position.z = -(bodyLength * 0.5 + bodyLength * 0.15)
    warhead.rotation.x = Math.PI / 2
    group.add(warhead)
    
    // Tail fins
    const finGeometry = this.geometryFactory.getBox(
      bodyRadius * 2,
      0.05,
      bodyRadius * 0.8
    )
    const finMaterial = this.materialCache.getMeshStandardMaterial({
      color: 0x555555,
      roughness: 0.7,
      metalness: 0.3
    })
    
    // Add 4 fins
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.Mesh(finGeometry, finMaterial)
      const angle = (i / 4) * Math.PI * 2
      fin.position.z = bodyLength * 0.4
      
      if (i % 2 === 0) {
        fin.rotation.z = angle
      } else {
        fin.rotation.y = Math.PI / 2
        fin.rotation.z = angle
      }
      group.add(fin)
    }
    
    // Engine nozzle
    const nozzleGeometry = this.geometryFactory.getCylinder(
      bodyRadius * 0.6,
      bodyRadius * 0.8,
      bodyLength * 0.15,
      8
    )
    const nozzleMaterial = this.materialCache.getMeshStandardMaterial({
      color: 0x222222,
      roughness: 0.8,
      metalness: 0.2
    })
    const nozzle = new THREE.Mesh(nozzleGeometry, nozzleMaterial)
    nozzle.position.z = bodyLength * 0.5
    nozzle.rotation.x = Math.PI / 2
    group.add(nozzle)
    
    return group
  }

  private createMortarModel(config: ThreatConfig): THREE.Object3D {
    const group = new THREE.Group()
    
    // Mortar shell - teardrop shape
    const bodyGeometry = this.geometryFactory.getCylinder(
      config.radius * 0.6,
      config.radius * 0.9,
      config.radius * 2.5,
      8
    )
    const bodyMaterial = this.materialCache.getMeshStandardMaterial({
      color: config.color,
      roughness: 0.7,
      metalness: 0.3
    })
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial)
    body.rotation.x = Math.PI / 2
    group.add(body)
    
    // Rounded nose
    const noseGeometry = this.geometryFactory.getSphere(config.radius * 0.6, 8, 6)
    const nose = new THREE.Mesh(noseGeometry, bodyMaterial)
    nose.position.z = -config.radius * 1.25
    group.add(nose)
    
    // Tail fins (smaller for mortar)
    const finGeometry = this.geometryFactory.getBox(
      config.radius * 1.2,
      0.03,
      config.radius * 0.4
    )
    const finMaterial = this.materialCache.getMeshStandardMaterial({
      color: 0x444444,
      roughness: 0.8,
      metalness: 0.2
    })
    
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.Mesh(finGeometry, finMaterial)
      const angle = (i / 4) * Math.PI * 2
      fin.position.z = config.radius * 1.1
      
      if (i % 2 === 0) {
        fin.rotation.z = angle
      } else {
        fin.rotation.y = Math.PI / 2
        fin.rotation.z = angle
      }
      group.add(fin)
    }
    
    return group
  }

  private createDroneModel(config: ThreatConfig): THREE.Object3D {
    const group = new THREE.Group()
    
    // Main body
    const bodyGeometry = this.geometryFactory.getBox(
      config.radius * 2,
      config.radius * 0.5,
      config.radius * 1.5
    )
    const bodyMaterial = this.materialCache.getMeshStandardMaterial({
      color: config.color,
      roughness: 0.8,
      metalness: 0.2
    })
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial)
    group.add(body)
    
    // Create arms and rotors
    const armGeometry = this.geometryFactory.getCylinder(0.05, 0.05, config.radius * 1.5, 4)
    const armMaterial = this.materialCache.getMeshStandardMaterial({
      color: 0x333333,
      roughness: 0.9,
      metalness: 0.1
    })
    
    const rotorGeometry = this.geometryFactory.getCylinder(
      config.radius * 0.8,
      config.radius * 0.8,
      0.05,
      8
    )
    const rotorMaterial = this.materialCache.getMeshBasicMaterial({
      color: 0x222222,
      opacity: 0.8,
      transparent: true
    })
    
    // Create 4 arms with rotors
    const rotorGroup = new THREE.Group()
    for (let i = 0; i < 4; i++) {
      const armGroup = new THREE.Group()
      
      // Arm
      const arm = new THREE.Mesh(armGeometry, armMaterial)
      arm.rotation.z = Math.PI / 2
      armGroup.add(arm)
      
      // Rotor
      const rotor = new THREE.Mesh(rotorGeometry, rotorMaterial)
      rotor.position.x = config.radius * 0.75
      rotor.position.y = config.radius * 0.3
      armGroup.add(rotor)
      
      // Position arm
      const angle = (i / 4) * Math.PI * 2 + Math.PI / 4
      armGroup.rotation.y = angle
      rotorGroup.add(armGroup)
    }
    
    group.add(rotorGroup)
    group.userData.rotors = rotorGroup
    
    // Add camera/sensor dome
    const sensorGeometry = this.geometryFactory.getSphere(config.radius * 0.3, 8, 6)
    const sensorMaterial = this.materialCache.getMeshStandardMaterial({
      color: 0x111111,
      roughness: 0.3,
      metalness: 0.7
    })
    const sensor = new THREE.Mesh(sensorGeometry, sensorMaterial)
    sensor.position.y = -config.radius * 0.4
    group.add(sensor)
    
    return group
  }

  private createCruiseMissileModel(config: ThreatConfig): THREE.Object3D {
    const group = new THREE.Group()
    
    // Main body - elongated cylinder
    const bodyGeometry = this.geometryFactory.getCylinder(
      config.radius * 0.7,
      config.radius * 0.7,
      config.radius * 5,
      8
    )
    const bodyMaterial = this.materialCache.getMeshStandardMaterial({
      color: config.color,
      roughness: 0.3,
      metalness: 0.7
    })
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial)
    body.rotation.x = Math.PI / 2
    group.add(body)
    
    // Nose cone - sharper
    const noseGeometry = this.geometryFactory.getCone(
      config.radius * 0.7,
      config.radius * 1.8,
      8
    )
    const noseMaterial = this.materialCache.getMeshStandardMaterial({
      color: 0xaaaaaa,
      roughness: 0.2,
      metalness: 0.9
    })
    const nose = new THREE.Mesh(noseGeometry, noseMaterial)
    nose.position.z = -config.radius * 3.4
    nose.rotation.x = Math.PI / 2
    group.add(nose)
    
    // Wings - swept back
    const wingGeometry = this.geometryFactory.getBox(
      config.radius * 3,
      0.1,
      config.radius * 1.2
    )
    const wingMaterial = this.materialCache.getMeshStandardMaterial({
      color: this.darkenColor(config.color, 0.8),
      roughness: 0.4,
      metalness: 0.6
    })
    
    const wing1 = new THREE.Mesh(wingGeometry, wingMaterial)
    wing1.position.y = 0
    wing1.position.z = config.radius * 0.5
    wing1.rotation.z = -0.1 // Slight sweep
    group.add(wing1)
    
    // Vertical stabilizer
    const stabilizerGeometry = this.geometryFactory.getBox(
      0.1,
      config.radius * 1.5,
      config.radius * 0.8
    )
    const stabilizer = new THREE.Mesh(stabilizerGeometry, wingMaterial)
    stabilizer.position.y = config.radius * 0.75
    stabilizer.position.z = config.radius * 2
    group.add(stabilizer)
    
    // Engine intake
    const intakeGeometry = this.geometryFactory.getCylinder(
      config.radius * 0.5,
      config.radius * 0.3,
      config.radius * 0.8,
      8
    )
    const intakeMaterial = this.materialCache.getMeshStandardMaterial({
      color: 0x222222,
      roughness: 0.9,
      metalness: 0.1
    })
    const intake = new THREE.Mesh(intakeGeometry, intakeMaterial)
    intake.position.y = -config.radius * 0.5
    intake.position.z = config.radius * 1.5
    intake.rotation.x = Math.PI / 2
    group.add(intake)
    
    return group
  }

  private createDefaultModel(config: ThreatConfig): THREE.Object3D {
    // Fallback to simple sphere
    const geometry = this.geometryFactory.getSphere(config.radius, 16, 12)
    const material = this.materialCache.getMeshStandardMaterial({
      color: config.color,
      roughness: 0.6,
      metalness: 0.4
    })
    const mesh = new THREE.Mesh(geometry, material)
    return mesh
  }

  private darkenColor(color: number, factor: number): number {
    const r = ((color >> 16) & 0xff) * factor
    const g = ((color >> 8) & 0xff) * factor
    const b = (color & 0xff) * factor
    return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)
  }
}