// CHAINSAW: Removed seq-config overhead

import './index.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as CANNON from 'cannon-es';
import GUI from 'lil-gui';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Projectile } from './entities/Projectile';
import { Threat } from './entities/Threat';
import { ThreatManager } from './scene/ThreatManager';
import { UnifiedTrajectorySystem as TrajectoryCalculator } from './systems/UnifiedTrajectorySystem';
import { IronDomeBattery } from './entities/IronDomeBattery';
import { InterceptionSystem } from './scene/InterceptionSystem';
import { StaticRadarNetwork } from './scene/StaticRadarNetwork';
import { TacticalDisplay } from './ui/TacticalDisplay';
import { PerformanceMonitor } from './utils/PerformanceMonitor';
import { Profiler } from './utils/Profiler';
import { ProfilerDisplay } from './ui/ProfilerDisplay';
import { RenderProfiler } from './utils/RenderProfiler';
// CHAINSAW: Removed excess cache systems - keeping only MaterialCache
import { debug } from './utils/logger'; // Using Seq-enabled logger when configured
// CHAINSAW: Removed memory monitoring overhead
import { MobileInputManager } from './input/MobileInputManager';
import { DeviceCapabilities } from './utils/DeviceCapabilities';
import { ResponsiveUI } from './ui/ResponsiveUI';
import { GameState } from './game/GameState';
import { WaveManager } from './game/WaveManager';
import { ResourceManager } from './game/ResourceManager';
import { DomePlacementSystem } from './game/DomePlacementSystem';
import { GameUI } from './ui/GameUI';
// CHAINSAW: Removed instanced renderer imports
// CHAINSAW: Removed heavy stats monitoring systems
import { BlastPhysics } from './systems/BlastPhysics';
// CHAINSAW: Removed heavy explosion and trail systems
// CHAINSAW: Removed geometry factory overhead
import { MaterialCache } from './utils/MaterialCache';
import { SoundSystem } from './systems/SoundSystem';
import { Inspector } from './ui/Inspector';
import { SandboxControls } from './ui/sandbox/SandboxControls';
import { DeveloperControls } from './ui/sandbox/DeveloperControls';
import { ProjectileInstanceManager } from './rendering/ProjectileInstanceManager';
import { PooledTrailSystem } from './rendering/PooledTrailSystem';

// Essential systems only
import { CameraController, CameraMode } from './camera/CameraController';
import { EnvironmentSystem } from './world/EnvironmentSystem';
import { WorldScaleIndicators } from './world/WorldScaleIndicators';
// CHAINSAW OPTIMIZED: Time-sliced systems for visual polish without performance cost
import { OptimizedDayNightCycle } from './world/OptimizedDayNightCycle';
import { BuildingSystem } from './world/BuildingSystem';

// Initialize device capabilities
const deviceCaps = DeviceCapabilities.getInstance();
const deviceInfo = deviceCaps.getDeviceInfo();
const perfProfile = deviceCaps.getPerformanceProfile();

debug.log('Device detected:', {
  type: deviceInfo.isMobile ? 'Mobile' : deviceInfo.isTablet ? 'Tablet' : 'Desktop',
  gpu: deviceInfo.gpu,
  targetFPS: perfProfile.targetFPS,
});

// Update loading status
updateLoadingStatus('Setting up 3D scene...');

// Scene setup
const scene = new THREE.Scene();

// CHAINSAW: Simple solid color background instead of gradient texture
scene.background = new THREE.Color(0x1a3560); // Darker blue for better contrast

// Camera setup
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  200000 // Greatly extended far plane for ballistic missile tracking
);
camera.position.set(150, 80, 150); // Moved camera further back for better overview
camera.lookAt(0, 0, 0);

// Attach Three.js audio listener to camera
const audioSystem = SoundSystem.getInstance();
camera.add(audioSystem.getListener());

// Store camera and scene globally for context menu
(window as any).__camera = camera;
(window as any).__scene = scene;

// Renderer setup with device-specific settings
const renderer = new THREE.WebGLRenderer({
  antialias: !deviceInfo.isMobile, // Disable antialiasing on mobile
  powerPreference: deviceInfo.isMobile ? 'low-power' : 'high-performance',
});

// Apply render scale for performance
const renderScale = deviceCaps.getRenderScale();
renderer.setSize(window.innerWidth * renderScale, window.innerHeight * renderScale);
renderer.domElement.style.width = window.innerWidth + 'px';
renderer.domElement.style.height = window.innerHeight + 'px';

// Adjust pixel ratio for mobile
const maxPixelRatio = deviceInfo.isMobile ? 2 : window.devicePixelRatio;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));

// Ensure renderer doesn't block UI events
renderer.domElement.style.position = 'absolute';
renderer.domElement.style.top = '0';
renderer.domElement.style.left = '0';
renderer.domElement.style.zIndex = '1'; // Ensure it's below UI elements
// Don't set touchAction here - let OrbitControls handle it

// Shadow settings based on device
renderer.shadowMap.enabled = deviceCaps.shouldEnableShadows();
if (renderer.shadowMap.enabled) {
  renderer.shadowMap.type =
    perfProfile.shadowQuality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
}

document.body.appendChild(renderer.domElement);

// Precompile common materials to prevent shader compilation freezes
const materialCache = MaterialCache.getInstance();
// PERFORMANCE: Defer material precompilation to avoid blocking initial render
// Will precompile after loading screen is hidden

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 10;
controls.maxDistance = 100000; // Greatly increased for ballistic missile tracking
controls.maxPolarAngle = Math.PI / 2 - 0.1; // Prevent going below ground

// Enable touch controls for mobile
controls.touches = {
  ONE: THREE.TOUCH.ROTATE,
  TWO: THREE.TOUCH.DOLLY_PAN,
};
controls.enablePan = true;
controls.enableZoom = true;
controls.enableRotate = true;

// Store controls globally for UI to disable when needed
(window as any).__controls = controls;

// Initialize camera controller
const cameraController = new CameraController(camera, controls);
(window as any).__cameraController = cameraController;

// Ensure controls are enabled
controls.enabled = true;

// Lighting - reduced intensity for better contrast
const ambientLight = new THREE.AmbientLight(0xffffff, 0.35); // Reduced from 0.6
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.65); // Reduced from 0.8
// Position light further away to cover more area
directionalLight.position.set(200, 400, 200);
directionalLight.castShadow = true;
// Expand shadow camera to cover the entire city area
directionalLight.shadow.camera.left = -800;
directionalLight.shadow.camera.right = 800;
directionalLight.shadow.camera.top = 800;
directionalLight.shadow.camera.bottom = -800;
directionalLight.shadow.camera.near = 0.1;
directionalLight.shadow.camera.far = 1000;

// Adjust shadow map size based on device
const shadowMapSize = deviceInfo.isMobile
  ? 1024
  : perfProfile.shadowQuality === 'high'
    ? 2048
    : 1536;
directionalLight.shadow.mapSize.width = shadowMapSize;
directionalLight.shadow.mapSize.height = shadowMapSize;

scene.add(directionalLight);

// Ground - removed in favor of terrain from EnvironmentSystem
// The terrain mesh now serves as the ground with proper city area

// Grid helper - removed in favor of WorldScaleIndicators
// const gridHelper = new THREE.GridHelper(400, 40, 0x000000, 0x000000)
// gridHelper.material.opacity = 0.2
// gridHelper.material.transparent = true
// scene.add(gridHelper)

// Axes helper (for debugging) - commented out for production
// const axesHelper = new THREE.AxesHelper(10)
// scene.add(axesHelper)

// Physics world
const world = new CANNON.World({
  gravity: new CANNON.Vec3(0, -9.82, 0),
});
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = true;

// Ground physics body - larger to match visual ground
const groundShape = new CANNON.Box(new CANNON.Vec3(2000, 0.1, 2000)); // Doubled to match visual ground
const groundBody = new CANNON.Body({
  type: CANNON.Body.STATIC,
  shape: groundShape,
  position: new CANNON.Vec3(0, -0.1, 0),
});
world.addBody(groundBody);

// Initialize game systems
const gameState = GameState.getInstance();
const resourceManager = ResourceManager.getInstance();

// Make resource manager globally available for UI
(window as any).__resourceManager = resourceManager;

// Update loading status
updateLoadingStatus('Creating environment...');

// Initialize world systems - STATIC ONLY (no dynamic updates)
const environmentSystem = new EnvironmentSystem(scene);
environmentSystem.initialize({
  fogEnabled: true,
  skyboxEnabled: false, // Re-enabled skybox for day/night cycle
  terrainEnabled: true,
  cloudsEnabled: false,
  atmosphericScattering: false, // CHAINSAW: Disabled expensive atmosphere
});

const worldScaleIndicators = new WorldScaleIndicators(scene, {
  showGrid: true,
  showDistanceMarkers: false,
  showReferenceObjects: false, // Disable reference buildings initially
  showWindParticles: false, // CHAINSAW: Disabled wind particles
  showAltitudeMarkers: false,
  gridSize: 2000,
  gridDivisions: 100,
});
worldScaleIndicators.initialize();
worldScaleIndicators.optimizeGeometry();

// CHAINSAW OPTIMIZED: Initialize time-sliced polish systems
const optimizedDayNight = new OptimizedDayNightCycle(scene, ambientLight, directionalLight);
optimizedDayNight.setEnvironmentSystem(environmentSystem); // Connect for skybox updates
optimizedDayNight.setTime(14); // Start at 2 PM

// PERFORMANCE: Defer city generation until after loading screen
const buildingSystem = new BuildingSystem(scene);
// Don't generate city yet - will do it after loading screen is hidden

// Make globally accessible for SandboxControls and explosion damage
(window as any).__optimizedDayNight = optimizedDayNight;
(window as any).__buildingSystem = buildingSystem;
(window as any).__environmentSystem = environmentSystem;

// Create invisible ground plane for raycasting
const groundGeometry = new THREE.PlaneGeometry(8000, 8000); // Expanded to match terrain
const groundMaterial = MaterialCache.getInstance().getMeshBasicMaterial({
  visible: false,
  side: THREE.DoubleSide,
});
const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
groundMesh.rotation.x = -Math.PI / 2;
groundMesh.position.y = 0;
scene.add(groundMesh);

// PERFORMANCE: Initialize projectile instance manager lazily
let projectileInstanceManager: ProjectileInstanceManager | null = null;

// Threat Manager with extended bounds
const threatManager = new ThreatManager(scene, world);
// Set extended spawn bounds for threats
(threatManager as any).spawnBounds = {
  minX: -2000,
  maxX: 2000,
  minZ: -2000,
  maxZ: 2000,
  minY: 50,
  maxY: 400,
};
// Make threat manager globally available for explosion system
(window as any).__threatManager = threatManager;

// Invisible Radar System - provides detection without visual towers
import { InvisibleRadarSystem } from './scene/InvisibleRadarSystem';
const radarNetwork = new InvisibleRadarSystem(1500); // Extended detection radius for larger area

// Dome Placement System
const domePlacementSystem = new DomePlacementSystem(scene, world);
domePlacementSystem.setThreatManager(threatManager);
// Make globally available for explosion system
(window as any).__domePlacementSystem = domePlacementSystem;

// Interception System
const interceptionSystem = new InterceptionSystem(scene, world);
interceptionSystem.setThreatManager(threatManager);

// Export interception system for global access
(window as any).__interceptionSystem = interceptionSystem;

// CHAINSAW: Set up instanced debris renderer for performance
import { InstancedDebrisRenderer } from './rendering/InstancedDebrisRenderer';
const instancedDebrisRenderer = new InstancedDebrisRenderer(scene, 1000); // Support up to 1000 debris pieces
(window as any).__instancedDebrisRenderer = instancedDebrisRenderer;

// Connect all systems
domePlacementSystem.setInterceptionSystem(interceptionSystem);
if (radarNetwork) domePlacementSystem.setRadarNetwork(radarNetwork);

// PERFORMANCE: Defer battery configuration until after loading

// Wave Manager
const waveManager = new WaveManager(threatManager);

// Tactical Display
const tacticalDisplay = new TacticalDisplay();

// Initial render of tactical display with default values
tacticalDisplay.update([], new THREE.Vector3(0, 0, 0), 20, 0.95, 20);

// Projectile management
let projectiles: Projectile[] = [];

// CHAINSAW: Removed all instanced renderers - using standard Three.js meshes only
const useInstancedRendering = false;
const useLODRendering = false;

// Load saved preferences from localStorage
const savedGameMode = localStorage.getItem('ironDome_gameMode');
const savedProfilerVisible = localStorage.getItem('ironDome_profilerVisible');
const savedInterceptMode = localStorage.getItem('ironDome_interceptMode');

// Pause state
let isPaused = false;
let pauseMenuOpen = false;

// Simulation controls (must be defined before UI)
const simulationControls = {
  gameMode: savedGameMode !== null ? savedGameMode === 'true' : false, // Default to false (sandbox mode) if not saved
  autoIntercept: savedInterceptMode !== null ? savedInterceptMode === 'true' : true, // Default to auto-intercept for larger terrain
  pause: false,
  timeScale: 1.0,
  showTrajectories: true,
  enableFog: false,
  interceptorModel: 'ultra', // 'none', 'ultra', 'simple'
  useImprovedAlgorithms: true, // New flag for improved tracking/interception
  startGame: () => {
    // Clear any existing projectiles
    projectiles.forEach(p => p.destroy(scene, world));
    projectiles = [];
    // Start the wave manager
    waveManager.startGame();
  },
  resetGame: () => {
    gameState.startNewGame();
    threatManager.clearAll();
    projectiles.forEach(p => p.destroy(scene, world));
    projectiles = [];
    // Recreate initial setup
    location.reload(); // Simple reload for now
  },
};

// Expose simulationControls globally for UI components
(window as any).__simulationControls = simulationControls;

// Update loading status
updateLoadingStatus('Setting up user interface...');

// Create React UI
const uiContainer = document.createElement('div');
uiContainer.id = 'game-ui-root';
document.body.appendChild(uiContainer);

const uiRoot = createRoot(uiContainer);

// Import RenderStats component
import { RenderStats } from './ui/RenderStats';
import { MobileGameUI } from './ui/MobileGameUI';
import { PauseMenu } from './ui/PauseMenu';

// Create container for render stats
const renderStatsContainer = document.createElement('div');
document.body.appendChild(renderStatsContainer);
const renderStatsRoot = createRoot(renderStatsContainer);

// Render stats visibility
let showRenderStats = localStorage.getItem('ironDome_showRenderStats') === 'true';

// Function to toggle render stats
(window as any).toggleRenderStats = () => {
  showRenderStats = !showRenderStats;
  localStorage.setItem('ironDome_showRenderStats', showRenderStats.toString());
  renderStatsRoot.render(React.createElement(RenderStats, { renderer, visible: showRenderStats }));
};

// Initial render of stats
renderStatsRoot.render(React.createElement(RenderStats, { renderer, visible: showRenderStats }));

// Function to render UI with pause menu
const renderUI = () => {
  // Use mobile UI for mobile devices
  const UIComponent = deviceInfo.isMobile || deviceInfo.isTablet ? MobileGameUI : GameUI;

  uiRoot.render(
    React.createElement(
      React.Fragment,
      null,
      !pauseMenuOpen &&
        React.createElement(UIComponent, {
          waveManager: waveManager,
          placementSystem: domePlacementSystem,
          isGameMode: simulationControls.gameMode,
          onModeChange: (gameMode: boolean) => {
            simulationControls.gameMode = gameMode;
            // Save to localStorage
            localStorage.setItem('ironDome_gameMode', gameMode.toString());

            // Clear all existing threats and projectiles
            threatManager.clearAll();
            projectiles.forEach(p => p.destroy(scene, world));
            projectiles = [];

            // Reset game state
            if (gameMode) {
              // Switching to game mode - start fresh
              gameState.startNewGame();

              // Remove all batteries
              const allBatteries = domePlacementSystem.getAllBatteries();
              const batteryIds: string[] = [];
              allBatteries.forEach(battery => {
                const batteryId = domePlacementSystem.getBatteryId(battery);
                if (batteryId) batteryIds.push(batteryId);
              });

              // Remove all batteries
              batteryIds.forEach(id => domePlacementSystem.removeBattery(id));

              // Ensure we have the initial battery
              if (domePlacementSystem.getAllBatteries().length === 0) {
                // Force create initial battery
                const initialId = 'battery_initial';
                domePlacementSystem.placeBatteryAt(new THREE.Vector3(0, 0, 0), initialId, 1);
                gameState.addDomePlacement(initialId, { x: 0, z: 0 });
              }
            } else {
              // Switching to sandbox mode - ensure at least one battery
              const allBatteries = domePlacementSystem.getAllBatteries();

              // If no batteries exist, create one
              if (allBatteries.length === 0) {
                const initialId = 'battery_initial';
                domePlacementSystem.placeBatteryAt(new THREE.Vector3(0, 0, 0), initialId, 1);
                gameState.addDomePlacement(initialId, { x: 0, z: 0 });
              }
            }

            // Update placement system mode
            domePlacementSystem.setSandboxMode(!gameMode);

            if (gameMode) {
              // Switch to game mode
              threatManager.stopSpawning();
              threatManager.clearAll(); // Clear any existing threats
              gui.hide(); // Hide debug controls in game mode

              // Reset game state
              const gameState = GameState.getInstance();
              gameState.startNewGame();

              // Reset to manual mode for game mode
              simulationControls.autoIntercept = false;
              localStorage.setItem('ironDome_interceptMode', 'false');

              // Resources are managed by GameState, no need for separate reset

              // Don't auto-start, wait for user to click start
            } else {
              // Switch to sandbox mode
              waveManager.pauseWave();
              threatManager.clearAll(); // Clear any existing threats
              threatManager.setThreatMix('mixed');
              threatManager.startSpawning();
              gui.show(); // Show debug controls in sandbox mode

              // Enable auto-intercept by default in sandbox mode
              simulationControls.autoIntercept = true;
              localStorage.setItem('ironDome_interceptMode', 'true');
            }
            renderUI(); // Re-render UI
          },
        }),
      pauseMenuOpen &&
        React.createElement(PauseMenu, {
          isOpen: pauseMenuOpen,
          onClose: () => {
            pauseMenuOpen = false;
            isPaused = false;
            simulationControls.pause = false;
            if (simulationControls.gameMode) {
              if (waveManager) waveManager.resumeWave();
            } else {
              // Resume threat spawning in sandbox mode
              threatManager.startSpawning();
            }
            // Re-enable controls
            controls.enabled = true;
            // Show GUI if appropriate
            if (!simulationControls.gameMode && !deviceInfo.isMobile && !deviceInfo.isTablet) {
              gui.domElement.style.display = 'block';
            }
            // Show tactical display
            const tacticalContainer = tacticalDisplay.getContainer();
            if (tacticalContainer) {
              tacticalContainer.style.display = 'block';
            }
            renderUI();
          },
        })
    )
  );
};

// Alias for backward compatibility
const updateUIMode = renderUI;

// Set initial sandbox mode based on saved preference
domePlacementSystem.setSandboxMode(!simulationControls.gameMode);

// Reset game state if in game mode (ensures fresh start on refresh)
if (simulationControls.gameMode) {
  const gameState = GameState.getInstance();
  gameState.startNewGame();
  threatManager.clearAll();
}

// Initial render
updateUIMode();

// GUI
const gui = new GUI();
// Position GUI to avoid overlapping with help button
gui.domElement.style.top = '70px';
// Start minimized on mobile
if (deviceInfo.isMobile) {
  gui.close();
}
// Hide GUI in game mode by default
if (simulationControls.gameMode) {
  gui.hide();
}

// Make GUI globally accessible for mobile UI
(window as any).__gui = gui;

// Apply responsive UI only for desktop - mobile uses MobileGameUI
let responsiveUI: ResponsiveUI | null = null;
if (!deviceInfo.isMobile && !deviceInfo.isTablet) {
  responsiveUI = new ResponsiveUI(gui);
} else {
  // Style GUI for mobile - smaller and on the left
  gui.domElement.style.display = 'none';
  gui.domElement.style.position = 'fixed';
  gui.domElement.style.left = '10px';
  gui.domElement.style.top = '60px';
  gui.domElement.style.transform = 'scale(0.8)';
  gui.domElement.style.transformOrigin = 'top left';
  gui.domElement.style.maxHeight = '60vh';
  gui.domElement.style.overflowY = 'auto';
  gui.domElement.style.zIndex = '1500';
  gui.domElement.style.fontSize = '12px';

  // Add custom styles for mobile
  const style = document.createElement('style');
  style.textContent = `
    @media (max-width: 768px) {
      .lil-gui {
        --width: 200px !important;
        --widget-height: 24px !important;
        --spacing: 4px !important;
        --padding: 4px !important;
        --folder-indent: 12px !important;
      }
      .lil-gui .title {
        font-size: 11px !important;
      }
      .lil-gui .controller {
        font-size: 11px !important;
      }
    }
  `;
  document.head.appendChild(style);
}

// Create manual targeting system
const manualTargetingSystem = {
  selectedThreat: null as Threat | null,
  priorityTargets: new Set<string>(),

  selectThreat(threat: Threat | null) {
    this.selectedThreat = threat;
    // Update visual indicator
    threatManager.getActiveThreats().forEach(t => {
      if (t.mesh) {
        // Handle both Mesh and Group objects
        const meshes: THREE.Mesh[] = [];
        if (t.mesh instanceof THREE.Mesh) {
          meshes.push(t.mesh);
        } else if (t.mesh instanceof THREE.Group) {
          t.mesh.traverse(child => {
            if (child instanceof THREE.Mesh) {
              meshes.push(child);
            }
          });
        }

        meshes.forEach(mesh => {
          const material = mesh.material as THREE.MeshStandardMaterial;
          if (material && material.emissive !== undefined) {
            if (t === threat) {
              material.emissive = new THREE.Color(0xffff00); // Yellow highlight
              material.emissiveIntensity = 0.5;
            } else if (this.priorityTargets.has(t.id)) {
              material.emissive = new THREE.Color(0xff00ff); // Purple for priority
              material.emissiveIntensity = 0.3;
            } else {
              material.emissive = material.color || new THREE.Color(0x000000);
              material.emissiveIntensity = 0.2;
            }
          }
        });
      }
    });
  },

  togglePriority(threat: Threat) {
    if (this.priorityTargets.has(threat.id)) {
      this.priorityTargets.delete(threat.id);
    } else {
      this.priorityTargets.add(threat.id);
    }
    this.selectThreat(threat); // Update visuals
  },

  clearSelection() {
    this.selectedThreat = null;
    this.selectThreat(null);
  },
};

// Make it globally available
(window as any).__manualTargeting = manualTargetingSystem;

// Handle dome placement and threat selection
renderer.domElement.addEventListener('click', event => {
  const mouse = new THREE.Vector2(
    (event.clientX / window.innerWidth) * 2 - 1,
    -(event.clientY / window.innerHeight) * 2 + 1
  );

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, camera);

  // Check if we're in dome placement mode
  if (domePlacementSystem.isInPlacementMode()) {
    const intersects = raycaster.intersectObject(groundMesh);
    if (intersects.length > 0) {
      domePlacementSystem.attemptPlacement(intersects[0].point);
    }
    return;
  }

  // Check for threat clicks (in game mode with manual targeting, or sandbox mode)
  if (
    (simulationControls.gameMode && !simulationControls.autoIntercept) ||
    !simulationControls.gameMode
  ) {
    // Set crosshair cursor
    renderer.domElement.style.cursor = 'crosshair';

    // Instead of raycasting to meshes, check distance to threats in screen space
    const threats = threatManager.getActiveThreats();
    let closestThreat: Threat | null = null;
    let minDistance = 50; // Maximum pixel distance for selection (generous hit area)

    threats.forEach(threat => {
      // Project threat position to screen space
      const threatPos = threat.getPosition().clone();
      threatPos.project(camera);

      // Convert to screen coordinates
      const screenX = ((threatPos.x + 1) * window.innerWidth) / 2;
      const screenY = ((-threatPos.y + 1) * window.innerHeight) / 2;

      // Calculate distance from click
      const distance = Math.sqrt(
        Math.pow(event.clientX - screenX, 2) + Math.pow(event.clientY - screenY, 2)
      );

      // Check if within hit area and closest
      if (distance < minDistance && threatPos.z < 1) {
        // z < 1 ensures it's in front of camera
        minDistance = distance;
        closestThreat = threat;
      }
    });

    if (closestThreat) {
      const threat: Threat = closestThreat;

      if (event.shiftKey) {
        // Shift+click to toggle priority
        manualTargetingSystem.togglePriority(threat);
      } else {
        // Regular click to select
        manualTargetingSystem.selectThreat(threat);

        // Fire interceptor at selected threat
        // For manual control, find ANY operational battery (not just nearest that can intercept)
        const batteries = interceptionSystem.getBatteries();
        let interceptorFired = false;

        // Try each battery until one can fire
        for (const battery of batteries) {
          if (battery.isOperational()) {
            // Check if this is an Iron Dome battery (has fireInterceptorManual method)
            if ('fireInterceptorManual' in battery && typeof battery.fireInterceptorManual === 'function') {
              const interceptor = battery.fireInterceptorManual(threat);
              if (interceptor) {
                // Set up detonation callback for manual interceptor
                interceptor.detonationCallback = (position: THREE.Vector3, quality: number) => {
                // Create explosion effect
                interceptionSystem.createExplosion(position, Math.max(0.8, quality));

                // Use physics-based blast damage
                if (threat.isActive) {
                  const wasMarked = threat.markAsBeingIntercepted();

                  // Use BlastPhysics for damage calculation
                  const damage = BlastPhysics.calculateDamage(
                    position,
                    threat.getPosition(),
                    threat.getVelocity()
                  );

                  debug.category(
                    'Combat',
                    `Manual intercept blast: ${damage.damageType} damage, ${(damage.killProbability * 100).toFixed(0)}% kill probability`
                  );

                  if (wasMarked && damage.hit) {
                    // Use threatManager to properly destroy and count the threat
                    threatManager.markThreatIntercepted(threat);

                    // Remove threat from active threats array
                    const threatIndex = threats.indexOf(threat);
                    if (threatIndex !== -1) {
                      threats.splice(threatIndex, 1);
                    }

                    // Update game stats
                    gameState.recordInterception();
                    gameState.recordThreatDestroyed();

                    // Update interception system stats
                    (interceptionSystem as any).successfulInterceptions =
                      ((interceptionSystem as any).successfulInterceptions || 0) + 1;
                  } else if (wasMarked && !damage.hit) {
                    // Failed to destroy - unmark so other interceptors can try
                    threat.unmarkAsBeingIntercepted();
                    debug.category('Combat', 'Manual intercept failed - unmarking threat');
                    gameState.recordMiss();
                  }
                }

                // Always destroy the interceptor
                interceptor.destroy(scene, world);

                // Remove interceptor from arrays
                const interceptorIndex = projectiles.indexOf(interceptor);
                if (interceptorIndex !== -1) {
                  projectiles.splice(interceptorIndex, 1);
                }
                const sysIndex = (interceptionSystem as any).interceptors.indexOf(interceptor);
                if (sysIndex !== -1) {
                  (interceptionSystem as any).interceptors.splice(sysIndex, 1);
                }
              };

              projectiles.push(interceptor);
              // Track manual interceptor in interception system
              (interceptionSystem as any).interceptors.push(interceptor);
              (interceptionSystem as any).totalInterceptorsFired =
                ((interceptionSystem as any).totalInterceptorsFired || 0) + 1;
              debug.category('Combat', 'Manual intercept fired!');
              interceptorFired = true;
              break;
            }
            } else if (battery.constructor.name === 'LaserBattery') {
              // Laser batteries use fireAt method for manual targeting
              battery.fireAt(threat);
              debug.category('Combat', 'Manual laser targeting activated!');
              interceptorFired = true;
              break;
            }
          }
        }

        if (!interceptorFired) {
          // No battery could fire
          if (batteries.filter(b => b.isOperational()).length === 0) {
            if ((window as any).showNotification) {
              (window as any).showNotification('No operational batteries!');
            }
          } else {
            if ((window as any).showNotification) {
              (window as any).showNotification('No interceptors ready!');
            }
          }
        }
      }
    } else {
      // Clicked empty space - clear selection
      manualTargetingSystem.clearSelection();
    }
  }
});

// Mouse move for desktop
renderer.domElement.addEventListener('mousemove', event => {
  const mouse = new THREE.Vector2(
    (event.clientX / window.innerWidth) * 2 - 1,
    -(event.clientY / window.innerHeight) * 2 + 1
  );

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, camera);

  if (domePlacementSystem.isInPlacementMode()) {
    const intersects = raycaster.intersectObject(groundMesh);
    if (intersects.length > 0) {
      domePlacementSystem.updatePlacementPreview(intersects[0].point);
    }
  } else if (simulationControls.gameMode && !simulationControls.autoIntercept) {
    // Check if hovering over a threat using screen space distance
    const threats = threatManager.getActiveThreats();
    let isHoveringThreat = false;

    threats.forEach(threat => {
      // Project threat position to screen space
      const threatPos = threat.getPosition().clone();
      threatPos.project(camera);

      // Convert to screen coordinates
      const screenX = ((threatPos.x + 1) * window.innerWidth) / 2;
      const screenY = ((-threatPos.y + 1) * window.innerHeight) / 2;

      // Calculate distance from mouse
      const distance = Math.sqrt(
        Math.pow(event.clientX - screenX, 2) + Math.pow(event.clientY - screenY, 2)
      );

      // Check if within hover area
      if (distance < 50 && threatPos.z < 1) {
        // Same generous hit area
        isHoveringThreat = true;
      }
    });

    renderer.domElement.style.cursor = isHoveringThreat ? 'pointer' : 'crosshair';
  }
});

// Touch move for mobile dome placement preview
renderer.domElement.addEventListener(
  'touchmove',
  event => {
    if (domePlacementSystem.isInPlacementMode() && event.touches.length === 1) {
      event.preventDefault();
      const touch = event.touches[0];
      const mouse = new THREE.Vector2(
        (touch.clientX / window.innerWidth) * 2 - 1,
        -(touch.clientY / window.innerHeight) * 2 + 1
      );

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, camera);

      const intersects = raycaster.intersectObject(groundMesh);
      if (intersects.length > 0) {
        domePlacementSystem.updatePlacementPreview(intersects[0].point);
      }
    }
  },
  { passive: false }
);

// Touch end for mobile tap actions
let touchStartTime = 0;
let touchStartPos = { x: 0, y: 0 };

// Debug touch events
renderer.domElement.addEventListener(
  'touchstart',
  event => {
    debug.category('Input', 'Touch start:', event.touches.length, 'touches');
    if (event.touches.length === 1) {
      touchStartTime = Date.now();
      touchStartPos = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    }
  },
  { passive: true }
);

renderer.domElement.addEventListener(
  'touchend',
  event => {
    // Check if it was a tap (not a drag)
    if (event.changedTouches.length === 1) {
      const touchDuration = Date.now() - touchStartTime;
      const touch = event.changedTouches[0];
      const touchDistance = Math.sqrt(
        Math.pow(touch.clientX - touchStartPos.x, 2) + Math.pow(touch.clientY - touchStartPos.y, 2)
      );

      // Consider it a tap if short duration and small movement
      if (touchDuration < 300 && touchDistance < 10) {
        const mouse = new THREE.Vector2(
          (touch.clientX / window.innerWidth) * 2 - 1,
          -(touch.clientY / window.innerHeight) * 2 + 1
        );

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, camera);

        // Check if in dome placement mode
        if (domePlacementSystem.isInPlacementMode()) {
          const intersects = raycaster.intersectObject(groundMesh);
          if (intersects.length > 0) {
            domePlacementSystem.attemptPlacement(intersects[0].point);
            if ('vibrate' in navigator) navigator.vibrate(20);
          }
        }
      }
    }
  },
  { passive: true }
);

// Initialize mobile input if on touch device
let mobileInput: MobileInputManager | null = null;
// Temporarily disable MobileInputManager to fix touch controls
// if (false && deviceInfo.hasTouch) {
if (deviceInfo.hasTouch) {
  mobileInput = new MobileInputManager(camera, controls, renderer.domElement);

  // Set up tap for dome placement or interceptor launch
  mobileInput?.onTap(position => {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(position, camera);

    // Check if in dome placement mode first
    if (domePlacementSystem.isInPlacementMode()) {
      const groundIntersects = raycaster.intersectObject(groundMesh);
      if (groundIntersects.length > 0) {
        domePlacementSystem.attemptPlacement(groundIntersects[0].point);
        // Haptic feedback for placement
        if (mobileInput) mobileInput.vibrate(30);
      }
      return;
    }

    // Otherwise check for threats to intercept
    const threats = threatManager.getActiveThreats();
    let targetThreat: any = null;

    // Check for direct threat intersection
    threats.forEach(threat => {
      const intersects = raycaster.intersectObject(threat.mesh, true);
      if (intersects.length > 0 && !targetThreat) {
        targetThreat = threat;
      }
    });

    // If no direct hit, find nearest threat to ground intersection
    if (!targetThreat) {
      const groundIntersects = raycaster.intersectObject(groundMesh);
      if (groundIntersects.length > 0) {
        const worldPos = groundIntersects[0].point;
        let minDistance = Infinity;

        threats.forEach(threat => {
          const distance = threat.getPosition().distanceTo(worldPos);
          if (distance < minDistance && distance < 50) {
            // Within 50m of tap
            minDistance = distance;
            targetThreat = threat;
          }
        });
      }
    }

    // Launch interceptor at target threat if found
    if (targetThreat && simulationControls.autoIntercept) {
      // Find best battery to intercept
      const batteries = domePlacementSystem.getAllBatteries();
      let interceptorFired = false;

      for (const battery of batteries) {
        if (battery.canIntercept(targetThreat)) {
          const interceptor = battery.fireInterceptor(targetThreat);
          if (interceptor) {
            responsiveUI?.showNotification('Interceptor Launched!', 1500);
            // Add haptic feedback for successful launch
            mobileInput?.vibrate(20);
            interceptorFired = true;
            break;
          }
        }
      }

      if (!interceptorFired) {
        responsiveUI?.showNotification('Cannot Intercept', 1000);
      }
    } else if (!targetThreat) {
      responsiveUI?.showNotification('No threat in range', 1000);
    }
  });

  // Long press for threat info
  mobileInput?.onLongPress(position => {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(position, camera);

    // Check for threat intersection
    const threats = threatManager.getActiveThreats();
    threats.forEach(threat => {
      const intersects = raycaster.intersectObject(threat.mesh);
      if (intersects.length > 0) {
        const info = `Threat ${threat.id}\nAltitude: ${Math.round(threat.getPosition().y)}m\nSpeed: ${Math.round(threat.getVelocity().length())}m/s`;
        responsiveUI?.showNotification(info, 3000);
      }
    });
  });

  // Fire button removed - mobile UI has its own controls
}

// Performance info object still needed for updates
const perfInfo = {
  fps: 0,
  threats: 0,
  interceptors: 0,
  drawCalls: 0,
  triangles: 0,
  coordinated: 'Enabled',
};

// Performance stats are now displayed using stats.js
// Press Ctrl+H to toggle visibility

// Simple notification function
function showNotification(message: string): void {
  const notification = document.createElement('div');
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 10px 20px;
    border-radius: 5px;
    font-family: monospace;
    font-size: 14px;
    z-index: 10000;
    pointer-events: none;
  `;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.opacity = '0';
    notification.style.transition = 'opacity 0.5s';
    setTimeout(() => document.body.removeChild(notification), 500);
  }, 2000);
}

// Make notification function globally available
(window as any).showNotification = showNotification;

// Make THREE globally available for UI components
(window as any).THREE = THREE;

// Create new sandbox controls
const sandboxControls = new SandboxControls(gui, {
  threatManager,
  domePlacementSystem,
  cameraController,
  worldScaleIndicators,
  projectiles,
  simulationControls,
  showNotification,
});

// Create developer controls (hidden by default)
const developerControls = new DeveloperControls({
  threatManager,
  simulationControls,
  showNotification,
  renderer,
  scene,
});

// Legacy controls object for compatibility
const legacySandboxControls = {
  // These are kept for compatibility with other parts of the code
  showTrajectories: true,
  timeScale: 1.0,
  autoIntercept: true,
};

// Update legacy controls when sandbox controls change
// This allows other parts of the code to work with the legacy controls
simulationControls.showTrajectories = legacySandboxControls.showTrajectories;
simulationControls.timeScale = legacySandboxControls.timeScale;
simulationControls.autoIntercept = legacySandboxControls.autoIntercept;

// Old controls removed - using new SandboxControls and DeveloperControls classes

// Sound controls
const soundFolder = gui.addFolder('Sound Settings');
const soundSystem = SoundSystem.getInstance();
// Store soundSystem globally for debugging
(window as any).__soundSystem = soundSystem;

const soundControls = {
  enabled: soundSystem.isEnabled(),
  masterVolume: soundSystem.getMasterVolume(),
  launchVolume: soundSystem.getCategoryVolume('launch'),
  explosionVolume: soundSystem.getCategoryVolume('explosion'),
  alertVolume: soundSystem.getCategoryVolume('alert'),
  uiVolume: soundSystem.getCategoryVolume('ui'),
};

soundFolder
  .add(soundControls, 'enabled')
  .name('Sound Enabled')
  .onChange((value: boolean) => {
    soundSystem.setEnabled(value);
  });

soundFolder
  .add(soundControls, 'masterVolume', 0, 1, 0.1)
  .name('Master Volume')
  .onChange((value: number) => {
    soundSystem.setMasterVolume(value);
  });

soundFolder
  .add(soundControls, 'launchVolume', 0, 1, 0.1)
  .name('Launch Volume')
  .onChange((value: number) => {
    soundSystem.setCategoryVolume('launch', value);
  });

soundFolder
  .add(soundControls, 'explosionVolume', 0, 1, 0.1)
  .name('Explosion Volume')
  .onChange((value: number) => {
    soundSystem.setCategoryVolume('explosion', value);
  });

soundFolder
  .add(soundControls, 'alertVolume', 0, 1, 0.1)
  .name('Alert Volume')
  .onChange((value: number) => {
    soundSystem.setCategoryVolume('alert', value);
  });

soundFolder
  .add(soundControls, 'uiVolume', 0, 1, 0.1)
  .name('UI Volume')
  .onChange((value: number) => {
    soundSystem.setCategoryVolume('ui', value);
  });

// Apply initial settings to all batteries (only Iron Dome batteries have these methods)
domePlacementSystem.getAllBatteries().forEach(battery => {
  if (battery instanceof IronDomeBattery) {
    battery.setLaunchOffset(new THREE.Vector3(-2, 14.5, -0.1));
    battery.setLaunchDirection(new THREE.Vector3(0.3, 1.5, 0.1).normalize()); // More vertical launch angle
  }
});

// Set radar model facing direction (90 degrees = +X)
if (radarNetwork) {
  const radarAngle = (90 * Math.PI) / 180;
  radarNetwork.setModelFacingDirection(
    new THREE.Vector3(Math.sin(radarAngle), 0, -Math.cos(radarAngle))
  );
}

// CHAINSAW: Removed memory monitoring overhead

// Start game mode by default
if (simulationControls.gameMode) {
  // Don't start immediately - wait for user to click start
  debug.log('Game mode ready - click Start New Game to begin');
} else {
  // Sandbox mode - start spawning threats
  threatManager.setThreatMix('mixed');
  threatManager.startSpawning();
}

function showTrajectoryPrediction(position: THREE.Vector3, velocity: THREE.Vector3) {
  const points = TrajectoryCalculator.predictTrajectory(position, velocity);

  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = MaterialCache.getInstance().getLineMaterial({
    color: 0x0038b8,
    opacity: 0.3,
    transparent: true,
  });

  const line = new THREE.Line(geometry, material);
  scene.add(line);

  // Remove after 5 seconds - don't dispose shared materials
  setTimeout(() => {
    scene.remove(line);
    geometry.dispose(); // Geometry is unique per trajectory, safe to dispose
    // Don't dispose material - it's shared from MaterialCache
  }, 5000);
}

// Window resize handler
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  // Apply render scale for performance
  const renderScale = deviceCaps.getRenderScale();
  renderer.setSize(window.innerWidth * renderScale, window.innerHeight * renderScale);
  renderer.domElement.style.width = window.innerWidth + 'px';
  renderer.domElement.style.height = window.innerHeight + 'px';
}
window.addEventListener('resize', onWindowResize);

// Function to update loading status
function updateLoadingStatus(status: string) {
  const statusEl = document.querySelector('.loading-status');
  if (statusEl) {
    statusEl.textContent = status;
  }
}

// Flags to prevent race conditions
let isHidingLoadingScreen = false;
let isDeferredInitStarted = false;

// Function to hide loading screen with multiple fallbacks
async function hideLoadingScreen() {
  // Try to start BGM when hiding loading screen (user likely interacted)
  await soundSystem.ensureAudioContext();
  if (soundSystem.getBGMEnabled() && !soundSystem.isBGMPlaying()) {
    soundSystem.playBackgroundMusic().catch(() => {
      debug.log('BGM still blocked after loading screen hide');
    });
  }

  // Hide interaction prompt if shown
  const interactionEl = document.getElementById('loading-interaction');
  if (interactionEl) {
    interactionEl.classList.remove('show');
  }
  // Prevent multiple concurrent calls
  if (isHidingLoadingScreen) {
    debug.log('hideLoadingScreen already in progress, skipping');
    return;
  }

  const loadingEl = document.getElementById('loading');
  if (loadingEl && loadingEl.style.display !== 'none') {
    isHidingLoadingScreen = true;

    // Fade out the loading screen
    loadingEl.style.transition = 'opacity 0.3s ease-out';
    loadingEl.style.opacity = '0';

    setTimeout(() => {
      loadingEl.style.display = 'none';
      debug.log('Loading screen hidden');

      // PERFORMANCE: Start deferred initialization after loading screen is hidden
      // Only start if not already started
      if (!isDeferredInitStarted) {
        isDeferredInitStarted = true;
        startDeferredInitialization();
      } else {
        debug.log('Deferred initialization already started, skipping');
      }
    }, 300);
  }
}

// Deferred initialization function to run heavy operations after initial render
async function startDeferredInitialization() {
  debug.log('Starting deferred initialization...');

  // Phase 1: Initialize instance managers (50ms delay)
  setTimeout(() => {
    // Initialize ProjectileInstanceManager
    projectileInstanceManager = new ProjectileInstanceManager(scene);
    (window as any).__projectileInstanceManager = projectileInstanceManager;

    // Set instance manager on threat manager
    threatManager.setInstanceManager(projectileInstanceManager);

    // Configure all batteries
    const batteries = domePlacementSystem.getAllBatteries();
    batteries.forEach(battery => {
      battery.setResourceManagement(simulationControls.gameMode);
      if (radarNetwork) battery.setRadarNetwork(radarNetwork);
      // Don't set instance manager for batteries - GLTF models don't work with instancing
      // battery.setInstanceManager(projectileInstanceManager);
      threatManager.registerBattery(battery);

      // Apply auto-repair rate based on saved upgrade level
      const autoRepairLevel = gameState.getAutoRepairLevel();
      const repairRates = [0, 0.5, 1.0, 2.0]; // Health per second for each level
      battery.setAutoRepairRate(repairRates[autoRepairLevel]);
    });

    debug.log('ProjectileInstanceManager initialized');
  }, 50);

  // Phase 2: Generate city (100ms delay)
  setTimeout(() => {
    buildingSystem.generateCity(0, 0, 800);
    // Note: mergeStaticGeometry will be called after animations complete

    // Re-enable reference objects after city is generated
    worldScaleIndicators.setVisibility({
      showReferenceObjects: true,
    });

    debug.log('City generation started');
  }, 100);

  // Phase 3: Precompile materials (500ms delay)
  setTimeout(() => {
    // Pre-create commonly used materials
    materialCache.getMeshStandardMaterial({ color: 0x4a4a4a, roughness: 0.8, metalness: 0.3 });
    materialCache.getMeshStandardMaterial({ color: 0x333333, roughness: 0.7, metalness: 0.4 });
    materialCache.getMeshStandardMaterial({ color: 0x666666, roughness: 0.5, metalness: 0.7 });
    materialCache.getMeshStandardMaterial({ color: 0x555555, roughness: 0.6, metalness: 0.5 });
    materialCache.getMeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.4, metalness: 0.9 });

    // Precompile shaders
    materialCache.precompileShaders(renderer, scene, camera);
    debug.log('Material shaders precompiled');
  }, 500);

  // Phase 4: Start game mode if needed (600ms delay)
  setTimeout(() => {
    if (!simulationControls.gameMode) {
      // Sandbox mode - start spawning threats
      threatManager.setThreatMix('mixed');
      threatManager.startSpawning();
    }
    debug.log('Initialization complete');
  }, 600);
}

// Check if document is already loaded (for iPad/iOS)
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  // Document already loaded, hide immediately
  setTimeout(hideLoadingScreen, 100);
}

// Also listen for DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(hideLoadingScreen, 100);
});

// Preload models and hide loading screen when ready
window.addEventListener('load', async () => {
  // Set initial model quality preference
  (window as any).__interceptorModelQuality = simulationControls.interceptorModel;

  // CHAINSAW: Removed model preloading overhead - load on demand

  // Hide loading screen
  hideLoadingScreen();
});

// Add timeout fallbacks for stubborn devices
setTimeout(hideLoadingScreen, 1000); // 1 second fallback
setTimeout(hideLoadingScreen, 3000); // 3 second fallback

// Animation loop
const clock = new THREE.Clock();
let previousTime = 0;

// CHAINSAW: Removed all performance monitoring systems

// Keyboard event handlers
window.addEventListener('keydown', e => {
  // CHAINSAW: Removed stats display keyboard handlers

  // ESC key toggles pause menu
  if (e.key === 'Escape') {
    pauseMenuOpen = !pauseMenuOpen;
    isPaused = pauseMenuOpen;

    if (isPaused) {
      simulationControls.pause = true;
      if (simulationControls.gameMode) {
        if (waveManager) waveManager.pauseWave();
      } else {
        // Stop threat spawning in sandbox mode to prevent timer issues
        threatManager.stopSpawning();
      }
      // Disable controls when paused
      controls.enabled = false;
      // Hide GUI when paused
      gui.domElement.style.display = 'none';
      // Hide tactical display when paused
      const tacticalContainer = tacticalDisplay.getContainer();
      if (tacticalContainer) {
        tacticalContainer.style.display = 'none';
      }
    } else {
      simulationControls.pause = false;
      if (simulationControls.gameMode) {
        if (waveManager) waveManager.resumeWave();
      } else {
        // Resume threat spawning in sandbox mode
        threatManager.startSpawning();
      }
      // Re-enable controls when unpaused
      controls.enabled = true;
      // Show GUI when unpaused (only if not in game mode or on mobile)
      if (!simulationControls.gameMode && !deviceInfo.isMobile && !deviceInfo.isTablet) {
        gui.domElement.style.display = 'block';
      }
      // Show tactical display when unpaused
      const tacticalContainer2 = tacticalDisplay.getContainer();
      if (tacticalContainer2) {
        tacticalContainer2.style.display = 'block';
      }
    }

    // Re-render UI with pause menu state
    renderUI();
  }

  // Camera mode shortcuts
  if (e.key === '1') cameraController.setMode(CameraMode.ORBIT);
  if (e.key === '2') cameraController.setMode(CameraMode.TACTICAL);
  if (e.key === '3') cameraController.setMode(CameraMode.BATTLE_OVERVIEW);
  if (e.key === '4') cameraController.setMode(CameraMode.CINEMATIC);
  if (e.key === '5') {
    const threats = threatManager.getActiveThreats();
    if (threats.length > 0) {
      cameraController.setMode(CameraMode.FOLLOW_THREAT, threats[0]);
    }
  }
  if (e.key === '6') {
    if (projectiles.length > 0) {
      cameraController.setMode(CameraMode.FOLLOW_INTERCEPTOR, projectiles[0]);
    }
  }

  // Mouse wheel zoom
  if (e.key === '+' || e.key === '=') cameraController.zoom(-5);
  if (e.key === '-' || e.key === '_') cameraController.zoom(5);

  // R key toggles render stats
  if (e.key === 'r' || e.key === 'R') {
    (window as any).toggleRenderStats();
  }

  // B key forces all buildings visible (fixes culling issues)
  if (e.key === 'b' || e.key === 'B') {
    buildingSystem.forceAllBuildingsVisible();
    showNotification('Updated building & street light bounds');
  }

  // Shift+B disables frustum culling entirely (nuclear option)
  if ((e.key === 'b' || e.key === 'B') && e.shiftKey) {
    const instancedRenderer = (buildingSystem as any).instancedBuildingRenderer;
    if (instancedRenderer) {
      instancedRenderer.disableFrustumCulling();
      showNotification('Disabled building frustum culling');
    }
  }
});

// Mouse wheel zoom
renderer.domElement.addEventListener(
  'wheel',
  e => {
    if (cameraController.getCurrentMode() !== CameraMode.ORBIT) {
      e.preventDefault();
      cameraController.zoom(e.deltaY * 0.01);
    }
  },
  { passive: false }
);

// WebGL context loss handling for mobile stability
renderer.domElement.addEventListener(
  'webglcontextlost',
  event => {
    event.preventDefault();
    debug.error('WebGL context lost!');

    // Stop animation loop
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }

    // Pause game
    simulationControls.pause = true;
    if (waveManager) waveManager.pauseWave();

    // Show notification
    if ((window as any).showNotification) {
      (window as any).showNotification('Graphics context lost - reloading...');
    }
  },
  false
);

renderer.domElement.addEventListener(
  'webglcontextrestored',
  () => {
    debug.log('WebGL context restored!');

    // Reload the page to ensure clean state
    setTimeout(() => {
      window.location.reload();
    }, 1000);
  },
  false
);

// Memory management for mobile
let lastMemoryCheck = 0;
const MEMORY_CHECK_INTERVAL = 10000; // Check every 10 seconds

function checkMemoryPressure() {
  const now = Date.now();
  if (now - lastMemoryCheck < MEMORY_CHECK_INTERVAL) return;
  lastMemoryCheck = now;

  // Check renderer info
  const info = renderer.info;
  if (info.memory.geometries > 1000 || info.memory.textures > 500) {
    debug.warn('High memory usage detected', {
      geometries: info.memory.geometries,
      textures: info.memory.textures,
    });

    // Force garbage collection if available
    if ((window as any).gc) {
      (window as any).gc();
    }
  }

  // On mobile, be more aggressive with cleanup
  if (deviceInfo.isMobile || deviceInfo.isTablet) {
    // Limit max threats and projectiles
    if (threatManager.getActiveThreats().length > 30) {
      threatManager.clearOldestThreats(10);
    }

    if (projectiles.length > 50) {
      // Remove oldest projectiles
      const toRemove = projectiles.slice(0, 10);
      toRemove.forEach(p => {
        p.destroy(scene, world);
        const idx = projectiles.indexOf(p);
        if (idx !== -1) projectiles.splice(idx, 1);
      });
    }
  }
}

// Cleanup function for proper disposal
function cleanup() {
  debug.log('Cleaning up resources...');

  // Stop animation loop
  if (animationId !== null) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }

  // Clean up event listeners
  window.removeEventListener('resize', onWindowResize);
  window.removeEventListener('resize', checkOrientation);
  window.removeEventListener('orientationchange', checkOrientation);

  // Clean up mobile input
  if (mobileInput) {
    mobileInput.dispose();
    mobileInput = null;
  }

  // Clean up projectiles
  projectiles.forEach(p => p.destroy(scene, world));
  projectiles = [];

  // Clean up threats
  threatManager.clearAll();

  // Dispose of renderer
  renderer.dispose();

  // Clear caches
  MaterialCache.getInstance().clear();
}

// Add cleanup on page unload
window.addEventListener('beforeunload', cleanup);
window.addEventListener('pagehide', cleanup);

// Render bottleneck tracking
const frameCount = 0;
const renderBottleneckLogged = false;

function animate() {
  animationId = requestAnimationFrame(animate);

  // Check memory pressure on mobile
  if (deviceInfo.isMobile || deviceInfo.isTablet) {
    checkMemoryPressure();
  }

  // CHAINSAW: Removed profiler overhead during gameplay
  // Store camera reference for health bar orientation
  (scene as any).__camera = camera;

  const rawDeltaTime = clock.getDelta();
  // Clamp deltaTime to prevent large jumps when tab regains focus
  const deltaTime = Math.min(rawDeltaTime, 0.1); // Max 100ms per frame
  const currentTime = clock.getElapsedTime();
  const fps = 1 / deltaTime;

  // CHAINSAW: Removed performance monitoring overhead

  // Mobile-specific dynamic quality adjustment
  if (deviceInfo.isMobile || deviceInfo.isTablet) {
    deviceCaps.adjustQualityForFPS(fps);

    // Adjust max interceptors based on performance
    const maxInterceptors = deviceCaps.getMaxSimultaneousInterceptors();
    if (interceptionSystem.getActiveInterceptorCount() >= maxInterceptors) {
      // Apply interceptor limit to all batteries
      const allBatteries = domePlacementSystem.getAllBatteries();
      allBatteries.forEach(battery => {
        battery.getConfig().interceptorLimit = maxInterceptors;
      });
    }
  }

  // Get active threats (needed for rendering even when paused)
  const activeThreats = threatManager.getActiveThreats();

  // Update world systems

  // CHAINSAW OPTIMIZED: Update time-sliced systems (minimal performance impact)
  optimizedDayNight.update(deltaTime);
  const dayNightTime = optimizedDayNight.getTime();
  buildingSystem.updateTimeOfDay(dayNightTime.hours);
  environmentSystem.setTimeOfDay(dayNightTime.hours);

  // Keep visuals but NO dynamic updates during gameplay for performance

  // CHAINSAW: Removed battlefield zones update

  // Update camera controller with all interceptors
  const allInterceptors = [...projectiles, ...interceptionSystem.getActiveInterceptors()];
  cameraController.update(deltaTime, activeThreats, allInterceptors);

  // Update game systems only when not paused
  if (!simulationControls.pause) {
    // Update physics with time scale
    const scaledDelta = deltaTime * simulationControls.timeScale;
    world.step(1 / 60, scaledDelta, 3);

    // Update threat manager
    threatManager.update(deltaTime);

    // Update all batteries (includes health bar orientation and reloading)
    const allBatteries = domePlacementSystem.getAllBatteries();

    // Apply auto-repair based on upgrade level
    const autoRepairLevel = gameState.getAutoRepairLevel();
    const repairRates = [0, 0.5, 1.0, 2.0]; // Health per second for each level

    allBatteries.forEach(battery => {
      battery.setAutoRepairRate(repairRates[autoRepairLevel]);
      battery.update(deltaTime, activeThreats);
    });

    // Update radar network - pass threats directly instead of mapping
    if (activeThreats.length > 0) {
      if (radarNetwork) radarNetwork.update(activeThreats);
    }

    // Update projectiles
    const projectileCount = projectiles.length;
    if (projectileCount > 0) {
      for (let i = projectiles.length - 1; i >= 0; i--) {
        const projectile = projectiles[i];
        projectile.update();

        // Remove projectiles that fall below ground
        if (projectile.body.position.y < -10) {
          projectile.destroy(scene, world);
          projectiles.splice(i, 1);
        }
      }
    }

    // Update pooled trail system for all trails
    PooledTrailSystem.getInstance(scene).update();
  }

  // Update interception system and other systems
  let systemInterceptors: Projectile[] = [];

  if (!simulationControls.pause) {
    // Always update interception system to handle active interceptors
    // but only launch new ones if autoIntercept is enabled
    systemInterceptors = interceptionSystem.update(
      activeThreats,
      !simulationControls.autoIntercept
    );

    // Update dome placement system (for instanced rendering)
    domePlacementSystem.update();

    // CHAINSAW: Update instanced debris renderer
    instancedDebrisRenderer.update(deltaTime);

    // CHAINSAW: Removed instanced rendering update - using standard meshes
  }

  // Update GUI at 30 Hz (33ms) for smooth tactical display
  if (currentTime - previousTime > 0.033) {
    const stats = interceptionSystem.getStats();
    const allProjectiles = [...projectiles, ...systemInterceptors];

    perfInfo.fps = Math.round(fps);
    perfInfo.threats = activeThreats.length;
    perfInfo.interceptors = allProjectiles.length;
    perfInfo.drawCalls = renderer.info.render.calls;
    perfInfo.triangles = renderer.info.render.triangles;
    perfInfo.coordinated = stats.coordination
      ? `${stats.coordination.activeAssignments} active`
      : 'Disabled';

    // Update battery network info
    const allBatteries = domePlacementSystem.getAllBatteries();
    let totalLoaded = 0;
    let totalCapacity = 0;

    allBatteries.forEach(battery => {
      if (battery instanceof IronDomeBattery) {
        totalLoaded += battery.getInterceptorCount();
        totalCapacity += battery.getConfig().launcherCount;
      }
    });

    // Battery info is now displayed in the UI, not in debug controls

    // Update tactical display
    const displayPosition =
      allBatteries.length > 0 ? allBatteries[0].getPosition() : new THREE.Vector3(0, 0, 0);

    tacticalDisplay.update(
      activeThreats,
      displayPosition,
      totalLoaded,
      0.95, // Default success rate
      totalCapacity // Total launcher capacity
    );

    // CHAINSAW: Removed performance warnings

    previousTime = currentTime;
  }

  // Update controls
  if (cameraController.getCurrentMode() === CameraMode.ORBIT) {
    controls.update();
  }

  // Update sound system for fade effects
  const soundSystem = SoundSystem.getInstance();
  soundSystem.update();

  // CHAINSAW: Removed heavy trail/explosion systems causing frame drops and interception lag

  // Render
  renderer.render(scene, camera);

  // CHAINSAW: Removed all profiler calls
}

// Add debug mode indicator
if (debug.isEnabled()) {
  const debugIndicator = document.createElement('div');
  debugIndicator.style.position = 'absolute';
  debugIndicator.style.top = '10px';
  debugIndicator.style.right = '10px';
  debugIndicator.style.padding = '5px 10px';
  debugIndicator.style.backgroundColor = 'rgba(0, 56, 184, 0.2)';
  debugIndicator.style.border = '1px solid #0038b8';
  debugIndicator.style.color = '#0038b8';
  debugIndicator.style.fontFamily = 'monospace';
  debugIndicator.style.fontSize = '12px';
  debugIndicator.style.zIndex = '1000';
  debugIndicator.textContent = 'DEBUG MODE';
  document.body.appendChild(debugIndicator);
}

// LOD rendering is now always enabled by default

// LOD rendering is always enabled - no toggle needed

// Orientation handling for mobile
let animationId: number | null = null;
const isOrientationLocked = false;

function checkOrientation() {
  const orientationOverlay = document.getElementById('orientation-overlay');
  if (!orientationOverlay) return false;

  // Disable orientation lock for now to debug touch issues
  return false;

  /* 
  // Commented out unreachable code to fix lint error
  // Only check on small mobile devices
  const isSmallMobile = window.innerWidth <= 768 && deviceInfo.isMobile;
  const isPortrait = window.innerHeight > window.innerWidth;

  const shouldLock = isSmallMobile && isPortrait;

  if (shouldLock && !isOrientationLocked) {
    // Lock orientation - pause game
    isOrientationLocked = true;
    orientationOverlay?.classList.add('active');
    if (animationId !== null) {
      cancelAnimationFrame(animationId as number);
      animationId = null;
    }
    // Pause game systems
    simulationControls.pause = true;
    if (waveManager) waveManager.pauseWave();
    debug.log('Orientation locked - game paused');
  } else if (!shouldLock && isOrientationLocked) {
    // Unlock orientation - resume game
    isOrientationLocked = false;
    orientationOverlay?.classList.remove('active');
    if (!animationId) {
      animate(); // Restart animation loop
    }
    // Resume game systems
    simulationControls.pause = false;
    if (waveManager && simulationControls.gameMode) waveManager.resumeWave();
    debug.log('Orientation unlocked - game resumed');
  }

  return shouldLock;
  */
}

// Check orientation on load and resize
window.addEventListener('resize', checkOrientation);
window.addEventListener('orientationchange', checkOrientation);

// Initial orientation check
const isLocked = checkOrientation();

// Check for inspector mode
const urlParams = new URLSearchParams(window.location.search);
const inspectorMode = urlParams.has('inspector');

if (inspectorMode) {
  debug.log('Inspector mode enabled');

  // Create inspector container
  const inspectorContainer = document.createElement('div');
  inspectorContainer.id = 'inspector-root';
  document.body.appendChild(inspectorContainer);

  // Render inspector
  const inspectorRoot = createRoot(inspectorContainer);
  inspectorRoot.render(
    React.createElement(Inspector, {
      scene: scene,
      camera: camera,
      renderer: renderer,
    })
  );
}

// Update loading status
updateLoadingStatus('Ready to launch!');

// Show interaction prompt if audio context is suspended
const checkAudioContext = () => {
  const context = THREE.AudioContext.getContext();
  if (context.state === 'suspended') {
    const interactionEl = document.getElementById('loading-interaction');
    if (interactionEl) {
      interactionEl.classList.add('show');
    }
  }
};

// Check after a short delay to let browser determine autoplay capability
setTimeout(checkAudioContext, 100);

// Start background music after user interaction (browser autoplay policy)
const startBGMOnInteraction = async () => {
  if (soundSystem.getBGMEnabled() && !soundSystem.isBGMPlaying()) {
    await soundSystem.playBackgroundMusic();
  }
};

// Try to start BGM immediately (may be blocked by browser)
if (soundSystem.getBGMEnabled()) {
  soundSystem.playBackgroundMusic().catch(() => {
    debug.log('BGM autoplay blocked, waiting for user interaction');
  });
}

// Add user interaction handler for BGM
const handleFirstInteraction = async () => {
  // Hide interaction prompt
  const interactionEl = document.getElementById('loading-interaction');
  if (interactionEl) {
    interactionEl.classList.remove('show');
  }

  await soundSystem.ensureAudioContext();
  await startBGMOnInteraction();
  // Remove listeners after first interaction
  document.removeEventListener('click', handleFirstInteraction);
  document.removeEventListener('touchstart', handleFirstInteraction);
  document.removeEventListener('keydown', handleFirstInteraction);
};

// Listen for first user interaction
document.addEventListener('click', handleFirstInteraction, { passive: true });
document.addEventListener('touchstart', handleFirstInteraction, { passive: true });
document.addEventListener('keydown', handleFirstInteraction, { passive: true });

// Initial UI render
updateUIMode();

// Start the animation loop only if not orientation locked
if (!isLocked) {
  animate();
}

// Final fallback after animation starts
setTimeout(hideLoadingScreen, 100);

// Debug: Check what's blocking touch events
if (deviceInfo.isMobile) {
  setTimeout(() => {
    debug.category('Input', 'Canvas element:', renderer.domElement);
    debug.category('Input', 'Canvas z-index:', renderer.domElement.style.zIndex);
    debug.category('Input', 'Controls enabled:', controls.enabled);
    debug.category('Input', 'Controls touch settings:', controls.touches);

    // Add global touch listener to see if any element is capturing events
    document.addEventListener(
      'touchstart',
      e => {
        debug.category('Input', 'Document touch detected on:', e.target);
      },
      { passive: true, capture: true }
    );
  }, 1000);
}
