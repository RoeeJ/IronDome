# Changelog

All notable changes to the Iron Dome Simulator project are documented here.

## [0.8.0] - 2025-01-26 (Current)

### Added
- 🎯 **Debug Logger System** - Replaced all console.log statements with configurable debug logger
- 📱 **Full Mobile Support** - Complete mobile UI with touch controls and haptic feedback
- 🏙️ **Procedural City Generation** - Hexagonal districts with buildings and street lights
- 🎮 **Sandbox Mode** - Developer controls (Ctrl+Shift+D) for testing
- 🌤️ **Weather System** - Wind particles and rain effects
- 🔊 **Sound System** - Complete 3D audio implementation (awaiting assets)
- 📊 **Enhanced Loading Screen** - Shows actual loading progress
- 🧬 **Deterministic Simulation Testing** - DST framework for physics validation

### Improved
- ⚡ **85% Draw Call Reduction** - Massive rendering optimization through instancing
- 🎯 **Volley System** - Prevents defense saturation with smart throttling
- 🔄 **Battery Coordination** - Improved multi-battery threat assignment
- 💾 **Resource Management** - Eliminated texture/geometry duplication
- 🌃 **Day/Night Cycle** - Smooth transitions with building window lighting

### Fixed
- 🐛 Battery resource initialization issues
- 🐛 Building window pool exhaustion errors
- 🐛 Shader compilation freezes
- 🐛 Dust ring cleanup memory leaks
- 🐛 Touch input detection on mobile

## [0.7.0] - 2025-01-23

### Major Features
- **Threat Variety** - Added mortars, drones, cruise missiles, Qassam variants
- **Shop System** - Purchase interceptors, upgrade batteries, unlock new domes
- **Game Progression** - Wave-based gameplay with credits and scoring
- **Inspector UI** - Real-time debugging and object inspection

### Optimizations
- **Geometry Deduplication** - Unified geometry factory system
- **Material Caching** - Shared materials across all objects
- **Performance Monitoring** - Built-in profiler with Stats.js

## [0.6.0] - 2025-01-20

### Core Systems
- **Interception Mechanics** - Kalman filtering and predictive targeting
- **Blast Physics** - Realistic fragmentation and damage modeling
- **Trajectory System** - Unified trajectory calculation with wind effects
- **Auto-Repair** - Batteries self-repair with upgrade levels

### Visual Enhancements
- **Explosion Effects** - Instanced explosions with smoke
- **Threat Trails** - Heat-based coloring and visual paths
- **Impact Markers** - Ground targeting indicators
- **Tactical Display** - 2D radar view with threat tracking

## [0.5.0] - 2025-01-17

### Foundation
- **Three.js Scene** - Basic 3D environment setup
- **Cannon-ES Physics** - Physics world integration
- **Iron Dome Battery** - Basic launcher with interceptors
- **Simple Threats** - Initial rocket implementation
- **Camera Controls** - Orbit and zoom functionality

## [Pre-Alpha] - 2025-01-10

### Initial Setup
- Project scaffolding with Bun and TypeScript
- React integration for UI
- Basic Three.js rendering pipeline
- Development environment configuration

---

## Version History Summary

| Version | Date | Completion | Major Focus |
|---------|------|------------|-------------|
| 0.8.0 | 2025-01-26 | ~80% | Mobile, City, Polish |
| 0.7.0 | 2025-01-23 | ~65% | Variety, Shop, Optimization |
| 0.6.0 | 2025-01-20 | ~50% | Core Mechanics |
| 0.5.0 | 2025-01-17 | ~30% | Foundation |
| Pre-Alpha | 2025-01-10 | ~10% | Setup |

## Upcoming in v1.0

- [ ] Audio assets integration
- [ ] Scenario campaigns
- [ ] Complete object pooling
- [ ] Weather gameplay effects
- [ ] Final polish and bug fixes

See [REMAINING_WORK.md](roadmap/REMAINING_WORK.md) for detailed roadmap.