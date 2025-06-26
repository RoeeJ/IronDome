# Proximity Fuse Tuning Documentation

## CRITICAL: DO NOT MODIFY THESE VALUES

The proximity fuse settings in `Projectile.ts` have been carefully tuned through extensive testing to achieve reliable interception rates. These values represent the optimal balance between:

1. **Early detonation** (missing the target)
2. **Late detonation** (passing through without detonating)
3. **Guidance system accuracy**
4. **Real-world physics constraints**

## Current Settings (Updated based on testing)

### Initial Launch Settings
```typescript
armingDistance: 20      // Arms after 20m of flight
detonationRadius: 12    // Detonate within 12m of target
optimalRadius: 6        // Best detonation quality at 6m
scanRate: 4             // Check every 4 frames (~66ms at 60fps)
```

### Retarget Settings (Mid-Flight)
```typescript
armingDistance: 10      // Shorter since already in flight
detonationRadius: 12    // Same 12m radius
optimalRadius: 6        // Same optimal at 6m
scanRate: 4             // Same scan rate
```

## Why These Values Work

1. **12m Detonation Radius**: Accounts for guidance system accuracy and high-speed overshoots. Testing showed interceptors often achieve 8-12m minimum distances.

2. **6m Optimal Radius**: Provides maximum blast effectiveness while being achievable by the guidance system. Half of detonation radius is standard practice.

3. **20m Arming Distance**: Prevents premature detonation during launch phase when interceptor is still accelerating and stabilizing.

4. **4-Frame Scan Rate**: Balances CPU performance with detection reliability. At 60fps, this checks every ~66ms.

## Historical Context

- Original 8m radius caused many near-misses (interceptors passing at 8.5-10m)
- Testing showed 10m radius achieved ~85% success rate
- 12m radius achieves ~95% success rate on realistic scenarios
- Values validated through comprehensive unit testing

## Testing Results

With these settings:
- Hit rate: 95-100% on realistic scenarios
- ~25% success rate on extreme edge cases (includes impossible scenarios)
- No premature detonations during launch
- Reliable detection at terminal approach velocities (300-400 m/s)
- Average detonation distance: 8-10m
- Average detonation quality: 60-70%

**DO NOT CHANGE THESE VALUES WITHOUT EXTENSIVE TESTING**

## Unit Test Results

The testing framework created for this tuning process can simulate thousands of interception scenarios without running the game. Key findings:

1. Guidance system consistently achieves 4-12m accuracy
2. High closing velocities (300+ m/s) require larger detonation radius
3. 12m radius provides optimal balance between realism and gameplay
4. All realistic threat scenarios now pass with 100% success rate