# Trajectory System Dependencies and Critical Paths

## Dependency Graph

```
TrajectoryCalculator (Core)
├── ThreatManager
│   └── Threat entities
│       └── Physics simulation
├── IronDomeBattery
│   ├── InterceptionSystem
│   │   └── PredictiveTargeting (conditional)
│   └── Interceptor entities
├── ThreatAnalyzer
│   └── GameState (scoring)
└── TrajectoryVisualizer
    └── Three.js scene

ImprovedTrajectoryCalculator
├── InterceptionSystem (conditional)
└── IronDomeBattery (conditional)

PredictiveTargeting
└── InterceptionSystem (conditional)

ProportionalNavigation (UNUSED)
AdvancedBallistics (UNUSED)
```

## Critical Paths

### 1. Threat Spawn Critical Path
```
User Input/Timer → ThreatManager.spawnThreat()
  → TrajectoryCalculator.calculateLaunchParameters()
  → TrajectoryCalculator.getVelocityVector()
  → Threat.setVelocity()
  → Physics World Update
```
**Criticality**: HIGH - Affects all threats in game
**Performance**: Called once per threat spawn
**Failure Impact**: No threats appear, game unplayable

### 2. Interception Decision Critical Path
```
Game Loop → IronDomeBattery.update()
  → IronDomeBattery.evaluateThreats()
  → TrajectoryCalculator.calculateInterceptionPoint()
  → IronDomeBattery.tryIntercept()
  → Interceptor.launch()
```
**Criticality**: EXTREME - Core gameplay mechanic
**Performance**: Called every frame for each battery/threat pair
**Failure Impact**: No interceptions, player loses immediately

### 3. Trajectory Visualization Path
```
Threat Creation → TrajectoryVisualizer.createTrajectory()
  → TrajectoryCalculator.predictTrajectory()
  → Three.js Line Creation
  → Scene.add()
```
**Criticality**: MEDIUM - Visual feedback only
**Performance**: Called once per threat
**Failure Impact**: No trajectory lines, reduced gameplay clarity

### 4. Threat Analysis Path
```
Game Loop → ThreatAnalyzer.analyzeThreat()
  → TrajectoryCalculator.calculateInterceptionPoint()
  → ThreatAnalyzer.assessThreatLevel()
  → GameState.updateScore()
```
**Criticality**: LOW-MEDIUM - Affects scoring/statistics
**Performance**: Called periodically
**Failure Impact**: Incorrect threat assessment, scoring issues

## Performance Hotspots

### Most Called Methods
1. **calculateInterceptionPoint()** - O(n*m) per frame
   - n = number of active threats
   - m = number of batteries
   - Called up to 50 * 3 = 150 times per frame in heavy scenarios

2. **predictTrajectory()** - O(k) per threat
   - k = trajectory points (typically 50-100)
   - Called once per threat spawn
   - Memory allocation for point arrays

3. **calculateLaunchParameters()** - O(1) mathematical operations
   - Trigonometric calculations
   - Called for every launch (threat or interceptor)

### Memory Allocation Points
1. **predictTrajectory()** - Creates new arrays
2. **Trajectory visualization** - THREE.BufferGeometry allocation
3. **PredictiveTargeting** - Tracking history arrays

## Integration Points

### Core Systems Depending on TrajectoryCalculator
1. **ThreatManager** - Cannot spawn threats without it
2. **IronDomeBattery** - Cannot calculate intercepts without it
3. **TrajectoryVisualizer** - Cannot show paths without it
4. **ThreatAnalyzer** - Cannot assess threats without it

### Conditional Dependencies
1. **ImprovedTrajectoryCalculator**
   - Used when: `(window as any).__useImprovedAlgorithms !== false`
   - Fallback: TrajectoryCalculator
   - Risk: Different behavior between modes

2. **PredictiveTargeting**
   - Used when: `InterceptionSystem.useImprovedAlgorithms === true`
   - Fallback: None (feature disabled)
   - Risk: Performance overhead when enabled

## Migration Risk Assessment

### High Risk Components
1. **IronDomeBattery.tryIntercept()**
   - Direct player impact
   - No room for behavior changes
   - Must maintain exact interception success rates

2. **ThreatManager.spawnThreat()**
   - Affects all game difficulty
   - Trajectory changes alter entire game balance

### Medium Risk Components
1. **TrajectoryVisualizer**
   - Player-visible but not gameplay critical
   - Can tolerate minor visual differences

2. **InterceptionSystem coordination**
   - Affects multi-battery efficiency
   - Has fallback modes

### Low Risk Components
1. **ThreatAnalyzer**
   - Statistical only
   - Can be updated independently

2. **Performance monitoring**
   - Development tools
   - No player impact

## Recommended Consolidation Strategy

### Phase 1: Create Compatibility Layer
```typescript
class UnifiedTrajectorySystem {
  private basic: TrajectoryCalculator;
  private improved: ImprovedTrajectoryCalculator;
  private mode: 'basic' | 'improved' | 'advanced';
  
  // Maintain exact same API
  calculateLaunchParameters(...) {
    return this.basic.calculateLaunchParameters(...);
  }
  
  calculateInterceptionPoint(...) {
    switch(this.mode) {
      case 'basic': return this.basic.calculateInterceptionPoint(...);
      case 'improved': return this.improved.calculateInterceptionPoint(...);
      // ... 
    }
  }
}
```

### Phase 2: Gradual Migration
1. Replace imports one file at a time
2. Run performance benchmarks after each change
3. A/B test with feature flags

### Phase 3: Remove Old Systems
1. Delete unused trajectory calculators
2. Simplify configuration
3. Update documentation

## Testing Requirements

### Critical Test Cases
1. **Exact interception success rates**
   - Must match current 95% success rate
   - Test with various threat speeds/angles

2. **Frame time budget**
   - calculateInterceptionPoint < 0.5ms
   - Total trajectory calculations < 5ms/frame

3. **Trajectory accuracy**
   - Impact predictions within 1m of actual
   - Visual trajectories match physics

### Regression Tests
1. All current threat types spawn correctly
2. Interceptors hit targets at same rate
3. Performance doesn't degrade
4. No memory leaks introduced

## Monitoring Plan

### Metrics to Track
1. Average execution time per method
2. Frame rate with various threat counts
3. Memory usage over time
4. Interception success rates

### Rollback Triggers
1. Frame rate drops below 55fps
2. Interception rate changes by >2%
3. Memory usage increases >10%
4. Any game-breaking bugs