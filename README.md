# Iron Dome Simulator

A realistic 3D simulation of the Iron Dome missile defense system built with Three.js, Cannon-ES physics, and TypeScript.

## Features

- **Realistic Physics Simulation**
  - Accurate ballistic trajectories with gravity
  - Proportional navigation guidance for interceptors
  - Proximity fuse detonations with fragmentation effects
  - Real-world inspired flight dynamics

- **Visual Effects**
  - Missile exhaust trails with particle systems
  - Launch smoke and ground effects
  - Explosion and debris physics
  - Dynamic lighting and shadows

- **Defense Systems**
  - 4 static radar stations with overlapping coverage
  - Iron Dome battery with 20 interceptor tubes
  - Multiple battery coordination system
  - Automatic threat detection and prioritization
  - Real-time interception calculations
  - Resource management in game mode

- **Interactive Controls**
  - Adjustable simulation parameters
  - Manual and automatic firing modes
  - Debug visualization options
  - Camera controls for different viewing angles

## Technologies Used

- **Three.js** - 3D graphics and rendering
- **Cannon-ES** - Physics simulation
- **TypeScript** - Type-safe development
- **Bun** - Fast JavaScript runtime and bundler
- **Vite** - Build tooling

## Installation

1. Install dependencies:
```bash
bun install
```

2. Start development server:
```bash
bun dev
```

3. Build for production:
```bash
bun run build
```

## Usage

### Game Modes

- **Sandbox Mode**: Unlimited resources, experiment freely with the simulation
- **Game Mode**: Manage resources, purchase interceptors, defend against waves

### Controls

- **Mouse** - Orbit camera around the scene
- **Scroll** - Zoom in/out
- **GUI Panel** - Adjust simulation parameters:
  - Spawn rate and threat types
  - Auto-intercept toggle
  - Battery success rate
  - Physics time scale
  - Debug visualizations

### Simulation Parameters

- **Threat Types**: Rockets, mortars, drones, cruise missiles
- **Interception Range**: 4km - 150km
- **Radar Coverage**: 300m radius per station
- **Interceptor Speed**: 150 m/s
- **Success Rate**: Configurable (default 95%)

## Project Structure

```
src/
├── entities/          # Game objects (Battery, Projectile, Threat)
├── scene/            # Scene management (Radar, Interception, Threats)
├── systems/          # Effect systems (Particles, Debris, Proximity)
├── utils/            # Physics calculations and utilities
├── ui/               # HUD and tactical displays
└── main.ts          # Application entry point
```

## Physics Model

The simulation uses realistic physics including:
- Ballistic trajectories with air resistance
- Proportional navigation guidance
- G-force limited turning
- Proximity fuse modeling
- Fragmentation patterns

## Development

### Debug Features

- Radar coverage visualization
- Trajectory prediction lines
- Launch position helpers
- Model orientation controls

### Performance Optimizations

- Material caching to prevent shader recompilation
- Efficient particle pooling with limits
- Spatial partitioning for collision detection
- LOD system for distant objects
- Optimized trail rendering
- Performance limits: 50 threats, 8 interceptors, 20 explosions max
- Batched salvo spawning to prevent frame drops

## License

This project is for educational and demonstration purposes only.

## Acknowledgments

- Three.js community for excellent documentation
- Cannon-ES for physics engine
- 3D models from public sources