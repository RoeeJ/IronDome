// Global type definitions for the Iron Dome project

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CameraController } from '../camera/CameraController';
import { OptimizedDayNightCycle } from '../world/OptimizedDayNightCycle';
import { BuildingSystem } from '../world/BuildingSystem';
import { EnvironmentSystem } from '../world/EnvironmentSystem';
import { ThreatManager } from '../scene/ThreatManager';
import { DomePlacementSystem } from '../game/DomePlacementSystem';
import { InterceptionSystem } from '../scene/InterceptionSystem';
import { InstancedDebrisRenderer } from '../rendering/InstancedDebrisRenderer';
import { ProjectileInstanceManager } from '../rendering/ProjectileInstanceManager';
import { ResourceManager } from '../game/ResourceManager';
import { SoundSystem } from '../systems/SoundSystem';
import GUI from 'lil-gui';

// Extend the Window interface with our custom properties
declare global {
  interface Window {
    // Three.js core
    __camera: THREE.PerspectiveCamera;
    __scene: THREE.Scene;
    __controls: OrbitControls;
    __cameraController: CameraController;
    THREE: typeof THREE;

    // Game systems
    __optimizedDayNight: OptimizedDayNightCycle;
    __buildingSystem: BuildingSystem;
    __environmentSystem: EnvironmentSystem;
    __threatManager: ThreatManager;
    __domePlacementSystem: DomePlacementSystem;
    __interceptionSystem: InterceptionSystem;
    __instancedDebrisRenderer: InstancedDebrisRenderer;
    __projectileInstanceManager: ProjectileInstanceManager;
    __resourceManager: ResourceManager;
    __soundSystem: SoundSystem;
    __gui: GUI;

    // Game controls
    __simulationControls: {
      gameMode: boolean;
      autoIntercept: boolean;
      pause: boolean;
      timeScale: number;
      showTrajectories: boolean;
      enableFog: boolean;
      interceptorModel: string;
      useImprovedAlgorithms: boolean;
      startGame: () => void;
      resetGame: () => void;
    };

    // Manual targeting
    __manualTargeting: {
      selectedThreat: any | null;
      priorityTargets: Set<string>;
      selectThreat: (threat: any) => void;
      togglePriority: (threat: any) => void;
      clearSelection: () => void;
    };

    // Debug features
    __useImprovedAlgorithms?: boolean;
    __debugLaunchPositions?: boolean;
    __debugTubePositions?: boolean;
    __interceptorModelQuality?: string;

    // Functions
    showNotification: (message: string) => void;
    toggleRenderStats: () => void;
    gc?: () => void; // Garbage collection if available
  }

  // HTMLElement extensions for Three.js
  interface HTMLCanvasElement {
    __three_renderer?: THREE.WebGLRenderer;
  }
}

// Event type definitions
export interface GameEvent extends Event {
  detail?: any;
}

// Common callback types
export type AnimationCallback = (deltaTime: number) => void;
export type EventCallback = (event: Event) => void;
export type MouseEventCallback = (event: MouseEvent) => void;
export type KeyboardEventCallback = (event: KeyboardEvent) => void;
export type TouchEventCallback = (event: TouchEvent) => void;

// Instance manager type (since it's used as any in many places)
export interface InstanceManager {
  addInstance(position: THREE.Vector3, velocity?: THREE.Vector3, color?: number): void;
  removeInstance(id: number): void;
  update(deltaTime: number): void;
  clear(): void;
}

// Common configuration types
export interface BatteryStats {
  loadedTubes: number;
  reloadingTubes: number;
  totalTubes: number;
  health: {
    current: number;
    max: number;
    percent: number;
  };
}

export interface ThreatData {
  id: string;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  type: string;
  isActive: boolean;
}

export interface InterceptorData {
  id: string;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  target?: ThreatData;
  isActive: boolean;
}

// Simulation controls type
export interface SimulationControls {
  gameMode: boolean;
  autoIntercept: boolean;
  pause: boolean;
  timeScale: number;
  showTrajectories: boolean;
  enableFog: boolean;
  interceptorModel: string;
  useImprovedAlgorithms: boolean;
  startGame: () => void;
  resetGame: () => void;
}

// Export empty object to make this a module
export {};
