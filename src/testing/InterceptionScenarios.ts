/**
 * Predefined realistic interception scenarios for testing
 */

import * as THREE from 'three';

export interface ThreatScenario {
  name: string;
  threat: {
    initialPosition: THREE.Vector3;
    velocity: THREE.Vector3;
    mass: number;
    radius: number;
    type: 'ballistic' | 'drone' | 'mortar' | 'cruise';
  };
  interceptor: {
    initialPosition: THREE.Vector3;
    launchVelocity: THREE.Vector3;
    mass: number;
    radius: number;
    guidance: {
      maxAcceleration: number;
      proportionalGain: number;
      maxTurnRate: number;
    };
  };
  proximityFuseSettings?: {
    armingDistance: number;
    detonationRadius: number;
    optimalRadius: number;
    scanRate: number;
  };
  duration: number;
  description: string;
}

/**
 * Create a realistic scenario based on threat type and engagement geometry
 */
export function createRealisticScenario(
  threatType: 'ballistic' | 'drone' | 'mortar' | 'cruise',
  engagementType: 'head-on' | 'crossing' | 'tail-chase' | 'high-angle'
): ThreatScenario {
  const scenarios: Record<string, ThreatScenario> = {
    'ballistic-head-on': {
      name: 'Ballistic Head-on',
      threat: {
        initialPosition: new THREE.Vector3(1000, 500, 0),
        velocity: new THREE.Vector3(-150, -60, 0), // ~162 m/s total
        mass: 100,
        radius: 0.5,
        type: 'ballistic',
      },
      interceptor: {
        initialPosition: new THREE.Vector3(0, 50, 0),
        launchVelocity: new THREE.Vector3(100, 120, 0), // ~156 m/s
        mass: 20,
        radius: 0.3,
        guidance: {
          maxAcceleration: 40 * 9.81, // 40G
          proportionalGain: 3,
          maxTurnRate: 20, // rad/s
        },
      },
      duration: 5,
      description: 'Classic ballistic missile interception scenario',
    },

    'ballistic-crossing': {
      name: 'Ballistic Crossing',
      threat: {
        initialPosition: new THREE.Vector3(800, 600, -500),
        velocity: new THREE.Vector3(-120, -80, 100), // Diagonal approach
        mass: 100,
        radius: 0.5,
        type: 'ballistic',
      },
      interceptor: {
        initialPosition: new THREE.Vector3(0, 50, 0),
        launchVelocity: new THREE.Vector3(80, 140, -60),
        mass: 20,
        radius: 0.3,
        guidance: {
          maxAcceleration: 40 * 9.81,
          proportionalGain: 3,
          maxTurnRate: 20,
        },
      },
      duration: 6,
      description: 'Crossing engagement with lateral motion',
    },

    'drone-head-on': {
      name: 'Drone Head-on',
      threat: {
        initialPosition: new THREE.Vector3(600, 200, 0),
        velocity: new THREE.Vector3(-30, -5, 0), // Slow, slight descent
        mass: 25,
        radius: 0.8,
        type: 'drone',
      },
      interceptor: {
        initialPosition: new THREE.Vector3(0, 50, 0),
        launchVelocity: new THREE.Vector3(60, 100, 0),
        mass: 20,
        radius: 0.3,
        guidance: {
          maxAcceleration: 30 * 9.81, // Less agile for slow target
          proportionalGain: 2.5,
          maxTurnRate: 15,
        },
      },
      duration: 8,
      description: 'Slow-moving drone interception',
    },

    'mortar-high-angle': {
      name: 'Mortar High Angle',
      threat: {
        initialPosition: new THREE.Vector3(300, 400, 0),
        velocity: new THREE.Vector3(-50, -80, 0), // Steep descent
        mass: 30,
        radius: 0.3,
        type: 'mortar',
      },
      interceptor: {
        initialPosition: new THREE.Vector3(0, 50, 0),
        launchVelocity: new THREE.Vector3(40, 150, 0), // Very vertical
        mass: 20,
        radius: 0.3,
        guidance: {
          maxAcceleration: 50 * 9.81, // High G for tight intercept
          proportionalGain: 4,
          maxTurnRate: 25,
        },
      },
      duration: 4,
      description: 'High-angle mortar round interception',
    },

    'cruise-crossing': {
      name: 'Cruise Missile Crossing',
      threat: {
        initialPosition: new THREE.Vector3(1200, 300, -600),
        velocity: new THREE.Vector3(-200, 0, 120), // Fast, level flight
        mass: 150,
        radius: 0.6,
        type: 'cruise',
      },
      interceptor: {
        initialPosition: new THREE.Vector3(0, 50, 0),
        launchVelocity: new THREE.Vector3(120, 100, -80),
        mass: 20,
        radius: 0.3,
        guidance: {
          maxAcceleration: 45 * 9.81,
          proportionalGain: 3.5,
          maxTurnRate: 22,
        },
      },
      duration: 5,
      description: 'Fast crossing cruise missile',
    },

    'ballistic-tail-chase': {
      name: 'Ballistic Tail Chase',
      threat: {
        initialPosition: new THREE.Vector3(200, 800, 0),
        velocity: new THREE.Vector3(-100, -150, 0), // Steep descent
        mass: 100,
        radius: 0.5,
        type: 'ballistic',
      },
      interceptor: {
        initialPosition: new THREE.Vector3(0, 50, 0),
        launchVelocity: new THREE.Vector3(50, 180, 0), // Chase from below
        mass: 20,
        radius: 0.3,
        guidance: {
          maxAcceleration: 35 * 9.81,
          proportionalGain: 2.8,
          maxTurnRate: 18,
        },
      },
      duration: 6,
      description: 'Tail-chase engagement from below',
    },
  };

  const key = `${threatType}-${engagementType}`;
  const scenario = scenarios[key];

  if (!scenario) {
    // Return a default scenario if not found
    return scenarios['ballistic-head-on'];
  }

  return scenario;
}

/**
 * Create multiple threat scenarios for salvo testing
 */
export function createMultipleThreatScenarios(
  count: number,
  spreadRadius: number = 200
): ThreatScenario[] {
  const scenarios: ThreatScenario[] = [];
  const threatTypes: Array<'ballistic' | 'drone' | 'mortar' | 'cruise'> = [
    'ballistic',
    'ballistic',
    'mortar',
    'drone',
  ]; // Weighted distribution

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const distance = 800 + Math.random() * 400;
    const height = 400 + Math.random() * 200;
    const spread = Math.random() * spreadRadius;

    const threatType = threatTypes[Math.floor(Math.random() * threatTypes.length)];

    // Base velocities by type
    const velocities = {
      ballistic: new THREE.Vector3(-150, -60, 0),
      drone: new THREE.Vector3(-30, -5, 0),
      mortar: new THREE.Vector3(-50, -80, 0),
      cruise: new THREE.Vector3(-200, 0, 0),
    };

    const baseVelocity = velocities[threatType];

    scenarios.push({
      name: `Threat ${i + 1} (${threatType})`,
      threat: {
        initialPosition: new THREE.Vector3(
          distance * Math.cos(angle) + spread * (Math.random() - 0.5),
          height,
          distance * Math.sin(angle) + spread * (Math.random() - 0.5)
        ),
        velocity: baseVelocity.clone().multiplyScalar(0.8 + Math.random() * 0.4),
        mass: threatType === 'cruise' ? 150 : threatType === 'ballistic' ? 100 : 30,
        radius: threatType === 'drone' ? 0.8 : 0.5,
        type: threatType,
      },
      interceptor: {
        initialPosition: new THREE.Vector3(0, 50, 0),
        launchVelocity: new THREE.Vector3(100, 120, 0), // Will be calculated per threat
        mass: 20,
        radius: 0.3,
        guidance: {
          maxAcceleration: 40 * 9.81,
          proportionalGain: 3,
          maxTurnRate: 20,
        },
      },
      duration: 8,
      description: `Salvo threat ${i + 1}`,
    });
  }

  return scenarios;
}

/**
 * Create edge case scenarios for testing robustness
 */
export function createEdgeCaseScenarios(): ThreatScenario[] {
  return [
    {
      name: 'Very Close Range',
      threat: {
        initialPosition: new THREE.Vector3(200, 150, 0),
        velocity: new THREE.Vector3(-100, -50, 0),
        mass: 50,
        radius: 0.5,
        type: 'ballistic',
      },
      interceptor: {
        initialPosition: new THREE.Vector3(0, 50, 0),
        launchVelocity: new THREE.Vector3(80, 100, 0),
        mass: 20,
        radius: 0.3,
        guidance: {
          maxAcceleration: 50 * 9.81,
          proportionalGain: 4,
          maxTurnRate: 30,
        },
      },
      duration: 3,
      description: 'Very close range engagement',
    },

    {
      name: 'Extreme Long Range',
      threat: {
        initialPosition: new THREE.Vector3(2000, 800, 0),
        velocity: new THREE.Vector3(-180, -40, 0),
        mass: 120,
        radius: 0.6,
        type: 'ballistic',
      },
      interceptor: {
        initialPosition: new THREE.Vector3(0, 50, 0),
        launchVelocity: new THREE.Vector3(140, 100, 0),
        mass: 20,
        radius: 0.3,
        guidance: {
          maxAcceleration: 35 * 9.81,
          proportionalGain: 2.5,
          maxTurnRate: 15,
        },
      },
      duration: 10,
      description: 'Extreme long range shot',
    },

    {
      name: 'Evasive Maneuver',
      threat: {
        initialPosition: new THREE.Vector3(800, 400, 0),
        velocity: new THREE.Vector3(-120, -30, 0),
        mass: 80,
        radius: 0.5,
        type: 'cruise',
      },
      interceptor: {
        initialPosition: new THREE.Vector3(0, 50, 0),
        launchVelocity: new THREE.Vector3(100, 110, 0),
        mass: 20,
        radius: 0.3,
        guidance: {
          maxAcceleration: 45 * 9.81,
          proportionalGain: 3.5,
          maxTurnRate: 25,
        },
      },
      duration: 6,
      description: 'Target with evasive capability',
    },
  ];
}
