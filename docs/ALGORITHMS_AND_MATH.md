# Algorithms and Mathematical Foundations

## Core Physics Equations

### 1. Ballistic Trajectory

The foundation of the projectile system uses classical mechanics equations of motion under constant acceleration (gravity).

#### Position as a function of time:
```
x(t) = x₀ + v₀ₓ·t
y(t) = y₀ + v₀ᵧ·t - ½g·t²
z(t) = z₀ + v₀ᵤ·t
```

#### Velocity as a function of time:
```
vₓ(t) = v₀ₓ
vᵧ(t) = v₀ᵧ - g·t
vᵤ(t) = v₀ᵤ
```

#### Maximum height:
```
h_max = y₀ + (v₀ᵧ²)/(2g)
```

#### Time to reach maximum height:
```
t_apex = v₀ᵧ/g
```

#### Range on level ground:
```
R = (v₀²·sin(2θ))/g
```

### 2. Launch Angle Calculation

Given a starting position, target position, and launch velocity, we need to find the launch angle θ.

#### The trajectory equation:
```
y = x·tan(θ) - (g·x²)/(2v₀²·cos²(θ))
```

#### Rearranging for angle calculation:
```
tan(θ) = (v₀² ± √(v₀⁴ - g(g·R² + 2·Δy·v₀²)))/(g·R)
```

Where:
- R = horizontal range
- Δy = height difference (target_y - launch_y)
- v₀ = launch velocity

This gives two solutions:
- θ₁: High angle (mortar-like)
- θ₂: Low angle (direct fire)

### 3. Interception Mathematics

#### Collision Prediction
To find when two projectiles will collide, we solve:
```
|P_threat(t) - P_interceptor(t)| < threshold
```

This expands to finding t where:
```
(x₁(t) - x₂(t))² + (y₁(t) - y₂(t))² + (z₁(t) - z₂(t))² < r²
```

#### Proportional Navigation
The interceptor uses proportional navigation guidance:
```
a_commanded = N·Vc·Ω
```

Where:
- N = navigation constant (typically 3-5)
- Vc = closing velocity
- Ω = line-of-sight rotation rate

#### Lead Calculation
To hit a moving target:
```
t_intercept = distance_to_target / relative_velocity
lead_position = target_position + target_velocity * t_intercept
```

### 4. Threat-Specific Calculations

#### Mortar Trajectories
Mortars use very high launch angles (80-85°):
```
θ_mortar = 80° + random(0°, 5°)
v_required = √((R·g)/sin(2θ))
```

#### Drone Altitude Control
PID-like controller for altitude maintenance:
```
F_lift = K_p·(h_desired - h_current) + F_base
```

Where:
- K_p = proportional gain (10 in our implementation)
- F_base = base lift force to counteract gravity (15)

#### Cruise Missile Terrain Following
Simple altitude band maintenance:
```
if (h > h_cruise):
    F_y = -50  # Dive force
elif (h < 0.8 * h_cruise):
    F_y = 100  # Climb force
```

### 5. Impact Time Calculation

For ballistic projectiles, solving the quadratic equation when y = 0:
```
0 = y₀ + v₀ᵧ·t - ½g·t²
```

Using quadratic formula:
```
t = (-v₀ᵧ ± √(v₀ᵧ² + 2g·y₀))/(-g)
```

We take the positive root that gives t > 0.

### 6. Threat Prioritization Algorithm

Multi-criteria scoring function:
```
Score = w₁·S_time + w₂·S_size + w₃·S_distance + w₄·S_probability
```

Where:
- S_time = 1/time_to_impact (urgency)
- S_size = warhead_size/max_warhead_size (damage potential)
- S_distance = 1/distance_to_assets (proximity to defended area)
- S_probability = P(successful_intercept) (feasibility)

Weights used:
- w₁ = 0.4 (time is most critical)
- w₂ = 0.3 (damage potential)
- w₃ = 0.2 (proximity)
- w₄ = 0.1 (feasibility)

### 7. Intercept Probability Calculation

Simplified probability model:
```
P(intercept) = P_base × F_range × F_altitude × F_time
```

Where:
- P_base = 0.9 (base probability)
- F_range = exp(-distance/effective_range)
- F_altitude = min(1, altitude/min_altitude)
- F_time = min(1, time_to_impact/min_time)

### 8. Spatial Indexing Grid

Grid-based spatial partitioning for O(1) lookups:
```
cell_x = floor(position.x / cell_size)
cell_y = floor(position.y / cell_size)
cell_z = floor(position.z / cell_size)
hash = cell_x + cell_y * grid_width + cell_z * grid_width * grid_height
```

### 9. Newton-Raphson for Intercept Refinement

Iterative refinement of intercept time:
```
t_n+1 = t_n - f(t_n)/f'(t_n)
```

Where f(t) is the miss distance at time t:
```
f(t) = |P_threat(t) - P_interceptor(t_launch + t_flight(t))| - r_threshold
```

## Performance Optimizations

### 1. Instanced Rendering Matrix Calculation
For each instance:
```
matrix = translation_matrix × rotation_matrix × scale_matrix
```

Packed into a single Matrix4x4 per instance for GPU instancing.

### 2. Trail Optimization
Instead of particle systems, use ribbon rendering:
```
vertices[i] = position - (velocity.normalized × spacing × i)
opacity[i] = 1.0 - (i / trail_length)
```

### 3. LOD Distance Calculation
Simple distance-based LOD:
```
if (distance < 50):
    lod_level = 0  # High detail
elif (distance < 150):
    lod_level = 1  # Medium detail
else:
    lod_level = 2  # Low detail
```

## Constants Used

### Physics Constants
- Gravity: 9.82 m/s²
- Air density: 1.225 kg/m³ (sea level)
- Drag coefficient: 0.47 (sphere)

### Simulation Parameters
- Time step: 1/60 second (16.67ms)
- Collision threshold: 5 meters
- Minimum intercept altitude: 100 meters
- Maximum intercept range: 70 km

### Threat Velocities (m/s)
- Short Range Rocket: 300
- Medium Range: 600
- Long Range: 1000
- Mortar: 200
- Drone (slow): 30
- Drone (fast): 50
- Cruise Missile: 250
- Interceptor: 900-1200

## Implementation Notes

### Coordinate System
- Y-up (standard Three.js/Unity)
- Distances in meters
- Time in seconds
- Angles in radians internally, degrees for UI

### Numerical Stability
- Clamp very small velocities to zero
- Use epsilon comparisons for floating point
- Limit integration steps for physics
- Validate all square roots before calculation

### Edge Cases Handled
1. Target out of range (discriminant < 0)
2. Negative time solutions
3. Below-ground positions
4. Zero velocity
5. Vertical launches (avoid division by zero)
6. Simultaneous impacts
7. Lost track scenarios

## Validation Methods

### Trajectory Validation
Compare simulated trajectory with analytical solution:
```
error = |position_simulated - position_analytical|
```

Should be < 0.1m for 10-second flights.

### Energy Conservation
Check total energy remains constant (within numerical error):
```
E_total = ½mv² + mgh
ΔE/E < 0.001 per second
```

### Statistical Validation
- Intercept success rate: 85-95% for rockets
- Drone intercept rate: 70-80%
- Mortar intercept rate: 60-70%
- False positive rate: < 1%