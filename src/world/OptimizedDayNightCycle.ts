import * as THREE from 'three';

export class OptimizedDayNightCycle {
  private scene: THREE.Scene;
  private ambientLight: THREE.AmbientLight;
  private directionalLight: THREE.DirectionalLight;
  private currentTime: number = 14; // 2 PM
  private timeSpeed: number = 1;
  private lastUpdate: number = 0;
  private updateInterval: number = 5000; // Update every 5 seconds instead of every frame
  private environmentSystem?: any; // Reference to environment system for skybox updates

  // Pre-calculated lighting states for performance
  private lightingStates = {
    dawn: { ambient: 0.25, directional: 0.5, color: 0xffd700 },
    day: { ambient: 0.35, directional: 0.65, color: 0xffffff },  // Reduced from 0.6/0.8 for better contrast
    dusk: { ambient: 0.3, directional: 0.4, color: 0xff6b35 },
    night: { ambient: 0.05, directional: 0.1, color: 0x4a5568 }, // Darker night for better visibility
  };

  constructor(
    scene: THREE.Scene,
    ambientLight: THREE.AmbientLight,
    directionalLight: THREE.DirectionalLight
  ) {
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
    // Time-based lighting with smooth interpolation between states
    const hour = this.currentTime;
    let fromState, toState, factor;

    if (hour >= 6 && hour < 12) {
      // Dawn to Day transition
      fromState = this.lightingStates.dawn;
      toState = this.lightingStates.day;
      factor = (hour - 6) / 6;
    } else if (hour >= 12 && hour < 18) {
      // Day to Dusk transition
      fromState = this.lightingStates.day;
      toState = this.lightingStates.dusk;
      factor = (hour - 12) / 6;
    } else if (hour >= 18 && hour < 22) {
      // Dusk to Night transition
      fromState = this.lightingStates.dusk;
      toState = this.lightingStates.night;
      factor = (hour - 18) / 4;
    } else if (hour >= 22 || hour < 6) {
      // Full night
      fromState = this.lightingStates.night;
      toState = this.lightingStates.night;
      factor = 0;
    } else {
      // Should not reach here
      fromState = this.lightingStates.day;
      toState = this.lightingStates.day;
      factor = 0;
    }

    // Smooth interpolation between states
    this.ambientLight.intensity = THREE.MathUtils.lerp(fromState.ambient, toState.ambient, factor);
    this.directionalLight.intensity = THREE.MathUtils.lerp(fromState.directional, toState.directional, factor);
    
    // Interpolate color
    const fromColor = new THREE.Color(fromState.color);
    const toColor = new THREE.Color(toState.color);
    this.directionalLight.color.lerpColors(fromColor, toColor, factor);
    
    // Update skybox if available
    this.updateSkybox();
  }
  
  private updateSkybox(): void {
    if (!this.environmentSystem || !this.environmentSystem.sky) return;
    
    const hour = this.currentTime;
    const skyUniforms = this.environmentSystem.sky.material.uniforms;
    
    // Calculate sun position based on time
    // Dawn: 6, Noon: 12, Dusk: 18, Midnight: 0/24
    let elevation: number;
    let azimuth: number = 180; // Keep azimuth constant
    
    if (hour >= 6 && hour <= 18) {
      // Daytime: sun rises from east to west
      const dayProgress = (hour - 6) / 12; // 0 at dawn, 1 at dusk
      elevation = Math.sin(dayProgress * Math.PI) * 60 + 10; // Arc from 10° to 70° to 10°
    } else {
      // Nighttime: sun is below horizon
      elevation = -30; // Keep sun well below horizon
    }
    
    // Update sun position
    const phi = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(azimuth);
    const sun = new THREE.Vector3();
    sun.setFromSphericalCoords(1, phi, theta);
    skyUniforms['sunPosition'].value.copy(sun);
    
    // Update sky parameters based on time
    if (hour >= 22 || hour < 6) {
      // Night - very dark sky
      skyUniforms['turbidity'].value = 1;
      skyUniforms['rayleigh'].value = 0.1;
      skyUniforms['mieCoefficient'].value = 0.001;
      skyUniforms['mieDirectionalG'].value = 0.8;
    } else if (hour >= 6 && hour < 8) {
      // Dawn
      skyUniforms['turbidity'].value = 10;
      skyUniforms['rayleigh'].value = 2;
      skyUniforms['mieCoefficient'].value = 0.02;
      skyUniforms['mieDirectionalG'].value = 0.9;
    } else if (hour >= 8 && hour < 16) {
      // Day - but still not too bright
      skyUniforms['turbidity'].value = 30;
      skyUniforms['rayleigh'].value = 0.5;
      skyUniforms['mieCoefficient'].value = 0.03;
      skyUniforms['mieDirectionalG'].value = 0.95;
    } else if (hour >= 16 && hour < 20) {
      // Dusk
      skyUniforms['turbidity'].value = 15;
      skyUniforms['rayleigh'].value = 3;
      skyUniforms['mieCoefficient'].value = 0.025;
      skyUniforms['mieDirectionalG'].value = 0.9;
    } else {
      // Evening transition
      skyUniforms['turbidity'].value = 5;
      skyUniforms['rayleigh'].value = 1;
      skyUniforms['mieCoefficient'].value = 0.005;
      skyUniforms['mieDirectionalG'].value = 0.85;
    }
  }

  setEnvironmentSystem(environmentSystem: any): void {
    this.environmentSystem = environmentSystem;
  }
  
  setTimeSpeed(speed: number): void {
    this.timeSpeed = speed;
  }
  setTime(hour: number): void {
    this.currentTime = hour;
    this.updateLighting();
  }
  getTime(): { hours: number } {
    return { hours: this.currentTime };
  }
  formatTime(): string {
    const hour = Math.floor(this.currentTime);
    const minute = Math.floor((this.currentTime % 1) * 60);
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  }
}
