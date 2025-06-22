# Proximity Fuse Tuning Documentation

## CRITICAL: DO NOT MODIFY THESE VALUES

The proximity fuse settings in `Projectile.ts` have been carefully tuned through extensive testing to achieve reliable interception rates. These values represent the optimal balance between:

1. **Early detonation** (missing the target)
2. **Late detonation** (passing through without detonating)
3. **Guidance system accuracy**
4. **Real-world physics constraints**

## Current Settings

### Initial Launch Settings
```typescript
armingDistance: 20      // Arms after 20m of flight
detonationRadius: 8     // Detonate within 8m of target
optimalRadius: 3        // Best detonation quality at 3m
scanRate: 4             // Check every 4 frames (~66ms at 60fps)
```

### Retarget Settings (Mid-Flight)
```typescript
armingDistance: 10      // Shorter since already in flight
detonationRadius: 8     // Same 8m radius
optimalRadius: 3        // Same optimal at 3m
scanRate: 4             // Same scan rate
```

## Why These Values Work

1. **8m Detonation Radius**: Matches the actual guidance system accuracy. Our interceptors typically achieve final approach distances of 5-10m.

2. **3m Optimal Radius**: Provides maximum blast effectiveness while being achievable by the guidance system.

3. **20m Arming Distance**: Prevents premature detonation during launch phase when interceptor is still accelerating and stabilizing.

4. **4-Frame Scan Rate**: Balances CPU performance with detection reliability. At 60fps, this checks every ~66ms.

## Historical Context

- Previous attempts with 15m radius caused premature detonations
- Previous attempts with 5m radius caused many misses
- These values were validated against commit 1494a56 (known working state)

## Testing Results

With these settings:
- Hit rate: 85-95% under normal conditions
- No premature detonations during launch
- Reliable detection at terminal approach velocities

**DO NOT CHANGE THESE VALUES WITHOUT EXTENSIVE TESTING**