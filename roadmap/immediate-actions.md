# Iron Dome Simulator - Immediate Action Plan

## 🚀 First Moves (In Order)

### Step 1: Clean Up React Template (30 min)
```bash
# Remove React-specific files
rm src/App.tsx src/APITester.tsx src/frontend.tsx

# Keep index.html but we'll modify it
# Keep index.tsx as our server entry point
```

### Step 2: Install Core Dependencies (5 min)
```bash
bun add three @types/three
bun add cannon-es @types/cannon-es
bun add lil-gui
bun add -d vite-plugin-glsl  # For shader support later
```

### Step 3: Create Three.js Entry Point (45 min)
Create `src/main.ts`:
```typescript
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import CANNON from 'cannon-es'
import GUI from 'lil-gui'

// Basic setup code
```

### Step 4: Update HTML Structure (15 min)
Modify `src/index.html`:
```html
<!DOCTYPE html>
<html>
<head>
    <title>Iron Dome Simulator</title>
    <style>
        body { margin: 0; overflow: hidden; }
        canvas { display: block; }
    </style>
</head>
<body>
    <script type="module" src="/main.ts"></script>
</body>
</html>
```

### Step 5: Create First Scene (1 hour)
Implement in `src/main.ts`:
1. Three.js renderer setup
2. Basic scene with ground plane
3. Sky/fog for atmosphere
4. Camera with OrbitControls
5. Basic lighting (ambient + directional)

### Step 6: Add Physics World (45 min)
1. Initialize Cannon-es world
2. Add ground physics body
3. Create sync function between physics and graphics
4. Test with a falling sphere

### Step 7: Implement First Projectile (1 hour)
1. Create Projectile class
2. Add launch function
3. Visualize trajectory with line geometry
4. Add debug controls to GUI

## 📋 Day 1 Checklist
- [ ] React template removed
- [ ] Three.js dependencies installed
- [ ] Basic scene rendering
- [ ] Camera controls working
- [ ] Physics world integrated
- [ ] One projectile launching and falling

## 🎯 Success Criteria for Day 1
You should be able to:
1. Run `bun dev` and see a 3D scene
2. Orbit camera around the scene
3. Click a button to launch a projectile
4. See the projectile follow a parabolic path
5. Have basic debug controls in GUI

## 💡 Pro Tips
1. Start with a small scene (100x100 units)
2. Use a visible grid helper initially
3. Make the first projectile a simple sphere
4. Add axis helpers to understand orientation
5. Use bright colors for debugging

## 🚧 Common Pitfalls to Avoid
1. Don't worry about textures/models yet
2. Keep physics timestep fixed at 1/60
3. Don't optimize until it works
4. Test in Chrome DevTools with FPS meter on

## 📁 Initial Project Structure
```
src/
├── main.ts           # Entry point
├── scene/
│   └── SceneManager.ts
├── physics/
│   └── PhysicsWorld.ts
├── entities/
│   └── Projectile.ts
├── utils/
│   └── helpers.ts
└── index.html
```

## 🔄 Next Steps After Day 1
Once the basics work:
1. Add trajectory prediction
2. Implement multiple projectiles
3. Add object pooling
4. Create threat spawning system

## 📊 Rough Timeline
- **Day 1**: Basic setup + first projectile
- **Day 2-3**: Trajectory system + predictions  
- **Day 4-5**: Threat spawning + types
- **Week 2**: Interception mechanics
- **Week 3-4**: Polish + UI

Remember: Get something visible and working FAST, then iterate!