# Immediate Draw Call Optimizations

## Quick Fixes You Can Apply Now

### 1. Prevent Duplicate Threat/Projectile Rendering

In `src/entities/Threat.ts`, modify the constructor to skip mesh creation when instanced rendering is active:

```typescript
// Add at the beginning of constructor
if (window.__instancedRenderingActive) {
  this.mesh = new THREE.Object3D(); // Dummy object
  return; // Skip actual mesh creation
}
```

### 2. Disable Shadow Casting for Particles

In `src/systems/ExplosionManager.ts` and particle systems:

```typescript
// When creating particle meshes
mesh.castShadow = false;
mesh.receiveShadow = false;
```

### 3. Reduce Trail Points

In `src/systems/UnifiedTrailSystem.ts`:

```typescript
// Change default trail points
const maxPoints = config.maxPoints || 25; // Was 50
```

### 4. Batch World Indicators

In `src/world/WorldScaleIndicators.ts`, merge geometries:

```typescript
private createMergedRings(): THREE.Mesh {
  const geometries: THREE.BufferGeometry[] = [];
  
  // Create all ring geometries
  for (let i = 0; i < this.distances.length; i++) {
    const geometry = new THREE.RingGeometry(radius - 1, radius + 1, 64);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, 0.1, 0);
    geometries.push(geometry);
  }
  
  // Merge into single geometry
  const mergedGeometry = BufferGeometryUtils.mergeGeometries(geometries);
  return new THREE.Mesh(mergedGeometry, material);
}
```

### 5. Add Draw Call Counter

In `src/main.ts`, add to the animation loop:

```typescript
// After renderer.render(scene, camera)
if (window.__showDrawCalls) {
  const info = renderer.info;
  console.log(`Draw Calls: ${info.render.calls}, Triangles: ${info.render.triangles}`);
  renderer.info.reset(); // Reset after each frame
}
```

### 6. Disable Instanced Mesh Visibility

In `src/rendering/InstancedThreatRenderer.ts`:

```typescript
addThreat(threat: Threat): boolean {
  // ... existing code ...
  
  // Instead of just hiding, remove from parent
  if (threat.mesh.parent) {
    threat.mesh.parent.remove(threat.mesh);
  }
  threat.mesh.visible = false;
  
  return true;
}
```

## Testing the Optimizations

1. Open browser console
2. Run: `window.__showDrawCalls = true`
3. Watch draw call count in console
4. Target: Under 500 draw calls for good performance

## Expected Immediate Impact

- **Before**: 1700 draw calls
- **After these fixes**: ~800-1000 draw calls
- **Performance gain**: 40-50% reduction

## Next Steps

After applying these quick fixes:

1. Implement proper InstancedTrailRenderer
2. Create BatchedBuildingSystem
3. Add frustum culling
4. Implement LOD for world objects