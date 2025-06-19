# Iron Dome Simulator - Complete Project Documentation

## Table of Contents
1. [Project Overview](#project-overview)
2. [Core Systems](#core-systems)
3. [Entity Types](#entity-types)
4. [Physics System](#physics-system)
5. [Rendering & Optimization](#rendering--optimization)
6. [Interception Logic](#interception-logic)
7. [User Interface](#user-interface)
8. [Performance Systems](#performance-systems)
9. [Algorithms & Calculations](#algorithms--calculations)
10. [Unity Porting Considerations](#unity-porting-considerations)

## Project Overview

The Iron Dome Simulator is a real-time 3D simulation of a missile defense system built with Three.js and Cannon-ES physics. It simulates threats (rockets, mortars, drones, cruise missiles) and defensive interceptors with realistic ballistic trajectories.

### Key Technologies
- **Rendering**: Three.js (WebGL)
- **Physics**: Cannon-ES (physics engine)
- **UI**: lil-gui, custom canvas overlays
- **Language**: TypeScript
- **Build System**: Vite

## Core Systems

### 1. Scene Management (`src/main.ts`)
- Initializes Three.js scene with gradient sky background
- Sets up WebGL renderer with device-specific settings
- Manages game loop (60 FPS target)
- Coordinates all subsystems
- Handles window resizing and mobile responsiveness

### 2. Threat Management System (`src/scene/ThreatManager.ts`)
- Spawns various threat types at configurable intervals
- Manages threat lifecycle (spawn → flight → impact/interception)
- Supports salvo attacks (multiple simultaneous launches)
- Creates ground/air explosions on impact
- Tracks impact predictions for each threat

### 3. Interception System (`src/scene/InterceptionSystem.ts`)
- Automatically calculates intercept solutions
- Prioritizes threats based on:
  - Time to impact
  - Distance to protected assets
  - Threat warhead size
  - Interception probability
- Manages multiple Iron Dome batteries
- Calculates optimal launch timing
- Tracks success/failure statistics

### 4. Iron Dome Battery (`src/entities/IronDomeBattery.ts`)
- 3D model with rotating radar dish
- 20 launch tubes (4x5 grid)
- Reload mechanics (3 second delay)
- Launch effects and animations
- Range limitations (5-70km typically)

## Entity Types

### Threats (`src/entities/Threat.ts`)

#### Threat Types Enum
```typescript
enum ThreatType {
  // Rockets
  SHORT_RANGE, MEDIUM_RANGE, LONG_RANGE,
  // Specific variants
  QASSAM_1, QASSAM_2, QASSAM_3, GRAD_ROCKET,
  // Other threats
  MORTAR, DRONE_SLOW, DRONE_FAST, CRUISE_MISSILE
}
```

#### Threat Configurations
Each threat type has:
- **Velocity**: Speed in m/s
- **Max Range**: Maximum distance
- **Max Altitude**: Peak height for ballistic threats
- **Warhead Size**: Damage potential (kg)
- **Color**: Visual identification
- **Radius**: Physical size
- **Special Properties**:
  - `isDrone`: Different physics, maintains altitude
  - `isMortar`: High arc trajectory
  - `maneuverability`: Course correction capability
  - `cruiseAltitude`: For cruise missiles/drones
  - `rcs`: Radar cross section

#### Special Behaviors
1. **Drones**: 
   - Maintain cruise altitude using lift forces
   - Can maneuver toward targets
   - Hover capabilities
   - Terminal dive when near target

2. **Mortars**:
   - Launch at 80-85° angles
   - Short range, high arc
   - Quick to launch

3. **Cruise Missiles**:
   - Terrain following (low altitude)
   - Long range
   - Terminal guidance

### Projectiles (`src/entities/Projectile.ts`)
Base class for all flying objects:
- Physics body (Cannon-ES)
- 3D mesh (Three.js)
- Smoke trail system
- Exhaust glow effect
- Unique ID system

### Interceptors
- Extend Projectile class
- High velocity (900-1200 m/s)
- Small, agile
- Blue trail color
- No warhead (kinetic kill)

## Physics System

### Integration
- **Engine**: Cannon-ES
- **Timestep**: Fixed 60Hz (1/60 second)
- **Gravity**: -9.82 m/s²
- **Solver**: 10 iterations for stability

### Ballistic Calculations (`src/utils/TrajectoryCalculator.ts`)

#### Launch Parameter Calculation
For ballistic projectiles, calculates:
1. **Direct Fire Solution**: Lower angle, faster
2. **Indirect Fire Solution**: Higher angle, slower
3. **Optimal Angle**: Based on range and constraints

#### Key Algorithms

**Trajectory Calculation**:
```typescript
// For given range and velocity, find launch angle
sin(2θ) = (R × g) / v²

Where:
- θ = launch angle
- R = range to target
- g = gravity (9.82 m/s²)
- v = launch velocity
```

**Intercept Calculation**:
```typescript
// Proportional Navigation for intercept
1. Calculate target state at time t
2. Find collision point where:
   |threat_pos(t) - interceptor_pos(t)| < threshold
3. Use Newton-Raphson iteration for refinement
4. Account for target acceleration
```

**Impact Prediction**:
```typescript
// Solve quadratic for ground impact time
y = y₀ + v₀t - 0.5gt²
0 = y₀ + v₀t - 0.5gt²
t = (-v₀ ± √(v₀² + 2gy₀)) / (-g)
```

## Rendering & Optimization

### Standard Rendering
- Individual meshes per threat/interceptor
- Particle systems for trails
- Point lights for explosions
- Shadow mapping (optional)

### Optimized Rendering System

#### 1. Instanced Threat Renderer (`src/rendering/OptimizedThreatRenderer.ts`)
- Uses THREE.InstancedMesh
- Supports 1000 instances per threat type
- Single draw call per type
- Dynamic instance allocation
- Color/position attributes per instance

#### 2. Instanced Projectile Renderer (`src/rendering/OptimizedProjectileRenderer.ts`)
- Separate pools for interceptors/missiles
- Optimized trail rendering using ribbons
- 500 interceptors + 500 missiles capacity
- Minimal overdraw

#### 3. Spatial Indexing (`src/utils/SimpleSpatialIndex.ts`)
- Grid-based partitioning
- O(1) insertion/removal
- Efficient radius queries
- Configurable cell size

#### 4. Performance Optimizer (`src/core/PerformanceOptimizer.ts`)
- Central control system
- Device-specific presets
- Auto quality adjustment
- FPS monitoring
- Feature toggles

### LOD System
- Distance-based quality reduction
- Hide distant objects
- Reduce particle counts
- Simplify shaders

## Interception Logic

### Threat Assessment
1. **Detection**: Radar network detects all active threats
2. **Tracking**: Calculate trajectory and impact point
3. **Prioritization**: Score based on:
   - Time to impact (weight: 0.4)
   - Warhead size (weight: 0.3)
   - Distance to assets (weight: 0.2)
   - Intercept probability (weight: 0.1)

### Intercept Solution
1. **Feasibility Check**:
   - Is threat in range?
   - Do we have interceptors?
   - Can we reach intercept point in time?

2. **Point Selection**:
   - Start from 60% of threat flight time
   - Iterate forward to find optimal point
   - Ensure altitude > 100m (safety)
   - Maximize probability of kill

3. **Launch Timing**:
   - Calculate interceptor flight time
   - Account for:
     - Launch preparation (0.5s)
     - Interceptor acceleration
     - Safety margins
   - Launch when: `current_time + flight_time = intercept_time`

### Success Determination
- Distance threshold: 5 meters
- Velocity considered for fast-moving targets
- Both entities destroyed on success
- Statistics tracked for analysis

## User Interface

### GUI Controls (`lil-gui`)
- **Simulation**:
  - Start/Stop spawning
  - Auto-intercept toggle
  - Clear all threats
  - Spawn single threat
  - Stress test buttons

- **Debug**:
  - Show trajectories
  - Show radar ranges
  - Performance stats
  - Profiler overlay

- **Threat Control**:
  - Spawn type mix
  - Threat pools management

- **Performance**:
  - Quality presets
  - Feature toggles
  - Auto-adjustment

### Tactical Display (`src/ui/TacticalDisplay.ts`)
- Top-down radar view
- Real-time threat tracking
- Intercept visualization
- Status information
- Touch-responsive

### Mobile UI (`src/ui/ResponsiveUI.ts`)
- Adaptive button sizing
- Touch-friendly controls
- Gesture support
- Orientation handling

## Performance Systems

### Profiler (`src/utils/Profiler.ts`)
- Hierarchical timing
- Section tracking
- Real-time display
- Performance warnings

### Performance Monitor (`src/utils/PerformanceMonitor.ts`)
- FPS tracking
- Memory usage
- Draw calls
- GPU timing

### Device Capabilities (`src/utils/DeviceCapabilities.ts`)
- GPU detection
- Performance tier assessment
- Adaptive quality settings
- Mobile detection

## Algorithms & Calculations

### Key Mathematical Concepts

1. **Ballistic Trajectory**:
   - Position: `p(t) = p₀ + v₀t + 0.5at²`
   - Velocity: `v(t) = v₀ + at`
   - Max height: `h = v₀²sin²(θ)/2g`
   - Range: `R = v₀²sin(2θ)/g`

2. **Proportional Navigation**:
   - Lead angle calculation
   - Closing velocity
   - Zero-effort miss distance
   - Acceleration commands

3. **Collision Prediction**:
   - Relative motion analysis
   - Time to closest approach
   - Miss distance calculation

4. **Priority Scoring**:
   ```typescript
   score = w₁(1/timeToImpact) + w₂(warheadSize) + 
           w₃(1/distanceToAssets) + w₄(interceptProb)
   ```

## Unity Porting Considerations

### Direct Mappings
1. **Three.js → Unity**:
   - `THREE.Scene` → Unity Scene
   - `THREE.Mesh` → GameObject + MeshRenderer
   - `THREE.Vector3` → Vector3
   - `THREE.Quaternion` → Quaternion
   - `THREE.Group` → GameObject hierarchy

2. **Cannon-ES → Unity Physics**:
   - `CANNON.World` → Physics settings
   - `CANNON.Body` → Rigidbody
   - `CANNON.Vec3` → Vector3
   - Gravity/timestep → Project Settings

3. **Rendering**:
   - InstancedMesh → GPU Instancing
   - Particle systems → Shuriken
   - Trails → Trail Renderer
   - Materials → Standard/URP shaders

### Unity-Specific Improvements
1. **Performance**:
   - Built-in LOD groups
   - Occlusion culling
   - Better instancing support
   - Compute shaders for trajectories

2. **Physics**:
   - More accurate solver
   - Continuous collision detection
   - Better performance at scale
   - Physics layers

3. **Effects**:
   - Visual Effect Graph
   - Shader Graph
   - Post-processing stack
   - Particle strips for trails

4. **UI**:
   - Unity UI system
   - Canvas-based HUD
   - Event system
   - Better mobile support

### Architecture Recommendations
1. **Component System**:
   - ThreatBehavior component
   - ProjectileBehavior component
   - BatteryController component
   - RadarSystem component

2. **Object Pooling**:
   - Built-in pooling system
   - Separate pools per threat type
   - Projectile pools

3. **State Management**:
   - ScriptableObjects for configs
   - Game state manager
   - Event system for communication

4. **Optimization**:
   - Jobs System for trajectory calculation
   - Burst Compiler
   - ECS for massive scale
   - Addressables for assets

### Key Systems to Replicate
1. Trajectory calculation algorithms
2. Interception logic and prioritization
3. Threat spawn patterns
4. Ballistic physics
5. Special behaviors (drones, mortars)
6. Performance scaling
7. Mobile adaptations

### Data to Transfer
- Threat configurations (velocity, range, etc.)
- Spawn patterns and timings
- Physics constants
- UI layouts
- Color schemes
- Effect parameters