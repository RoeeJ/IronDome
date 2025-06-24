import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as CANNON from 'cannon-es';
import GUI from 'lil-gui';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Projectile } from './entities/Projectile';
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
import { ModelCache } from './utils/ModelCache';
import { debug } from './utils/DebugLogger';
import { MobileInputManager } from './input/MobileInputManager';
import { DeviceCapabilities } from './utils/DeviceCapabilities';
import { ResponsiveUI } from './ui/ResponsiveUI';
import { GameState } from './game/GameState';
import { WaveManager } from './game/WaveManager';
import { ResourceManager } from './game/ResourceManager';
import { DomePlacementSystem } from './game/DomePlacementSystem';
import { GameUI } from './ui/GameUI';
import { InstancedProjectileRenderer } from './rendering/InstancedProjectileRenderer';
import { InstancedThreatRenderer } from './rendering/InstancedThreatRenderer';
import { LODInstancedThreatRenderer } from './rendering/LODInstancedThreatRenderer';
import { StatsDisplay } from './ui/StatsDisplay';
import { ExtendedStatsDisplay } from './ui/ExtendedStatsDisplay';
import { BlastPhysics } from './systems/BlastPhysics';
import { ExplosionManager, ExplosionType } from './systems/ExplosionManager';
import { UnifiedTrailSystem } from './systems/UnifiedTrailSystem';
import { GeometryFactory } from './utils/GeometryFactory';
import { MaterialCache } from './utils/MaterialCache';
import { SoundSystem } from './systems/SoundSystem';
import { Inspector } from './ui/Inspector';

// Import new world systems
import { CameraController, CameraMode } from './camera/CameraController';
import { EnvironmentSystem } from './world/EnvironmentSystem';
import { DayNightCycle } from './world/DayNightCycle';
import { WorldScaleIndicators } from './world/WorldScaleIndicators';
import { BattlefieldZones } from './world/BattlefieldZones';

// Initialize device capabilities
const deviceCaps = DeviceCapabilities.getInstance();
const deviceInfo = deviceCaps.getDeviceInfo();
const perfProfile = deviceCaps.getPerformanceProfile();

debug.log('Device detected:', {
  type: deviceInfo.isMobile ? 'Mobile' : deviceInfo.isTablet ? 'Tablet' : 'Desktop',
  gpu: deviceInfo.gpu,
  targetFPS: perfProfile.targetFPS,
});

// Scene setup
const scene = new THREE.Scene();

// Create gradient background for better visibility
const canvas = document.createElement('canvas');
canvas.width = 1;
canvas.height = 512;
const context = canvas.getContext('2d')!;
const gradient = context.createLinearGradient(0, 0, 0, 512);
gradient.addColorStop(0, '#0a1929'); // Very dark blue at top
gradient.addColorStop(0.3, '#1e3c72'); // Dark blue
gradient.addColorStop(0.6, '#2a5298'); // Medium blue
gradient.addColorStop(1, '#5a7ba6'); // Lighter blue at horizon
context.fillStyle = gradient;
context.fillRect(0, 0, 1, 512);

const gradientTexture = new THREE.CanvasTexture(canvas);
gradientTexture.needsUpdate = true;

// Apply gradient as background (will be replaced by skybox)
// scene.background = gradientTexture
// scene.fog = new THREE.Fog(0x2a5298, 200, 1000) // Darker fog for atmosphere

// Camera setup
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  3000 // Further increased far plane for extended world
);
camera.position.set(150, 80, 150); // Moved camera further back for better overview
camera.lookAt(0, 0, 0);

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

// Shadow settings based on device
renderer.shadowMap.enabled = deviceCaps.shouldEnableShadows();
if (renderer.shadowMap.enabled) {
  renderer.shadowMap.type =
    perfProfile.shadowQuality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
}

document.body.appendChild(renderer.domElement);

// Precompile common materials to prevent shader compilation freezes
import { MaterialCache } from './utils/MaterialCache';
const materialCache = MaterialCache.getInstance();
// Pre-create commonly used materials
materialCache.getMeshStandardMaterial({ color: 0x4a4a4a, roughness: 0.8, metalness: 0.3 });
materialCache.getMeshStandardMaterial({ color: 0x333333, roughness: 0.7, metalness: 0.4 });
materialCache.getMeshStandardMaterial({ color: 0x666666, roughness: 0.5, metalness: 0.7 });
materialCache.getMeshStandardMaterial({ color: 0x555555, roughness: 0.6, metalness: 0.5 });
materialCache.getMeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.4, metalness: 0.9 });
// Precompile shaders after scene is set up
setTimeout(() => {
  materialCache.precompileShaders(renderer, scene, camera);
  debug.log('Material shaders precompiled');
}, 100);

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 20;
controls.maxDistance = 1000; // Further increased for extended world
controls.maxPolarAngle = Math.PI / 2 - 0.1; // Prevent going below ground

// Store controls globally for UI to disable when needed
(window as any).__controls = controls;

// Initialize camera controller
const cameraController = new CameraController(camera, controls);
(window as any).__cameraController = cameraController;

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
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

// Initialize world systems
const environmentSystem = new EnvironmentSystem(scene);
environmentSystem.initialize({
  fogEnabled: true,
  skyboxEnabled: true,
  terrainEnabled: true,
  cloudsEnabled: false, // Removed clouds
  atmosphericScattering: true,
});

const dayNightCycle = new DayNightCycle(scene, ambientLight, directionalLight);
dayNightCycle.setEnvironmentSystem(environmentSystem);
dayNightCycle.setTime(14, 0, 0); // Start at 2 PM

const worldScaleIndicators = new WorldScaleIndicators(scene, {
  showGrid: true,
  showDistanceMarkers: false, // Disabled - removes red poles
  showReferenceObjects: true, // Keep buildings only
  showWindParticles: false, // Disabled - removes particle effects
  showAltitudeMarkers: false, // Disabled - removes cone indicators
  gridSize: 2000,
  gridDivisions: 100,
});
worldScaleIndicators.initialize();
// Optimize static world geometry to reduce draw calls
worldScaleIndicators.optimizeGeometry();

// Disabled battlefield zones to remove tube corridors and border markers
// const battlefieldZones = new BattlefieldZones(scene)
// battlefieldZones.initialize()
const battlefieldZones = null;

// Threat Manager with extended bounds
const threatManager = new ThreatManager(scene, world);
// Set extended spawn bounds for threats
(threatManager as any).spawnBounds = {
  minX: -800,
  maxX: 800,
  minZ: -800,
  maxZ: 800,
  minY: 50,
  maxY: 300,
};
// Make threat manager globally available for explosion system
(window as any).__threatManager = threatManager;

// Hook into threat lifecycle for instanced rendering
threatManager.on('threatSpawned', (threat: Threat) => {
  if (useInstancedRendering) {
    if (useLODRendering) {
      lodInstancedThreatRenderer.addThreat(threat);
    } else {
      instancedThreatRenderer.addThreat(threat);
    }
    // Add trail to batched renderer
    const trailColor = threat.type === 'drone' ? new THREE.Color(0.5, 0.5, 0.5) : new THREE.Color(1, 0.3, 0);
    instancedTrailRenderer.addTrail(threat, trailColor);
  }
});

threatManager.on('threatDestroyed', (threatId: string) => {
  if (useInstancedRendering) {
    if (useLODRendering) {
      lodInstancedThreatRenderer.removeThreat(threatId);
    } else {
      instancedThreatRenderer.removeThreat(threatId);
    }
    // Remove trail from batched renderer
    const threat = threatManager.threats.find(t => t.id === threatId);
    if (threat) {
      instancedTrailRenderer.removeTrail(threat);
    }
  }
});

// Invisible Radar System - provides detection without visual towers
import { InvisibleRadarSystem } from './scene/InvisibleRadarSystem';
const radarNetwork = new InvisibleRadarSystem(800); // 800m detection radius

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
(window as any).__instancedProjectileRenderer = instancedProjectileRenderer;

// Connect all systems
domePlacementSystem.setInterceptionSystem(interceptionSystem);
if (radarNetwork) domePlacementSystem.setRadarNetwork(radarNetwork);

// Add all batteries from placement system to interception system
const batteries = domePlacementSystem.getAllBatteries();
batteries.forEach(battery => {
  battery.setResourceManagement(true);
  if (radarNetwork) battery.setRadarNetwork(radarNetwork);
  interceptionSystem.addBattery(battery);
  threatManager.registerBattery(battery);

  // Apply auto-repair rate based on saved upgrade level
  const autoRepairLevel = gameState.getAutoRepairLevel();
  const repairRates = [0, 0.5, 1.0, 2.0]; // Health per second for each level
  battery.setAutoRepairRate(repairRates[autoRepairLevel]);
});

// Wave Manager
const waveManager = new WaveManager(threatManager);

// Tactical Display
const tacticalDisplay = new TacticalDisplay();

// Initial render of tactical display with default values
tacticalDisplay.update([], new THREE.Vector3(0, 0, 0), 20, 0.95, 20);

// Projectile management
let projectiles: Projectile[] = [];

// Instanced renderers for performance
const instancedProjectileRenderer = new InstancedProjectileRenderer(scene);
const instancedThreatRenderer = new InstancedThreatRenderer(scene);
const lodInstancedThreatRenderer = new LODInstancedThreatRenderer(scene, camera);
const useInstancedRendering = true;
const useLODRendering = true;

// Import and create batched trail renderer
import { InstancedTrailRenderer } from './rendering/OptimizedInstancedRenderer';
const instancedTrailRenderer = new InstancedTrailRenderer(500, 30); // 500 trails, 30 points each
scene.add(instancedTrailRenderer.mesh);
// Make it globally available
(window as any).__instancedTrailRenderer = instancedTrailRenderer;

// Import and create instanced debris renderer
import { InstancedDebrisRenderer } from './rendering/InstancedDebrisRenderer';
const instancedDebrisRenderer = new InstancedDebrisRenderer(scene, 500);
// Make it globally available for the debris system
(window as any).__instancedDebrisRenderer = instancedDebrisRenderer;

// Import and create instanced explosion renderer
import { InstancedExplosionRenderer } from './rendering/InstancedExplosionRenderer';
const instancedExplosionRenderer = new InstancedExplosionRenderer(scene, 30);
// Make it globally available
(window as any).__instancedExplosionRenderer = instancedExplosionRenderer;

// Load saved preferences from localStorage
const savedGameMode = localStorage.getItem('ironDome_gameMode');
const savedProfilerVisible = localStorage.getItem('ironDome_profilerVisible');
const savedInterceptMode = localStorage.getItem('ironDome_interceptMode');

// Simulation controls (must be defined before UI)
const simulationControls = {
  gameMode: savedGameMode !== null ? savedGameMode === 'true' : true, // Default to true if not saved
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

// Create React UI
const uiContainer = document.createElement('div');
uiContainer.id = 'game-ui-root';
document.body.appendChild(uiContainer);

const uiRoot = createRoot(uiContainer);

// Import RenderStats component
import { RenderStats } from './ui/RenderStats';

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

// Function to update UI when mode changes
const updateUIMode = () => {
  uiRoot.render(
    React.createElement(GameUI, {
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
        updateUIMode(); // Re-render UI
      },
    })
  );
};

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

// Apply responsive UI
const responsiveUI = new ResponsiveUI(gui);

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
      const threat = closestThreat;

      if (threat) {
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

                    console.log(
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
                      console.log('Manual intercept failed - unmarking threat');
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
                console.log('Manual intercept fired!');
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
      }
    } else {
      // Clicked empty space - clear selection
      manualTargetingSystem.clearSelection();
    }
  } else {
    // Reset cursor
    renderer.domElement.style.cursor = 'auto';
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

// Initialize mobile input if on touch device
let mobileInput: MobileInputManager | null = null;
if (deviceInfo.hasTouch) {
  mobileInput = new MobileInputManager(camera, controls, renderer.domElement);

  // Set up tap for dome placement or interceptor launch
  mobileInput.onTap(position => {
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
            responsiveUI.showNotification('Interceptor Launched!', 1500);
            // Add haptic feedback for successful launch
            mobileInput.vibrate(20);
            interceptorFired = true;
            break;
          }
        }
      }

      if (!interceptorFired) {
        responsiveUI.showNotification('Cannot Intercept', 1000);
      }
    } else if (!targetThreat) {
      responsiveUI.showNotification('No threat in range', 1000);
    }
  });

  // Long press for threat info
  mobileInput.onLongPress(position => {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(position, camera);

    // Check for threat intersection
    const threats = threatManager.getActiveThreats();
    threats.forEach(threat => {
      const intersects = raycaster.intersectObject(threat.mesh);
      if (intersects.length > 0) {
        const info = `Threat ${threat.id}\nAltitude: ${Math.round(threat.getPosition().y)}m\nSpeed: ${Math.round(threat.getVelocity().length())}m/s`;
        responsiveUI.showNotification(info, 3000);
      }
    });
  });

  // Add a fire button for mobile
  const fireButton = responsiveUI.createMobileButton('🚀 FIRE', () => {
    // Fire at the highest priority threat
    const threats = threatManager.getActiveThreats();
    if (threats.length > 0) {
      // Sort by time to impact
      const sortedThreats = threats.sort((a, b) => {
        const timeA = a.getTimeToImpact();
        const timeB = b.getTimeToImpact();
        return timeA - timeB;
      });

      // Find best battery to intercept
      const batteries = domePlacementSystem.getAllBatteries();
      let interceptorFired = false;

      for (const battery of batteries) {
        if (battery.canIntercept(sortedThreats[0])) {
          const interceptor = battery.fireInterceptor(sortedThreats[0]);
          if (interceptor) {
            responsiveUI.showNotification('Interceptor Launched!', 1500);
            mobileInput.vibrate(30);
            interceptorFired = true;
            break;
          }
        }
      }

      if (!interceptorFired) {
        responsiveUI.showNotification('No interceptors available', 1500);
      }
    } else {
      responsiveUI.showNotification('No threats detected', 1000);
    }
  });

  fireButton.style.bottom = '100px'; // Move up to avoid bottom controls
  fireButton.style.right = '20px';
  document.body.appendChild(fireButton);
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

// Sandbox Controls
const sandboxFolder = gui.addFolder('Sandbox Controls');
const sandboxControls = {
  // Threat spawning
  spawnRocket: () => threatManager.spawnSpecificThreat('rocket'),
  spawnMortar: () => threatManager.spawnSpecificThreat('mortar'),
  spawnDrone: () => threatManager.spawnSpecificThreat('drone'),
  spawnBallistic: () => threatManager.spawnSpecificThreat('ballistic'),
  clearAllThreats: () => {
    threatManager.clearAll();
    showNotification('All threats cleared');
  },

  // Salvo controls
  salvoSize: 5,
  salvoType: 'mixed',
  launchSalvo: () => {
    threatManager.spawnSalvo(sandboxControls.salvoSize, sandboxControls.salvoType);
    showNotification(`Launched ${sandboxControls.salvoSize} ${sandboxControls.salvoType} threats`);
  },

  // Battery controls
  addRandomBattery: () => {
    // Try to find a valid position for the battery
    let attempts = 0;
    const maxAttempts = 50;
    let validPosition: THREE.Vector3 | null = null;

    while (attempts < maxAttempts && !validPosition) {
      const angle = Math.random() * Math.PI * 2;
      const distance = 50 + Math.random() * 100;
      const position = new THREE.Vector3(Math.cos(angle) * distance, 0, Math.sin(angle) * distance);

      // Check if this position is valid
      if (domePlacementSystem.isPositionValid(position)) {
        validPosition = position;
      }
      attempts++;
    }

    if (validPosition) {
      domePlacementSystem.placeBatteryAt(validPosition, `battery_${Date.now()}`, 1);
      showNotification('Added random battery');
    } else {
      showNotification('No valid position found for battery', 'error');
    }
  },
  upgradeAllBatteries: () => {
    let upgraded = 0;
    const batteries = domePlacementSystem.getAllBatteries();
    console.log(`Found ${batteries.length} batteries to check for upgrades`);

    batteries.forEach(battery => {
      const batteryId = domePlacementSystem.getBatteryId(battery);
      console.log(`Checking battery ID: ${batteryId}`);
      if (batteryId) {
        const placement = domePlacementSystem.getDomePlacements().find(p => p.id === batteryId);
        console.log(`Battery ${batteryId} current level: ${placement?.level || 'not found'}`);
        if (placement && placement.level < 5) {
          if (domePlacementSystem.upgradeBattery(batteryId)) {
            upgraded++;
            console.log(`Successfully upgraded battery ${batteryId}`);
          } else {
            console.log(`Failed to upgrade battery ${batteryId}`);
          }
        }
      }
    });

    if (upgraded > 0) {
      showNotification(`Upgraded ${upgraded} batteries`);
    } else {
      showNotification('No batteries to upgrade (max level reached)');
    }
  },

  // Visual settings
  showRadarCoverage: false,
  showTrajectories: true,
  timeScale: 1.0,
  enableFog: false,

  // Defense settings
  autoIntercept: true,

  // Debug controls
  logCraterStats: () => {
    const craterStats = threatManager.getCraterStats();
    console.log(`Active craters: ${craterStats.count}`);
    craterStats.ids.forEach(id => console.log(`  - ${id}`));
  },

  logGroundEffects: () => {
    const craterStats = threatManager.getCraterStats();
    const explosionManager = ExplosionManager.getInstance(scene);
    const explosionStats = explosionManager.getStats();
    const launchEffects = threatManager.getLaunchEffectsSystem();
    const scorchMarkCount = launchEffects.getScorchMarkCount();
    console.log('=== GROUND EFFECTS DEBUG ===');
    console.log(`Craters: ${craterStats.count}`);
    console.log(`Shockwaves: ${explosionStats.activeShockwaves}`);
    console.log(`Scorch marks: ${scorchMarkCount}`);
    console.log('Check console for detailed logs from each system');
  },

  cleanupGroundEffects: () => {
    console.log('=== CLEANING UP ALL GROUND EFFECTS ===');

    // Clean up craters
    threatManager.clearAll();

    // Clean up scorch marks
    const launchEffects = threatManager.getLaunchEffectsSystem();
    launchEffects.cleanupOrphanedScorchMarks();

    // Scan scene for any ground-level meshes that might be leftover effects
    const groundEffects: THREE.Object3D[] = [];
    scene.traverse(child => {
      if (child instanceof THREE.Mesh && child.position.y < 0.1 && child.position.y >= 0) {
        // Check if it's a circular/ring geometry (likely a ground effect)
        const geo = child.geometry;
        if (geo && (geo.type === 'CircleGeometry' || geo.type === 'RingGeometry')) {
          groundEffects.push(child);
        }
      }
    });

    console.log(`Found ${groundEffects.length} potential ground effects in scene`);
    groundEffects.forEach((obj, index) => {
      console.log(`  ${index}: ${obj.type} at y=${obj.position.y.toFixed(3)}, name="${obj.name}"`);
    });

    // Remove them after confirmation
    if (groundEffects.length > 0 && confirm(`Remove ${groundEffects.length} ground effects?`)) {
      groundEffects.forEach(obj => {
        scene.remove(obj);
        if ((obj as THREE.Mesh).material) {
          ((obj as THREE.Mesh).material as THREE.Material).dispose();
        }
      });
      console.log('Removed ground effects');
    }

    // Also clean up orphaned dust rings from explosion manager
    const explosionManager = ExplosionManager.getInstance(scene);
    if (
      (explosionManager as any).instancedRenderer &&
      (explosionManager as any).instancedRenderer.cleanupOrphanedDustRings
    ) {
      (explosionManager as any).instancedRenderer.cleanupOrphanedDustRings();
    }

    console.log('Cleanup complete. Use "Debug Ground Effects" to verify.');
  },

  // Explosion test
  testExplosions: () => {
    const explosionManager = ExplosionManager.getInstance(scene);
    const count = 25; // Test with 25 simultaneous explosions

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const radius = 50 + Math.random() * 50;
      const position = new THREE.Vector3(
        Math.cos(angle) * radius,
        0, // Ground level for ground explosions
        Math.sin(angle) * radius
      );

      // Alternate between air and ground explosions
      const isGround = i % 2 === 0;
      if (!isGround) {
        position.y = 10 + Math.random() * 30; // Air explosions at height
      }

      explosionManager.createExplosion({
        type: isGround ? ExplosionType.GROUND_IMPACT : ExplosionType.AIR_INTERCEPTION,
        position,
        radius: 10 + Math.random() * 5,
      });

      // Don't create separate craters - ground explosions already have shockwaves
      // This was causing duplicate ground effects and z-fighting
    }

    const stats = explosionManager.getStats();
    const craterStats = threatManager.getCraterStats();
    showNotification(
      `Created ${count} explosions. Lights: ${stats.activeLights}/${stats.activeLights + stats.availableLights}, Shockwaves: ${stats.activeShockwaves}, Craters: ${craterStats.count}`
    );
  },
};

// Threat controls
const threatGroup = sandboxFolder.addFolder('Spawn Threats');
threatGroup.add(sandboxControls, 'spawnRocket').name('🚀 Spawn Rocket');
threatGroup.add(sandboxControls, 'spawnMortar').name('💣 Spawn Mortar');
threatGroup.add(sandboxControls, 'spawnDrone').name('🛸 Spawn Drone');
threatGroup.add(sandboxControls, 'spawnBallistic').name('🎯 Spawn Ballistic');
threatGroup.add(sandboxControls, 'clearAllThreats').name('🧹 Clear All Threats');

// Salvo controls
const salvoGroup = sandboxFolder.addFolder('Salvo Attack');
salvoGroup.add(sandboxControls, 'salvoSize', 2, 20, 1).name('Salvo Size');
salvoGroup
  .add(sandboxControls, 'salvoType', ['mixed', 'rocket', 'mortar', 'ballistic'])
  .name('Salvo Type');
salvoGroup.add(sandboxControls, 'launchSalvo').name('🎆 Launch Salvo');

// Battery controls
const batteryGroup = sandboxFolder.addFolder('Battery Management');
batteryGroup.add(sandboxControls, 'addRandomBattery').name('➕ Add Random Battery');
batteryGroup.add(sandboxControls, 'upgradeAllBatteries').name('⬆️ Upgrade All Batteries');

// Visual controls
const visualGroup = sandboxFolder.addFolder('Visual Settings');
visualGroup
  .add(sandboxControls, 'showRadarCoverage')
  .name('Show Radar Coverage')
  .onChange((value: boolean) => {
    if (radarNetwork) radarNetwork.setShowCoverage(value);
  });
visualGroup
  .add(sandboxControls, 'showTrajectories')
  .name('Show Trajectories')
  .onChange((value: boolean) => {
    simulationControls.showTrajectories = value;
  });
visualGroup
  .add(sandboxControls, 'timeScale', 0.1, 3.0, 0.1)
  .name('Time Scale')
  .onChange((value: number) => {
    simulationControls.timeScale = value;
  });

// World controls
const worldFolder = gui.addFolder('World Settings');

// Camera controls
const cameraControls = {
  mode: 'orbit',
  followThreat: () => {
    const threats = threatManager.getActiveThreats();
    if (threats.length > 0) {
      cameraController.setMode(CameraMode.FOLLOW_THREAT, threats[0]);
    }
  },
  followInterceptor: () => {
    if (projectiles.length > 0) {
      cameraController.setMode(CameraMode.FOLLOW_INTERCEPTOR, projectiles[0]);
    }
  },
  cinematicMode: () => cameraController.setMode(CameraMode.CINEMATIC),
  tacticalView: () => cameraController.setMode(CameraMode.TACTICAL),
  battleOverview: () => cameraController.setMode(CameraMode.BATTLE_OVERVIEW),
  orbitMode: () => cameraController.setMode(CameraMode.ORBIT),
};

const cameraFolder = worldFolder.addFolder('Camera');
cameraFolder
  .add(cameraControls, 'mode', [
    'orbit',
    'follow_threat',
    'follow_interceptor',
    'cinematic',
    'tactical',
    'battle_overview',
  ])
  .name('Camera Mode')
  .onChange((value: string) => {
    switch (value) {
      case 'follow_threat':
        cameraControls.followThreat();
        break;
      case 'follow_interceptor':
        cameraControls.followInterceptor();
        break;
      case 'cinematic':
        cameraControls.cinematicMode();
        break;
      case 'tactical':
        cameraControls.tacticalView();
        break;
      case 'battle_overview':
        cameraControls.battleOverview();
        break;
      default:
        cameraControls.orbitMode();
    }
  });
cameraFolder.add(cameraControls, 'followThreat').name('Follow Threat');
cameraFolder.add(cameraControls, 'followInterceptor').name('Follow Interceptor');

// Time of day controls
const timeControls = {
  timeSpeed: 1,
  currentTime: dayNightCycle.formatTime(),
  pause: false,
  setDawn: () => dayNightCycle.setDawn(),
  setNoon: () => dayNightCycle.setNoon(),
  setDusk: () => dayNightCycle.setDusk(),
  setMidnight: () => dayNightCycle.setMidnight(),
};

const timeFolder = worldFolder.addFolder('Time of Day');
timeFolder
  .add(timeControls, 'timeSpeed', 0, 60, 1)
  .name('Time Speed')
  .onChange((value: number) => {
    dayNightCycle.setTimeSpeed(value);
  });
timeFolder
  .add(timeControls, 'pause')
  .name('Pause Time')
  .onChange((value: boolean) => {
    if (value) dayNightCycle.pause();
    else dayNightCycle.resume();
  });
timeFolder.add(timeControls, 'setDawn').name('🌅 Dawn');
timeFolder.add(timeControls, 'setNoon').name('☀️ Noon');
timeFolder.add(timeControls, 'setDusk').name('🌇 Dusk');
timeFolder.add(timeControls, 'setMidnight').name('🌙 Midnight');

// World scale indicators controls
const indicatorControls = {
  showGrid: true,
  showDistanceMarkers: true,
  showReferenceObjects: true,
  showWindParticles: true,
  showAltitudeMarkers: true,
};

const indicatorFolder = worldFolder.addFolder('Scale Indicators');
indicatorFolder
  .add(indicatorControls, 'showGrid')
  .name('Show Grid')
  .onChange((value: boolean) => {
    worldScaleIndicators.setVisibility({ showGrid: value });
  });
indicatorFolder
  .add(indicatorControls, 'showDistanceMarkers')
  .name('Distance Markers')
  .onChange((value: boolean) => {
    worldScaleIndicators.setVisibility({ showDistanceMarkers: value });
  });
indicatorFolder
  .add(indicatorControls, 'showReferenceObjects')
  .name('Reference Objects')
  .onChange((value: boolean) => {
    worldScaleIndicators.setVisibility({ showReferenceObjects: value });
  });
indicatorFolder
  .add(indicatorControls, 'showWindParticles')
  .name('Wind Particles')
  .onChange((value: boolean) => {
    worldScaleIndicators.setVisibility({ showWindParticles: value });
  });
indicatorFolder
  .add(indicatorControls, 'showAltitudeMarkers')
  .name('Altitude Markers')
  .onChange((value: boolean) => {
    worldScaleIndicators.setVisibility({ showAltitudeMarkers: value });
  });

// Environment controls
const envControls = {
  windSpeed: 5,
  fogDensity: 1,
};

const envFolder = worldFolder.addFolder('Environment');
envFolder
  .add(envControls, 'windSpeed', 0, 20, 1)
  .name('Wind Speed')
  .onChange((value: number) => {
    environmentSystem.setWindSpeed(value);
  });
envFolder
  .add(envControls, 'fogDensity', 0, 2, 0.1)
  .name('Fog Density')
  .onChange((value: number) => {
    environmentSystem.setFogDensity(200 * value, 1000 / value);
  });

// Defense controls
const defenseGroup = sandboxFolder.addFolder('Defense Settings');
defenseGroup
  .add(sandboxControls, 'autoIntercept')
  .name('Auto Intercept')
  .onChange((value: boolean) => {
    simulationControls.autoIntercept = value;
  });
// Algorithms and coordination are now always enabled by default
// No need for controls as they are production-ready

// Performance testing controls
const testingGroup = sandboxFolder.addFolder('Performance Testing');
testingGroup.add(sandboxControls, 'testExplosions').name('💥 Test 25 Explosions');
testingGroup.add(sandboxControls, 'logCraterStats').name('📊 Log Crater Stats');
testingGroup.add(sandboxControls, 'logGroundEffects').name('🔍 Debug Ground Effects');
testingGroup.add(sandboxControls, 'cleanupGroundEffects').name('🧹 Cleanup Ground Effects');

// Sound controls
const soundFolder = gui.addFolder('Sound Settings');
const soundSystem = SoundSystem.getInstance();
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

// Apply initial settings to all batteries
domePlacementSystem.getAllBatteries().forEach(battery => {
  battery.setLaunchOffset(new THREE.Vector3(-2, 14.5, -0.1));
  battery.setLaunchDirection(new THREE.Vector3(0.3, 1.5, 0.1).normalize()); // More vertical launch angle
});

// Set radar model facing direction (90 degrees = +X)
if (radarNetwork) {
  const radarAngle = (90 * Math.PI) / 180;
  radarNetwork.setModelFacingDirection(
    new THREE.Vector3(Math.sin(radarAngle), 0, -Math.cos(radarAngle))
  );
}

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

// Function to hide loading screen with multiple fallbacks
function hideLoadingScreen() {
  const loadingEl = document.getElementById('loading');
  if (loadingEl && loadingEl.style.display !== 'none') {
    loadingEl.style.display = 'none';
    debug.log('Loading screen hidden');
  }
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

  try {
    // Preload the optimized Tamir models
    const modelCache = ModelCache.getInstance();
    await modelCache.preloadModels([
      'assets/tamir/scene_ultra_simple.glb',
      'assets/tamir/scene_simple.glb',
    ]);
    debug.log('Models preloaded successfully');
  } catch (error) {
    debug.error('Failed to preload models:', error);
  }

  // Hide loading screen
  hideLoadingScreen();
});

// Add timeout fallbacks for stubborn devices
setTimeout(hideLoadingScreen, 1000); // 1 second fallback
setTimeout(hideLoadingScreen, 3000); // 3 second fallback

// Animation loop
const clock = new THREE.Clock();
let previousTime = 0;

// Performance monitoring
const performanceMonitor = new PerformanceMonitor();
const profiler = new Profiler();
const profilerDisplay = new ProfilerDisplay(profiler);
const renderProfiler = new RenderProfiler(renderer);
renderProfiler.setProfiler(profiler);

// Apply saved profiler visibility
if (savedProfilerVisible === 'true') {
  profilerDisplay.show();
}

// Initialize stats.js displays
const statsDisplay = new StatsDisplay();
const extendedStatsDisplay = new ExtendedStatsDisplay();

// Connect systems to stats displays
statsDisplay.setInterceptionSystem(interceptionSystem);
statsDisplay.setThreatManager(threatManager);
extendedStatsDisplay.setInterceptionSystem(interceptionSystem);
extendedStatsDisplay.setThreatManager(threatManager);

// Hide stats.js if profiler is not visible
if (!profilerDisplay.isVisible()) {
  statsDisplay.hide();
}

// Keyboard event handlers
window.addEventListener('keydown', e => {
  // S key toggles extended stats
  if (e.key === 's' || e.key === 'S') {
    extendedStatsDisplay.toggleVisibility();
  }

  // P key toggles profiler AND stats.js
  if (e.key === 'p' || e.key === 'P') {
    const profilerVisible = profilerDisplay.isVisible();
    if (profilerVisible) {
      statsDisplay.show();
    } else {
      statsDisplay.hide();
    }
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

// Render bottleneck tracking
let frameCount = 0;
let renderBottleneckLogged = false;

function animate() {
  animationId = requestAnimationFrame(animate);

  // Begin stats.js frame tracking
  statsDisplay.beginFrame();

  // Store camera reference for LOD optimizations and health bar orientation
  (scene as any).__camera = camera;

  profiler.startSection('Frame');

  const deltaTime = clock.getDelta();
  const currentTime = clock.getElapsedTime();
  const fps = 1 / deltaTime;

  // Update performance monitor
  profiler.startSection('Performance Monitor');
  performanceMonitor.update(fps);
  const perfStats = performanceMonitor.getStats();
  profiler.endSection('Performance Monitor');

  // Adjust quality based on performance
  if (perfStats.isCritical) {
    // Skip tactical display updates in critical performance situations
    // Will be handled by reducing update frequency
  }

  // Mobile-specific dynamic quality adjustment
  if (deviceInfo.isMobile || deviceInfo.isTablet) {
    deviceCaps.adjustQualityForFPS(fps);

    // Adjust max interceptors based on performance
    const maxInterceptors = deviceCaps.getMaxSimultaneousInterceptors();
    if (interceptionSystem.getActiveInterceptorCount() >= maxInterceptors) {
      battery.getConfig().interceptorLimit = maxInterceptors;
    }
  }

  // Get active threats (needed for rendering even when paused)
  const activeThreats = threatManager.getActiveThreats();

  // Update world systems
  profiler.startSection('World Systems');

  // Update environment
  environmentSystem.update(deltaTime);

  // Update day/night cycle
  if (!simulationControls.pause) {
    dayNightCycle.update(deltaTime);
  }

  // Update world scale indicators with wind
  const windVector = environmentSystem.getWindAt(new THREE.Vector3(0, 50, 0));
  worldScaleIndicators.update(deltaTime, windVector);

  // Update battlefield zones
  if (battlefieldZones) battlefieldZones.update(deltaTime);

  // Update camera controller with all interceptors
  const allInterceptors = [...projectiles, ...interceptionSystem.getActiveInterceptors()];
  cameraController.update(deltaTime, activeThreats, allInterceptors);

  profiler.endSection('World Systems');

  // Update game systems only when not paused
  if (!simulationControls.pause) {
    // Update physics with time scale
    profiler.startSection('Physics');
    const scaledDelta = deltaTime * simulationControls.timeScale;
    world.step(1 / 60, scaledDelta, 3);
    profiler.endSection('Physics');

    // Update threat manager
    profiler.startSection('Threat Manager');
    threatManager.update();
    profiler.endSection('Threat Manager');

    // Update all batteries (includes health bar orientation and reloading)
    profiler.startSection('Batteries Update');
    const allBatteries = domePlacementSystem.getAllBatteries();

    // Apply auto-repair based on upgrade level
    const autoRepairLevel = gameState.getAutoRepairLevel();
    const repairRates = [0, 0.5, 1.0, 2.0]; // Health per second for each level

    allBatteries.forEach(battery => {
      battery.setAutoRepairRate(repairRates[autoRepairLevel]);
      battery.update(deltaTime, activeThreats);
    });
    profiler.endSection('Batteries Update');

    // Update radar network - pass threats directly instead of mapping
    if (activeThreats.length > 0) {
      profiler.startSection('Radar Network');
      if (radarNetwork) radarNetwork.update(activeThreats);
      profiler.endSection('Radar Network');
    }

    // Update projectiles
    profiler.startSection('Projectiles');
    const projectileCount = projectiles.length;
    if (projectileCount > 0) {
      profiler.startSection(`Update ${projectileCount} projectiles`);
      for (let i = projectiles.length - 1; i >= 0; i--) {
        const projectile = projectiles[i];
        projectile.update();

        // Remove projectiles that fall below ground
        if (projectile.body.position.y < -10) {
          // Remove from trail renderer
          instancedTrailRenderer.removeTrail(projectile);
          projectile.destroy(scene, world);
          projectiles.splice(i, 1);
        }
      }
      profiler.endSection(`Update ${projectileCount} projectiles`);
    }
    profiler.endSection('Projectiles');
  }

  // Update interception system and other systems
  let systemInterceptors: Projectile[] = [];

  if (!simulationControls.pause) {
    if (simulationControls.autoIntercept) {
      profiler.startSection('Interception System');
      interceptionSystem.setProfiler(profiler); // Pass profiler for detailed tracking
      systemInterceptors = interceptionSystem.update(activeThreats);
      profiler.endSection('Interception System');
    }

    // Update dome placement system (for instanced rendering)
    profiler.startSection('Dome Placement Update');
    domePlacementSystem.update();
    profiler.endSection('Dome Placement Update');

    // Update instanced renderers (visual updates should continue when paused for smooth rendering)
    if (useInstancedRendering) {
      profiler.startSection('Instanced Rendering Update');

      // Update threats
      if (useLODRendering) {
        lodInstancedThreatRenderer.updateThreats(activeThreats, currentTime * 1000);
      } else {
        instancedThreatRenderer.updateThreats(activeThreats);
      }

      // Update interceptors (combine all projectiles)
      const allInterceptors = [...projectiles, ...systemInterceptors];
      instancedProjectileRenderer.updateProjectiles(allInterceptors);

      // Update debris
      instancedDebrisRenderer.update(deltaTime);

      // Update explosions
      instancedExplosionRenderer.update();
      
      // Update batched trails
      instancedTrailRenderer.update();

      profiler.endSection('Instanced Rendering Update');
    }
  } else {
    // When paused, still update visual positions for rendering
    if (useInstancedRendering) {
      if (useLODRendering) {
        lodInstancedThreatRenderer.updateThreats(activeThreats, currentTime * 1000);
      } else {
        instancedThreatRenderer.updateThreats(activeThreats);
      }

      const allInterceptors = [...projectiles, ...systemInterceptors];
      instancedProjectileRenderer.updateProjectiles(allInterceptors);
    }
  }

  // Update GUI at 30 Hz (33ms) for smooth tactical display
  if (currentTime - previousTime > 0.033) {
    profiler.startSection('GUI Update');
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
      totalLoaded += battery.getInterceptorCount();
      totalCapacity += battery.getConfig().launcherCount;
    });

    // Battery info is now displayed in the UI, not in debug controls

    // Update tactical display only if performance allows
    if (!perfStats.isCritical) {
      profiler.startSection('Tactical Display');
      const displayPosition =
        allBatteries.length > 0 ? allBatteries[0].getPosition() : new THREE.Vector3(0, 0, 0);

      tacticalDisplay.update(
        activeThreats,
        displayPosition,
        totalLoaded,
        0.95, // Default success rate
        totalCapacity // Total launcher capacity
      );
      profiler.endSection('Tactical Display');
    }

    // Check for performance warnings
    const perfCheck = performanceMonitor.checkPerformance();
    if (perfCheck.warning) {
      debug.warn(perfCheck.message);
    }

    profiler.endSection('GUI Update');
    previousTime = currentTime;
  }

  // Update controls
  profiler.startSection('Controls');
  controls.update();
  profiler.endSection('Controls');

  // Update sound system listener position
  const soundSystem = SoundSystem.getInstance();
  soundSystem.updateListenerPosition({
    x: camera.position.x,
    y: camera.position.y,
    z: camera.position.z,
  });

  // Update listener orientation based on camera
  const cameraDirection = new THREE.Vector3();
  camera.getWorldDirection(cameraDirection);
  soundSystem.updateListenerOrientation(
    { x: cameraDirection.x, y: cameraDirection.y, z: cameraDirection.z },
    { x: camera.up.x, y: camera.up.y, z: camera.up.z }
  );

  // Update centralized systems
  profiler.startSection('Centralized Systems');

  // Update explosion manager
  ExplosionManager.getInstance(scene).update(deltaTime);

  // Update unified trail system
  UnifiedTrailSystem.getInstance(scene).update(deltaTime, camera);

  profiler.endSection('Centralized Systems');

  // Render
  profiler.startSection('Render');
  renderProfiler.profiledRender(scene, camera);
  profiler.endSection('Render');

  // Update profiler display
  profiler.endSection('Frame');
  profilerDisplay.setRenderStats(renderProfiler.getLastStats());
  profilerDisplay.update();

  // End stats.js frame and update extended stats
  statsDisplay.endFrame();
  extendedStatsDisplay.update();

  // Log render bottleneck analysis periodically
  frameCount++;
  if (!renderBottleneckLogged && frameCount > 120 && frameCount % 60 === 0) {
    const averages = profiler.getAverages();
    const renderTime = averages.get('Render') || 0;
    const frameTime = averages.get('Frame') || 0;

    if (renderTime > 5 && renderTime / frameTime > 0.8) {
      renderBottleneckLogged = true;
      debug.log('=== RENDER BOTTLENECK ANALYSIS ===');
      debug.performance('Render time', renderTime);
      debug.log(`Render is ${((renderTime / frameTime) * 100).toFixed(0)}% of frame time`);

      // Count active effects
      let exhaustTrailCount = 0;
      let particleSystemCount = 0;
      let meshCount = 0;
      let transparentCount = 0;

      scene.traverse(obj => {
        if (obj instanceof THREE.Mesh) {
          meshCount++;
          if (obj.material && (obj.material as any).transparent) transparentCount++;
        } else if (obj instanceof THREE.Points) {
          particleSystemCount++;
        }
      });

      // Count exhaust trails
      const allProjectiles = [...projectiles, ...systemInterceptors];
      allProjectiles.forEach(p => {
        if (p.exhaustTrail) exhaustTrailCount++;
      });

      debug.category('Scene', 'Contents:', {
        meshes: meshCount,
        particleSystems: particleSystemCount,
        transparentObjects: transparentCount,
        exhaustTrails: exhaustTrailCount,
        threats: activeThreats.length,
        interceptors: systemInterceptors.length,
      });

      debug.log('Check profiler (P key) for detailed breakdown');
      debug.log('================================');
    }
  }

  profiler.endFrame();
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
let isOrientationLocked = false;

function checkOrientation() {
  const orientationOverlay = document.getElementById('orientation-overlay');
  if (!orientationOverlay) return false;

  // Only check on small mobile devices
  const isSmallMobile = window.innerWidth <= 768 && deviceInfo.isMobile;
  const isPortrait = window.innerHeight > window.innerWidth;

  const shouldLock = isSmallMobile && isPortrait;

  if (shouldLock && !isOrientationLocked) {
    // Lock orientation - pause game
    isOrientationLocked = true;
    orientationOverlay.classList.add('active');
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
    // Pause game systems
    simulationControls.pause = true;
    if (waveManager) waveManager.pauseWave();
    debug.log('Orientation locked - game paused');
  } else if (!shouldLock && isOrientationLocked) {
    // Unlock orientation - resume game
    isOrientationLocked = false;
    orientationOverlay.classList.remove('active');
    if (!animationId) {
      animate(); // Restart animation loop
    }
    // Resume game systems
    simulationControls.pause = false;
    if (waveManager && simulationControls.gameMode) waveManager.resumeWave();
    debug.log('Orientation unlocked - game resumed');
  }

  return shouldLock;
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
  console.log('Inspector mode enabled');

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

// Start the animation loop only if not orientation locked
if (!isLocked) {
  animate();
}

// Final fallback after animation starts
setTimeout(hideLoadingScreen, 100);
