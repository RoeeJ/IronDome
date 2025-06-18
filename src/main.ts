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

// Scene setup
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x87CEEB) // Sky blue
// scene.fog = new THREE.Fog(0x87CEEB, 50, 500) // Disabled for better visibility

// Camera setup
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  2000  // Increased far plane
)
camera.position.set(100, 60, 100)  // Moved camera further back
camera.lookAt(0, 0, 0)

// Renderer setup
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(window.devicePixelRatio)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
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
directionalLight.shadow.mapSize.width = 2048
directionalLight.shadow.mapSize.height = 2048
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

// Static Radar Network (4 corners) with large coverage for high altitude
const radarNetwork = new StaticRadarNetwork(scene, 300)  // 300m radius for high altitude coverage

// Debug: Log all objects in scene
console.log('Scene children count:', scene.children.length)
scene.traverse((child) => {
  if (child instanceof THREE.Group) {
    console.log('Group found at position:', child.position, 'with', child.children.length, 'children')
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

// GUI
const gui = new GUI()
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

// Threat spawning control
simulationFolder.add(simulationControls, 'spawnThreats').name('Spawn Threats').onChange((value: boolean) => {
  if (value) {
    threatManager.startSpawning()
  } else {
    threatManager.stopSpawning()
  }
})

// Threat rate control
simulationFolder.add(simulationControls, 'threatRate', ['low', 'medium', 'high', 'extreme']).name('Threat Rate').onChange((value: string) => {
  const rates = {
    low: { min: 8000, max: 15000 },
    medium: { min: 5000, max: 10000 },
    high: { min: 3000, max: 6000 },
    extreme: { min: 1000, max: 3000 }
  }
  // Will implement setSpawnRate in ThreatManager
})

// Threat type control
simulationFolder.add(simulationControls, 'threatTypes', ['short', 'medium', 'long', 'mixed']).name('Threat Types')

simulationFolder.add(simulationControls, 'autoIntercept').name('Auto Intercept')
simulationFolder.add(simulationControls, 'pause').name('Pause Simulation')
simulationFolder.add(simulationControls, 'timeScale', 0.1, 3.0, 0.1).name('Time Scale')
simulationFolder.add(simulationControls, 'showTrajectories').name('Show Trajectories')
simulationFolder.add(simulationControls, 'enableFog').name('Enable Fog').onChange((value: boolean) => {
  if (value) {
    scene.fog = new THREE.Fog(0x87CEEB, 50, 500)
  } else {
    scene.fog = null
  }
})
simulationFolder.add(simulationControls, 'interceptorModel', ['none', 'ultra', 'simple']).name('Interceptor Model').onChange((value: string) => {
  // Store preference globally for new interceptors
  ;(window as any).__interceptorModelQuality = value
})
simulationFolder.add(simulationControls, 'clearAll').name('Clear All')

// Start spawning threats immediately
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

// Projectile management
let projectiles: Projectile[] = []

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
  renderer.setSize(window.innerWidth, window.innerHeight)
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
  
  // Adjust quality based on performance
  if (perfStats.isCritical) {
    // Skip tactical display updates in critical performance situations
    // Will be handled by reducing update frequency
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
      console.warn(perfCheck.message)
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
  debugIndicator.style.backgroundColor = 'rgba(0, 255, 0, 0.2)'
  debugIndicator.style.border = '1px solid #00ff00'
  debugIndicator.style.color = '#00ff00'
  debugIndicator.style.fontFamily = 'monospace'
  debugIndicator.style.fontSize = '12px'
  debugIndicator.style.zIndex = '1000'
  debugIndicator.textContent = 'DEBUG MODE'
  document.body.appendChild(debugIndicator)
}

animate()