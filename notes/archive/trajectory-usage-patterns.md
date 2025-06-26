# Trajectory Systems Usage Patterns

## Current Implementation Status

Based on analysis of the codebase, here are the actual usage patterns of trajectory systems:

## 1. TrajectoryCalculator (PRIMARY SYSTEM)

### Usage Locations
- `src/main.ts` - Main game loop
- `src/scene/ThreatManager.ts` - Threat spawning and trajectory setup
- `src/systems/ThreatAnalyzer.ts` - Threat assessment
- `src/entities/IronDomeBattery.ts` - Interception calculations

### Key Methods Used

#### calculateLaunchParameters(position, target, velocity, useLofted)
- **Purpose**: Calculate angle and heading for ballistic launch
- **Used by**: 
  - ThreatManager when spawning threats
  - IronDomeBattery when launching interceptors
- **Inputs**: 
  - position: THREE.Vector3 (launch position)
  - target: THREE.Vector3 (target position)
  - velocity: number (launch speed)
  - useLofted: boolean (high arc vs direct)
- **Returns**: { angle, heading, velocity, distance }

#### getVelocityVector(launchParams)
- **Purpose**: Convert launch parameters to 3D velocity
- **Used by**: Same as calculateLaunchParameters
- **Chain**: Always called after calculateLaunchParameters

#### predictTrajectory(position, velocity)
- **Purpose**: Generate array of future positions
- **Used by**: 
  - Trajectory visualization system
  - Impact prediction
- **Returns**: Array of { position, time }

#### calculateInterceptionPoint(threatPos, threatVel, batteryPos, interceptorSpeed, isDrone)
- **Purpose**: Find optimal interception point
- **Used by**: IronDomeBattery.tryIntercept()
- **Critical**: Core of interception system
- **Drone handling**: Different algorithm for constant altitude

### Usage Pattern Example
```javascript
// Typical threat spawning pattern
const launchParams = trajectoryCalculator.calculateLaunchParameters(
  spawnPosition,
  targetPosition, 
  threatSpeed,
  useLoftedTrajectory
);
const velocity = trajectoryCalculator.getVelocityVector(launchParams);
threat.setVelocity(velocity);

// Typical interception pattern
const interceptionData = trajectoryCalculator.calculateInterceptionPoint(
  threat.position,
  threat.velocity,
  battery.position,
  INTERCEPTOR_SPEED,
  threat.type === 'drone'
);
if (interceptionData.canIntercept) {
  battery.launch(interceptionData.point);
}
```

## 2. ImprovedTrajectoryCalculator (CONDITIONAL USE)

### Usage Locations
- `src/scene/InterceptionSystem.ts` - Advanced interception
- `src/entities/IronDomeBattery.ts` - When improved algorithms enabled

### Activation
- Controlled by `(window as any).__useImprovedAlgorithms`
- Falls back to basic TrajectoryCalculator when false

### Key Differences
- More iterations for convergence
- Better handling of edge cases
- Improved drone interception
- Higher computational cost

## 3. PredictiveTargeting (OPTIONAL ENHANCEMENT)

### Usage Location
- `src/scene/InterceptionSystem.ts` only

### Activation
- Only when `useImprovedAlgorithms` is true
- Adds Kalman filter prediction layer

### Methods Used
- `updateThreatTracking(threat)` - Called each frame
- `calculateLeadPrediction(threat, batteryPos, interceptorSpeed)`
- `cleanup()` - Remove old tracking data

### Integration Pattern
```javascript
if (this.useImprovedAlgorithms && this.predictiveTargeting) {
  this.predictiveTargeting.updateThreatTracking(threat);
  const prediction = this.predictiveTargeting.calculateLeadPrediction(
    threat,
    battery.position,
    interceptor.speed
  );
  if (prediction.confidence > 0.7) {
    // Use predicted aim point
  }
}
```

## 4. ProportionalNavigation (NOT INTEGRATED)

### Status
- Fully implemented in `src/physics/ProportionalNavigation.ts`
- No imports or usage found
- Ready for integration

### Intended Use
- Real-time interceptor guidance
- Course corrections during flight
- Would replace simple ballistic interceptors

## 5. AdvancedBallistics (NOT INTEGRATED)

### Status  
- Fully implemented in `src/physics/AdvancedBallistics.ts`
- No imports or usage found
- Most sophisticated physics model

### Features
- Wind effects
- Air density
- Coriolis force
- Temperature effects
- Projectile properties (mass, drag)

### Potential Integration Points
- Enhanced threat trajectories
- Weather system integration
- Realistic missile behavior

## Dependencies and Data Flow

### Core Flow
1. **Threat Spawn**: ThreatManager → TrajectoryCalculator → Threat entity
2. **Interception**: ThreatAnalyzer → IronDomeBattery → TrajectoryCalculator → Interceptor
3. **Visualization**: Threat → TrajectoryCalculator → TrajectoryVisualizer

### Conditional Enhancements
- If `__useImprovedAlgorithms`: Add ImprovedTrajectoryCalculator
- If `useImprovedAlgorithms` in InterceptionSystem: Add PredictiveTargeting

### Critical Observations
1. **TrajectoryCalculator is deeply integrated** - Used by 4+ systems
2. **Different systems expect different interfaces** - Some use all methods, some just one
3. **Drone vs missile logic scattered** - isDrone parameter passed through multiple layers
4. **No central configuration** - Each system decides which calculator to use
5. **Performance critical** - Called multiple times per frame for active threats

## Migration Risks

### High Risk Areas
1. **IronDomeBattery.tryIntercept()** - Core gameplay, must maintain exact behavior
2. **ThreatManager spawning** - Affects all threat trajectories
3. **Trajectory visualization** - Player-visible, must remain smooth

### Low Risk Areas
1. **ProportionalNavigation integration** - New feature, no existing dependencies
2. **AdvancedBallistics integration** - New feature, optional enhancement
3. **Performance monitoring consolidation** - Development tools only

## Recommended Migration Order
1. Create unified system with compatibility layer
2. Migrate visualization first (low risk, easy to verify)
3. Migrate threat spawning (medium risk, visible results)
4. Migrate interception last (high risk, core gameplay)
5. Add new features (PN, advanced ballistics) after consolidation