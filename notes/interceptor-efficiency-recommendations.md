# Interceptor Efficiency Recommendations

## Current Situation

Testing reveals a significant efficiency problem:
- **Current behavior**: 3 interceptors fired per threat
- **Actual need**: 1 interceptor per threat (with 12m proximity fuse)
- **Waste rate**: 66.7% of interceptors are wasted
- **Result**: For 20 threats, we fire 60+ interceptors instead of 20

## Root Cause

1. **Proximity fuse radius increased to 12m** achieves near 100% single-shot success
2. **Aggressiveness setting (1.3)** still assumes lower success rates
3. **Multiple batteries** can compound the problem without proper coordination

## Recommendations

### Option 1: Reduce Aggressiveness (Simple Fix)
```typescript
// In IronDomeBattery constructor
aggressiveness: 0.5,  // Reduced from 1.3
```
This would fire:
- 0 interceptors base (floor(0.5) = 0)
- +1 for normal threats
- +1 for high priority threats (>0.7)
- Result: 1-2 interceptors per threat

### Option 2: Implement Smart Salvo Logic
```typescript
calculateInterceptorCount(threat: Threat, existingInterceptors: number = 0): number {
  // With improved proximity fuse, we need fewer interceptors
  const PROXIMITY_FUSE_SUCCESS_RATE = 0.95 // 95% with 12m radius
  
  if (existingInterceptors > 0) {
    // Already engaged, don't add more
    return 0
  }
  
  const threatLevel = this.assessThreatLevel(threat)
  
  // For 95% success rate, we need:
  // 1 interceptor = 95% kill probability
  // 2 interceptors = 99.75% kill probability
  // 3 interceptors = 99.99% kill probability
  
  if (threatLevel > 0.9) {
    // Critical threat: 2 interceptors for 99.75% success
    return Math.min(2, this.getLoadedTubeCount())
  } else if (threatLevel > 0.5) {
    // Normal threat: 1 interceptor for 95% success
    return Math.min(1, this.getLoadedTubeCount())
  } else {
    // Low priority: might skip to conserve ammo
    return this.config.conserveAmmo ? 0 : 1
  }
}
```

### Option 3: Add Success Rate Feedback
Track actual interception success and dynamically adjust:
```typescript
class InterceptionSuccessTracker {
  private recentAttempts: { success: boolean, interceptorCount: number }[] = []
  private readonly SAMPLE_SIZE = 20
  
  recordAttempt(success: boolean, interceptorCount: number) {
    this.recentAttempts.push({ success, interceptorCount })
    if (this.recentAttempts.length > this.SAMPLE_SIZE) {
      this.recentAttempts.shift()
    }
  }
  
  getRecommendedInterceptorCount(): number {
    const successRate = this.calculateSuccessRate()
    
    if (successRate > 0.9) {
      return 1 // High success, use single interceptor
    } else if (successRate > 0.7) {
      return 2 // Moderate success, use pair
    } else {
      return 3 // Low success, use salvo
    }
  }
}
```

### Option 4: Difficulty-Based Settings
Adjust based on game mode:
```typescript
const difficultySettings = {
  easy: {
    aggressiveness: 1.5,    // Fire more for safety
    proximityRadius: 15,    // Larger radius
  },
  normal: {
    aggressiveness: 0.8,    // Balanced
    proximityRadius: 12,    // Current optimized
  },
  hard: {
    aggressiveness: 0.5,    // Conservative ammo use
    proximityRadius: 10,    // Smaller radius
  },
  realistic: {
    aggressiveness: 0.3,    // Very conservative
    proximityRadius: 8,     // Original tight radius
  }
}
```

## Recommended Implementation

1. **Immediate**: Reduce default aggressiveness to 0.8
2. **Short term**: Implement smart salvo logic (Option 2)
3. **Long term**: Add success tracking and dynamic adjustment (Option 3)

## Expected Results

With optimized settings:
- **Before**: 60-75 interceptors for 20 threats
- **After**: 20-30 interceptors for 20 threats
- **Savings**: 50-70% reduction in interceptor usage
- **Success rate**: Maintained at 95%+

This would make the game more realistic and resource management more meaningful while maintaining high interception success rates.