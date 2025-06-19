# Iron Dome Optimization Guide

## Overview

This guide explains the optimization systems implemented to support large-scale maps without performance degradation.

## Key Systems

### 1. Chunk Manager (`ChunkManager`)

The world is divided into chunks that load/unload based on camera position.

**Features:**
- 200m x 200m chunks by default
- Dynamic loading within view distance
- Automatic physics body creation
- Memory efficient unloading

**Usage:**
```typescript
const chunkManager = new ChunkManager(scene, {
  chunkSize: 200,      // Size of each chunk
  viewDistance: 3,     // Chunks to render around camera
  worldSize: 20        // 20x20 chunks = 4km x 4km world
})
chunkManager.setCamera(camera)

// In animation loop
chunkManager.update()
```

### 2. Level of Detail (`LODManager`)

Automatically switches between different detail levels based on distance.

**Features:**
- 4 detail levels: high, medium, low, billboard
- Automatic mesh switching
- Support for custom LOD objects

**Usage:**
```typescript
const lodManager = new LODManager(scene)
lodManager.setCamera(camera)

// Create LOD for threat
const threatLOD = lodManager.createThreatLOD(
  'threat_1',
  position,
  color,
  radius
)

// Update position
lodManager.updatePosition('threat_1', newPosition)
```

### 3. Instanced Rendering (`InstancedRenderer`)

Renders many similar objects with a single draw call.

**Features:**
- Massive performance boost for particles/debris
- Dynamic instance management
- Custom attributes support

**Usage:**
```typescript
const instancedRenderer = new InstancedRenderer(scene)

// Create group
instancedRenderer.createInstancedGroup(
  'debris',
  geometry,
  material,
  1000  // max instances
)

// Add instance
const index = instancedRenderer.addInstance(
  'debris',
  position,
  rotation,
  scale
)

// Update instance
instancedRenderer.updateInstance(
  'debris',
  index,
  newPosition
)
```

### 4. Spatial Indexing (`SpatialIndex`)

Quadtree-based spatial queries for efficient collision detection and range queries.

**Features:**
- O(log n) spatial queries
- Radius and box queries
- Nearest neighbor search
- Debug visualization

**Usage:**
```typescript
const spatialIndex = new SpatialIndex(worldBounds)

// Insert object
spatialIndex.insert({
  id: 'threat_1',
  position: new THREE.Vector3(100, 50, 200),
  radius: 5,
  type: 'threat'
})

// Query radius
const nearbyObjects = spatialIndex.queryRadius(
  center,
  radius
)

// Find nearest threats
const nearestThreats = spatialIndex.queryByType(
  position,
  100,  // radius
  'threat'
)
```

## Migration Steps

### 1. Update ThreatManager

```typescript
// Add spatial indexing
class ThreatManager {
  private spatialIndex: SpatialIndex
  
  spawnThreat() {
    // ... create threat ...
    
    // Add to spatial index
    this.spatialIndex.insert({
      id: threat.id,
      position: threat.getPosition(),
      radius: threat.radius,
      type: 'threat',
      data: threat
    })
    
    // Use LOD
    const lod = this.lodManager.createThreatLOD(
      threat.id,
      threat.position,
      threat.color,
      threat.radius
    )
  }
  
  update() {
    // Update spatial positions
    for (const threat of this.threats) {
      this.spatialIndex.update(
        threat.id,
        threat.getPosition()
      )
      
      // Update LOD
      this.lodManager.updatePosition(
        threat.id,
        threat.getPosition()
      )
    }
  }
}
```

### 2. Update Radar System

```typescript
class StaticRadarNetwork {
  checkDetection(position: THREE.Vector3): boolean {
    // Use spatial index for efficiency
    const nearbyRadars = this.spatialIndex.queryRadius(
      position,
      this.maxRange
    )
    
    return nearbyRadars.some(radar => 
      radar.position.distanceTo(position) <= radar.radius
    )
  }
}
```

### 3. Update Interception System

```typescript
class InterceptionSystem {
  findThreatsInRange(battery: IronDomeBattery): Threat[] {
    // Use spatial query instead of iterating all threats
    const nearbyObjects = this.spatialIndex.queryByType(
      battery.getPosition(),
      battery.getConfig().maxRange,
      'threat'
    )
    
    return nearbyObjects
      .map(obj => obj.data as Threat)
      .filter(threat => battery.canIntercept(threat))
  }
}
```

### 4. Update Explosion Effects

```typescript
// Use instanced rendering for debris
function createExplosion(position: THREE.Vector3) {
  const debrisCount = 20
  
  for (let i = 0; i < debrisCount; i++) {
    const velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 10,
      Math.random() * 15,
      (Math.random() - 0.5) * 10
    )
    
    const index = instancedRenderer.addInstance(
      'debris',
      position,
      new THREE.Euler(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI
      )
    )
    
    // Store velocity for physics update
    debrisVelocities.set(index, velocity)
  }
}
```

## Performance Tips

### 1. Chunk Optimization
- Keep chunk size between 100-500m
- Adjust view distance based on device (2-3 for mobile, 3-5 for desktop)
- Unload distant chunks aggressively

### 2. LOD Best Practices
- Use billboards beyond 500m
- Reduce polygon count by 50% per LOD level
- Share geometries between instances

### 3. Instancing Guidelines
- Use for any object with 10+ copies
- Batch updates when possible
- Pre-allocate instance buffers

### 4. Spatial Index Usage
- Update positions only when objects move significantly (>1m)
- Use appropriate query radius (not too large)
- Clear unused objects regularly

## Performance Targets

With optimizations enabled:
- **Mobile**: 30-60 FPS with 100+ active objects
- **Desktop**: 60+ FPS with 500+ active objects
- **World Size**: 4km x 4km playable area
- **Draw Calls**: <100 with instancing
- **Memory**: <500MB for geometry/textures

## Debugging

Enable debug visualizations:
```javascript
// Show chunk borders
optimizationControls.showChunkBorders = true

// Show spatial index
optimizationControls.showSpatialIndex = true

// Log performance stats
console.log('Chunks loaded:', chunkManager.getLoadedChunks().length)
console.log('Spatial objects:', spatialIndex.getStats())
console.log('Instance usage:', instancedRenderer.getStats())
```

## Next Steps

1. **Occlusion Culling**: Hide objects behind terrain
2. **Mesh Merging**: Combine static objects per chunk
3. **Texture Atlasing**: Reduce texture switches
4. **Web Workers**: Offload physics calculations
5. **WebGPU**: Next-gen rendering when available