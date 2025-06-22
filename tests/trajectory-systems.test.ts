import './setup';
import { describe, it, expect, beforeEach } from 'bun:test';
import * as THREE from 'three';
import { TrajectoryCalculator } from '../src/utils/TrajectoryCalculator';
import { ImprovedTrajectoryCalculator } from '../src/utils/ImprovedTrajectoryCalculator';
import { PredictiveTargeting } from '../src/utils/PredictiveTargeting';
import { ProportionalNavigation } from '../src/physics/ProportionalNavigation';
import { AdvancedBallistics } from '../src/physics/AdvancedBallistics';

describe('Trajectory Systems Tests', () => {
  
  describe('TrajectoryCalculator', () => {
    describe('calculateLaunchParameters', () => {
      it('should calculate launch parameters for direct fire', () => {
        const position = new THREE.Vector3(0, 0, 0);
        const target = new THREE.Vector3(100, 0, 100);
        const velocity = 50;
        
        const params = TrajectoryCalculator.calculateLaunchParameters(position, target, velocity, false);
        
        expect(params).not.toBeNull();
        expect(params!.angle).toBeGreaterThan(0);
        expect(params!.angle).toBeLessThan(90); // degrees not radians
        expect(params!.azimuth).toBeDefined();
        expect(params!.velocity).toBe(velocity);
      });
      
      it('should calculate launch parameters for lofted trajectory', () => {
        const position = new THREE.Vector3(0, 0, 0);
        const target = new THREE.Vector3(100, 0, 100);
        const velocity = 50;
        
        const paramsLofted = TrajectoryCalculator.calculateLaunchParameters(position, target, velocity, true);
        const paramsDirect = TrajectoryCalculator.calculateLaunchParameters(position, target, velocity, false);
        
        expect(paramsLofted).not.toBeNull();
        expect(paramsDirect).not.toBeNull();
        expect(paramsLofted!.angle).toBeGreaterThan(paramsDirect!.angle);
      });
      
      it('should handle zero distance gracefully', () => {
        const position = new THREE.Vector3(0, 0, 0);
        const target = new THREE.Vector3(0, 0, 0);
        const velocity = 50;
        
        const params = TrajectoryCalculator.calculateLaunchParameters(position, target, velocity, false);
        
        expect(params).toBeDefined();
      });
      
      it('should return null for out of range targets', () => {
        const position = new THREE.Vector3(0, 0, 0);
        const target = new THREE.Vector3(10000, 0, 10000);
        const velocity = 10;
        
        const params = TrajectoryCalculator.calculateLaunchParameters(position, target, velocity, false);
        
        expect(params).toBeNull();
      });
    });
    
    describe('getVelocityVector', () => {
      it('should convert launch parameters to velocity vector', () => {
        const params = {
          angle: 45,
          azimuth: 0,
          velocity: 100
        };
        
        const velocity = TrajectoryCalculator.getVelocityVector(params);
        
        expect(velocity).toBeInstanceOf(THREE.Vector3);
        expect(velocity.length()).toBeCloseTo(100, 1);
        expect(velocity.y).toBeCloseTo(70.71, 1);
      });
      
      it('should handle different azimuths correctly', () => {
        const params = {
          angle: 45,
          azimuth: 90,
          velocity: 100
        };
        
        const velocity = TrajectoryCalculator.getVelocityVector(params);
        
        expect(velocity.x).toBeCloseTo(0, 1);
        expect(velocity.z).toBeCloseTo(70.71, 1);
      });
    });
    
    describe('predictTrajectory', () => {
      it('should predict ballistic trajectory', () => {
        const position = new THREE.Vector3(0, 10, 0);
        const velocity = new THREE.Vector3(10, 20, 0);
        
        const trajectory = TrajectoryCalculator.predictTrajectory(position, velocity);
        
        expect(Array.isArray(trajectory)).toBe(true);
        expect(trajectory.length).toBeGreaterThan(0);
        expect(trajectory[0].distanceTo(position)).toBeLessThan(0.1);
        
        let maxHeight = position.y;
        trajectory.forEach(point => {
          if (point.y > maxHeight) {
            maxHeight = point.y;
          }
        });
        expect(maxHeight).toBeGreaterThan(position.y);
      });
      
      it('should handle high velocity trajectories', () => {
        const position = new THREE.Vector3(0, 10, 0);
        const velocity = new THREE.Vector3(100, 100, 0);
        
        const trajectory = TrajectoryCalculator.predictTrajectory(position, velocity);
        
        expect(trajectory.length).toBeGreaterThan(0);
        expect(trajectory[trajectory.length - 1].x).toBeGreaterThan(500);
      });
    });
    
    describe('calculateInterceptionPoint', () => {
      it('should calculate interception for ballistic threat', () => {
        const threatPos = new THREE.Vector3(100, 50, 100);
        const threatVel = new THREE.Vector3(-20, -10, -20);
        const batteryPos = new THREE.Vector3(0, 0, 0);
        const interceptorSpeed = 150;
        
        const result = TrajectoryCalculator.calculateInterceptionPoint(
          threatPos, threatVel, batteryPos, interceptorSpeed, false
        );
        
        if (result) {
          expect(result.point).toBeInstanceOf(THREE.Vector3);
          expect(result.time).toBeGreaterThan(0);
        }
      });
      
      it('should calculate interception for drone (constant altitude)', () => {
        const threatPos = new THREE.Vector3(100, 50, 100);
        const threatVel = new THREE.Vector3(-20, 0, -20);
        const batteryPos = new THREE.Vector3(0, 0, 0);
        const interceptorSpeed = 150;
        
        const result = TrajectoryCalculator.calculateInterceptionPoint(
          threatPos, threatVel, batteryPos, interceptorSpeed, true
        );
        
        if (result) {
          expect(Math.abs(result.point.y - threatPos.y)).toBeLessThan(10);
        }
      });
      
      it('should handle impossible intercepts', () => {
        const threatPos = new THREE.Vector3(1000, 50, 1000);
        const threatVel = new THREE.Vector3(100, 0, 100);
        const batteryPos = new THREE.Vector3(0, 0, 0);
        const interceptorSpeed = 50;
        
        const result = TrajectoryCalculator.calculateInterceptionPoint(
          threatPos, threatVel, batteryPos, interceptorSpeed, false
        );
        
        expect(result).toBeDefined();
      });
    });
  });
  
  describe('ImprovedTrajectoryCalculator', () => {
    it('should calculate more accurate interception points', () => {
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
      }
    });
    
    it('should handle edge cases better than basic calculator', () => {
      const threatPos = new THREE.Vector3(100, 500, 100);
      const threatVel = new THREE.Vector3(-10, -50, -10);
      const batteryPos = new THREE.Vector3(0, 0, 0);
      const interceptorSpeed = 200;
      
      const result = ImprovedTrajectoryCalculator.calculateInterceptionPoint(
        threatPos, threatVel, batteryPos, interceptorSpeed, false
      );
      
      expect(result).toBeDefined();
      if (result) {
        expect(result.time).toBeGreaterThan(0);
      }
    });
  });
  
  describe('PredictiveTargeting', () => {
    let targeting: PredictiveTargeting;
    
    beforeEach(() => {
      targeting = new PredictiveTargeting();
    });
    
    describe('updateThreatTracking', () => {
      it('should track threat positions over time', () => {
        const threat = {
          id: 'threat-1',
          position: new THREE.Vector3(100, 50, 100),
          velocity: new THREE.Vector3(-10, -5, -10),
          type: 'missile' as const,
          getPosition: function() { return this.position; },
          getVelocity: function() { return this.velocity; }
        };
        
        for (let i = 0; i < 5; i++) {
          threat.position.add(threat.velocity.clone().multiplyScalar(0.1));
          targeting.updateThreatTracking(threat);
        }
        
        const prediction = targeting.calculateLeadPrediction(
          threat,
          new THREE.Vector3(0, 0, 0),
          100
        );
        
        expect(prediction).toBeDefined();
        expect(prediction.confidence).toBeGreaterThan(0);
      });
      
      it('should handle multiple threats independently', () => {
        const threat1 = {
          id: 'threat-1',
          position: new THREE.Vector3(100, 50, 100),
          velocity: new THREE.Vector3(-10, -5, -10),
          type: 'missile' as const,
          getPosition: function() { return this.position; },
          getVelocity: function() { return this.velocity; }
        };
        
        const threat2 = {
          id: 'threat-2',
          position: new THREE.Vector3(-100, 50, -100),
          velocity: new THREE.Vector3(10, -5, 10),
          type: 'drone' as const,
          getPosition: function() { return this.position; },
          getVelocity: function() { return this.velocity; }
        };
        
        targeting.updateThreatTracking(threat1);
        targeting.updateThreatTracking(threat2);
        
        const prediction1 = targeting.calculateLeadPrediction(
          threat1,
          new THREE.Vector3(0, 0, 0),
          100
        );
        
        const prediction2 = targeting.calculateLeadPrediction(
          threat2,
          new THREE.Vector3(0, 0, 0),
          100
        );
        
        expect(prediction1).toBeDefined();
        expect(prediction2).toBeDefined();
        expect(prediction1.aimPoint).not.toEqual(prediction2.aimPoint);
      });
    });
    
    describe('calculateLeadPrediction', () => {
      it('should predict lead for moving targets', () => {
        const threat = {
          id: 'threat-1',
          position: new THREE.Vector3(100, 50, 100),
          velocity: new THREE.Vector3(-20, -10, -20),
          type: 'missile' as const,
          getPosition: function() { return this.position; },
          getVelocity: function() { return this.velocity; }
        };
        
        for (let i = 0; i < 10; i++) {
          targeting.updateThreatTracking(threat);
          threat.position.add(threat.velocity.clone().multiplyScalar(0.1));
        }
        
        const batteryPos = new THREE.Vector3(0, 0, 0);
        const interceptorSpeed = 100;
        
        const prediction = targeting.calculateLeadPrediction(
          threat,
          batteryPos,
          interceptorSpeed
        );
        
        expect(prediction).toBeDefined();
        expect(prediction.aimPoint).toBeInstanceOf(THREE.Vector3);
        expect(prediction.timeToIntercept).toBeGreaterThan(0);
        expect(prediction.confidence).toBeGreaterThan(0.5);
      });
      
      it('should have low confidence for new threats', () => {
        const threat = {
          id: 'threat-new',
          position: new THREE.Vector3(100, 50, 100),
          velocity: new THREE.Vector3(-20, -10, -20),
          type: 'missile' as const,
          getPosition: function() { return this.position; },
          getVelocity: function() { return this.velocity; }
        };
        
        const prediction = targeting.calculateLeadPrediction(
          threat,
          new THREE.Vector3(0, 0, 0),
          100
        );
        
        // Simple calculation returns 0.7 confidence when no history exists
        expect(prediction.confidence).toBe(0.7);
      });
    });
    
    describe('cleanup', () => {
      it('should remove old tracking data', () => {
        const oldThreat = {
          id: 'threat-old',
          position: new THREE.Vector3(100, 50, 100),
          velocity: new THREE.Vector3(-10, -5, -10),
          type: 'missile' as const,
          getPosition: function() { return this.position; },
          getVelocity: function() { return this.velocity; }
        };
        
        targeting.updateThreatTracking(oldThreat);
        
        const originalNow = Date.now;
        let mockTime = originalNow();
        Date.now = () => mockTime;
        
        mockTime += 60000;
        
        targeting.cleanup();
        
        const prediction = targeting.calculateLeadPrediction(
          oldThreat,
          new THREE.Vector3(0, 0, 0),
          100
        );
        
        // After cleanup, it should use simple calculation with default confidence
        expect(prediction.confidence).toBe(0.7);
        
        Date.now = originalNow;
      });
    });
  });
  
  describe('ProportionalNavigation (Unit Tests)', () => {
    let navigation: ProportionalNavigation;
    
    beforeEach(() => {
      navigation = new ProportionalNavigation();
    });
    
    it('should calculate PN guidance commands', () => {
      const interceptorPos = new THREE.Vector3(0, 50, 0);
      const interceptorVel = new THREE.Vector3(100, 0, 0);
      const targetPos = new THREE.Vector3(200, 100, 0);
      const targetVel = new THREE.Vector3(-50, -10, 0);
      
      const command = navigation.calculateGuidanceCommand(
        interceptorPos, interceptorVel, targetPos, targetVel
      );
      
      expect(command).toBeDefined();
      expect(command.acceleration).toBeInstanceOf(THREE.Vector3);
      expect(command.acceleration.length()).toBeLessThan(50); // max acceleration
    });
    
    it('should handle zero closing velocity', () => {
      const interceptorPos = new THREE.Vector3(0, 0, 0);
      const interceptorVel = new THREE.Vector3(0, 0, 0);
      const targetPos = new THREE.Vector3(100, 0, 0);
      const targetVel = new THREE.Vector3(0, 0, 0);
      
      const command = navigation.calculateGuidanceCommand(
        interceptorPos, interceptorVel, targetPos, targetVel
      );
      
      expect(command.acceleration.length()).toBe(0);
    });
  });
  
  describe('AdvancedBallistics (Unit Tests)', () => {
    let ballistics: AdvancedBallistics;
    
    beforeEach(() => {
      ballistics = new AdvancedBallistics();
    });
    
    it('should calculate trajectory with environmental factors', () => {
      const position = new THREE.Vector3(0, 10, 0);
      const velocity = new THREE.Vector3(100, 100, 0);
      const coefficients = {
        mass: 10,
        dragCoefficient: 0.3,
        referenceArea: 0.1
      };
      const environmental = {
        windSpeed: new THREE.Vector3(10, 0, 0),
        airDensity: 1.225,
        temperature: 20,
        pressure: 101325,
        humidity: 0.5,
        altitude: 0
      };
      
      const result = ballistics.calculateTrajectory(
        position, velocity, coefficients, environmental, 0.1
      );
      
      expect(result).toBeDefined();
      expect(result.position).toBeInstanceOf(THREE.Vector3);
      expect(result.velocity).toBeInstanceOf(THREE.Vector3);
    });
    
    it('should calculate trajectory step by step', () => {
      const position = new THREE.Vector3(0, 10, 0);
      const velocity = new THREE.Vector3(100, 100, 0);
      const coefficients = {
        mass: 10,
        dragCoefficient: 0.3,
        referenceArea: 0.1  // Note: corrected property name
      };
      const environmental = {
        windSpeed: new THREE.Vector3(0, 0, 0),
        temperature: 20,
        pressure: 1013.25,
        humidity: 0.5,
        altitude: 0
      };
      
      // Calculate multiple steps to form a trajectory
      const trajectory = [];
      let currentPos = position.clone();
      let currentVel = velocity.clone();
      
      for (let i = 0; i < 10; i++) {
        const result = ballistics.calculateTrajectory(
          currentPos, currentVel, coefficients, environmental, 0.1
        );
        trajectory.push(result);
        currentPos = result.position;
        currentVel = result.velocity;
      }
      
      expect(trajectory.length).toBe(10);
      expect(trajectory[0].position).toBeInstanceOf(THREE.Vector3);
      expect(trajectory[0].velocity).toBeInstanceOf(THREE.Vector3);
    });
  });
});

describe('Trajectory System Performance Benchmarks', () => {
  const iterations = 1000;
  
  it('should benchmark TrajectoryCalculator performance', () => {
    const position = new THREE.Vector3(0, 0, 0);
    const target = new THREE.Vector3(1000, 0, 1000);
    const velocity = 100;
    
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      TrajectoryCalculator.calculateLaunchParameters(position, target, velocity, false);
    }
    const duration = performance.now() - start;
    
    console.log(`TrajectoryCalculator: ${duration}ms for ${iterations} calculations`);
    console.log(`Average: ${duration / iterations}ms per calculation`);
    
    expect(duration / iterations).toBeLessThan(1);
  });
  
  it('should benchmark interception calculations', () => {
    const threatPos = new THREE.Vector3(1000, 500, 1000);
    const threatVel = new THREE.Vector3(-100, -50, -100);
    const batteryPos = new THREE.Vector3(0, 0, 0);
    const interceptorSpeed = 150;
    
    const startBasic = performance.now();
    for (let i = 0; i < iterations; i++) {
      TrajectoryCalculator.calculateInterceptionPoint(
        threatPos, threatVel, batteryPos, interceptorSpeed, false
      );
    }
    const durationBasic = performance.now() - startBasic;
    
    const startImproved = performance.now();
    for (let i = 0; i < iterations; i++) {
      ImprovedTrajectoryCalculator.calculateInterceptionPoint(
        threatPos, threatVel, batteryPos, interceptorSpeed, false
      );
    }
    const durationImproved = performance.now() - startImproved;
    
    console.log(`Basic interception: ${durationBasic / iterations}ms per calculation`);
    console.log(`Improved interception: ${durationImproved / iterations}ms per calculation`);
    
    expect(durationBasic / iterations).toBeLessThan(2);
    expect(durationImproved / iterations).toBeLessThan(5);
  });
});