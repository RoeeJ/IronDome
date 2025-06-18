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

const simulationFolder = gui.addFolder('Simulation')

// Debug controls for radar and battery positioning
const debugPositionFolder = gui.addFolder('Debug Positioning')
const debugPositions = {
  radarRotationOffset: 1,  // Set default to 1 as you found it works
  batteryLaunchHeight: 14.5,
  batteryLaunchForward: -0.1,
  batteryLaunchRight: -2,
  launchDirX: 0.6,
  launchDirY: 1,
  launchDirZ: 0.15,
  showDebugHelpers: true,
  // Radar model forward direction (in degrees)
  radarModelAngle: 90,  // Model faces +X direction
  // Individual radar corrections if needed (should be 0 with auto-correction)
  radar0Correction: 0,
  radar1Correction: 0,
  radar2Correction: 0,
  radar3Correction: 0,
  // Tamir model orientation debugging
  tamirForwardAxis: 'Y+',  // Which axis points forward in the model
  tamirRotX: 0,  // No rotation needed for Y+
  tamirRotY: 0,
  tamirRotZ: 0
}

// Apply initial settings
radarNetwork.setRotationOffset(1)
battery.setLaunchOffset(new THREE.Vector3(-2, 14.5, -0.1))
battery.setLaunchDirection(new THREE.Vector3(0.6, 1, 0.15).normalize())
// Set initial radar model direction (90 degrees = +X)
const initialRadarAngle = (90 * Math.PI) / 180
radarNetwork.setModelFacingDirection(new THREE.Vector3(
  Math.sin(initialRadarAngle),
  0,
  -Math.cos(initialRadarAngle)
))

debugPositionFolder.add(debugPositions, 'radarRotationOffset', -Math.PI, Math.PI, 0.01)
  .name('Radar Rotation Offset')
  .onChange((value: number) => {
    radarNetwork.setRotationOffset(value)
  })

debugPositionFolder.add(debugPositions, 'batteryLaunchHeight', 0, 20, 0.1)  // Increased to 20
  .name('Battery Launch Height')
  .onChange((value: number) => {
    battery.setLaunchOffset(new THREE.Vector3(
      debugPositions.batteryLaunchRight,
      value,
      debugPositions.batteryLaunchForward
    ))
  })

debugPositionFolder.add(debugPositions, 'batteryLaunchForward', -20, 20, 0.1)  // Increased to ±20
  .name('Battery Launch Forward')
  .onChange((value: number) => {
    battery.setLaunchOffset(new THREE.Vector3(
      debugPositions.batteryLaunchRight,
      debugPositions.batteryLaunchHeight,
      value
    ))
  })

debugPositionFolder.add(debugPositions, 'batteryLaunchRight', -20, 20, 0.1)  // Increased to ±20
  .name('Battery Launch Right')
  .onChange((value: number) => {
    battery.setLaunchOffset(new THREE.Vector3(
      value,
      debugPositions.batteryLaunchHeight,
      debugPositions.batteryLaunchForward
    ))
  })

// Launch direction controls
debugPositionFolder.add(debugPositions, 'launchDirX', -5, 5, 0.01)
  .name('Launch Dir X')
  .onChange(() => {
    const dir = new THREE.Vector3(
      debugPositions.launchDirX,
      debugPositions.launchDirY,
      debugPositions.launchDirZ
    ).normalize()
    battery.setLaunchDirection(dir)
  })

debugPositionFolder.add(debugPositions, 'launchDirY', -5, 5, 0.01)
  .name('Launch Dir Y')
  .onChange(() => {
    const dir = new THREE.Vector3(
      debugPositions.launchDirX,
      debugPositions.launchDirY,
      debugPositions.launchDirZ
    ).normalize()
    battery.setLaunchDirection(dir)
  })

debugPositionFolder.add(debugPositions, 'launchDirZ', -5, 5, 0.01)
  .name('Launch Dir Z')
  .onChange(() => {
    const dir = new THREE.Vector3(
      debugPositions.launchDirX,
      debugPositions.launchDirY,
      debugPositions.launchDirZ
    ).normalize()
    battery.setLaunchDirection(dir)
  })

debugPositionFolder.add(debugPositions, 'showDebugHelpers', true)
  .name('Show Debug Helpers')
  .onChange((value: boolean) => {
    radarNetwork.setShowDebugHelpers(value)
    battery.setShowDebugHelpers(value)
  })

// Radar model direction control
debugPositionFolder.add(debugPositions, 'radarModelAngle', 0, 360, 1)
  .name('Radar Model Forward Angle')
  .onChange((value: number) => {
    // Convert angle to direction vector
    const angleRad = (value * Math.PI) / 180
    const dir = new THREE.Vector3(
      Math.sin(angleRad),
      0,
      -Math.cos(angleRad)  // -Z is 0 degrees
    )
    radarNetwork.setModelFacingDirection(dir)
  })

// Individual radar corrections
const radarCorrectionsFolder = debugPositionFolder.addFolder('Radar Corrections')
for (let i = 0; i < 4; i++) {
  radarCorrectionsFolder.add(debugPositions, `radar${i}Correction` as any, -180, 180, 1)
    .name(`Radar ${i} Correction`)
    .onChange(() => {
      const corrections = [
        debugPositions.radar0Correction,
        debugPositions.radar1Correction,
        debugPositions.radar2Correction,
        debugPositions.radar3Correction
      ]
      radarNetwork.setRadarCorrections(corrections)
    })
}

// Tamir model orientation controls
const tamirFolder = debugPositionFolder.addFolder('Tamir Model Orientation')

tamirFolder.add(debugPositions, 'tamirForwardAxis', ['X+', 'X-', 'Y+', 'Y-', 'Z+', 'Z-'])
  .name('Forward Axis')
  .onChange((value: string) => {
    const vectors: { [key: string]: THREE.Vector3 } = {
      'X+': new THREE.Vector3(1, 0, 0),
      'X-': new THREE.Vector3(-1, 0, 0),
      'Y+': new THREE.Vector3(0, 1, 0),
      'Y-': new THREE.Vector3(0, -1, 0),
      'Z+': new THREE.Vector3(0, 0, 1),
      'Z-': new THREE.Vector3(0, 0, -1)
    }
    const forward = vectors[value]
    const rotation = new THREE.Euler(
      (debugPositions.tamirRotX * Math.PI) / 180,
      (debugPositions.tamirRotY * Math.PI) / 180,
      (debugPositions.tamirRotZ * Math.PI) / 180
    )
    Projectile.setModelOrientation(forward, rotation)
  })

tamirFolder.add(debugPositions, 'tamirRotX', -180, 180, 15)
  .name('Rotation X')
  .onChange(() => {
    const vectors: { [key: string]: THREE.Vector3 } = {
      'X+': new THREE.Vector3(1, 0, 0),
      'X-': new THREE.Vector3(-1, 0, 0),
      'Y+': new THREE.Vector3(0, 1, 0),
      'Y-': new THREE.Vector3(0, -1, 0),
      'Z+': new THREE.Vector3(0, 0, 1),
      'Z-': new THREE.Vector3(0, 0, -1)
    }
    const forward = vectors[debugPositions.tamirForwardAxis]
    const rotation = new THREE.Euler(
      (debugPositions.tamirRotX * Math.PI) / 180,
      (debugPositions.tamirRotY * Math.PI) / 180,
      (debugPositions.tamirRotZ * Math.PI) / 180
    )
    Projectile.setModelOrientation(forward, rotation)
  })

tamirFolder.add(debugPositions, 'tamirRotY', -180, 180, 15)
  .name('Rotation Y')
  .onChange(() => {
    const vectors: { [key: string]: THREE.Vector3 } = {
      'X+': new THREE.Vector3(1, 0, 0),
      'X-': new THREE.Vector3(-1, 0, 0),
      'Y+': new THREE.Vector3(0, 1, 0),
      'Y-': new THREE.Vector3(0, -1, 0),
      'Z+': new THREE.Vector3(0, 0, 1),
      'Z-': new THREE.Vector3(0, 0, -1)
    }
    const forward = vectors[debugPositions.tamirForwardAxis]
    const rotation = new THREE.Euler(
      (debugPositions.tamirRotX * Math.PI) / 180,
      (debugPositions.tamirRotY * Math.PI) / 180,
      (debugPositions.tamirRotZ * Math.PI) / 180
    )
    Projectile.setModelOrientation(forward, rotation)
  })

tamirFolder.add(debugPositions, 'tamirRotZ', -180, 180, 15)
  .name('Rotation Z')
  .onChange(() => {
    const vectors: { [key: string]: THREE.Vector3 } = {
      'X+': new THREE.Vector3(1, 0, 0),
      'X-': new THREE.Vector3(-1, 0, 0),
      'Y+': new THREE.Vector3(0, 1, 0),
      'Y-': new THREE.Vector3(0, -1, 0),
      'Z+': new THREE.Vector3(0, 0, 1),
      'Z-': new THREE.Vector3(0, 0, -1)
    }
    const forward = vectors[debugPositions.tamirForwardAxis]
    const rotation = new THREE.Euler(
      (debugPositions.tamirRotX * Math.PI) / 180,
      (debugPositions.tamirRotY * Math.PI) / 180,
      (debugPositions.tamirRotZ * Math.PI) / 180
    )
    Projectile.setModelOrientation(forward, rotation)
  })

debugPositionFolder.open()
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
  showTrajectories: true
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

// Hide loading screen when ready
window.addEventListener('load', () => {
  const loadingEl = document.getElementById('loading')
  if (loadingEl) {
    loadingEl.style.display = 'none'
  }
})

// Animation loop
const clock = new THREE.Clock()
let previousTime = 0

function animate() {
  requestAnimationFrame(animate)

  const deltaTime = clock.getDelta()
  const currentTime = clock.getElapsedTime()
  const fps = 1 / deltaTime

  // Update physics with time scale and pause
  if (!simulationControls.pause) {
    const scaledDelta = deltaTime * simulationControls.timeScale
    world.step(1 / 60, scaledDelta, 3)
  }

  // Update threat manager
  threatManager.update()
  
  // Update radar network
  const threats = threatManager.getActiveThreats()
  radarNetwork.update(threats.map(t => t.mesh))

  // Update projectiles
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const projectile = projectiles[i]
    projectile.update()

    // Remove projectiles that fall below ground
    if (projectile.body.position.y < -10) {
      projectile.destroy(scene, world)
      projectiles.splice(i, 1)
    }
  }

  // Update interception system
  if (simulationControls.autoIntercept) {
    const systemInterceptors = interceptionSystem.update(threatManager.getActiveThreats())
    // Merge system interceptors with manually launched projectiles
    const allProjectiles = [...projectiles, ...systemInterceptors]
    debugInfo.interceptors = allProjectiles.length
  }

  // Update GUI
  if (currentTime - previousTime > 0.1) {
    const stats = interceptionSystem.getStats()
    debugInfo.fps = Math.round(fps)
    debugInfo.threats = threatManager.getActiveThreats().length
    debugInfo.interceptors = projectiles.length
    debugInfo.interceptions = stats.successful
    debugInfo.successRate = stats.successful + stats.failed > 0 
      ? Math.round((stats.successful / (stats.successful + stats.failed)) * 100)
      : 0
    
    const loadedCount = battery.getInterceptorCount()
    batteryInfo.loadedTubes = loadedCount
    batteryInfo.reloading = 20 - loadedCount
    
    // Update tactical display
    tacticalDisplay.update(
      threatManager.getActiveThreats(),
      battery.getPosition(),
      loadedCount,
      batteryInfo.successRate
    )
    
    previousTime = currentTime
  }

  // Update controls
  controls.update()

  // Render
  renderer.render(scene, camera)
}

animate()