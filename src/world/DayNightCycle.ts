import * as THREE from 'three';
import { EnvironmentSystem } from './EnvironmentSystem';
import { debug } from '../utils/logger';

export interface TimeOfDay {
  hours: number;
  minutes: number;
  seconds: number;
}

export interface LightingConfig {
  ambientIntensity: number;
  ambientColor: THREE.Color;
  directionalIntensity: number;
  directionalColor: THREE.Color;
  shadowIntensity: number;
}

export class DayNightCycle {
  private scene: THREE.Scene;
  private directionalLight: THREE.DirectionalLight;
  private ambientLight: THREE.AmbientLight;
  private environmentSystem: EnvironmentSystem | null = null;

  // Time properties
  private currentTime: number = 12; // Hours in 24h format
  private timeSpeed: number = 1; // How fast time passes (1 = realtime, 60 = 1 hour per minute)
  private isPaused: boolean = false;

  // Moon light (for night time)
  private moonLight: THREE.DirectionalLight;

  // Light presets for different times
  private readonly lightPresets: Map<string, LightingConfig> = new Map([
    [
      'night',
      {
        ambientIntensity: 0.1,
        ambientColor: new THREE.Color(0x1a1a2e),
        directionalIntensity: 0.2,
        directionalColor: new THREE.Color(0x4a5568),
        shadowIntensity: 0.1,
      },
    ],
    [
      'dawn',
      {
        ambientIntensity: 0.3,
        ambientColor: new THREE.Color(0x6b46c1),
        directionalIntensity: 0.4,
        directionalColor: new THREE.Color(0xffa500),
        shadowIntensity: 0.3,
      },
    ],
    [
      'morning',
      {
        ambientIntensity: 0.5,
        ambientColor: new THREE.Color(0x87ceeb),
        directionalIntensity: 0.7,
        directionalColor: new THREE.Color(0xffd700),
        shadowIntensity: 0.5,
      },
    ],
    [
      'noon',
      {
        ambientIntensity: 0.6,
        ambientColor: new THREE.Color(0xffffff),
        directionalIntensity: 0.8,
        directionalColor: new THREE.Color(0xffffff),
        shadowIntensity: 0.7,
      },
    ],
    [
      'afternoon',
      {
        ambientIntensity: 0.5,
        ambientColor: new THREE.Color(0xffd4a3),
        directionalIntensity: 0.7,
        directionalColor: new THREE.Color(0xffeb99),
        shadowIntensity: 0.6,
      },
    ],
    [
      'dusk',
      {
        ambientIntensity: 0.3,
        ambientColor: new THREE.Color(0xff6b6b),
        directionalIntensity: 0.4,
        directionalColor: new THREE.Color(0xff4757),
        shadowIntensity: 0.3,
      },
    ],
  ]);

  constructor(
    scene: THREE.Scene,
    ambientLight: THREE.AmbientLight,
    directionalLight: THREE.DirectionalLight
  ) {
    this.scene = scene;
    this.ambientLight = ambientLight;
    this.directionalLight = directionalLight;

    // Create moon light
    this.moonLight = new THREE.DirectionalLight(0x4a5568, 0);
    this.moonLight.position.set(-50, 100, -50);
    this.moonLight.castShadow = true;
    this.moonLight.shadow.camera.left = -100;
    this.moonLight.shadow.camera.right = 100;
    this.moonLight.shadow.camera.top = 100;
    this.moonLight.shadow.camera.bottom = -100;
    this.moonLight.shadow.mapSize.width = 1024;
    this.moonLight.shadow.mapSize.height = 1024;
    this.scene.add(this.moonLight);
  }

  setEnvironmentSystem(environmentSystem: EnvironmentSystem) {
    this.environmentSystem = environmentSystem;
  }

  update(deltaTime: number) {
    if (this.isPaused) return;

    // Update time
    this.currentTime += (deltaTime * this.timeSpeed) / 3600; // Convert seconds to hours
    if (this.currentTime >= 24) {
      this.currentTime -= 24;
    }

    // Update lighting based on time
    this.updateLighting();

    // Update sun/moon positions
    this.updateCelestialBodies();

    // Update environment if available
    if (this.environmentSystem) {
      this.environmentSystem.setTimeOfDay(this.currentTime);
    }
  }

  private updateLighting() {
    // Determine which presets to interpolate between
    let preset1: LightingConfig;
    let preset2: LightingConfig;
    let factor: number;

    if (this.currentTime < 5 || this.currentTime >= 22) {
      // Night (10 PM - 5 AM)
      preset1 = this.lightPresets.get('night')!;
      preset2 = this.lightPresets.get('night')!;
      factor = 0;
    } else if (this.currentTime < 7) {
      // Dawn (5 AM - 7 AM)
      preset1 = this.lightPresets.get('night')!;
      preset2 = this.lightPresets.get('dawn')!;
      factor = (this.currentTime - 5) / 2;
    } else if (this.currentTime < 9) {
      // Dawn to Morning (7 AM - 9 AM)
      preset1 = this.lightPresets.get('dawn')!;
      preset2 = this.lightPresets.get('morning')!;
      factor = (this.currentTime - 7) / 2;
    } else if (this.currentTime < 11) {
      // Morning to Noon (9 AM - 11 AM)
      preset1 = this.lightPresets.get('morning')!;
      preset2 = this.lightPresets.get('noon')!;
      factor = (this.currentTime - 9) / 2;
    } else if (this.currentTime < 15) {
      // Noon to Afternoon (11 AM - 3 PM)
      preset1 = this.lightPresets.get('noon')!;
      preset2 = this.lightPresets.get('afternoon')!;
      factor = (this.currentTime - 11) / 4;
    } else if (this.currentTime < 18) {
      // Afternoon (3 PM - 6 PM)
      preset1 = this.lightPresets.get('afternoon')!;
      preset2 = this.lightPresets.get('afternoon')!;
      factor = 0;
    } else if (this.currentTime < 20) {
      // Dusk (6 PM - 8 PM)
      preset1 = this.lightPresets.get('afternoon')!;
      preset2 = this.lightPresets.get('dusk')!;
      factor = (this.currentTime - 18) / 2;
    } else {
      // Dusk to Night (8 PM - 10 PM)
      preset1 = this.lightPresets.get('dusk')!;
      preset2 = this.lightPresets.get('night')!;
      factor = (this.currentTime - 20) / 2;
    }

    // Interpolate between presets
    this.ambientLight.intensity = THREE.MathUtils.lerp(
      preset1.ambientIntensity,
      preset2.ambientIntensity,
      factor
    );
    this.ambientLight.color.lerpColors(preset1.ambientColor, preset2.ambientColor, factor);

    this.directionalLight.intensity = THREE.MathUtils.lerp(
      preset1.directionalIntensity,
      preset2.directionalIntensity,
      factor
    );
    this.directionalLight.color.lerpColors(
      preset1.directionalColor,
      preset2.directionalColor,
      factor
    );

    // Update shadow intensity
    this.directionalLight.shadow.intensity = THREE.MathUtils.lerp(
      preset1.shadowIntensity,
      preset2.shadowIntensity,
      factor
    );

    // Update moon light (opposite of sun)
    const isNight = this.currentTime < 6 || this.currentTime > 18;
    this.moonLight.intensity = isNight ? 0.3 : 0;
  }

  private updateCelestialBodies() {
    // Update sun position
    const sunAngle = (this.currentTime / 24) * Math.PI * 2 - Math.PI / 2;
    const sunHeight = Math.sin(((this.currentTime - 6) / 12) * Math.PI);

    this.directionalLight.position.set(
      Math.cos(sunAngle) * 100,
      Math.max(10, sunHeight * 100),
      Math.sin(sunAngle) * 100
    );

    // Make sun look at center
    this.directionalLight.target.position.set(0, 0, 0);

    // Update moon position (opposite of sun)
    const moonAngle = sunAngle + Math.PI;
    this.moonLight.position.set(
      Math.cos(moonAngle) * 100,
      Math.max(10, -sunHeight * 100),
      Math.sin(moonAngle) * 100
    );
    this.moonLight.target.position.set(0, 0, 0);
  }

  setTime(hours: number, minutes: number = 0, seconds: number = 0) {
    this.currentTime = hours + minutes / 60 + seconds / 3600;
    this.updateLighting();
    this.updateCelestialBodies();

    if (this.environmentSystem) {
      this.environmentSystem.setTimeOfDay(this.currentTime);
    }

    debug.log(`Time set to ${this.formatTime()}`);
  }

  getTime(): TimeOfDay {
    const hours = Math.floor(this.currentTime);
    const fractionalHours = this.currentTime - hours;
    const minutes = Math.floor(fractionalHours * 60);
    const seconds = Math.floor((fractionalHours * 60 - minutes) * 60);

    return { hours, minutes, seconds };
  }

  formatTime(): string {
    const time = this.getTime();
    const period = time.hours >= 12 ? 'PM' : 'AM';
    const displayHours = time.hours === 0 ? 12 : time.hours > 12 ? time.hours - 12 : time.hours;

    return `${displayHours.toString().padStart(2, '0')}:${time.minutes.toString().padStart(2, '0')} ${period}`;
  }

  setTimeSpeed(speed: number) {
    this.timeSpeed = THREE.MathUtils.clamp(speed, 0, 3600); // Max 1 hour per second
  }

  pause() {
    this.isPaused = true;
  }

  resume() {
    this.isPaused = false;
  }

  togglePause() {
    this.isPaused = !this.isPaused;
  }

  isPausedState(): boolean {
    return this.isPaused;
  }

  // Preset time setters
  setDawn() {
    this.setTime(6, 0, 0);
  }

  setNoon() {
    this.setTime(12, 0, 0);
  }

  setDusk() {
    this.setTime(18, 30, 0);
  }

  setMidnight() {
    this.setTime(0, 0, 0);
  }
}
