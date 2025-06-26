# Testing Guide - Iron Dome Simulator

## Manual Testing Checklist

### Basic Functionality
- [ ] Launch single threat from each spawn point
- [ ] Verify trajectory calculations are smooth
- [ ] Test all threat types (rocket, mortar, drone, ballistic, cruise)
- [ ] Spawn threats from all compass directions
- [ ] Verify impact predictions are accurate

### Stress Testing
- [ ] Spawn 50+ simultaneous threats
- [ ] Verify FPS remains above 30 on desktop
- [ ] Test battery coordination with multiple batteries
- [ ] Launch maximum interceptors (100+)
- [ ] Create chain of explosions

### Interception Testing
- [ ] Test interceptions at minimum range (10m)
- [ ] Test interceptions at maximum range (1000m)
- [ ] Verify proximity fuse detonations
- [ ] Test interceptor retargeting
- [ ] Verify success rate (~90-95%)

### Mobile Testing
- [ ] Test on iOS Safari
- [ ] Test on Android Chrome
- [ ] Verify touch controls (tap, drag, pinch)
- [ ] Check UI layout switching
- [ ] Verify performance (30 FPS target)
- [ ] Test haptic feedback

### Game Systems
- [ ] Purchase interceptors from shop
- [ ] Upgrade batteries through all 5 levels
- [ ] Place new batteries
- [ ] Test resource depletion
- [ ] Verify save/load functionality
- [ ] Test pause/unpause

### Visual Effects
- [ ] Verify explosion effects render correctly
- [ ] Check trail rendering at all distances
- [ ] Test day/night cycle transitions
- [ ] Verify weather effects (rain, wind)
- [ ] Check building window lighting

### Performance Profiling
- [ ] Use Stats.js (H key) to monitor FPS
- [ ] Check draw calls with developer tools
- [ ] Monitor memory usage over time
- [ ] Test with Chrome DevTools Performance tab
- [ ] Verify no memory leaks after extended play

### Debug Tools
- [ ] Enable debug mode (?debug=true)
- [ ] Test developer controls (Ctrl+Shift+D)
- [ ] Use Inspector UI for object examination
- [ ] Check performance overlay (Ctrl+Shift+P)
- [ ] Test screenshot mode (Ctrl+Shift+S)

## Automated Testing

While the project primarily uses manual testing, key calculations can be verified:

### Physics Validation
- Trajectory calculations match expected parabolic paths
- Wind effects apply correctly to projectiles
- Blast radius calculations are accurate

### Interception Logic
- Kalman filter predictions converge properly
- Optimal intercept points are calculated correctly
- Battery coordination prevents redundant launches

## Performance Benchmarks

### Desktop Targets
- 60 FPS with 50 active threats
- < 200 draw calls in combat
- < 500MB memory usage

### Mobile Targets  
- 30 FPS with 30 active threats
- < 100 draw calls
- < 300MB memory usage

## Common Issues to Test

1. **Memory Leaks**
   - Extended gameplay (30+ minutes)
   - Repeated threat spawning
   - Multiple explosion chains

2. **Edge Cases**
   - Zero interceptors available
   - All batteries destroyed
   - Maximum threats spawned
   - Extreme camera positions

3. **Browser Compatibility**
   - WebGL context loss recovery
   - Audio API availability
   - Touch event handling
   - Performance API support