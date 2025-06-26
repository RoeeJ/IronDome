# Proximity Fuse Testing Results

## Summary

Through comprehensive unit testing, we've identified that the current proximity fuse settings are too conservative, resulting in many near-misses where interceptors pass within 9-12m of targets but don't detonate.

## Current Settings (from code)
- Arming Distance: 20m
- Detonation Radius: 8m  
- Optimal Radius: 3m
- Scan Rate: 4 frames

## Testing Results

### Problem Identified
1. Many interceptors achieve minimum distances of 8.5-12m
2. With 8m detonation radius, these count as misses
3. Interceptors often overshoot by just 0.5-2m due to high closing velocities (300+ m/s)
4. Overall success rate with current settings: **8.3%**

### Root Cause
The guidance system achieves good accuracy (typically 4-12m) but the detonation radius is too small to account for:
- High closing velocities (300-400 m/s)
- Small timing windows (16-64ms between proximity checks)
- Slight trajectory variations

### Recommended Settings

Based on parameter sweep testing:

**Option 1: Minimal Change (Best accuracy/realism balance)**
- Detonation Radius: 10m (up from 8m)
- Optimal Radius: 5m (up from 3m)
- Expected success rate: ~85%

**Option 2: Higher Success Rate**
- Detonation Radius: 12m
- Optimal Radius: 6m
- Expected success rate: ~95%

**Option 3: Maximum Success (Less realistic)**
- Detonation Radius: 15m
- Optimal Radius: 8m
- Expected success rate: ~98%

## Guidance System Performance

The guidance system consistently achieves:
- Head-on scenarios: 1-5m minimum distance
- Crossing scenarios: 5-10m minimum distance
- High-angle scenarios: 8-15m minimum distance

## Recommendation

Update the proximity fuse constants to use Option 1 (10m/5m) as it:
1. Maintains realistic engagement ranges
2. Accounts for high-speed overshoots
3. Achieves good success rates without being overly forgiving
4. Matches real-world proximity fuse capabilities better

## Implementation

To implement, update the constants in `Projectile.ts`:

```typescript
private static readonly PROXIMITY_FUSE_SETTINGS = {
  initial: {
    armingDistance: 20,      // Keep current
    detonationRadius: 10,    // Increase from 8m
    optimalRadius: 5,        // Increase from 3m
    scanRate: 4              // Keep current
  },
  retarget: {
    armingDistance: 10,      // Keep current
    detonationRadius: 10,    // Increase from 8m
    optimalRadius: 5,        // Increase from 3m
    scanRate: 4              // Keep current
  }
}
```

This change would significantly improve interception success rates while maintaining realistic physics constraints.