# Unity Porting Guide - Iron Dome Simulator

## Quick Start Architecture

### Project Structure
```
IronDomeUnity/
├── Scripts/
│   ├── Core/
│   │   ├── GameManager.cs
│   │   ├── SimulationController.cs
│   │   └── ObjectPoolManager.cs
│   ├── Entities/
│   │   ├── Projectile.cs
│   │   ├── Threat.cs
│   │   ├── Interceptor.cs
│   │   └── IronDomeBattery.cs
│   ├── Systems/
│   │   ├── ThreatManager.cs
│   │   ├── InterceptionSystem.cs
│   │   ├── RadarNetwork.cs
│   │   └── TrajectoryCalculator.cs
│   ├── Effects/
│   │   ├── ExplosionManager.cs
│   │   ├── TrailRenderer.cs
│   │   └── LaunchEffects.cs
│   ├── UI/
│   │   ├── TacticalDisplay.cs
│   │   ├── HUDController.cs
│   │   └── MobileInputHandler.cs
│   └── Data/
│       ├── ThreatConfigurations.cs
│       └── ScriptableObjects/
│           ├── ThreatData.cs
│           └── InterceptorData.cs
├── Prefabs/
│   ├── Threats/
│   ├── Interceptors/
│   ├── Effects/
│   └── UI/
├── Materials/
├── Shaders/
└── ScriptableObjects/
```

## Core Component Mappings

### 1. Projectile Base Class
```csharp
public class Projectile : MonoBehaviour
{
    [Header("Physics")]
    protected Rigidbody rb;
    protected float mass;
    protected Vector3 initialVelocity;
    
    [Header("Visuals")]
    protected TrailRenderer trail;
    protected Light exhaustLight;
    protected ParticleSystem exhaustParticles;
    
    [Header("State")]
    public string projectileId;
    public bool isActive = true;
    public float launchTime;
    
    protected virtual void Awake()
    {
        rb = GetComponent<Rigidbody>();
        trail = GetComponent<TrailRenderer>();
        projectileId = System.Guid.NewGuid().ToString();
    }
    
    public virtual void Launch(Vector3 position, Vector3 velocity)
    {
        transform.position = position;
        rb.velocity = velocity;
        initialVelocity = velocity;
        launchTime = Time.time;
        isActive = true;
    }
    
    protected virtual void FixedUpdate()
    {
        // Orientation along velocity
        if (rb.velocity.magnitude > 0.1f)
        {
            transform.rotation = Quaternion.LookRotation(rb.velocity);
        }
        
        // Check for ground impact
        if (transform.position.y < 0)
        {
            OnImpact();
        }
    }
    
    protected virtual void OnImpact()
    {
        isActive = false;
        // Trigger explosion effect
        ExplosionManager.Instance.CreateExplosion(transform.position);
        // Return to pool
        ObjectPoolManager.Instance.ReturnToPool(this);
    }
}
```

### 2. Threat Implementation
```csharp
[System.Serializable]
public enum ThreatType
{
    ShortRange, MediumRange, LongRange,
    Mortar, DroneSlow, DroneFast, CruiseMissile,
    Qassam1, Qassam2, Qassam3, GradRocket
}

public class Threat : Projectile
{
    [Header("Threat Configuration")]
    public ThreatType threatType;
    public ThreatData threatData; // ScriptableObject
    public Vector3 targetPosition;
    public float impactTime;
    
    [Header("Special Behaviors")]
    private bool isDrone;
    private bool isMortar;
    private float cruiseAltitude;
    private float maneuverability;
    
    public override void Launch(Vector3 position, Vector3 velocity)
    {
        base.Launch(position, velocity);
        
        // Load configuration from ScriptableObject
        isDrone = threatData.isDrone;
        isMortar = threatData.isMortar;
        cruiseAltitude = threatData.cruiseAltitude;
        maneuverability = threatData.maneuverability;
        
        // Calculate impact prediction
        CalculateImpactPrediction();
        
        // Special physics for drones
        if (isDrone)
        {
            rb.drag = 0.5f;
            rb.angularDrag = 0.99f;
            rb.freezeRotation = true;
        }
    }
    
    protected override void FixedUpdate()
    {
        base.FixedUpdate();
        
        if (isDrone && isActive)
        {
            UpdateDroneBehavior();
        }
        else if (threatType == ThreatType.CruiseMissile)
        {
            UpdateCruiseMissileBehavior();
        }
    }
    
    private void UpdateDroneBehavior()
    {
        Vector3 toTarget = targetPosition - transform.position;
        float horizontalDistance = new Vector3(toTarget.x, 0, toTarget.z).magnitude;
        
        // Altitude maintenance
        float altitudeError = cruiseAltitude - transform.position.y;
        Vector3 liftForce = Vector3.up * (altitudeError * 10f + 15f);
        rb.AddForce(liftForce);
        
        // Terminal dive when close
        if (horizontalDistance < 50f)
        {
            Vector3 diveDirection = toTarget.normalized;
            rb.AddForce(diveDirection * 30f);
        }
        else
        {
            // Normal flight
            Vector3 direction = new Vector3(toTarget.x, 0, toTarget.z).normalized;
            rb.AddForce(direction * 20f);
            
            // Ensure minimum speed
            float currentSpeed = new Vector3(rb.velocity.x, 0, rb.velocity.z).magnitude;
            if (currentSpeed < threatData.velocity * 0.5f)
            {
                rb.AddForce(direction * threatData.velocity * 0.3f);
            }
        }
        
        // Limit max velocity
        Vector3 horizontalVelocity = new Vector3(rb.velocity.x, 0, rb.velocity.z);
        if (horizontalVelocity.magnitude > threatData.velocity)
        {
            horizontalVelocity = horizontalVelocity.normalized * threatData.velocity;
            rb.velocity = new Vector3(horizontalVelocity.x, rb.velocity.y, horizontalVelocity.z);
        }
    }
    
    private void CalculateImpactPrediction()
    {
        if (isDrone) return; // Drones don't follow ballistic paths
        
        // Ballistic trajectory calculation
        float v0y = initialVelocity.y;
        float y0 = transform.position.y;
        float g = Physics.gravity.y;
        
        // Solve quadratic equation for impact time
        float discriminant = v0y * v0y - 2 * g * y0;
        if (discriminant < 0) return;
        
        float t = (-v0y - Mathf.Sqrt(discriminant)) / g;
        impactTime = launchTime + t;
        
        // Calculate impact position
        Vector3 impactPoint = transform.position + initialVelocity * t + 0.5f * Physics.gravity * t * t;
        impactPoint.y = 0;
        
        // Store for interception calculations
        GetComponent<ThreatData>().predictedImpactPoint = impactPoint;
    }
}
```

### 3. Interception System
```csharp
public class InterceptionSystem : MonoBehaviour
{
    [Header("Configuration")]
    public List<IronDomeBattery> batteries;
    public float minInterceptAltitude = 100f;
    public float maxInterceptRange = 70000f;
    
    [Header("Statistics")]
    public int successfulIntercepts;
    public int failedIntercepts;
    
    private Dictionary<Threat, InterceptSolution> activeIntercepts = new Dictionary<Threat, InterceptSolution>();
    
    void Update()
    {
        // Get all active threats
        List<Threat> threats = ThreatManager.Instance.GetActiveThreats();
        
        // Update intercept solutions
        foreach (var threat in threats)
        {
            if (!activeIntercepts.ContainsKey(threat))
            {
                TryCreateInterceptSolution(threat);
            }
        }
        
        // Execute ready intercepts
        List<Threat> toRemove = new List<Threat>();
        foreach (var kvp in activeIntercepts)
        {
            if (Time.time >= kvp.Value.launchTime && kvp.Value.interceptor == null)
            {
                LaunchInterceptor(kvp.Key, kvp.Value);
            }
            
            // Check for successful intercept
            if (kvp.Value.interceptor != null && kvp.Value.interceptor.isActive)
            {
                float distance = Vector3.Distance(
                    kvp.Key.transform.position, 
                    kvp.Value.interceptor.transform.position
                );
                
                if (distance < 5f)
                {
                    OnInterceptSuccess(kvp.Key, kvp.Value.interceptor);
                    toRemove.Add(kvp.Key);
                }
            }
        }
        
        // Clean up completed intercepts
        foreach (var threat in toRemove)
        {
            activeIntercepts.Remove(threat);
        }
    }
    
    private void TryCreateInterceptSolution(Threat threat)
    {
        // Find best battery
        IronDomeBattery bestBattery = null;
        float bestScore = float.MinValue;
        
        foreach (var battery in batteries)
        {
            if (!battery.HasAvailableInterceptors()) continue;
            
            float distance = Vector3.Distance(battery.transform.position, threat.transform.position);
            if (distance > maxInterceptRange) continue;
            
            float score = 1f / distance; // Simple scoring
            if (score > bestScore)
            {
                bestScore = score;
                bestBattery = battery;
            }
        }
        
        if (bestBattery == null) return;
        
        // Calculate intercept point
        InterceptSolution solution = CalculateInterceptSolution(threat, bestBattery);
        if (solution != null)
        {
            activeIntercepts[threat] = solution;
        }
    }
    
    private InterceptSolution CalculateInterceptSolution(Threat threat, IronDomeBattery battery)
    {
        float interceptorSpeed = 1000f; // m/s
        
        // Try different intercept times
        float startTime = threat.impactTime * 0.6f;
        float endTime = threat.impactTime * 0.9f;
        float timeStep = 0.1f;
        
        for (float t = startTime; t < endTime; t += timeStep)
        {
            // Get threat position at time t
            Vector3 threatPos = PredictPosition(threat, t);
            if (threatPos.y < minInterceptAltitude) continue;
            
            // Calculate interceptor flight time
            float distance = Vector3.Distance(battery.transform.position, threatPos);
            float flightTime = distance / interceptorSpeed;
            
            // Check if we can launch in time
            float launchTime = t - flightTime;
            if (launchTime > Time.time + 0.5f) // 0.5s prep time
            {
                return new InterceptSolution
                {
                    threat = threat,
                    battery = battery,
                    interceptPoint = threatPos,
                    interceptTime = t,
                    launchTime = launchTime,
                    probability = CalculateProbability(threat, distance)
                };
            }
        }
        
        return null;
    }
    
    private Vector3 PredictPosition(Threat threat, float time)
    {
        float dt = time - threat.launchTime;
        Vector3 pos = threat.transform.position + threat.initialVelocity * dt;
        pos += 0.5f * Physics.gravity * dt * dt;
        return pos;
    }
}
```

### 4. Trajectory Calculator (Static Utility)
```csharp
public static class TrajectoryCalculator
{
    public static LaunchParameters CalculateLaunchParameters(
        Vector3 start, Vector3 target, float velocity)
    {
        Vector3 delta = target - start;
        float range = new Vector3(delta.x, 0, delta.z).magnitude;
        float height = delta.y;
        float g = -Physics.gravity.y;
        
        // Calculate launch angle
        float v2 = velocity * velocity;
        float v4 = v2 * v2;
        float discriminant = v4 - g * (g * range * range + 2 * height * v2);
        
        if (discriminant < 0)
            return null; // Target out of range
        
        float sqrtDisc = Mathf.Sqrt(discriminant);
        float angle1 = Mathf.Atan((v2 + sqrtDisc) / (g * range));
        float angle2 = Mathf.Atan((v2 - sqrtDisc) / (g * range));
        
        // Choose appropriate angle
        float angle = (angle1 > 0 && angle1 < Mathf.PI / 2) ? angle1 : angle2;
        
        // Calculate azimuth
        float azimuth = Mathf.Atan2(delta.x, delta.z);
        
        return new LaunchParameters
        {
            angle = angle * Mathf.Rad2Deg,
            azimuth = azimuth * Mathf.Rad2Deg,
            velocity = velocity
        };
    }
    
    public static Vector3 GetLaunchVelocity(LaunchParameters parameters)
    {
        float angleRad = parameters.angle * Mathf.Deg2Rad;
        float azimuthRad = parameters.azimuth * Mathf.Deg2Rad;
        
        float vHorizontal = parameters.velocity * Mathf.Cos(angleRad);
        float vVertical = parameters.velocity * Mathf.Sin(angleRad);
        
        return new Vector3(
            vHorizontal * Mathf.Sin(azimuthRad),
            vVertical,
            vHorizontal * Mathf.Cos(azimuthRad)
        );
    }
}
```

### 5. Iron Dome Battery
```csharp
public class IronDomeBattery : MonoBehaviour
{
    [Header("Configuration")]
    public GameObject interceptorPrefab;
    public Transform[] launchTubes; // 20 tubes
    public Transform radarDish;
    public float radarRotationSpeed = 30f;
    public float reloadTime = 3f;
    
    [Header("State")]
    private bool[] tubeReady;
    private Queue<int> availableTubes;
    
    void Start()
    {
        tubeReady = new bool[launchTubes.Length];
        availableTubes = new Queue<int>();
        
        for (int i = 0; i < launchTubes.Length; i++)
        {
            tubeReady[i] = true;
            availableTubes.Enqueue(i);
        }
    }
    
    void Update()
    {
        // Rotate radar
        radarDish.Rotate(Vector3.up, radarRotationSpeed * Time.deltaTime);
    }
    
    public bool HasAvailableInterceptors()
    {
        return availableTubes.Count > 0;
    }
    
    public Interceptor LaunchInterceptor(Vector3 targetPosition)
    {
        if (!HasAvailableInterceptors()) return null;
        
        int tubeIndex = availableTubes.Dequeue();
        Transform tube = launchTubes[tubeIndex];
        
        // Calculate launch parameters
        var launchParams = TrajectoryCalculator.CalculateLaunchParameters(
            tube.position, targetPosition, 1000f
        );
        
        if (launchParams == null) return null;
        
        // Spawn interceptor
        GameObject interceptorGO = ObjectPoolManager.Instance.GetFromPool(interceptorPrefab);
        Interceptor interceptor = interceptorGO.GetComponent<Interceptor>();
        
        // Launch
        Vector3 velocity = TrajectoryCalculator.GetLaunchVelocity(launchParams);
        interceptor.Launch(tube.position, velocity);
        
        // Create launch effects
        LaunchEffects.Instance.CreateLaunchEffect(tube.position, velocity.normalized);
        
        // Start reload
        StartCoroutine(ReloadTube(tubeIndex));
        
        return interceptor;
    }
    
    IEnumerator ReloadTube(int index)
    {
        tubeReady[index] = false;
        yield return new WaitForSeconds(reloadTime);
        tubeReady[index] = true;
        availableTubes.Enqueue(index);
    }
}
```

## ScriptableObject Configurations

### ThreatData.cs
```csharp
[CreateAssetMenu(fileName = "ThreatData", menuName = "IronDome/Threat Configuration")]
public class ThreatData : ScriptableObject
{
    [Header("Basic Properties")]
    public ThreatType threatType;
    public float velocity = 300f;
    public float maxRange = 10000f;
    public float maxAltitude = 3000f;
    public float warheadSize = 10f;
    public Color trailColor = Color.red;
    public float radius = 0.4f;
    
    [Header("Special Properties")]
    public bool isDrone = false;
    public bool isMortar = false;
    public float maneuverability = 0f;
    public float cruiseAltitude = 0f;
    public float radarCrossSection = 0.5f;
    
    [Header("Visual")]
    public GameObject modelPrefab;
    public Material trailMaterial;
    public GameObject explosionPrefab;
}
```

## Performance Optimizations

### 1. GPU Instancing Setup
```csharp
public class InstancedThreatRenderer : MonoBehaviour
{
    private Dictionary<ThreatType, InstancedRenderBatch> batches;
    private MaterialPropertyBlock propertyBlock;
    
    class InstancedRenderBatch
    {
        public Mesh mesh;
        public Material material;
        public Matrix4x4[] matrices = new Matrix4x4[1000];
        public Vector4[] colors = new Vector4[1000];
        public int count = 0;
    }
    
    void Update()
    {
        foreach (var batch in batches.Values)
        {
            if (batch.count > 0)
            {
                propertyBlock.SetVectorArray("_Color", batch.colors);
                Graphics.DrawMeshInstanced(
                    batch.mesh, 
                    0, 
                    batch.material, 
                    batch.matrices, 
                    batch.count,
                    propertyBlock
                );
            }
        }
    }
}
```

### 2. Object Pooling
```csharp
public class ObjectPoolManager : MonoBehaviour
{
    private Dictionary<GameObject, Queue<GameObject>> pools;
    
    public GameObject GetFromPool(GameObject prefab)
    {
        if (!pools.ContainsKey(prefab))
        {
            pools[prefab] = new Queue<GameObject>();
        }
        
        if (pools[prefab].Count > 0)
        {
            GameObject obj = pools[prefab].Dequeue();
            obj.SetActive(true);
            return obj;
        }
        
        return Instantiate(prefab);
    }
    
    public void ReturnToPool(GameObject prefab, GameObject instance)
    {
        instance.SetActive(false);
        pools[prefab].Enqueue(instance);
    }
}
```

## Mobile Optimization

### Input Handler
```csharp
public class MobileInputHandler : MonoBehaviour
{
    void Update()
    {
        if (Input.touchCount > 0)
        {
            Touch touch = Input.GetTouch(0);
            
            if (touch.phase == TouchPhase.Began)
            {
                // Raycast for threat selection
                Ray ray = Camera.main.ScreenPointToRay(touch.position);
                RaycastHit hit;
                
                if (Physics.Raycast(ray, out hit, Mathf.Infinity, threatLayer))
                {
                    SelectThreat(hit.collider.GetComponent<Threat>());
                }
            }
        }
    }
}
```

### Quality Settings
```csharp
public class QualityManager : MonoBehaviour
{
    void Start()
    {
        if (SystemInfo.graphicsMemorySize < 2048)
        {
            // Mobile settings
            QualitySettings.SetQualityLevel(1); // Low
            Camera.main.farClipPlane = 500f;
            RenderSettings.fog = false;
        }
        else
        {
            // Desktop settings  
            QualitySettings.SetQualityLevel(3); // High
            Camera.main.farClipPlane = 1000f;
        }
    }
}
```

## Key Differences from Three.js Version

1. **Physics**: Unity's physics is more stable and accurate
2. **Rendering**: Built-in instancing and LOD support
3. **Effects**: Particle System and VFX Graph are more powerful
4. **UI**: Canvas-based UI is easier to work with
5. **Mobile**: Better optimization tools and profiler
6. **Audio**: 3D spatial audio is built-in
7. **Networking**: Multiplayer ready with Mirror/Netcode

## Testing Checklist

- [ ] Ballistic trajectories match original
- [ ] Intercept calculations are accurate
- [ ] Drone behavior works correctly
- [ ] Mortar high-angle launches
- [ ] Explosion effects and timing
- [ ] Performance at 1000+ objects
- [ ] Mobile touch controls
- [ ] UI responsiveness
- [ ] Audio positioning
- [ ] Statistics tracking