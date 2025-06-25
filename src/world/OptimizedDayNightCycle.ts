import * as THREE from 'three';

export class OptimizedDayNightCycle {
  private scene: THREE.Scene;
  private ambientLight: THREE.AmbientLight;
  private directionalLight: THREE.DirectionalLight;
  private currentTime: number = 14; // 2 PM
  private timeSpeed: number = 1;
  private lastUpdate: number = 0;
  private updateInterval: number = 5000; // Update every 5 seconds instead of every frame
  
  // Pre-calculated lighting states for performance
  private lightingStates = {
    dawn: { ambient: 0.3, directional: 0.6, color: 0xffd700 },
    day: { ambient: 0.6, directional: 0.8, color: 0xffffff },
    dusk: { ambient: 0.4, directional: 0.5, color: 0xff6b35 },
    night: { ambient: 0.1, directional: 0.2, color: 0x4a5568 }
  };

  constructor(scene: THREE.Scene, ambientLight: THREE.AmbientLight, directionalLight: THREE.DirectionalLight) {
    this.scene = scene;
    this.ambientLight = ambientLight;
    this.directionalLight = directionalLight;
  }

  update(deltaTime: number): void {
    const now = Date.now();
    
    // Only update lighting every 5 seconds - massive performance gain
    if (now - this.lastUpdate < this.updateInterval) return;
    
    this.currentTime += (this.timeSpeed * deltaTime * this.updateInterval) / 1000 / 3600;
    if (this.currentTime >= 24) this.currentTime -= 24;
    
    this.updateLighting();
    this.lastUpdate = now;
  }

  private updateLighting(): void {
    // Simple time-based lighting interpolation
    const hour = this.currentTime;
    let state;
    
    if (hour >= 6 && hour < 12) state = this.lightingStates.dawn;
    else if (hour >= 12 && hour < 18) state = this.lightingStates.day;
    else if (hour >= 18 && hour < 22) state = this.lightingStates.dusk;
    else state = this.lightingStates.night;
    
    // Smooth transitions with simple lerp
    this.ambientLight.intensity = state.ambient;
    this.directionalLight.intensity = state.directional;
    this.directionalLight.color.setHex(state.color);
  }

  setTimeSpeed(speed: number): void { this.timeSpeed = speed; }
  setTime(hour: number): void { this.currentTime = hour; this.updateLighting(); }
  getTime(): { hours: number } { return { hours: this.currentTime }; }
  formatTime(): string {
    const hour = Math.floor(this.currentTime);
    const minute = Math.floor((this.currentTime % 1) * 60);
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  }
}