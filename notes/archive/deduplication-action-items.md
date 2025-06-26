# Deduplication Action Items

## Completed (Phase 1 & 2) ✅

### Critical Performance Paths
1. **ExplosionManager Integration**
   - ✅ ThreatManager - All explosions migrated
   - ✅ IronDomeBattery - Destruction effects migrated
   
2. **Projectile.ts Optimization**
   - ✅ GeometryFactory for all geometries
   - ✅ MaterialCache for all materials
   - ✅ UnifiedTrailSystem for exhaust trails
   - ✅ Fixed disposal to not remove shared resources

3. **Main Application Files**
   - ✅ main.ts - Ground plane and trajectory visualization
   - ✅ Fixed BufferGeometry creation errors

4. **Core Entity Updates**
   - ✅ IronDomeBattery health bars
   - ✅ ThreatManager impact markers
   - ✅ Proper material disposal handling

## Remaining Opportunities (Priority Ordered)

### High Impact - Instanced Renderers (26 files remaining)
These create the most geometries and would benefit most from caching:

1. **rendering/InstancedProjectileRenderer.ts**
   - Creates cone geometry for every projectile type
   - Action: Use GeometryFactory.getCone()

2. **rendering/InstancedThreatRenderer.ts**
   - Creates multiple geometries for threat types
   - Action: Migrate all threat geometries to factory

3. **rendering/LODSystem.ts**
   - Creates LOD geometries for all entity types
   - Action: Cache LOD geometries in factory

### Medium Impact - Scene Systems
4. **scene/RadarSystem.ts**
   - Creates many ring and sphere geometries
   - Action: Use cached geometries for radar visuals

5. **scene/InterceptionSystem.ts**
   - Creates torus geometry for intercept indicators
   - Action: Cache visualization geometries

6. **systems/LaunchEffectsSystem.ts**
   - Creates cone and ring geometries for effects
   - Action: Migrate to cached geometries
   - Bonus: Integrate LightPool for flash effects

### Low Impact - UI and Debug Systems
7. **game/DomePlacementSystem.ts**
   - Creates placement preview geometries
   - Action: Cache preview geometries

8. **Other Systems**
   - FragmentationSystem.ts
   - DebrisSystem.ts
   - Various other effect systems

## Quick Wins (Can be done immediately)

1. **Add CircleGeometry to GeometryFactory**
   ```typescript
   getCircle(radius: number = 1, segments: number = 32): THREE.CircleGeometry {
     const key = `circle_${radius}_${segments}`;
     // ... caching logic
   }
   ```

2. **Fix Material Disposal Pattern**
   - Search for `.dispose()` calls on materials
   - Ensure only unique materials are disposed

3. **Complete LightPool Integration**
   - ThreatManager ground explosions
   - LaunchEffectsSystem muzzle flashes

## Performance Testing Checklist

- [ ] Run with 100+ simultaneous threats
- [ ] Monitor memory usage over 10 minutes
- [ ] Check for shader compilation freezes
- [ ] Verify no material disposal artifacts
- [ ] Test on low-end devices

## Code Patterns to Promote

### Do This:
```typescript
// Shared geometry
const sphereGeo = GeometryFactory.getInstance().getSphere(1, 16, 8);

// Shared material
const material = MaterialCache.getInstance().getMeshStandardMaterial({
  color: 0xff0000
});

// Unique geometry that changes
const trajectoryGeo = new THREE.BufferGeometry();
trajectoryGeo.setFromPoints(points);
// ... later
trajectoryGeo.dispose(); // OK - it's unique
```

### Don't Do This:
```typescript
// Creating duplicate geometries
const sphere = new THREE.SphereGeometry(1, 16, 8);

// Disposing shared materials
const material = MaterialCache.getInstance().getMaterial(...);
// ... later
material.dispose(); // NO! This breaks other objects
```