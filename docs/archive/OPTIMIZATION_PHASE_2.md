# Optimization Phase 2 Plan

## Current Performance Bottlenecks
1. **Small World Size (200x200)**
   - Forces unrealistic physics scaling
   - Cramped gameplay
   - Limited strategic options

2. **Particle System**
   - Trail particles not pooled efficiently
   - Explosion particles create spikes
   - Too many draw calls

3. **Physics Updates**
   - Every projectile updates every frame
   - No spatial partitioning
   - Collision detection not optimized

4. **Rendering**
   - No frustum culling
   - All objects rendered regardless of distance
   - Shadow calculations for everything

## Optimization Priorities

### 1. World Expansion Prerequisites
Before expanding the world, we need:
- **Spatial Partitioning**: Octree or grid system
- **Frustum Culling**: Don't render off-screen objects
- **LOD System**: Reduce detail at distance
- **Chunk Loading**: For very large worlds

### 2. Physics Optimization
- **Spatial Hashing**: For collision detection
- **Fixed Time Step**: Consistent physics updates
- **Sleep States**: Inactive objects don't update
- **Batch Updates**: Process similar objects together

### 3. Rendering Optimization
- **Instanced Rendering**: For multiple threats/interceptors
- **Geometry Batching**: Combine similar meshes
- **Texture Atlas**: Reduce texture swaps
- **Shadow LOD**: Reduce shadow quality at distance

### 4. Memory Optimization
- **Aggressive Pooling**:
  - Projectile pools by type
  - Particle pools by effect
  - Sound pools
  - UI element pools

### 5. Trail System Rewrite
```javascript
class OptimizedTrailSystem {
  - Single geometry for all trails
  - Vertex buffer updates only
  - Time-based fade in shader
  - Maximum vertices cap
  - Automatic cleanup
}
```

### 6. Threat Management
```javascript
class ThreatBatcher {
  - Group threats by type
  - Batch physics updates
  - Shared materials
  - Instanced rendering
  - Predictive spawning
}
```

## Implementation Steps

### Phase 2.1: Foundation (Before World Expansion)
1. Implement spatial partitioning system
2. Add frustum culling
3. Create basic LOD system
4. Optimize current particle systems

### Phase 2.2: World Expansion
1. Increase world to 1000x1000
2. Adjust camera and controls
3. Implement minimap
4. Scale physics appropriately

### Phase 2.3: Advanced Optimizations
1. Instanced rendering for projectiles
2. Geometry batching
3. Advanced LOD (buildings, terrain)
4. Occlusion culling

### Phase 2.4: Polish
1. Profile and identify remaining bottlenecks
2. Optimize shaders
3. Reduce draw calls further
4. Memory usage optimization

## Performance Targets
- **60 FPS** with 100+ simultaneous threats
- **60 FPS** with 50+ active interceptors
- **<16ms** frame time on average hardware
- **<500MB** memory usage
- Support for **5000x5000** world size

## Profiling Metrics to Track
1. Draw calls per frame
2. Triangle count
3. Physics bodies active
4. Memory allocation rate
5. Frame time breakdown
6. GPU vs CPU bottlenecks

## Risk Mitigation
- Keep optimization changes modular
- Maintain gameplay feel
- Test on low-end devices
- Have rollback plan
- Profile before and after each change

## Success Criteria
- [ ] Stable 60 FPS with double current object count
- [ ] World size increased to 1000x1000 minimum
- [ ] Memory usage reduced by 30%
- [ ] Load time under 3 seconds
- [ ] No gameplay degradation