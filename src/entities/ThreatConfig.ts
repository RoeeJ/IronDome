export enum ThreatType {
  // Rockets
  SHORT_RANGE = 'SHORT_RANGE',
  MEDIUM_RANGE = 'MEDIUM_RANGE',
  LONG_RANGE = 'LONG_RANGE',

  // New threat types
  MORTAR = 'MORTAR',
  DRONE_SLOW = 'DRONE_SLOW',
  DRONE_FAST = 'DRONE_FAST',
  CRUISE_MISSILE = 'CRUISE_MISSILE',

  // Specific rocket variants
  QASSAM_1 = 'QASSAM_1',
  QASSAM_2 = 'QASSAM_2',
  QASSAM_3 = 'QASSAM_3',
  GRAD_ROCKET = 'GRAD_ROCKET',
  BALLISTIC_MISSILE = 'BALLISTIC_MISSILE',
  DECOY = 'DECOY',
  RE_ENTRY_VEHICLE = 'RE_ENTRY_VEHICLE',
}

export interface ThreatConfig {
  velocity: number; // m/s
  maxRange: number; // meters
  maxAltitude: number; // meters
  warheadSize: number; // kg
  color: number;
  radius: number;
  // New properties for advanced threats
  maneuverability?: number; // 0-1, ability to change course
  cruiseAltitude?: number; // For cruise missiles and drones
  isDrone?: boolean; // Different physics for drones
  isMortar?: boolean; // High arc trajectory
  rcs?: number; // Radar cross section (affects detection)
  signature?: {
    // For decoys vs real threats
    radar: number; // 1.0 for real, < 1.0 for decoys
    thermal: number;
    electronic: number;
  };
  flightStages?: {
    boost: { duration: number; thrust: number };
    terminal: { speed: number };
  };
  payload?: { type: ThreatType; count: number; spread: number };
  hasTerminalGuidance?: boolean;
}

export const THREAT_CONFIGS: Record<ThreatType, ThreatConfig> = {
  [ThreatType.SHORT_RANGE]: {
    velocity: 300,
    maxRange: 10000,
    maxAltitude: 3000,
    warheadSize: 10,
    color: 0xff0000,
    radius: 0.4,
  },
  [ThreatType.MEDIUM_RANGE]: {
    velocity: 600,
    maxRange: 40000,
    maxAltitude: 10000,
    warheadSize: 50,
    color: 0xff6600,
    radius: 0.6,
    signature: { radar: 1.0, thermal: 1.0, electronic: 1.0 },
  },
  [ThreatType.LONG_RANGE]: {
    velocity: 1000,
    maxRange: 70000,
    maxAltitude: 20000,
    warheadSize: 100,
    color: 0xff0066,
    radius: 0.8,
  },

  // Mortars - high arc, short range
  [ThreatType.MORTAR]: {
    velocity: 200,
    maxRange: 5000,
    maxAltitude: 1500,
    warheadSize: 5,
    color: 0x8b4513, // Brown
    radius: 0.3,
    isMortar: true,
    rcs: 0.1,
  },

  // Drones - slow, maneuverable, low altitude
  [ThreatType.DRONE_SLOW]: {
    velocity: 30, // ~110 km/h
    maxRange: 50000,
    maxAltitude: 500,
    warheadSize: 5,
    color: 0x00ff00, // Green
    radius: 0.8,
    isDrone: true,
    maneuverability: 0.8,
    cruiseAltitude: 100,
    rcs: 0.3,
  },

  [ThreatType.DRONE_FAST]: {
    velocity: 50, // ~180 km/h
    maxRange: 100000,
    maxAltitude: 1000,
    warheadSize: 20,
    color: 0x00ff66, // Light green
    radius: 1.0,
    isDrone: true,
    maneuverability: 0.6,
    cruiseAltitude: 200,
    rcs: 0.5,
  },

  // Cruise missile - fast, terrain following
  [ThreatType.CRUISE_MISSILE]: {
    velocity: 250, // ~900 km/h
    maxRange: 300000,
    maxAltitude: 100,
    warheadSize: 500,
    color: 0x0066ff, // Blue
    radius: 1.2,
    maneuverability: 0.3,
    cruiseAltitude: 50,
    rcs: 0.8,
  },

  // Specific rocket variants
  [ThreatType.QASSAM_1]: {
    velocity: 200,
    maxRange: 5000,
    maxAltitude: 2000,
    warheadSize: 5,
    color: 0xff3333,
    radius: 0.3,
    rcs: 0.4,
  },

  [ThreatType.QASSAM_2]: {
    velocity: 280,
    maxRange: 10000,
    maxAltitude: 3500,
    warheadSize: 10,
    color: 0xff4444,
    radius: 0.4,
    rcs: 0.5,
  },

  [ThreatType.QASSAM_3]: {
    velocity: 350,
    maxRange: 15000,
    maxAltitude: 5000,
    warheadSize: 20,
    color: 0xff5555,
    radius: 0.5,
    rcs: 0.6,
  },

  [ThreatType.GRAD_ROCKET]: {
    velocity: 450,
    maxRange: 20000,
    maxAltitude: 7000,
    warheadSize: 20,
    color: 0xff8800,
    radius: 0.5,
    rcs: 0.7,
  },

  [ThreatType.BALLISTIC_MISSILE]: {
    velocity: 800, // Max velocity cap, not a fixed launch speed.
    maxRange: 500000,
    maxAltitude: 40000, // High altitude for ballistic arc
    warheadSize: 1000,
    color: 0xcc00ff, // Purple
    radius: 2.0,
    rcs: 2.0,
    payload: { type: ThreatType.RE_ENTRY_VEHICLE, count: 4, spread: 500 },
  },

  [ThreatType.DECOY]: {
    velocity: 600, // Same as medium range to be convincing
    maxRange: 40000,
    maxAltitude: 10000,
    warheadSize: 0, // No damage
    color: 0xaaaaaa, // Grey color
    radius: 0.6, // Same size as medium range
    rcs: 1.0, // Same radar cross-section
    signature: {
      radar: 1.0, // Looks real on radar
      thermal: 0.1, // Low thermal signature
      electronic: 0.1, // Low electronic signature
    },
  },

  [ThreatType.RE_ENTRY_VEHICLE]: {
    velocity: 1500, // High speed, but inherited from parent on spawn. This is a fallback value.
    maxRange: 80000, // Inherited from parent, not used for launch
    maxAltitude: 80000, // Inherited from parent
    warheadSize: 150, // Smaller, tactical warhead
    color: 0xff4500, // Bright orange/red for re-entry heat
    radius: 0.5,
    rcs: 0.3, // Smaller radar cross-section
    hasTerminalGuidance: true, // This vehicle guides itself
    signature: { radar: 1.0, thermal: 5.0, electronic: 0.5 }, // High thermal signature
    // No flight stages or payload, it's a terminal threat
  },
};
