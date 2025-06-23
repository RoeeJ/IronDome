# Shop & Progression System Improvements

## User Feedback Analysis

### 1. **Score Display Visibility** (High Priority)
**Issue**: Score display in top-left is too small and lacks contrast
**Solution**: 
- Increase font size from current size
- Add background panel with semi-transparent dark background
- Use high-contrast colors (white text on dark background)
- Consider adding text shadow for better readability

### 2. **Auto-Repair Feature** (Medium Priority)
**Issue**: Players must manually repair batteries during intense combat
**Solution Options**:
- Add auto-repair upgrade in shop (costs credits, repairs batteries automatically)
- Different tiers: slow/medium/fast repair rates
- Could be global or per-battery upgrade
- Visual indicator when auto-repair is active

### 3. **Pause Functionality** (High Priority)
**Issue**: No way to pause during intense gameplay
**Solution**:
- Add pause button (ESC key or UI button)
- Pause menu overlay with options (Resume, Settings, Quit)
- Ensure all physics, animations, and timers are properly paused
- Consider what happens when shop is open (auto-pause?)

### 4. **Time Dilation During Shop** (Medium Priority)
**Issue**: Game continues at full speed while shopping, making it stressful
**Solution**:
- Slow down time to 10-20% when shop is open
- Keep some movement for visual feedback
- Ensure UI remains responsive at normal speed
- Add visual effect (blur, desaturation) to indicate slowed time

### 5. **Shop UI/UX Improvements** (High Priority)
**Issue**: Shop modal is intrusive, doesn't close on outside click
**Solution Options**:
A. Quick Fix: Add click-outside-to-close functionality
B. Better: Redesign as bottom panel that slides up
   - Always visible tab/button at bottom
   - Slides up when clicked
   - Game visible above it
   - Can be minimized quickly

### 6. **Random Battery Placement Collision** (High Priority)
**Issue**: "Add Random Battery" doesn't check if space is occupied
**Solution**:
- Implement collision detection for battery placement
- Check against existing batteries, buildings, obstacles
- Try multiple random positions if first fails
- Show error message if no valid position found
- Visual preview before placement

## Implementation Priority Order

1. **Fix Random Battery Collision** - Critical bug fix
2. **Improve Score Display** - Quick win for readability
3. **Add Pause Function** - Essential QoL feature
4. **Shop Click-Outside** - Quick UX improvement
5. **Time Dilation** - Enhances shop experience
6. **Auto-Repair** - New gameplay feature
7. **Shop Redesign** - Larger UI overhaul

## Technical Considerations

### For Pause System:
- Need to track all active timers/intervals
- Pause physics world updates
- Pause all animations and effects
- Maintain UI responsiveness

### For Time Dilation:
- Modify delta time for game updates
- Keep UI updates at normal speed
- Ensure smooth transition in/out

### For Shop Redesign:
- Consider mobile-first design
- Smooth animations for panel sliding
- Keyboard shortcuts for quick access
- Preserve current shop functionality

### For Auto-Repair:
- New upgrade type in progression system
- Visual feedback (health bar animation)
- Balance repair rate vs cost
- Consider cooldown or energy system

## Next Steps
1. Start with critical bug fixes
2. Implement quick wins for immediate improvement
3. Design mockups for larger UI changes
4. Test each feature thoroughly
5. Get user feedback on changes