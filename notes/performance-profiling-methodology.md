# Performance Profiling Methodology

## Current Issues

### Measurement Discrepancy
- Frame time shows 10ms but individual measurements don't add up
- Missing time between profiler sections (unmeasured overhead)
- Multiple overlapping measurement systems (Stats.js, custom Profiler, RenderProfiler)

### Root Causes
1. **Measurement Gaps**: Time between `endSection()` and next `startSection()` is unmeasured
2. **Browser Overhead**: RAF callback overhead, compositor time, GPU/CPU sync not captured
3. **Inconsistent Methodology**: Different tools measure different aspects

## Proposed Consolidated Methodology

### 1. Unified Frame Timing
```typescript
// Single source of truth for entire frame
const frameStartTime = performance.now()
// ... all frame work ...
const frameEndTime = performance.now()
const totalFrameTime = frameEndTime - frameStartTime
```

### 2. Account for All Time
- Track "unmeasured" time explicitly: `unmeasuredTime = totalFrameTime - sumOfAllMeasuredSections`
- Add "Frame Overhead" section to capture gaps
- Reveals hidden costs and browser overhead

### 3. Browser API Integration
- Use Performance API: `performance.mark()` and `performance.measure()`
- Chrome DevTools Performance API integration
- GPU timing: `WebGLRenderingContext.getExtension('EXT_disjoint_timer_query')`

### 4. Hierarchical Full Coverage
```typescript
profiler.startSection('Frame')
  profiler.startSection('Pre-Update')    // Input, camera
  profiler.startSection('Simulation')    // Physics, threats
  profiler.startSection('Post-Update')   // GUI, cleanup  
  profiler.startSection('Render')        // All rendering
  profiler.startSection('Frame Overhead') // Remaining time
profiler.endSection('Frame')
```

### 5. GPU/CPU Timing Separation
- CPU time: Current `performance.now()` measurements
- GPU time: WebGL timer queries for actual GPU work
- Identifies CPU vs GPU bottlenecks

### 6. Statistical Analysis
- Track percentiles (P50, P95, P99) not just averages
- Identify frame spikes and correlate with game state
- Heat map of performance vs threat count/effects

### 7. Profiler Improvements
```typescript
class ImprovedProfiler {
  // Track frame start/end times
  private frameStartTime: number
  private totalFrameTime: number
  
  // Calculate unmeasured time
  getUnmeasuredTime(): number {
    const measuredTime = Array.from(this.sections.values())
      .reduce((sum, section) => sum + section.duration, 0)
    return this.totalFrameTime - measuredTime
  }
  
  // Add percentile tracking
  private percentiles: Map<string, number[]> = new Map()
  
  // Add spike detection
  detectSpikes(threshold: number = 2): ProfilerSpike[] {
    // Return sections that exceeded average by threshold
  }
}
```

### 8. Integration Points
- Keep existing profiler sections during deduplication
- Add profiling to new unified systems
- Ensure no measurement gaps in refactored code

## Implementation Priority
1. First: Document current profiling points before deduplication
2. During: Maintain profiling coverage in unified systems
3. After: Implement improved methodology once systems are consolidated