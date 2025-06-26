# Progression System Design

## Current State

### Existing Progression Elements
- **Battery Upgrades**: Levels 1-5 with linear cost scaling (500 * level)
- **Resource Economy**: Credits for purchasing interceptors, batteries, and upgrades
- **Wave Progression**: 8% difficulty increase per wave
- **Unlockable Domes**: Additional batteries at exponentially increasing costs

### Current Limitations
- All battery stats are hardcoded
- No specialization options
- Limited strategic choices
- No persistent progression between sessions

## Proposed Skill Tree System

### 1. Battery Enhancement Branch (Per-Battery Upgrades)

#### Interceptor Performance
- **Speed Upgrades** (5 levels)
  - Base: 100 m/s
  - Increments: +10 m/s per level
  - Cost: 500, 1000, 2000, 4000, 8000 credits
  - Impact: Faster intercept times, better against fast threats

- **Reload Time** (5 levels)
  - Base: 3000ms
  - Reduction: -300ms per level
  - Cost: 400, 800, 1600, 3200, 6400 credits
  - Impact: Higher fire rate, better swarm handling

- **Engagement Range** (5 levels)
  - Base: Min 4m, Max 70m
  - Increase: +10m max range per level
  - Cost: 600, 1200, 2400, 4800, 9600 credits
  - Impact: Earlier engagement, more intercept opportunities

#### Targeting Systems
- **Accuracy Enhancement** (5 levels)
  - Base: 95% success rate
  - Increase: +1% per level (max 99%)
  - Cost: 1000, 2000, 4000, 8000, 16000 credits
  - Impact: Fewer missed intercepts

- **Multi-Target Tracking** (3 levels)
  - Base: 1.3 aggressiveness factor
  - Increase: +0.2 per level
  - Cost: 2000, 5000, 10000 credits
  - Impact: Better simultaneous threat handling

#### Hardware Upgrades
- **Additional Launchers** (2 levels)
  - Base: 6 tubes
  - Adds: +2 tubes per level (max 10)
  - Cost: 5000, 15000 credits
  - Impact: More simultaneous launches

- **Interceptor Capacity** (5 levels)
  - Base: 20 interceptors
  - Increase: +10 per level
  - Cost: 300, 600, 1200, 2400, 4800 credits
  - Impact: Longer sustained defense

### 2. Global Upgrades Branch

#### Detection & Tracking
- **Radar Range Extension** (5 levels)
  - Increases threat detection distance
  - Earlier warning = more time to react
  - Cost: 1000, 2500, 5000, 10000, 20000 credits

- **Advanced Threat Classification** (3 levels)
  - Better threat type identification
  - Optimized interceptor allocation
  - Cost: 3000, 8000, 15000 credits

- **Weather Compensation** (3 levels)
  - Reduces weather impact on radar/tracking
  - Maintains accuracy in poor conditions
  - Cost: 2000, 5000, 10000 credits

#### Economy & Resources
- **Credit Generation** (5 levels)
  - Base: 10 credits per intercept
  - Increase: +2 per level
  - Cost: 1000, 2000, 4000, 8000, 16000 credits

- **Score Multiplier** (3 levels)
  - Base: 1.0x
  - Increase: +0.5x per level
  - Cost: 5000, 12000, 25000 credits

- **Efficiency Bonus** (5 levels)
  - Reduces all upgrade costs by 5% per level
  - Cost: 2000, 4000, 8000, 16000, 32000 credits

### 3. Specialized Interceptor Types

#### High-Velocity Interceptor
- **Unlock Cost**: 10000 credits
- **Per Unit Cost**: 150 credits
- **Speed**: 150 m/s (50% faster)
- **Best Against**: Fast-moving threats, cruise missiles

#### Cluster Interceptor
- **Unlock Cost**: 15000 credits
- **Per Unit Cost**: 200 credits
- **Effect**: Splits into 3 smaller interceptors
- **Best Against**: Drone swarms, multiple close threats

#### EMP Interceptor
- **Unlock Cost**: 20000 credits
- **Per Unit Cost**: 300 credits
- **Effect**: Disables electronics in 30m radius
- **Best Against**: Smart missiles, drone clusters

#### Long-Range Interceptor
- **Unlock Cost**: 25000 credits
- **Per Unit Cost**: 250 credits
- **Range**: 150m max (2x normal)
- **Best Against**: High-altitude threats

### 4. Research & Development Tree

#### Tracking Algorithms
- **Kalman Filter Enhancement** (3 levels)
  - Improves prediction accuracy
  - Better trajectory estimation
  - Prerequisites: None

- **Machine Learning Targeting** (5 levels)
  - Learns from past intercepts
  - Adapts to threat patterns
  - Prerequisites: Kalman Filter Level 2

#### Coordination Systems
- **Network-Centric Defense** (3 levels)
  - Better battery coordination
  - Reduces overlap and waste
  - Prerequisites: Multi-Target Tracking Level 2

- **Predictive Allocation** (3 levels)
  - AI-driven threat assignment
  - Optimizes resource usage
  - Prerequisites: Network-Centric Level 2

#### Advanced Countermeasures
- **Anti-Decoy Systems** (3 levels)
  - Identifies and ignores decoys
  - Prerequisites: Advanced Threat Classification Level 2

- **Trajectory Shaping** (5 levels)
  - Optimizes intercept paths
  - Reduces fuel/time to target
  - Prerequisites: Machine Learning Level 3

## Implementation Strategy

### Phase 1: Core Framework
1. Create ProgressionManager class
2. Implement save/load system
3. Add upgrade UI panels
4. Create skill tree visualization

### Phase 2: Battery Upgrades
1. Make battery stats configurable
2. Implement per-battery upgrade system
3. Add visual indicators for upgraded batteries
4. Balance costs and effects

### Phase 3: Global Systems
1. Implement global upgrade effects
2. Create research tree UI
3. Add unlock notifications
4. Implement prerequisites system

### Phase 4: Specialized Interceptors
1. Create new interceptor types
2. Add selection UI
3. Implement special effects
4. Balance against standard interceptors

### Persistence System
- Save progression to localStorage
- Track lifetime stats
- Achievement system integration
- Prestige/reset options

### Balancing Considerations
- Upgrade costs should scale with game economy
- No single upgrade path should dominate
- Specialization should be rewarding but not required
- New players should feel progression early
- Veterans should have long-term goals

### UI/UX Design
- Clean, intuitive skill tree interface
- Clear cost/benefit displays
- Visual progress indicators
- Tooltips explaining each upgrade
- "What's next" recommendations for new players