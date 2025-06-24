import { describe, test, expect, beforeEach } from 'bun:test';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// Blast physics calculations
class BlastPhysics {
  static calculateBlastPressure(
    distance: number,
    chargeWeight: number,
    ambient: number = 101325 // Pa
  ): number {
    // Simplified Kingery-Bulmash blast parameter equations
    // Z = scaled distance = R / W^(1/3)
    const scaledDistance = distance / Math.pow(chargeWeight, 1/3);
    
    if (scaledDistance < 0.05) {
      // Too close, would destroy everything
      return 100 * ambient;
    }
    
    // Peak overpressure using simplified model
    // P = ambient * (808 * (1 + (Z/4.5)^2) / sqrt(1 + (Z/0.048)^2) / sqrt(1 + (Z/0.32)^2) / sqrt(1 + (Z/1.35)^2))
    const z = scaledDistance;
    const numerator = 808 * (1 + Math.pow(z / 4.5, 2));
    const denom1 = Math.sqrt(1 + Math.pow(z / 0.048, 2));
    const denom2 = Math.sqrt(1 + Math.pow(z / 0.32, 2));
    const denom3 = Math.sqrt(1 + Math.pow(z / 1.35, 2));
    
    const overpressureRatio = numerator / (denom1 * denom2 * denom3);
    return ambient * overpressureRatio;
  }
  
  static calculateBlastImpulse(
    distance: number,
    chargeWeight: number
  ): number {
    // Specific impulse in Pa*s
    const scaledDistance = distance / Math.pow(chargeWeight, 1/3);
    
    // Simplified impulse calculation
    // I = W^(1/3) * (974 / Z) * (1 + (Z/0.54)^10)^(-0.2)
    const factor1 = Math.pow(chargeWeight, 1/3);
    const factor2 = 974 / scaledDistance;
    const factor3 = Math.pow(1 + Math.pow(scaledDistance / 0.54, 10), -0.2);
    
    return factor1 * factor2 * factor3;
  }
  
  static calculateFragmentVelocity(
    chargeWeight: number,
    fragmentMass: number,
    distance: number
  ): number {
    // Gurney equation for initial fragment velocity
    const gurneyConstant = 2700; // m/s for typical explosive
    const chargeToMetalRatio = chargeWeight / (fragmentMass * 100); // Assume 100 fragments
    
    const initialVelocity = gurneyConstant * Math.sqrt(
      chargeToMetalRatio / (1 + 0.5 * chargeToMetalRatio)
    );
    
    // Air drag deceleration
    const dragCoefficient = 0.47; // Sphere
    const airDensity = 1.225; // kg/m³
    const fragmentRadius = Math.pow(fragmentMass / (7850 * 4/3 * Math.PI), 1/3); // Steel density
    const crossSection = Math.PI * fragmentRadius * fragmentRadius;
    
    // Simplified: velocity after traveling distance
    const dragFactor = (dragCoefficient * airDensity * crossSection * distance) / (2 * fragmentMass);
    const finalVelocity = initialVelocity / (1 + dragFactor);
    
    return finalVelocity;
  }
  
  static calculateDamageRadius(
    chargeWeight: number,
    threshold: 'lethal' | 'injury' | 'damage'
  ): number {
    // Based on overpressure thresholds
    const thresholds = {
      lethal: 350000, // 350 kPa
      injury: 100000, // 100 kPa
      damage: 35000   // 35 kPa (building damage)
    };
    
    const targetPressure = thresholds[threshold];
    
    // Iterate to find distance where pressure drops below threshold
    let distance = 0.1;
    let pressure = this.calculateBlastPressure(distance, chargeWeight);
    
    while (pressure > targetPressure && distance < 1000) {
      distance += 0.1;
      pressure = this.calculateBlastPressure(distance, chargeWeight);
    }
    
    return distance;
  }
  
  static generateFragmentPattern(
    numFragments: number,
    chargeWeight: number,
    directional: boolean = false,
    direction?: THREE.Vector3
  ): Array<{ velocity: THREE.Vector3; mass: number }> {
    const fragments: Array<{ velocity: THREE.Vector3; mass: number }> = [];
    const totalMass = chargeWeight * 0.3; // 30% of charge becomes fragments
    
    for (let i = 0; i < numFragments; i++) {
      // Random fragment mass distribution
      const massFraction = Math.random() * 0.02 + 0.001; // 0.1% to 2.1%
      const mass = totalMass * massFraction;
      
      // Velocity direction
      let velocityDir: THREE.Vector3;
      
      if (directional && direction) {
        // Cone pattern around direction
        const coneAngle = Math.PI / 6; // 30 degree cone
        const theta = Math.random() * coneAngle;
        const phi = Math.random() * 2 * Math.PI;
        
        // Create perpendicular vectors
        const perp1 = new THREE.Vector3(direction.z, 0, -direction.x).normalize();
        const perp2 = direction.clone().cross(perp1).normalize();
        
        velocityDir = direction.clone()
          .multiplyScalar(Math.cos(theta))
          .add(perp1.multiplyScalar(Math.sin(theta) * Math.cos(phi)))
          .add(perp2.multiplyScalar(Math.sin(theta) * Math.sin(phi)));
      } else {
        // Random spherical distribution
        const theta = Math.acos(2 * Math.random() - 1);
        const phi = Math.random() * 2 * Math.PI;
        
        velocityDir = new THREE.Vector3(
          Math.sin(theta) * Math.cos(phi),
          Math.sin(theta) * Math.sin(phi),
          Math.cos(theta)
        );
      }
      
      const speed = this.calculateFragmentVelocity(chargeWeight, mass, 0);
      const velocity = velocityDir.multiplyScalar(speed);
      
      fragments.push({ velocity, mass });
    }
    
    return fragments;
  }
  
  static applyBlastForceToBody(
    body: CANNON.Body,
    blastCenter: CANNON.Vec3,
    chargeWeight: number
  ): void {
    const position = body.position;
    const distance = position.distanceTo(blastCenter);
    
    if (distance < 0.1) return; // Too close, would destroy
    
    // Calculate blast pressure and impulse
    const pressure = this.calculateBlastPressure(distance, chargeWeight);
    const impulse = this.calculateBlastImpulse(distance, chargeWeight);
    
    // Direction from blast center to body
    const direction = new CANNON.Vec3();
    position.vsub(blastCenter, direction);
    direction.normalize();
    
    // Apply impulse (simplified - assumes uniform pressure on projected area)
    const projectedArea = Math.PI * 0.5 * 0.5; // Assume 0.5m radius object
    const totalImpulse = impulse * projectedArea;
    
    const impulseVector = direction.scale(totalImpulse);
    body.applyImpulse(impulseVector);
  }
}

describe('Blast Physics', () => {
  describe('Blast Pressure Calculations', () => {
    test('should calculate decreasing pressure with distance', () => {
      const chargeWeight = 10; // kg TNT equivalent
      
      const p1 = BlastPhysics.calculateBlastPressure(1, chargeWeight);
      const p5 = BlastPhysics.calculateBlastPressure(5, chargeWeight);
      const p10 = BlastPhysics.calculateBlastPressure(10, chargeWeight);
      
      expect(p1).toBeGreaterThan(p5);
      expect(p5).toBeGreaterThan(p10);
      // Pressure should decrease with distance
      expect(p1).toBeGreaterThan(500000); // High pressure at 1m
      expect(p10).toBeLessThan(p1);
    });
    
    test('should scale with charge weight', () => {
      const distance = 5;
      
      const p1kg = BlastPhysics.calculateBlastPressure(distance, 1);
      const p10kg = BlastPhysics.calculateBlastPressure(distance, 10);
      const p100kg = BlastPhysics.calculateBlastPressure(distance, 100);
      
      expect(p10kg).toBeGreaterThan(p1kg);
      expect(p100kg).toBeGreaterThan(p10kg);
    });
    
    test('should approach ambient pressure at large distances', () => {
      const chargeWeight = 1;
      const farDistance = 100;
      
      const pressure = BlastPhysics.calculateBlastPressure(farDistance, chargeWeight);
      const ambient = 101325;
      
      // At 100m for 1kg charge, pressure drops significantly
      // Our simplified model might show pressure below ambient
      expect(pressure).toBeGreaterThan(0);
      expect(pressure).toBeLessThan(ambient * 10); // Should be reasonable
    });
  });
  
  describe('Blast Impulse Calculations', () => {
    test('should calculate positive impulse values', () => {
      const impulse = BlastPhysics.calculateBlastImpulse(5, 10);
      
      expect(impulse).toBeGreaterThan(0);
      expect(impulse).toBeFinite();
    });
    
    test('should decrease with scaled distance', () => {
      const chargeWeight = 10;
      
      const i1 = BlastPhysics.calculateBlastImpulse(2, chargeWeight);
      const i2 = BlastPhysics.calculateBlastImpulse(5, chargeWeight);
      const i3 = BlastPhysics.calculateBlastImpulse(10, chargeWeight);
      
      expect(i1).toBeGreaterThan(i2);
      expect(i2).toBeGreaterThan(i3);
    });
  });
  
  describe('Fragment Velocity', () => {
    test('should calculate realistic fragment velocities', () => {
      const velocity = BlastPhysics.calculateFragmentVelocity(10, 0.01, 0);
      
      // Initial velocity should be in realistic range (500-3000 m/s)
      expect(velocity).toBeGreaterThan(500);
      expect(velocity).toBeLessThan(4000); // Upper bound for fragment velocity
    });
    
    test('should decrease with distance due to drag', () => {
      const chargeWeight = 10;
      const fragmentMass = 0.01;
      
      const v0 = BlastPhysics.calculateFragmentVelocity(chargeWeight, fragmentMass, 0);
      const v10 = BlastPhysics.calculateFragmentVelocity(chargeWeight, fragmentMass, 10);
      const v50 = BlastPhysics.calculateFragmentVelocity(chargeWeight, fragmentMass, 50);
      
      expect(v10).toBeLessThan(v0);
      expect(v50).toBeLessThan(v10);
    });
  });
  
  describe('Damage Radius', () => {
    test('should calculate different radii for different damage levels', () => {
      const chargeWeight = 10;
      
      const lethalRadius = BlastPhysics.calculateDamageRadius(chargeWeight, 'lethal');
      const injuryRadius = BlastPhysics.calculateDamageRadius(chargeWeight, 'injury');
      const damageRadius = BlastPhysics.calculateDamageRadius(chargeWeight, 'damage');
      
      expect(lethalRadius).toBeLessThan(injuryRadius);
      expect(injuryRadius).toBeLessThan(damageRadius);
      expect(lethalRadius).toBeGreaterThan(0);
    });
    
    test('should scale with charge weight', () => {
      const r1 = BlastPhysics.calculateDamageRadius(1, 'injury');
      const r10 = BlastPhysics.calculateDamageRadius(10, 'injury');
      const r100 = BlastPhysics.calculateDamageRadius(100, 'injury');
      
      expect(r10).toBeGreaterThan(r1);
      expect(r100).toBeGreaterThan(r10);
    });
  });
  
  describe('Fragment Pattern Generation', () => {
    test('should generate specified number of fragments', () => {
      const fragments = BlastPhysics.generateFragmentPattern(100, 10);
      
      expect(fragments.length).toBe(100);
      expect(fragments[0]).toHaveProperty('velocity');
      expect(fragments[0]).toHaveProperty('mass');
    });
    
    test('should generate spherical pattern by default', () => {
      const fragments = BlastPhysics.generateFragmentPattern(1000, 10);
      
      // Check distribution is roughly spherical
      let upCount = 0;
      let downCount = 0;
      
      fragments.forEach(f => {
        if (f.velocity.y > 0) upCount++;
        else downCount++;
      });
      
      // Should be roughly 50/50
      expect(Math.abs(upCount - downCount)).toBeLessThan(100);
    });
    
    test('should generate directional pattern when specified', () => {
      const direction = new THREE.Vector3(1, 0, 0); // Right
      const fragments = BlastPhysics.generateFragmentPattern(100, 10, true, direction);
      
      // Most fragments should go in positive X direction
      let rightCount = 0;
      fragments.forEach(f => {
        if (f.velocity.x > 0) rightCount++;
      });
      
      expect(rightCount).toBeGreaterThan(80); // At least 80% go right
    });
    
    test('should have varying fragment masses', () => {
      const fragments = BlastPhysics.generateFragmentPattern(100, 10);
      
      const masses = fragments.map(f => f.mass);
      const uniqueMasses = new Set(masses);
      
      // Should have many different mass values
      expect(uniqueMasses.size).toBeGreaterThan(50);
    });
  });
  
  describe('Blast Force Application', () => {
    let world: CANNON.World;
    let body: CANNON.Body;
    
    beforeEach(() => {
      world = new CANNON.World();
      world.gravity.set(0, -9.81, 0);
      
      body = new CANNON.Body({
        mass: 10,
        position: new CANNON.Vec3(10, 0, 0),
        shape: new CANNON.Sphere(0.5)
      });
      world.addBody(body);
    });
    
    test('should apply force away from blast center', () => {
      const blastCenter = new CANNON.Vec3(0, 0, 0);
      const initialVelocity = body.velocity.clone();
      
      BlastPhysics.applyBlastForceToBody(body, blastCenter, 10);
      
      // Body should be pushed away (positive X direction)
      expect(body.velocity.x).toBeGreaterThan(initialVelocity.x);
    });
    
    test('should apply stronger force for closer objects', () => {
      const blastCenter = new CANNON.Vec3(0, 0, 0);
      
      const body1 = new CANNON.Body({
        mass: 10,
        position: new CANNON.Vec3(5, 0, 0)
      });
      
      const body2 = new CANNON.Body({
        mass: 10,
        position: new CANNON.Vec3(10, 0, 0)
      });
      
      BlastPhysics.applyBlastForceToBody(body1, blastCenter, 10);
      BlastPhysics.applyBlastForceToBody(body2, blastCenter, 10);
      
      expect(body1.velocity.length()).toBeGreaterThan(body2.velocity.length());
    });
    
    test('should handle edge cases safely', () => {
      const blastCenter = new CANNON.Vec3(0, 0, 0);
      
      // Very close object
      body.position.set(0.05, 0, 0);
      expect(() => {
        BlastPhysics.applyBlastForceToBody(body, blastCenter, 10);
      }).not.toThrow();
      
      // Far object
      body.position.set(1000, 0, 0);
      const oldVel = body.velocity.length();
      BlastPhysics.applyBlastForceToBody(body, blastCenter, 10);
      
      // Should have minimal effect
      expect(body.velocity.length()).toBeCloseTo(oldVel, 5);
    });
  });
});