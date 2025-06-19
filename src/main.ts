import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import * as CANNON from 'cannon-es'
import GUI from 'lil-gui'
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
import { PerformanceOptimizer } from './core/PerformanceOptimizer'

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

// Axes helper (for debugging)
const axesHelper = new THREE.AxesHelper(10)
scene.add(axesHelper)

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

// Threat Manager
const threatManager = new ThreatManager(scene, world)

// Hook optimized renderer into threat manager
const originalThreatUpdate = threatManager.update.bind(threatManager)
threatManager.update = function() {
  // Call original update
  originalThreatUpdate()
  
  // If instanced threats are enabled, sync with optimizer
  if (performanceOptimizer.getSettings().enableInstancedThreats) {
    const threats = this.getActiveThreats()
    const optimizedRenderer = performanceOptimizer.getThreatRenderer()
    
    // Add new threats to optimized renderer
    threats.forEach(threat => {
      const threatId = `threat_${threat.id}`
      if (!optimizedRenderer['threatInstances'].has(threatId)) {
        optimizedRenderer.addThreat(threatId, threat.type, threat.getPosition())
        // Hide original mesh
        threat.mesh.visible = false
      } else {
        // Update position
        optimizedRenderer.updateThreat(threatId, threat.getPosition())
      }
    })
    
    // Remove old threats from optimized renderer
    const activeIds = new Set(threats.map(t => `threat_${t.id}`))
    Array.from(optimizedRenderer['threatInstances'].keys()).forEach(id => {
      if (!activeIds.has(id)) {
        optimizedRenderer.removeThreat(id)
      }
    })
  } else {
    // Show original meshes if optimization is disabled
    this.getActiveThreats().forEach(threat => {
      threat.mesh.visible = true
    })
  }
}

// Static Radar Network (4 corners) with large coverage for high altitude
const radarNetwork = new StaticRadarNetwork(scene, 300)  // 300m radius for high altitude coverage

// Initialize Performance Optimizer
const performanceOptimizer = new PerformanceOptimizer(scene, camera, renderer)

// Enable all optimizations by default for testing
performanceOptimizer.setSettings({
  enableInstancedThreats: true,
  enableInstancedProjectiles: true,
  enableSpatialIndex: true,
  enableLOD: true,
  shadowsEnabled: true,
  maxRenderDistance: 1000,
  particleQuality: 'high'
})

// Enable auto-adjustment
performanceOptimizer.setAutoAdjust(true)

debug.log('All performance optimizations enabled for testing')

// Debug: Log all objects in scene
debug.category('Scene', 'Scene children count:', scene.children.length)
scene.traverse((child) => {
  if (child instanceof THREE.Group) {
    debug.category('Scene', 'Group found at position:', child.position, 'with', child.children.length, 'children')
  }
})

// Iron Dome Battery
const battery = new IronDomeBattery(scene, world, {
  position: new THREE.Vector3(0, 0, 0),
  maxRange: 150,  // Increased for high altitude interceptions
  minRange: 4,
  reloadTime: 3000,  // 3 seconds per missile reload
  interceptorSpeed: 150,  // Increased speed for better reach
  launcherCount: 20
})

// Connect battery to radar network
battery.setRadarNetwork(radarNetwork)

// Interception System
const interceptionSystem = new InterceptionSystem(scene, world)
interceptionSystem.addBattery(battery)

// Tactical Display
const tacticalDisplay = new TacticalDisplay()

// Projectile management (defined early for simulationControls)
let projectiles: Projectile[] = []

// Simulation controls (defined early for mobile access)
const simulationControls = {
  spawnThreats: true,  // Enable by default
  autoIntercept: true,
  threatRate: 'medium',
  threatTypes: 'mixed',
  clearAll: () => {
    threatManager.clearAll()
    projectiles.forEach(p => p.destroy(scene, world))
    projectiles = []
  },
  pause: false,
  timeScale: 1.0,
  showTrajectories: true,
  enableFog: false,
  interceptorModel: 'ultra'  // 'none', 'ultra', 'simple'
}

// GUI
const gui = new GUI()

// Apply responsive UI
const responsiveUI = new ResponsiveUI(gui)

// Initialize mobile input if on touch device
let mobileInput: MobileInputManager | null = null
if (deviceInfo.hasTouch) {
  mobileInput = new MobileInputManager(camera, controls, renderer.domElement)
  
  // Set up tap to launch interceptor
  mobileInput.onTap((position) => {
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(position, camera)
    
    // First check if user tapped directly on a threat
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
      const interceptor = battery.fireInterceptor(targetThreat)
      if (interceptor) {
        responsiveUI.showNotification('Interceptor Launched!', 1500)
        // Add haptic feedback for successful launch
        mobileInput.vibrate(20)
      } else {
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
      
      const interceptor = battery.fireInterceptor(sortedThreats[0])
      if (interceptor) {
        responsiveUI.showNotification('Interceptor Launched!', 1500)
        mobileInput.vibrate(30)
      }
    } else {
      responsiveUI.showNotification('No threats detected', 1000)
    }
  })
  
  fireButton.style.bottom = '20px'
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

// Performance Optimization Controls
const optimizationFolder = gui.addFolder('Performance Optimization')
const optimizationControls = {
  preset: 'custom',
  autoAdjust: true,
  showStats: true, // Show stats by default
  instancedThreats: true, // Enabled by default
  instancedProjectiles: true, // Enabled by default
  spatialIndex: true, // Enabled by default
  enableLOD: true // Enabled by default
}
optimizationFolder.open() // Open folder by default

optimizationFolder.add(optimizationControls, 'preset', ['low', 'medium', 'high', 'ultra'])
  .name('Quality Preset')
  .onChange((value: string) => {
    performanceOptimizer.applyPreset(value as any)
    updateOptimizationControls()
  })

optimizationFolder.add(optimizationControls, 'autoAdjust')
  .name('Auto Adjust Quality')
  .onChange((value: boolean) => {
    performanceOptimizer.setAutoAdjust(value)
  })

optimizationFolder.add(optimizationControls, 'instancedThreats')
  .name('Instanced Threats')
  .onChange((value: boolean) => {
    performanceOptimizer.setSettings({ enableInstancedThreats: value })
  })

optimizationFolder.add(optimizationControls, 'instancedProjectiles')
  .name('Instanced Projectiles')
  .onChange((value: boolean) => {
    performanceOptimizer.setSettings({ enableInstancedProjectiles: value })
  })

optimizationFolder.add(optimizationControls, 'spatialIndex')
  .name('Spatial Index')
  .onChange((value: boolean) => {
    performanceOptimizer.setSettings({ enableSpatialIndex: value })
  })

optimizationFolder.add(optimizationControls, 'enableLOD')
  .name('Level of Detail')
  .onChange((value: boolean) => {
    performanceOptimizer.setSettings({ enableLOD: value })
  })

optimizationFolder.add(optimizationControls, 'showStats')
  .name('Show Stats')

// Helper to update controls from current settings
function updateOptimizationControls() {
  const settings = performanceOptimizer.getSettings()
  optimizationControls.instancedThreats = settings.enableInstancedThreats
  optimizationControls.instancedProjectiles = settings.enableInstancedProjectiles
  optimizationControls.spatialIndex = settings.enableSpatialIndex
  optimizationControls.enableLOD = settings.enableLOD
}

const simulationFolder = gui.addFolder('Simulation')

// Apply initial settings (hardcoded values from debug testing)
battery.setLaunchOffset(new THREE.Vector3(-2, 14.5, -0.1))
battery.setLaunchDirection(new THREE.Vector3(0.6, 1, 0.15).normalize())

// Set radar model facing direction (90 degrees = +X)
const radarAngle = (90 * Math.PI) / 180
radarNetwork.setModelFacingDirection(new THREE.Vector3(
  Math.sin(radarAngle),
  0,
  -Math.cos(radarAngle)
))

// Threat spawning control
simulationFolder.add(simulationControls, 'spawnThreats').name('Spawn Threats').onChange((value: boolean) => {
  if (value) {
    threatManager.startSpawning()
  } else {
    threatManager.stopSpawning()
  }
})

// Set initial threat rate to high for testing
simulationControls.threatRate = 'extreme'

// Threat rate control
simulationFolder.add(simulationControls, 'threatRate', ['low', 'medium', 'high', 'extreme']).name('Threat Rate').onChange((value: string) => {
  const rates = {
    low: { min: 8000, max: 15000 },
    medium: { min: 5000, max: 10000 },
    high: { min: 3000, max: 6000 },
    extreme: { min: 1000, max: 3000 }
  }
  // Update spawn configs in threat manager
  const spawnConfigs = threatManager['spawnConfigs']
  spawnConfigs.forEach(config => {
    config.minInterval = rates[value].min
    config.maxInterval = rates[value].max
  })
})

// Threat type control
simulationFolder.add(simulationControls, 'threatTypes', ['rockets', 'mixed', 'drones', 'mortars', 'all']).name('Threat Types').onChange((value: string) => {
  threatManager.setThreatMix(value as any)
})

simulationFolder.add(simulationControls, 'autoIntercept').name('Auto Intercept')
simulationFolder.add(simulationControls, 'pause').name('Pause Simulation')
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
simulationFolder.add(simulationControls, 'clearAll').name('Clear All')

// Add stress test button
const stressTest = {
  spawn100: () => {
    for (let i = 0; i < 100; i++) {
      setTimeout(() => {
        threatManager['spawnSingleThreat']()
      }, i * 50) // Spawn every 50ms
    }
  },
  spawn1000: () => {
    for (let i = 0; i < 1000; i++) {
      setTimeout(() => {
        threatManager['spawnSingleThreat']()
      }, i * 20) // Spawn every 20ms
    }
  }
}
simulationFolder.add(stressTest, 'spawn100').name('Spawn 100 Threats')
simulationFolder.add(stressTest, 'spawn1000').name('Spawn 1000 Threats!')

// Set initial threat mix and start spawning
threatManager.setThreatMix('mixed')

// Apply extreme spawn rate for testing
const spawnConfigs = threatManager['spawnConfigs']
spawnConfigs.forEach(config => {
  config.minInterval = 1000
  config.maxInterval = 3000
})

if (simulationControls.spawnThreats) {
  threatManager.startSpawning()
}

const batteryFolder = gui.addFolder('Battery Status')
const batteryInfo = {
  loadedTubes: 20,
  reloading: 0,
  radarRange: 300,
  interceptorSpeed: 150,
  maxRange: 150,
  successRate: 0.95,
  reloadTime: 3,
  aggressiveness: 1.3,
  firingDelay: 800,
  physicsScale: 'Optimized',
  minGuidanceDist: '15m',
  detonationRadius: '8m'
}
batteryFolder.add(batteryInfo, 'loadedTubes').listen().disable().name('Loaded Tubes')
batteryFolder.add(batteryInfo, 'reloading').listen().disable().name('Reloading')
batteryFolder.add(batteryInfo, 'radarRange').listen().disable().name('Radar Range (m)')
batteryFolder.add(batteryInfo, 'interceptorSpeed').listen().disable().name('Interceptor Speed (m/s)')
batteryFolder.add(batteryInfo, 'maxRange').listen().disable().name('Max Range (m)')
batteryFolder.add(batteryInfo, 'successRate', 0, 1, 0.05).name('Success Rate').onChange((value: number) => {
  battery.getConfig().successRate = value
})
batteryFolder.add(batteryInfo, 'reloadTime', 1, 10, 0.5).name('Reload Time (s)').onChange((value: number) => {
  battery.getConfig().reloadTime = value * 1000
})
batteryFolder.add(batteryInfo, 'aggressiveness', 1, 3, 0.1).name('Aggressiveness').onChange((value: number) => {
  battery.getConfig().aggressiveness = value
})
batteryFolder.add(batteryInfo, 'firingDelay', 50, 500, 10).name('Firing Delay (ms)').onChange((value: number) => {
  battery.getConfig().firingDelay = value
})
batteryFolder.add(batteryInfo, 'physicsScale').listen().disable().name('Physics Scale')
batteryFolder.add(batteryInfo, 'minGuidanceDist').listen().disable().name('Min Guidance Dist')
batteryFolder.add(batteryInfo, 'detonationRadius').listen().disable().name('Detonation Radius')

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
    color: 0x00ff00,
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
    color: 0x00ff00,
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
  
  const loadingEl = document.getElementById('loading')
  if (loadingEl) {
    loadingEl.style.display = 'none'
  }
})

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
  requestAnimationFrame(animate)
  
  // Store camera reference for LOD optimizations
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
  
  // Update performance optimizer
  performanceOptimizer.update(deltaTime)
  
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
  
  // Sync interceptors with optimized renderer
  if (performanceOptimizer.getSettings().enableInstancedProjectiles) {
    const optimizedProjectileRenderer = performanceOptimizer.getProjectileRenderer()
    const allProjectiles = [...projectiles, ...systemInterceptors]
    
    // Add/update projectiles in optimized renderer
    allProjectiles.forEach(projectile => {
      const projectileId = `projectile_${projectile.id}`
      if (!optimizedProjectileRenderer['projectileInstances'].has(projectileId)) {
        optimizedProjectileRenderer.addProjectile(
          projectileId, 
          'interceptor',
          new THREE.Vector3(
            projectile.body.position.x,
            projectile.body.position.y,
            projectile.body.position.z
          ),
          true // with trail
        )
        // Hide original mesh and trail
        if (projectile.mesh) projectile.mesh.visible = false
        if (projectile.trail) projectile.trail.visible = false
      } else {
        // Update position and velocity
        optimizedProjectileRenderer.updateProjectile(
          projectileId,
          new THREE.Vector3(
            projectile.body.position.x,
            projectile.body.position.y,
            projectile.body.position.z
          ),
          new THREE.Vector3(
            projectile.body.velocity.x,
            projectile.body.velocity.y,
            projectile.body.velocity.z
          )
        )
      }
    })
    
    // Remove old projectiles from optimized renderer
    const activeProjectileIds = new Set(allProjectiles.map(p => `projectile_${p.id}`))
    Array.from(optimizedProjectileRenderer['projectileInstances'].keys()).forEach(id => {
      if (!activeProjectileIds.has(id)) {
        optimizedProjectileRenderer.removeProjectile(id)
      }
    })
  } else {
    // Show original meshes if optimization is disabled
    [...projectiles, ...systemInterceptors].forEach(projectile => {
      if (projectile.mesh) projectile.mesh.visible = true
      if (projectile.trail) projectile.trail.visible = true
    })
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
    
    const loadedCount = battery.getInterceptorCount()
    batteryInfo.loadedTubes = loadedCount
    batteryInfo.reloading = 20 - loadedCount
    
    // Update tactical display only if performance allows
    if (!perfStats.isCritical) {
      profiler.startSection('Tactical Display')
      tacticalDisplay.update(
        activeThreats,
        battery.getPosition(),
        loadedCount,
        batteryInfo.successRate
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
    
    // Show optimization stats if enabled
    if (optimizationControls.showStats) {
      const optStats = performanceOptimizer.getStats()
      displayOptimizationStats(optStats)
    } else if (optStatsDiv) {
      // Hide stats if disabled
      optStatsDiv.style.display = 'none'
    }
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
  debugIndicator.style.backgroundColor = 'rgba(0, 255, 0, 0.2)'
  debugIndicator.style.border = '1px solid #00ff00'
  debugIndicator.style.color = '#00ff00'
  debugIndicator.style.fontFamily = 'monospace'
  debugIndicator.style.fontSize = '12px'
  debugIndicator.style.zIndex = '1000'
  debugIndicator.textContent = 'DEBUG MODE'
  document.body.appendChild(debugIndicator)
}

// Optimization stats display
let optStatsDiv: HTMLDivElement | null = null

function displayOptimizationStats(stats: any) {
  if (!optStatsDiv) {
    optStatsDiv = document.createElement('div')
    optStatsDiv.style.position = 'absolute'
    optStatsDiv.style.top = '100px'
    optStatsDiv.style.right = '10px'
    optStatsDiv.style.padding = '10px'
    optStatsDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.8)'
    optStatsDiv.style.color = '#00ff00'
    optStatsDiv.style.fontFamily = 'monospace'
    optStatsDiv.style.fontSize = '12px'
    optStatsDiv.style.borderRadius = '5px'
    optStatsDiv.style.border = '1px solid #00ff00'
    document.body.appendChild(optStatsDiv)
  }
  
  optStatsDiv.style.display = 'block'
  optStatsDiv.innerHTML = `
    <div style="font-weight: bold; margin-bottom: 5px;">OPTIMIZATION STATS</div>
    <div>FPS: ${stats.fps}</div>
    <div>Active: ${stats.optimizationsActive.join(', ') || 'None'}</div>
    <div>Instanced Threats: ${stats.instancedThreats}</div>
    <div>Instanced Projectiles: ${stats.instancedProjectiles}</div>
    <div>Spatial Objects: ${stats.spatialObjects}</div>
  `
}

animate()