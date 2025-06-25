# Iron Dome Simulator - System Architecture

## Table of Contents
1. [Architectural Overview](#architectural-overview)
2. [Core Entity Systems](#core-entity-systems)
3. [Scene Management](#scene-management)
4. [Component Hierarchy](#component-hierarchy)
5. [Data Flow Architecture](#data-flow-architecture)
6. [Unity Architecture Mapping](#unity-architecture-mapping)

## Architectural Overview

The Iron Dome simulator implements a **layered, component-based architecture** with clear separation of concerns:

```
┌─────────────────────── UI Layer (React) ──────────────────────────┐
│ • TacticalDisplay        • ProfilerDisplay                        │
│ • SandboxControls        • GuidanceDiagnosticPanel               │
│ • ResponsiveUI           • SettingsPanel                         │
└─────────────────────────────────────────────────────────────────┘
┌─────────────────────── Game Systems Layer ────────────────────────┐
│ • InterceptionSystem     • ThreatManager                         │
│ • ExplosionManager       • LaunchEffectsSystem                   │
│ • SoundSystem           • GameState                              │
└─────────────────────────────────────────────────────────────────┘
┌─────────────────────── Entity Management Layer ──────────────────┐
│ • IronDomeBattery       • Projectile                            │
│ • Threat                • StaticRadarNetwork                     │
│ • WindSystem            • PerformanceMonitor                     │
└─────────────────────────────────────────────────────────────────┘
┌─────────────────────── Rendering/Physics Layer ──────────────────┐
│ • InstancedRenderers    • LODSystem                              │
│ • MaterialCache         • GeometryFactory                       │
│ • Physics World         • TrajectoryCalculator                   │
└─────────────────────────────────────────────────────────────────┘
┌─────────────────────── Utilities/Resources Layer ────────────────┐
│ • DeviceCapabilities    • MemoryMonitor                         │
│ • ResourceManager       • ModelCache                            │
│ • MobileInputManager    • Profiler                              │
└─────────────────────────────────────────────────────────────────┘
```

## Core Entity Systems

### 1. IronDomeBattery (Defense System)

**File**: `src/entities/IronDomeBattery.ts`  
**Unity Equivalent**: MonoBehaviour with multiple child components

```typescript
interface BatteryArchitecture {
  // Core Components
  position: THREE.Vector3;           // Transform.position
  radarRange: number;                // SphereCollider radius
  maxRange: number;                  // Weapon system range
  
  // Sub-systems
  launcherTubes: LauncherTube[];     // Child GameObjects
  radarSystem: RadarComponent;       // Detection component
  targetingSystem: TargetingComp;    // AI component
  ammoSystem: AmmoComponent;         // Resource component
  healthSystem: HealthComponent;     // Damage component
  
  // Performance State
  readyToFire: boolean;              // Cached state
  currentTargets: Threat[];          // Active tracking
  lastFireTime: number;              // Cooldown tracking
}
```

**Key Responsibilities**:
- **Threat Detection**: Radar scanning with configurable range
- **Target Prioritization**: Distance, impact time, and threat level scoring
- **Multi-tube Management**: 1-6 launcher tubes with individual reload timers
- **Resource Management**: Ammunition tracking and purchase integration
- **Health System**: Damage states with auto-repair capabilities
- **Coordination**: Multi-battery conflict prevention

**Unity Component Breakdown**:
```csharp
// Primary MonoBehaviour
public class IronDomeBattery : MonoBehaviour
{
    [Header("Detection")]
    public float radarRange = 70f;
    public LayerMask threatLayer;
    
    [Header("Weapon System")]
    public LauncherTube[] launcherTubes;
    public float reloadTime = 3f;
    public float interceptorSpeed = 100f;
    
    [Header("AI Behavior")]
    public float aggressiveness = 1.3f;
    public float firingDelay = 0.8f;
    
    // Component references
    private RadarSystem radarComponent;
    private TargetingSystem targetingComponent;
    private HealthSystem healthComponent;
}
```

### 2. Threat System (Enemy Projectiles)

**File**: `src/entities/Threat.ts`  
**Unity Equivalent**: MonoBehaviour extending Projectile

```typescript
interface ThreatArchitecture {
  // Inheritance from Projectile
  physics: CANNON.Body;              // Rigidbody component
  mesh: THREE.Object3D;              // MeshRenderer + mesh
  trajectory: TrajectoryData;        // Movement component
  
  // Threat-specific
  type: ThreatType;                  // Enum configuration
  targetPosition: THREE.Vector3;     // Destination target
  impactTime: number;                // Calculated impact
  impactPoint: THREE.Vector3;        // Predicted position
  priority: number;                  // Threat assessment
  
  // Behavioral
  guidanceSystem?: GuidanceComp;     // AI navigation
  exhaustTrail?: TrailRenderer;      // Visual effects
  countermeasures?: DefenseComp;     // Advanced threats
}
```

**Threat Type Configurations**:
- **Rockets**: High speed (200+ m/s), direct trajectory, short range
- **Mortars**: Arced trajectory, area damage, medium range
- **Drones**: Low altitude, variable speed, evasive maneuvers
- **Ballistic Missiles**: High altitude, high speed, long range

### 3. Projectile Base System (Interceptors)

**File**: `src/entities/Projectile.ts`  
**Unity Equivalent**: Base MonoBehaviour class

```typescript
interface ProjectileArchitecture {
  // Physics Integration
  physicsBody: CANNON.Body;          // Rigidbody
  mesh: THREE.Mesh | THREE.Group;    // Visual representation
  
  // Movement System
  velocity: THREE.Vector3;           // Physics velocity
  acceleration: THREE.Vector3;       // Applied forces
  position: THREE.Vector3;           // Current position
  
  // Guidance System
  target?: Threat;                   // Target reference
  guidanceType: GuidanceType;        // Navigation algorithm
  proximityFuseRange: number;        // Detonation distance
  
  // State Management
  isActive: boolean;                 // Lifecycle state
  launchTime: number;                // Time tracking
  timeToTarget: number;              // Calculated ETA
  
  // Visual Effects
  exhaustTrail?: ExhaustTrailSystem; // Particle system
  launchEffects?: LaunchEffects;     // Initial effects
}
```

**Guidance Systems Implemented**:
1. **Proportional Navigation**: Industry-standard guidance algorithm
2. **Kalman Filtering**: Noise reduction in target tracking
3. **Proximity Fuse**: Blast radius optimization
4. **Wind Compensation**: Environmental factor adjustment

## Scene Management

### Scene Hierarchy Organization

```
IronDomeSimulator (Root)
├── Environment/
│   ├── Terrain                    # Ground mesh with collision
│   ├── SkySystem                  # Day/night cycle
│   ├── WindSystem                 # Atmospheric simulation
│   └── LightingSystem             # Dynamic lighting
├── Defense/
│   ├── Battery_001                # IronDomeBattery instances
│   ├── Battery_002
│   └── RadarNetwork               # StaticRadarNetwork
├── Threats/
│   ├── ActiveThreats              # Dynamic threat container
│   └── ThreatSpawners             # Spawning system
├── Projectiles/
│   ├── ActiveInterceptors         # Flying interceptors
│   └── ProjectilePool             # Object pooling
├── Effects/
│   ├── Explosions                 # InstancedExplosionRenderer
│   ├── Particles                  # Various particle systems
│   └── TrailRenderers             # Exhaust trails
├── UI/
│   ├── WorldSpaceUI               # 3D UI elements
│   └── ScreenSpaceUI              # HUD elements
└── Systems/
    ├── GameManager                # Central coordination
    ├── PhysicsWorld               # Cannon-es integration
    └── PerformanceManager         # Optimization system
```

### Critical Manager Classes

#### GameState (Singleton)
**Responsibilities**:
- Persistent progression tracking
- Save/load functionality
- Resource management (money, upgrades)
- Statistics aggregation
- Settings management

#### InterceptionSystem (Central Coordinator)
**Responsibilities**:
- Threat detection aggregation
- Battery assignment optimization
- Conflict resolution between batteries
- Success rate tracking
- Performance analytics

#### ExplosionManager (Effect Coordinator)
**Responsibilities**:
- Explosion effect pooling
- Debris system management
- Screen shake coordination
- Audio synchronization
- Performance throttling

## Component Hierarchy

### Battery Component Structure

```typescript
// Main Battery Controller
class IronDomeBattery extends MonoBehaviour {
  // Core Components (Unity built-in)
  transform: Transform;              // Position/rotation
  rigidbody?: Rigidbody;            // Physics (if mobile)
  collider: Collider;               // Detection volume
  
  // Custom Components
  radarSystem: RadarComponent;       // Detection logic
  targetingSystem: TargetingComp;    // AI decision making
  launcherController: LauncherComp;  // Firing management
  healthSystem: HealthComponent;     // Damage/repair
  upgradeSystem: UpgradeComponent;   // Enhancement system
  
  // Visual Components
  meshRenderer: MeshRenderer;        // 3D model
  particleEffects: ParticleSystem[]; // Launch effects
  audioSource: AudioSource;          // Sound effects
  
  // UI Components
  healthBar: WorldSpaceCanvas;       // Status display
  rangeIndicator: LineRenderer;      // Visual range
}
```

### Threat Component Structure

```typescript
class Threat extends Projectile {
  // Inherited from Projectile
  movementComponent: MovementComp;   // Physics integration
  visualComponent: VisualComponent; // Mesh rendering
  trailComponent: TrailComponent;   // Exhaust effects
  
  // Threat-specific
  threatData: ThreatDataComponent;  // Type configuration
  targetingData: TargetingComp;     // Destination info
  countermeasures: DefenseComp;     // Advanced threats
  
  // AI Components (for drones)
  pathfinding?: NavMeshAgent;       // Navigation
  evasionLogic?: EvasionComponent;  // Defensive maneuvers
}
```

## Data Flow Architecture

### Event-Driven Communication

```typescript
// Central Event Bus Pattern
interface EventTypes {
  // Threat Events
  'threat.spawned': { threat: Threat };
  'threat.destroyed': { threat: Threat, cause: string };
  'threat.impacted': { threat: Threat, position: Vector3 };
  
  // Battery Events
  'battery.missileFired': { battery: IronDomeBattery, target: Threat };
  'battery.reloading': { battery: IronDomeBattery, tubeIndex: number };
  'battery.damaged': { battery: IronDomeBattery, damage: number };
  
  // System Events
  'interception.success': { interceptor: Projectile, threat: Threat };
  'interception.failed': { threat: Threat, reason: string };
  'game.paused': { timestamp: number };
  'performance.warning': { metric: string, value: number };
}
```

### Update Loop Hierarchy

```typescript
// Main Update Coordination
class GameManager extends MonoBehaviour {
  void Update() {
    // Phase 1: Input Processing
    inputManager.ProcessInput();
    
    // Phase 2: Game Logic Updates
    threatManager.UpdateThreats(Time.deltaTime);
    interceptionSystem.UpdateInterceptions(Time.deltaTime);
    batterySystem.UpdateBatteries(Time.deltaTime);
    
    // Phase 3: Physics Simulation
    physicsWorld.Step(Time.fixedDeltaTime);
    
    // Phase 4: Visual Updates
    effectsManager.UpdateEffects(Time.deltaTime);
    uiManager.UpdateUI();
    
    // Phase 5: Performance Monitoring
    performanceMonitor.RecordFrame();
  }
}
```

### State Management Pattern

```typescript
// Centralized State with Reactive Updates
class GameStateManager {
  // Core State
  private gameState: GameState = {
    isPlaying: boolean;
    currentWave: WaveData;
    batteries: BatteryState[];
    threats: ThreatState[];
    resources: ResourceState;
    statistics: GameStats;
  };
  
  // State Modification Methods
  updateBatteryState(batteryId: string, updates: Partial<BatteryState>): void;
  updateThreatState(threatId: string, updates: Partial<ThreatState>): void;
  updateResources(delta: ResourceDelta): void;
  
  // Reactive Subscriptions
  onStateChange(callback: (state: GameState) => void): void;
  onBatteryChange(batteryId: string, callback: (state: BatteryState) => void): void;
}
```

## Unity Architecture Mapping

### Component System Translation

| Three.js Pattern | Unity Equivalent | Implementation Notes |
|------------------|------------------|---------------------|
| `THREE.Object3D` | `Transform` component | Built-in hierarchy |
| `THREE.Mesh` | `MeshRenderer` + `MeshFilter` | Separate mesh data |
| `CANNON.Body` | `Rigidbody` component | Built-in physics |
| Event emitters | `UnityEvent<T>` | Type-safe events |
| Object pooling | `ObjectPool<T>` | Unity 2021+ feature |
| LOD objects | `LODGroup` component | Automatic switching |
| Instanced rendering | `Graphics.DrawMeshInstanced` | Batch rendering |

### Singleton Pattern Implementation

```csharp
// Unity Singleton Pattern
public class GameStateManager : MonoBehaviour
{
    public static GameStateManager Instance { get; private set; }
    
    private void Awake()
    {
        if (Instance == null)
        {
            Instance = this;
            DontDestroyOnLoad(gameObject);
        }
        else
        {
            Destroy(gameObject);
        }
    }
}
```

### Performance System Integration

```csharp
// Unity Job System Integration
[BurstCompile]
public struct TrajectoryCalculationJob : IJobParallelFor
{
    [ReadOnly] public NativeArray<Vector3> positions;
    [ReadOnly] public NativeArray<Vector3> velocities;
    [ReadOnly] public float deltaTime;
    
    public NativeArray<Vector3> results;
    
    public void Execute(int index)
    {
        results[index] = CalculateTrajectory(
            positions[index], 
            velocities[index], 
            deltaTime
        );
    }
}
```

### Mobile Optimization Architecture

```csharp
// Unity Mobile Performance Manager
public class MobilePerformanceManager : MonoBehaviour
{
    [Header("Quality Scaling")]
    public QualityLevel[] qualityLevels;
    public float targetFrameTime = 16.67f; // 60 FPS
    
    [Header("Dynamic Adjustments")]
    public bool enableDynamicBatching = true;
    public bool enableInstancing = true;
    public int maxDrawCalls = 100;
    
    private void Update()
    {
        float currentFrameTime = Time.smoothDeltaTime * 1000;
        if (currentFrameTime > targetFrameTime * 1.2f)
        {
            ReduceQuality();
        }
        else if (currentFrameTime < targetFrameTime * 0.8f)
        {
            IncreaseQuality();
        }
    }
}
```

## Architecture Benefits for Unity

### 1. **Enhanced Performance**
- Unity's Job System enables multi-threaded physics calculations
- Built-in LOD system provides automatic optimization
- Native instanced rendering support
- Burst compiler optimizations for math operations

### 2. **Improved Mobile Support**
- Unity's Adaptive Performance integration
- Built-in quality scaling systems
- Device-specific optimization profiles
- Power consumption optimization

### 3. **Better Development Tools**
- Unity Profiler for performance analysis
- Visual scripting support for game logic
- Advanced lighting and rendering pipelines
- Comprehensive debugging tools

### 4. **Cross-Platform Deployment**
- Single codebase for multiple platforms
- Platform-specific optimizations
- Cloud build integration
- Store deployment automation

---

This architecture provides a solid foundation for the Unity port while maintaining the sophisticated performance optimizations and modular design of the original Three.js implementation.