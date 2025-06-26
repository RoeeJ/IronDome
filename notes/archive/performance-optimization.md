# Performance Optimization Notes

## Problem: Rendering Pipeline Freeze with Large Salvos

### Symptoms
- When spawning salvos of 20+ threats with multiple batteries, the entire rendering pipeline would freeze for ~1-2 seconds
- Chrome DevTools showed `getProgramInfoLog` taking 1349ms out of 1394ms frame time
- Only occurred with multiple batteries active

### Root Cause: Shader Compilation
WebGL compiles shaders on first use of a unique material/lights combination. Each battery was creating new materials with identical properties, causing shader recompilation for each battery instance.

### Solution: Material Caching

#### 1. Created MaterialCache Utility
- Singleton pattern to share materials across all batteries
- Caches materials by their properties (color, roughness, metalness)
- Provides methods for MeshStandardMaterial and MeshBasicMaterial
- Includes shader precompilation during initialization

#### 2. Updated Battery Creation
- Modified IronDomeBattery to use cached materials
- Only unique materials (transparent dome, emissive missiles) remain uncached
- Reduced material count from N batteries × M materials to just M unique materials

#### 3. Performance Limits
- Limited active threats to 50 (prevents physics overhead)
- Limited active interceptors to 8 (prevents triangle count spikes)
- Limited explosion effects to 20 concurrent
- Limited point lights to 10-15 active

#### 4. Optimized Salvo Spawning
- Replaced cascade of setTimeout with single requestAnimationFrame loop
- Pre-allocates threat configurations
- Prevents event loop blocking

#### 5. Explosion System Optimizations
- Reduced smoke particles from 10-25 to 5-15
- Added smoke texture caching
- Skip effects when too many active
- Limit active particle systems

## Results
- Eliminated 1349ms shader compilation freeze
- Smooth 60 FPS maintained during 20+ threat salvos
- No visual quality loss

## Future Optimizations
1. Cache transparent and emissive materials (requires special handling)
2. Implement full object pooling for projectiles and threats
3. Add LOD system for distant objects
4. Consider GPU instancing for identical meshes

## Lessons Learned
- Profile with Chrome DevTools to identify actual bottlenecks
- Shader compilation is often overlooked but can cause major freezes
- Material reuse is critical for dynamic object creation
- Always test with worst-case scenarios (max objects, multiple systems active)