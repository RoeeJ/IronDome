# Resource Management Guide

## Overview
The Iron Dome Simulator uses centralized resource management systems to optimize performance and prevent memory issues. This guide explains how to properly use these systems.

## GeometryFactory

### Purpose
- Eliminates duplicate geometry creation
- Reduces memory usage by 10-20%
- Centralizes geometry management

### Usage
```typescript
import { GeometryFactory } from '../utils/GeometryFactory'

// Get shared geometry instance
const geometry = GeometryFactory.getInstance().getSphere(1, 16, 8)

// Available methods:
- getSphere(radius, widthSegments, heightSegments, ...)
- getBox(width, height, depth, ...)
- getCone(radius, height, radialSegments, ...)
- getCylinder(radiusTop, radiusBottom, height, ...)
- getPlane(width, height, widthSegments, heightSegments)
- getTorus(radius, tube, radialSegments, tubularSegments, arc)
- getRing(innerRadius, outerRadius, thetaSegments, ...)
- getOctahedron(radius, detail)
- getCircle(radius, segments, thetaStart, thetaLength)
```

### Important Notes
- NEVER dispose geometries from GeometryFactory
- If you need to transform a geometry, clone it first:
  ```typescript
  const rotatedGeometry = geometry.clone()
  rotatedGeometry.rotateX(Math.PI / 2)
  ```

## MaterialCache

### Purpose
- Prevents shader compilation freezes
- Shares materials across objects
- Reduces GPU memory usage

### Usage
```typescript
import { MaterialCache } from '../utils/MaterialCache'

// Get shared material instance
const material = MaterialCache.getInstance().getMeshStandardMaterial({
  color: 0xff0000,
  roughness: 0.5,
  metalness: 0.8
})

// Available methods:
- getMeshBasicMaterial(params)
- getMeshStandardMaterial(params)
- getMeshPhongMaterial(params)
- getLineBasicMaterial(params)
- getLineDashedMaterial(params)
- getPointsMaterial(params)
- getSpriteMaterial(params)
```

### Critical Rule
- NEVER dispose materials from MaterialCache
- Only dispose materials you create with `new THREE.Material*()`

## Common Patterns

### DO THIS:
```typescript
// Use factories for shared resources
const geometry = GeometryFactory.getInstance().getSphere(1, 16, 8)
const material = MaterialCache.getInstance().getMeshStandardMaterial({
  color: 0xff0000
})
const mesh = new THREE.Mesh(geometry, material)

// Clone if transformation needed
const rotatedGeometry = geometry.clone()
rotatedGeometry.rotateX(Math.PI / 2)

// Dispose only cloned/local resources
dispose() {
  rotatedGeometry.dispose() // OK - it's cloned
  // Don't dispose shared material or original geometry
}
```

### DON'T DO THIS:
```typescript
// Don't create duplicate geometries
const sphere = new THREE.SphereGeometry(1, 16, 8) // BAD

// Don't dispose shared resources
material.dispose() // BAD - breaks other objects
geometry.dispose() // BAD - it's shared

// Don't modify shared geometries directly
geometry.rotateX(Math.PI / 2) // BAD - affects all users
```

## Migration Checklist
When migrating existing code:
1. Replace `new THREE.*Geometry()` with `GeometryFactory.getInstance().get*()`
2. Replace `new THREE.*Material()` with `MaterialCache.getInstance().get*()`
3. Remove disposal of shared materials/geometries
4. Clone geometries before transforming them
5. Test for visual artifacts and memory leaks

## Performance Impact
- 10-20% memory reduction in combat scenarios
- Eliminated 1000+ ms shader compilation freezes
- Stable 60 FPS with proper resource management
- Reduced GPU memory pressure