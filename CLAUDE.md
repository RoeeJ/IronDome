# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
Iron Dome Simulator - A production-ready web-based defense system simulator built with Three.js for 3D visualization and realistic physics simulation. The project is **~80% complete** with full mobile support, procedural city generation, and sophisticated gameplay mechanics.

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

# Run with debug logging
# Add ?debug=true to URL or use debug logger
```

## Architecture & Key Decisions

### Current Stack
- **Runtime**: Bun with built-in TypeScript support
- **Frontend**: React 19 with TypeScript
- **3D Engine**: Three.js with Cannon-es physics
- **Styling**: Tailwind CSS v4
- **State Management**: Event-driven architecture with GameState singleton
- **Logging**: Custom debug logger with Seq integration
- **Mobile**: Full responsive UI with touch controls

### Implemented Architecture
- **3D Rendering**: Three.js with instanced rendering for performance
- **Physics**: Cannon-es with custom blast physics simulation
- **AI/Tracking**: Kalman filtering for trajectory prediction
- **Optimization**: Material/Geometry caching, object pooling (partial)
- **Game Modes**: Sandbox (unlimited resources) and Game (resource management)

### Project Structure
```
src/
├── camera/         # Camera controls and modes
├── entities/       # Game objects (threats, batteries, projectiles)
├── game/           # Game logic, state, scenarios
├── input/          # Input handling (keyboard, mouse, touch)
├── optimization/   # Performance optimization systems
├── physics/        # Physics calculations and blast effects
├── rendering/      # Instanced renderers and visual effects
├── scene/          # Scene management and coordination
├── systems/        # Core systems (sound, explosions, effects)
├── testing/        # Test utilities and genetic algorithms
├── ui/             # React UI components (mobile & desktop)
├── utils/          # Shared utilities and helpers
└── world/          # Environment (city, buildings, lighting)
```

## Current Features

### Core Gameplay
- ✅ **Multiple Threat Types**: Rockets, mortars, drones, ballistic missiles, cruise missiles
- ✅ **Iron Dome Batteries**: Upgradeable with 5 levels, auto-targeting, resource management
- ✅ **Advanced Physics**: Realistic trajectories, wind effects, blast physics with fragmentation
- ✅ **Interception System**: Kalman filtering, predictive targeting, proximity fuses
- ✅ **City Generation**: Procedural hexagonal districts with buildings and street lights
- ✅ **Game Modes**: Sandbox (dev/testing) and Game (progression) modes

### Mobile Support (FULLY IMPLEMENTED)
- ✅ **Responsive UI**: Automatic switching between desktop and mobile layouts
- ✅ **Touch Controls**: Tap to select, drag to pan, pinch to zoom
- ✅ **Mobile Optimization**: Reduced particles, optimized render scale, device detection
- ✅ **Haptic Feedback**: Vibration on impacts and interactions

### Visual & Audio
- ✅ **Day/Night Cycle**: Dynamic lighting with time-sliced updates
- ✅ **Weather System**: Visual effects (gameplay integration pending)
- ✅ **Explosion Effects**: Instanced rendering with smoke and debris
- ✅ **Threat Trails**: Visual trajectory paths with heat-based coloring
- ✅ **UI Polish**: Loading screen, tactical displays, threat indicators
- ⚠️ **Sound System**: Complete implementation awaiting audio assets

### Technical Features
- ✅ **Performance Monitoring**: Built-in profiler, Stats.js integration
- ✅ **Resource Management**: MaterialCache, GeometryFactory, texture atlasing
- ✅ **Debug Tools**: Inspector UI, developer controls (Ctrl+Shift+D)
- ✅ **Genetic Algorithm**: For optimizing interception parameters
- ✅ **Object Pooling**: Partial implementation for effects

## Performance Considerations

### Performance Limits
To maintain 60 FPS across devices:
- Maximum 50 active threats simultaneously
- Maximum 100 active interceptors
- Maximum 20 active explosion effects
- Maximum 10-15 active point lights
- Mobile: Reduced to 30 threats, 5 explosions

### Resource Management Systems

#### Material Caching (MaterialCache)
- Prevents shader compilation freezes
- All objects share materials where possible
- Materials from cache should NEVER be disposed individually

#### Geometry Deduplication (GeometryFactory)
- Eliminates duplicate geometries across the scene
- 10-20% memory savings in combat
- Always use factory for common shapes

#### Performance Optimizations
1. **Instanced Rendering**: Buildings, projectiles, effects use instancing
2. **LOD System**: Reduced detail for distant objects
3. **Culling**: Frustum and distance-based culling
4. **Time-Slicing**: Heavy operations spread across frames
5. **Mobile Scaling**: Dynamic quality based on device capabilities

## Keyboard Shortcuts
- **H**: Toggle performance stats
- **P**: Pause/unpause simulation
- **ESC**: Open pause menu
- **1-5**: Select battery for placement
- **Ctrl+Shift+D**: Developer tools
- **Ctrl+Shift+P**: Performance overlay
- **Ctrl+Shift+S**: Screenshot mode

## What's Left to Implement

### Priority 1: Audio Assets
- The SoundSystem is complete but needs ~20 sound files
- See `/assets/sounds/` for required files
- Categories: explosions, launches, impacts, UI, alarms

### Priority 2: Scenario Integration
- Wire up existing `AttackScenarios.ts` to gameplay
- Add scenario selection UI
- Implement proper victory/defeat conditions

### Priority 3: Complete Object Pooling
- Extend pooling to all projectiles
- Pool UI elements and text meshes
- Current implementation only covers particles

### Priority 4: Final Polish
- Weather effects on actual gameplay (wind affecting trajectories)
- Additional visual effects
- Performance edge case handling
- Cross-browser testing

## Development Guidelines

### When Adding Features
1. Check existing systems first (likely already implemented)
2. Use MaterialCache and GeometryFactory for all 3D objects
3. Implement mobile support from the start
4. Add debug logging using the logger system
5. Test on mobile devices early

### Performance First
- Profile before and after changes
- Use instanced rendering for repeated objects
- Implement LOD where appropriate
- Consider mobile constraints

### Code Organization
- Game logic goes in `/game`
- Visual effects in `/systems` or `/rendering`
- UI components in `/ui` with mobile variants
- Always update CLAUDE.md when adding major features

## Common Tasks

### Adding a New Threat Type
1. Add config to `THREAT_CONFIGS` in `Threat.ts`
2. Update `ThreatSpawnConfig` if needed
3. Add case to threat generation logic
4. Test with sandbox mode first

### Creating New Visual Effects
1. Check if similar effect exists in `/systems`
2. Use instanced rendering if multiple instances
3. Add to appropriate manager (ExplosionManager, etc.)
4. Profile performance impact

### Debugging Issues
1. Enable debug mode with `?debug=true`
2. Use Inspector UI for real-time inspection
3. Check developer console (Ctrl+Shift+D)
4. Use built-in profiler for performance

## Notes
- The project is much more complete than early documentation suggests
- Mobile support is fully implemented despite being listed as "todo"
- Most "planned" features are already implemented
- Focus on polish and content rather than new systems