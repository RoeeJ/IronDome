import * as THREE from 'three'

export interface EnvironmentalFactors {
  windSpeed: THREE.Vector3
  temperature: number // Celsius
  pressure: number // hPa
  humidity: number // 0-1
  altitude: number // meters
}

export interface BallisticCoefficients {
  dragCoefficient: number
  referenceArea: number // m²
  mass: number // kg
}

export class AdvancedBallistics {
  private readonly GRAVITY_SEA_LEVEL = 9.80665 // m/s²
  private readonly EARTH_RADIUS = 6371000 // meters
  private readonly STANDARD_TEMP = 15 // Celsius
  private readonly STANDARD_PRESSURE = 1013.25 // hPa
  private readonly OMEGA_EARTH = 7.2921159e-5 // Earth's rotation rate (rad/s)
  
  // Standard atmosphere model
  private readonly LAPSE_RATE = -0.0065 // K/m
  private readonly GAS_CONSTANT = 287.053 // J/(kg·K)
  
  calculateTrajectory(
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    coefficients: BallisticCoefficients,
    environmental: EnvironmentalFactors,
    deltaTime: number
  ): { position: THREE.Vector3; velocity: THREE.Vector3 } {
    // Calculate forces
    const gravity = this.calculateGravity(position.y + environmental.altitude)
    const drag = this.calculateDrag(velocity, coefficients, environmental)
    const coriolis = this.calculateCoriolisForce(velocity, position)
    const magnus = this.calculateMagnusForce(velocity, environmental.windSpeed)
    
    // Total acceleration
    const totalForce = new THREE.Vector3(0, -gravity, 0)
      .add(drag)
      .add(coriolis)
      .add(magnus)
    
    const acceleration = totalForce.divideScalar(coefficients.mass)
    
    // Update velocity and position
    const newVelocity = velocity.clone().add(acceleration.multiplyScalar(deltaTime))
    const avgVelocity = velocity.clone().add(newVelocity).multiplyScalar(0.5)
    const newPosition = position.clone().add(avgVelocity.multiplyScalar(deltaTime))
    
    return {
      position: newPosition,
      velocity: newVelocity
    }
  }
  
  private calculateGravity(altitude: number): number {
    // Gravity variation with altitude
    const r = this.EARTH_RADIUS + altitude
    return this.GRAVITY_SEA_LEVEL * Math.pow(this.EARTH_RADIUS / r, 2)
  }
  
  private calculateDrag(
    velocity: THREE.Vector3,
    coefficients: BallisticCoefficients,
    environmental: EnvironmentalFactors
  ): THREE.Vector3 {
    // Calculate air density
    const density = this.calculateAirDensity(
      environmental.altitude,
      environmental.temperature,
      environmental.pressure,
      environmental.humidity
    )
    
    // Relative velocity (including wind)
    const relativeVel = velocity.clone().sub(environmental.windSpeed)
    const speed = relativeVel.length()
    
    if (speed < 0.1) return new THREE.Vector3()
    
    // Mach number for transonic/supersonic effects
    const soundSpeed = this.calculateSoundSpeed(environmental.temperature)
    const mach = speed / soundSpeed
    
    // Adjust drag coefficient for Mach effects
    const cd = this.adjustDragForMach(coefficients.dragCoefficient, mach)
    
    // Drag force: F = 0.5 * ρ * v² * Cd * A
    const dragMagnitude = 0.5 * density * speed * speed * cd * coefficients.referenceArea
    
    // Direction opposite to velocity
    return relativeVel.normalize().multiplyScalar(-dragMagnitude)
  }
  
  private calculateCoriolisForce(
    velocity: THREE.Vector3,
    position: THREE.Vector3
  ): THREE.Vector3 {
    // Coriolis force: F = -2m * Ω × v
    // Simplified for mid-latitudes
    const latitude = 32.0 * Math.PI / 180 // Approximate latitude
    
    const omega = new THREE.Vector3(
      0,
      this.OMEGA_EARTH * Math.cos(latitude),
      this.OMEGA_EARTH * Math.sin(latitude)
    )
    
    return omega.cross(velocity).multiplyScalar(-2)
  }
  
  private calculateMagnusForce(
    velocity: THREE.Vector3,
    wind: THREE.Vector3
  ): THREE.Vector3 {
    // Magnus effect for spinning projectiles
    // Simplified model - actual would need spin rate
    const relativeVel = velocity.clone().sub(wind)
    if (relativeVel.length() < 1) return new THREE.Vector3()
    
    // Assume small spin for stabilization
    const spinAxis = relativeVel.clone().normalize()
    const magnus = spinAxis.cross(relativeVel).multiplyScalar(0.001)
    
    return magnus
  }
  
  private calculateAirDensity(
    altitude: number,
    temperature: number,
    pressure: number,
    humidity: number
  ): number {
    // International Standard Atmosphere model with corrections
    const tempK = temperature + 273.15
    const altTemp = this.STANDARD_TEMP + 273.15 + this.LAPSE_RATE * altitude
    
    // Pressure at altitude
    const altPressure = pressure * Math.pow(altTemp / tempK, -9.81 / (this.LAPSE_RATE * this.GAS_CONSTANT))
    
    // Humidity correction
    const saturationPressure = 6.1121 * Math.exp((18.678 - temperature / 234.5) * temperature / (257.14 + temperature))
    const vaporPressure = humidity * saturationPressure
    const dryPressure = (altPressure - vaporPressure) * 100 // Convert to Pa
    
    // Density calculation
    const dryDensity = dryPressure / (this.GAS_CONSTANT * tempK)
    const vaporDensity = vaporPressure * 100 / (461.495 * tempK)
    
    return dryDensity + vaporDensity
  }
  
  private calculateSoundSpeed(temperature: number): number {
    // Speed of sound varies with temperature
    const tempK = temperature + 273.15
    return 331.3 * Math.sqrt(tempK / 273.15)
  }
  
  private adjustDragForMach(baseCd: number, mach: number): number {
    // Drag coefficient variation with Mach number
    if (mach < 0.8) {
      return baseCd
    } else if (mach < 1.2) {
      // Transonic region - drag rise
      return baseCd * (1 + 0.5 * (mach - 0.8))
    } else {
      // Supersonic - drag reduces after shock
      return baseCd * (1.2 - 0.1 * (mach - 1.2))
    }
  }
  
  // Calculate optimal firing solution considering ballistics
  calculateFiringSolution(
    launchPos: THREE.Vector3,
    targetPos: THREE.Vector3,
    targetVel: THREE.Vector3,
    muzzleVelocity: number,
    coefficients: BallisticCoefficients,
    environmental: EnvironmentalFactors
  ): { azimuth: number; elevation: number; timeOfFlight: number } | null {
    // This is a simplified iterative solution
    // Real implementation would use numerical optimization
    
    const directDistance = targetPos.distanceTo(launchPos)
    const baseTime = directDistance / muzzleVelocity
    
    // Initial guess
    let elevation = Math.atan2(targetPos.y - launchPos.y, 
      Math.sqrt(Math.pow(targetPos.x - launchPos.x, 2) + Math.pow(targetPos.z - launchPos.z, 2)))
    
    // Add loft for gravity compensation
    elevation += this.estimateGravityCompensation(directDistance, muzzleVelocity)
    
    const azimuth = Math.atan2(targetPos.x - launchPos.x, targetPos.z - launchPos.z)
    
    // Iterate to refine solution
    for (let i = 0; i < 5; i++) {
      const trajectory = this.simulateTrajectory(
        launchPos,
        muzzleVelocity,
        azimuth,
        elevation,
        coefficients,
        environmental,
        baseTime * 2
      )
      
      if (trajectory.impactPoint) {
        const error = trajectory.impactPoint.distanceTo(targetPos)
        if (error < 10) {
          return {
            azimuth,
            elevation,
            timeOfFlight: trajectory.timeOfFlight
          }
        }
        
        // Adjust elevation based on error
        const heightError = trajectory.impactPoint.y - targetPos.y
        elevation -= heightError * 0.001
      }
    }
    
    return null
  }
  
  private estimateGravityCompensation(range: number, velocity: number): number {
    // Rough estimate for gravity drop compensation
    const timeOfFlight = range / velocity
    const drop = 0.5 * this.GRAVITY_SEA_LEVEL * timeOfFlight * timeOfFlight
    return Math.atan(drop / range)
  }
  
  private simulateTrajectory(
    launchPos: THREE.Vector3,
    muzzleVelocity: number,
    azimuth: number,
    elevation: number,
    coefficients: BallisticCoefficients,
    environmental: EnvironmentalFactors,
    maxTime: number
  ): { impactPoint: THREE.Vector3 | null; timeOfFlight: number } {
    // Launch velocity vector
    const velocity = new THREE.Vector3(
      muzzleVelocity * Math.cos(elevation) * Math.sin(azimuth),
      muzzleVelocity * Math.sin(elevation),
      muzzleVelocity * Math.cos(elevation) * Math.cos(azimuth)
    )
    
    let position = launchPos.clone()
    let vel = velocity.clone()
    let time = 0
    const dt = 0.01
    
    while (time < maxTime && position.y > 0) {
      const result = this.calculateTrajectory(position, vel, coefficients, environmental, dt)
      position = result.position
      vel = result.velocity
      time += dt
    }
    
    return {
      impactPoint: position.y <= 0 ? position : null,
      timeOfFlight: time
    }
  }
}