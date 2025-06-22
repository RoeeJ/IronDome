import './setup';
import { describe, it, expect, beforeEach } from 'bun:test';
import * as THREE from 'three';
import { UnifiedTrajectorySystem } from '../src/systems/UnifiedTrajectorySystem';
import { TrajectoryCalculator } from '../src/utils/TrajectoryCalculator';
import { ImprovedTrajectoryCalculator } from '../src/utils/ImprovedTrajectoryCalculator';

describe('UnifiedTrajectorySystem', () => {
  
  describe('Basic Configuration', () => {
    it('should create instance with default config', () => {
      const system = new UnifiedTrajectorySystem();
      const config = system.getConfig();
      
      expect(config.mode).toBe('basic');
      expect(config.useKalmanFilter).toBe(false);
      expect(config.useEnvironmental).toBe(false);
      expect(config.guidanceMode).toBe('none');
    });
    
    it('should create instance with custom config', () => {
      const system = new UnifiedTrajectorySystem({
        mode: 'improved',
        useKalmanFilter: true,
        guidanceMode: 'proportional'
      });
      const config = system.getConfig();
      
      expect(config.mode).toBe('improved');
      expect(config.useKalmanFilter).toBe(true);
      expect(config.guidanceMode).toBe('proportional');
    });
    
    it('should update config at runtime', () => {
      const system = new UnifiedTrajectorySystem();
      system.updateConfig({ mode: 'advanced', useEnvironmental: true });
      const config = system.getConfig();
      
      expect(config.mode).toBe('advanced');
      expect(config.useEnvironmental).toBe(true);
    });
  });
  
  describe('Backward Compatibility', () => {
    it('should maintain compatibility with TrajectoryCalculator API', () => {
      const position = new THREE.Vector3(0, 0, 0);
      const target = new THREE.Vector3(100, 0, 100);
      const velocity = 50;
      
      // Test static methods
      const params1 = UnifiedTrajectorySystem.calculateLaunchParameters(
        position, target, velocity, false
      );
      const params2 = TrajectoryCalculator.calculateLaunchParameters(
        position, target, velocity, false
      );
      
      expect(params1).toEqual(params2);
      
      // Test velocity vector
      if (params1) {
        const vel1 = UnifiedTrajectorySystem.getVelocityVector(params1);
        const vel2 = TrajectoryCalculator.getVelocityVector(params1);
        expect(vel1).toEqual(vel2);
      }
    });
    
    it('should provide static trajectory prediction', () => {
      const position = new THREE.Vector3(0, 10, 0);
      const velocity = new THREE.Vector3(10, 20, 0);
      
      const trajectory1 = UnifiedTrajectorySystem.predictTrajectory(position, velocity);
      const trajectory2 = TrajectoryCalculator.predictTrajectory(position, velocity);
      
      expect(trajectory1.length).toBe(trajectory2.length);
      expect(trajectory1[0]).toEqual(trajectory2[0]);
    });
  });
  
  describe('Mode-Based Behavior', () => {
    it('should use basic mode calculations', () => {
      const system = new UnifiedTrajectorySystem({ mode: 'basic' });
      
      const threatPos = new THREE.Vector3(100, 50, 100);
      const threatVel = new THREE.Vector3(-20, -10, -20);
      const batteryPos = new THREE.Vector3(0, 0, 0);
      const interceptorSpeed = 150;
      
      const result = system.calculateInterceptionPoint(
        threatPos, threatVel, batteryPos, interceptorSpeed, false
      );
      
      // Should match basic calculator result
      const basicResult = TrajectoryCalculator.calculateInterceptionPoint(
        threatPos, threatVel, batteryPos, interceptorSpeed, false
      );
      
      if (result && basicResult) {
        expect(result.point).toEqual(basicResult.point);
        expect(result.time).toEqual(basicResult.time);
      }
    });
    
    it('should use improved mode calculations', () => {
      const system = new UnifiedTrajectorySystem({ mode: 'improved' });
      
      const threatPos = new THREE.Vector3(100, 50, 100);
      const threatVel = new THREE.Vector3(-20, -10, -20);
      const batteryPos = new THREE.Vector3(0, 0, 0);
      const interceptorSpeed = 150;
      
      const result = system.calculateInterceptionPoint(
        threatPos, threatVel, batteryPos, interceptorSpeed, false
      );
      
      if (result) {
        expect(result.confidence).toBeDefined();
        expect(result.confidence).toBeGreaterThan(0);
      }
    });
    
    it('should handle drone vs ballistic differently', () => {
      const system = new UnifiedTrajectorySystem({ mode: 'improved' });
      
      const threatPos = new THREE.Vector3(100, 50, 100);
      const droneVel = new THREE.Vector3(-20, 0, -20); // Constant altitude
      const missileVel = new THREE.Vector3(-20, -10, -20); // Falling
      const batteryPos = new THREE.Vector3(0, 0, 0);
      const interceptorSpeed = 150;
      
      const droneResult = system.calculateInterceptionPoint(
        threatPos, droneVel, batteryPos, interceptorSpeed, true
      );
      
      const missileResult = system.calculateInterceptionPoint(
        threatPos, missileVel, batteryPos, interceptorSpeed, false
      );
      
      // Drone should maintain altitude, missile should fall
      if (droneResult && missileResult) {
        expect(Math.abs(droneResult.point.y - threatPos.y)).toBeLessThan(10);
        expect(missileResult.point.y).toBeLessThan(threatPos.y);
      }
    });
  });
  
  describe('Advanced Features', () => {
    it('should use Kalman filtering when enabled', () => {
      const system = new UnifiedTrajectorySystem({
        mode: 'improved',
        useKalmanFilter: true
      });
      
      const mockThreat = {
        id: 'threat-1',
        position: new THREE.Vector3(100, 50, 100),
        velocity: new THREE.Vector3(-20, -10, -20),
        type: 'missile' as const,
        getPosition: function() { return this.position; },
        getVelocity: function() { return this.velocity; }
      };
      
      // Update tracking multiple times
      for (let i = 0; i < 5; i++) {
        mockThreat.position.add(mockThreat.velocity.clone().multiplyScalar(0.1));
        
        const result = system.calculateInterceptionPoint(
          mockThreat.position,
          mockThreat.velocity,
          new THREE.Vector3(0, 0, 0),
          150,
          false,
          mockThreat
        );
        
        if (result && i > 2) {
          // After some tracking, confidence should be high
          expect(result.confidence).toBeGreaterThan(0.7);
        }
      }
    });
    
    it('should provide guidance commands when enabled', () => {
      const system = new UnifiedTrajectorySystem({
        guidanceMode: 'proportional'
      });
      
      const interceptorPos = new THREE.Vector3(0, 50, 0);
      const interceptorVel = new THREE.Vector3(100, 0, 0);
      const targetPos = new THREE.Vector3(200, 100, 0);
      const targetVel = new THREE.Vector3(-50, -10, 0);
      
      const command = system.calculateGuidanceCommand(
        interceptorPos, interceptorVel, targetPos, targetVel
      );
      
      expect(command).not.toBeNull();
      expect(command!.acceleration).toBeInstanceOf(THREE.Vector3);
    });
    
    it('should not provide guidance when disabled', () => {
      const system = new UnifiedTrajectorySystem({
        guidanceMode: 'none'
      });
      
      const command = system.calculateGuidanceCommand(
        new THREE.Vector3(), new THREE.Vector3(),
        new THREE.Vector3(), new THREE.Vector3()
      );
      
      expect(command).toBeNull();
    });
  });
  
  describe('Trajectory Prediction', () => {
    it('should predict basic trajectories', () => {
      const system = new UnifiedTrajectorySystem({ mode: 'basic' });
      
      const position = new THREE.Vector3(0, 10, 0);
      const velocity = new THREE.Vector3(10, 20, 0);
      
      const trajectory = system.predictTrajectory(position, velocity);
      
      expect(Array.isArray(trajectory)).toBe(true);
      expect(trajectory.length).toBeGreaterThan(0);
      expect(trajectory[0].position).toBeInstanceOf(THREE.Vector3);
      expect(trajectory[0].time).toBe(0);
      
      // Check that trajectory follows parabolic path
      let maxHeight = position.y;
      trajectory.forEach(point => {
        if (point.position.y > maxHeight) {
          maxHeight = point.position.y;
        }
      });
      expect(maxHeight).toBeGreaterThan(position.y);
    });
    
    it('should use advanced ballistics when configured', () => {
      const system = new UnifiedTrajectorySystem({
        mode: 'advanced',
        useEnvironmental: true
      });
      
      const position = new THREE.Vector3(0, 10, 0);
      const velocity = new THREE.Vector3(100, 100, 0);
      
      const coefficients = {
        mass: 10,
        dragCoefficient: 0.3,
        referenceArea: 0.1
      };
      
      const environmental = {
        windSpeed: new THREE.Vector3(10, 0, 0),
        temperature: 20,
        pressure: 1013.25,
        humidity: 0.5,
        altitude: 0
      };
      
      const trajectory = system.predictTrajectory(position, velocity, {
        environmental,
        coefficients
      });
      
      expect(trajectory.length).toBeGreaterThan(0);
      expect(trajectory[0].velocity).toBeDefined();
      
      // With wind, final position should be shifted
      const lastPoint = trajectory[trajectory.length - 1];
      expect(lastPoint.position.x).toBeGreaterThan(0);
    });
  });
  
  describe('Singleton Pattern', () => {
    it('should return same instance', () => {
      const instance1 = UnifiedTrajectorySystem.getInstance();
      const instance2 = UnifiedTrajectorySystem.getInstance();
      
      expect(instance1).toBe(instance2);
    });
    
    it('should share configuration between static calls', () => {
      const instance = UnifiedTrajectorySystem.getInstance();
      instance.updateConfig({ mode: 'advanced' });
      
      // Static method should use the singleton's configuration
      const result = UnifiedTrajectorySystem.calculateInterceptionPoint(
        new THREE.Vector3(100, 50, 100),
        new THREE.Vector3(-20, -10, -20),
        new THREE.Vector3(0, 0, 0),
        150,
        false
      );
      
      // Should use advanced mode
      if (result) {
        expect(result.confidence).toBeDefined();
      }
    });
  });
  
  describe('Resource Management', () => {
    it('should cleanup predictive targeting', () => {
      const system = new UnifiedTrajectorySystem({
        useKalmanFilter: true
      });
      
      // No error should occur
      expect(() => system.cleanup()).not.toThrow();
    });
  });
});

describe('UnifiedTrajectorySystem Performance', () => {
  const iterations = 1000;
  
  it('should maintain performance across modes', () => {
    const position = new THREE.Vector3(100, 50, 100);
    const velocity = new THREE.Vector3(-20, -10, -20);
    const batteryPos = new THREE.Vector3(0, 0, 0);
    const interceptorSpeed = 150;
    
    // Test basic mode
    const basicSystem = new UnifiedTrajectorySystem({ mode: 'basic' });
    const basicStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      basicSystem.calculateInterceptionPoint(
        position, velocity, batteryPos, interceptorSpeed, false
      );
    }
    const basicDuration = performance.now() - basicStart;
    
    // Test improved mode
    const improvedSystem = new UnifiedTrajectorySystem({ mode: 'improved' });
    const improvedStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      improvedSystem.calculateInterceptionPoint(
        position, velocity, batteryPos, interceptorSpeed, false
      );
    }
    const improvedDuration = performance.now() - improvedStart;
    
    console.log(`Basic mode: ${basicDuration / iterations}ms per calculation`);
    console.log(`Improved mode: ${improvedDuration / iterations}ms per calculation`);
    
    // Performance should be reasonable
    expect(basicDuration / iterations).toBeLessThan(2);
    expect(improvedDuration / iterations).toBeLessThan(5);
  });
});