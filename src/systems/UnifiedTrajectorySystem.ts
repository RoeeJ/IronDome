import * as THREE from 'three';
import { TrajectoryCalculator, LaunchParameters } from '@/utils/TrajectoryCalculator';
import { ImprovedTrajectoryCalculator } from '@/utils/ImprovedTrajectoryCalculator';
import { PredictiveTargeting } from '@/utils/PredictiveTargeting';
import { ProportionalNavigation } from '@/physics/ProportionalNavigation';
import {
  AdvancedBallistics,
  EnvironmentalFactors,
  BallisticCoefficients,
} from '@/physics/AdvancedBallistics';
import { debug } from '@/utils/DebugLogger';

export type TrajectoryMode = 'basic' | 'improved' | 'advanced';
export type GuidanceMode = 'none' | 'proportional' | 'augmented';

export interface TrajectoryConfig {
  mode: TrajectoryMode;
  useKalmanFilter: boolean;
  useEnvironmental: boolean;
  guidanceMode: GuidanceMode;
  enableDebug: boolean;
}

export interface InterceptionResult {
  point: THREE.Vector3;
  time: number;
  confidence?: number;
  canIntercept: boolean;
}

export interface TrajectoryPoint {
  position: THREE.Vector3;
  velocity?: THREE.Vector3;
  time: number;
}

/**
 * Unified trajectory system that consolidates all trajectory calculations
 * Provides a single interface with configurable behavior
 */
export class UnifiedTrajectorySystem {
  private config: TrajectoryConfig;
  private predictiveTargeting: PredictiveTargeting | null = null;
  private proportionalNav: ProportionalNavigation | null = null;
  private advancedBallistics: AdvancedBallistics | null = null;

  private static instance: UnifiedTrajectorySystem | null = null;

  constructor(config: Partial<TrajectoryConfig> = {}) {
    this.config = {
      mode: config.mode || 'basic',
      useKalmanFilter: config.useKalmanFilter ?? false,
      useEnvironmental: config.useEnvironmental ?? false,
      guidanceMode: config.guidanceMode || 'none',
      enableDebug: config.enableDebug ?? false,
    };

    this.initializeSubsystems();
  }

  /**
   * Get singleton instance (for backward compatibility)
   */
  static getInstance(config?: Partial<TrajectoryConfig>): UnifiedTrajectorySystem {
    if (!UnifiedTrajectorySystem.instance) {
      UnifiedTrajectorySystem.instance = new UnifiedTrajectorySystem(config);
    }
    return UnifiedTrajectorySystem.instance;
  }

  /**
   * Update configuration at runtime
   */
  updateConfig(config: Partial<TrajectoryConfig>): void {
    this.config = { ...this.config, ...config };
    this.initializeSubsystems();
  }

  private initializeSubsystems(): void {
    // Initialize subsystems based on configuration
    if (this.config.useKalmanFilter || this.config.mode === 'improved') {
      this.predictiveTargeting = new PredictiveTargeting();
    }

    if (this.config.guidanceMode !== 'none') {
      this.proportionalNav = new ProportionalNavigation();
    }

    if (this.config.mode === 'advanced' || this.config.useEnvironmental) {
      this.advancedBallistics = new AdvancedBallistics();
    }

    if (this.config.enableDebug) {
      debug.module('UnifiedTrajectory').log('Initialized with config:', this.config);
    }
  }

  /**
   * Calculate launch parameters - backward compatible with TrajectoryCalculator
   */
  calculateLaunchParameters(
    launchPos: THREE.Vector3,
    targetPos: THREE.Vector3,
    velocity: number,
    preferLofted: boolean = false
  ): LaunchParameters | null {
    // All modes use the same basic launch calculation
    return TrajectoryCalculator.calculateLaunchParameters(
      launchPos,
      targetPos,
      velocity,
      preferLofted
    );
  }

  /**
   * Convert launch parameters to velocity vector
   */
  getVelocityVector(params: LaunchParameters): THREE.Vector3 {
    return TrajectoryCalculator.getVelocityVector(params);
  }

  /**
   * Calculate optimal interception point with mode-based behavior
   */
  calculateInterceptionPoint(
    threatPos: THREE.Vector3,
    threatVel: THREE.Vector3,
    interceptorPos: THREE.Vector3,
    interceptorSpeed: number,
    isDrone: boolean = false,
    threat?: any // Optional threat object for advanced features
  ): InterceptionResult | null {
    let result: any = null;

    switch (this.config.mode) {
      case 'basic':
        result = TrajectoryCalculator.calculateInterceptionPoint(
          threatPos,
          threatVel,
          interceptorPos,
          interceptorSpeed,
          isDrone
        );
        break;

      case 'improved':
        result = ImprovedTrajectoryCalculator.calculateInterceptionPoint(
          threatPos,
          threatVel,
          interceptorPos,
          interceptorSpeed,
          isDrone
        );
        break;

      case 'advanced':
        // For advanced mode, use improved calculator with environmental adjustments
        result = ImprovedTrajectoryCalculator.calculateInterceptionPoint(
          threatPos,
          threatVel,
          interceptorPos,
          interceptorSpeed,
          isDrone
        );

        // Apply environmental corrections if available
        if (result && this.advancedBallistics && this.config.useEnvironmental) {
          // TODO: Apply wind and other environmental factors
          // This would require environmental data to be passed in
        }
        break;
    }

    // Apply Kalman filtering if enabled and threat object provided
    if (result && this.predictiveTargeting && threat && this.config.useKalmanFilter) {
      this.predictiveTargeting.updateThreatTracking(threat);
      const prediction = this.predictiveTargeting.calculateLeadPrediction(
        threat,
        interceptorPos,
        interceptorSpeed
      );

      if (prediction && prediction.confidence > 0.8) {
        result = {
          point: prediction.aimPoint,
          time: prediction.timeToIntercept,
          confidence: prediction.confidence,
          canIntercept: true,
        };
      }
    }

    // Normalize result format
    if (result) {
      return {
        point: result.point,
        time: result.time,
        confidence: result.confidence || 1.0,
        canIntercept: true,
      };
    }

    return null;
  }

  /**
   * Predict trajectory for visualization
   */
  predictTrajectory(
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    options?: {
      timeStep?: number;
      maxTime?: number;
      environmental?: EnvironmentalFactors;
      coefficients?: BallisticCoefficients;
    }
  ): TrajectoryPoint[] {
    const timeStep = options?.timeStep || 0.1;
    const maxTime = options?.maxTime || 20;

    if (
      this.config.mode === 'advanced' &&
      this.advancedBallistics &&
      options?.environmental &&
      options?.coefficients
    ) {
      // Use advanced ballistics for trajectory prediction
      const points: TrajectoryPoint[] = [];
      let currentPos = position.clone();
      let currentVel = velocity.clone();
      let t = 0;

      while (t <= maxTime && currentPos.y > 0) {
        points.push({
          position: currentPos.clone(),
          velocity: currentVel.clone(),
          time: t,
        });

        const result = this.advancedBallistics.calculateTrajectory(
          currentPos,
          currentVel,
          options.coefficients,
          options.environmental,
          timeStep
        );

        currentPos = result.position;
        currentVel = result.velocity;
        t += timeStep;
      }

      return points;
    } else {
      // Use basic trajectory prediction
      const points = TrajectoryCalculator.predictTrajectory(position, velocity, timeStep, maxTime);

      // Convert to TrajectoryPoint format
      return points.map((pos, i) => ({
        position: pos,
        time: i * timeStep,
      }));
    }
  }

  /**
   * Calculate guidance command for interceptor
   */
  calculateGuidanceCommand(
    interceptorPos: THREE.Vector3,
    interceptorVel: THREE.Vector3,
    targetPos: THREE.Vector3,
    targetVel: THREE.Vector3
  ): { acceleration: THREE.Vector3 } | null {
    if (!this.proportionalNav || this.config.guidanceMode === 'none') {
      return null;
    }

    const useAugmented = this.config.guidanceMode === 'augmented';
    return this.proportionalNav.calculateGuidanceCommand(
      interceptorPos,
      interceptorVel,
      targetPos,
      targetVel,
      useAugmented
    );
  }

  /**
   * Clean up resources (for predictive targeting)
   */
  cleanup(): void {
    if (this.predictiveTargeting) {
      this.predictiveTargeting.cleanup();
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): TrajectoryConfig {
    return { ...this.config };
  }

  /**
   * Static helper methods for backward compatibility
   */
  static calculateLaunchParameters(
    launchPos: THREE.Vector3,
    targetPos: THREE.Vector3,
    velocity: number,
    preferLofted: boolean = false
  ): LaunchParameters | null {
    return TrajectoryCalculator.calculateLaunchParameters(
      launchPos,
      targetPos,
      velocity,
      preferLofted
    );
  }

  static getVelocityVector(params: LaunchParameters): THREE.Vector3 {
    return TrajectoryCalculator.getVelocityVector(params);
  }

  static calculateInterceptionPoint(
    threatPos: THREE.Vector3,
    threatVel: THREE.Vector3,
    interceptorPos: THREE.Vector3,
    interceptorSpeed: number,
    isDrone: boolean = false
  ): InterceptionResult | null {
    // Check global algorithm setting and update singleton config if needed
    const useImproved = (window as any).__useImprovedAlgorithms !== false;
    const instance = UnifiedTrajectorySystem.getInstance();

    // Update mode if it doesn't match global setting
    const currentMode = instance.getConfig().mode;
    const expectedMode = useImproved ? 'improved' : 'basic';
    if (currentMode !== expectedMode) {
      instance.updateConfig({ mode: expectedMode });
    }

    return instance.calculateInterceptionPoint(
      threatPos,
      threatVel,
      interceptorPos,
      interceptorSpeed,
      isDrone
    );
  }

  static predictTrajectory(
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    timeStep: number = 0.1,
    maxTime: number = 20
  ): THREE.Vector3[] {
    const instance = UnifiedTrajectorySystem.getInstance();
    const points = instance.predictTrajectory(position, velocity, { timeStep, maxTime });
    return points.map(p => p.position);
  }
}
