# Iron Dome Simulator - Rendering Pipeline Guide

## Table of Contents
1. [Current Rendering Architecture](#current-rendering-architecture)
2. [Instanced Rendering Translation](#instanced-rendering-translation)
3. [LOD System Implementation](#lod-system-implementation)
4. [Material and Shader Optimization](#material-and-shader-optimization)
5. [Effect Systems](#effect-systems)
6. [Unity Rendering Pipeline Integration](#unity-rendering-pipeline-integration)

## Current Rendering Architecture

### Performance-Critical Rendering Systems

The current Three.js implementation uses sophisticated instanced rendering to achieve 60 FPS with hundreds of objects:

```typescript
// Current Performance Metrics
const RENDERING_LIMITS = {
  MAX_INSTANCED_OBJECTS: 1000,      // Per renderer
  MAX_DRAW_CALLS: 350,              // Total scene
  MAX_TRIANGLES: 40000,             // Dynamic spike limit
  MAX_SHADER_PROGRAMS: 315,         // Cached materials only
  TARGET_FRAME_TIME: 16.67,         // 60 FPS
};

// Active Renderers
- InstancedThreatRenderer: 100 threats per type (400 total)
- InstancedProjectileRenderer: 200 interceptors
- InstancedExplosionRenderer: 30 simultaneous effects
- InstancedDebrisRenderer: 500 debris fragments
- LODInstancedThreatRenderer: Distance-based optimization
```

### Critical Optimization Systems

1. **MaterialCache**: Prevents 1000ms+ shader compilation freezes
2. **GeometryFactory**: Eliminates duplicate geometries (10-20% memory reduction)
3. **TextureCache**: Prevents texture duplication and shader program explosion
4. **LOD System**: 30-50% triangle reduction at distance
5. **Object Pooling**: Prevents garbage collection spikes

## Instanced Rendering Translation

### Three.js to Unity Graphics.DrawMeshInstanced

```typescript
// Three.js Instanced Mesh Implementation
class InstancedThreatRenderer {
  private threatMeshes: { [key: string]: THREE.InstancedMesh } = {};
  private dummy = new THREE.Object3D();
  
  constructor(scene: THREE.Scene, maxThreatsPerType: number = 100) {
    Object.entries(threatConfigs).forEach(([type, config]) => {
      const mesh = new THREE.InstancedMesh(
        config.geometry,
        config.material,
        maxThreatsPerType
      );
      this.threatMeshes[type] = mesh;
      scene.add(mesh);
    });
  }
  
  updateThreats(threats: Threat[]): void {
    threats.forEach((threat, index) => {
      const mesh = this.threatMeshes[threat.type];
      this.dummy.position.copy(threat.getPosition());
      this.dummy.rotation.copy(threat.getRotation());
      this.dummy.scale.copy(threat.getScale());
      this.dummy.updateMatrix();
      mesh.setMatrixAt(index, this.dummy.matrix);
    });
    
    Object.values(this.threatMeshes).forEach(mesh => {
      mesh.instanceMatrix.needsUpdate = true;
    });
  }
}
```

```csharp
// Unity Graphics.DrawMeshInstanced Implementation
using Unity.Collections;
using Unity.Jobs;
using Unity.Mathematics;

public class InstancedThreatRenderer : MonoBehaviour
{
    [Header("Instancing Configuration")]
    public ThreatTypeConfig[] threatTypes;
    public int maxInstancesPerType = 100;
    public Camera renderCamera;
    
    [System.Serializable]
    public struct ThreatTypeConfig
    {
        public string typeName;
        public Mesh mesh;
        public Material material;
        public LayerMask cullingLayer;
    }
    
    private Dictionary<string, InstancedThreatType> renderers = new Dictionary<string, InstancedThreatType>();
    private MaterialPropertyBlock propertyBlock;
    
    private struct InstancedThreatType
    {
        public Mesh mesh;
        public Material material;
        public Matrix4x4[] matrices;
        public Vector4[] colors;
        public int activeCount;
        public ComputeBuffer matrixBuffer;
        public ComputeBuffer colorBuffer;
    }
    
    void Start()
    {
        propertyBlock = new MaterialPropertyBlock();
        InitializeRenderers();
    }
    
    private void InitializeRenderers()
    {
        foreach (var config in threatTypes)
        {
            var renderer = new InstancedThreatType
            {
                mesh = config.mesh,
                material = config.material,
                matrices = new Matrix4x4[maxInstancesPerType],
                colors = new Vector4[maxInstancesPerType],
                activeCount = 0,
                matrixBuffer = new ComputeBuffer(maxInstancesPerType, sizeof(float) * 16),
                colorBuffer = new ComputeBuffer(maxInstancesPerType, sizeof(float) * 4)
            };
            
            // Initialize with identity matrices
            for (int i = 0; i < maxInstancesPerType; i++)
            {
                renderer.matrices[i] = Matrix4x4.identity;
                renderer.colors[i] = Vector4.one;
            }
            
            renderers[config.typeName] = renderer;
        }
    }
    
    public void UpdateThreatRendering(List<Threat> threats)
    {
        // Group threats by type
        var threatsByType = threats.GroupBy(t => t.ThreatType).ToDictionary(g => g.Key, g => g.ToList());
        
        foreach (var kvp in renderers.ToList())
        {
            string typeName = kvp.Key;
            var renderer = kvp.Value;
            
            List<Threat> threatsOfType = threatsByType.GetValueOrDefault(typeName, new List<Threat>());
            renderer.activeCount = Mathf.Min(threatsOfType.Count, maxInstancesPerType);
            
            // Update matrices using Job System
            if (renderer.activeCount > 0)
            {
                UpdateInstanceMatrices(renderer, threatsOfType);
            }
            
            renderers[typeName] = renderer;
        }
    }
    
    private void UpdateInstanceMatrices(InstancedThreatType renderer, List<Threat> threats)
    {
        // Prepare data for job
        NativeArray<float3> positions = new NativeArray<float3>(renderer.activeCount, Allocator.TempJob);
        NativeArray<quaternion> rotations = new NativeArray<quaternion>(renderer.activeCount, Allocator.TempJob);
        NativeArray<float3> scales = new NativeArray<float3>(renderer.activeCount, Allocator.TempJob);
        NativeArray<Matrix4x4> matrices = new NativeArray<Matrix4x4>(renderer.activeCount, Allocator.TempJob);
        
        for (int i = 0; i < renderer.activeCount; i++)
        {
            var threat = threats[i];
            positions[i] = threat.transform.position;
            rotations[i] = threat.transform.rotation;
            scales[i] = threat.transform.localScale;
        }
        
        // Execute matrix calculation job
        var job = new CalculateInstanceMatricesJob
        {
            positions = positions,
            rotations = rotations,
            scales = scales,
            matrices = matrices
        };
        
        JobHandle jobHandle = job.Schedule(renderer.activeCount, 32);
        jobHandle.Complete();
        
        // Copy results back
        NativeArray<Matrix4x4>.Copy(matrices, renderer.matrices, renderer.activeCount);
        
        // Update GPU buffers
        renderer.matrixBuffer.SetData(renderer.matrices, 0, 0, renderer.activeCount);
        renderer.colorBuffer.SetData(renderer.colors, 0, 0, renderer.activeCount);
        
        // Cleanup
        positions.Dispose();
        rotations.Dispose();
        scales.Dispose();
        matrices.Dispose();
    }
    
    void Update()
    {
        RenderAllInstances();
    }
    
    private void RenderAllInstances()
    {
        foreach (var kvp in renderers)
        {
            var renderer = kvp.Value;
            if (renderer.activeCount > 0)
            {
                // Setup material properties
                propertyBlock.SetBuffer("_MatrixBuffer", renderer.matrixBuffer);
                propertyBlock.SetBuffer("_ColorBuffer", renderer.colorBuffer);
                
                // Render instances
                Graphics.DrawMeshInstanced(
                    mesh: renderer.mesh,
                    submeshIndex: 0,
                    material: renderer.material,
                    matrices: renderer.matrices,
                    count: renderer.activeCount,
                    properties: propertyBlock,
                    castShadows: UnityEngine.Rendering.ShadowCastingMode.Off,
                    receiveShadows: false,
                    layer: gameObject.layer,
                    camera: renderCamera
                );
            }
        }
    }
    
    [BurstCompile]
    struct CalculateInstanceMatricesJob : IJobParallelFor
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
    
    void OnDestroy()
    {
        foreach (var renderer in renderers.Values)
        {
            renderer.matrixBuffer?.Dispose();
            renderer.colorBuffer?.Dispose();
        }
    }
}
```

### Advanced GPU Instancing with Compute Shaders

For maximum performance with 1000+ instances:

```csharp
public class ComputeShaderInstancedRenderer : MonoBehaviour
{
    [Header("Compute Instancing")]
    public ComputeShader instanceUpdateCompute;
    public Mesh instanceMesh;
    public Material instanceMaterial;
    public int maxInstances = 1000;
    
    private ComputeBuffer instanceBuffer;
    private ComputeBuffer argsBuffer;
    private uint[] args = new uint[5] { 0, 0, 0, 0, 0 };
    private int kernelHandle;
    
    private struct InstanceData
    {
        public Matrix4x4 matrix;
        public Vector4 color;
        public float active; // 1.0 = active, 0.0 = inactive
    }
    
    void Start()
    {
        InitializeBuffers();
        SetupComputeShader();
    }
    
    private void InitializeBuffers()
    {
        // Instance data buffer
        instanceBuffer = new ComputeBuffer(maxInstances, sizeof(float) * 20); // Matrix4x4 + Vector4 + float
        
        // Indirect args buffer for DrawMeshInstancedIndirect
        argsBuffer = new ComputeBuffer(1, args.Length * sizeof(uint), ComputeBufferType.IndirectArguments);
        
        // Initialize args
        args[0] = (uint)instanceMesh.GetIndexCount(0);
        args[1] = 0; // Instance count (updated by compute shader)
        args[2] = (uint)instanceMesh.GetIndexStart(0);
        args[3] = (uint)instanceMesh.GetBaseVertex(0);
        args[4] = 0;
        argsBuffer.SetData(args);
    }
    
    private void SetupComputeShader()
    {
        kernelHandle = instanceUpdateCompute.FindKernel("CSInstanceUpdate");
        instanceUpdateCompute.SetBuffer(kernelHandle, "InstanceBuffer", instanceBuffer);
        instanceUpdateCompute.SetBuffer(kernelHandle, "ArgsBuffer", argsBuffer);
    }
    
    public void UpdateInstances(List<Transform> instances, List<Color> colors)
    {
        if (instances.Count == 0) return;
        
        // Prepare instance data
        InstanceData[] instanceData = new InstanceData[maxInstances];
        int activeCount = Mathf.Min(instances.Count, maxInstances);
        
        for (int i = 0; i < activeCount; i++)
        {
            instanceData[i] = new InstanceData
            {
                matrix = instances[i].localToWorldMatrix,
                color = colors.Count > i ? (Vector4)colors[i] : Vector4.one,
                active = 1.0f
            };
        }
        
        // Upload to GPU
        instanceBuffer.SetData(instanceData);
        
        // Dispatch compute shader
        instanceUpdateCompute.SetInt("InstanceCount", activeCount);
        int threadGroups = Mathf.CeilToInt(activeCount / 64.0f);
        instanceUpdateCompute.Dispatch(kernelHandle, threadGroups, 1, 1);
        
        // Set material properties
        instanceMaterial.SetBuffer("InstanceBuffer", instanceBuffer);
        
        // Render using indirect draw call
        Graphics.DrawMeshInstancedIndirect(
            instanceMesh, 
            0, 
            instanceMaterial, 
            new Bounds(Vector3.zero, Vector3.one * 1000f), 
            argsBuffer
        );
    }
    
    void OnDestroy()
    {
        instanceBuffer?.Dispose();
        argsBuffer?.Dispose();
    }
}
```

## LOD System Implementation

### Unity LODGroup Integration

```typescript
// Three.js LOD Implementation
class LODInstancedThreatRenderer {
  private getLODLevel(position: THREE.Vector3): number {
    const distance = position.distanceTo(this.camera.position);
    if (distance < 50) return 0; // High detail
    if (distance < 200) return 1; // Medium detail
    return 2; // Low detail
  }
  
  private transferThreatLOD(threatId: string, oldLOD: number, newLOD: number) {
    // Hide in old LOD mesh
    const oldMesh = this.getLODMesh(oldLOD);
    oldMesh.setMatrixAt(oldIndex, zeroMatrix);
    
    // Show in new LOD mesh
    const newMesh = this.getLODMesh(newLOD);
    newMesh.setMatrixAt(newIndex, threatMatrix);
  }
}
```

```csharp
// Unity LOD System Implementation
public class AdvancedLODManager : MonoBehaviour
{
    [Header("LOD Configuration")]
    public LODConfiguration[] lodConfigurations;
    public Camera referenceCamera;
    public float updateInterval = 0.2f;
    
    [System.Serializable]
    public struct LODConfiguration
    {
        public string objectType;
        public LODLevel[] levels;
        public bool enableDistanceCulling;
        public float cullingDistance;
    }
    
    [System.Serializable]
    public struct LODLevel
    {
        public float screenRelativeTransitionHeight;
        public Mesh lodMesh;
        public Material lodMaterial;
        public bool enableShadows;
        public int maxInstances;
    }
    
    private Dictionary<string, LODGroupManager> lodManagers = new Dictionary<string, LODGroupManager>();
    private float lastUpdateTime;
    
    private class LODGroupManager
    {
        public LODConfiguration config;
        public InstancedRenderer[] renderers;
        public Dictionary<int, int> objectToLOD = new Dictionary<int, int>();
        public Dictionary<int, int> objectToIndex = new Dictionary<int, int>();
        
        public LODGroupManager(LODConfiguration config, Transform parent)
        {
            this.config = config;
            renderers = new InstancedRenderer[config.levels.Length];
            
            for (int i = 0; i < config.levels.Length; i++)
            {
                GameObject lodObject = new GameObject($"LOD_{i}_{config.objectType}");
                lodObject.transform.parent = parent;
                
                renderers[i] = lodObject.AddComponent<InstancedRenderer>();
                renderers[i].Initialize(config.levels[i].lodMesh, config.levels[i].lodMaterial, config.levels[i].maxInstances);
            }
        }
    }
    
    void Start()
    {
        InitializeLODManagers();
    }
    
    private void InitializeLODManagers()
    {
        foreach (var config in lodConfigurations)
        {
            lodManagers[config.objectType] = new LODGroupManager(config, transform);
        }
    }
    
    void Update()
    {
        if (Time.time - lastUpdateTime > updateInterval)
        {
            UpdateAllLODs();
            lastUpdateTime = Time.time;
        }
    }
    
    public void RegisterObject(string objectType, int objectId, Transform objectTransform)
    {
        if (lodManagers.ContainsKey(objectType))
        {
            var manager = lodManagers[objectType];
            int lodLevel = CalculateLODLevel(objectTransform.position, manager.config);
            
            manager.objectToLOD[objectId] = lodLevel;
            int index = manager.renderers[lodLevel].AddInstance(objectTransform);
            manager.objectToIndex[objectId] = index;
        }
    }
    
    public void UpdateObject(string objectType, int objectId, Transform objectTransform)
    {
        if (!lodManagers.ContainsKey(objectType)) return;
        
        var manager = lodManagers[objectType];
        if (!manager.objectToLOD.ContainsKey(objectId)) return;
        
        int currentLOD = manager.objectToLOD[objectId];
        int newLOD = CalculateLODLevel(objectTransform.position, manager.config);
        
        if (currentLOD != newLOD)
        {
            // Transfer to new LOD level
            TransferObjectToLOD(manager, objectId, currentLOD, newLOD, objectTransform);
        }
        else
        {
            // Update in current LOD
            int index = manager.objectToIndex[objectId];
            manager.renderers[currentLOD].UpdateInstance(index, objectTransform);
        }
    }
    
    private void UpdateAllLODs()
    {
        foreach (var manager in lodManagers.Values)
        {
            for (int i = 0; i < manager.renderers.Length; i++)
            {
                manager.renderers[i].UpdateRendering();
            }
        }
    }
    
    private int CalculateLODLevel(Vector3 position, LODConfiguration config)
    {
        float distance = Vector3.Distance(position, referenceCamera.transform.position);
        
        // Distance culling
        if (config.enableDistanceCulling && distance > config.cullingDistance)
        {
            return -1; // Culled
        }
        
        // Calculate screen space size
        float screenHeight = 2f * Mathf.Tan(referenceCamera.fieldOfView * 0.5f * Mathf.Deg2Rad) * distance;
        float relativeHeight = 1f / screenHeight; // Approximate relative height
        
        for (int i = 0; i < config.levels.Length; i++)
        {
            if (relativeHeight >= config.levels[i].screenRelativeTransitionHeight)
            {
                return i;
            }
        }
        
        return config.levels.Length - 1; // Lowest LOD
    }
    
    private void TransferObjectToLOD(LODGroupManager manager, int objectId, int oldLOD, int newLOD, Transform objectTransform)
    {
        // Remove from old LOD
        if (oldLOD >= 0 && oldLOD < manager.renderers.Length)
        {
            int oldIndex = manager.objectToIndex[objectId];
            manager.renderers[oldLOD].RemoveInstance(oldIndex);
        }
        
        // Add to new LOD
        if (newLOD >= 0 && newLOD < manager.renderers.Length)
        {
            int newIndex = manager.renderers[newLOD].AddInstance(objectTransform);
            manager.objectToIndex[objectId] = newIndex;
        }
        
        manager.objectToLOD[objectId] = newLOD;
    }
}

public class InstancedRenderer : MonoBehaviour
{
    private Mesh mesh;
    private Material material;
    private Matrix4x4[] matrices;
    private int maxInstances;
    private int currentCount = 0;
    private List<int> freeIndices = new List<int>();
    private MaterialPropertyBlock propertyBlock;
    
    public void Initialize(Mesh mesh, Material material, int maxInstances)
    {
        this.mesh = mesh;
        this.material = material;
        this.maxInstances = maxInstances;
        this.matrices = new Matrix4x4[maxInstances];
        this.propertyBlock = new MaterialPropertyBlock();
        
        // Initialize free indices
        for (int i = 0; i < maxInstances; i++)
        {
            freeIndices.Add(i);
        }
    }
    
    public int AddInstance(Transform instanceTransform)
    {
        if (freeIndices.Count == 0) return -1;
        
        int index = freeIndices[freeIndices.Count - 1];
        freeIndices.RemoveAt(freeIndices.Count - 1);
        
        matrices[index] = instanceTransform.localToWorldMatrix;
        currentCount = Mathf.Max(currentCount, index + 1);
        
        return index;
    }
    
    public void UpdateInstance(int index, Transform instanceTransform)
    {
        if (index >= 0 && index < maxInstances)
        {
            matrices[index] = instanceTransform.localToWorldMatrix;
        }
    }
    
    public void RemoveInstance(int index)
    {
        if (index >= 0 && index < maxInstances)
        {
            matrices[index] = Matrix4x4.zero; // Hide instance
            freeIndices.Add(index);
        }
    }
    
    public void UpdateRendering()
    {
        if (currentCount > 0)
        {
            Graphics.DrawMeshInstanced(mesh, 0, material, matrices, currentCount, propertyBlock);
        }
    }
}
```

## Material and Shader Optimization

### Unity Material Management System

```typescript
// Three.js MaterialCache
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

```csharp
// Unity Material Management with Scriptable Objects
[CreateAssetMenu(fileName = "MaterialLibrary", menuName = "Rendering/Material Library")]
public class MaterialLibrary : ScriptableObject
{
    [Header("Base Materials")]
    public Material standardMaterial;
    public Material transparentMaterial;
    public Material emissiveMaterial;
    public Material unlitMaterial;
    
    [Header("Optimization")]
    public int maxCachedMaterials = 200;
    public bool enableMaterialSharing = true;
    
    private Dictionary<string, Material> materialCache = new Dictionary<string, Material>();
    private Queue<string> accessOrder = new Queue<string>();
    
    public Material GetStandardMaterial(Color albedo, float metallic, float smoothness, Color emission = default)
    {
        if (!enableMaterialSharing)
        {
            return CreateNewMaterial(albedo, metallic, smoothness, emission);
        }
        
        string key = GenerateMaterialKey(albedo, metallic, smoothness, emission);
        
        if (!materialCache.ContainsKey(key))
        {
            if (materialCache.Count >= maxCachedMaterials)
            {
                EvictOldestMaterial();
            }
            
            Material material = CreateNewMaterial(albedo, metallic, smoothness, emission);
            materialCache[key] = material;
        }
        
        // Track access for LRU eviction
        accessOrder.Enqueue(key);
        return materialCache[key];
    }
    
    private Material CreateNewMaterial(Color albedo, float metallic, float smoothness, Color emission)
    {
        Material material;
        
        if (emission != Color.black)
        {
            material = new Material(emissiveMaterial);
            material.SetColor("_EmissionColor", emission);
            material.EnableKeyword("_EMISSION");
        }
        else
        {
            material = new Material(standardMaterial);
        }
        
        material.color = albedo;
        material.SetFloat("_Metallic", metallic);
        material.SetFloat("_Smoothness", smoothness);
        
        return material;
    }
    
    private string GenerateMaterialKey(Color albedo, float metallic, float smoothness, Color emission)
    {
        return $"{ColorUtility.ToHtmlStringRGB(albedo)}_{metallic:F2}_{smoothness:F2}_{ColorUtility.ToHtmlStringRGB(emission)}";
    }
    
    private void EvictOldestMaterial()
    {
        if (accessOrder.Count > 0)
        {
            string oldestKey = accessOrder.Dequeue();
            if (materialCache.ContainsKey(oldestKey))
            {
                if (Application.isPlaying)
                {
                    DestroyImmediate(materialCache[oldestKey]);
                }
                materialCache.Remove(oldestKey);
            }
        }
    }
    
    public void ClearCache()
    {
        foreach (var material in materialCache.Values)
        {
            if (Application.isPlaying)
            {
                DestroyImmediate(material);
            }
        }
        materialCache.Clear();
        accessOrder.Clear();
    }
    
    public MaterialStats GetStats()
    {
        return new MaterialStats
        {
            cachedMaterials = materialCache.Count,
            maxCapacity = maxCachedMaterials,
            memoryUsage = materialCache.Count * 64 // Approximate bytes per material
        };
    }
}

[System.Serializable]
public struct MaterialStats
{
    public int cachedMaterials;
    public int maxCapacity;
    public long memoryUsage;
}
```

### Shader Variant Management

```csharp
// Shader Variant Collection Management
public class ShaderVariantManager : MonoBehaviour
{
    [Header("Shader Management")]
    public ShaderVariantCollection precompiledVariants;
    public Shader[] criticalShaders;
    
    [Header("Runtime Optimization")]
    public bool enableAsyncCompilation = true;
    public int maxConcurrentCompilations = 3;
    
    private Dictionary<Shader, ShaderVariantCollection> shaderVariants = new Dictionary<Shader, ShaderVariantCollection>();
    private Queue<ShaderCompilationRequest> compilationQueue = new Queue<ShaderCompilationRequest>();
    private int activeCompilations = 0;
    
    private struct ShaderCompilationRequest
    {
        public Shader shader;
        public string[] keywords;
        public PassType passType;
        public System.Action<bool> onComplete;
    }
    
    void Start()
    {
        PrecompileCriticalShaders();
        
        if (enableAsyncCompilation)
        {
            StartCoroutine(ProcessCompilationQueue());
        }
    }
    
    private void PrecompileCriticalShaders()
    {
        foreach (Shader shader in criticalShaders)
        {
            // Precompile common variants
            CompileShaderVariant(shader, new string[] { }, PassType.ForwardBase);
            CompileShaderVariant(shader, new string[] { "_EMISSION" }, PassType.ForwardBase);
            CompileShaderVariant(shader, new string[] { "_METALLICGLOSSMAP" }, PassType.ForwardBase);
        }
        
        if (precompiledVariants != null)
        {
            precompiledVariants.WarmUp();
        }
    }
    
    public void RequestShaderVariant(Shader shader, string[] keywords, PassType passType, System.Action<bool> onComplete = null)
    {
        if (enableAsyncCompilation)
        {
            compilationQueue.Enqueue(new ShaderCompilationRequest
            {
                shader = shader,
                keywords = keywords,
                passType = passType,
                onComplete = onComplete
            });
        }
        else
        {
            bool success = CompileShaderVariant(shader, keywords, passType);
            onComplete?.Invoke(success);
        }
    }
    
    private bool CompileShaderVariant(Shader shader, string[] keywords, PassType passType)
    {
        try
        {
            ShaderVariantCollection.ShaderVariant variant = new ShaderVariantCollection.ShaderVariant();
            variant.shader = shader;
            variant.passType = passType;
            variant.keywords = keywords;
            
            if (!shaderVariants.ContainsKey(shader))
            {
                shaderVariants[shader] = new ShaderVariantCollection();
            }
            
            shaderVariants[shader].Add(variant);
            return true;
        }
        catch (System.Exception e)
        {
            Debug.LogError($"Failed to compile shader variant: {e.Message}");
            return false;
        }
    }
    
    private IEnumerator ProcessCompilationQueue()
    {
        while (true)
        {
            if (compilationQueue.Count > 0 && activeCompilations < maxConcurrentCompilations)
            {
                var request = compilationQueue.Dequeue();
                StartCoroutine(CompileShaderAsync(request));
            }
            
            yield return new WaitForSeconds(0.1f);
        }
    }
    
    private IEnumerator CompileShaderAsync(ShaderCompilationRequest request)
    {
        activeCompilations++;
        
        yield return null; // Wait one frame
        
        bool success = CompileShaderVariant(request.shader, request.keywords, request.passType);
        request.onComplete?.Invoke(success);
        
        activeCompilations--;
    }
    
    public void WarmUpAllVariants()
    {
        foreach (var collection in shaderVariants.Values)
        {
            collection.WarmUp();
        }
    }
    
    public ShaderVariantStats GetStats()
    {
        int totalVariants = 0;
        foreach (var collection in shaderVariants.Values)
        {
            totalVariants += collection.variantCount;
        }
        
        return new ShaderVariantStats
        {
            totalShaders = shaderVariants.Count,
            totalVariants = totalVariants,
            queuedCompilations = compilationQueue.Count,
            activeCompilations = activeCompilations
        };
    }
}

[System.Serializable]
public struct ShaderVariantStats
{
    public int totalShaders;
    public int totalVariants;
    public int queuedCompilations;
    public int activeCompilations;
}
```

## Effect Systems

### Particle System Translation

```typescript
// Three.js Particle System
class ExhaustTrailSystem {
  private particleSystem: THREE.Points;
  private particleMaterial: THREE.PointsMaterial;
  
  constructor(scene: THREE.Scene, config: TrailConfig) {
    this.particleMaterial = MaterialCache.getInstance().getPointsMaterial({
      size: config.particleSize,
      color: 0xffffff,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      sizeAttenuation: true,
    });
    
    this.particleMaterial.map = TextureCache.getInstance().getParticleTexture(64);
  }
}
```

```csharp
// Unity Particle System with VFX Graph Integration
using UnityEngine;
using UnityEngine.VFX;

public class AdvancedEffectSystem : MonoBehaviour
{
    [Header("Effect Configuration")]
    public EffectProfile[] effectProfiles;
    public int maxConcurrentEffects = 50;
    
    [Header("Performance")]
    public bool enableLOD = true;
    public float highQualityDistance = 100f;
    public float mediumQualityDistance = 300f;
    
    [System.Serializable]
    public struct EffectProfile
    {
        public string effectName;
        public VisualEffect highQualityVFX;
        public VisualEffect mediumQualityVFX;
        public VisualEffect lowQualityVFX;
        public ParticleSystem fallbackParticleSystem;
        public float duration;
        public bool useObjectPooling;
    }
    
    private Dictionary<string, EffectPool> effectPools = new Dictionary<string, EffectPool>();
    private List<ActiveEffect> activeEffects = new List<ActiveEffect>();
    private Camera referenceCamera;
    
    private class EffectPool
    {
        public Queue<VisualEffect> highQuality = new Queue<VisualEffect>();
        public Queue<VisualEffect> mediumQuality = new Queue<VisualEffect>();
        public Queue<VisualEffect> lowQuality = new Queue<VisualEffect>();
        public Queue<ParticleSystem> fallback = new Queue<ParticleSystem>();
    }
    
    private struct ActiveEffect
    {
        public Component effect;
        public float startTime;
        public float duration;
        public EffectQuality quality;
        public string profileName;
    }
    
    public enum EffectQuality
    {
        High,
        Medium,
        Low,
        Fallback
    }
    
    void Start()
    {
        referenceCamera = Camera.main;
        InitializeEffectPools();
    }
    
    private void InitializeEffectPools()
    {
        foreach (var profile in effectProfiles)
        {
            if (profile.useObjectPooling)
            {
                var pool = new EffectPool();
                
                // Pre-instantiate effects
                for (int i = 0; i < 5; i++)
                {
                    if (profile.highQualityVFX != null)
                    {
                        var vfx = Instantiate(profile.highQualityVFX);
                        vfx.gameObject.SetActive(false);
                        pool.highQuality.Enqueue(vfx);
                    }
                    
                    if (profile.mediumQualityVFX != null)
                    {
                        var vfx = Instantiate(profile.mediumQualityVFX);
                        vfx.gameObject.SetActive(false);
                        pool.mediumQuality.Enqueue(vfx);
                    }
                    
                    if (profile.lowQualityVFX != null)
                    {
                        var vfx = Instantiate(profile.lowQualityVFX);
                        vfx.gameObject.SetActive(false);
                        pool.lowQuality.Enqueue(vfx);
                    }
                    
                    if (profile.fallbackParticleSystem != null)
                    {
                        var ps = Instantiate(profile.fallbackParticleSystem);
                        ps.gameObject.SetActive(false);
                        pool.fallback.Enqueue(ps);
                    }
                }
                
                effectPools[profile.effectName] = pool;
            }
        }
    }
    
    public void PlayEffect(string effectName, Vector3 position, Quaternion rotation = default, Transform parent = null)
    {
        if (activeEffects.Count >= maxConcurrentEffects)
        {
            // Remove oldest effect
            var oldest = activeEffects[0];
            StopEffect(oldest);
            activeEffects.RemoveAt(0);
        }
        
        var profile = GetEffectProfile(effectName);
        if (profile == null) return;
        
        EffectQuality quality = DetermineEffectQuality(position);
        Component effect = GetEffectFromPool(profile.Value, quality);
        
        if (effect != null)
        {
            // Position and activate effect
            effect.transform.position = position;
            effect.transform.rotation = rotation;
            if (parent != null) effect.transform.SetParent(parent);
            
            effect.gameObject.SetActive(true);
            
            // Start effect
            if (effect is VisualEffect vfx)
            {
                vfx.Play();
            }
            else if (effect is ParticleSystem ps)
            {
                ps.Play();
            }
            
            // Track active effect
            activeEffects.Add(new ActiveEffect
            {
                effect = effect,
                startTime = Time.time,
                duration = profile.Value.duration,
                quality = quality,
                profileName = effectName
            });
        }
    }
    
    private EffectQuality DetermineEffectQuality(Vector3 position)
    {
        if (!enableLOD || referenceCamera == null) return EffectQuality.High;
        
        float distance = Vector3.Distance(position, referenceCamera.transform.position);
        
        if (distance <= highQualityDistance) return EffectQuality.High;
        if (distance <= mediumQualityDistance) return EffectQuality.Medium;
        return EffectQuality.Low;
    }
    
    private Component GetEffectFromPool(EffectProfile profile, EffectQuality quality)
    {
        if (!profile.useObjectPooling)
        {
            // Create new instance
            return CreateNewEffect(profile, quality);
        }
        
        var pool = effectPools[profile.effectName];
        
        switch (quality)
        {
            case EffectQuality.High:
                if (pool.highQuality.Count > 0)
                    return pool.highQuality.Dequeue();
                break;
            case EffectQuality.Medium:
                if (pool.mediumQuality.Count > 0)
                    return pool.mediumQuality.Dequeue();
                break;
            case EffectQuality.Low:
                if (pool.lowQuality.Count > 0)
                    return pool.lowQuality.Dequeue();
                break;
            case EffectQuality.Fallback:
                if (pool.fallback.Count > 0)
                    return pool.fallback.Dequeue();
                break;
        }
        
        // Fallback to creating new instance
        return CreateNewEffect(profile, quality);
    }
    
    private Component CreateNewEffect(EffectProfile profile, EffectQuality quality)
    {
        switch (quality)
        {
            case EffectQuality.High:
                return profile.highQualityVFX != null ? Instantiate(profile.highQualityVFX) : null;
            case EffectQuality.Medium:
                return profile.mediumQualityVFX != null ? Instantiate(profile.mediumQualityVFX) : null;
            case EffectQuality.Low:
                return profile.lowQualityVFX != null ? Instantiate(profile.lowQualityVFX) : null;
            case EffectQuality.Fallback:
                return profile.fallbackParticleSystem != null ? Instantiate(profile.fallbackParticleSystem) : null;
        }
        return null;
    }
    
    void Update()
    {
        // Update active effects
        for (int i = activeEffects.Count - 1; i >= 0; i--)
        {
            var effect = activeEffects[i];
            
            if (Time.time - effect.startTime >= effect.duration)
            {
                StopEffect(effect);
                activeEffects.RemoveAt(i);
            }
        }
    }
    
    private void StopEffect(ActiveEffect effect)
    {
        if (effect.effect == null) return;
        
        // Stop effect
        if (effect.effect is VisualEffect vfx)
        {
            vfx.Stop();
        }
        else if (effect.effect is ParticleSystem ps)
        {
            ps.Stop();
        }
        
        // Return to pool or destroy
        var profile = GetEffectProfile(effect.profileName);
        if (profile?.useObjectPooling == true)
        {
            effect.effect.gameObject.SetActive(false);
            ReturnEffectToPool(effect.effect, effect.profileName, effect.quality);
        }
        else
        {
            Destroy(effect.effect.gameObject);
        }
    }
    
    private void ReturnEffectToPool(Component effect, string profileName, EffectQuality quality)
    {
        var pool = effectPools[profileName];
        
        switch (quality)
        {
            case EffectQuality.High:
                if (effect is VisualEffect vfx) pool.highQuality.Enqueue(vfx);
                break;
            case EffectQuality.Medium:
                if (effect is VisualEffect vfx2) pool.mediumQuality.Enqueue(vfx2);
                break;
            case EffectQuality.Low:
                if (effect is VisualEffect vfx3) pool.lowQuality.Enqueue(vfx3);
                break;
            case EffectQuality.Fallback:
                if (effect is ParticleSystem ps) pool.fallback.Enqueue(ps);
                break;
        }
    }
    
    private EffectProfile? GetEffectProfile(string effectName)
    {
        foreach (var profile in effectProfiles)
        {
            if (profile.effectName == effectName)
                return profile;
        }
        return null;
    }
    
    public EffectSystemStats GetStats()
    {
        return new EffectSystemStats
        {
            activeEffects = activeEffects.Count,
            maxConcurrentEffects = maxConcurrentEffects,
            pooledEffects = GetTotalPooledEffects(),
            memoryUsage = EstimateMemoryUsage()
        };
    }
    
    private int GetTotalPooledEffects()
    {
        int total = 0;
        foreach (var pool in effectPools.Values)
        {
            total += pool.highQuality.Count + pool.mediumQuality.Count + pool.lowQuality.Count + pool.fallback.Count;
        }
        return total;
    }
    
    private long EstimateMemoryUsage()
    {
        return (activeEffects.Count + GetTotalPooledEffects()) * 1024 * 64; // Rough estimate
    }
}

[System.Serializable]
public struct EffectSystemStats
{
    public int activeEffects;
    public int maxConcurrentEffects;
    public int pooledEffects;
    public long memoryUsage;
}
```

## Unity Rendering Pipeline Integration

### URP/HDRP Optimization

```csharp
// Universal Render Pipeline Integration
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

public class IronDomeRenderFeature : ScriptableRendererFeature
{
    [System.Serializable]
    public class Settings
    {
        public RenderPassEvent renderPassEvent = RenderPassEvent.AfterRenderingOpaques;
        public Material instancedMaterial;
        public ComputeShader cullingCompute;
        public bool enableGPUCulling = true;
        public bool enableOcclusionCulling = false;
    }
    
    public Settings settings = new Settings();
    private InstancedRenderPass instancedPass;
    
    public override void Create()
    {
        instancedPass = new InstancedRenderPass(settings);
    }
    
    public override void AddRenderPasses(ScriptableRenderer renderer, ref RenderingData renderingData)
    {
        if (settings.instancedMaterial == null) return;
        
        instancedPass.ConfigureInput(ScriptableRenderPassInput.Depth);
        renderer.EnqueuePass(instancedPass);
    }
    
    class InstancedRenderPass : ScriptableRenderPass
    {
        private Settings settings;
        private ProfilingSampler profilingSampler;
        
        public InstancedRenderPass(Settings settings)
        {
            this.settings = settings;
            this.renderPassEvent = settings.renderPassEvent;
            this.profilingSampler = new ProfilingSampler("IronDome Instanced Rendering");
        }
        
        public override void Execute(ScriptableRenderContext context, ref RenderingData renderingData)
        {
            CommandBuffer cmd = CommandBufferPool.Get("IronDome Instanced");
            
            using (new ProfilingScope(cmd, profilingSampler))
            {
                // GPU Culling
                if (settings.enableGPUCulling && settings.cullingCompute != null)
                {
                    PerformGPUCulling(cmd, renderingData.cameraData.camera);
                }
                
                // Render instanced objects
                RenderInstancedObjects(cmd, renderingData.cameraData.camera);
            }
            
            context.ExecuteCommandBuffer(cmd);
            CommandBufferPool.Release(cmd);
        }
        
        private void PerformGPUCulling(CommandBuffer cmd, Camera camera)
        {
            // Setup frustum planes
            Plane[] frustumPlanes = GeometryUtility.CalculateFrustumPlanes(camera);
            Vector4[] planeVectors = new Vector4[6];
            for (int i = 0; i < 6; i++)
            {
                planeVectors[i] = new Vector4(frustumPlanes[i].normal.x, frustumPlanes[i].normal.y, frustumPlanes[i].normal.z, frustumPlanes[i].distance);
            }
            
            cmd.SetComputeVectorArrayParam(settings.cullingCompute, "_FrustumPlanes", planeVectors);
            cmd.SetComputeMatrixParam(settings.cullingCompute, "_ViewProjectionMatrix", camera.projectionMatrix * camera.worldToCameraMatrix);
            
            // Dispatch culling compute shader
            int kernelHandle = settings.cullingCompute.FindKernel("CSCullInstances");
            cmd.DispatchCompute(settings.cullingCompute, kernelHandle, 256, 1, 1); // Adjust thread groups as needed
        }
        
        private void RenderInstancedObjects(CommandBuffer cmd, Camera camera)
        {
            // Get instanced renderers
            var renderers = Object.FindObjectsOfType<InstancedThreatRenderer>();
            
            foreach (var renderer in renderers)
            {
                renderer.RenderWithCommandBuffer(cmd, camera);
            }
        }
    }
}
```

This rendering pipeline guide provides Unity-specific implementations that maintain the sophisticated performance optimizations while leveraging Unity's advanced rendering features like URP, instanced rendering, and compute shaders for maximum efficiency.