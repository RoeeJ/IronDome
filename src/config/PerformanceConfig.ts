// Performance optimization configuration
export interface PerformanceConfig {
  particles: {
    enableLOD: boolean;
    maxParticlesPerSystem: number;
    maxActiveSystems: number;
    lodDistances: {
      near: number; // Full quality
      medium: number; // Reduced quality
      far: number; // No particles
    };
  };
  rendering: {
    maxDrawCalls: number;
    enableFrustumCulling: boolean;
    shadowMapSize: number;
    antialias: boolean;
  };
  effects: {
    enableSmokeTrails: boolean;
    enableGroundEffects: boolean;
    enableDebris: boolean;
    effectPoolSize: number;
  };
}

export const performanceConfig: PerformanceConfig = {
  particles: {
    enableLOD: true,
    maxParticlesPerSystem: 100,
    maxActiveSystems: 20,
    lodDistances: {
      near: 50,
      medium: 100,
      far: 200,
    },
  },
  rendering: {
    maxDrawCalls: 150,
    enableFrustumCulling: true,
    shadowMapSize: 1024, // Reduced from 2048
    antialias: true,
  },
  effects: {
    enableSmokeTrails: true,
    enableGroundEffects: true,
    enableDebris: true,
    effectPoolSize: 50,
  },
};

// Dynamic quality settings based on performance
export function getQualitySettings(fps: number): Partial<PerformanceConfig> {
  if (fps < 30) {
    // Low quality for poor performance
    return {
      particles: {
        enableLOD: true,
        maxParticlesPerSystem: 50,
        maxActiveSystems: 10,
        lodDistances: {
          near: 30,
          medium: 60,
          far: 100,
        },
      },
      effects: {
        enableSmokeTrails: false,
        enableGroundEffects: false,
        enableDebris: false,
        effectPoolSize: 20,
      },
    };
  } else if (fps < 45) {
    // Medium quality
    return {
      particles: {
        enableLOD: true,
        maxParticlesPerSystem: 75,
        maxActiveSystems: 15,
        lodDistances: {
          near: 40,
          medium: 80,
          far: 150,
        },
      },
      effects: {
        enableSmokeTrails: true,
        enableGroundEffects: false,
        enableDebris: true,
        effectPoolSize: 30,
      },
    };
  }

  // High quality (default)
  return performanceConfig;
}
