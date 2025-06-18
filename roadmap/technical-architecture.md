# Iron Dome Simulator - Technical Architecture

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      User Interface Layer                     │
├─────────────────────────────────────────────────────────────┤
│                    Simulation Controller                      │
├──────────────────┬────────────────┬────────────────────────┤
│   3D Renderer    │ Physics Engine │   Game Logic Engine    │
│   (Three.js)     │  (Rapier/      │   (Custom)             │
│                  │   Cannon-es)   │                        │
├──────────────────┴────────────────┴────────────────────────┤
│                     Core Systems                             │
│  • Trajectory Calculator  • Threat Manager  • Interceptor   │
│  • Collision Detector     • Event System    • State Manager │
└─────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Scene Management System
```javascript
// Structure
src/
├── scene/
│   ├── SceneManager.js       // Main scene orchestrator
│   ├── CameraController.js   // Camera movement and views
│   ├── LightingSystem.js     // Dynamic lighting
│   └── EnvironmentLoader.js  // Terrain and skybox
```

**Key Features:**
- Multiple camera modes (free, follow, tactical)
- Dynamic LOD (Level of Detail) system
- Efficient frustum culling
- Post-processing effects pipeline

### 2. Physics Simulation Engine
```javascript
// Structure
src/
├── physics/
│   ├── PhysicsWorld.js       // Main physics wrapper
│   ├── TrajectoryCalculator.js
│   ├── CollisionManager.js
│   └── EnvironmentalForces.js
```

**Core Calculations:**
- Ballistic trajectory: `y = y₀ + v₀t - ½gt²`
- Drag force: `F_d = ½ρv²C_dA`
- Interception point prediction
- Real-time trajectory updates

### 3. Threat Management System
```javascript
// Structure
src/
├── threats/
│   ├── ThreatManager.js      // Threat spawning and lifecycle
│   ├── ThreatTypes.js        // Different threat configurations
│   ├── TrajectoryPredictor.js
│   └── ThreatDetector.js
```

**Threat Types:**
```javascript
const THREAT_TYPES = {
  SHORT_RANGE: {
    velocity: 300,      // m/s
    range: 4000,        // meters
    altitude: 1000,     // meters
    warheadSize: 10     // kg
  },
  MEDIUM_RANGE: {
    velocity: 600,
    range: 40000,
    altitude: 10000,
    warheadSize: 50
  },
  LONG_RANGE: {
    velocity: 1000,
    range: 70000,
    altitude: 20000,
    warheadSize: 100
  }
}
```

### 4. Interception System
```javascript
// Structure
src/
├── interceptors/
│   ├── InterceptorManager.js
│   ├── LaunchController.js
│   ├── TargetingSystem.js
│   └── InterceptionCalculator.js
```

**Interception Algorithm:**
1. Detect incoming threat
2. Calculate threat trajectory
3. Determine interception feasibility
4. Calculate optimal interception point
5. Compute launch parameters
6. Execute launch sequence
7. Track and adjust

### 5. Data Flow Architecture

```javascript
// Event-driven architecture
class EventBus {
  // Core events
  THREAT_DETECTED
  TRAJECTORY_CALCULATED
  INTERCEPTOR_LAUNCHED
  COLLISION_DETECTED
  INTERCEPTION_SUCCESS
  INTERCEPTION_FAILURE
}

// State management
class SimulationState {
  threats: Map<id, ThreatObject>
  interceptors: Map<id, InterceptorObject>
  batteries: Map<id, BatteryObject>
  statistics: SimulationStats
}
```

## Performance Optimization Strategies

### 1. Object Pooling
```javascript
class ObjectPool {
  constructor(objectClass, initialSize) {
    this.available = []
    this.inUse = new Set()
    // Pre-allocate objects
  }
  
  acquire() { /* Return pooled object */ }
  release(obj) { /* Return to pool */ }
}
```

### 2. Spatial Indexing
- Octree for 3D spatial partitioning
- Efficient broad-phase collision detection
- Dynamic object tracking

### 3. LOD System
```javascript
const LOD_LEVELS = {
  HIGH: { distance: 1000, vertices: 5000 },
  MEDIUM: { distance: 5000, vertices: 1000 },
  LOW: { distance: 10000, vertices: 100 }
}
```

### 4. Update Loops
```javascript
// Fixed timestep for physics
const PHYSICS_TIMESTEP = 1/60 // 60 Hz

// Variable timestep for rendering
function gameLoop(currentTime) {
  // Accumulator pattern for physics
  while (accumulator >= PHYSICS_TIMESTEP) {
    updatePhysics(PHYSICS_TIMESTEP)
    accumulator -= PHYSICS_TIMESTEP
  }
  
  // Interpolated rendering
  render(accumulator / PHYSICS_TIMESTEP)
}
```

## Algorithm Details

### Trajectory Prediction
```javascript
function predictTrajectory(initialPosition, velocity, angle) {
  const points = []
  const g = 9.81
  const dt = 0.1
  
  let t = 0
  let pos = {...initialPosition}
  let vel = {...velocity}
  
  while (pos.y >= 0) {
    // Apply physics
    vel.y -= g * dt
    
    // Apply drag
    const dragForce = calculateDrag(vel)
    vel = applyForce(vel, dragForce, dt)
    
    // Update position
    pos = addVectors(pos, scaleVector(vel, dt))
    
    points.push({...pos, time: t})
    t += dt
  }
  
  return points
}
```

### Interception Point Calculation
```javascript
function calculateInterceptionPoint(threat, interceptor) {
  // Iterative approach for non-linear trajectories
  let tIntercept = estimateInterceptTime()
  
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const threatPos = threat.getPositionAtTime(tIntercept)
    const interceptorTime = calculateTimeToReach(
      interceptor.position, 
      threatPos, 
      interceptor.velocity
    )
    
    const error = Math.abs(tIntercept - interceptorTime)
    if (error < TOLERANCE) break
    
    tIntercept = (tIntercept + interceptorTime) / 2
  }
  
  return threat.getPositionAtTime(tIntercept)
}
```

## Testing Strategy

### Unit Tests
- Physics calculations accuracy
- Trajectory prediction precision
- Collision detection reliability
- Algorithm correctness

### Integration Tests
- Multi-object interactions
- System performance under load
- Event system reliability
- State consistency

### Performance Tests
- Frame rate under various loads
- Memory usage patterns
- Physics accuracy vs. performance trade-offs

## Deployment Architecture

### Build Pipeline
```yaml
build:
  - Bun install
  - Run tests
  - Bundle with Vite
  - Optimize assets
  - Generate source maps
  
deploy:
  - Static hosting (Vercel/Netlify)
  - CDN for assets
  - Service worker for offline
```

### Browser Requirements
- WebGL 2.0 support
- ES2020+ JavaScript
- 4GB+ RAM recommended
- GPU with 1GB+ VRAM

## Security Considerations
- No sensitive military data
- Educational parameters only
- Client-side only (no backend)
- Open source friendly