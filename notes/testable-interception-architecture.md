# Testable Interception System Architecture

## Current Problems

1. **Tight Coupling**: InterceptionSystem is tightly coupled to Three.js Scene and Cannon.js World
2. **Side Effects**: Many methods have side effects (creating visual effects, modifying scene)
3. **External Dependencies**: Depends on singletons (GameState, ResourceManager)
4. **Time Dependencies**: Uses Date.now() and setTimeout
5. **Random Elements**: Uses Math.random() for various decisions

## Proposed Architecture

### 1. Core Interception Logic (Pure Functions)

Create a new module with pure functions for core calculations:

```typescript
// src/systems/InterceptionCalculator.ts
export interface InterceptionScenario {
  interceptorPosition: Vector3
  interceptorVelocity: Vector3
  threatPosition: Vector3
  threatVelocity: Vector3
  interceptorSpeed: number
  gravity: number
}

export interface InterceptionResult {
  shouldFire: boolean
  aimPoint: Vector3
  timeToIntercept: number
  probability: number
}

export function calculateInterception(scenario: InterceptionScenario): InterceptionResult
export function calculateOptimalLaunchTime(scenario: InterceptionScenario): number
export function calculateHitProbability(distance: number, relativeVelocity: Vector3): number
```

### 2. Guidance System Testing

```typescript
// src/systems/GuidanceSimulator.ts
export interface GuidanceState {
  position: Vector3
  velocity: Vector3
  target: Vector3
  targetVelocity: Vector3
}

export interface GuidanceCommand {
  thrust: Vector3
  torque: Vector3
}

export function calculateGuidanceCommand(state: GuidanceState, deltaTime: number): GuidanceCommand
export function simulateGuidanceStep(state: GuidanceState, command: GuidanceCommand, deltaTime: number): GuidanceState
```

### 3. Proximity Fuse Testing

```typescript
// src/systems/ProximityFuseSimulator.ts
export interface FuseState {
  armed: boolean
  distanceTraveled: number
  currentDistance: number
  closingRate: number
}

export function updateFuseState(state: FuseState, deltaTime: number): FuseState
export function shouldDetonate(state: FuseState, settings: ProximityFuseSettings): boolean
```

### 4. Test Utilities

```typescript
// src/testing/InterceptionTestUtils.ts
export class InterceptionSimulator {
  // Simulate entire interception scenarios without Three.js/Cannon.js
  simulateInterception(scenario: InterceptionScenario): SimulationResult
  
  // Run multiple scenarios with different parameters
  runParameterSweep(baseScenario: InterceptionScenario, parameters: ParameterRange[]): SweepResult[]
}

export class MockThreat {
  // Controllable threat for testing
  constructor(position: Vector3, velocity: Vector3, trajectory: TrajectoryType)
  update(deltaTime: number): void
}

export class MockInterceptor {
  // Controllable interceptor for testing
  constructor(position: Vector3, settings: InterceptorSettings)
  setGuidanceTarget(threat: MockThreat): void
  update(deltaTime: number): void
}
```

### 5. Dependency Injection

```typescript
// Refactor InterceptionSystem to accept dependencies
export interface InterceptionSystemDeps {
  scene?: THREE.Scene
  world?: CANNON.World
  timeProvider?: () => number
  randomProvider?: () => number
  effectsRenderer?: EffectsRenderer
}

export class InterceptionSystem {
  constructor(deps: InterceptionSystemDeps = {}) {
    this.timeProvider = deps.timeProvider || Date.now
    this.randomProvider = deps.randomProvider || Math.random
    // etc...
  }
}
```

## Implementation Steps

1. **Extract Pure Functions** (Phase 1)
   - Create InterceptionCalculator with pure trajectory calculations
   - Create GuidanceSimulator for guidance logic
   - Create ProximityFuseSimulator for fuse logic

2. **Create Test Utilities** (Phase 2)
   - MockThreat and MockInterceptor classes
   - InterceptionSimulator for full scenario testing
   - Parameter sweep utilities

3. **Refactor Existing Code** (Phase 3)
   - Add dependency injection to InterceptionSystem
   - Extract visual effects into separate renderer
   - Use pure functions for calculations

4. **Write Comprehensive Tests** (Phase 4)
   - Unit tests for each pure function
   - Integration tests for full scenarios
   - Performance benchmarks
   - Parameter optimization tests

## Example Test Scenarios

1. **Head-on Interception**
   - Threat coming directly at battery
   - Test various speeds and altitudes

2. **Crossing Target**
   - Threat passing perpendicular to battery
   - Test lead calculation accuracy

3. **High-Altitude Ballistic**
   - Steep descent angle
   - Test trajectory prediction

4. **Low-Altitude Cruise**
   - Horizontal flight path
   - Test reaction time

5. **Maneuvering Target**
   - Target changes velocity mid-flight
   - Test guidance adaptation

## Benefits

1. **Rapid Testing**: Test thousands of scenarios in seconds
2. **Parameter Tuning**: Find optimal proximity fuse settings automatically
3. **Regression Prevention**: Ensure changes don't break working behavior
4. **Performance Testing**: Measure computation time without rendering
5. **Edge Case Discovery**: Find failure modes systematically