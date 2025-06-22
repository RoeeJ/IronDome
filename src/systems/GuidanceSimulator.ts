/**
 * Pure guidance system simulator for testing
 * No dependencies on Three.js or Cannon.js
 */

export interface Vector3 {
  x: number
  y: number
  z: number
}

export interface GuidanceState {
  position: Vector3
  velocity: Vector3
  mass: number
  target: Vector3
  targetVelocity: Vector3
  time: number
}

export interface GuidanceCommand {
  thrust: Vector3
  maxThrust: number
}

export interface GuidanceSettings {
  maxGForce: number
  targetSpeed: number
  proportionalGain: number
  derivativeGain: number
  gravity: number
}

const DEFAULT_SETTINGS: GuidanceSettings = {
  maxGForce: 40,
  targetSpeed: 180,
  proportionalGain: 2.0,
  derivativeGain: 0.5,
  gravity: 9.81
}

/**
 * Calculate guidance command using proportional navigation
 */
export function calculateGuidanceCommand(
  state: GuidanceState,
  settings: Partial<GuidanceSettings> = {}
): GuidanceCommand {
  const config = { ...DEFAULT_SETTINGS, ...settings }
  
  // Calculate relative geometry
  const toTarget = {
    x: state.target.x - state.position.x,
    y: state.target.y - state.position.y,
    z: state.target.z - state.position.z
  }
  
  const distance = Math.sqrt(toTarget.x ** 2 + toTarget.y ** 2 + toTarget.z ** 2)
  const currentSpeed = Math.sqrt(state.velocity.x ** 2 + state.velocity.y ** 2 + state.velocity.z ** 2)
  
  // Don't guide if too slow or too close
  if (currentSpeed < 10 || distance < 3) {
    return { thrust: { x: 0, y: 0, z: 0 }, maxThrust: 0 }
  }
  
  // Calculate time to impact
  const timeToImpact = distance / currentSpeed
  
  // Predict target position with simple lead
  const leadTime = timeToImpact * 0.5
  const predictedTarget = {
    x: state.target.x + state.targetVelocity.x * leadTime,
    y: state.target.y + state.targetVelocity.y * leadTime - 0.5 * config.gravity * leadTime ** 2,
    z: state.target.z + state.targetVelocity.z * leadTime
  }
  
  // Line of sight to predicted position
  const los = {
    x: predictedTarget.x - state.position.x,
    y: predictedTarget.y - state.position.y,
    z: predictedTarget.z - state.position.z
  }
  
  const losDistance = Math.sqrt(los.x ** 2 + los.y ** 2 + los.z ** 2)
  
  // Normalize LOS
  los.x /= losDistance
  los.y /= losDistance
  los.z /= losDistance
  
  // Desired velocity
  const desiredVelocity = {
    x: los.x * config.targetSpeed,
    y: los.y * config.targetSpeed,
    z: los.z * config.targetSpeed
  }
  
  // Velocity error
  const velocityError = {
    x: desiredVelocity.x - state.velocity.x,
    y: desiredVelocity.y - state.velocity.y,
    z: desiredVelocity.z - state.velocity.z
  }
  
  // Calculate correction force
  const correctionForce = {
    x: velocityError.x * state.mass * config.proportionalGain,
    y: velocityError.y * state.mass * config.proportionalGain + state.mass * config.gravity,
    z: velocityError.z * state.mass * config.proportionalGain
  }
  
  // Apply G-force limit
  const maxForce = state.mass * config.maxGForce * config.gravity
  const forceMAgnitude = Math.sqrt(correctionForce.x ** 2 + correctionForce.y ** 2 + correctionForce.z ** 2)
  
  if (forceMAgnitude > maxForce) {
    const scale = maxForce / forceMAgnitude
    correctionForce.x *= scale
    correctionForce.y *= scale
    correctionForce.z *= scale
  }
  
  // Add forward thrust to maintain speed
  const speedError = config.targetSpeed - currentSpeed
  const thrustMagnitude = Math.max(0, speedError * state.mass * 0.5)
  
  if (thrustMagnitude > 0 && currentSpeed > 0) {
    const thrustDirection = {
      x: state.velocity.x / currentSpeed,
      y: state.velocity.y / currentSpeed,
      z: state.velocity.z / currentSpeed
    }
    
    correctionForce.x += thrustDirection.x * thrustMagnitude
    correctionForce.y += thrustDirection.y * thrustMagnitude
    correctionForce.z += thrustDirection.z * thrustMagnitude
  }
  
  return {
    thrust: correctionForce,
    maxThrust: maxForce
  }
}

/**
 * Simulate one timestep of guided flight
 */
export function simulateGuidanceStep(
  state: GuidanceState,
  command: GuidanceCommand,
  deltaTime: number,
  gravity: number = 9.81
): GuidanceState {
  // Calculate acceleration from thrust
  const acceleration = {
    x: command.thrust.x / state.mass,
    y: command.thrust.y / state.mass - gravity,
    z: command.thrust.z / state.mass
  }
  
  // Update velocity
  const newVelocity = {
    x: state.velocity.x + acceleration.x * deltaTime,
    y: state.velocity.y + acceleration.y * deltaTime,
    z: state.velocity.z + acceleration.z * deltaTime
  }
  
  // Update position
  const newPosition = {
    x: state.position.x + newVelocity.x * deltaTime,
    y: state.position.y + newVelocity.y * deltaTime,
    z: state.position.z + newVelocity.z * deltaTime
  }
  
  // Update target position (simple ballistic)
  const newTarget = {
    x: state.target.x + state.targetVelocity.x * deltaTime,
    y: state.target.y + state.targetVelocity.y * deltaTime - 0.5 * gravity * deltaTime ** 2,
    z: state.target.z + state.targetVelocity.z * deltaTime
  }
  
  const newTargetVelocity = {
    x: state.targetVelocity.x,
    y: state.targetVelocity.y - gravity * deltaTime,
    z: state.targetVelocity.z
  }
  
  return {
    position: newPosition,
    velocity: newVelocity,
    mass: state.mass,
    target: newTarget,
    targetVelocity: newTargetVelocity,
    time: state.time + deltaTime
  }
}

/**
 * Run a complete guidance simulation
 */
export function runGuidanceSimulation(
  initialState: GuidanceState,
  settings: Partial<GuidanceSettings> = {},
  maxTime: number = 30,
  deltaTime: number = 0.016
): {
  states: GuidanceState[]
  commands: GuidanceCommand[]
  hitDistance: number
  hitTime: number
} {
  const states: GuidanceState[] = [initialState]
  const commands: GuidanceCommand[] = []
  
  let currentState = initialState
  let minDistance = Infinity
  let hitTime = 0
  
  while (currentState.time < maxTime) {
    // Calculate guidance command
    const command = calculateGuidanceCommand(currentState, settings)
    commands.push(command)
    
    // Simulate next state
    currentState = simulateGuidanceStep(currentState, command, deltaTime, settings.gravity)
    states.push(currentState)
    
    // Check distance to target
    const distance = Math.sqrt(
      (currentState.position.x - currentState.target.x) ** 2 +
      (currentState.position.y - currentState.target.y) ** 2 +
      (currentState.position.z - currentState.target.z) ** 2
    )
    
    if (distance < minDistance) {
      minDistance = distance
      hitTime = currentState.time
    }
    
    // Stop if below ground or hit target
    if (currentState.position.y < 0 || distance < 5) {
      break
    }
  }
  
  return {
    states,
    commands,
    hitDistance: minDistance,
    hitTime
  }
}