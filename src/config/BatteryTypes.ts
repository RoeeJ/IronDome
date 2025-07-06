export enum BatteryType {
  IRON_DOME = 'IRON_DOME',
  LASER = 'LASER',
}

export interface BatteryTypeConfig {
  type: BatteryType;
  name: string;
  description: string;
  icon: string;
  cost: number;
  unlockLevel: number;
  capabilities: {
    maxRange: number;
    minRange: number;
    interceptorsPerMinute?: number;
    damagePerSecond?: number;
    energyCapacity?: number;
  };
}

export const BATTERY_CONFIGS: Record<BatteryType, BatteryTypeConfig> = {
  [BatteryType.IRON_DOME]: {
    type: BatteryType.IRON_DOME,
    name: 'Iron Dome',
    description: 'Fires interceptor missiles to destroy incoming threats',
    icon: '🚀',
    cost: 2000,
    unlockLevel: 1,
    capabilities: {
      maxRange: 2500,
      minRange: 4,
      interceptorsPerMinute: 20,
    },
  },
  [BatteryType.LASER]: {
    type: BatteryType.LASER,
    name: 'Laser Cannon',
    description: 'Directed energy weapon that applies continuous damage',
    icon: '⚡',
    cost: 1000,
    unlockLevel: 3,
    capabilities: {
      maxRange: 1000, // Nerfed to 300m - acts as inner defense layer
      minRange: 0,
      damagePerSecond: 20, // 20 DPS = 5 seconds to destroy 100 health threat
      energyCapacity: 100,
    },
  },
};
