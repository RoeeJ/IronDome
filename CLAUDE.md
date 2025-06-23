# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
Iron Dome Simulator - A web-based defense system simulator built with Three.js for 3D visualization and realistic physics simulation. Currently in initial setup phase with React + Bun boilerplate.

## Development Commands
```bash
# Install dependencies
bun install

# Development server with HMR (port 3000)
bun dev

# Build for production
bun run build

# Production server
bun start
```

## Architecture & Key Decisions

### Current Stack
- **Runtime**: Bun with built-in TypeScript support
- **Frontend**: React 19 with TypeScript
- **Styling**: Tailwind CSS v4
- **Path Aliases**: `@/*` maps to `./src/*`

### Planned Architecture (per roadmap)
- **3D Engine**: Three.js for rendering
- **Physics**: Cannon-es (recommended) or Rapier
- **State**: Event-driven architecture with EventBus pattern
- **Components**: GameObject-based system with composable components

### Project Structure
```
src/
├── scene/          # Three.js scene management
├── physics/        # Physics calculations and world
├── threats/        # Threat spawning and management
├── interceptors/   # Iron Dome interception system
├── ui/            # React UI components
└── utils/         # Shared utilities
```

## Implementation Guidelines

### Performance Targets
- 60 FPS with 50+ simultaneous objects
- Maximum 100 active interceptors
- Object pooling for all projectiles
- LOD system for distant objects

### Physics Integration Pattern
```javascript
// Always sync physics to graphics after world step
world.step(1/60)
syncPhysicsToGraphics()
renderer.render(scene, camera)
```

### Critical Implementation Order
1. Basic Three.js scene with ground/sky
2. Physics world integration
3. Simple projectile with trajectory
4. Threat system with predictions
5. Interception mechanics
6. Visual effects and UI

## Testing Approach
- Manual testing checklist in `notes/implementation-priorities.md`
- Test trajectory calculations early
- Performance profiling at each milestone
- Mobile device testing required

## Roadmap References
- Main roadmap: `roadmap/iron-dome-simulator-roadmap.md`
- Technical details: `roadmap/technical-architecture.md`
- Milestones: `roadmap/milestones.md`
- Physics formulas: `notes/physics-calculations.md`

## Current Status
The simulator now has:
- ✅ Three.js scene with physics (Cannon-es)
- ✅ Threat spawning system with multiple types
- ✅ Trajectory visualization with trails
- ✅ Iron Dome battery model with auto-intercept
- ✅ Impact prediction markers
- ✅ Explosion effects on interception
- ✅ Battery coordination system
- ✅ Performance optimizations for large salvos
- ✅ Material caching to prevent shader compilation freezes
- ✅ Geometry deduplication system (GeometryFactory)
- ✅ Complete resource management for all renderers
- ✅ Improved tracking/interception algorithms (Kalman filtering, predictive targeting)
- ✅ Stats.js integration for performance monitoring (Ctrl+H to toggle)

## Performance Considerations

### Performance Limits
To maintain 60 FPS during intense scenarios:
- Maximum 50 active threats simultaneously
- Maximum 8 active interceptors in flight
- Maximum 20 active explosion effects
- Maximum 10-15 point lights active

### Resource Management Systems

#### Material Caching (MaterialCache)
The project uses a MaterialCache system to prevent shader compilation freezes:
- All batteries share common materials to avoid recompilation
- Shaders are precompiled during initialization
- This prevents 1000+ ms freezes when spawning multiple batteries
- Materials from MaterialCache should NEVER be disposed by individual objects

#### Geometry Deduplication (GeometryFactory)
The project uses a GeometryFactory system to eliminate duplicate geometries:
- Caches and reuses all common geometries (spheres, cones, cylinders, etc.)
- Supports CircleGeometry for crater decals
- Reduces memory usage by 10-20% in combat scenarios
- Geometries that need transformation should be cloned before modification

### Optimization Strategies
1. **Salvo Spawning**: Uses single RAF loop instead of multiple setTimeout calls
2. **Explosion Effects**: Limited particle counts and active effects
3. **Interception Evaluation**: Early exit for large threat counts
4. **Battery Coordination**: Simplified scoring calculations
5. **Resource Deduplication**: All renderers use shared geometries and materials
6. **Proper Disposal**: Only locally-created resources are disposed, never shared ones

## Next Steps
1. Add sound effects for launches and explosions
2. Add more realistic missile models
3. Create scenario system
4. Implement full object pooling for projectiles