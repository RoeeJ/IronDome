import * as THREE from 'three';
import { Threat } from './Threat';

export interface IBattery {
  getPosition(): THREE.Vector3;
  update(deltaTime: number, threats: Threat[]): void;
  destroy(): void;
  setResourceManagement(enabled: boolean): void;
  setRadarNetwork(radarNetwork: any): void;
  isOperational(): boolean;
  fireAt(threat: Threat): void;
  stopFiring(): void;
  resetInterceptorStock?(): void;
  getConfig?(): { maxRange: number };
  setVisualVisibility?(visible: boolean): void;
  getHealth?(): { current: number; max: number };
  repair?(amount: number): void;
  setAutoRepairRate?(rate: number): void;
  getGroup?(): THREE.Group;
}
