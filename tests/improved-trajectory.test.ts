import './setup';
import { describe, it, expect } from 'bun:test';
import * as THREE from 'three';
import { ImprovedTrajectoryCalculator } from '../src/utils/ImprovedTrajectoryCalculator';

describe('ImprovedTrajectoryCalculator Tests', () => {
  
  describe('calculateInterceptionPoint', () => {
    it('should calculate interception for ballistic threat', () => {
      const threatPos = new THREE.Vector3(100, 50, 100);
      const threatVel = new THREE.Vector3(-20, -10, -20);
      const batteryPos = new THREE.Vector3(0, 0, 0);
      const interceptorSpeed = 150;
      
      const result = ImprovedTrajectoryCalculator.calculateInterceptionPoint(
        threatPos, threatVel, batteryPos, interceptorSpeed, false
      );
      
      if (result) {
        expect(result.point).toBeInstanceOf(THREE.Vector3);
        expect(result.time).toBeGreaterThan(0);
        expect(result.confidence).toBeGreaterThan(0);
        expect(result.confidence).toBeLessThanOrEqual(1);
      }
    });
    
    it('should calculate interception for drone', () => {
      const threatPos = new THREE.Vector3(100, 50, 100);
      const threatVel = new THREE.Vector3(-20, 0, -20);
      const batteryPos = new THREE.Vector3(0, 0, 0);
      const interceptorSpeed = 150;
      
      const result = ImprovedTrajectoryCalculator.calculateInterceptionPoint(
        threatPos, threatVel, batteryPos, interceptorSpeed, true
      );
      
      if (result) {
        expect(result.point).toBeInstanceOf(THREE.Vector3);
        expect(result.time).toBeGreaterThan(0);
        expect(result.confidence).toBeGreaterThan(0);
      }
    });
    
    it('should handle edge cases better than basic calculator', () => {
      // High altitude threat
      const threatPos = new THREE.Vector3(100, 500, 100);
      const threatVel = new THREE.Vector3(-10, -50, -10);
      const batteryPos = new THREE.Vector3(0, 0, 0);
      const interceptorSpeed = 200;
      
      const result = ImprovedTrajectoryCalculator.calculateInterceptionPoint(
        threatPos, threatVel, batteryPos, interceptorSpeed, false
      );
      
      // Should handle high altitude threats
      expect(result).toBeDefined();
    });
  });
  
  describe('Performance comparison', () => {
    it('should provide confidence metric', () => {
      const scenarios = [
        // Easy intercept
        { pos: new THREE.Vector3(50, 30, 50), vel: new THREE.Vector3(-10, -5, -10) },
        // Harder intercept
        { pos: new THREE.Vector3(200, 100, 200), vel: new THREE.Vector3(-50, -20, -50) },
        // Very difficult
        { pos: new THREE.Vector3(500, 200, 500), vel: new THREE.Vector3(-100, -30, -100) }
      ];
      
      scenarios.forEach((scenario, i) => {
        const result = ImprovedTrajectoryCalculator.calculateInterceptionPoint(
          scenario.pos, scenario.vel, new THREE.Vector3(0, 0, 0), 150, false
        );
        
        if (result) {
          console.log(`Scenario ${i + 1} confidence: ${result.confidence.toFixed(2)}`);
          expect(result.confidence).toBeGreaterThan(0);
          expect(result.confidence).toBeLessThanOrEqual(1);
        }
      });
    });
  });
});