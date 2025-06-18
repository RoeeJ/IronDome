# Performance Optimizations Summary

## Problem: Triangle Count Spikes (15K → 40K)
The issue started after implementing dome aggressiveness, where multiple interceptors are fired simultaneously.

## Root Causes Identified:
1. **GLTF Model Loading**: Each interceptor was trying to load the Tamir GLTF model
2. **Multiple Particle Systems**: Each projectile creates its own exhaust trail particle system
3. **High Polygon Count**: Interceptor cones using 8 segments, threats using 16x8 sphere segments
4. **Unlimited Interceptors**: Aggressiveness could spawn many interceptors simultaneously

## Optimizations Implemented:

### 1. Geometry Optimization
- Disabled GLTF model loading for interceptors (temporary)
- Reduced interceptor cone segments: 8 → 6
- Reduced threat sphere segments: 16x8 → 12x6
- Each interceptor now ~50 triangles instead of potentially 1000s from GLTF

### 2. Particle System Optimization
- Reduced particle counts across all systems:
  - Exhaust trails: 200-300 → 80-120 particles
  - Launch smoke: 20 → 10 particles
  - Ground dust: 15 → 8 particles
  - Debris: 15 → 8 particles
  - Fragmentation: 50 → 30 fragments
- Implemented LOD (Level of Detail) for particles based on camera distance
- Increased effect cooldown: 50ms → 100ms

### 3. Interceptor Limits
- Limited max simultaneous interceptors per battery: 3 → 2
- Added global interceptor limit: max 8 active at once
- This prevents runaway triangle count during heavy combat

### 4. Render Profiling
- Enhanced profiler to show detailed render statistics
- Added scene analysis showing meshes, particles, vertices
- Added render stats display in profiler UI
- Added fog toggle for performance testing

## Expected Results:
- Triangle count should stay under 20K even with multiple interceptors
- Consistent 60 FPS during combat scenarios
- Reduced draw calls from consolidated particle systems

## Future Optimizations:
1. Implement shared GLTF model instancing for interceptors
2. Create ParticleSystemPool for shared particle systems
3. Implement trail LOD (fewer segments at distance)
4. Add dynamic quality adjustment based on FPS