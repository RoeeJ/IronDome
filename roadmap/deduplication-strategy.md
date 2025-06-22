# Iron Dome Simulator - Deduplication Strategy

**Status: Phase 1 Complete ✅**  
*Last Updated: 2025-06-22*

## Overview
This document outlines the comprehensive deduplication strategy for the Iron Dome simulator, focusing on non-physics optimizations to improve performance, reduce memory usage, and enhance code maintainability.

## Current State Analysis

### Already Implemented
- **MaterialCache**: Basic material caching for standard materials
- **ParticleSystemPool**: Shared particle systems for exhaust trails
- **InstancedRenderer**: Base instanced rendering system
- **Instanced Threat/Projectile/Explosion Renderers**: Object pooling via instancing

### Identified Issues
1. **Geometry Duplication**: Same geometries created multiple times across the codebase
2. **Trail System Fragmentation**: Two separate trail implementations (line-based and particle-based)
3. **Material Cache Gaps**: Transparent and emissive materials not cached
4. **Explosion Logic Duplication**: Multiple explosion creation implementations
5. **Light Source Proliferation**: No pooling for dynamic lights
6. **UI Update Inefficiency**: Multiple independent update loops
7. **Animation Loop Duplication**: Separate RAF loops for similar animations
8. **Event Handler Sprawl**: No centralized event management

## Implementation Strategy

### Phase 1: Core Geometry & Materials ✅ **COMPLETE**

#### 1.1 GeometryFactory ✅
- **Purpose**: Centralize all geometry creation with caching
- **Impact**: 70-80% reduction in geometry memory usage
- **Implementation**: ✅ Complete
  - Singleton pattern with lazy initialization
  - Cache key based on geometry type and parameters
  - Automatic disposal management
  - Support for all THREE.js geometry types
- **Files Created**: `src/utils/GeometryFactory.ts`
- **Entities Migrated**: IronDomeBattery, Threat

#### 1.2 Extended MaterialCache ✅
- **Purpose**: Add support for transparent, emissive, and special materials
- **Impact**: Prevent shader recompilation for complex materials
- **Implementation**: ✅ Complete
  - Extended existing MaterialCache
  - Added methods for LineBasicMaterial, PointsMaterial
  - Added support for emissive and transparent materials
  - Material property hashing for cache keys
- **New Methods**: `getLineMaterial()`, `getPointsMaterial()`, `getMeshEmissiveMaterial()`, `getMeshTransparentMaterial()`

#### 1.3 Explosion Consolidation ✅
- **Purpose**: Route all explosions through centralized manager
- **Impact**: Reduce draw calls by 50% during combat
- **Implementation**: ✅ Complete
  - Created ExplosionManager for centralized explosion handling
  - Integrated with InstancedExplosionRenderer
  - Light pooling for explosion effects
  - Fixed air vs ground explosion visuals
- **Files Created**: `src/systems/ExplosionManager.ts`
- **Entities Migrated**: InterceptionSystem
  - Create ExplosionManager using InstancedExplosionRenderer
  - Unified explosion API with type parameters
  - Automatic cleanup and pooling

### Phase 2: Visual Systems (Performance Gains)

#### 2.1 Unified TrailSystem ✅ **COMPLETE**
- **Purpose**: Merge line-based and particle-based trail implementations
- **Impact**: 30% reduction in trail rendering overhead
- **Implementation**: ✅ Complete
  - Created UnifiedTrailSystem with TrailType enum
  - LineTrail and ParticleTrail implementations
  - Fixed trail rendering with proper world-space positioning
  - Doubled trail length for better visual effect
- **Files Created**: `src/systems/UnifiedTrailSystem.ts`
- **Entities Migrated**: Projectile (both interceptors and threats)
- **Visual Issues Fixed**: 
  - Removed attached line artifacts
  - Fixed trail dragging/pivoting issue
  - Proper FIFO buffer implementation

#### 2.2 LightPool ✅ **COMPLETE**
- **Purpose**: Manage dynamic lights with object pooling
- **Impact**: Maintain 60 FPS with 20+ simultaneous explosions
- **Implementation**: ✅ Complete
  - Created singleton LightPool system
  - Pre-allocated pool of PointLight objects
  - Priority-based light allocation (ground impacts > air explosions)
  - Automatic light recycling with timeout
  - Integrated with ExplosionManager
- **Files Created**: `src/systems/LightPool.ts`
- **Testing**: Added "Test 25 Explosions" button in Performance Testing GUI folder
- **Performance**: Successfully handles 25+ simultaneous explosions with light prioritization

### Phase 3: System Architecture (Code Quality)

#### 3.1 UIUpdateManager
- **Purpose**: Centralize UI update timing and batching
- **Impact**: Reduce UI-related CPU usage by 40%
- **Implementation**:
  - Register UI components with update frequencies
  - Batch updates by frequency tier
  - Automatic dirty-checking
  - Performance monitoring integration

#### 3.2 AnimationManager
- **Purpose**: Unify animation loops and timing
- **Impact**: Reduce code duplication and improve timing consistency
- **Implementation**:
  - Central animation loop with priority system
  - Animation registration and lifecycle management
  - Built-in easing functions
  - Performance-aware frame skipping

#### 3.3 EventManager
- **Purpose**: Centralized event handling with automatic cleanup
- **Impact**: Prevent memory leaks and improve maintainability
- **Implementation**:
  - Event registration with automatic disposal
  - Namespace support for event organization
  - Built-in throttling and debouncing
  - Debug mode for event tracking

## Performance Targets

### Memory Usage
- Geometry memory: -70% reduction
- Material memory: -50% reduction
- Overall memory: -40% reduction

### Frame Rate
- Maintain 60 FPS with:
  - 100+ active threats
  - 50+ active explosions
  - 20+ dynamic lights
  - All visual effects enabled

### Draw Calls
- Current: 200-300 during combat
- Target: 50-100 during combat
- Method: Aggressive instancing and batching

## Implementation Timeline

### Week 1: Core Systems ✅ **COMPLETE**
- [x] GeometryFactory implementation
- [x] MaterialCache extension
- [x] Explosion consolidation

### Week 2: Visual Systems ✅ **COMPLETE**
- [x] Unified TrailSystem
- [x] LightPool implementation

### Week 3: Architecture
- [ ] UIUpdateManager
- [ ] AnimationManager
- [ ] EventManager

### Week 4: Integration & Testing
- [ ] System integration
- [ ] Performance profiling
- [ ] Memory leak testing
- [ ] Documentation updates

## Success Metrics

1. **Performance**: 60 FPS maintained in all scenarios
2. **Memory**: 40% reduction in memory usage
3. **Draw Calls**: 50% reduction during combat
4. **Code Quality**: 30% reduction in rendering code
5. **Maintainability**: Single source of truth for each system

## Risk Mitigation

- **Compatibility**: Maintain backward compatibility during transition
- **Testing**: Comprehensive unit tests for each new system
- **Rollback**: Feature flags for gradual rollout
- **Performance**: Continuous profiling during development

## Future Considerations

- WebGPU migration preparation
- Multi-threaded rendering support
- Advanced LOD system integration
- Procedural geometry generation