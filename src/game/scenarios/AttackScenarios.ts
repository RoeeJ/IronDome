/**
 * Attack Scenarios System
 * Provides player-friendly abstractions for threat spawning patterns
 */

export enum AttackIntensity {
  LIGHT = 'light',
  MODERATE = 'moderate',
  HEAVY = 'heavy',
  EXTREME = 'extreme'
}

export enum AttackPattern {
  FOCUSED = 'focused',     // All threats target a single point
  SPREAD = 'spread',       // Random distribution across map
  WAVES = 'waves',         // Alternating heavy/light waves
  SURROUND = 'surround',   // Attacks from all directions
  SEQUENTIAL = 'sequential' // Target batteries one by one
}

export interface AttackParameters {
  intensity: AttackIntensity;
  pattern: AttackPattern;
  duration?: number; // seconds, undefined = continuous
  threatMix?: 'rockets' | 'mortars' | 'mixed' | 'advanced';
}

export interface ScenarioPreset {
  id: string;
  name: string;
  description: string;
  icon?: string;
  parameters: AttackParameters;
}

/**
 * Predefined scenario presets for quick access
 */
export const SCENARIO_PRESETS: Record<string, ScenarioPreset> = {
  SURPRISE_ATTACK: {
    id: 'surprise_attack',
    name: 'Surprise Attack',
    description: 'Sudden focused barrage on defenses',
    icon: '⚡',
    parameters: {
      intensity: AttackIntensity.HEAVY,
      pattern: AttackPattern.FOCUSED,
      duration: 30,
      threatMix: 'rockets'
    }
  },
  
  SUSTAINED_BARRAGE: {
    id: 'sustained_barrage',
    name: 'Sustained Barrage',
    description: 'Continuous moderate attacks in waves',
    icon: '🌊',
    parameters: {
      intensity: AttackIntensity.MODERATE,
      pattern: AttackPattern.WAVES,
      duration: 120,
      threatMix: 'mixed'
    }
  },
  
  SURROUNDED: {
    id: 'surrounded',
    name: 'Surrounded',
    description: 'Attacks from all directions',
    icon: '🎯',
    parameters: {
      intensity: AttackIntensity.MODERATE,
      pattern: AttackPattern.SURROUND,
      threatMix: 'mixed'
    }
  },
  
  PROBE_DEFENSES: {
    id: 'probe_defenses',
    name: 'Probe Defenses',
    description: 'Light attacks to test response',
    icon: '🔍',
    parameters: {
      intensity: AttackIntensity.LIGHT,
      pattern: AttackPattern.SPREAD,
      duration: 45,
      threatMix: 'rockets'
    }
  },
  
  ALL_OUT_ASSAULT: {
    id: 'all_out_assault',
    name: 'All Out Assault',
    description: 'Maximum intensity from everywhere',
    icon: '💥',
    parameters: {
      intensity: AttackIntensity.EXTREME,
      pattern: AttackPattern.SURROUND,
      duration: 60,
      threatMix: 'advanced'
    }
  }
};

/**
 * Converts player-friendly parameters to threat spawning configuration
 */
export class AttackParameterConverter {
  /**
   * Get spawn interval range based on intensity
   */
  static getSpawnIntervals(intensity: AttackIntensity): { min: number; max: number } {
    switch (intensity) {
      case AttackIntensity.LIGHT:
        return { min: 5000, max: 10000 }; // 5-10 seconds
      case AttackIntensity.MODERATE:
        return { min: 3000, max: 5000 };  // 3-5 seconds
      case AttackIntensity.HEAVY:
        return { min: 1500, max: 3000 };  // 1.5-3 seconds
      case AttackIntensity.EXTREME:
        return { min: 500, max: 1500 };   // 0.5-1.5 seconds
    }
  }
  
  /**
   * Get salvo configuration based on intensity
   */
  static getSalvoConfig(intensity: AttackIntensity): { chance: number; minSize: number; maxSize: number } {
    switch (intensity) {
      case AttackIntensity.LIGHT:
        return { chance: 0.1, minSize: 2, maxSize: 3 };
      case AttackIntensity.MODERATE:
        return { chance: 0.3, minSize: 3, maxSize: 5 };
      case AttackIntensity.HEAVY:
        return { chance: 0.5, minSize: 5, maxSize: 8 };
      case AttackIntensity.EXTREME:
        return { chance: 0.7, minSize: 8, maxSize: 15 };
    }
  }
  
  /**
   * Get spawn radius configuration based on pattern
   */
  static getSpawnRadiusConfig(pattern: AttackPattern): { 
    useFixedAngle: boolean; 
    angleRange?: { min: number; max: number };
    radiusMultiplier: number;
  } {
    switch (pattern) {
      case AttackPattern.FOCUSED:
        // Narrow arc facing the target
        return { 
          useFixedAngle: true, 
          angleRange: { min: -Math.PI / 4, max: Math.PI / 4 },
          radiusMultiplier: 0.8
        };
        
      case AttackPattern.SPREAD:
        // Wide distribution
        return { 
          useFixedAngle: false,
          radiusMultiplier: 1.2
        };
        
      case AttackPattern.WAVES:
        // Alternating sectors
        return { 
          useFixedAngle: true,
          angleRange: { min: -Math.PI / 3, max: Math.PI / 3 },
          radiusMultiplier: 1.0
        };
        
      case AttackPattern.SURROUND:
        // Full 360 degrees
        return { 
          useFixedAngle: false,
          radiusMultiplier: 1.0
        };
        
      case AttackPattern.SEQUENTIAL:
        // Focused but moving
        return { 
          useFixedAngle: true,
          angleRange: { min: -Math.PI / 6, max: Math.PI / 6 },
          radiusMultiplier: 0.9
        };
    }
  }
  
  /**
   * Determine target selection based on pattern
   */
  static getTargetingMode(pattern: AttackPattern): 'random' | 'focused' | 'sequential' | 'spread' {
    switch (pattern) {
      case AttackPattern.FOCUSED:
        return 'focused';
      case AttackPattern.SEQUENTIAL:
        return 'sequential';
      case AttackPattern.SPREAD:
      case AttackPattern.SURROUND:
        return 'spread';
      case AttackPattern.WAVES:
        return 'random';
    }
  }
}

/**
 * Manages active attack scenarios
 */
export class ScenarioManager {
  private activeScenario: ScenarioPreset | null = null;
  private startTime: number = 0;
  private onComplete?: () => void;
  private onUpdate?: (progress: number) => void;
  
  /**
   * Start a new scenario
   */
  startScenario(scenario: ScenarioPreset, callbacks?: {
    onComplete?: () => void;
    onUpdate?: (progress: number) => void;
  }) {
    this.activeScenario = scenario;
    this.startTime = Date.now();
    this.onComplete = callbacks?.onComplete;
    this.onUpdate = callbacks?.onUpdate;
  }
  
  /**
   * Stop the current scenario
   */
  stopScenario() {
    if (this.activeScenario) {
      this.activeScenario = null;
      this.onComplete?.();
    }
  }
  
  /**
   * Get current scenario progress (0-1)
   */
  getProgress(): number {
    if (!this.activeScenario || !this.activeScenario.parameters.duration) {
      return 0;
    }
    
    const elapsed = (Date.now() - this.startTime) / 1000;
    const progress = Math.min(elapsed / this.activeScenario.parameters.duration, 1);
    
    if (progress >= 1 && this.activeScenario) {
      this.stopScenario();
    }
    
    return progress;
  }
  
  /**
   * Check if scenario should continue
   */
  update(): boolean {
    if (!this.activeScenario) return false;
    
    const progress = this.getProgress();
    this.onUpdate?.(progress);
    
    if (this.activeScenario.parameters.duration) {
      return progress < 1;
    }
    
    return true; // Continuous scenario
  }
  
  getActiveScenario(): ScenarioPreset | null {
    return this.activeScenario;
  }
  
  isActive(): boolean {
    return this.activeScenario !== null;
  }
}