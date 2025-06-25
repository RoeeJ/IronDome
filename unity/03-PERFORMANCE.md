# Iron Dome Simulator - Performance Optimization Guide

## Table of Contents
1. [Current Performance Profile](#current-performance-profile)
2. [Critical Optimization Systems](#critical-optimization-systems)
3. [Unity Performance Advantages](#unity-performance-advantages)
4. [Memory Management Strategy](#memory-management-strategy)
5. [Mobile Optimization](#mobile-optimization)
6. [Performance Monitoring](#performance-monitoring)

## Current Performance Profile

### Baseline Performance Metrics
- **Frame Rate**: 60 FPS stable at 8-15ms frame time
- **Simultaneous Objects**: 50 threats + 8 interceptors + 20 effects
- **Triangle Count**: 15K-40K dynamic range during combat
- **Memory Usage**: <2GB with automatic cleanup systems
- **Draw Calls**: 200-350 (optimized through instancing)
- **Shader Programs**: 315+ (recently optimized to prevent growth)

### Performance Bottlenecks Identified and Solved
1. **Shader Compilation Freezes**: 1000ms+ freezes eliminated via MaterialCache
2. **Memory Leaks**: WebGL Error Code 5 prevented through MemoryMonitor
3. **Triangle Count Spikes**: Reduced through LOD and geometry optimization
4. **Particle System Overhead**: 70% reduction in particle counts
5. **Event Listener Leaks**: Fixed unbounded growth in mobile input

### Critical Performance Limits
```typescript
// Hard limits for stable 60 FPS
const PERFORMANCE_LIMITS = {
  MAX_THREATS: 50,           // Simultaneous threat objects
  MAX_INTERCEPTORS: 8,       // Active interceptors in flight
  MAX_EXPLOSION_EFFECTS: 20, // Active explosion particle systems
  MAX_DYNAMIC_LIGHTS: 15,    // Point lights in scene
  TARGET_FRAME_TIME: 16.67,  // 60 FPS in milliseconds
  MEMORY_WARNING_THRESHOLD: 1.8, // GB before cleanup
  TRIANGLE_COUNT_WARNING: 35000   // Triangles before LOD reduction
};
```

## Critical Optimization Systems

### 1. MaterialCache System (Prevents Shader Compilation)

**Problem Solved**: Direct material creation was causing 1000ms+ freezes when spawning multiple objects with unique shader programs.

```typescript
// Three.js Implementation
class MaterialCache {
  private materials = new Map<string, THREE.Material>();
  
  getMeshStandardMaterial(properties: MaterialProps): THREE.MeshStandardMaterial {
    const key = `standard_${properties.color}_${properties.roughness}_${properties.metalness}`;
    if (!this.materials.has(key)) {
      this.materials.set(key, new THREE.MeshStandardMaterial(properties));
    }
    return this.materials.get(key) as THREE.MeshStandardMaterial;
  }
}
```

**Unity Implementation**:
```csharp
public class MaterialManager : MonoBehaviour
{
    [Header("Material Caching")]
    public Shader standardShader;
    public int maxCachedMaterials = 100;
    
    private Dictionary<string, Material> materialCache = new Dictionary<string, Material>();
    private Queue<string> accessOrder = new Queue<string>();
    
    public Material GetStandardMaterial(Color color, float metallic, float smoothness)
    {
        string key = $"std_{ColorUtility.ToHtmlStringRGB(color)}_{metallic:F2}_{smoothness:F2}";
        
        if (!materialCache.ContainsKey(key))
        {
            if (materialCache.Count >= maxCachedMaterials)
            {
                EvictOldestMaterial();
            }
            
            Material material = new Material(standardShader);
            material.color = color;
            material.SetFloat("_Metallic", metallic);
            material.SetFloat("_Smoothness", smoothness);
            
            materialCache[key] = material;
        }
        
        // Track access for LRU eviction
        accessOrder.Enqueue(key);
        return materialCache[key];
    }
    
    private void EvictOldestMaterial()
    {
        if (accessOrder.Count > 0)
        {
            string oldestKey = accessOrder.Dequeue();
            if (materialCache.ContainsKey(oldestKey))
            {
                DestroyImmediate(materialCache[oldestKey]);
                materialCache.Remove(oldestKey);
            }
        }
    }
}
```

### 2. Instanced Rendering System

**Performance Gain**: 10x improvement over individual object rendering for large numbers of similar objects.

```typescript
// Three.js Instanced Mesh
class InstancedThreatRenderer {
  private threatMeshes: { [key: string]: THREE.InstancedMesh } = {};
  
  updateThreats(threats: Threat[]): void {
    threats.forEach((threat, index) => {
      const mesh = this.threatMeshes[threat.type];
      this.dummy.position.copy(threat.getPosition());
      this.dummy.rotation.copy(threat.getRotation());
      this.dummy.updateMatrix();
      mesh.setMatrixAt(index, this.dummy.matrix);
    });
    
    Object.values(this.threatMeshes).forEach(mesh => {
      mesh.instanceMatrix.needsUpdate = true;
    });
  }
}
```

**Unity Implementation with Job System**:
```csharp
using Unity.Collections;
using Unity.Jobs;
using Unity.Mathematics;

public class InstancedThreatRenderer : MonoBehaviour
{
    [Header("Instancing")]
    public Mesh threatMesh;
    public Material threatMaterial;
    public int maxInstances = 1000;
    
    private NativeArray<Matrix4x4> matrices;
    private NativeArray<Vector4> colors;
    private MaterialPropertyBlock propertyBlock;
    private ComputeBuffer matrixBuffer;
    private ComputeBuffer colorBuffer;
    
    [BurstCompile]
    struct UpdateMatricesJob : IJobParallelFor
    {
        [ReadOnly] public NativeArray<float3> positions;
        [ReadOnly] public NativeArray<quaternion> rotations;
        [ReadOnly] public NativeArray<float3> scales;
        
        public NativeArray<Matrix4x4> matrices;
        
        public void Execute(int index)
        {
            matrices[index] = Matrix4x4.TRS(positions[index], rotations[index], scales[index]);
        }
    }
    
    void Start()
    {
        matrices = new NativeArray<Matrix4x4>(maxInstances, Allocator.Persistent);
        colors = new NativeArray<Vector4>(maxInstances, Allocator.Persistent);
        
        matrixBuffer = new ComputeBuffer(maxInstances, sizeof(float) * 16);
        colorBuffer = new ComputeBuffer(maxInstances, sizeof(float) * 4);
        
        propertyBlock = new MaterialPropertyBlock();
    }
    
    public void UpdateInstances(NativeArray<float3> positions, NativeArray<quaternion> rotations, NativeArray<float3> scales, int count)
    {
        // Use Job System for parallel matrix calculation
        UpdateMatricesJob job = new UpdateMatricesJob
        {
            positions = positions,
            rotations = rotations,
            scales = scales,
            matrices = matrices
        };
        
        JobHandle jobHandle = job.Schedule(count, 32);
        jobHandle.Complete();
        
        // Update GPU buffers
        matrixBuffer.SetData(matrices, 0, 0, count);
        colorBuffer.SetData(colors, 0, 0, count);
        
        propertyBlock.SetBuffer("_MatrixBuffer", matrixBuffer);
        propertyBlock.SetBuffer("_ColorBuffer", colorBuffer);
        
        // Render instances
        Graphics.DrawMeshInstanced(threatMesh, 0, threatMaterial, matrices.Slice(0, count).ToArray(), count, propertyBlock);
    }
}
```

### 3. LOD System with Distance Culling

**Performance Gain**: 30-50% triangle reduction at distance, maintaining visual quality.

```typescript
// Three.js LOD Implementation
class LODInstancedThreatRenderer {
  private getLODLevel(position: THREE.Vector3): number {
    const distance = position.distanceTo(this.camera.position);
    if (distance < 50) return 0; // High detail
    if (distance < 200) return 1; // Medium detail
    return 2; // Low detail
  }
}
```

**Unity Implementation with Native LOD**:
```csharp
public class AdaptiveLODManager : MonoBehaviour
{
    [Header("LOD Configuration")]
    public LODLevel[] lodLevels;
    public Camera referenceCamera;
    public float updateInterval = 0.1f;
    
    [System.Serializable]
    public struct LODLevel
    {
        public float screenRelativeTransitionHeight;
        public int triangleReduction; // Percentage
        public bool enableShadows;
        public int textureQuality; // 0-3
    }
    
    private Dictionary<GameObject, LODGroup> managedObjects = new Dictionary<GameObject, LODGroup>();
    private float lastUpdateTime;
    
    void Update()
    {
        if (Time.time - lastUpdateTime > updateInterval)
        {
            UpdateLODLevels();
            lastUpdateTime = Time.time;
        }
    }
    
    public void RegisterObject(GameObject obj, Mesh[] lodMeshes, Material material)
    {
        LODGroup lodGroup = obj.GetComponent<LODGroup>();
        if (lodGroup == null)
        {
            lodGroup = obj.AddComponent<LODGroup>();
        }
        
        LOD[] lods = new LOD[lodLevels.Length];
        
        for (int i = 0; i < lodLevels.Length; i++)
        {
            GameObject lodObject = new GameObject($"LOD{i}");
            lodObject.transform.parent = obj.transform;
            lodObject.transform.localPosition = Vector3.zero;
            
            MeshRenderer renderer = lodObject.AddComponent<MeshRenderer>();
            MeshFilter filter = lodObject.AddComponent<MeshFilter>();
            
            filter.mesh = lodMeshes[i];
            renderer.material = material;
            renderer.shadowCastingMode = lodLevels[i].enableShadows ? 
                UnityEngine.Rendering.ShadowCastingMode.On : 
                UnityEngine.Rendering.ShadowCastingMode.Off;
            
            lods[i] = new LOD(lodLevels[i].screenRelativeTransitionHeight, new Renderer[] { renderer });
        }
        
        lodGroup.SetLODs(lods);
        lodGroup.RecalculateBounds();
        managedObjects[obj] = lodGroup;
    }
    
    private void UpdateLODLevels()
    {
        foreach (var kvp in managedObjects)
        {
            if (kvp.Key != null)
            {
                float distance = Vector3.Distance(kvp.Key.transform.position, referenceCamera.transform.position);
                
                // Adaptive LOD based on performance
                float performanceMultiplier = GetPerformanceMultiplier();
                float adjustedDistance = distance * performanceMultiplier;
                
                // Update LOD group if needed
                UpdateLODGroupForDistance(kvp.Value, adjustedDistance);
            }
        }
    }
    
    private float GetPerformanceMultiplier()
    {
        float averageFrameTime = Time.smoothDeltaTime * 1000f;
        if (averageFrameTime > 20f) return 1.5f; // Aggressive LOD
        if (averageFrameTime > 16.67f) return 1.2f; // Moderate LOD
        return 1.0f; // Normal LOD
    }
}
```

### 4. Memory Management and Cleanup

**Problem Solved**: WebGL Error Code 5 crashes from memory exhaustion.

```typescript
// Three.js Memory Monitor
class MemoryMonitor {
  private readonly WARNING_THRESHOLD = 0.9; // 90% of available memory
  
  checkMemoryUsage(): void {
    const memInfo = (performance as any).memory;
    if (memInfo) {
      const usage = memInfo.usedJSHeapSize / memInfo.totalJSHeapSize;
      if (usage > this.WARNING_THRESHOLD) {
        this.triggerEmergencyCleanup();
      }
    }
  }
  
  triggerEmergencyCleanup(): void {
    // Remove 50% of oldest effects
    this.explosionManager.cleanupOldEffects(0.5);
    // Remove distant debris
    this.debrisSystem.cleanupDistantDebris();
    // Force garbage collection
    if ((window as any).gc) (window as any).gc();
  }
}
```

**Unity Implementation with Profiler Integration**:
```csharp
using Unity.Profiling;

public class MemoryManager : MonoBehaviour
{
    [Header("Memory Monitoring")]
    public float memoryWarningThreshold = 1.8f; // GB
    public float emergencyThreshold = 2.5f; // GB
    public float checkInterval = 5f;
    
    private ProfilerRecorder systemMemoryRecorder;
    private ProfilerRecorder gcMemoryRecorder;
    private float lastCheckTime;
    
    void OnEnable()
    {
        systemMemoryRecorder = ProfilerRecorder.StartNew(ProfilerCategory.Memory, "System Used Memory");
        gcMemoryRecorder = ProfilerRecorder.StartNew(ProfilerCategory.Memory, "GC Reserved Memory");
    }
    
    void OnDisable()
    {
        systemMemoryRecorder.Dispose();
        gcMemoryRecorder.Dispose();
    }
    
    void Update()
    {
        if (Time.time - lastCheckTime > checkInterval)
        {
            CheckMemoryUsage();
            lastCheckTime = Time.time;
        }
    }
    
    private void CheckMemoryUsage()
    {
        if (!systemMemoryRecorder.Valid) return;
        
        long systemMemory = systemMemoryRecorder.LastValue;
        long gcMemory = gcMemoryRecorder.LastValue;
        
        float systemMemoryGB = systemMemory / (1024f * 1024f * 1024f);
        float gcMemoryGB = gcMemory / (1024f * 1024f * 1024f);
        
        if (systemMemoryGB > emergencyThreshold)
        {
            TriggerEmergencyCleanup();
        }
        else if (systemMemoryGB > memoryWarningThreshold)
        {
            TriggerPreventiveCleanup();
        }
    }
    
    private void TriggerEmergencyCleanup()
    {
        Debug.LogWarning($"Emergency memory cleanup triggered at {GetTotalMemoryUsage():F2} GB");
        
        // Clean up effects
        var explosionManager = FindObjectOfType<ExplosionManager>();
        explosionManager?.CleanupOldEffects(0.6f);
        
        // Clean up pooled objects
        var projectilePool = FindObjectOfType<ProjectilePool>();
        projectilePool?.EmergencyCleanup();
        
        // Force garbage collection
        System.GC.Collect();
        System.GC.WaitForPendingFinalizers();
        System.GC.Collect();
        
        // Unload unused assets
        Resources.UnloadUnusedAssets();
    }
    
    private void TriggerPreventiveCleanup()
    {
        Debug.Log($"Preventive memory cleanup at {GetTotalMemoryUsage():F2} GB");
        
        // Milder cleanup operations
        var effectsManager = FindObjectOfType<EffectsManager>();
        effectsManager?.CleanupFinishedEffects();
        
        // Clean up audio clips
        AudioClipManager.Instance?.CleanupUnusedClips();
    }
    
    private float GetTotalMemoryUsage()
    {
        return (systemMemoryRecorder.LastValue + gcMemoryRecorder.LastValue) / (1024f * 1024f * 1024f);
    }
}
```

## Unity Performance Advantages

### 1. Built-in Job System and Burst Compiler

Unity's Job System provides significant performance improvements for parallel calculations:

```csharp
[BurstCompile]
public struct TrajectoryCalculationJob : IJobParallelFor
{
    [ReadOnly] public NativeArray<float3> positions;
    [ReadOnly] public NativeArray<float3> velocities;
    [ReadOnly] public float deltaTime;
    [ReadOnly] public float3 gravity;
    
    public NativeArray<float3> newPositions;
    public NativeArray<float3> newVelocities;
    
    public void Execute(int index)
    {
        float3 pos = positions[index];
        float3 vel = velocities[index];
        
        // Apply gravity
        vel += gravity * deltaTime;
        
        // Update position
        pos += vel * deltaTime;
        
        newPositions[index] = pos;
        newVelocities[index] = vel;
    }
}

// Usage in TrajectoryManager
public void UpdateTrajectories(int count)
{
    TrajectoryCalculationJob job = new TrajectoryCalculationJob
    {
        positions = positionArray,
        velocities = velocityArray,
        deltaTime = Time.fixedDeltaTime,
        gravity = new float3(0, -9.82f, 0),
        newPositions = newPositionArray,
        newVelocities = newVelocityArray
    };
    
    JobHandle jobHandle = job.Schedule(count, 32);
    jobHandle.Complete();
}
```

### 2. Native GPU Instancing

Unity's Graphics.DrawMeshInstanced provides better performance than Three.js:

```csharp
public class HighPerformanceInstancer : MonoBehaviour
{
    private Matrix4x4[] matrices;
    private Vector4[] colors;
    private MaterialPropertyBlock propertyBlock;
    
    void Update()
    {
        // Update matrices and colors
        UpdateInstanceData();
        
        // Single GPU draw call for up to 1023 instances
        Graphics.DrawMeshInstanced(
            mesh: instanceMesh,
            submeshIndex: 0,
            material: instanceMaterial,
            matrices: matrices,
            count: activeInstanceCount,
            properties: propertyBlock,
            castShadows: UnityEngine.Rendering.ShadowCastingMode.Off,
            receiveShadows: false,
            layer: gameObject.layer,
            camera: null
        );
    }
}
```

### 3. Scriptable Render Pipeline (URP/HDRP)

Unity's modern render pipelines provide better mobile performance:

```csharp
// URP Renderer Feature for Custom Instancing
public class InstancedThreatRenderFeature : ScriptableRendererFeature
{
    public override void Create()
    {
        m_ScriptablePass = new InstancedThreatPass();
    }
    
    public override void AddRenderPasses(ScriptableRenderer renderer, ref RenderingData renderingData)
    {
        renderer.EnqueuePass(m_ScriptablePass);
    }
}

public class InstancedThreatPass : ScriptableRenderPass
{
    public override void Execute(ScriptableRenderContext context, ref RenderingData renderingData)
    {
        CommandBuffer cmd = CommandBufferPool.Get("InstancedThreats");
        
        // Custom instanced rendering with optimized shaders
        cmd.DrawMeshInstanced(mesh, 0, material, 0, matrices, instanceCount);
        
        context.ExecuteCommandBuffer(cmd);
        CommandBufferPool.Release(cmd);
    }
}
```

## Mobile Optimization

### Device-Adaptive Quality System

```csharp
public class MobileOptimizer : MonoBehaviour
{
    [Header("Device Detection")]
    public DeviceProfile[] deviceProfiles;
    
    [Header("Performance Targets")]
    public float targetFrameTime = 16.67f; // 60 FPS
    public float lowEndFrameTime = 33.33f; // 30 FPS
    
    [System.Serializable]
    public struct DeviceProfile
    {
        public string deviceModel;
        public int maxThreats;
        public int maxInterceptors;
        public int maxParticles;
        public float renderScale;
        public bool enableShadows;
        public int textureQuality;
    }
    
    void Start()
    {
        DetectDeviceAndApplyProfile();
        StartCoroutine(AdaptiveQualityMonitoring());
    }
    
    private void DetectDeviceAndApplyProfile()
    {
        string deviceModel = SystemInfo.deviceModel;
        bool isLowEnd = SystemInfo.systemMemorySize < 3000; // Less than 3GB RAM
        
        DeviceProfile profile = GetProfileForDevice(deviceModel, isLowEnd);
        ApplyProfile(profile);
    }
    
    private IEnumerator AdaptiveQualityMonitoring()
    {
        float[] frameTimeHistory = new float[30];
        int frameIndex = 0;
        
        while (true)
        {
            yield return new WaitForSeconds(0.1f);
            
            frameTimeHistory[frameIndex] = Time.unscaledDeltaTime * 1000f;
            frameIndex = (frameIndex + 1) % frameTimeHistory.Length;
            
            float averageFrameTime = frameTimeHistory.Average();
            
            if (averageFrameTime > targetFrameTime * 1.3f)
            {
                ReduceQuality();
            }
            else if (averageFrameTime < targetFrameTime * 0.7f)
            {
                IncreaseQuality();
            }
        }
    }
    
    private void ReduceQuality()
    {
        // Reduce particle counts
        ParticleSystemManager.Instance?.ReduceParticleDensity(0.8f);
        
        // Lower render resolution
        float currentScale = Screen.width / (float)Screen.currentResolution.width;
        if (currentScale > 0.5f)
        {
            Screen.SetResolution((int)(Screen.width * 0.9f), (int)(Screen.height * 0.9f), false);
        }
        
        // Reduce LOD distances
        LODManager.Instance?.ReduceLODDistances(0.8f);
        
        // Disable expensive effects
        EffectsManager.Instance?.SetEffectQuality(EffectQuality.Low);
    }
}
```

### Battery Optimization

```csharp
public class BatteryOptimizer : MonoBehaviour
{
    [Header("Power Management")]
    public float idleTimeBeforeOptimization = 30f;
    public float backgroundUpdateRate = 0.2f; // 5 FPS when idle
    
    private float lastInputTime;
    private bool isOptimized = false;
    
    void Update()
    {
        CheckForInput();
        
        if (Time.time - lastInputTime > idleTimeBeforeOptimization && !isOptimized)
        {
            EnterPowerSaveMode();
        }
        else if (Time.time - lastInputTime <= 1f && isOptimized)
        {
            ExitPowerSaveMode();
        }
    }
    
    private void EnterPowerSaveMode()
    {
        isOptimized = true;
        
        // Reduce frame rate
        Application.targetFrameRate = 5;
        
        // Reduce physics update rate
        Time.fixedDeltaTime = backgroundUpdateRate;
        
        // Pause non-essential systems
        ParticleSystemManager.Instance?.PauseAllEffects();
        AudioManager.Instance?.ReduceAudioQuality();
        
        // Lower screen brightness (if supported)
        Screen.brightness = Mathf.Max(0.3f, Screen.brightness * 0.7f);
    }
    
    private void ExitPowerSaveMode()
    {
        isOptimized = false;
        
        // Restore frame rate
        Application.targetFrameRate = 60;
        
        // Restore physics update rate
        Time.fixedDeltaTime = 1f / 60f;
        
        // Resume systems
        ParticleSystemManager.Instance?.ResumeAllEffects();
        AudioManager.Instance?.RestoreAudioQuality();
        
        // Restore screen brightness
        Screen.brightness = 1f;
    }
}
```

## Performance Monitoring

### Comprehensive Performance Profiler

```csharp
using Unity.Profiling;

public class PerformanceProfiler : MonoBehaviour
{
    [Header("Profiling")]
    public bool enableProfiling = true;
    public float profilingInterval = 1f;
    public int historySize = 300; // 5 minutes at 1 second intervals
    
    private ProfilerRecorder frameTimeRecorder;
    private ProfilerRecorder triangleCountRecorder;
    private ProfilerRecorder drawCallsRecorder;
    private ProfilerRecorder memoryRecorder;
    
    private Queue<PerformanceSnapshot> performanceHistory = new Queue<PerformanceSnapshot>();
    
    [System.Serializable]
    public struct PerformanceSnapshot
    {
        public float timestamp;
        public float frameTime;
        public int triangleCount;
        public int drawCalls;
        public long memoryUsage;
        public int activeThreats;
        public int activeInterceptors;
        public int activeEffects;
    }
    
    void OnEnable()
    {
        frameTimeRecorder = ProfilerRecorder.StartNew(ProfilerCategory.Internal, "Main Thread", 15);
        triangleCountRecorder = ProfilerRecorder.StartNew(ProfilerCategory.Render, "Triangles");
        drawCallsRecorder = ProfilerRecorder.StartNew(ProfilerCategory.Render, "Draw Calls");
        memoryRecorder = ProfilerRecorder.StartNew(ProfilerCategory.Memory, "System Used Memory");
    }
    
    void OnDisable()
    {
        frameTimeRecorder.Dispose();
        triangleCountRecorder.Dispose();
        drawCallsRecorder.Dispose();
        memoryRecorder.Dispose();
    }
    
    void Start()
    {
        if (enableProfiling)
        {
            InvokeRepeating(nameof(RecordPerformanceSnapshot), profilingInterval, profilingInterval);
        }
    }
    
    private void RecordPerformanceSnapshot()
    {
        PerformanceSnapshot snapshot = new PerformanceSnapshot
        {
            timestamp = Time.time,
            frameTime = GetAverageFrameTime(),
            triangleCount = (int)triangleCountRecorder.LastValue,
            drawCalls = (int)drawCallsRecorder.LastValue,
            memoryUsage = memoryRecorder.LastValue,
            activeThreats = ThreatManager.Instance?.GetActiveThreatCount() ?? 0,
            activeInterceptors = ProjectileManager.Instance?.GetActiveInterceptorCount() ?? 0,
            activeEffects = EffectsManager.Instance?.GetActiveEffectCount() ?? 0
        };
        
        performanceHistory.Enqueue(snapshot);
        
        if (performanceHistory.Count > historySize)
        {
            performanceHistory.Dequeue();
        }
        
        AnalyzePerformanceTrends(snapshot);
    }
    
    private float GetAverageFrameTime()
    {
        if (!frameTimeRecorder.Valid) return 0f;
        
        double sum = 0;
        int count = Mathf.Min(frameTimeRecorder.Capacity, frameTimeRecorder.Count);
        
        for (int i = 0; i < count; i++)
        {
            sum += frameTimeRecorder.GetSample(i).Value;
        }
        
        return (float)(sum / count / 1000000.0); // Convert nanoseconds to milliseconds
    }
    
    private void AnalyzePerformanceTrends(PerformanceSnapshot current)
    {
        // Check for performance degradation
        if (current.frameTime > 20f) // Over 50 FPS
        {
            Debug.LogWarning($"Performance warning: Frame time {current.frameTime:F2}ms, " +
                           $"Triangles: {current.triangleCount}, Draw calls: {current.drawCalls}");
            
            // Trigger automatic optimization
            EventManager.Instance.TriggerEvent("PerformanceOptimization", current);
        }
        
        // Check for memory growth
        if (performanceHistory.Count > 10)
        {
            var recent = performanceHistory.Skip(performanceHistory.Count - 10).ToArray();
            long memoryGrowth = current.memoryUsage - recent[0].memoryUsage;
            
            if (memoryGrowth > 100 * 1024 * 1024) // 100MB growth in 10 seconds
            {
                Debug.LogWarning($"Memory growth detected: +{memoryGrowth / (1024 * 1024)}MB");
                MemoryManager.Instance?.TriggerPreventiveCleanup();
            }
        }
    }
    
    public PerformanceSnapshot[] GetPerformanceHistory()
    {
        return performanceHistory.ToArray();
    }
    
    public void ExportPerformanceData(string filePath)
    {
        var data = performanceHistory.Select(s => new
        {
            Time = s.timestamp,
            FrameTime = s.frameTime,
            Triangles = s.triangleCount,
            DrawCalls = s.drawCalls,
            Memory = s.memoryUsage / (1024 * 1024), // MB
            Threats = s.activeThreats,
            Interceptors = s.activeInterceptors,
            Effects = s.activeEffects
        });
        
        string json = JsonUtility.ToJson(data, true);
        System.IO.File.WriteAllText(filePath, json);
        Debug.Log($"Performance data exported to {filePath}");
    }
}
```

This performance optimization guide provides Unity-specific implementations that should match or exceed the current Three.js performance while adding advanced features like job system parallelization, native instancing, and comprehensive profiling.