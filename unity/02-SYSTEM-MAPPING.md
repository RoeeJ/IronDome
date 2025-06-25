# Iron Dome Simulator - Three.js to Unity System Mapping

## Table of Contents
1. [Rendering System Translation](#rendering-system-translation)
2. [Physics System Migration](#physics-system-migration)
3. [Entity Component Mapping](#entity-component-mapping)
4. [Event System Translation](#event-system-translation)
5. [Performance System Equivalents](#performance-system-equivalents)
6. [UI System Migration](#ui-system-migration)

## Rendering System Translation

### Core Rendering Objects

| Three.js | Unity Equivalent | Migration Strategy |
|----------|------------------|-------------------|
| `THREE.Scene` | `Scene` object | Direct mapping - Unity scenes |
| `THREE.Object3D` | `GameObject` + `Transform` | Parent-child hierarchy preserved |
| `THREE.Mesh` | `GameObject` + `MeshRenderer` + `MeshFilter` | Split mesh data from rendering |
| `THREE.Group` | `GameObject` (empty) | Container object |
| `THREE.Camera` | `Camera` component | Built-in camera system |

### Material and Shader System

```typescript
// Three.js Material Caching
const material = MaterialCache.getInstance().getMeshStandardMaterial({
  color: 0x4a4a4a,
  roughness: 0.8,
  metalness: 0.3
});
```

```csharp
// Unity Material Management
public class MaterialManager : MonoBehaviour
{
    [Header("Cached Materials")]
    public Material[] cachedMaterials;
    private Dictionary<string, Material> materialCache;
    
    public Material GetMaterial(MaterialConfig config)
    {
        string key = GenerateKey(config);
        if (!materialCache.ContainsKey(key))
        {
            Material newMaterial = CreateMaterial(config);
            materialCache[key] = newMaterial;
        }
        return materialCache[key];
    }
    
    private Material CreateMaterial(MaterialConfig config)
    {
        Material mat = new Material(Shader.Find("Standard"));
        mat.color = config.color;
        mat.SetFloat("_Metallic", config.metalness);
        mat.SetFloat("_Smoothness", 1f - config.roughness);
        return mat;
    }
}
```

### Geometry System

```typescript
// Three.js Geometry Factory
const sphere = GeometryFactory.getInstance().getSphere(radius, segments);
```

```csharp
// Unity Mesh Management
public class GeometryFactory : MonoBehaviour
{
    private Dictionary<string, Mesh> geometryCache = new Dictionary<string, Mesh>();
    
    public Mesh GetSphere(float radius, int segments)
    {
        string key = $"sphere_{radius}_{segments}";
        if (!geometryCache.ContainsKey(key))
        {
            Mesh sphereMesh = CreateSphereMesh(radius, segments);
            geometryCache[key] = sphereMesh;
        }
        return geometryCache[key];
    }
    
    private Mesh CreateSphereMesh(float radius, int segments)
    {
        GameObject primitive = GameObject.CreatePrimitive(PrimitiveType.Sphere);
        Mesh mesh = primitive.GetComponent<MeshFilter>().mesh;
        DestroyImmediate(primitive);
        
        // Scale vertices to desired radius
        Vector3[] vertices = mesh.vertices;
        for (int i = 0; i < vertices.Length; i++)
        {
            vertices[i] *= radius;
        }
        mesh.vertices = vertices;
        mesh.RecalculateNormals();
        mesh.RecalculateBounds();
        
        return mesh;
    }
}
```

### Instanced Rendering Translation

```typescript
// Three.js Instanced Mesh
const instancedMesh = new THREE.InstancedMesh(geometry, material, maxCount);
for (let i = 0; i < count; i++) {
  dummy.position.copy(positions[i]);
  dummy.updateMatrix();
  instancedMesh.setMatrixAt(i, dummy.matrix);
}
instancedMesh.instanceMatrix.needsUpdate = true;
```

```csharp
// Unity Graphics.DrawMeshInstanced
public class InstancedRenderer : MonoBehaviour
{
    [Header("Instancing")]
    public Mesh mesh;
    public Material material;
    public int maxInstances = 1000;
    
    private Matrix4x4[] matrices;
    private Vector4[] colors;
    private MaterialPropertyBlock propertyBlock;
    private int currentCount = 0;
    
    void Start()
    {
        matrices = new Matrix4x4[maxInstances];
        colors = new Vector4[maxInstances];
        propertyBlock = new MaterialPropertyBlock();
    }
    
    public void UpdateInstance(int index, Vector3 position, Quaternion rotation, Vector3 scale)
    {
        matrices[index] = Matrix4x4.TRS(position, rotation, scale);
        currentCount = Mathf.Max(currentCount, index + 1);
    }
    
    void Update()
    {
        if (currentCount > 0)
        {
            propertyBlock.SetVectorArray("_Colors", colors);
            Graphics.DrawMeshInstanced(mesh, 0, material, matrices, currentCount, propertyBlock);
        }
    }
}
```

### LOD System Translation

```typescript
// Three.js LOD Object
const lod = new THREE.LOD();
lod.addLevel(highDetailMesh, 0);
lod.addLevel(mediumDetailMesh, 50);
lod.addLevel(lowDetailMesh, 200);
```

```csharp
// Unity LOD Group
public class LODSetup : MonoBehaviour
{
    void Start()
    {
        LODGroup lodGroup = gameObject.AddComponent<LODGroup>();
        
        LOD[] lods = new LOD[3];
        
        // High detail (0-50% distance)
        Renderer[] highRenderers = { GetComponent<MeshRenderer>() };
        lods[0] = new LOD(0.5f, highRenderers);
        
        // Medium detail (50-80% distance)
        Renderer[] mediumRenderers = { mediumDetailObject.GetComponent<MeshRenderer>() };
        lods[1] = new LOD(0.2f, mediumRenderers);
        
        // Low detail (80-100% distance)
        Renderer[] lowRenderers = { lowDetailObject.GetComponent<MeshRenderer>() };
        lods[2] = new LOD(0.05f, lowRenderers);
        
        lodGroup.SetLODs(lods);
        lodGroup.RecalculateBounds();
    }
}
```

## Physics System Migration

### World Setup Translation

```typescript
// Three.js Cannon-es Physics World
const world = new CANNON.World();
world.gravity.set(0, -9.82, 0);
world.broadphase = new CANNON.NaiveBroadphase();
world.solver.iterations = 10;
```

```csharp
// Unity Physics Settings
public class PhysicsManager : MonoBehaviour
{
    void Start()
    {
        // Global physics settings
        Physics.gravity = new Vector3(0, -9.82f, 0);
        Physics.defaultSolverIterations = 10;
        Physics.defaultSolverVelocityIterations = 1;
        
        // Time settings
        Time.fixedDeltaTime = 1f / 60f; // 60 FPS physics
    }
    
    void FixedUpdate()
    {
        // Unity automatically steps physics
        // Custom physics logic can be added here
        HandleCustomPhysics();
    }
}
```

### Rigidbody Translation

```typescript
// Three.js Cannon Body
const body = new CANNON.Body({
  mass: 1,
  position: new CANNON.Vec3(0, 10, 0),
  shape: new CANNON.Sphere(1)
});
body.velocity.set(0, 0, 10);
world.addBody(body);
```

```csharp
// Unity Rigidbody
public class ProjectilePhysics : MonoBehaviour
{
    private Rigidbody rb;
    
    void Start()
    {
        rb = gameObject.AddComponent<Rigidbody>();
        rb.mass = 1f;
        rb.drag = 0.1f;
        rb.angularDrag = 0.5f;
        
        // Add collider
        SphereCollider collider = gameObject.AddComponent<SphereCollider>();
        collider.radius = 1f;
        
        // Set initial velocity
        rb.velocity = new Vector3(0, 0, 10);
    }
    
    void FixedUpdate()
    {
        // Custom physics forces
        ApplyWindResistance();
        ApplyGuidanceForces();
    }
    
    private void ApplyGuidanceForces()
    {
        if (target != null)
        {
            Vector3 toTarget = target.transform.position - transform.position;
            Vector3 guidance = CalculateProportionalNavigation(toTarget);
            rb.AddForce(guidance * guidanceStrength);
        }
    }
}
```

### Collision Detection

```typescript
// Three.js Collision Events
body.addEventListener('collide', (event) => {
  const contact = event.contact;
  const other = event.target === body ? event.contact.bi : event.contact.bj;
  handleCollision(other);
});
```

```csharp
// Unity Collision Detection
public class CollisionHandler : MonoBehaviour
{
    void OnTriggerEnter(Collider other)
    {
        if (other.CompareTag("Threat"))
        {
            HandleThreatCollision(other.gameObject);
        }
        else if (other.CompareTag("Ground"))
        {
            HandleGroundImpact();
        }
    }
    
    void OnCollisionEnter(Collision collision)
    {
        foreach (ContactPoint contact in collision.contacts)
        {
            HandleContactPoint(contact);
        }
    }
    
    private void HandleThreatCollision(GameObject threat)
    {
        // Proximity detonation logic
        float distance = Vector3.Distance(transform.position, threat.transform.position);
        if (distance <= proximityFuseRange)
        {
            TriggerDetonation(threat);
        }
    }
}
```

## Entity Component Mapping

### Battery System Translation

```typescript
// Three.js IronDomeBattery Class
class IronDomeBattery extends THREE.Object3D {
  private radarRange: number = 70;
  private launcherTubes: LauncherTube[] = [];
  private currentTargets: Threat[] = [];
  private lastFireTime: number = 0;
  
  update(deltaTime: number): void {
    this.scanForThreats();
    this.updateTargeting();
    this.checkFiringConditions();
  }
}
```

```csharp
// Unity IronDomeBattery Component
public class IronDomeBattery : MonoBehaviour
{
    [Header("Configuration")]
    public float radarRange = 70f;
    public float maxRange = 70f;
    public float minRange = 4f;
    public int launcherCount = 6;
    
    [Header("Performance")]
    public float reloadTime = 3f;
    public float firingDelay = 0.8f;
    public float successRate = 0.95f;
    
    [Header("Components")]
    public LauncherTube[] launcherTubes;
    public Transform radarAntenna;
    public ParticleSystem launchEffects;
    
    private List<Threat> currentTargets = new List<Threat>();
    private float lastFireTime;
    private SphereCollider detectionZone;
    
    void Start()
    {
        SetupDetectionZone();
        InitializeLaunchers();
    }
    
    void Update()
    {
        ScanForThreats();
        UpdateTargeting();
        CheckFiringConditions();
    }
    
    private void SetupDetectionZone()
    {
        detectionZone = gameObject.AddComponent<SphereCollider>();
        detectionZone.radius = radarRange;
        detectionZone.isTrigger = true;
    }
    
    void OnTriggerEnter(Collider other)
    {
        if (other.CompareTag("Threat"))
        {
            Threat threat = other.GetComponent<Threat>();
            if (threat != null && !currentTargets.Contains(threat))
            {
                currentTargets.Add(threat);
            }
        }
    }
}
```

### Projectile System Translation

```typescript
// Three.js Projectile Base Class
class Projectile extends THREE.Object3D {
  protected physicsBody: CANNON.Body;
  protected target?: Threat;
  protected guidanceType: GuidanceType;
  
  protected applyProportionalNavigation(): void {
    if (!this.target) return;
    
    const relativePosition = this.target.position.clone().sub(this.position);
    const relativeVelocity = this.target.velocity.clone().sub(this.velocity);
    const timeToIntercept = this.calculateTimeToIntercept();
    
    const guidance = this.calculateGuidanceCommand(relativePosition, relativeVelocity);
    this.physicsBody.force.copy(guidance);
  }
}
```

```csharp
// Unity Projectile Base Class
public abstract class Projectile : MonoBehaviour
{
    [Header("Physics")]
    protected Rigidbody rb;
    protected Collider col;
    
    [Header("Guidance")]
    public Transform target;
    public GuidanceType guidanceType;
    public float guidanceStrength = 100f;
    public float proximityFuseRange = 5f;
    
    [Header("Lifecycle")]
    public float maxLifetime = 30f;
    protected float launchTime;
    protected bool isActive = true;
    
    protected virtual void Start()
    {
        rb = GetComponent<Rigidbody>();
        col = GetComponent<Collider>();
        launchTime = Time.time;
    }
    
    protected virtual void FixedUpdate()
    {
        if (!isActive) return;
        
        CheckLifetime();
        ApplyGuidance();
        CheckProximityFuse();
    }
    
    protected virtual void ApplyGuidance()
    {
        if (target == null) return;
        
        switch (guidanceType)
        {
            case GuidanceType.ProportionalNavigation:
                ApplyProportionalNavigation();
                break;
            case GuidanceType.DirectPursuit:
                ApplyDirectPursuit();
                break;
        }
    }
    
    protected void ApplyProportionalNavigation()
    {
        Vector3 relativePosition = target.position - transform.position;
        Vector3 relativeVelocity = GetTargetVelocity() - rb.velocity;
        
        float timeToIntercept = CalculateTimeToIntercept(relativePosition, relativeVelocity);
        Vector3 interceptPoint = target.position + GetTargetVelocity() * timeToIntercept;
        
        Vector3 guidance = CalculateGuidanceCommand(interceptPoint);
        rb.AddForce(guidance * guidanceStrength);
    }
    
    private Vector3 GetTargetVelocity()
    {
        Rigidbody targetRb = target.GetComponent<Rigidbody>();
        return targetRb != null ? targetRb.velocity : Vector3.zero;
    }
}
```

## Event System Translation

### Three.js Event Emitter Pattern

```typescript
// Three.js Event System
class EventEmitter {
  private listeners: Map<string, Function[]> = new Map();
  
  on(event: string, callback: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }
  
  emit(event: string, data?: any): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(callback => callback(data));
    }
  }
}

// Usage
battery.on('missileFired', (data) => {
  gameState.updateStats(data);
  ui.showLaunchEffect(data);
});
```

### Unity Event System

```csharp
// Unity Events
using UnityEngine;
using UnityEngine.Events;

[System.Serializable]
public class MissileFiredEvent : UnityEvent<MissileFireData> { }

[System.Serializable]
public class ThreatDetectedEvent : UnityEvent<Threat> { }

public class IronDomeBattery : MonoBehaviour
{
    [Header("Events")]
    public MissileFiredEvent OnMissileFired;
    public ThreatDetectedEvent OnThreatDetected;
    
    // C# Events for code-only subscriptions
    public event System.Action<MissileFireData> MissileFired;
    public event System.Action<Threat> ThreatDetected;
    
    private void FireMissile(Threat target)
    {
        MissileFireData fireData = new MissileFireData
        {
            battery = this,
            target = target,
            timestamp = Time.time
        };
        
        // Invoke Unity Events (visible in inspector)
        OnMissileFired?.Invoke(fireData);
        
        // Invoke C# Events (code subscriptions)
        MissileFired?.Invoke(fireData);
    }
}

// Event Subscription
public class GameManager : MonoBehaviour
{
    void Start()
    {
        IronDomeBattery[] batteries = FindObjectsOfType<IronDomeBattery>();
        foreach (var battery in batteries)
        {
            battery.MissileFired += HandleMissileFired;
            battery.ThreatDetected += HandleThreatDetected;
        }
    }
    
    private void HandleMissileFired(MissileFireData data)
    {
        gameState.UpdateStats(data);
        uiManager.ShowLaunchEffect(data);
        audioManager.PlayLaunchSound(data.battery.transform.position);
    }
}
```

## Performance System Equivalents

### Object Pooling Translation

```typescript
// Three.js Object Pool
class ObjectPool<T> {
  private pool: T[] = [];
  private createFn: () => T;
  
  get(): T {
    if (this.pool.length > 0) {
      return this.pool.pop()!;
    }
    return this.createFn();
  }
  
  release(obj: T): void {
    this.pool.push(obj);
  }
}
```

```csharp
// Unity Object Pool (Unity 2021+)
using UnityEngine;
using UnityEngine.Pool;

public class ProjectilePool : MonoBehaviour
{
    [Header("Pool Settings")]
    public GameObject projectilePrefab;
    public int defaultCapacity = 100;
    public int maxSize = 1000;
    
    private ObjectPool<GameObject> pool;
    
    void Start()
    {
        pool = new ObjectPool<GameObject>(
            createFunc: CreateProjectile,
            actionOnGet: OnGetFromPool,
            actionOnRelease: OnReleaseToPool,
            actionOnDestroy: OnDestroyPoolObject,
            collectionCheck: true,
            defaultCapacity: defaultCapacity,
            maxSize: maxSize
        );
    }
    
    public GameObject GetProjectile()
    {
        return pool.Get();
    }
    
    public void ReleaseProjectile(GameObject projectile)
    {
        pool.Release(projectile);
    }
    
    private GameObject CreateProjectile()
    {
        GameObject obj = Instantiate(projectilePrefab);
        ProjectilePooled pooled = obj.GetComponent<ProjectilePooled>();
        pooled.SetPool(pool);
        return obj;
    }
    
    private void OnGetFromPool(GameObject obj)
    {
        obj.SetActive(true);
    }
    
    private void OnReleaseToPool(GameObject obj)
    {
        obj.SetActive(false);
    }
    
    private void OnDestroyPoolObject(GameObject obj)
    {
        Destroy(obj);
    }
}
```

### Performance Monitoring

```typescript
// Three.js Performance Monitor
class PerformanceMonitor {
  private frameTime: number = 0;
  private renderInfo: any;
  
  update(): void {
    this.frameTime = performance.now() - this.lastFrameTime;
    this.renderInfo = renderer.info;
    
    if (this.frameTime > 16.67) { // Over 60 FPS
      this.triggerOptimization();
    }
  }
}
```

```csharp
// Unity Performance Monitor
public class PerformanceMonitor : MonoBehaviour
{
    [Header("Monitoring")]
    public float targetFrameTime = 16.67f; // 60 FPS
    public int frameHistorySize = 60;
    
    private float[] frameTimeHistory;
    private int currentFrame = 0;
    private float averageFrameTime;
    
    void Start()
    {
        frameTimeHistory = new float[frameHistorySize];
        Application.targetFrameRate = 60;
    }
    
    void Update()
    {
        // Record frame time
        float frameTime = Time.unscaledDeltaTime * 1000f; // Convert to ms
        frameTimeHistory[currentFrame] = frameTime;
        currentFrame = (currentFrame + 1) % frameHistorySize;
        
        // Calculate average
        averageFrameTime = CalculateAverage();
        
        // Check for performance issues
        if (averageFrameTime > targetFrameTime * 1.2f)
        {
            TriggerOptimization();
        }
        else if (averageFrameTime < targetFrameTime * 0.8f)
        {
            IncreaseQuality();
        }
    }
    
    private void TriggerOptimization()
    {
        // Reduce quality settings
        QualitySettings.SetQualityLevel(QualitySettings.GetQualityLevel() - 1);
        
        // Notify systems to reduce load
        EventManager.Instance.TriggerEvent("PerformanceOptimization", averageFrameTime);
    }
}
```

## UI System Migration

### React to Unity UI Translation

```typescript
// React Component
const TacticalDisplay: React.FC = () => {
  const [threats, setThreats] = useState<Threat[]>([]);
  const [batteries, setBatteries] = useState<Battery[]>([]);
  
  return (
    <div className="tactical-display">
      <div className="threat-count">Threats: {threats.length}</div>
      <div className="battery-status">
        {batteries.map(battery => (
          <BatteryIndicator key={battery.id} battery={battery} />
        ))}
      </div>
    </div>
  );
};
```

```csharp
// Unity UI Manager
using UnityEngine;
using UnityEngine.UI;
using TMPro;

public class TacticalDisplayUI : MonoBehaviour
{
    [Header("UI Elements")]
    public TextMeshProUGUI threatCountText;
    public Transform batteryStatusParent;
    public GameObject batteryIndicatorPrefab;
    
    private List<BatteryIndicatorUI> batteryIndicators = new List<BatteryIndicatorUI>();
    
    void Start()
    {
        // Subscribe to game events
        EventManager.Instance.Subscribe("ThreatsUpdated", UpdateThreatCount);
        EventManager.Instance.Subscribe("BatteriesUpdated", UpdateBatteryStatus);
        
        InitializeBatteryIndicators();
    }
    
    private void UpdateThreatCount(object data)
    {
        int threatCount = (int)data;
        threatCountText.text = $"Threats: {threatCount}";
    }
    
    private void UpdateBatteryStatus(object data)
    {
        var batteries = (List<IronDomeBattery>)data;
        for (int i = 0; i < batteries.Count && i < batteryIndicators.Count; i++)
        {
            batteryIndicators[i].UpdateBattery(batteries[i]);
        }
    }
    
    private void InitializeBatteryIndicators()
    {
        IronDomeBattery[] batteries = FindObjectsOfType<IronDomeBattery>();
        foreach (var battery in batteries)
        {
            GameObject indicatorObj = Instantiate(batteryIndicatorPrefab, batteryStatusParent);
            BatteryIndicatorUI indicator = indicatorObj.GetComponent<BatteryIndicatorUI>();
            indicator.Initialize(battery);
            batteryIndicators.Add(indicator);
        }
    }
}
```

This mapping guide provides concrete translation patterns from Three.js to Unity, preserving the sophisticated architecture while leveraging Unity's built-in optimizations and cross-platform capabilities.