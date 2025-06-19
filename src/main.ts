import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import * as CANNON from 'cannon-es'
import GUI from 'lil-gui'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Projectile } from './entities/Projectile'
import { ThreatManager } from './scene/ThreatManager'
import { TrajectoryCalculator } from './utils/TrajectoryCalculator'
import { IronDomeBattery } from './entities/IronDomeBattery'
import { InterceptionSystem } from './scene/InterceptionSystem'
import { StaticRadarNetwork } from './scene/StaticRadarNetwork'
import { TacticalDisplay } from './ui/TacticalDisplay'
import { PerformanceMonitor } from './utils/PerformanceMonitor'
import { Profiler } from './utils/Profiler'
import { ProfilerDisplay } from './ui/ProfilerDisplay'
import { RenderProfiler } from './utils/RenderProfiler'
import { ModelCache } from './utils/ModelCache'
import { debug } from './utils/DebugLogger'
import { MobileInputManager } from './input/MobileInputManager'
import { DeviceCapabilities } from './utils/DeviceCapabilities'
import { ResponsiveUI } from './ui/ResponsiveUI'
import { GameState } from './game/GameState'
import { WaveManager } from './game/WaveManager'
import { ResourceManager } from './game/ResourceManager'
import { DomePlacementSystem } from './game/DomePlacementSystem'
import { GameUI } from './ui/GameUI'

// Initialize device capabilities
const deviceCaps = DeviceCapabilities.getInstance()
const deviceInfo = deviceCaps.getDeviceInfo()
const perfProfile = deviceCaps.getPerformanceProfile()

debug.log('Device detected:', {
  type: deviceInfo.isMobile ? 'Mobile' : deviceInfo.isTablet ? 'Tablet' : 'Desktop',
  gpu: deviceInfo.gpu,
  targetFPS: perfProfile.targetFPS
})

// Scene setup
const scene = new THREE.Scene()

// Create gradient background for better visibility
const canvas = document.createElement('canvas')
canvas.width = 1
canvas.height = 512
const context = canvas.getContext('2d')!
const gradient = context.createLinearGradient(0, 0, 0, 512)
gradient.addColorStop(0, '#0a1929') // Very dark blue at top
gradient.addColorStop(0.3, '#1e3c72') // Dark blue
gradient.addColorStop(0.6, '#2a5298') // Medium blue
gradient.addColorStop(1, '#5a7ba6') // Lighter blue at horizon
context.fillStyle = gradient
context.fillRect(0, 0, 1, 512)

const gradientTexture = new THREE.CanvasTexture(canvas)
gradientTexture.needsUpdate = true

// Apply gradient as background
scene.background = gradientTexture
scene.fog = new THREE.Fog(0x2a5298, 200, 1000) // Darker fog for atmosphere

// Camera setup
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  2000  // Increased far plane
)
camera.position.set(100, 60, 100)  // Moved camera further back
camera.lookAt(0, 0, 0)

// Renderer setup with device-specific settings
const renderer = new THREE.WebGLRenderer({ 
  antialias: !deviceInfo.isMobile, // Disable antialiasing on mobile
  powerPreference: deviceInfo.isMobile ? 'low-power' : 'high-performance'
})

// Apply render scale for performance
const renderScale = deviceCaps.getRenderScale()
renderer.setSize(window.innerWidth * renderScale, window.innerHeight * renderScale)
renderer.domElement.style.width = window.innerWidth + 'px'
renderer.domElement.style.height = window.innerHeight + 'px'

// Adjust pixel ratio for mobile
const maxPixelRatio = deviceInfo.isMobile ? 2 : window.devicePixelRatio
renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio))

// Shadow settings based on device
renderer.shadowMap.enabled = deviceCaps.shouldEnableShadows()
if (renderer.shadowMap.enabled) {
  renderer.shadowMap.type = perfProfile.shadowQuality === 'high' 
    ? THREE.PCFSoftShadowMap 
    : THREE.PCFShadowMap
}

document.body.appendChild(renderer.domElement)

// Controls
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.dampingFactor = 0.05
controls.minDistance = 10
controls.maxDistance = 500  // Increased max distance
controls.maxPolarAngle = Math.PI / 2 - 0.1 // Prevent going below ground

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
scene.add(ambientLight)

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
directionalLight.position.set(50, 100, 50)
directionalLight.castShadow = true
directionalLight.shadow.camera.left = -100
directionalLight.shadow.camera.right = 100
directionalLight.shadow.camera.top = 100
directionalLight.shadow.camera.bottom = -100
directionalLight.shadow.camera.near = 0.1
directionalLight.shadow.camera.far = 200

// Adjust shadow map size based on device
const shadowMapSize = deviceInfo.isMobile ? 1024 : perfProfile.shadowQuality === 'high' ? 2048 : 1536
directionalLight.shadow.mapSize.width = shadowMapSize
directionalLight.shadow.mapSize.height = shadowMapSize

scene.add(directionalLight)

// Ground
const groundGeometry = new THREE.PlaneGeometry(400, 400)
const groundMaterial = new THREE.MeshStandardMaterial({ 
  color: 0x3a5f3a,
  roughness: 0.8,
  metalness: 0.2
})
const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial)
groundMesh.rotation.x = -Math.PI / 2
groundMesh.receiveShadow = true
scene.add(groundMesh)

// Grid helper
const gridHelper = new THREE.GridHelper(400, 40, 0x000000, 0x000000)
gridHelper.material.opacity = 0.2
gridHelper.material.transparent = true
scene.add(gridHelper)

// Axes helper (for debugging) - commented out for production
// const axesHelper = new THREE.AxesHelper(10)
// scene.add(axesHelper)

// Physics world
const world = new CANNON.World({
  gravity: new CANNON.Vec3(0, -9.82, 0)
})
world.broadphase = new CANNON.SAPBroadphase(world)
world.allowSleep = true

// Ground physics body
const groundShape = new CANNON.Box(new CANNON.Vec3(200, 0.1, 200))
const groundBody = new CANNON.Body({
  type: CANNON.Body.STATIC,
  shape: groundShape,
  position: new CANNON.Vec3(0, -0.1, 0)
})
world.addBody(groundBody)

// Initialize game systems
const gameState = GameState.getInstance()
const resourceManager = ResourceManager.getInstance()

// Threat Manager
const threatManager = new ThreatManager(scene, world)

// Static Radar Network (4 corners) with large coverage for high altitude
const radarNetwork = new StaticRadarNetwork(scene, 300)  // 300m radius for high altitude coverage

// Dome Placement System
const domePlacementSystem = new DomePlacementSystem(scene, world)
domePlacementSystem.setThreatManager(threatManager)

// Interception System
const interceptionSystem = new InterceptionSystem(scene, world)
interceptionSystem.setThreatManager(threatManager)

// Connect all systems
domePlacementSystem.setInterceptionSystem(interceptionSystem)
domePlacementSystem.setRadarNetwork(radarNetwork)

// Add all batteries from placement system to interception system
const batteries = domePlacementSystem.getAllBatteries()
batteries.forEach(battery => {
  battery.setResourceManagement(true)
  battery.setRadarNetwork(radarNetwork)
  interceptionSystem.addBattery(battery)
  threatManager.registerBattery(battery)
})

// Wave Manager
const waveManager = new WaveManager(threatManager)

// Tactical Display
const tacticalDisplay = new TacticalDisplay()

// Initial render of tactical display with default values
tacticalDisplay.update([], new THREE.Vector3(0, 0, 0), 20, 0.95, 20)

// Projectile management
let projectiles: Projectile[] = []

// Simulation controls (must be defined before UI)
const simulationControls = {
  gameMode: true,  // Enable game mode by default
  autoIntercept: true,
  pause: false,
  timeScale: 1.0,
  showTrajectories: true,
  enableFog: false,
  interceptorModel: 'ultra',  // 'none', 'ultra', 'simple'
  startGame: () => {
    // Clear any existing projectiles
    projectiles.forEach(p => p.destroy(scene, world))
    projectiles = []
    // Start the wave manager
    waveManager.startGame()
  },
  resetGame: () => {
    gameState.startNewGame()
    threatManager.clearAll()
    projectiles.forEach(p => p.destroy(scene, world))
    projectiles = []
    // Recreate initial setup
    location.reload() // Simple reload for now
  }
}

// Create React UI
const uiContainer = document.createElement('div')
uiContainer.id = 'game-ui-root'
document.body.appendChild(uiContainer)

const uiRoot = createRoot(uiContainer)

// Function to update UI when mode changes
const updateUIMode = () => {
  uiRoot.render(
    React.createElement(GameUI, {
      waveManager: waveManager,
      placementSystem: domePlacementSystem,
      isGameMode: simulationControls.gameMode,
      onModeChange: (gameMode: boolean) => {
        simulationControls.gameMode = gameMode
        if (gameMode) {
          // Switch to game mode
          threatManager.stopSpawning()
          gui.hide() // Hide debug controls in game mode
          // Don't auto-start, wait for user to click start
        } else {
          // Switch to sandbox mode  
          waveManager.pauseWave()
          threatManager.setThreatMix('mixed')
          threatManager.startSpawning()
          gui.show() // Show debug controls in sandbox mode
        }
        updateUIMode() // Re-render UI
      }
    })
  )
}

// Initial render
updateUIMode()

// GUI
const gui = new GUI()
// Start minimized on mobile
if (deviceInfo.isMobile) {
  gui.close()
}
// Hide GUI in game mode by default
if (simulationControls.gameMode) {
  gui.hide()
}

// Apply responsive UI
const responsiveUI = new ResponsiveUI(gui)

// Handle dome placement input
renderer.domElement.addEventListener('click', (event) => {
  if (domePlacementSystem.isInPlacementMode()) {
    const mouse = new THREE.Vector2(
      (event.clientX / window.innerWidth) * 2 - 1,
      -(event.clientY / window.innerHeight) * 2 + 1
    )
    
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(mouse, camera)
    
    const intersects = raycaster.intersectObject(groundMesh)
    if (intersects.length > 0) {
      domePlacementSystem.attemptPlacement(intersects[0].point)
    }
  }
})

// Mouse move for desktop
renderer.domElement.addEventListener('mousemove', (event) => {
  if (domePlacementSystem.isInPlacementMode()) {
    const mouse = new THREE.Vector2(
      (event.clientX / window.innerWidth) * 2 - 1,
      -(event.clientY / window.innerHeight) * 2 + 1
    )
    
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(mouse, camera)
    
    const intersects = raycaster.intersectObject(groundMesh)
    if (intersects.length > 0) {
      domePlacementSystem.updatePlacementPreview(intersects[0].point)
    }
  }
})

// Touch move for mobile dome placement preview
renderer.domElement.addEventListener('touchmove', (event) => {
  if (domePlacementSystem.isInPlacementMode() && event.touches.length === 1) {
    event.preventDefault()
    const touch = event.touches[0]
    const mouse = new THREE.Vector2(
      (touch.clientX / window.innerWidth) * 2 - 1,
      -(touch.clientY / window.innerHeight) * 2 + 1
    )
    
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(mouse, camera)
    
    const intersects = raycaster.intersectObject(groundMesh)
    if (intersects.length > 0) {
      domePlacementSystem.updatePlacementPreview(intersects[0].point)
    }
  }
}, { passive: false })

// Initialize mobile input if on touch device
let mobileInput: MobileInputManager | null = null
if (deviceInfo.hasTouch) {
  mobileInput = new MobileInputManager(camera, controls, renderer.domElement)
  
  // Set up tap for dome placement or interceptor launch
  mobileInput.onTap((position) => {
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(position, camera)
    
    // Check if in dome placement mode first
    if (domePlacementSystem.isInPlacementMode()) {
      const groundIntersects = raycaster.intersectObject(groundMesh)
      if (groundIntersects.length > 0) {
        domePlacementSystem.attemptPlacement(groundIntersects[0].point)
        // Haptic feedback for placement
        if (mobileInput) mobileInput.vibrate(30)
      }
      return
    }
    
    // Otherwise check for threats to intercept
    const threats = threatManager.getActiveThreats()
    let targetThreat: any = null
    
    // Check for direct threat intersection
    threats.forEach(threat => {
      const intersects = raycaster.intersectObject(threat.mesh, true)
      if (intersects.length > 0 && !targetThreat) {
        targetThreat = threat
      }
    })
    
    // If no direct hit, find nearest threat to ground intersection
    if (!targetThreat) {
      const groundIntersects = raycaster.intersectObject(groundMesh)
      if (groundIntersects.length > 0) {
        const worldPos = groundIntersects[0].point
        let minDistance = Infinity
        
        threats.forEach(threat => {
          const distance = threat.getPosition().distanceTo(worldPos)
          if (distance < minDistance && distance < 50) { // Within 50m of tap
            minDistance = distance
            targetThreat = threat
          }
        })
      }
    }
    
    // Launch interceptor at target threat if found
    if (targetThreat && simulationControls.autoIntercept) {
      // Find best battery to intercept
      const batteries = domePlacementSystem.getAllBatteries()
      let interceptorFired = false
      
      for (const battery of batteries) {
        if (battery.canIntercept(targetThreat)) {
          const interceptor = battery.fireInterceptor(targetThreat)
          if (interceptor) {
            responsiveUI.showNotification('Interceptor Launched!', 1500)
            // Add haptic feedback for successful launch
            mobileInput.vibrate(20)
            interceptorFired = true
            break
          }
        }
      }
      
      if (!interceptorFired) {
        responsiveUI.showNotification('Cannot Intercept', 1000)
      }
    } else if (!targetThreat) {
      responsiveUI.showNotification('No threat in range', 1000)
    }
  })
  
  // Long press for threat info
  mobileInput.onLongPress((position) => {
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(position, camera)
    
    // Check for threat intersection
    const threats = threatManager.getActiveThreats()
    threats.forEach(threat => {
      const intersects = raycaster.intersectObject(threat.mesh)
      if (intersects.length > 0) {
        const info = `Threat ${threat.id}\nAltitude: ${Math.round(threat.getPosition().y)}m\nSpeed: ${Math.round(threat.getVelocity().length())}m/s`
        responsiveUI.showNotification(info, 3000)
      }
    })
  })
  
  // Add a fire button for mobile
  const fireButton = responsiveUI.createMobileButton('🚀 FIRE', () => {
    // Fire at the highest priority threat
    const threats = threatManager.getActiveThreats()
    if (threats.length > 0) {
      // Sort by time to impact
      const sortedThreats = threats.sort((a, b) => {
        const timeA = a.getTimeToImpact()
        const timeB = b.getTimeToImpact()
        return timeA - timeB
      })
      
      // Find best battery to intercept
      const batteries = domePlacementSystem.getAllBatteries()
      let interceptorFired = false
      
      for (const battery of batteries) {
        if (battery.canIntercept(sortedThreats[0])) {
          const interceptor = battery.fireInterceptor(sortedThreats[0])
          if (interceptor) {
            responsiveUI.showNotification('Interceptor Launched!', 1500)
            mobileInput.vibrate(30)
            interceptorFired = true
            break
          }
        }
      }
      
      if (!interceptorFired) {
        responsiveUI.showNotification('No interceptors available', 1500)
      }
    } else {
      responsiveUI.showNotification('No threats detected', 1000)
    }
  })
  
  fireButton.style.bottom = '100px'  // Move up to avoid bottom controls
  fireButton.style.right = '20px'
  document.body.appendChild(fireButton)
}

const debugFolder = gui.addFolder('Debug')
const debugInfo = {
  fps: 0,
  threats: 0,
  interceptors: 0,
  interceptions: 0,
  successRate: 0,
  showRadarCoverage: false
}
debugFolder.add(debugInfo, 'fps').listen().disable()
debugFolder.add(debugInfo, 'threats').listen().disable()
debugFolder.add(debugInfo, 'interceptors').listen().disable()
debugFolder.add(debugInfo, 'interceptions').listen().disable()
debugFolder.add(debugInfo, 'successRate').listen().disable()
debugFolder.add(debugInfo, 'showRadarCoverage').name('Show Radar Coverage').onChange((value: boolean) => {
  radarNetwork.setShowCoverage(value)
})
debugFolder.add({ profiler: '⚡ Press P for Performance Profiler' }, 'profiler').disable()
if (debug.isEnabled()) {
  debugFolder.add({ debugUrl: '🐛 Debug mode active (add ?debug to URL)' }, 'debugUrl').disable()
} else {
  debugFolder.add({ debugUrl: '💡 Add ?debug to URL for debug logs' }, 'debugUrl').disable()
}


// No longer need game controls in GUI - they're in the UI now

const simulationFolder = gui.addFolder('Simulation')

// Apply initial settings to all batteries
domePlacementSystem.getAllBatteries().forEach(battery => {
  battery.setLaunchOffset(new THREE.Vector3(-2, 14.5, -0.1))
  battery.setLaunchDirection(new THREE.Vector3(0.6, 1, 0.15).normalize())
})

// Set radar model facing direction (90 degrees = +X)
const radarAngle = (90 * Math.PI) / 180
radarNetwork.setModelFacingDirection(new THREE.Vector3(
  Math.sin(radarAngle),
  0,
  -Math.cos(radarAngle)
))

simulationFolder.add(simulationControls, 'autoIntercept').name('Auto Intercept')
simulationFolder.add(simulationControls, 'pause').name('Pause Simulation').onChange((value: boolean) => {
  if (value) {
    waveManager.pauseWave()
  } else {
    waveManager.resumeWave()
  }
})
simulationFolder.add(simulationControls, 'timeScale', 0.1, 3.0, 0.1).name('Time Scale')
simulationFolder.add(simulationControls, 'showTrajectories').name('Show Trajectories')
simulationFolder.add(simulationControls, 'enableFog').name('Enable Fog').onChange((value: boolean) => {
  if (value) {
    scene.fog = new THREE.Fog(0x2a5298, 100, 800)
  } else {
    scene.fog = null
  }
})
simulationFolder.add(simulationControls, 'interceptorModel', ['none', 'ultra', 'simple']).name('Interceptor Model').onChange((value: string) => {
  // Store preference globally for new interceptors
  ;(window as any).__interceptorModelQuality = value
})

// Start game mode by default
if (simulationControls.gameMode) {
  // Don't start immediately - wait for user to click start
  debug.log('Game mode ready - click Start New Game to begin')
} else {
  // Sandbox mode - start spawning threats
  threatManager.setThreatMix('mixed')
  threatManager.startSpawning()
}

const batteryFolder = gui.addFolder('Battery Network')
const batteryInfo = {
  totalBatteries: 1,
  totalLoadedTubes: 20,
  totalReloading: 0,
  totalInterceptors: 100,
  placementInfo: '1/1 placed'
}
batteryFolder.add(batteryInfo, 'totalBatteries').listen().disable().name('Active Batteries')
batteryFolder.add(batteryInfo, 'totalLoadedTubes').listen().disable().name('Total Loaded Tubes')
batteryFolder.add(batteryInfo, 'totalReloading').listen().disable().name('Total Reloading')
batteryFolder.add(batteryInfo, 'totalInterceptors').listen().disable().name('Interceptor Stock')
batteryFolder.add(batteryInfo, 'placementInfo').listen().disable().name('Placement Status')

const launchFolder = gui.addFolder('Manual Launch')
const launchParams = {
  velocity: 50,
  angle: 45,
  launch: () => launchProjectile()
}
launchFolder.add(launchParams, 'velocity', 10, 150, 1).name('Velocity (m/s)')
launchFolder.add(launchParams, 'angle', 0, 90, 1).name('Angle (degrees)')
launchFolder.add(launchParams, 'launch').name('Launch Interceptor')
launchFolder.open()

function launchProjectile() {
  const position = new THREE.Vector3(-50, 1, 0)
  const angleRad = (launchParams.angle * Math.PI) / 180
  const velocity = new THREE.Vector3(
    launchParams.velocity * Math.cos(angleRad),
    launchParams.velocity * Math.sin(angleRad),
    0
  )
  
  const projectile = new Projectile(scene, world, {
    position,
    velocity,
    color: 0x0038b8,
    radius: 0.3,
    mass: 10,
    trailLength: 150
  })
  
  projectiles.push(projectile)
  
  // Show predicted trajectory
  showTrajectoryPrediction(position, velocity)
}

function showTrajectoryPrediction(position: THREE.Vector3, velocity: THREE.Vector3) {
  const points = TrajectoryCalculator.predictTrajectory(position, velocity)
  
  const geometry = new THREE.BufferGeometry().setFromPoints(points)
  const material = new THREE.LineBasicMaterial({
    color: 0x0038b8,
    opacity: 0.3,
    transparent: true
  })
  
  const line = new THREE.Line(geometry, material)
  scene.add(line)
  
  // Remove after 5 seconds
  setTimeout(() => {
    scene.remove(line)
    geometry.dispose()
    material.dispose()
  }, 5000)
}

// Window resize handler
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  
  // Apply render scale for performance
  const renderScale = deviceCaps.getRenderScale()
  renderer.setSize(window.innerWidth * renderScale, window.innerHeight * renderScale)
  renderer.domElement.style.width = window.innerWidth + 'px'
  renderer.domElement.style.height = window.innerHeight + 'px'
}
window.addEventListener('resize', onWindowResize)

// Function to hide loading screen with multiple fallbacks
function hideLoadingScreen() {
  const loadingEl = document.getElementById('loading')
  if (loadingEl && loadingEl.style.display !== 'none') {
    loadingEl.style.display = 'none'
    debug.log('Loading screen hidden')
  }
}

// Check if document is already loaded (for iPad/iOS)
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  // Document already loaded, hide immediately
  setTimeout(hideLoadingScreen, 100)
}

// Also listen for DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(hideLoadingScreen, 100)
})

// Preload models and hide loading screen when ready
window.addEventListener('load', async () => {
  // Set initial model quality preference
  ;(window as any).__interceptorModelQuality = simulationControls.interceptorModel
  
  try {
    // Preload the optimized Tamir models
    const modelCache = ModelCache.getInstance()
    await modelCache.preloadModels([
      'assets/tamir/scene_ultra_simple.glb',
      'assets/tamir/scene_simple.glb'
    ])
    debug.log('Models preloaded successfully')
  } catch (error) {
    debug.error('Failed to preload models:', error)
  }
  
  // Hide loading screen
  hideLoadingScreen()
})

// Add timeout fallbacks for stubborn devices
setTimeout(hideLoadingScreen, 1000) // 1 second fallback
setTimeout(hideLoadingScreen, 3000) // 3 second fallback

// Animation loop
const clock = new THREE.Clock()
let previousTime = 0

// Performance monitoring
const performanceMonitor = new PerformanceMonitor()
const profiler = new Profiler()
const profilerDisplay = new ProfilerDisplay(profiler)
const renderProfiler = new RenderProfiler(renderer)
renderProfiler.setProfiler(profiler)

// Render bottleneck tracking
let frameCount = 0
let renderBottleneckLogged = false

function animate() {
  animationId = requestAnimationFrame(animate)
  
  // Store camera reference for LOD optimizations and health bar orientation
  ;(scene as any).__camera = camera
  
  profiler.startSection('Frame')

  const deltaTime = clock.getDelta()
  const currentTime = clock.getElapsedTime()
  const fps = 1 / deltaTime

  // Update performance monitor
  profiler.startSection('Performance Monitor')
  performanceMonitor.update(fps)
  const perfStats = performanceMonitor.getStats()
  profiler.endSection('Performance Monitor')
  
  
  // Adjust quality based on performance
  if (perfStats.isCritical) {
    // Skip tactical display updates in critical performance situations
    // Will be handled by reducing update frequency
  }
  
  // Mobile-specific dynamic quality adjustment
  if (deviceInfo.isMobile || deviceInfo.isTablet) {
    deviceCaps.adjustQualityForFPS(fps)
    
    // Adjust max interceptors based on performance
    const maxInterceptors = deviceCaps.getMaxSimultaneousInterceptors()
    if (interceptionSystem.getActiveInterceptorCount() >= maxInterceptors) {
      battery.getConfig().interceptorLimit = maxInterceptors
    }
  }

  // Update physics with time scale and pause
  if (!simulationControls.pause) {
    profiler.startSection('Physics')
    const scaledDelta = deltaTime * simulationControls.timeScale
    world.step(1 / 60, scaledDelta, 3)
    profiler.endSection('Physics')
  }

  // Update threat manager
  profiler.startSection('Threat Manager')
  threatManager.update()
  profiler.endSection('Threat Manager')
  
  // Cache active threats to avoid multiple calls
  const activeThreats = threatManager.getActiveThreats()
  
  // Update all batteries (includes health bar orientation and reloading)
  profiler.startSection('Batteries Update')
  const allBatteries = domePlacementSystem.getAllBatteries()
  allBatteries.forEach(battery => {
    battery.update(deltaTime, activeThreats)
  })
  profiler.endSection('Batteries Update')
  
  // Update radar network - pass threats directly instead of mapping
  if (activeThreats.length > 0) {
    profiler.startSection('Radar Network')
    radarNetwork.update(activeThreats)
    profiler.endSection('Radar Network')
  }

  // Update projectiles
  profiler.startSection('Projectiles')
  const projectileCount = projectiles.length
  if (projectileCount > 0) {
    profiler.startSection(`Update ${projectileCount} projectiles`)
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const projectile = projectiles[i]
      projectile.update()

      // Remove projectiles that fall below ground
      if (projectile.body.position.y < -10) {
        projectile.destroy(scene, world)
        projectiles.splice(i, 1)
      }
    }
    profiler.endSection(`Update ${projectileCount} projectiles`)
  }
  profiler.endSection('Projectiles')

  // Update interception system
  let systemInterceptors: Projectile[] = []
  if (simulationControls.autoIntercept) {
    profiler.startSection('Interception System')
    interceptionSystem.setProfiler(profiler) // Pass profiler for detailed tracking
    systemInterceptors = interceptionSystem.update(activeThreats)
    profiler.endSection('Interception System')
  }
  

  // Update GUI at 30 Hz (33ms) for smooth tactical display
  if (currentTime - previousTime > 0.033) {
    profiler.startSection('GUI Update')
    const stats = interceptionSystem.getStats()
    const allProjectiles = [...projectiles, ...systemInterceptors]
    
    debugInfo.fps = Math.round(fps)
    debugInfo.threats = activeThreats.length
    debugInfo.interceptors = allProjectiles.length
    debugInfo.interceptions = stats.successful
    debugInfo.successRate = stats.successful + stats.failed > 0 
      ? Math.round((stats.successful / (stats.successful + stats.failed)) * 100)
      : 0
    
    // Update battery network info
    const allBatteries = domePlacementSystem.getAllBatteries()
    let totalLoaded = 0
    let totalCapacity = 0
    
    allBatteries.forEach(battery => {
      totalLoaded += battery.getInterceptorCount()
      totalCapacity += battery.getConfig().launcherCount
    })
    
    batteryInfo.totalBatteries = allBatteries.length
    batteryInfo.totalLoadedTubes = totalLoaded
    batteryInfo.totalReloading = totalCapacity - totalLoaded
    batteryInfo.totalInterceptors = gameState.getInterceptorStock()
    batteryInfo.placementInfo = `${allBatteries.length}/${gameState.getUnlockedDomes()} placed`
    
    // Update tactical display only if performance allows
    if (!perfStats.isCritical) {
      profiler.startSection('Tactical Display')
      const displayPosition = allBatteries.length > 0 
        ? allBatteries[0].getPosition() 
        : new THREE.Vector3(0, 0, 0)
      
      tacticalDisplay.update(
        activeThreats,
        displayPosition,
        totalLoaded,
        0.95, // Default success rate
        totalCapacity // Total launcher capacity
      )
      profiler.endSection('Tactical Display')
    }
    
    // Check for performance warnings
    const perfCheck = performanceMonitor.checkPerformance()
    if (perfCheck.warning) {
      debug.warn(perfCheck.message)
    }
    
    profiler.endSection('GUI Update')
    previousTime = currentTime
    
  }

  // Update controls
  profiler.startSection('Controls')
  controls.update()
  profiler.endSection('Controls')

  // Render
  profiler.startSection('Render')
  renderProfiler.profiledRender(scene, camera)
  profiler.endSection('Render')
  
  // Update profiler display
  profiler.endSection('Frame')
  profilerDisplay.setRenderStats(renderProfiler.getLastStats())
  profilerDisplay.update()
  
  // Log render bottleneck analysis periodically
  frameCount++
  if (!renderBottleneckLogged && frameCount > 120 && frameCount % 60 === 0) {
    const averages = profiler.getAverages()
    const renderTime = averages.get('Render') || 0
    const frameTime = averages.get('Frame') || 0
    
    if (renderTime > 5 && renderTime / frameTime > 0.8) {
      renderBottleneckLogged = true
      debug.log('=== RENDER BOTTLENECK ANALYSIS ===')
      debug.performance('Render time', renderTime)
      debug.log(`Render is ${((renderTime/frameTime)*100).toFixed(0)}% of frame time`)
      
      // Count active effects
      let exhaustTrailCount = 0
      let particleSystemCount = 0
      let meshCount = 0
      let transparentCount = 0
      
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          meshCount++
          if (obj.material && (obj.material as any).transparent) transparentCount++
        } else if (obj instanceof THREE.Points) {
          particleSystemCount++
        }
      })
      
      // Count exhaust trails
      const allProjectiles = [...projectiles, ...systemInterceptors]
      allProjectiles.forEach(p => {
        if (p.exhaustTrail) exhaustTrailCount++
      })
      
      debug.category('Scene', 'Contents:', {
        meshes: meshCount,
        particleSystems: particleSystemCount,
        transparentObjects: transparentCount,
        exhaustTrails: exhaustTrailCount,
        threats: activeThreats.length,
        interceptors: systemInterceptors.length
      })
      
      debug.log('Check profiler (P key) for detailed breakdown')
      debug.log('================================')
    }
  }
  
  profiler.endFrame()
}

// Add debug mode indicator
if (debug.isEnabled()) {
  const debugIndicator = document.createElement('div')
  debugIndicator.style.position = 'absolute'
  debugIndicator.style.top = '10px'
  debugIndicator.style.right = '10px'
  debugIndicator.style.padding = '5px 10px'
  debugIndicator.style.backgroundColor = 'rgba(0, 56, 184, 0.2)'
  debugIndicator.style.border = '1px solid #0038b8'
  debugIndicator.style.color = '#0038b8'
  debugIndicator.style.fontFamily = 'monospace'
  debugIndicator.style.fontSize = '12px'
  debugIndicator.style.zIndex = '1000'
  debugIndicator.textContent = 'DEBUG MODE'
  document.body.appendChild(debugIndicator)
}


// Orientation handling for mobile
let animationId: number | null = null
let isOrientationLocked = false

function checkOrientation() {
  const orientationOverlay = document.getElementById('orientation-overlay')
  if (!orientationOverlay) return false
  
  // Only check on small mobile devices
  const isSmallMobile = window.innerWidth <= 768 && deviceInfo.isMobile
  const isPortrait = window.innerHeight > window.innerWidth
  
  const shouldLock = isSmallMobile && isPortrait
  
  if (shouldLock && !isOrientationLocked) {
    // Lock orientation - pause game
    isOrientationLocked = true
    orientationOverlay.classList.add('active')
    if (animationId) {
      cancelAnimationFrame(animationId)
      animationId = null
    }
    // Pause game systems
    simulationControls.pause = true
    if (waveManager) waveManager.pauseWave()
    debug.log('Orientation locked - game paused')
  } else if (!shouldLock && isOrientationLocked) {
    // Unlock orientation - resume game
    isOrientationLocked = false
    orientationOverlay.classList.remove('active')
    if (!animationId) {
      animate() // Restart animation loop
    }
    // Resume game systems
    simulationControls.pause = false
    if (waveManager && simulationControls.gameMode) waveManager.resumeWave()
    debug.log('Orientation unlocked - game resumed')
  }
  
  return shouldLock
}

// Check orientation on load and resize
window.addEventListener('resize', checkOrientation)
window.addEventListener('orientationchange', checkOrientation)

// Initial orientation check
const isLocked = checkOrientation()

// Start the animation loop only if not orientation locked
if (!isLocked) {
  animate()
}

// Final fallback after animation starts
setTimeout(hideLoadingScreen, 100)