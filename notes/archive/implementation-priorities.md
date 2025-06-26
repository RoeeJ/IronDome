# Iron Dome Simulator - Implementation Priorities

## Quick Start Checklist
When starting development:
1. Run `bun create vite . --template vanilla`
2. Install core dependencies: `bun add three cannon-es`
3. Set up basic Three.js scene first
4. Add physics after rendering works
5. Test performance early and often

## Priority Order for MVP

### Week 1-2: Core Foundation
**Must Have:**
- Three.js scene with ground and sky
- Basic camera controls (OrbitControls)
- Simple projectile launching
- Basic physics integration
- Trajectory visualization

**Nice to Have:**
- Debug UI panel
- Multiple camera angles
- Grid helper for scale

### Week 3-4: Threat System
**Must Have:**
- Threat spawning from edges
- Ballistic trajectory calculation
- Impact point prediction
- Multiple simultaneous threats

**Nice to Have:**
- Different threat types
- Randomized launch parameters
- Threat trails

### Week 5-6: Interception Basics
**Must Have:**
- Iron Dome battery model
- Interceptor launching
- Basic collision detection
- Success/failure indication

**Nice to Have:**
- Launch smoke effects
- Radar cone visualization
- Battery rotation

## Critical Technical Decisions

### Physics Engine Choice
**Recommended: Cannon-es**
- Pros: Lighter weight, easier integration, sufficient for our needs
- Cons: Less features than Rapier

**Alternative: Rapier**
- Pros: More accurate, better performance, WASM-based
- Cons: More complex setup, larger bundle

### Architecture Pattern
**Recommended: Component-based**
```javascript
class GameObject {
  constructor() {
    this.components = []
  }
  
  addComponent(component) {
    this.components.push(component)
  }
  
  update(dt) {
    this.components.forEach(c => c.update(dt))
  }
}
```

### State Management
**Recommended: Simple event-driven**
```javascript
class EventBus {
  on(event, callback) { }
  emit(event, data) { }
  off(event, callback) { }
}
```

## Performance Guidelines

### Object Limits for 60 FPS
- Maximum simultaneous threats: 50
- Maximum active interceptors: 100
- Maximum particle count: 10,000
- Maximum trail points: 1,000 per object

### Optimization Priorities
1. **Object pooling** - Biggest impact
2. **LOD system** - Second priority
3. **Frustum culling** - Built into Three.js
4. **Spatial indexing** - For many objects

## Common Pitfalls to Avoid

### Performance Killers
- Creating new objects every frame
- Not disposing of Three.js resources
- Updating physics too frequently
- Too many draw calls

### Architecture Mistakes
- Tight coupling between physics and rendering
- Not using events for communication
- Hardcoding magic numbers
- Missing proper game loop

## Testing Strategy

### Manual Testing Checklist
- [ ] Launch single projectile
- [ ] Launch from all directions
- [ ] Spawn 50+ threats
- [ ] Intercept at various ranges
- [ ] Test on mobile devices
- [ ] Check memory leaks

### Automated Tests (If Time Permits)
- Trajectory calculations
- Collision detection
- Interception algorithms
- Performance benchmarks

## Code Style Guidelines

### Three.js Best Practices
```javascript
// Good: Reuse geometries and materials
const geometry = new THREE.SphereGeometry(1, 16, 16)
const material = new THREE.MeshStandardMaterial()

// Bad: Creating new ones for each object
missiles.forEach(() => {
  const geo = new THREE.SphereGeometry(1, 16, 16) // Don't do this
})
```

### Physics Integration
```javascript
// Good: Sync after physics update
function update() {
  world.step(1/60)
  syncPhysicsToGraphics()
  renderer.render(scene, camera)
}

// Bad: Updating positions manually
missile.position.y += velocity * dt // Let physics handle this
```

## Resource Management

### Asset Guidelines
- Keep models under 10k vertices
- Use compressed textures (basis)
- Limit texture sizes to 1024x1024
- Use instanced meshes for repeated objects

### Memory Budget
- Target: < 500MB total
- Three.js scene: ~200MB
- Physics world: ~50MB
- UI and logic: ~50MB
- Buffer: ~200MB

## Deployment Checklist

### Before First Deploy
- [ ] Remove all console.logs
- [ ] Enable production builds
- [ ] Test on slow 3G
- [ ] Check mobile performance
- [ ] Add loading screen
- [ ] Add error boundaries

### Performance Targets
- Initial load: < 3 seconds
- Time to interactive: < 5 seconds
- Consistent 60 FPS on mid-range hardware
- Works on 2GB RAM devices

## Future-Proofing

### Extensibility Points
- Plugin system for new threat types
- Configurable physics parameters
- Modular UI components
- Save/load system ready

### Technical Debt to Avoid
- Don't skip TypeScript setup
- Add tests early, not later
- Document physics assumptions
- Keep dependencies minimal