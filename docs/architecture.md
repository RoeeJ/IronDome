# Iron Dome Simulator - Architecture Documentation

## Overview

The Iron Dome Simulator is a web-based 3D defense system simulation built with Three.js, React, and Cannon-es physics. The architecture follows a modular, component-based design optimized for real-time performance while maintaining code maintainability and extensibility.

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      User Interface (React)                  │
├─────────────────────────────────────────────────────────────┤
│                      Game Systems Layer                      │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ WaveManager │  │ InterceptionSystem │  │ BatteryCoordinator │  │
│  └─────────────┘  └──────────────┘  └──────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│                     Core Entity Layer                        │
│  ┌──────────┐  ┌─────────┐  ┌────────────┐  ┌──────────┐  │
│  │ Threat   │  │ Projectile │  │ IronDomeBattery │  │ Effects  │  │
│  └──────────┘  └─────────┘  └────────────┘  └──────────┘  │
├─────────────────────────────────────────────────────────────┤
│                   Foundation Services                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ Physics  │  │ Rendering │  │ Resources │  │ GameState │  │
│  └──────────┘  └──────────┘  └──────────┘  └───────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Directory Structure

```
src/
├── entities/          # Core game objects
│   ├── IronDomeBattery.js    # Defense battery implementation
│   ├── Projectile.js         # Interceptor missile logic
│   └── Threat.js             # Enemy projectile types
├── scene/             # Scene management
│   ├── InterceptionSystem.js # Threat evaluation & targeting
│   ├── ThreatManager.js      # Threat spawning & lifecycle
│   └── RadarSystem.js        # Detection & tracking
├── systems/           # Game systems
│   ├── ExplosionManager.js   # Centralized explosion effects
│   ├── ProximityFuse.js      # Detonation detection
│   └── BlastPhysics.js       # Explosion physics
├── game/              # Game state & progression
│   ├── GameState.js          # Persistent state management
│   ├── WaveManager.js        # Wave-based gameplay
│   └── BatteryCoordinator.js # Multi-battery coordination
├── rendering/         # Performance optimization
│   ├── InstancedRenderer.js  # Base instanced rendering
│   └── specialized renderers # Type-specific optimizations
├── physics/           # Physics calculations
│   ├── Ballistics.js         # Trajectory calculations
│   ├── KalmanFilter.js       # Prediction filtering
│   └── ProportionalNavigation.js # Guidance algorithms
├── ui/                # React UI components
│   ├── GameUI.jsx            # Main UI container
│   ├── TacticalDisplay.jsx   # Radar visualization
│   └── StatsDisplay.jsx      # Performance metrics
├── utils/             # Shared utilities
│   ├── MaterialCache.js      # Material optimization
│   ├── GeometryFactory.js    # Geometry deduplication
│   └── DebugLogger.js        # Debug logging system
└── world/             # Environment systems
    ├── DayNightCycle.js      # Dynamic lighting
    ├── EnvironmentSystem.js  # Weather & atmosphere
    └── BattlefieldZones.js   # Spatial partitioning
```

## Core Components

### 1. Entity System

The entity system follows a component-based architecture where game objects are composed of reusable behaviors.

#### IronDomeBattery
- **Responsibility**: Manages defense installations with multiple launcher tubes
- **Key Features**:
  - Radar integration for threat detection
  - Ammunition management
  - Health/damage system
  - Upgrade capabilities
  - Event emission for state changes

#### Threat
- **Responsibility**: Represents enemy projectiles
- **Types**: Rockets, mortars, drones, ballistic missiles
- **Features**:
  - Physics-based movement
  - Trail rendering
  - Damage potential calculation
  - Target zone assignment

#### Projectile
- **Responsibility**: Interceptor missiles fired by batteries
- **Features**:
  - Proportional navigation guidance
  - Proximity fuse detonation
  - Trail effects
  - Performance optimization through instancing

### 2. System Management

#### InterceptionSystem
- **Purpose**: Central coordination of defense operations
- **Responsibilities**:
  - Threat prioritization
  - Battery assignment
  - Launch authorization
  - Success rate tracking

#### ThreatManager
- **Purpose**: Enemy threat lifecycle management
- **Features**:
  - Wave-based spawning
  - Impact detection
  - Damage calculation
  - Event notifications

#### BatteryCoordinator
- **Purpose**: Prevents targeting conflicts between batteries
- **Algorithm**: Optimized assignment based on:
  - Intercept probability
  - Time to impact
  - Battery readiness
  - Ammunition availability

### 3. Rendering Pipeline

The rendering system is optimized for handling hundreds of simultaneous objects:

#### Instanced Rendering
- **InstancedThreatRenderer**: Batches all threats of same type
- **InstancedProjectileRenderer**: Batches interceptor rendering
- **InstancedEffectsRenderer**: Batches explosion particles

#### Resource Optimization
- **MaterialCache**: Prevents shader recompilation
- **GeometryFactory**: Eliminates duplicate geometries
- **LOD System**: Reduces detail for distant objects

### 4. Physics Integration

#### Cannon-es Integration
```javascript
// Physics update cycle
world.step(1/60);
syncPhysicsToGraphics();
renderer.render(scene, camera);
```

#### Ballistics Calculations
- Realistic trajectory simulation
- Wind resistance modeling
- Gravity compensation
- Impact prediction

## Design Patterns

### 1. Singleton Pattern
Used for global systems that require single instances:
- `GameState` - Game progression and saves
- `MaterialCache` - Shared materials
- `GeometryFactory` - Shared geometries
- `ResourceManager` - Economy management

### 2. Observer Pattern
Event-driven architecture for loose coupling:
```javascript
// Example: Battery firing event
battery.on('missileFired', (data) => {
    gameState.updateStats(data);
    ui.showLaunchEffect(data);
});
```

### 3. Factory Pattern
Centralized object creation:
```javascript
// GeometryFactory example
const sphere = GeometryFactory.getSphere(radius);
const cone = GeometryFactory.getCone(radius, height);
```

### 4. Object Pooling
Reuse expensive objects:
- `LightPool` - Dynamic lighting
- `ParticleSystemPool` - Explosion effects
- Planned: Projectile pooling

## Data Flow

### 1. Game Loop Flow
```
Update Loop:
├── Physics Step
├── Entity Updates
│   ├── Threats update positions
│   ├── Projectiles update guidance
│   └── Batteries update state
├── System Updates
│   ├── RadarSystem scans
│   ├── InterceptionSystem evaluates
│   └── ExplosionManager processes
├── Rendering
│   ├── Instance buffer updates
│   ├── Effect rendering
│   └── UI updates
└── Frame cleanup
```

### 2. Threat Detection Pipeline
```
Threat Spawn → Radar Detection → Priority Calculation
     ↓              ↓                    ↓
Zone Assignment  Track Update    Interception Decision
     ↓              ↓                    ↓
UI Alert      Battery Assignment   Missile Launch
```

### 3. Resource Flow
```
GameState ←→ ResourceManager
    ↓             ↓
UI Display   Battery Operations
    ↓             ↓
Player HUD   Fire/Upgrade Actions
```

## Performance Considerations

### Optimization Strategies

1. **Batch Rendering**
   - All similar objects rendered in single draw call
   - Reduces GPU state changes

2. **Resource Sharing**
   - Materials cached and reused
   - Geometries deduplicated
   - Textures atlased where possible

3. **Culling**
   - Frustum culling for off-screen objects
   - LOD system for distant objects
   - Particle count limits

4. **Physics Optimization**
   - Simplified collision shapes
   - Spatial partitioning for broad phase
   - Sleep states for static objects

### Performance Limits
- Maximum 50 active threats
- Maximum 8 interceptors in flight
- Maximum 20 explosion effects
- Maximum 10-15 dynamic lights

## State Management

### Global State (GameState)
- Persistent across sessions
- Stored in localStorage
- Contains:
  - Player progress
  - Unlocked items
  - Statistics
  - Settings

### System State
Each major system maintains internal state:
- `ThreatManager`: Active threats, spawn queues
- `InterceptionSystem`: Targeting assignments
- `BatteryCoordinator`: Battery availability

### UI State
React components use hooks:
```javascript
const [selectedBattery, setSelectedBattery] = useState(null);
const [showUpgradeMenu, setShowUpgradeMenu] = useState(false);
```

## Extension Points

### Adding New Threat Types
1. Extend `Threat` class
2. Add to `ThreatType` enum
3. Configure in `ThreatManager`
4. Add visual model

### Adding New Defense Systems
1. Extend `IronDomeBattery` or create new class
2. Integrate with `InterceptionSystem`
3. Add UI controls
4. Configure costs/unlocks

### Adding New Game Modes
1. Extend `WaveManager`
2. Create mode-specific configuration
3. Add UI selection
4. Integrate with `GameState`

## Future Enhancements

### Planned Features
1. **Object Pooling**: Full implementation for all projectiles
2. **Networking**: Multiplayer support architecture
3. **Advanced AI**: Smarter threat patterns
4. **Mod Support**: Plugin system for community content

### Architecture Preparations
- Event system supports network synchronization
- Component architecture allows easy extension
- Resource system designed for economy balancing
- Rendering pipeline ready for advanced effects

## Conclusion

The Iron Dome Simulator architecture provides a solid foundation for a complex real-time 3D simulation. The modular design, performance optimizations, and extensibility points ensure the codebase can grow while maintaining quality and performance.

Key architectural strengths:
- Clear separation of concerns
- Performance-first design
- Extensible component system
- Robust state management
- Event-driven communication

This architecture successfully balances the competing demands of real-time performance, code maintainability, and feature extensibility.