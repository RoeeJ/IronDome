# Iron Dome Simulator - Unity Implementation Guide

## Table of Contents
1. [Project Setup](#project-setup)
2. [Phase 1: Core Architecture](#phase-1-core-architecture)
3. [Phase 2: Physics Integration](#phase-2-physics-integration)
4. [Phase 3: Rendering Systems](#phase-3-rendering-systems)
5. [Phase 4: Game Logic](#phase-4-game-logic)
6. [Phase 5: Optimization](#phase-5-optimization)
7. [Testing and Validation](#testing-and-validation)

## Project Setup

### Unity Project Configuration

```csharp
// Unity Version: 2022.3 LTS or later
// Recommended settings for optimal performance

// Project Settings
- Rendering Pipeline: URP (Universal Render Pipeline)
- Color Space: Linear
- Graphics API: 
  - Desktop: DirectX 11/12, OpenGL Core
  - Mobile: Vulkan, OpenGL ES 3.0+
- Scripting Backend: IL2CPP
- Api Compatibility Level: .NET Standard 2.1
- Target Framework: .NET Standard 2.1
```

### Package Dependencies

```json
{
  "dependencies": {
    "com.unity.render-pipelines.universal": "14.0.0",
    "com.unity.jobs": "0.70.0",
    "com.unity.burst": "1.8.0",
    "com.unity.collections": "2.1.0",
    "com.unity.mathematics": "1.2.6",
    "com.unity.visualeffectgraph": "14.0.0",
    "com.unity.addressables": "1.21.0",
    "com.unity.test-framework": "1.1.33",
    "com.unity.inputsystem": "1.7.0",
    "com.unity.cinemachine": "2.9.0"
  }
}
```

### Project Structure Setup

```
Assets/
├── Scripts/
│   ├── Core/              # Singleton managers, event systems
│   ├── Entities/          # Game objects (Battery, Threat, Projectile)
│   ├── Systems/           # Game logic systems
│   ├── Rendering/         # Instanced renderers, LOD systems
│   ├── Physics/           # Ballistics, guidance algorithms
│   ├── UI/                # User interface components
│   ├── Utils/             # Shared utilities, caches
│   └── Tests/             # Unit and integration tests
├── Prefabs/
│   ├── Batteries/         # Battery variants
│   ├── Threats/           # Threat type prefabs
│   ├── Projectiles/       # Interceptor prefabs
│   ├── Effects/           # VFX and particle systems
│   └── UI/                # UI prefabs
├── Materials/
│   ├── Shared/            # Cached materials
│   ├── Effects/           # VFX materials
│   └── UI/                # UI materials
├── Shaders/
│   ├── Instanced/         # Custom instanced shaders
│   ├── Effects/           # VFX shaders
│   └── Compute/           # Compute shaders
├── Settings/
│   ├── URP/               # URP renderer settings
│   ├── Input/             # Input action assets
│   └── Audio/             # Audio mixer settings
└── Resources/
    ├── Configs/           # ScriptableObject configurations
    └── Data/              # Game data assets
```

## Phase 1: Core Architecture (Week 1-2)

### Step 1: Event System Foundation

```csharp
// Create Assets/Scripts/Core/EventManager.cs
using System;
using System.Collections.Generic;
using UnityEngine;

public class EventManager : MonoBehaviour
{
    public static EventManager Instance { get; private set; }
    
    private Dictionary<string, List<Action<object>>> eventListeners = new Dictionary<string, List<Action<object>>>();
    
    void Awake()
    {
        if (Instance == null)
        {
            Instance = this;
            DontDestroyOnLoad(gameObject);
        }
        else
        {
            Destroy(gameObject);
        }
    }
    
    public void Subscribe(string eventName, Action<object> listener)
    {
        if (!eventListeners.ContainsKey(eventName))
        {
            eventListeners[eventName] = new List<Action<object>>();
        }
        eventListeners[eventName].Add(listener);
    }
    
    public void Unsubscribe(string eventName, Action<object> listener)
    {
        if (eventListeners.ContainsKey(eventName))
        {
            eventListeners[eventName].Remove(listener);
        }
    }
    
    public void TriggerEvent(string eventName, object data = null)
    {
        if (eventListeners.ContainsKey(eventName))
        {
            foreach (var listener in eventListeners[eventName])
            {
                listener?.Invoke(data);
            }
        }
    }
}
```

### Step 2: Game State Management

```csharp
// Create Assets/Scripts/Core/GameStateManager.cs
using UnityEngine;
using System;

[CreateAssetMenu(fileName = "GameState", menuName = "IronDome/Game State")]
public class GameState : ScriptableObject
{
    [Header("Game Progress")]
    public int currentWave = 1;
    public int currentMoney = 1000;
    public float gameTime = 0f;
    public bool isPaused = false;
    
    [Header("Statistics")]
    public int threatsDestroyed = 0;
    public int interceptorsFired = 0;
    public int successfulInterceptions = 0;
    public float accuracyRate = 0f;
    
    [Header("Settings")]
    public float timeScale = 1f;
    public bool enableWind = true;
    public float windStrength = 1f;
    
    // Events
    public event Action<int> OnMoneyChanged;
    public event Action<int> OnWaveChanged;
    public event Action<bool> OnPauseStateChanged;
    
    public void UpdateMoney(int amount)
    {
        currentMoney = Mathf.Max(0, currentMoney + amount);
        OnMoneyChanged?.Invoke(currentMoney);
    }
    
    public void SetWave(int wave)
    {
        currentWave = wave;
        OnWaveChanged?.Invoke(currentWave);
    }
    
    public void SetPaused(bool paused)
    {
        isPaused = paused;
        Time.timeScale = paused ? 0f : timeScale;
        OnPauseStateChanged?.Invoke(paused);
    }
    
    public void UpdateStatistics(bool interceptionSuccess)
    {
        interceptorsFired++;
        if (interceptionSuccess)
        {
            successfulInterceptions++;
            threatsDestroyed++;
        }
        accuracyRate = (float)successfulInterceptions / interceptorsFired;
    }
}

// Create Assets/Scripts/Core/GameManager.cs
public class GameManager : MonoBehaviour
{
    public static GameManager Instance { get; private set; }
    
    [Header("Game State")]
    public GameState gameState;
    
    [Header("Managers")]
    public ThreatManager threatManager;
    public InterceptionSystem interceptionSystem;
    public PerformanceManager performanceManager;
    
    void Awake()
    {
        if (Instance == null)
        {
            Instance = this;
            DontDestroyOnLoad(gameObject);
        }
        else
        {
            Destroy(gameObject);
        }
    }
    
    void Start()
    {
        InitializeGame();
    }
    
    private void InitializeGame()
    {
        // Subscribe to events
        EventManager.Instance.Subscribe("ThreatDestroyed", OnThreatDestroyed);
        EventManager.Instance.Subscribe("InterceptorFired", OnInterceptorFired);
        
        // Initialize managers
        threatManager?.Initialize();
        interceptionSystem?.Initialize();
        performanceManager?.Initialize();
        
        Debug.Log("Iron Dome Simulator Initialized");
    }
    
    private void OnThreatDestroyed(object data)
    {
        if (data is ThreatDestroyedData destroyData)
        {
            gameState.UpdateStatistics(destroyData.wasIntercepted);
            
            if (destroyData.wasIntercepted)
            {
                gameState.UpdateMoney(50); // Reward for successful interception
            }
        }
    }
    
    private void OnInterceptorFired(object data)
    {
        gameState.UpdateMoney(-20); // Cost of interceptor
    }
}

[System.Serializable]
public struct ThreatDestroyedData
{
    public string threatId;
    public Vector3 position;
    public bool wasIntercepted;
    public string cause;
}
```

### Step 3: Object Pooling Framework

```csharp
// Create Assets/Scripts/Core/ObjectPool.cs
using System.Collections.Generic;
using UnityEngine;

public class ObjectPool<T> : MonoBehaviour where T : Component, IPoolable
{
    [Header("Pool Configuration")]
    public T prefab;
    public int initialPoolSize = 50;
    public int maxPoolSize = 200;
    public bool allowGrowth = true;
    
    private Queue<T> pool = new Queue<T>();
    private HashSet<T> activeObjects = new HashSet<T>();
    
    void Start()
    {
        InitializePool();
    }
    
    private void InitializePool()
    {
        for (int i = 0; i < initialPoolSize; i++)
        {
            T obj = CreateNewObject();
            pool.Enqueue(obj);
        }
    }
    
    private T CreateNewObject()
    {
        T obj = Instantiate(prefab, transform);
        obj.gameObject.SetActive(false);
        obj.SetPool(this);
        return obj;
    }
    
    public T Get()
    {
        T obj;
        
        if (pool.Count > 0)
        {
            obj = pool.Dequeue();
        }
        else if (allowGrowth && activeObjects.Count < maxPoolSize)
        {
            obj = CreateNewObject();
        }
        else
        {
            return null; // Pool exhausted
        }
        
        activeObjects.Add(obj);
        obj.gameObject.SetActive(true);
        obj.OnGetFromPool();
        
        return obj;
    }
    
    public void Return(T obj)
    {
        if (activeObjects.Contains(obj))
        {
            activeObjects.Remove(obj);
            obj.OnReturnToPool();
            obj.gameObject.SetActive(false);
            pool.Enqueue(obj);
        }
    }
    
    public int GetActiveCount()
    {
        return activeObjects.Count;
    }
    
    public int GetPooledCount()
    {
        return pool.Count;
    }
}

public interface IPoolable
{
    void SetPool(object pool);
    void OnGetFromPool();
    void OnReturnToPool();
}
```

## Phase 2: Physics Integration (Week 2-3)

### Step 1: Physics World Setup

```csharp
// Create Assets/Scripts/Physics/PhysicsManager.cs
using UnityEngine;

public class PhysicsManager : MonoBehaviour
{
    public static PhysicsManager Instance { get; private set; }
    
    [Header("Physics Configuration")]
    public Vector3 gravity = new Vector3(0, -9.82f, 0);
    public int solverIterations = 10;
    public int solverVelocityIterations = 1;
    public float fixedTimeStep = 1f / 60f;
    
    [Header("Collision Layers")]
    public LayerMask threatLayer = 1 << 8;
    public LayerMask interceptorLayer = 1 << 9;
    public LayerMask groundLayer = 1 << 10;
    public LayerMask detectionLayer = 1 << 11;
    
    void Awake()
    {
        if (Instance == null)
        {
            Instance = this;
            InitializePhysics();
        }
        else
        {
            Destroy(gameObject);
        }
    }
    
    private void InitializePhysics()
    {
        // Configure global physics
        Physics.gravity = gravity;
        Physics.defaultSolverIterations = solverIterations;
        Physics.defaultSolverVelocityIterations = solverVelocityIterations;
        Time.fixedDeltaTime = fixedTimeStep;
        
        // Setup collision matrix
        SetupCollisionLayers();
        
        Debug.Log("Physics system initialized");
    }
    
    private void SetupCollisionLayers()
    {
        // Threats don't collide with each other
        Physics.IgnoreLayerCollision(GetLayerFromMask(threatLayer), GetLayerFromMask(threatLayer));
        
        // Interceptors don't collide with each other
        Physics.IgnoreLayerCollision(GetLayerFromMask(interceptorLayer), GetLayerFromMask(interceptorLayer));
        
        // Detection zones are triggers only
        Physics.IgnoreLayerCollision(GetLayerFromMask(detectionLayer), GetLayerFromMask(groundLayer));
    }
    
    private int GetLayerFromMask(LayerMask layerMask)
    {
        int layer = 0;
        while (layerMask > 1)
        {
            layerMask >>= 1;
            layer++;
        }
        return layer;
    }
    
    public void SetTimeScale(float scale)
    {
        Time.timeScale = scale;
    }
}
```

### Step 2: Ballistics Calculator

```csharp
// Create Assets/Scripts/Physics/BallisticsCalculator.cs
using Unity.Collections;
using Unity.Jobs;
using Unity.Mathematics;
using UnityEngine;

public class BallisticsCalculator : MonoBehaviour
{
    public static BallisticsCalculator Instance { get; private set; }
    
    [Header("Ballistics Parameters")]
    public float gravity = 9.82f;
    public float airDensity = 1.225f;
    public float windEffect = 1f;
    
    void Awake()
    {
        if (Instance == null)
        {
            Instance = this;
        }
        else
        {
            Destroy(gameObject);
        }
    }
    
    public TrajectoryData CalculateTrajectory(Vector3 startPos, Vector3 startVel, float timeStep = 0.1f, float maxTime = 30f)
    {
        int maxPoints = Mathf.CeilToInt(maxTime / timeStep);
        NativeArray<float3> positions = new NativeArray<float3>(maxPoints, Allocator.TempJob);
        NativeArray<float3> velocities = new NativeArray<float3>(maxPoints, Allocator.TempJob);
        
        TrajectoryCalculationJob job = new TrajectoryCalculationJob
        {
            startPosition = startPos,
            startVelocity = startVel,
            gravity = new float3(0, -gravity, 0),
            timeStep = timeStep,
            airDensity = airDensity,
            windVelocity = WindSystem.Instance ? WindSystem.Instance.GetWindAtPosition(startPos) : Vector3.zero,
            positions = positions,
            velocities = velocities
        };
        
        JobHandle jobHandle = job.Schedule();
        jobHandle.Complete();
        
        // Convert to TrajectoryData
        Vector3[] posArray = new Vector3[maxPoints];
        Vector3[] velArray = new Vector3[maxPoints];
        
        for (int i = 0; i < maxPoints; i++)
        {
            posArray[i] = positions[i];
            velArray[i] = velocities[i];
            
            // Stop at ground impact
            if (posArray[i].y <= 0 && i > 0)
            {
                System.Array.Resize(ref posArray, i);
                System.Array.Resize(ref velArray, i);
                break;
            }
        }
        
        positions.Dispose();
        velocities.Dispose();
        
        return new TrajectoryData
        {
            positions = posArray,
            velocities = velArray,
            impactPoint = posArray[posArray.Length - 1],
            flightTime = posArray.Length * timeStep
        };
    }
    
    public static Vector3 CalculateInterceptVelocity(Vector3 shooterPos, Vector3 targetPos, Vector3 targetVel, float projectileSpeed)
    {
        Vector3 toTarget = targetPos - shooterPos;
        float a = Vector3.Dot(targetVel, targetVel) - projectileSpeed * projectileSpeed;
        float b = 2 * Vector3.Dot(toTarget, targetVel);
        float c = Vector3.Dot(toTarget, toTarget);
        
        float discriminant = b * b - 4 * a * c;
        if (discriminant < 0) return Vector3.zero;
        
        float t1 = (-b + Mathf.Sqrt(discriminant)) / (2 * a);
        float t2 = (-b - Mathf.Sqrt(discriminant)) / (2 * a);
        
        float t = t1 > 0 ? t1 : t2;
        if (t < 0) return Vector3.zero;
        
        Vector3 interceptPoint = targetPos + targetVel * t;
        return (interceptPoint - shooterPos).normalized * projectileSpeed;
    }
}

[System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
public struct TrajectoryCalculationJob : IJob
{
    public float3 startPosition;
    public float3 startVelocity;
    public float3 gravity;
    public float3 windVelocity;
    public float timeStep;
    public float airDensity;
    
    public NativeArray<float3> positions;
    public NativeArray<float3> velocities;
    
    public void Execute()
    {
        float3 position = startPosition;
        float3 velocity = startVelocity;
        
        for (int i = 0; i < positions.Length; i++)
        {
            positions[i] = position;
            velocities[i] = velocity;
            
            // Apply gravity
            velocity += gravity * timeStep;
            
            // Apply wind resistance
            float3 relativeVelocity = velocity - windVelocity;
            float speed = math.length(relativeVelocity);
            if (speed > 0.1f)
            {
                float3 dragForce = math.normalize(relativeVelocity) * (-0.5f * airDensity * speed * speed * 0.01f);
                velocity += dragForce * timeStep;
            }
            
            // Update position
            position += velocity * timeStep;
            
            // Stop if hit ground
            if (position.y <= 0 && i > 0) break;
        }
    }
}

[System.Serializable]
public struct TrajectoryData
{
    public Vector3[] positions;
    public Vector3[] velocities;
    public Vector3 impactPoint;
    public float flightTime;
}
```

### Step 3: Guidance System

```csharp
// Create Assets/Scripts/Physics/GuidanceSystem.cs
using Unity.Collections;
using Unity.Jobs;
using Unity.Mathematics;
using UnityEngine;

public class GuidanceSystem : MonoBehaviour
{
    public static GuidanceSystem Instance { get; private set; }
    
    [Header("Guidance Parameters")]
    public float navigationConstant = 3f;
    public float maxAcceleration = 50f;
    public float proximityFuseRange = 5f;
    
    private NativeArray<GuidanceData> guidanceData;
    private NativeArray<float3> guidanceCommands;
    private bool isInitialized = false;
    
    void Awake()
    {
        if (Instance == null)
        {
            Instance = this;
            InitializeGuidanceSystem();
        }
        else
        {
            Destroy(gameObject);
        }
    }
    
    private void InitializeGuidanceSystem()
    {
        int maxInterceptors = 100;
        guidanceData = new NativeArray<GuidanceData>(maxInterceptors, Allocator.Persistent);
        guidanceCommands = new NativeArray<float3>(maxInterceptors, Allocator.Persistent);
        isInitialized = true;
    }
    
    void OnDestroy()
    {
        if (isInitialized)
        {
            guidanceData.Dispose();
            guidanceCommands.Dispose();
        }
    }
    
    public void UpdateGuidance(List<Interceptor> interceptors)
    {
        if (!isInitialized || interceptors.Count == 0) return;
        
        // Populate guidance data
        for (int i = 0; i < interceptors.Count && i < guidanceData.Length; i++)
        {
            var interceptor = interceptors[i];
            var target = interceptor.GetTarget();
            
            guidanceData[i] = new GuidanceData
            {
                interceptorPosition = interceptor.transform.position,
                interceptorVelocity = interceptor.GetVelocity(),
                targetPosition = target ? target.transform.position : float3.zero,
                targetVelocity = target ? target.GetVelocity() : float3.zero,
                hasTarget = target != null,
                navigationConstant = navigationConstant,
                maxAcceleration = maxAcceleration
            };
        }
        
        // Execute guidance calculation job
        ProportionalNavigationJob job = new ProportionalNavigationJob
        {
            guidanceData = guidanceData,
            guidanceCommands = guidanceCommands
        };
        
        JobHandle jobHandle = job.Schedule(interceptors.Count, 32);
        jobHandle.Complete();
        
        // Apply guidance commands
        for (int i = 0; i < interceptors.Count; i++)
        {
            Vector3 command = guidanceCommands[i];
            interceptors[i].ApplyGuidanceCommand(command);
            
            // Check proximity fuse
            var target = interceptors[i].GetTarget();
            if (target != null)
            {
                float distance = Vector3.Distance(interceptors[i].transform.position, target.transform.position);
                if (distance <= proximityFuseRange)
                {
                    interceptors[i].TriggerDetonation();
                }
            }
        }
    }
}

[System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
public struct GuidanceData
{
    public float3 interceptorPosition;
    public float3 interceptorVelocity;
    public float3 targetPosition;
    public float3 targetVelocity;
    public bool hasTarget;
    public float navigationConstant;
    public float maxAcceleration;
}

[System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
public struct ProportionalNavigationJob : IJobParallelFor
{
    [ReadOnly] public NativeArray<GuidanceData> guidanceData;
    public NativeArray<float3> guidanceCommands;
    
    public void Execute(int index)
    {
        var data = guidanceData[index];
        
        if (!data.hasTarget)
        {
            guidanceCommands[index] = float3.zero;
            return;
        }
        
        float3 relativePosition = data.targetPosition - data.interceptorPosition;
        float3 relativeVelocity = data.targetVelocity - data.interceptorVelocity;
        float range = math.length(relativePosition);
        
        if (range < 0.1f)
        {
            guidanceCommands[index] = float3.zero;
            return;
        }
        
        // Calculate line-of-sight rate
        float3 lineOfSight = math.normalize(relativePosition);
        float3 crossProduct = math.cross(relativePosition, relativeVelocity);
        float lineOfSightRate = math.length(crossProduct) / (range * range);
        
        // Calculate command direction perpendicular to line of sight
        float3 commandDirection = math.normalize(math.cross(lineOfSight, crossProduct));
        
        // Calculate guidance command magnitude
        float commandMagnitude = data.navigationConstant * lineOfSightRate * math.length(data.interceptorVelocity);
        
        // Apply acceleration limit
        if (commandMagnitude > data.maxAcceleration)
        {
            commandMagnitude = data.maxAcceleration;
        }
        
        guidanceCommands[index] = commandDirection * commandMagnitude;
    }
}
```

## Phase 3: Rendering Systems (Week 3-4)

### Step 1: Material Management

```csharp
// Create Assets/Scripts/Rendering/MaterialLibrary.cs
[CreateAssetMenu(fileName = "MaterialLibrary", menuName = "IronDome/Material Library")]
public class MaterialLibrary : ScriptableObject
{
    [Header("Base Materials")]
    public Material standardMaterial;
    public Material transparentMaterial;
    public Material emissiveMaterial;
    
    [Header("Threat Materials")]
    public Material rocketMaterial;
    public Material mortarMaterial;
    public Material droneMaterial;
    public Material ballisticMaterial;
    
    [Header("Effect Materials")]
    public Material explosionMaterial;
    public Material trailMaterial;
    public Material smokeMaterial;
    
    private Dictionary<string, Material> materialCache = new Dictionary<string, Material>();
    
    public Material GetCachedMaterial(string materialKey, System.Func<Material> createFunc)
    {
        if (!materialCache.ContainsKey(materialKey))
        {
            materialCache[materialKey] = createFunc();
        }
        return materialCache[materialKey];
    }
    
    public void ClearCache()
    {
        foreach (var material in materialCache.Values)
        {
            if (Application.isPlaying)
                DestroyImmediate(material);
        }
        materialCache.Clear();
    }
}
```

### Step 2: Instanced Rendering Implementation

```csharp
// Create Assets/Scripts/Rendering/InstancedThreatRenderer.cs
using Unity.Collections;
using Unity.Jobs;
using Unity.Mathematics;
using UnityEngine;

public class InstancedThreatRenderer : MonoBehaviour
{
    [Header("Configuration")]
    public MaterialLibrary materialLibrary;
    public int maxInstancesPerType = 100;
    
    [Header("Threat Meshes")]
    public Mesh rocketMesh;
    public Mesh mortarMesh;
    public Mesh droneMesh;
    public Mesh ballisticMesh;
    
    private Dictionary<ThreatType, InstancedThreatData> renderers = new Dictionary<ThreatType, InstancedThreatData>();
    private MaterialPropertyBlock propertyBlock;
    
    private struct InstancedThreatData
    {
        public Mesh mesh;
        public Material material;
        public Matrix4x4[] matrices;
        public Vector4[] colors;
        public int activeCount;
        public Dictionary<int, int> threatToIndex;
        public Queue<int> freeIndices;
    }
    
    void Start()
    {
        InitializeRenderers();
    }
    
    private void InitializeRenderers()
    {
        propertyBlock = new MaterialPropertyBlock();
        
        // Initialize each threat type
        InitializeThreatType(ThreatType.Rocket, rocketMesh, materialLibrary.rocketMaterial);
        InitializeThreatType(ThreatType.Mortar, mortarMesh, materialLibrary.mortarMaterial);
        InitializeThreatType(ThreatType.Drone, droneMesh, materialLibrary.droneMaterial);
        InitializeThreatType(ThreatType.Ballistic, ballisticMesh, materialLibrary.ballisticMaterial);
    }
    
    private void InitializeThreatType(ThreatType type, Mesh mesh, Material material)
    {
        var data = new InstancedThreatData
        {
            mesh = mesh,
            material = material,
            matrices = new Matrix4x4[maxInstancesPerType],
            colors = new Vector4[maxInstancesPerType],
            activeCount = 0,
            threatToIndex = new Dictionary<int, int>(),
            freeIndices = new Queue<int>()
        };
        
        // Initialize free indices
        for (int i = 0; i < maxInstancesPerType; i++)
        {
            data.freeIndices.Enqueue(i);
            data.matrices[i] = Matrix4x4.identity;
            data.colors[i] = Vector4.one;
        }
        
        renderers[type] = data;
    }
    
    public bool AddThreat(Threat threat)
    {
        ThreatType type = threat.GetThreatType();
        if (!renderers.ContainsKey(type)) return false;
        
        var data = renderers[type];
        if (data.freeIndices.Count == 0) return false;
        
        int index = data.freeIndices.Dequeue();
        data.threatToIndex[threat.GetInstanceID()] = index;
        data.activeCount = Mathf.Max(data.activeCount, index + 1);
        
        UpdateThreatInstance(threat, index, type);
        renderers[type] = data;
        
        return true;
    }
    
    public void RemoveThreat(Threat threat)
    {
        ThreatType type = threat.GetThreatType();
        if (!renderers.ContainsKey(type)) return;
        
        var data = renderers[type];
        int threatId = threat.GetInstanceID();
        
        if (data.threatToIndex.ContainsKey(threatId))
        {
            int index = data.threatToIndex[threatId];
            data.threatToIndex.Remove(threatId);
            data.freeIndices.Enqueue(index);
            
            // Hide the instance
            data.matrices[index] = Matrix4x4.zero;
            
            renderers[type] = data;
        }
    }
    
    public void UpdateThreats(List<Threat> threats)
    {
        // Group threats by type
        var threatsByType = new Dictionary<ThreatType, List<Threat>>();
        foreach (var threat in threats)
        {
            ThreatType type = threat.GetThreatType();
            if (!threatsByType.ContainsKey(type))
                threatsByType[type] = new List<Threat>();
            threatsByType[type].Add(threat);
        }
        
        // Update each type
        foreach (var kvp in threatsByType)
        {
            UpdateThreatType(kvp.Key, kvp.Value);
        }
    }
    
    private void UpdateThreatType(ThreatType type, List<Threat> threats)
    {
        if (!renderers.ContainsKey(type)) return;
        
        var data = renderers[type];
        
        foreach (var threat in threats)
        {
            int threatId = threat.GetInstanceID();
            if (data.threatToIndex.ContainsKey(threatId))
            {
                int index = data.threatToIndex[threatId];
                UpdateThreatInstance(threat, index, type);
            }
        }
        
        renderers[type] = data;
    }
    
    private void UpdateThreatInstance(Threat threat, int index, ThreatType type)
    {
        var data = renderers[type];
        
        // Update matrix
        data.matrices[index] = Matrix4x4.TRS(
            threat.transform.position,
            threat.transform.rotation,
            threat.transform.localScale
        );
        
        // Update color based on threat state
        Color threatColor = GetThreatColor(threat);
        data.colors[index] = new Vector4(threatColor.r, threatColor.g, threatColor.b, threatColor.a);
        
        renderers[type] = data;
    }
    
    private Color GetThreatColor(Threat threat)
    {
        // Color based on threat urgency, health, etc.
        float timeToImpact = threat.GetTimeToImpact();
        if (timeToImpact < 5f) return Color.red;
        if (timeToImpact < 10f) return Color.yellow;
        return Color.white;
    }
    
    void Update()
    {
        RenderAllInstances();
    }
    
    private void RenderAllInstances()
    {
        foreach (var kvp in renderers)
        {
            var data = kvp.Value;
            if (data.activeCount > 0)
            {
                // Set color array in property block
                propertyBlock.SetVectorArray("_Colors", data.colors);
                
                Graphics.DrawMeshInstanced(
                    mesh: data.mesh,
                    submeshIndex: 0,
                    material: data.material,
                    matrices: data.matrices,
                    count: data.activeCount,
                    properties: propertyBlock,
                    castShadows: UnityEngine.Rendering.ShadowCastingMode.Off,
                    receiveShadows: false,
                    layer: gameObject.layer
                );
            }
        }
    }
    
    public RenderingStats GetStats()
    {
        int totalActive = 0;
        int totalCapacity = 0;
        
        foreach (var data in renderers.Values)
        {
            totalActive += data.activeCount;
            totalCapacity += maxInstancesPerType;
        }
        
        return new RenderingStats
        {
            activeInstances = totalActive,
            totalCapacity = totalCapacity,
            utilization = (float)totalActive / totalCapacity,
            rendererCount = renderers.Count
        };
    }
}

public enum ThreatType
{
    Rocket,
    Mortar,
    Drone,
    Ballistic
}

[System.Serializable]
public struct RenderingStats
{
    public int activeInstances;
    public int totalCapacity;
    public float utilization;
    public int rendererCount;
}
```

## Phase 4: Game Logic (Week 4-5)

### Step 1: Threat Management System

```csharp
// Create Assets/Scripts/Systems/ThreatManager.cs
using System.Collections.Generic;
using UnityEngine;

public class ThreatManager : MonoBehaviour
{
    public static ThreatManager Instance { get; private set; }
    
    [Header("Threat Configuration")]
    public ThreatProfile[] threatProfiles;
    public int maxSimultaneousThreats = 50;
    public float spawnRadius = 500f;
    
    [Header("Spawning")]
    public float baseSpawnRate = 2f;
    public AnimationCurve difficultyProgression;
    
    private List<Threat> activeThreats = new List<Threat>();
    private ObjectPool<Threat> threatPool;
    private float lastSpawnTime;
    private int threatsSpawned = 0;
    
    void Awake()
    {
        if (Instance == null)
        {
            Instance = this;
        }
        else
        {
            Destroy(gameObject);
        }
    }
    
    public void Initialize()
    {
        // Initialize threat pool
        threatPool = GetComponent<ObjectPool<Threat>>();
        if (threatPool == null)
        {
            threatPool = gameObject.AddComponent<ObjectPool<Threat>>();
        }
        
        // Subscribe to events
        EventManager.Instance.Subscribe("ThreatDestroyed", OnThreatDestroyed);
        
        Debug.Log("ThreatManager initialized");
    }
    
    void Update()
    {
        UpdateThreats();
        CheckSpawning();
    }
    
    private void UpdateThreats()
    {
        for (int i = activeThreats.Count - 1; i >= 0; i--)
        {
            var threat = activeThreats[i];
            if (threat == null || !threat.IsActive())
            {
                RemoveThreat(threat, "Inactive");
                continue;
            }
            
            threat.UpdateThreat(Time.deltaTime);
            
            // Check ground impact
            if (threat.transform.position.y <= 0)
            {
                RemoveThreat(threat, "Ground Impact");
            }
        }
    }
    
    private void CheckSpawning()
    {
        if (activeThreats.Count >= maxSimultaneousThreats) return;
        
        float gameTime = GameManager.Instance.gameState.gameTime;
        float spawnRate = baseSpawnRate * difficultyProgression.Evaluate(gameTime / 60f); // Progress over minutes
        float spawnInterval = 1f / spawnRate;
        
        if (Time.time - lastSpawnTime >= spawnInterval)
        {
            SpawnThreat();
            lastSpawnTime = Time.time;
        }
    }
    
    private void SpawnThreat()
    {
        if (threatProfiles.Length == 0) return;
        
        // Select random threat type
        ThreatProfile profile = threatProfiles[Random.Range(0, threatProfiles.Length)];
        
        // Generate spawn position
        Vector3 spawnPos = GenerateSpawnPosition();
        Vector3 targetPos = GenerateTargetPosition();
        
        // Get threat from pool
        Threat threat = threatPool.Get();
        if (threat == null) return;
        
        // Initialize threat
        threat.Initialize(profile, spawnPos, targetPos);
        activeThreats.Add(threat);
        threatsSpawned++;
        
        // Notify systems
        EventManager.Instance.TriggerEvent("ThreatSpawned", new ThreatSpawnedData
        {
            threat = threat,
            spawnPosition = spawnPos,
            targetPosition = targetPos
        });
    }
    
    private Vector3 GenerateSpawnPosition()
    {
        // Spawn around perimeter
        float angle = Random.Range(0f, 2f * Mathf.PI);
        float distance = spawnRadius + Random.Range(0f, 100f);
        
        Vector3 position = new Vector3(
            Mathf.Cos(angle) * distance,
            Random.Range(100f, 300f), // Altitude
            Mathf.Sin(angle) * distance
        );
        
        return position;
    }
    
    private Vector3 GenerateTargetPosition()
    {
        // Target area around origin
        float range = 200f;
        return new Vector3(
            Random.Range(-range, range),
            0f,
            Random.Range(-range, range)
        );
    }
    
    public void RemoveThreat(Threat threat, string cause)
    {
        if (threat == null) return;
        
        activeThreats.Remove(threat);
        
        // Notify systems
        EventManager.Instance.TriggerEvent("ThreatDestroyed", new ThreatDestroyedData
        {
            threatId = threat.GetInstanceID().ToString(),
            position = threat.transform.position,
            wasIntercepted = cause == "Intercepted",
            cause = cause
        });
        
        // Return to pool
        threatPool.Return(threat);
    }
    
    private void OnThreatDestroyed(object data)
    {
        // Handle threat destruction logic
    }
    
    public List<Threat> GetActiveThreats()
    {
        return new List<Threat>(activeThreats);
    }
    
    public int GetActiveThreatCount()
    {
        return activeThreats.Count;
    }
    
    public ThreatManagerStats GetStats()
    {
        return new ThreatManagerStats
        {
            activeThreats = activeThreats.Count,
            maxThreats = maxSimultaneousThreats,
            threatsSpawned = threatsSpawned,
            pooledThreats = threatPool.GetPooledCount()
        };
    }
}

[System.Serializable]
public struct ThreatProfile
{
    public string name;
    public ThreatType type;
    public GameObject prefab;
    public float speed;
    public float health;
    public float priority;
}

[System.Serializable]
public struct ThreatSpawnedData
{
    public Threat threat;
    public Vector3 spawnPosition;
    public Vector3 targetPosition;
}

[System.Serializable]
public struct ThreatManagerStats
{
    public int activeThreats;
    public int maxThreats;
    public int threatsSpawned;
    public int pooledThreats;
}
```

### Step 2: Iron Dome Battery Implementation

```csharp
// Create Assets/Scripts/Entities/IronDomeBattery.cs
using System.Collections.Generic;
using UnityEngine;

public class IronDomeBattery : MonoBehaviour
{
    [Header("Configuration")]
    public BatteryConfiguration config;
    
    [Header("Components")]
    public Transform radarAntenna;
    public Transform[] launcherTubes;
    public ParticleSystem launchEffects;
    public AudioSource audioSource;
    
    [Header("Detection")]
    public LayerMask threatLayer = 1 << 8;
    
    private List<Threat> detectedThreats = new List<Threat>();
    private List<float> tubeReloadTimes;
    private SphereCollider detectionZone;
    private int nextTubeIndex = 0;
    private float lastFireTime = 0f;
    private int interceptorsFired = 0;
    
    // Events
    public event System.Action<Threat> OnThreatDetected;
    public event System.Action<Threat> OnInterceptorFired;
    
    void Start()
    {
        InitializeBattery();
    }
    
    private void InitializeBattery()
    {
        // Setup detection zone
        detectionZone = gameObject.AddComponent<SphereCollider>();
        detectionZone.radius = config.radarRange;
        detectionZone.isTrigger = true;
        gameObject.layer = LayerMask.NameToLayer("Detection");
        
        // Initialize tube reload times
        tubeReloadTimes = new List<float>();
        for (int i = 0; i < launcherTubes.Length; i++)
        {
            tubeReloadTimes.Add(0f);
        }
        
        Debug.Log($"Battery {name} initialized with {launcherTubes.Length} tubes");
    }
    
    void Update()
    {
        UpdateDetection();
        UpdateTargeting();
        UpdateReloading();
    }
    
    private void UpdateDetection()
    {
        // Remove null or inactive threats
        detectedThreats.RemoveAll(t => t == null || !t.IsActive());
        
        // Rotate radar antenna
        if (radarAntenna != null)
        {
            radarAntenna.Rotate(0, config.radarRotationSpeed * Time.deltaTime, 0);
        }
    }
    
    private void UpdateTargeting()
    {
        if (detectedThreats.Count == 0) return;
        
        // Find best target
        Threat bestTarget = SelectBestTarget();
        if (bestTarget != null && CanEngageTarget(bestTarget))
        {
            FireInterceptor(bestTarget);
        }
    }
    
    private void UpdateReloading()
    {
        for (int i = 0; i < tubeReloadTimes.Count; i++)
        {
            if (tubeReloadTimes[i] > 0)
            {
                tubeReloadTimes[i] -= Time.deltaTime;
            }
        }
    }
    
    private Threat SelectBestTarget()
    {
        if (detectedThreats.Count == 0) return null;
        
        Threat bestTarget = null;
        float bestScore = float.MinValue;
        
        foreach (var threat in detectedThreats)
        {
            float score = CalculateTargetScore(threat);
            if (score > bestScore)
            {
                bestScore = score;
                bestTarget = threat;
            }
        }
        
        return bestTarget;
    }
    
    private float CalculateTargetScore(Threat threat)
    {
        float distance = Vector3.Distance(transform.position, threat.transform.position);
        float timeToImpact = threat.GetTimeToImpact();
        float priority = threat.GetPriority();
        
        // Prioritize closer, higher priority threats with less time to impact
        float distanceScore = 1f - (distance / config.radarRange);
        float timeScore = 1f / Mathf.Max(timeToImpact, 0.1f);
        float priorityScore = priority;
        
        return distanceScore + timeScore * 2f + priorityScore * 3f;
    }
    
    private bool CanEngageTarget(Threat threat)
    {
        // Check if target is in range
        float distance = Vector3.Distance(transform.position, threat.transform.position);
        if (distance < config.minRange || distance > config.maxRange)
            return false;
        
        // Check if any tube is ready
        if (!HasReadyTube()) return false;
        
        // Check firing rate limit
        if (Time.time - lastFireTime < config.firingDelay)
            return false;
        
        // Check intercept probability
        float interceptProbability = CalculateInterceptProbability(threat);
        return interceptProbability > config.minimumInterceptProbability;
    }
    
    private bool HasReadyTube()
    {
        for (int i = 0; i < tubeReloadTimes.Count; i++)
        {
            if (tubeReloadTimes[i] <= 0)
                return true;
        }
        return false;
    }
    
    private int GetReadyTubeIndex()
    {
        // Round-robin tube selection
        for (int i = 0; i < tubeReloadTimes.Count; i++)
        {
            int tubeIndex = (nextTubeIndex + i) % tubeReloadTimes.Count;
            if (tubeReloadTimes[tubeIndex] <= 0)
            {
                nextTubeIndex = (tubeIndex + 1) % tubeReloadTimes.Count;
                return tubeIndex;
            }
        }
        return -1;
    }
    
    private float CalculateInterceptProbability(Threat threat)
    {
        float distance = Vector3.Distance(transform.position, threat.transform.position);
        float timeToImpact = threat.GetTimeToImpact();
        
        // Base probability modified by distance and time factors
        float distanceFactor = Mathf.Clamp01(1f - (distance / config.maxRange));
        float timeFactor = Mathf.Clamp01(timeToImpact / 10f); // More time = better chance
        
        return config.baseSuccessRate * distanceFactor * timeFactor;
    }
    
    private void FireInterceptor(Threat target)
    {
        int tubeIndex = GetReadyTubeIndex();
        if (tubeIndex < 0) return;
        
        // Calculate intercept velocity
        Vector3 interceptVelocity = BallisticsCalculator.CalculateInterceptVelocity(
            transform.position,
            target.transform.position,
            target.GetVelocity(),
            config.interceptorSpeed
        );
        
        if (interceptVelocity == Vector3.zero) return; // No intercept solution
        
        // Create interceptor
        GameObject interceptorObj = InterceptorPool.Instance.GetInterceptor();
        if (interceptorObj == null) return;
        
        Interceptor interceptor = interceptorObj.GetComponent<Interceptor>();
        interceptor.Initialize(
            launcherTubes[tubeIndex].position,
            interceptVelocity,
            target,
            this
        );
        
        // Start tube reload
        tubeReloadTimes[tubeIndex] = config.reloadTime;
        lastFireTime = Time.time;
        interceptorsFired++;
        
        // Play effects
        PlayLaunchEffects(tubeIndex);
        
        // Notify systems
        OnInterceptorFired?.Invoke(target);
        EventManager.Instance.TriggerEvent("InterceptorFired", new InterceptorFiredData
        {
            battery = this,
            target = target,
            launchPosition = launcherTubes[tubeIndex].position,
            interceptor = interceptor
        });
        
        Debug.Log($"Battery {name} fired interceptor at {target.name}");
    }
    
    private void PlayLaunchEffects(int tubeIndex)
    {
        // Particle effects
        if (launchEffects != null)
        {
            launchEffects.transform.position = launcherTubes[tubeIndex].position;
            launchEffects.Play();
        }
        
        // Audio
        if (audioSource != null)
        {
            audioSource.PlayOneShot(audioSource.clip);
        }
    }
    
    void OnTriggerEnter(Collider other)
    {
        if ((threatLayer.value & (1 << other.gameObject.layer)) != 0)
        {
            Threat threat = other.GetComponent<Threat>();
            if (threat != null && !detectedThreats.Contains(threat))
            {
                detectedThreats.Add(threat);
                OnThreatDetected?.Invoke(threat);
                
                Debug.Log($"Battery {name} detected threat: {threat.name}");
            }
        }
    }
    
    void OnTriggerExit(Collider other)
    {
        if ((threatLayer.value & (1 << other.gameObject.layer)) != 0)
        {
            Threat threat = other.GetComponent<Threat>();
            if (threat != null)
            {
                detectedThreats.Remove(threat);
            }
        }
    }
    
    public BatteryStats GetStats()
    {
        int readyTubes = 0;
        for (int i = 0; i < tubeReloadTimes.Count; i++)
        {
            if (tubeReloadTimes[i] <= 0) readyTubes++;
        }
        
        return new BatteryStats
        {
            detectedThreats = detectedThreats.Count,
            readyTubes = readyTubes,
            totalTubes = launcherTubes.Length,
            interceptorsFired = interceptorsFired,
            averageReloadTime = GetAverageReloadTime()
        };
    }
    
    private float GetAverageReloadTime()
    {
        float total = 0;
        foreach (float time in tubeReloadTimes)
        {
            total += Mathf.Max(0, time);
        }
        return total / tubeReloadTimes.Count;
    }
}

[System.Serializable]
public struct BatteryConfiguration
{
    public float radarRange;
    public float maxRange;
    public float minRange;
    public float interceptorSpeed;
    public float reloadTime;
    public float firingDelay;
    public float baseSuccessRate;
    public float minimumInterceptProbability;
    public float radarRotationSpeed;
}

[System.Serializable]
public struct InterceptorFiredData
{
    public IronDomeBattery battery;
    public Threat target;
    public Vector3 launchPosition;
    public Interceptor interceptor;
}

[System.Serializable]
public struct BatteryStats
{
    public int detectedThreats;
    public int readyTubes;
    public int totalTubes;
    public int interceptorsFired;
    public float averageReloadTime;
}
```

## Phase 5: Optimization (Week 5-6)

### Step 1: Performance Monitoring

```csharp
// Create Assets/Scripts/Systems/PerformanceManager.cs
using Unity.Profiling;
using UnityEngine;

public class PerformanceManager : MonoBehaviour
{
    public static PerformanceManager Instance { get; private set; }
    
    [Header("Performance Targets")]
    public float targetFrameTime = 16.67f; // 60 FPS
    public float warningThreshold = 20f;
    public float criticalThreshold = 33.33f; // 30 FPS
    
    [Header("Monitoring")]
    public bool enableProfiling = true;
    public float monitoringInterval = 1f;
    
    private ProfilerRecorder frameTimeRecorder;
    private ProfilerRecorder triangleCountRecorder;
    private ProfilerRecorder drawCallsRecorder;
    private ProfilerRecorder memoryRecorder;
    
    private float[] frameTimeHistory = new float[60];
    private int frameIndex = 0;
    private float lastMonitorTime = 0f;
    
    // Performance state
    private PerformanceLevel currentLevel = PerformanceLevel.High;
    
    public enum PerformanceLevel
    {
        High,
        Medium,
        Low,
        Critical
    }
    
    void Awake()
    {
        if (Instance == null)
        {
            Instance = this;
        }
        else
        {
            Destroy(gameObject);
        }
    }
    
    public void Initialize()
    {
        if (enableProfiling)
        {
            StartProfiling();
        }
        
        Debug.Log("PerformanceManager initialized");
    }
    
    private void StartProfiling()
    {
        frameTimeRecorder = ProfilerRecorder.StartNew(ProfilerCategory.Internal, "Main Thread", 15);
        triangleCountRecorder = ProfilerRecorder.StartNew(ProfilerCategory.Render, "Triangles");
        drawCallsRecorder = ProfilerRecorder.StartNew(ProfilerCategory.Render, "Draw Calls");
        memoryRecorder = ProfilerRecorder.StartNew(ProfilerCategory.Memory, "System Used Memory");
    }
    
    void Update()
    {
        RecordFrameTime();
        
        if (Time.time - lastMonitorTime >= monitoringInterval)
        {
            MonitorPerformance();
            lastMonitorTime = Time.time;
        }
    }
    
    private void RecordFrameTime()
    {
        frameTimeHistory[frameIndex] = Time.unscaledDeltaTime * 1000f;
        frameIndex = (frameIndex + 1) % frameTimeHistory.Length;
    }
    
    private void MonitorPerformance()
    {
        float averageFrameTime = CalculateAverageFrameTime();
        PerformanceLevel newLevel = DeterminePerformanceLevel(averageFrameTime);
        
        if (newLevel != currentLevel)
        {
            OnPerformanceLevelChanged(currentLevel, newLevel);
            currentLevel = newLevel;
        }
        
        // Log performance data
        if (enableProfiling)
        {
            LogPerformanceData(averageFrameTime);
        }
    }
    
    private float CalculateAverageFrameTime()
    {
        float total = 0f;
        for (int i = 0; i < frameTimeHistory.Length; i++)
        {
            total += frameTimeHistory[i];
        }
        return total / frameTimeHistory.Length;
    }
    
    private PerformanceLevel DeterminePerformanceLevel(float frameTime)
    {
        if (frameTime >= criticalThreshold) return PerformanceLevel.Critical;
        if (frameTime >= warningThreshold) return PerformanceLevel.Low;
        if (frameTime >= targetFrameTime * 1.2f) return PerformanceLevel.Medium;
        return PerformanceLevel.High;
    }
    
    private void OnPerformanceLevelChanged(PerformanceLevel oldLevel, PerformanceLevel newLevel)
    {
        Debug.Log($"Performance level changed: {oldLevel} -> {newLevel}");
        
        // Trigger performance adjustments
        EventManager.Instance.TriggerEvent("PerformanceLevelChanged", new PerformanceLevelChangedData
        {
            oldLevel = oldLevel,
            newLevel = newLevel,
            averageFrameTime = CalculateAverageFrameTime()
        });
        
        // Apply automatic optimizations
        ApplyPerformanceOptimizations(newLevel);
    }
    
    private void ApplyPerformanceOptimizations(PerformanceLevel level)
    {
        switch (level)
        {
            case PerformanceLevel.Critical:
                // Emergency optimizations
                ThreatManager.Instance?.SetMaxThreats(25);
                QualitySettings.SetQualityLevel(0); // Lowest quality
                break;
                
            case PerformanceLevel.Low:
                // Reduce quality
                ThreatManager.Instance?.SetMaxThreats(35);
                QualitySettings.SetQualityLevel(1);
                break;
                
            case PerformanceLevel.Medium:
                // Moderate reductions
                ThreatManager.Instance?.SetMaxThreats(40);
                QualitySettings.SetQualityLevel(2);
                break;
                
            case PerformanceLevel.High:
                // Restore full quality
                ThreatManager.Instance?.SetMaxThreats(50);
                QualitySettings.SetQualityLevel(3);
                break;
        }
    }
    
    private void LogPerformanceData(float frameTime)
    {
        if (!frameTimeRecorder.Valid) return;
        
        long triangles = triangleCountRecorder.Valid ? triangleCountRecorder.LastValue : 0;
        long drawCalls = drawCallsRecorder.Valid ? drawCallsRecorder.LastValue : 0;
        long memory = memoryRecorder.Valid ? memoryRecorder.LastValue : 0;
        
        Debug.Log($"Performance - Frame: {frameTime:F1}ms, Triangles: {triangles}, Draws: {drawCalls}, Memory: {memory / (1024 * 1024)}MB");
    }
    
    public PerformanceData GetCurrentPerformanceData()
    {
        return new PerformanceData
        {
            averageFrameTime = CalculateAverageFrameTime(),
            currentFPS = 1000f / CalculateAverageFrameTime(),
            triangleCount = triangleCountRecorder.Valid ? (int)triangleCountRecorder.LastValue : 0,
            drawCalls = drawCallsRecorder.Valid ? (int)drawCallsRecorder.LastValue : 0,
            memoryUsage = memoryRecorder.Valid ? memoryRecorder.LastValue / (1024 * 1024) : 0,
            performanceLevel = currentLevel
        };
    }
    
    void OnDisable()
    {
        frameTimeRecorder.Dispose();
        triangleCountRecorder.Dispose();
        drawCallsRecorder.Dispose();
        memoryRecorder.Dispose();
    }
}

[System.Serializable]
public struct PerformanceLevelChangedData
{
    public PerformanceManager.PerformanceLevel oldLevel;
    public PerformanceManager.PerformanceLevel newLevel;
    public float averageFrameTime;
}

[System.Serializable]
public struct PerformanceData
{
    public float averageFrameTime;
    public float currentFPS;
    public int triangleCount;
    public int drawCalls;
    public long memoryUsage;
    public PerformanceManager.PerformanceLevel performanceLevel;
}
```

## Testing and Validation

### Step 1: Unit Test Framework

```csharp
// Create Assets/Scripts/Tests/BallisticsTests.cs
using NUnit.Framework;
using UnityEngine;
using Unity.Mathematics;

public class BallisticsTests
{
    [Test]
    public void TestTrajectoryCalculation()
    {
        // Arrange
        Vector3 startPos = Vector3.zero;
        Vector3 startVel = new Vector3(0, 100, 100); // 45-degree angle
        
        // Act
        var calculator = new GameObject().AddComponent<BallisticsCalculator>();
        TrajectoryData trajectory = calculator.CalculateTrajectory(startPos, startVel);
        
        // Assert
        Assert.IsNotNull(trajectory.positions);
        Assert.Greater(trajectory.positions.Length, 0);
        Assert.Greater(trajectory.flightTime, 0);
        
        // Check that trajectory follows expected physics
        Vector3 firstPos = trajectory.positions[0];
        Vector3 lastPos = trajectory.positions[trajectory.positions.Length - 1];
        
        Assert.AreEqual(startPos, firstPos, "Start position should match");
        Assert.LessOrEqual(lastPos.y, 0.1f, "Should end near ground");
    }
    
    [Test]
    public void TestInterceptVelocityCalculation()
    {
        // Arrange
        Vector3 shooterPos = Vector3.zero;
        Vector3 targetPos = new Vector3(100, 50, 100);
        Vector3 targetVel = new Vector3(10, 0, 10);
        float projectileSpeed = 150f;
        
        // Act
        Vector3 interceptVel = BallisticsCalculator.CalculateInterceptVelocity(
            shooterPos, targetPos, targetVel, projectileSpeed);
        
        // Assert
        Assert.AreNotEqual(Vector3.zero, interceptVel, "Should have valid intercept solution");
        Assert.AreApproximatelyEqual(projectileSpeed, interceptVel.magnitude, 0.1f, 
            "Intercept velocity magnitude should match projectile speed");
    }
    
    [Test]
    public void TestProportionalNavigation()
    {
        // Arrange
        Vector3 interceptorPos = Vector3.zero;
        Vector3 interceptorVel = new Vector3(0, 0, 100);
        Vector3 targetPos = new Vector3(50, 0, 100);
        Vector3 targetVel = new Vector3(20, 0, 0);
        float navConstant = 3f;
        
        // Act
        // This would test the guidance system
        // Implementation depends on final guidance system structure
        
        // Assert
        // Verify guidance command is perpendicular to line of sight
        // Verify command magnitude is reasonable
    }
}

// Create Assets/Scripts/Tests/ThreatManagerTests.cs
using NUnit.Framework;
using UnityEngine;
using System.Collections;
using UnityEngine.TestTools;

public class ThreatManagerTests
{
    private GameObject testGameObject;
    private ThreatManager threatManager;
    
    [SetUp]
    public void Setup()
    {
        testGameObject = new GameObject("ThreatManagerTest");
        threatManager = testGameObject.AddComponent<ThreatManager>();
    }
    
    [TearDown]
    public void Teardown()
    {
        if (testGameObject != null)
        {
            Object.DestroyImmediate(testGameObject);
        }
    }
    
    [Test]
    public void TestThreatSpawning()
    {
        // Arrange
        threatManager.maxSimultaneousThreats = 10;
        
        // Act
        threatManager.Initialize();
        
        // Assert
        Assert.AreEqual(0, threatManager.GetActiveThreatCount(), "Should start with no threats");
    }
    
    [UnityTest]
    public IEnumerator TestThreatLifecycle()
    {
        // This would test threat spawning, tracking, and destruction
        // Implementation depends on final threat system structure
        
        yield return new WaitForSeconds(0.1f);
        
        Assert.Pass("Threat lifecycle test placeholder");
    }
}
```

### Step 2: Integration Tests

```csharp
// Create Assets/Scripts/Tests/IntegrationTests.cs
using NUnit.Framework;
using UnityEngine;
using System.Collections;
using UnityEngine.TestTools;

public class IntegrationTests
{
    [UnityTest]
    public IEnumerator TestBatteryThreatInteraction()
    {
        // Setup scene with battery and threat
        GameObject batteryObj = new GameObject("TestBattery");
        IronDomeBattery battery = batteryObj.AddComponent<IronDomeBattery>();
        
        GameObject threatObj = new GameObject("TestThreat");
        Threat threat = threatObj.AddComponent<Threat>();
        
        // Position threat in battery's detection range
        threatObj.transform.position = new Vector3(50, 50, 50);
        
        // Wait for detection
        yield return new WaitForSeconds(1f);
        
        // Verify threat was detected
        var stats = battery.GetStats();
        Assert.Greater(stats.detectedThreats, 0, "Battery should detect threat");
        
        // Cleanup
        Object.DestroyImmediate(batteryObj);
        Object.DestroyImmediate(threatObj);
    }
    
    [UnityTest]
    public IEnumerator TestPerformanceUnderLoad()
    {
        // Create multiple threats and batteries
        for (int i = 0; i < 20; i++)
        {
            GameObject threat = new GameObject($"Threat_{i}");
            threat.AddComponent<Threat>();
        }
        
        for (int i = 0; i < 3; i++)
        {
            GameObject battery = new GameObject($"Battery_{i}");
            battery.AddComponent<IronDomeBattery>();
        }
        
        // Run for several frames
        for (int frame = 0; frame < 60; frame++)
        {
            yield return null;
        }
        
        // Check performance is acceptable
        PerformanceData perfData = PerformanceManager.Instance.GetCurrentPerformanceData();
        Assert.Less(perfData.averageFrameTime, 33.33f, "Frame time should be under 30 FPS threshold");
        
        // Cleanup would happen automatically with scene change
    }
}
```

This implementation guide provides a structured approach to porting the Iron Dome simulator to Unity while preserving all the critical performance optimizations and sophisticated game logic systems. Each phase builds upon the previous one, ensuring a stable foundation for the complex systems.