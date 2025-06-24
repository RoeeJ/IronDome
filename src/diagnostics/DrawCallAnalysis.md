# Iron Dome Simulator Draw Call Analysis

## Summary
The Iron Dome simulator is experiencing 1700 draw calls, which is extremely high and causing performance issues. This analysis identifies the sources and provides optimization recommendations.

## Current Rendering Architecture

### Instanced Rendering Systems (Good)
The codebase has several instanced renderers already implemented:
- `InstancedThreatRenderer` - Handles threats with 4 mesh categories (rocket, mortar, drone, ballistic)
- `InstancedProjectileRenderer` - Handles interceptor projectiles
- `LODInstancedThreatRenderer` - LOD-aware threat rendering
- `InstancedExplosionRenderer` - Particle-based explosions
- `InstancedDebrisRenderer` - Debris particles
- `InstancedDomeRenderer` - Iron Dome batteries

### Non-Instanced Objects (Problem Areas)

#### 1. Individual Entity Meshes (High Impact)
Despite having instanced renderers, entities still create individual meshes:
- **Threats**: Each threat creates its own mesh (`scene.add(this.mesh)` in Threat.ts:226)
- **Projectiles**: Each projectile adds its own mesh AND trail (Projectile.ts:129, 171)
- **Batteries**: Each battery adds a group with multiple child meshes (IronDomeBattery.ts:117)

#### 2. Trail System (High Impact)
The `UnifiedTrailSystem` creates individual Line/Points objects for each trail:
- Line trails: One THREE.Line per projectile/threat
- Particle trails: One THREE.Points per trail
- With 50+ projectiles, this adds 50+ draw calls just for trails

#### 3. UI Elements (Medium Impact)
- Health bars for batteries (IronDomeBattery.ts:967)
- Impact markers for threats (ThreatManager.ts)
- Tactical display elements

#### 4. World/Environment Objects (Medium Impact)
- **WorldScaleIndicators**: Creates many individual meshes for:
  - Distance rings (multiple meshes)
  - Light poles (3 meshes per pole)
  - Trees (2 meshes per tree)
  - Buildings (multiple meshes per building)
- **BuildingSystem**: Individual meshes for:
  - Buildings with windows (multiple meshes per building)
  - Debris particles (individual meshes)
  - Damage states

#### 5. Explosion Effects (Low-Medium Impact)
- Shockwave meshes (individual per explosion)
- Flash lights (pooled but still individual lights)
- Crater decals (individual meshes)

## Draw Call Breakdown Estimate

Based on the analysis:
- **Threats**: 50 threats × 2 meshes (entity + trail) = 100 draw calls
- **Projectiles**: 100 projectiles × 2 meshes (entity + trail) = 200 draw calls
- **Batteries**: 8 batteries × ~10 meshes (base, launcher, radar, etc.) = 80 draw calls
- **World objects**: ~500-800 draw calls (buildings, indicators, trees, etc.)
- **Explosions/Effects**: 20-50 active effects = 20-50 draw calls
- **UI/HUD**: 50-100 draw calls
- **Shadows**: 2-3x multiplier for shadow passes

**Total**: Base ~1000 draw calls × shadow passes = ~1700-2000 draw calls

## Critical Issues

### 1. Duplicate Rendering
Entities are being rendered twice:
- Once through their individual meshes
- Once through instanced renderers
- The instanced renderers hide individual meshes but they still exist in the scene

### 2. No Batching for Static Geometry
World objects like buildings, trees, and indicators are all individual meshes instead of being batched.

### 3. Shadow Rendering
Every mesh casts shadows, multiplying draw calls by the number of shadow cascade levels.

### 4. Trail Rendering
Each projectile/threat has its own trail mesh instead of using a unified trail renderer.

## Optimization Recommendations

### Priority 1: Fix Duplicate Rendering
1. **Remove individual entity meshes** when using instanced rendering
   - Don't add threat/projectile meshes to scene when instanced rendering is enabled
   - Modify entity constructors to optionally skip mesh creation

### Priority 2: Implement Trail Instancing
1. **Create InstancedTrailRenderer**
   - Use instanced line segments or ribbon geometry
   - Update all trail positions in a single draw call
   - Support fade-out through instance attributes

### Priority 3: Batch Static Geometry
1. **Merge world geometry**
   - Combine all static buildings into merged geometry
   - Use texture atlasing for building variations
   - Implement BatchedWorldRenderer for all static objects

### Priority 4: Optimize Shadow Rendering
1. **Selective shadow casting**
   - Disable shadows for small objects (debris, particles)
   - Use simplified shadow proxies for complex objects
   - Reduce shadow cascade count on mobile

### Priority 5: Implement Frustum Culling
1. **Add visibility culling**
   - Don't render objects outside camera frustum
   - Use spatial indexing for efficient culling
   - Cull entire instanced groups when possible

### Priority 6: UI Optimization
1. **Use CSS3D for UI elements**
   - Move health bars to CSS3DRenderer
   - Use HTML/CSS for non-3D UI elements
   - Reduce Three.js UI objects

## Implementation Plan

### Phase 1: Quick Wins (1-2 days)
1. Disable individual entity meshes when instanced rendering is active
2. Remove shadow casting from particles and small debris
3. Reduce trail point counts

### Phase 2: Trail System (2-3 days)
1. Implement InstancedTrailRenderer
2. Convert all trails to use the new system
3. Remove individual trail meshes

### Phase 3: World Batching (3-4 days)
1. Implement geometry merging for static objects
2. Create LOD system for world objects
3. Optimize building rendering

### Phase 4: Advanced Optimizations (1 week)
1. Implement frustum culling
2. Add spatial indexing
3. Optimize shadow rendering pipeline

## Expected Results

After implementing these optimizations:
- **Current**: 1700 draw calls
- **Phase 1**: ~1200 draw calls (30% reduction)
- **Phase 2**: ~800 draw calls (55% reduction)
- **Phase 3**: ~400 draw calls (75% reduction)
- **Phase 4**: ~200-300 draw calls (85% reduction)

## Performance Monitoring

Add draw call tracking to RenderProfiler:
```typescript
const drawCalls = renderer.info.render.calls;
const triangles = renderer.info.render.triangles;
const geometries = renderer.info.memory.geometries;
const textures = renderer.info.memory.textures;
```