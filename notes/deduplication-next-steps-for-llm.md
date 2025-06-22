# Iron Dome Simulator - Deduplication Next Steps

## Context for LLM
You are continuing work on a performance optimization effort for the Iron Dome Simulator. The project has implemented deduplication systems (GeometryFactory, MaterialCache, ExplosionManager, UnifiedTrailSystem) that are partially adopted. Your task is to complete the migration of remaining files to use these systems.

## Current State
- **GeometryFactory**: Located at `/src/utils/GeometryFactory.ts` - Caches and reuses geometries
- **MaterialCache**: Located at `/src/utils/MaterialCache.ts` - Caches and reuses materials  
- **ExplosionManager**: Located at `/src/systems/ExplosionManager.ts` - Unified explosion system
- **UnifiedTrailSystem**: Located at `/src/systems/UnifiedTrailSystem.ts` - Unified trail rendering

## Priority Tasks

### Task 1: Add CircleGeometry Support to GeometryFactory
**File**: `/src/utils/GeometryFactory.ts`
**Action**: Add a new method to support CircleGeometry caching
```typescript
getCircle(
  radius: number = 1,
  segments: number = 32,
  thetaStart: number = 0,
  thetaLength: number = Math.PI * 2
): THREE.CircleGeometry
```
**Why**: ThreatManager needs this for crater decals

### Task 2: Migrate Instanced Renderers (High Priority)
These files create many geometries and have the highest performance impact:

#### 2.1 InstancedProjectileRenderer
**File**: `/src/rendering/InstancedProjectileRenderer.ts`
**Current Issue**: Line 23 creates `new THREE.ConeGeometry(0.3, 2, 8)`
**Action**: 
- Import GeometryFactory
- Replace with `GeometryFactory.getInstance().getCone(0.3, 2, 8)`
- Do NOT dispose shared geometries in cleanup

#### 2.2 InstancedThreatRenderer  
**File**: `/src/rendering/InstancedThreatRenderer.ts`
**Current Issues**: Creates multiple geometries (lines 32, 35, 37, 39)
**Action**:
- Import GeometryFactory and MaterialCache
- Replace all `new THREE.*Geometry()` with GeometryFactory calls
- Replace material creation with MaterialCache calls
- Update disposal logic to not dispose shared resources

#### 2.3 LODSystem
**File**: `/src/rendering/LODSystem.ts`
**Current Issues**: Creates many LOD level geometries (lines 80-155)
**Action**:
- Import GeometryFactory
- Cache all LOD geometries through factory
- Consider adding LOD-specific keys to prevent conflicts

### Task 3: Migrate Scene Systems (Medium Priority)

#### 3.1 RadarSystem
**File**: `/src/scene/RadarSystem.ts`
**Current Issues**: Multiple geometry creations (lines 51, 61, 86, 110, 132, 188)
**Action**:
- Migrate all visualization geometries to use factories
- Pay attention to BufferGeometry that uses setFromPoints - these might be unique

#### 3.2 StaticRadarNetwork  
**File**: `/src/scene/StaticRadarNetwork.ts`
**Current Issues**: Creates sphere, ring, cylinder geometries (lines 83, 112, 135, 151, 168, 186)
**Action**:
- Use GeometryFactory for all static geometries
- Use MaterialCache for all materials

### Task 4: Complete LightPool Integration (Low Priority)

#### 4.1 LaunchEffectsSystem
**File**: `/src/systems/LaunchEffectsSystem.ts`
**Current Issues**: 
- Creates geometries (lines 77, 126, 237, 252, 323)
- Could use LightPool for muzzle flash
**Action**:
- Import and use GeometryFactory
- Import and use MaterialCache
- Add LightPool for flash effects (optional)

### Task 5: Fix Material Disposal Issues
**Action**: Search entire codebase for patterns that dispose shared materials
```bash
# Search for problematic disposal patterns
grep -r "MaterialCache.*dispose\(\)" src/
grep -r "material.*dispose\(\)" src/ | grep -v "// Don't dispose"
```
**Fix**: Add comments or remove disposal of shared materials

## Testing Guidelines

### After Each File Migration:
1. Run build: `bun run build`
2. Check for TypeScript errors: `bunx tsc --noEmit`
3. Test in browser - verify no visual artifacts
4. Check console for no missing material/geometry errors

### Performance Validation:
1. Open browser DevTools Performance tab
2. Start recording
3. Trigger heavy combat scenario (press 'B' multiple times)
4. Check for:
   - No shader compilation spikes
   - Stable memory usage
   - No increasing geometry count

## Code Patterns to Follow

### DO THIS:
```typescript
// Import at top
import { GeometryFactory } from '../utils/GeometryFactory'
import { MaterialCache } from '../utils/MaterialCache'

// Use factories
const geometry = GeometryFactory.getInstance().getSphere(1, 16, 8)
const material = MaterialCache.getInstance().getMeshStandardMaterial({
  color: 0xff0000
})

// For unique geometries (like dynamic BufferGeometry)
const uniqueGeometry = new THREE.BufferGeometry()
uniqueGeometry.setFromPoints(dynamicPoints)
// Later: safe to dispose
uniqueGeometry.dispose()
```

### DON'T DO THIS:
```typescript
// Don't create duplicate geometries
const sphere = new THREE.SphereGeometry(1, 16, 8)

// Don't dispose shared materials
material.dispose() // This will break other objects!

// Don't dispose geometries from factories
geometry.dispose() // This is shared!
```

## Expected Outcomes
- Further 10-20% memory reduction
- Elimination of remaining geometry duplication
- More consistent performance
- Cleaner codebase with centralized resource management

## Notes for Implementation
- Start with Task 1 (CircleGeometry) as it's needed by ThreatManager
- Focus on high-impact files first (instanced renderers)
- Always test after each file to catch issues early
- If unsure whether a geometry is unique or shared, check if it changes during runtime
- BufferGeometry with setFromPoints() is usually unique per instance
- Static geometries (that never change) should always use factories