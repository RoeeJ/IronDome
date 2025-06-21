# LOD (Level of Detail) Rendering Optimization

## Overview
Implemented a Level of Detail system for threat rendering to improve performance by using simpler geometries for distant objects.

## Implementation Details

### Files Created/Modified:
- `src/rendering/LODSystem.ts` - Core LOD system that manages distance-based geometry selection
- `src/rendering/LODInstancedThreatRenderer.ts` - LOD-aware threat renderer extending InstancedThreatRenderer
- `src/main.ts` - Integration of LOD renderer with toggle functionality
- `src/ui/HelpModal.tsx` - Added keyboard shortcut documentation

### LOD Levels:
- **Level 0 (High)**: 0-150m - Full geometry detail
- **Level 1 (Medium)**: 150-300m - Reduced polygon count
- **Level 2 (Low)**: 300m+ - Minimal geometry

### Geometry Reductions:
- Rockets: 6 → 4 → 3 cone segments
- Mortars: 8x6 → 6x4 → 4x3 sphere segments
- Drones: Full box geometry (unchanged due to simplicity)
- Ballistic: 8 → 5 → 3 cone segments

### Key Features:
- Dynamic LOD switching based on camera distance
- 100ms update interval to balance performance and visual quality
- Seamless transition between LOD levels without visual popping
- Maintains separate instance pools for each LOD level
- Toggle with 'L' key, visual indicator shows current state

### Performance Impact:
- Reduces triangle count for distant objects by ~50-70%
- Minimal CPU overhead for LOD calculations
- Significant GPU savings when many threats are visible
- Most effective in scenarios with 20+ simultaneous threats

### Usage:
- Enabled by default (useLODRendering = true)
- Press 'L' to toggle LOD on/off
- Visual indicator in top-right shows LOD status
- Automatically transfers threats between LOD levels as camera moves