# Trajectory System Migration Guide

## Overview
This guide helps migrate from the current multiple trajectory systems to the new UnifiedTrajectorySystem.

## Benefits of Migration
- ✅ Single, consistent API
- ✅ Runtime configuration switching
- ✅ Backward compatibility
- ✅ Performance optimizations
- ✅ Easier testing and maintenance
- ✅ Future-proof architecture

## Migration Strategies

### Option 1: Drop-in Replacement (Recommended)
Replace imports without changing any code:

```typescript
// Before
import { TrajectoryCalculator } from '@/utils/TrajectoryCalculator';

// After
import { UnifiedTrajectorySystem as TrajectoryCalculator } from '@/systems/UnifiedTrajectorySystem';
```

This works because UnifiedTrajectorySystem provides static methods that match TrajectoryCalculator's API exactly.

### Option 2: Gradual Migration
Use the unified system alongside existing code:

```typescript
// Keep existing imports
import { TrajectoryCalculator } from '@/utils/TrajectoryCalculator';

// Add unified system for new features
import { UnifiedTrajectorySystem } from '@/systems/UnifiedTrajectorySystem';

// Configure for your needs
const trajectorySystem = new UnifiedTrajectorySystem({
  mode: 'improved',
  useKalmanFilter: true
});
```

### Option 3: Full Migration
Replace all trajectory systems with unified API:

```typescript
// Remove all old imports
// import { TrajectoryCalculator } from '@/utils/TrajectoryCalculator';
// import { ImprovedTrajectoryCalculator } from '@/utils/ImprovedTrajectoryCalculator';
// import { PredictiveTargeting } from '@/utils/PredictiveTargeting';

// Use only unified system
import { UnifiedTrajectorySystem } from '@/systems/UnifiedTrajectorySystem';
```

## Code Examples

### Basic Usage (No Changes Needed)
```typescript
// This code works with both old and new systems
const params = TrajectoryCalculator.calculateLaunchParameters(
  launchPos, targetPos, velocity, false
);

const velocityVector = TrajectoryCalculator.getVelocityVector(params);

const interception = TrajectoryCalculator.calculateInterceptionPoint(
  threatPos, threatVel, batteryPos, interceptorSpeed, isDrone
);
```

### Using Advanced Features
```typescript
// Create configured instance
const trajectory = new UnifiedTrajectorySystem({
  mode: 'improved',           // Use improved algorithms
  useKalmanFilter: true,      // Enable tracking
  guidanceMode: 'proportional' // Enable guidance
});

// Use instance methods for advanced features
const result = trajectory.calculateInterceptionPoint(
  threatPos, threatVel, batteryPos, interceptorSpeed, isDrone, threat
);
// Result includes confidence score

// Get guidance commands
const guidance = trajectory.calculateGuidanceCommand(
  interceptorPos, interceptorVel, targetPos, targetVel
);
```

### Switching Modes at Runtime
```typescript
const trajectory = UnifiedTrajectorySystem.getInstance();

// Start with basic mode
trajectory.updateConfig({ mode: 'basic' });

// Switch to improved mode for critical threats
if (threat.priority === 'high') {
  trajectory.updateConfig({ 
    mode: 'improved',
    useKalmanFilter: true 
  });
}
```

## Migration by File

### src/main.ts
```typescript
// No changes needed - uses static methods
```

### src/scene/ThreatManager.ts
```typescript
// Option 1: Change import only
import { UnifiedTrajectorySystem as TrajectoryCalculator } from '@/systems/UnifiedTrajectorySystem';

// Option 2: Use advanced features
const trajectory = new UnifiedTrajectorySystem({ mode: 'improved' });
// In spawnThreat method:
const params = trajectory.calculateLaunchParameters(...);
```

### src/entities/IronDomeBattery.ts
```typescript
// Replace conditional logic
// Before:
if ((window as any).__useImprovedAlgorithms !== false) {
  result = ImprovedTrajectoryCalculator.calculateInterceptionPoint(...);
} else {
  result = TrajectoryCalculator.calculateInterceptionPoint(...);
}

// After:
const trajectory = new UnifiedTrajectorySystem({
  mode: (window as any).__useImprovedAlgorithms !== false ? 'improved' : 'basic'
});
result = trajectory.calculateInterceptionPoint(...);
```

### src/scene/InterceptionSystem.ts
```typescript
// Simplify with unified system
class InterceptionSystem {
  private trajectory: UnifiedTrajectorySystem;
  
  constructor() {
    this.trajectory = new UnifiedTrajectorySystem({
      mode: this.useImprovedAlgorithms ? 'improved' : 'basic',
      useKalmanFilter: this.useImprovedAlgorithms
    });
  }
  
  // Remove separate PredictiveTargeting handling
  // It's now integrated in the unified system
}
```

## Testing Migration

### Update Test Imports
```typescript
// In test files
import { UnifiedTrajectorySystem } from '@/systems/UnifiedTrajectorySystem';

// Tests remain the same due to API compatibility
```

### Verify Behavior
1. Run existing tests - they should pass without changes
2. Check performance metrics remain similar
3. Verify interception success rates unchanged
4. Test mode switching works as expected

## Configuration Reference

### TrajectoryConfig Options
```typescript
interface TrajectoryConfig {
  mode: 'basic' | 'improved' | 'advanced';
  useKalmanFilter: boolean;      // Enable predictive tracking
  useEnvironmental: boolean;     // Enable wind, gravity variations
  guidanceMode: 'none' | 'proportional' | 'augmented';
  enableDebug: boolean;          // Enable debug logging
}
```

### Mode Comparison
| Feature | Basic | Improved | Advanced |
|---------|-------|----------|----------|
| Speed | Fastest | Fast | Moderate |
| Accuracy | Good | Better | Best |
| Confidence Score | No | Yes | Yes |
| Environmental | No | No | Yes |
| Kalman Filter | Optional | Optional | Optional |

## Rollback Plan

If issues arise, rollback is simple:

1. **For Option 1**: Just revert the import changes
2. **For Option 2**: Remove UnifiedTrajectorySystem usage
3. **For Option 3**: Restore original imports and code

The old systems remain in place during migration.

## Timeline

### Phase 1 (Week 1) ✅
- [x] Create UnifiedTrajectorySystem
- [x] Write comprehensive tests
- [x] Document migration strategies

### Phase 2 (Week 2) - Current
- [ ] Migrate ThreatManager
- [ ] Migrate IronDomeBattery
- [ ] Migrate InterceptionSystem
- [ ] Update tests

### Phase 3 (Week 3)
- [ ] Performance testing
- [ ] A/B testing with feature flags
- [ ] Monitor metrics

### Phase 4 (Week 4)
- [ ] Remove old systems
- [ ] Update all documentation
- [ ] Final optimization

## Common Issues & Solutions

### Issue: Different results between modes
**Solution**: This is expected. Improved mode is more accurate. Use A/B testing to verify improvements.

### Issue: Performance degradation
**Solution**: Start with 'basic' mode and selectively enable features:
```typescript
// Only use advanced features for high-priority threats
const config = threat.priority === 'high' 
  ? { mode: 'improved', useKalmanFilter: true }
  : { mode: 'basic' };
```

### Issue: Missing confidence scores
**Solution**: Check mode configuration. Only 'improved' and 'advanced' modes provide confidence.

### Issue: Guidance not working
**Solution**: Ensure guidanceMode is set to 'proportional' or 'augmented', not 'none'.

## Success Metrics

Track these metrics before and after migration:
1. **Performance**: Frame time should remain < 16ms
2. **Accuracy**: Interception success rate should maintain 95%+
3. **Memory**: No increase in memory usage
4. **Maintainability**: Reduced code complexity

## Questions?

Refer to:
- `src/systems/UnifiedTrajectorySystem.ts` - Implementation
- `tests/unified-trajectory-system.test.ts` - Usage examples
- `notes/trajectory-dependencies.md` - System dependencies