import * as THREE from 'three';
import type { EventEmitter } from 'events';
import type { StaticRadarNetwork } from '@/scene/StaticRadarNetwork';
import type { InvisibleRadarSystem } from '@/scene/InvisibleRadarSystem';
import { Threat } from './Threat';

export interface IBattery extends Pick<EventEmitter, 'on' | 'off'> {
  canIntercept(threat: Threat): boolean;
  getPosition(): THREE.Vector3;
  update(deltaTime: number, threats: Threat[]): void;
  destroy(): void;
  setResourceManagement(enabled: boolean): void;
  setRadarNetwork(radarNetwork: StaticRadarNetwork | InvisibleRadarSystem): void;
  isOperational(): boolean;
  fireAt?(threat: Threat): void;
  stopFiring?(): void;
  resetInterceptorStock?(): void;
  getConfig(): {
    maxRange: number;
    minRange?: number;
    interceptorLimit?: number;
    launcherCount?: number;
    interceptorSpeed?: number;
    damagePerSecond?: number;
  };
  takeDamage(amount: number): void;
  setVisualVisibility?(visible: boolean): void;
  getHealth(): { current: number; max: number };
  repair(amount: number): void;
  setAutoRepairRate(rate: number): void;
  getGroup(): THREE.Group;
}
