# Iron Dome Simulator

A production-ready 3D defense system simulator featuring realistic physics, procedural city generation, and full mobile support. Built with Three.js, Cannon-ES physics, and TypeScript.

![Iron Dome Simulator](https://img.shields.io/badge/Status-80%25%20Complete-green)
![Platform](https://img.shields.io/badge/Platform-Web%20%7C%20Mobile-blue)
![License](https://img.shields.io/badge/License-Educational-orange)

## 🚀 Features

### Core Gameplay
- **🎯 Advanced Defense System**
  - Multiple Iron Dome batteries with 5 upgrade levels
  - Automatic threat detection and prioritization
  - Kalman filtering for trajectory prediction
  - Proximity fuse detonations with blast physics
  - Multi-battery coordination and resource sharing

- **💥 Diverse Threat Types**
  - Rockets (Qassam I/II/III, Grad)
  - Mortars with high-angle trajectories
  - Drones with evasive maneuvering
  - Ballistic missiles
  - Cruise missiles with terrain following

- **🏙️ Procedural City Generation**
  - Hexagonal district layout
  - Realistic building placement
  - Dynamic street lighting system
  - Performance-optimized rendering

### Game Modes
- **🎮 Game Mode**: Wave-based progression with resource management
  - Purchase and upgrade batteries
  - Manage interceptor stock
  - Earn credits from successful defenses
  - Shop system with strategic upgrades
  
- **🔧 Sandbox Mode**: Unlimited resources for experimentation
  - Test different configurations
  - Developer controls (Ctrl+Shift+D)
  - Real-time parameter adjustment

### Mobile Support
- **📱 Fully Responsive Design**
  - Automatic UI switching for mobile devices
  - Touch controls: tap, drag, pinch-to-zoom
  - Haptic feedback on interactions
  - Performance scaling based on device

### Visual & Audio
- **🌅 Dynamic Environment**
  - Day/night cycle with realistic lighting
  - Weather effects (rain, wind)
  - Explosion effects with smoke and debris
  - Threat trails with heat-based coloring
  
- **🔊 Sound System** *(Ready, awaiting assets)*
  - 3D positional audio
  - Multiple sound categories
  - Dynamic volume adjustment

### Technical Features
- **⚡ Performance Optimized**
  - Instanced rendering for buildings and projectiles
  - Material and geometry caching
  - LOD system for distant objects
  - 60 FPS on desktop, 30 FPS on mobile
  
- **🛠️ Developer Tools**
  - Built-in performance profiler
  - Inspector UI for real-time debugging
  - Stats.js integration (H key)
  - Debug logging system

## 🎮 Controls

### Desktop
- **Mouse**: Orbit camera
- **Scroll**: Zoom in/out
- **H**: Toggle performance stats
- **P**: Pause/unpause
- **ESC**: Pause menu
- **1-5**: Select battery level
- **Ctrl+Shift+D**: Developer tools
- **Ctrl+Shift+P**: Performance overlay
- **Ctrl+Shift+S**: Screenshot mode

### Mobile
- **Tap**: Select objects
- **Drag**: Pan camera
- **Pinch**: Zoom in/out
- **UI Buttons**: All controls accessible via touch

## 🚀 Getting Started

### Prerequisites
- Bun 1.2.16 (pinned in `.bun-version` and used by CI)
- Modern web browser with WebGL support

### Installation

```bash
bun install --frozen-lockfile
```

### Development

```bash
# Start development server
bun dev

# Build for production
bun run build

# Preview the built static site
bun run preview
```

### GitHub Pages

The project builds into a self-contained `dist/` directory, including the models,
textures, and sounds from `assets/`. No application server is required.

1. In the repository's **Settings → Pages → Build and deployment**, select
   **GitHub Actions** as the source.
2. Push these changes to `main`, or run **Deploy GitHub Pages** manually from the
   Actions tab after the workflow is on `main`.
3. The expected project URL is <https://roeej.github.io/IronDome/>. The deployment
   job reports the actual URL, including any configured custom domain.

The workflow installs the locked dependencies, builds and verifies the static site,
then deploys `dist/` using the
[official GitHub Pages actions](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
Pull requests run the build and asset checks without deploying. The existing Docker
workflow runs independently.

To reproduce the project URL locally:

```bash
BASE_PATH=/IronDome/ bun run build
bun run check:build
bun run preview
# Open http://localhost:3000/IronDome/
```

`BASE_PATH` must begin and end with `/`. It defaults to `/` for ordinary static
hosting. CI derives it from the Pages configuration, so custom domains also work.
The preview uses the base path saved by the build; set `PORT=3001` if needed.
Rebuild before previewing source changes.

The tools are available at `model-viewer/`, `tube-editor/`, and `rigger/` beneath
the site URL. Directory index pages support direct links and reloads.

GitHub Pages does not run the optional Seq logging proxy or the development server's
sample API routes. Remote logging is disabled by default. The build does not inline
environment variables; keep credentials out of browser configuration.

For the legacy test suite, preload its existing browser mock:

```bash
bun test --preload ./tests/setup.ts
```

Plain `bun test` currently has order-dependent browser-global failures, and the
repository has existing lint/typecheck errors. The Pages workflow checks the
production build and static assets independently of that cleanup.

### Debug Mode
Add `?debug=true` to the URL for enhanced logging and debugging features.

## 📁 Project Structure

```
src/
├── camera/         # Camera controls and modes
├── entities/       # Game objects (threats, batteries, projectiles)
├── game/           # Game logic, state management, scenarios
├── input/          # Input handling (keyboard, mouse, touch)
├── optimization/   # Performance optimization systems
├── physics/        # Physics calculations and blast effects
├── rendering/      # Instanced renderers and visual effects
├── scene/          # Scene management and coordination
├── systems/        # Core systems (sound, explosions, effects)
├── testing/        # Test utilities and optimization algorithms
├── ui/             # React components (mobile & desktop)
├── utils/          # Shared utilities and helpers
└── world/          # Environment (city, buildings, lighting)
```

## 🔬 Physics Model

The simulation uses realistic physics including:
- Ballistic trajectories with air resistance
- Proportional navigation guidance with G-force limits
- Wind effects on projectile paths
- Blast physics with fragmentation patterns
- Kalman filtering for trajectory prediction

## 🎯 Performance Targets

### Desktop
- 50+ simultaneous threats
- 100 active interceptors
- 20 explosion effects
- 60 FPS target

### Mobile
- 30 simultaneous threats
- 50 active interceptors
- 5 explosion effects
- 30 FPS target

## 🛠️ Advanced Features

### Optimization Systems
- **MaterialCache**: Prevents shader recompilation
- **GeometryFactory**: Eliminates duplicate geometries
- **Object Pooling**: Reuses particles and effects
- **Instanced Rendering**: Efficient rendering of multiple objects

### AI & Algorithms
- **Genetic Algorithm**: Optimizes interception parameters
- **Kalman Filtering**: Improves tracking accuracy
- **Threat Prioritization**: Smart target selection
- **Predictive Targeting**: Anticipates threat movements

## 📝 What's Left

1. **Audio Assets** (~20 sound effects needed)
2. **Scenario Integration** (wire up existing scenarios)
3. **Complete Object Pooling** (extend to all objects)
4. **Weather Gameplay** (wind affecting trajectories)
5. **Final Polish** (edge cases, cross-browser testing)

## 🤝 Contributing

This is an educational project demonstrating defense system concepts. Contributions should focus on:
- Performance improvements
- Mobile optimization
- Educational value
- Code quality

## 📜 License

This project is for educational and demonstration purposes only. It does not represent any real defense system.

## 🙏 Acknowledgments

- Three.js community for excellent 3D graphics support
- Cannon-ES for realistic physics simulation
- Bun for blazing fast development experience
- React for UI components
- All contributors and testers
