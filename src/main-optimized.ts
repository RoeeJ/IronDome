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

// New optimization systems
import { ChunkManager } from './world/ChunkManager'
import { LODManager } from './world/LODManager'
import { InstancedRenderer } from './rendering/InstancedRenderer'
import { SpatialIndex } from './world/SpatialIndex'

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
scene.fog = new THREE.Fog(0x2a5298, 500, 2000) // Extended fog for larger world

// Camera setup
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  3000  // Increased far plane for larger world
)
camera.position.set(100, 60, 100)
camera.lookAt(0, 0, 0)

// Renderer setup with device-specific settings
const renderer = new THREE.WebGLRenderer({ 
  antialias: !deviceInfo.isMobile,
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
controls.maxDistance = 1000  // Increased for larger world
controls.maxPolarAngle = Math.PI / 2 - 0.1

// Initialize optimization systems
const chunkManager = new ChunkManager(scene, {
  chunkSize: 200,      // 200m chunks
  viewDistance: 3,     // View 3 chunks in each direction
  worldSize: 20,       // 20x20 chunks = 4km x 4km world
  groundMaterial: new THREE.MeshStandardMaterial({
    color: 0x3a5f3a,
    roughness: 0.8,
    metalness: 0.2
  })
})
chunkManager.setCamera(camera)

const lodManager = new LODManager(scene, {
  levels: [
    { distance: 100, detail: 'high' },
    { distance: 300, detail: 'medium' },
    { distance: 600, detail: 'low' },
    { distance: 1000, detail: 'billboard' }
  ],
  updateInterval: 100
})
lodManager.setCamera(camera)

const instancedRenderer = new InstancedRenderer(scene)

// Create instanced groups for common objects
const debrisGeometry = new THREE.BoxGeometry(0.2, 0.2, 0.2)
const debrisMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 })
instancedRenderer.createInstancedGroup('debris', debrisGeometry, debrisMaterial, 500)

const fragmentGeometry = new THREE.SphereGeometry(0.1, 4, 4)
const fragmentMaterial = new THREE.MeshBasicMaterial({ color: 0xff6600 })
instancedRenderer.createInstancedGroup('fragment', fragmentGeometry, fragmentMaterial, 1000)

// Spatial index for efficient queries
const worldBounds = chunkManager.getWorldBounds()
const spatialIndex = new SpatialIndex(worldBounds)

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
scene.add(ambientLight)

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
directionalLight.position.set(50, 100, 50)
directionalLight.castShadow = true
directionalLight.shadow.camera.left = -200
directionalLight.shadow.camera.right = 200
directionalLight.shadow.camera.top = 200
directionalLight.shadow.camera.bottom = -200
directionalLight.shadow.camera.near = 0.1
directionalLight.shadow.camera.far = 400

// Adjust shadow map size based on device
const shadowMapSize = deviceInfo.isMobile ? 1024 : perfProfile.shadowQuality === 'high' ? 2048 : 1536
directionalLight.shadow.mapSize.width = shadowMapSize
directionalLight.shadow.mapSize.height = shadowMapSize

scene.add(directionalLight)

// Physics world with larger bounds
const world = new CANNON.World({
  gravity: new CANNON.Vec3(0, -9.82, 0)
})
world.broadphase = new CANNON.SAPBroadphase(world)
world.allowSleep = true

// Create physics bodies for loaded chunks
const chunkBodies: Map<string, CANNON.Body> = new Map()

// Threat Manager with spatial index
const threatManager = new ThreatManager(scene, world)

// Radar Network with spatial awareness
const radarNetwork = new StaticRadarNetwork(scene, 300)

// Iron Dome Battery at center
const battery = new IronDomeBattery(scene, world, {
  position: new THREE.Vector3(0, 0, 0),
  maxRange: 200,  // Increased for larger world
  minRange: 5,
  reloadTime: 3000,
  interceptorSpeed: 200,  // Increased speed
  launcherCount: 20
})

// Connect battery to radar network
battery.setRadarNetwork(radarNetwork)

// Interception System
const interceptionSystem = new InterceptionSystem(scene, world)
interceptionSystem.addBattery(battery)

// Tactical Display
const tacticalDisplay = new TacticalDisplay()

// GUI Setup
const gui = new GUI()

// Apply responsive UI
const responsiveUI = new ResponsiveUI(gui)

// Initialize mobile input if on touch device
let mobileInput: MobileInputManager | null = null
if (deviceInfo.hasTouch) {
  mobileInput = new MobileInputManager(camera, controls, renderer.domElement)
  // ... mobile input setup (same as before)
}

// Debug info
const debugInfo = {
  fps: 0,
  threats: 0,
  interceptors: 0,
  chunks: 0,
  instances: 0,
  spatialObjects: 0
}

const debugFolder = gui.addFolder('Debug')
debugFolder.add(debugInfo, 'fps').listen().disable()
debugFolder.add(debugInfo, 'threats').listen().disable()
debugFolder.add(debugInfo, 'interceptors').listen().disable()
debugFolder.add(debugInfo, 'chunks').listen().disable()
debugFolder.add(debugInfo, 'instances').listen().disable()
debugFolder.add(debugInfo, 'spatialObjects').listen().disable()

// Optimization controls
const optimizationFolder = gui.addFolder('Optimization')
const optimizationControls = {
  chunkViewDistance: 3,
  enableLOD: true,
  enableInstancing: true,
  showSpatialIndex: false,
  showChunkBorders: false
}

optimizationFolder.add(optimizationControls, 'chunkViewDistance', 1, 5, 1)
  .name('Chunk View Distance')
  .onChange((value: number) => {
    chunkManager.dispose()
    chunkManager.setCamera(camera) // Re-initialize with new view distance
  })

optimizationFolder.add(optimizationControls, 'enableLOD').name('Enable LOD')
optimizationFolder.add(optimizationControls, 'enableInstancing').name('Enable Instancing')
optimizationFolder.add(optimizationControls, 'showSpatialIndex').name('Show Spatial Index')
optimizationFolder.add(optimizationControls, 'showChunkBorders').name('Show Chunk Borders')

// Performance monitoring
const performanceMonitor = new PerformanceMonitor()
const profiler = new Profiler()
const profilerDisplay = new ProfilerDisplay(profiler)
const renderProfiler = new RenderProfiler(renderer)
renderProfiler.setProfiler(profiler)

// Animation loop
const clock = new THREE.Clock()
let spatialIndexDebugLines: THREE.Line[] = []

function animate() {
  requestAnimationFrame(animate)
  
  profiler.startSection('Frame')

  const deltaTime = clock.getDelta()
  const fps = 1 / deltaTime

  // Update chunk system
  profiler.startSection('Chunk System')
  chunkManager.update()
  
  // Update physics bodies for chunks
  const loadedChunks = chunkManager.getLoadedChunks()
  for (const chunk of loadedChunks) {
    const bodyId = `chunk_${chunk.id}`
    if (!chunkBodies.has(bodyId)) {
      // Create physics body for this chunk
      const shape = new CANNON.Box(new CANNON.Vec3(chunk.worldX, 0.1, chunk.worldZ))
      const body = new CANNON.Body({
        type: CANNON.Body.STATIC,
        shape,
        position: new CANNON.Vec3(chunk.worldX, -0.1, chunk.worldZ)
      })
      world.addBody(body)
      chunkBodies.set(bodyId, body)
    }
  }
  profiler.endSection('Chunk System')

  // Update LOD system
  if (optimizationControls.enableLOD) {
    profiler.startSection('LOD System')
    lodManager.update()
    profiler.endSection('LOD System')
  }

  // Update spatial index visualization
  if (optimizationControls.showSpatialIndex) {
    // Remove old debug lines
    spatialIndexDebugLines.forEach(line => {
      scene.remove(line)
      line.geometry.dispose()
      ;(line.material as THREE.Material).dispose()
    })
    spatialIndexDebugLines = spatialIndex.getDebugLines()
    spatialIndexDebugLines.forEach(line => scene.add(line))
  }

  // Update physics
  profiler.startSection('Physics')
  world.step(1 / 60, deltaTime, 3)
  profiler.endSection('Physics')

  // Update systems
  profiler.startSection('Game Systems')
  threatManager.update()
  const activeThreats = threatManager.getActiveThreats()
  
  if (activeThreats.length > 0) {
    radarNetwork.update(activeThreats)
  }
  
  const systemInterceptors = interceptionSystem.update(activeThreats)
  profiler.endSection('Game Systems')

  // Update debug info
  debugInfo.fps = Math.round(fps)
  debugInfo.threats = activeThreats.length
  debugInfo.interceptors = systemInterceptors.length
  debugInfo.chunks = chunkManager.getLoadedChunks().length
  debugInfo.spatialObjects = spatialIndex.getStats().totalObjects
  
  // Get instanced stats
  const instanceStats = instancedRenderer.getStats()
  debugInfo.instances = Object.values(instanceStats).reduce((sum, stat) => sum + stat.active, 0)

  // Update controls
  controls.update()

  // Render
  profiler.startSection('Render')
  renderProfiler.profiledRender(scene, camera)
  profiler.endSection('Render')
  
  profiler.endSection('Frame')
  profilerDisplay.setRenderStats(renderProfiler.getLastStats())
  profilerDisplay.update()
  profiler.endFrame()
}

// Window resize handler
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  
  const renderScale = deviceCaps.getRenderScale()
  renderer.setSize(window.innerWidth * renderScale, window.innerHeight * renderScale)
  renderer.domElement.style.width = window.innerWidth + 'px'
  renderer.domElement.style.height = window.innerHeight + 'px'
}
window.addEventListener('resize', onWindowResize)

// Start animation
animate()

// Export for debugging
;(window as any).debugSystems = {
  chunkManager,
  lodManager,
  instancedRenderer,
  spatialIndex
}