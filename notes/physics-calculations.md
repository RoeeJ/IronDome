# Iron Dome Simulator - Physics Calculations Reference

## Core Physics Formulas

### Basic Projectile Motion
```
Position:
x(t) = x₀ + v₀ₓ·t
y(t) = y₀ + v₀ᵧ·t - ½g·t²
z(t) = z₀ + v₀ᴢ·t

Velocity:
vₓ(t) = v₀ₓ
vᵧ(t) = v₀ᵧ - g·t
vᴢ(t) = v₀ᴢ

Where:
- g = 9.81 m/s² (gravity)
- v₀ = initial velocity
- t = time
```

### Drag Force Calculations
```
Drag Force: F_d = ½ · ρ · v² · C_d · A

Where:
- ρ = air density (kg/m³)
- v = velocity (m/s)
- C_d = drag coefficient (dimensionless)
- A = cross-sectional area (m²)

Air Density by Altitude:
ρ(h) = ρ₀ · e^(-h/H)
- ρ₀ = 1.225 kg/m³ (sea level)
- H = 8,400 m (scale height)
- h = altitude (m)
```

### Trajectory with Drag
```javascript
function updateVelocityWithDrag(velocity, dt, altitude) {
  const speed = velocity.length()
  const airDensity = 1.225 * Math.exp(-altitude / 8400)
  const dragCoeff = 0.47 // sphere approximation
  const area = 0.05 // m² (missile cross-section)
  const mass = 90 // kg (interceptor mass)
  
  const dragForce = 0.5 * airDensity * speed * speed * dragCoeff * area
  const dragAcceleration = dragForce / mass
  
  // Apply drag in opposite direction of velocity
  const dragVector = velocity.normalize().multiplyScalar(-dragAcceleration * dt)
  return velocity.add(dragVector)
}
```

### Interception Mathematics

#### Time to Impact Calculation
```javascript
function calculateTimeToImpact(position, velocity, targetAltitude = 0) {
  // Quadratic formula for ballistic trajectory
  const a = -0.5 * GRAVITY
  const b = velocity.y
  const c = position.y - targetAltitude
  
  const discriminant = b * b - 4 * a * c
  if (discriminant < 0) return null // No impact
  
  const t1 = (-b + Math.sqrt(discriminant)) / (2 * a)
  const t2 = (-b - Math.sqrt(discriminant)) / (2 * a)
  
  // Return the positive, future time
  return Math.max(t1, t2) > 0 ? Math.max(t1, t2) : null
}
```

#### Interception Point Prediction
```javascript
function predictInterceptionPoint(threat, interceptor) {
  // Iterative solution for non-linear trajectories
  let timeToIntercept = 0
  const dt = 0.1
  
  for (let t = 0; t < MAX_FLIGHT_TIME; t += dt) {
    const threatPos = predictPosition(threat, t)
    const distance = threatPos.distanceTo(interceptor.position)
    const interceptorFlightTime = distance / interceptor.speed
    
    if (Math.abs(t - interceptorFlightTime) < 0.01) {
      return {
        position: threatPos,
        time: t,
        interceptorFlightTime: interceptorFlightTime
      }
    }
  }
  
  return null // No valid interception point
}
```

### Launch Angle Optimization

#### Optimal Launch Angle for Maximum Range
```
θ_optimal = 45° (in vacuum)
θ_optimal ≈ 35-40° (with air resistance)
```

#### Launch Angle for Specific Target
```javascript
function calculateLaunchAngle(launchPos, targetPos, velocity) {
  const dx = targetPos.x - launchPos.x
  const dy = targetPos.y - launchPos.y
  const v = velocity
  const g = GRAVITY
  
  // Ballistic formula
  const term1 = v * v
  const term2 = Math.sqrt(v*v*v*v - g * (g*dx*dx + 2*dy*v*v))
  
  const angle1 = Math.atan((term1 + term2) / (g * dx))
  const angle2 = Math.atan((term1 - term2) / (g * dx))
  
  // Choose the lower angle for faster interception
  return Math.min(angle1, angle2)
}
```

### Collision Detection

#### Sphere-Sphere Collision
```javascript
function checkCollision(obj1, obj2, radiusSum) {
  const distance = obj1.position.distanceTo(obj2.position)
  return distance < radiusSum
}
```

#### Proximity Fuse Simulation
```javascript
function checkProximityFuse(interceptor, threat, fuzeRadius = 10) {
  const distance = interceptor.position.distanceTo(threat.position)
  const relativeVelocity = threat.velocity.clone().sub(interceptor.velocity)
  const closingSpeed = relativeVelocity.length()
  
  // Predict if objects will be within fuse radius in next frame
  const timeToClosest = -interceptor.position.clone()
    .sub(threat.position)
    .dot(relativeVelocity) / (closingSpeed * closingSpeed)
    
  if (timeToClosest > 0 && timeToClosest < dt) {
    const futureDistance = predictDistance(interceptor, threat, timeToClosest)
    return futureDistance < fuzeRadius
  }
  
  return distance < fuzeRadius
}
```

### Performance Considerations

#### Spatial Partitioning (Octree)
```javascript
class Octree {
  constructor(bounds, maxObjects = 10, maxLevels = 5, level = 0) {
    this.bounds = bounds
    this.objects = []
    this.nodes = []
    this.maxObjects = maxObjects
    this.maxLevels = maxLevels
    this.level = level
  }
  
  insert(object) {
    // Spatial indexing for efficient collision detection
  }
  
  retrieve(object) {
    // Get potential collision candidates
  }
}
```

#### Fixed Timestep Integration
```javascript
const FIXED_TIMESTEP = 1/60 // 60 Hz
let accumulator = 0

function updatePhysics(deltaTime) {
  accumulator += deltaTime
  
  while (accumulator >= FIXED_TIMESTEP) {
    // Update all physics objects
    physicsWorld.step(FIXED_TIMESTEP)
    accumulator -= FIXED_TIMESTEP
  }
  
  // Interpolation factor for smooth rendering
  const alpha = accumulator / FIXED_TIMESTEP
  return alpha
}
```

## Reference Values

### Typical Missile Parameters
```javascript
const MISSILE_PARAMS = {
  tamir: { // Iron Dome interceptor
    mass: 90,          // kg
    length: 3,         // m
    diameter: 0.16,    // m
    maxSpeed: 700,     // m/s
    maxRange: 70000,   // m
    maxAltitude: 10000 // m
  },
  qassam: { // Typical threat
    mass: 35,          // kg
    length: 2,         // m
    diameter: 0.115,   // m
    maxSpeed: 300,     // m/s
    maxRange: 10000,   // m
    maxAltitude: 3000  // m
  }
}
```

### Engagement Envelope
```javascript
const ENGAGEMENT_PARAMS = {
  minRange: 4000,      // m
  maxRange: 70000,     // m
  minAltitude: 100,    // m
  maxAltitude: 10000,  // m
  reactionTime: 15,    // seconds
  reloadTime: 20       // seconds
}
```