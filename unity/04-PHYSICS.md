# Iron Dome Simulator - Physics System Migration

## Table of Contents
1. [Current Physics Architecture](#current-physics-architecture)
2. [Cannon-es to Unity Physics Mapping](#cannon-es-to-unity-physics-mapping)
3. [Ballistics and Trajectory Systems](#ballistics-and-trajectory-systems)
4. [Guidance Algorithms](#guidance-algorithms)
5. [Collision Detection and Response](#collision-detection-and-response)
6. [Performance Optimizations](#performance-optimizations)

## Current Physics Architecture

### Cannon-es Physics World Configuration

```typescript
// Three.js Physics World Setup
const world = new CANNON.World();
world.gravity.set(0, -9.82, 0);
world.broadphase = new CANNON.NaiveBroadphase();
world.solver.iterations = 10;
world.solver.tolerance = 0.1;

// Update loop with time scaling support
function updatePhysics(deltaTime: number, timeScale: number = 1) {
  world.step(1/60, deltaTime * timeScale, 3);
  syncPhysicsToGraphics();
}
```

### Key Physics Components
1. **Projectile Physics**: Realistic ballistics with wind resistance
2. **Guidance Systems**: Proportional navigation for interceptors
3. **Collision Detection**: Proximity fuses and impact detection
4. **Environmental Effects**: Wind, gravity, atmospheric modeling
5. **Performance Scaling**: Dynamic time scaling for large scenarios

## Cannon-es to Unity Physics Mapping

### World Configuration Translation

```typescript
// Cannon-es World
const world = new CANNON.World();
world.gravity.set(0, -9.82, 0);
world.solver.iterations = 10;
```

```csharp
// Unity Physics Configuration
public class PhysicsWorldManager : MonoBehaviour
{
    [Header("Physics Settings")]
    public Vector3 gravity = new Vector3(0, -9.82f, 0);
    public int solverIterations = 10;
    public int solverVelocityIterations = 1;
    public float timeScale = 1f;
    
    [Header("Performance")]
    public bool enableAdaptiveTimestep = true;
    public float maxAllowedTimestep = 0.033f; // 30 FPS minimum
    
    void Start()
    {
        // Configure global physics
        Physics.gravity = gravity;
        Physics.defaultSolverIterations = solverIterations;
        Physics.defaultSolverVelocityIterations = solverVelocityIterations;
        
        // Set fixed timestep for deterministic simulation
        Time.fixedDeltaTime = 1f / 60f; // 60 Hz physics
        
        // Configure collision matrix
        SetupCollisionLayers();
    }
    
    private void SetupCollisionLayers()
    {
        // Define collision layers
        int threatLayer = LayerMask.NameToLayer("Threats");
        int interceptorLayer = LayerMask.NameToLayer("Interceptors");
        int groundLayer = LayerMask.NameToLayer("Ground");
        int detectionLayer = LayerMask.NameToLayer("Detection");
        
        // Configure collision interactions
        Physics.IgnoreLayerCollision(threatLayer, threatLayer);
        Physics.IgnoreLayerCollision(interceptorLayer, interceptorLayer);
        // Interceptors can collide with threats and ground
        // Threats only collide with ground and detection zones
    }
    
    void FixedUpdate()
    {
        // Handle time scaling for slow-motion effects
        Time.timeScale = timeScale;
        
        // Adaptive timestep for performance
        if (enableAdaptiveTimestep)
        {
            float frameTime = Time.unscaledDeltaTime;
            if (frameTime > maxAllowedTimestep)
            {
                Time.fixedDeltaTime = maxAllowedTimestep;
            }
            else
            {
                Time.fixedDeltaTime = 1f / 60f; // Return to normal
            }
        }
    }
}
```

### Body to Rigidbody Translation

```typescript
// Cannon-es Body Configuration
const body = new CANNON.Body({
  mass: 1,
  position: new CANNON.Vec3(0, 10, 0),
  velocity: new CANNON.Vec3(0, 0, 100),
  shape: new CANNON.Sphere(0.5)
});
body.material = new CANNON.Material({
  friction: 0.1,
  restitution: 0.3
});
```

```csharp
// Unity Rigidbody Configuration
public class ProjectilePhysics : MonoBehaviour
{
    [Header("Physics Properties")]
    public float mass = 1f;
    public float drag = 0.1f;
    public float angularDrag = 0.5f;
    public Vector3 initialVelocity = new Vector3(0, 0, 100);
    
    [Header("Collision")]
    public float colliderRadius = 0.5f;
    public PhysicMaterial physicsMaterial;
    
    private Rigidbody rb;
    private SphereCollider col;
    
    void Start()
    {
        // Setup rigidbody
        rb = gameObject.AddComponent<Rigidbody>();
        rb.mass = mass;
        rb.drag = drag;
        rb.angularDrag = angularDrag;
        rb.velocity = initialVelocity;
        
        // Setup collider
        col = gameObject.AddComponent<SphereCollider>();
        col.radius = colliderRadius;
        col.material = physicsMaterial;
        
        // Set collision layer
        gameObject.layer = LayerMask.NameToLayer("Projectiles");
    }
    
    void FixedUpdate()
    {
        // Apply custom physics forces
        ApplyAerodynamics();
        ApplyGuidanceForces();
    }
    
    private void ApplyAerodynamics()
    {
        // Wind resistance calculation
        Vector3 airVelocity = rb.velocity - WindSystem.Instance.GetWindAtPosition(transform.position);
        float speed = airVelocity.magnitude;
        
        if (speed > 0.1f)
        {
            Vector3 dragForce = -airVelocity.normalized * (speed * speed * drag);
            rb.AddForce(dragForce);
        }
    }
}
```

## Ballistics and Trajectory Systems

### Advanced Ballistics Calculator

```typescript
// Three.js Ballistics Implementation
class AdvancedBallistics {
  static calculateTrajectory(
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    target: THREE.Vector3,
    windVelocity: THREE.Vector3,
    timeStep: number,
    maxTime: number
  ): TrajectoryPoint[] {
    const trajectory: TrajectoryPoint[] = [];
    let currentPos = position.clone();
    let currentVel = velocity.clone();
    
    for (let t = 0; t < maxTime; t += timeStep) {
      // Apply gravity
      currentVel.y -= 9.82 * timeStep;
      
      // Apply wind resistance
      const airVel = currentVel.clone().sub(windVelocity);
      const dragForce = airVel.clone().multiplyScalar(-0.1 * airVel.length());
      currentVel.add(dragForce.multiplyScalar(timeStep));
      
      // Update position
      currentPos.add(currentVel.clone().multiplyScalar(timeStep));
      
      trajectory.push({
        time: t,
        position: currentPos.clone(),
        velocity: currentVel.clone()
      });
      
      // Check ground impact
      if (currentPos.y <= 0) break;
    }
    
    return trajectory;
  }
}
```

```csharp
// Unity Ballistics Implementation with Job System
using Unity.Collections;
using Unity.Jobs;
using Unity.Mathematics;

public struct BallisticsCalculationJob : IJob
{
    public float3 initialPosition;
    public float3 initialVelocity;
    public float3 targetPosition;
    public float3 windVelocity;
    public float timeStep;
    public float maxTime;
    public float gravity;
    public float dragCoefficient;
    
    public NativeList<TrajectoryPoint> trajectory;
    
    public void Execute()
    {
        float3 position = initialPosition;
        float3 velocity = initialVelocity;
        
        for (float t = 0; t < maxTime; t += timeStep)
        {
            // Apply gravity
            velocity.y -= gravity * timeStep;
            
            // Calculate air velocity and drag
            float3 airVelocity = velocity - windVelocity;
            float airSpeed = math.length(airVelocity);
            
            if (airSpeed > 0.1f)
            {
                float3 dragForce = math.normalize(airVelocity) * (-dragCoefficient * airSpeed * airSpeed);
                velocity += dragForce * timeStep;
            }
            
            // Update position
            position += velocity * timeStep;
            
            // Add point to trajectory
            trajectory.Add(new TrajectoryPoint
            {
                time = t,
                position = position,
                velocity = velocity
            });
            
            // Check ground impact
            if (position.y <= 0) break;
        }
    }
}

[System.Serializable]
public struct TrajectoryPoint
{
    public float time;
    public float3 position;
    public float3 velocity;
}

public class BallisticsCalculator : MonoBehaviour
{
    [Header("Ballistics Parameters")]
    public float gravity = 9.82f;
    public float dragCoefficient = 0.1f;
    public float timeStep = 0.1f;
    public float maxTime = 30f;
    
    public TrajectoryPoint[] CalculateTrajectory(Vector3 startPos, Vector3 startVel, Vector3 target, Vector3 wind)
    {
        NativeList<TrajectoryPoint> trajectory = new NativeList<TrajectoryPoint>(Allocator.TempJob);
        
        BallisticsCalculationJob job = new BallisticsCalculationJob
        {
            initialPosition = startPos,
            initialVelocity = startVel,
            targetPosition = target,
            windVelocity = wind,
            timeStep = timeStep,
            maxTime = maxTime,
            gravity = gravity,
            dragCoefficient = dragCoefficient,
            trajectory = trajectory
        };
        
        JobHandle jobHandle = job.Schedule();
        jobHandle.Complete();
        
        TrajectoryPoint[] result = trajectory.ToArray();
        trajectory.Dispose();
        
        return result;
    }
    
    public static Vector3 CalculateInterceptVelocity(Vector3 shooterPos, Vector3 targetPos, Vector3 targetVel, float projectileSpeed)
    {
        Vector3 toTarget = targetPos - shooterPos;
        float a = Vector3.Dot(targetVel, targetVel) - projectileSpeed * projectileSpeed;
        float b = 2 * Vector3.Dot(toTarget, targetVel);
        float c = Vector3.Dot(toTarget, toTarget);
        
        float discriminant = b * b - 4 * a * c;
        if (discriminant < 0) return Vector3.zero; // No solution
        
        float t1 = (-b + Mathf.Sqrt(discriminant)) / (2 * a);
        float t2 = (-b - Mathf.Sqrt(discriminant)) / (2 * a);
        
        float t = t1 > 0 ? t1 : t2;
        if (t < 0) return Vector3.zero; // No valid solution
        
        Vector3 interceptPoint = targetPos + targetVel * t;
        return (interceptPoint - shooterPos).normalized * projectileSpeed;
    }
}
```

### Trajectory Prediction System

```csharp
public class TrajectoryPredictor : MonoBehaviour
{
    [Header("Prediction Settings")]
    public LineRenderer trajectoryRenderer;
    public int predictionSteps = 100;
    public float predictionTimeStep = 0.1f;
    public LayerMask obstacleLayer;
    
    [Header("Visual")]
    public AnimationCurve accuracyCurve = AnimationCurve.Linear(0, 1, 1, 0.5f);
    public Gradient trajectoryGradient;
    
    private BallisticsCalculator ballistics;
    private Vector3[] trajectoryPoints;
    
    void Start()
    {
        ballistics = GetComponent<BallisticsCalculator>();
        trajectoryPoints = new Vector3[predictionSteps];
        
        // Setup line renderer
        trajectoryRenderer.positionCount = predictionSteps;
        trajectoryRenderer.colorGradient = trajectoryGradient;
    }
    
    public void PredictTrajectory(Vector3 startPos, Vector3 startVel, bool showVisualization = true)
    {
        TrajectoryPoint[] prediction = ballistics.CalculateTrajectory(
            startPos, 
            startVel, 
            Vector3.zero, 
            WindSystem.Instance.GetWindAtPosition(startPos)
        );
        
        // Convert to Vector3 array for LineRenderer
        for (int i = 0; i < predictionSteps && i < prediction.Length; i++)
        {
            trajectoryPoints[i] = prediction[i].position;
        }
        
        // Check for obstacles along trajectory
        CheckTrajectoryObstacles(prediction);
        
        if (showVisualization)
        {
            UpdateTrajectoryVisualization();
        }
    }
    
    private void CheckTrajectoryObstacles(TrajectoryPoint[] trajectory)
    {
        for (int i = 1; i < trajectory.Length; i++)
        {
            Vector3 start = trajectory[i - 1].position;
            Vector3 end = trajectory[i].position;
            Vector3 direction = end - start;
            float distance = direction.magnitude;
            
            if (Physics.Raycast(start, direction.normalized, out RaycastHit hit, distance, obstacleLayer))
            {
                // Obstacle detected, truncate trajectory
                for (int j = i; j < trajectoryPoints.Length; j++)
                {
                    trajectoryPoints[j] = hit.point;
                }
                break;
            }
        }
    }
    
    private void UpdateTrajectoryVisualization()
    {
        trajectoryRenderer.SetPositions(trajectoryPoints);
        
        // Adjust transparency based on distance for uncertainty visualization
        AnimationCurve alphaCurve = new AnimationCurve();
        for (int i = 0; i < predictionSteps; i++)
        {
            float t = (float)i / predictionSteps;
            float alpha = accuracyCurve.Evaluate(t);
            alphaCurve.AddKey(t, alpha);
        }
        
        trajectoryRenderer.widthCurve = alphaCurve;
    }
    
    public Vector3 GetImpactPoint()
    {
        // Return the last valid trajectory point (likely ground impact)
        for (int i = trajectoryPoints.Length - 1; i >= 0; i--)
        {
            if (trajectoryPoints[i].y <= 0.1f) // Close to ground
            {
                return trajectoryPoints[i];
            }
        }
        return trajectoryPoints[trajectoryPoints.Length - 1];
    }
}
```

## Guidance Algorithms

### Proportional Navigation Implementation

```typescript
// Three.js Proportional Navigation
class ProportionalNavigation {
  static calculateGuidanceCommand(
    interceptorPos: THREE.Vector3,
    interceptorVel: THREE.Vector3,
    targetPos: THREE.Vector3,
    targetVel: THREE.Vector3,
    navigationConstant: number = 3
  ): THREE.Vector3 {
    const relativePosition = targetPos.clone().sub(interceptorPos);
    const relativeVelocity = targetVel.clone().sub(interceptorVel);
    const range = relativePosition.length();
    
    if (range < 0.1) return new THREE.Vector3();
    
    const lineOfSightRate = relativePosition.clone().cross(relativeVelocity).length() / (range * range);
    const lineOfSightVector = relativePosition.normalize();
    const commandDirection = lineOfSightVector.clone().cross(relativeVelocity).normalize();
    
    return commandDirection.multiplyScalar(navigationConstant * lineOfSightRate * interceptorVel.length());
  }
}
```

```csharp
// Unity Proportional Navigation with Jobs
using Unity.Mathematics;
using Unity.Collections;
using Unity.Jobs;

[BurstCompile]
public struct ProportionalNavigationJob : IJobParallelFor
{
    [ReadOnly] public NativeArray<float3> interceptorPositions;
    [ReadOnly] public NativeArray<float3> interceptorVelocities;
    [ReadOnly] public NativeArray<float3> targetPositions;
    [ReadOnly] public NativeArray<float3> targetVelocities;
    [ReadOnly] public float navigationConstant;
    [ReadOnly] public float maxAcceleration;
    
    public NativeArray<float3> guidanceCommands;
    
    public void Execute(int index)
    {
        float3 interceptorPos = interceptorPositions[index];
        float3 interceptorVel = interceptorVelocities[index];
        float3 targetPos = targetPositions[index];
        float3 targetVel = targetVelocities[index];
        
        float3 relativePosition = targetPos - interceptorPos;
        float3 relativeVelocity = targetVel - interceptorVel;
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
        
        // Calculate command direction
        float3 commandDirection = math.normalize(math.cross(lineOfSight, math.cross(relativePosition, relativeVelocity)));
        
        // Calculate guidance command
        float commandMagnitude = navigationConstant * lineOfSightRate * math.length(interceptorVel);
        float3 guidanceCommand = commandDirection * commandMagnitude;
        
        // Limit acceleration
        float commandLength = math.length(guidanceCommand);
        if (commandLength > maxAcceleration)
        {
            guidanceCommand = math.normalize(guidanceCommand) * maxAcceleration;
        }
        
        guidanceCommands[index] = guidanceCommand;
    }
}

public class GuidanceSystem : MonoBehaviour
{
    [Header("Guidance Parameters")]
    public float navigationConstant = 3f;
    public float maxAcceleration = 50f;
    public float proximityFuseRange = 5f;
    
    [Header("Prediction")]
    public bool useKalmanFilter = true;
    public float processNoise = 0.1f;
    public float measurementNoise = 0.5f;
    
    private NativeArray<float3> interceptorPositions;
    private NativeArray<float3> interceptorVelocities;
    private NativeArray<float3> targetPositions;
    private NativeArray<float3> targetVelocities;
    private NativeArray<float3> guidanceCommands;
    
    private KalmanFilter[] kalmanFilters;
    
    void Start()
    {
        int maxInterceptors = 100;
        interceptorPositions = new NativeArray<float3>(maxInterceptors, Allocator.Persistent);
        interceptorVelocities = new NativeArray<float3>(maxInterceptors, Allocator.Persistent);
        targetPositions = new NativeArray<float3>(maxInterceptors, Allocator.Persistent);
        targetVelocities = new NativeArray<float3>(maxInterceptors, Allocator.Persistent);
        guidanceCommands = new NativeArray<float3>(maxInterceptors, Allocator.Persistent);
        
        if (useKalmanFilter)
        {
            kalmanFilters = new KalmanFilter[maxInterceptors];
            for (int i = 0; i < maxInterceptors; i++)
            {
                kalmanFilters[i] = new KalmanFilter(processNoise, measurementNoise);
            }
        }
    }
    
    void OnDestroy()
    {
        if (interceptorPositions.IsCreated) interceptorPositions.Dispose();
        if (interceptorVelocities.IsCreated) interceptorVelocities.Dispose();
        if (targetPositions.IsCreated) targetPositions.Dispose();
        if (targetVelocities.IsCreated) targetVelocities.Dispose();
        if (guidanceCommands.IsCreated) guidanceCommands.Dispose();
    }
    
    public void UpdateGuidance(List<Interceptor> interceptors, float deltaTime)
    {
        if (interceptors.Count == 0) return;
        
        // Populate arrays
        for (int i = 0; i < interceptors.Count; i++)
        {
            Interceptor interceptor = interceptors[i];
            
            interceptorPositions[i] = interceptor.transform.position;
            interceptorVelocities[i] = interceptor.GetVelocity();
            
            if (interceptor.target != null)
            {
                Vector3 predictedPosition = interceptor.target.transform.position;
                Vector3 predictedVelocity = interceptor.target.GetVelocity();
                
                // Apply Kalman filtering for noise reduction
                if (useKalmanFilter && kalmanFilters[i] != null)
                {
                    predictedPosition = kalmanFilters[i].Update(predictedPosition, deltaTime);
                    predictedVelocity = kalmanFilters[i].GetVelocity();
                }
                
                targetPositions[i] = predictedPosition;
                targetVelocities[i] = predictedVelocity;
            }
            else
            {
                targetPositions[i] = float3.zero;
                targetVelocities[i] = float3.zero;
            }
        }
        
        // Execute guidance calculation job
        ProportionalNavigationJob job = new ProportionalNavigationJob
        {
            interceptorPositions = interceptorPositions,
            interceptorVelocities = interceptorVelocities,
            targetPositions = targetPositions,
            targetVelocities = targetVelocities,
            navigationConstant = navigationConstant,
            maxAcceleration = maxAcceleration,
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
            float distanceToTarget = math.distance(interceptorPositions[i], targetPositions[i]);
            if (distanceToTarget <= proximityFuseRange)
            {
                interceptors[i].TriggerDetonation();
            }
        }
    }
}
```

### Kalman Filter for Target Tracking

```csharp
public class KalmanFilter
{
    private Vector3 position;
    private Vector3 velocity;
    private Matrix4x4 covariance;
    private Matrix4x4 processNoise;
    private Matrix4x4 measurementNoise;
    
    public KalmanFilter(float processNoiseValue, float measurementNoiseValue)
    {
        position = Vector3.zero;
        velocity = Vector3.zero;
        
        covariance = Matrix4x4.identity;
        processNoise = Matrix4x4.identity * processNoiseValue;
        measurementNoise = Matrix4x4.identity * measurementNoiseValue;
    }
    
    public Vector3 Update(Vector3 measurement, float deltaTime)
    {
        // Prediction step
        Vector3 predictedPosition = position + velocity * deltaTime;
        Matrix4x4 stateTransition = CreateStateTransitionMatrix(deltaTime);
        Matrix4x4 predictedCovariance = stateTransition * covariance * stateTransition.transpose + processNoise;
        
        // Update step
        Vector3 innovation = measurement - predictedPosition;
        Matrix4x4 innovationCovariance = predictedCovariance + measurementNoise;
        Matrix4x4 kalmanGain = predictedCovariance * Matrix4x4Inverse(innovationCovariance);
        
        // Update state
        position = predictedPosition + MultiplyVector(kalmanGain, innovation);
        velocity = velocity + MultiplyVector(kalmanGain, innovation) / deltaTime;
        covariance = (Matrix4x4.identity - kalmanGain) * predictedCovariance;
        
        return position;
    }
    
    public Vector3 GetVelocity()
    {
        return velocity;
    }
    
    private Matrix4x4 CreateStateTransitionMatrix(float deltaTime)
    {
        Matrix4x4 matrix = Matrix4x4.identity;
        matrix.m03 = deltaTime;
        matrix.m13 = deltaTime;
        matrix.m23 = deltaTime;
        return matrix;
    }
    
    private Vector3 MultiplyVector(Matrix4x4 matrix, Vector3 vector)
    {
        return new Vector3(
            matrix.m00 * vector.x + matrix.m01 * vector.y + matrix.m02 * vector.z,
            matrix.m10 * vector.x + matrix.m11 * vector.y + matrix.m12 * vector.z,
            matrix.m20 * vector.x + matrix.m21 * vector.y + matrix.m22 * vector.z
        );
    }
    
    private Matrix4x4 Matrix4x4Inverse(Matrix4x4 matrix)
    {
        return matrix.inverse;
    }
}
```

## Collision Detection and Response

### Proximity Fuse System

```csharp
public class ProximityFuse : MonoBehaviour
{
    [Header("Proximity Settings")]
    public float fuseRange = 5f;
    public LayerMask targetLayers;
    public float scanInterval = 0.1f;
    
    [Header("Detonation")]
    public GameObject explosionPrefab;
    public float blastRadius = 10f;
    public float blastDamage = 100f;
    public AnimationCurve damageCurve = AnimationCurve.EaseInOut(0, 1, 1, 0);
    
    private SphereCollider detectionZone;
    private List<Collider> targetsInRange = new List<Collider>();
    private bool hasDetonated = false;
    
    void Start()
    {
        // Setup detection zone
        detectionZone = gameObject.AddComponent<SphereCollider>();
        detectionZone.radius = fuseRange;
        detectionZone.isTrigger = true;
        
        // Start scanning
        InvokeRepeating(nameof(ScanForTargets), 0f, scanInterval);
    }
    
    void OnTriggerEnter(Collider other)
    {
        if (IsValidTarget(other) && !targetsInRange.Contains(other))
        {
            targetsInRange.Add(other);
        }
    }
    
    void OnTriggerExit(Collider other)
    {
        if (targetsInRange.Contains(other))
        {
            targetsInRange.Remove(other);
        }
    }
    
    private void ScanForTargets()
    {
        if (hasDetonated) return;
        
        // Clean up null references
        targetsInRange.RemoveAll(t => t == null);
        
        if (targetsInRange.Count > 0)
        {
            // Find closest target
            Collider closestTarget = GetClosestTarget();
            float distance = Vector3.Distance(transform.position, closestTarget.transform.position);
            
            // Check if we should detonate
            if (ShouldDetonate(closestTarget, distance))
            {
                Detonate();
            }
        }
    }
    
    private bool ShouldDetonate(Collider target, float distance)
    {
        // Basic distance check
        if (distance <= fuseRange)
        {
            // Additional checks for optimal detonation timing
            Vector3 targetVelocity = GetTargetVelocity(target);
            Vector3 relativeVelocity = GetComponent<Rigidbody>().velocity - targetVelocity;
            
            // Check if we're getting closer or farther
            Vector3 toTarget = target.transform.position - transform.position;
            float closingRate = Vector3.Dot(relativeVelocity, toTarget.normalized);
            
            // Detonate if we're close and moving away (optimal timing)
            return closingRate <= 0 || distance <= fuseRange * 0.5f;
        }
        
        return false;
    }
    
    private void Detonate()
    {
        if (hasDetonated) return;
        hasDetonated = true;
        
        // Create explosion effect
        if (explosionPrefab != null)
        {
            Instantiate(explosionPrefab, transform.position, Quaternion.identity);
        }
        
        // Apply blast damage
        ApplyBlastDamage();
        
        // Notify systems
        EventManager.Instance?.TriggerEvent("InterceptorDetonated", new DetonationData
        {
            position = transform.position,
            blastRadius = blastRadius,
            damage = blastDamage,
            interceptor = gameObject
        });
        
        // Destroy interceptor
        Destroy(gameObject);
    }
    
    private void ApplyBlastDamage()
    {
        Collider[] affectedObjects = Physics.OverlapSphere(transform.position, blastRadius, targetLayers);
        
        foreach (Collider obj in affectedObjects)
        {
            float distance = Vector3.Distance(transform.position, obj.transform.position);
            float normalizedDistance = distance / blastRadius;
            float damageMultiplier = damageCurve.Evaluate(1f - normalizedDistance);
            
            IDamageable damageable = obj.GetComponent<IDamageable>();
            if (damageable != null)
            {
                float finalDamage = blastDamage * damageMultiplier;
                damageable.TakeDamage(finalDamage, transform.position);
            }
        }
    }
    
    private Collider GetClosestTarget()
    {
        Collider closest = null;
        float closestDistance = float.MaxValue;
        
        foreach (Collider target in targetsInRange)
        {
            if (target == null) continue;
            
            float distance = Vector3.Distance(transform.position, target.transform.position);
            if (distance < closestDistance)
            {
                closestDistance = distance;
                closest = target;
            }
        }
        
        return closest;
    }
    
    private bool IsValidTarget(Collider other)
    {
        return ((1 << other.gameObject.layer) & targetLayers) != 0;
    }
    
    private Vector3 GetTargetVelocity(Collider target)
    {
        Rigidbody rb = target.GetComponent<Rigidbody>();
        return rb != null ? rb.velocity : Vector3.zero;
    }
}

public interface IDamageable
{
    void TakeDamage(float damage, Vector3 source);
}

[System.Serializable]
public struct DetonationData
{
    public Vector3 position;
    public float blastRadius;
    public float damage;
    public GameObject interceptor;
}
```

## Performance Optimizations

### Physics LOD System

```csharp
public class PhysicsLODManager : MonoBehaviour
{
    [Header("LOD Settings")]
    public float highDetailRange = 100f;
    public float mediumDetailRange = 300f;
    public Camera referenceCamera;
    
    [Header("Performance")]
    public int maxHighDetailObjects = 20;
    public int maxMediumDetailObjects = 50;
    
    private Dictionary<Rigidbody, PhysicsLODLevel> trackedObjects = new Dictionary<Rigidbody, PhysicsLODLevel>();
    private List<Rigidbody> highDetailObjects = new List<Rigidbody>();
    private List<Rigidbody> mediumDetailObjects = new List<Rigidbody>();
    
    public enum PhysicsLODLevel
    {
        High,    // Full physics simulation
        Medium,  // Reduced update rate
        Low,     // Kinematic with trajectory prediction
        Culled   // No physics updates
    }
    
    void Update()
    {
        UpdatePhysicsLOD();
    }
    
    public void RegisterObject(Rigidbody rb)
    {
        if (!trackedObjects.ContainsKey(rb))
        {
            trackedObjects[rb] = PhysicsLODLevel.High;
        }
    }
    
    public void UnregisterObject(Rigidbody rb)
    {
        trackedObjects.Remove(rb);
        highDetailObjects.Remove(rb);
        mediumDetailObjects.Remove(rb);
    }
    
    private void UpdatePhysicsLOD()
    {
        highDetailObjects.Clear();
        mediumDetailObjects.Clear();
        
        // Calculate distances and sort objects
        var sortedObjects = trackedObjects.Keys
            .Where(rb => rb != null)
            .OrderBy(rb => Vector3.Distance(rb.position, referenceCamera.transform.position))
            .ToList();
        
        foreach (Rigidbody rb in sortedObjects)
        {
            float distance = Vector3.Distance(rb.position, referenceCamera.transform.position);
            PhysicsLODLevel newLOD = DetermineLODLevel(distance, rb);
            
            if (trackedObjects[rb] != newLOD)
            {
                ApplyLODLevel(rb, newLOD);
                trackedObjects[rb] = newLOD;
            }
        }
    }
    
    private PhysicsLODLevel DetermineLODLevel(float distance, Rigidbody rb)
    {
        // Camera frustum culling
        Plane[] frustumPlanes = GeometryUtility.CalculateFrustumPlanes(referenceCamera);
        if (!GeometryUtility.TestPlanesAABB(frustumPlanes, rb.bounds))
        {
            return PhysicsLODLevel.Culled;
        }
        
        // Distance-based LOD
        if (distance <= highDetailRange && highDetailObjects.Count < maxHighDetailObjects)
        {
            return PhysicsLODLevel.High;
        }
        else if (distance <= mediumDetailRange && mediumDetailObjects.Count < maxMediumDetailObjects)
        {
            return PhysicsLODLevel.Medium;
        }
        else
        {
            return PhysicsLODLevel.Low;
        }
    }
    
    private void ApplyLODLevel(Rigidbody rb, PhysicsLODLevel lod)
    {
        PhysicsLODComponent lodComponent = rb.GetComponent<PhysicsLODComponent>();
        if (lodComponent == null)
        {
            lodComponent = rb.gameObject.AddComponent<PhysicsLODComponent>();
        }
        
        switch (lod)
        {
            case PhysicsLODLevel.High:
                rb.isKinematic = false;
                rb.interpolation = RigidbodyInterpolation.Interpolate;
                lodComponent.UpdateRate = 1f; // Every frame
                highDetailObjects.Add(rb);
                break;
                
            case PhysicsLODLevel.Medium:
                rb.isKinematic = false;
                rb.interpolation = RigidbodyInterpolation.None;
                lodComponent.UpdateRate = 0.5f; // Every other frame
                mediumDetailObjects.Add(rb);
                break;
                
            case PhysicsLODLevel.Low:
                rb.isKinematic = true;
                lodComponent.UpdateRate = 0.1f; // 10% of frames
                lodComponent.EnableTrajectoryPrediction = true;
                break;
                
            case PhysicsLODLevel.Culled:
                rb.isKinematic = true;
                lodComponent.UpdateRate = 0f; // No updates
                break;
        }
    }
}

public class PhysicsLODComponent : MonoBehaviour
{
    public float UpdateRate { get; set; } = 1f;
    public bool EnableTrajectoryPrediction { get; set; } = false;
    
    private float lastUpdateTime;
    private Vector3 predictedPosition;
    private Vector3 predictedVelocity;
    
    void FixedUpdate()
    {
        if (Time.fixedTime - lastUpdateTime >= 1f / (60f * UpdateRate))
        {
            if (EnableTrajectoryPrediction)
            {
                UpdateTrajectoryPrediction();
            }
            lastUpdateTime = Time.fixedTime;
        }
    }
    
    private void UpdateTrajectoryPrediction()
    {
        float deltaTime = Time.fixedDeltaTime;
        
        // Simple trajectory prediction
        predictedVelocity += Physics.gravity * deltaTime;
        predictedPosition += predictedVelocity * deltaTime;
        
        transform.position = predictedPosition;
    }
}
```

This physics system migration guide provides Unity-specific implementations that preserve the sophisticated ballistics calculations while leveraging Unity's optimized physics engine and Job System for better performance.