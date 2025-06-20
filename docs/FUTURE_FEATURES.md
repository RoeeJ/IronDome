# Future Features for Iron Dome Simulator

## Priority 1: Expand Game World (Critical Foundation)
**Current Issue**: 200x200 world is too small, forcing unrealistic physics scaling

### Implementation Details:
- Expand to 1000x1000 or 2000x2000 units
- Adjust camera system for larger view
- Implement minimap for navigation
- Scale physics to be more realistic with larger world
- Add fog of war or view distance limits for performance

### Benefits:
- More realistic trajectories and physics
- Better strategic depth for battery placement
- Room for multiple cities/targets
- Proper engagement ranges for different battery types
- Less cramped gameplay

## Priority 2: Advanced Threat System
### New Threat Types:
1. **MIRV (Multiple Independently-targetable Reentry Vehicle)**
   - Splits into 3-8 warheads at high altitude
   - Each warhead can target different locations
   - Requires multiple interceptors or area defense
   - High priority target

2. **ICBM (Intercontinental Ballistic Missile)**
   - Extremely high altitude (edge of space)
   - Very fast descent phase
   - Requires specialized high-altitude interceptors
   - Long warning time but difficult intercept

3. **Decoy Missiles**
   - Cheap, numerous
   - Similar radar signature to real threats
   - Wastes interceptor resources
   - Player must decide whether to engage

4. **Stealth Cruise Missiles**
   - Low altitude, terrain following
   - Reduced radar cross-section
   - Harder to detect and track
   - Requires close-range defenses

## Priority 3: Advanced Defense Systems
### New Battery Types:
1. **Arrow 3 System**
   - Specializes in exo-atmospheric intercepts
   - Very long range (500km+)
   - Effective against ICBMs and satellites
   - High cost per interceptor
   - Slow reload

2. **Iron Beam (Laser)**
   - Directed energy weapon
   - Instant hit, no travel time
   - Limited by power/heat buildup
   - Very cheap per shot
   - Short range (7-10km)
   - Ineffective in bad weather

3. **David's Sling**
   - Medium-long range (40-300km)
   - Can engage multiple targets
   - Good against aircraft and cruise missiles
   - Moderate cost

### Integration:
- Each battery type has specific strengths/weaknesses
- Layered defense strategy required
- Different resource costs (power vs interceptors)

## Priority 4: Tech Outpost System
### Outpost Types:
1. **Repair Station**
   - Slowly repairs batteries in radius
   - Can revive destroyed batteries (very slowly)
   - Vulnerable to attack

2. **Radar Station**
   - Extends detection range
   - Improves tracking accuracy
   - Can detect stealth threats better
   - Network effect with multiple stations

3. **Power Station**
   - Powers laser defenses
   - Generates resources over time
   - Critical infrastructure

4. **Command Center**
   - Improves coordination
   - Faster reload times in radius
   - Better intercept calculations

### Mechanics:
- Outposts can be targeted by smart threats
- Require defense priority decisions
- Can be upgraded
- Network effects when multiple outposts overlap

## Priority 5: Skill Tree & Progression
### Research Trees:
1. **Detection Branch**
   - Extended radar range
   - Stealth detection
   - Threat classification
   - Early warning systems

2. **Interception Branch**
   - Improved accuracy
   - Faster projectiles
   - Multi-target engagement
   - Reduced minimum range

3. **Economics Branch**
   - Reduced costs
   - Faster resource generation
   - Bulk purchasing discounts
   - Emergency funding

4. **Defense Branch**
   - Battery hardening
   - Faster repairs
   - Redundant systems
   - Decoy batteries

### Progression Mechanics:
- Research points from successful defenses
- Persistent between games
- Specialization vs generalization choices
- Prestige system for hardcore players

## Additional Features to Consider:
1. **Weather System**
   - Affects laser effectiveness
   - Reduces visibility/radar range
   - Adds strategic timing element

2. **Day/Night Cycle**
   - Visual variety
   - Night vision mode
   - Affects certain threat types

3. **Allied Support**
   - Call in air strikes
   - Request emergency interceptors
   - Allied radar data

4. **Campaign Mode**
   - Story-driven scenarios
   - Historical battles
   - Progressive difficulty

5. **Multiplayer Considerations**
   - Cooperative defense
   - Competitive modes
   - Shared resources

## Technical Requirements:
- Larger world requires LOD system
- Spatial partitioning for performance
- Efficient threat pooling
- Network optimization for multiplayer
- Save system for progression
- Modular architecture for new systems

## Performance Considerations:
- Implement culling for off-screen objects
- Use instanced rendering for multiple threats
- Optimize physics with spatial hashing
- Progressive loading for large worlds
- Efficient particle pooling for effects