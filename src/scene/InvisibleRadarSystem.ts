import * as THREE from 'three';
import { Threat, THREAT_CONFIGS } from '../entities/Threat';

/**
 * Invisible radar system that provides detection capabilities without visual elements
 */
export class InvisibleRadarSystem {
  private detectionRadius: number;
  private detectedThreats: Set<string> = new Set();
  private sensorLevel: number = 1; // For future upgrades

  constructor(detectionRadius: number = 800) {
    this.detectionRadius = detectionRadius;
  }

  /**
   * Update radar detection
   */
  update(threats: Threat[]): void {
    // Clear previous detections
    this.detectedThreats.clear();

    // Detect all threats within range
    threats.forEach(threat => {
      if (threat.isActive) {
        const distance = threat.getPosition().length(); // Distance from center (0,0,0)
        if (distance > this.detectionRadius) {
          return; // Out of range, skip
        }

        const config = THREAT_CONFIGS[threat.type];
        // Default signature if not defined, making existing threats detectable
        const signature = config.signature || { radar: 1.0, thermal: 1.0, electronic: 1.0 };

        // Level 1 sensor only sees radar signature.
        // Decoys have radar: 1.0, so they are detected.
        if (this.sensorLevel >= 1) {
          if (signature.radar >= 0.5) {
            // Basic detection threshold
            this.detectedThreats.add(threat.id);
          }
        }
        // Future upgrades could check other signatures to differentiate decoys.
      }
    });
  }

  /**
   * Check if a threat is detected
   */
  isThreatDetected(threat: Threat): boolean {
    return this.detectedThreats.has(threat.id);
  }

  /**
   * Get detection info for a position
   */
  getDetectionInfo(position: THREE.Vector3): {
    detected: boolean;
    distance: number;
    coverage: number;
  } {
    const distance = position.length();
    const detected = distance <= this.detectionRadius;
    const coverage = detected ? 1 - distance / this.detectionRadius : 0;

    return { detected, distance, coverage };
  }

  /**
   * Check if position is within detection range
   */
  isInDetectionRange(position: THREE.Vector3): boolean {
    return position.length() <= this.detectionRadius;
  }

  /**
   * Get all detected threats
   */
  getDetectedThreats(allThreats: Threat[]): Threat[] {
    return allThreats.filter(threat => this.detectedThreats.has(threat.id));
  }

  /**
   * Check if a position is detected by radar (for battery compatibility)
   */
  checkDetection(position: THREE.Vector3): boolean {
    return this.isInDetectionRange(position);
  }

  /**
   * Placeholder methods for compatibility
   */
  setShowCoverage(show: boolean): void {
    // No visual elements to show/hide
  }

  setModelFacingDirection(direction: THREE.Vector3): void {
    // No models to orient
  }
}
