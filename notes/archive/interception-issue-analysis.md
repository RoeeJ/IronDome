# Interception Issue Analysis

## Problems Identified

### 1. Low Hit Rate (14.5% from ~90%)
**Root Cause**: The UnifiedTrajectorySystem singleton was using 'basic' mode by default, but the game expects 'improved' mode when `__useImprovedAlgorithms` is true.

**Fix Applied**: Updated the static `calculateInterceptionPoint` method to check the global setting and update the singleton's mode accordingly.

### 2. Interceptor Looping Behavior
**Root Cause**: The guidance system increases gain when distance < 20m, which can cause oscillation:
- Base gain: 2
- Close-range gain: 3
- This 50% increase in correction force can cause overcorrection

**Additional Issues**:
- The guidance applies up to 40G of force, which might be excessive
- No damping factor to prevent oscillation
- No minimum distance check to stop guidance when very close

## Recommended Fixes

### Immediate Fix for Looping
1. Add damping to the guidance correction
2. Reduce close-range gain multiplier
3. Stop guidance when very close (< 5m)

### Code Changes Needed

```typescript
// In Projectile.ts updateGuidance():
// Line 537 - Reduce gain and add distance-based scaling
const gain = Math.max(0.5, Math.min(2, distance / 20)); // Smooth scaling from 0.5 to 2

// Add damping based on closing velocity
const closingVelocity = currentVelocity.dot(toTarget.normalize());
const dampingFactor = closingVelocity > 100 ? 0.7 : 1.0; // Reduce correction when closing fast

// Apply damping
const correctionForce = velocityError.multiplyScalar(this.body.mass * gain * dampingFactor);

// Stop guidance when very close
if (distance < 5) {
  return; // Let momentum carry it
}
```

## Testing Notes

The mode configuration fix has been applied. The interceptor looping fix needs to be implemented and tested.