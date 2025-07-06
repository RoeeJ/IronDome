import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { LaserBattery } from '../entities/LaserBattery';
import { Threat, ThreatType } from '../entities/Threat';

/**
 * Example demonstrating how to use the LaserBattery in the game
 */
export function createLaserBatteryDemo(scene: THREE.Scene, world: CANNON.World) {
  // Create a laser battery at position (50, 0, 50)
  const laserBattery = new LaserBattery(scene, world, new THREE.Vector3(50, 0, 50));

  // Configure the laser battery
  laserBattery.setMaxRange(150); // 150 meters range
  laserBattery.setDamagePerSecond(75); // 75 damage per second
  laserBattery.setResourceManagement(false); // Unlimited energy for demo

  // Create some test threats
  const threats: Threat[] = [];

  // Create a slow-moving drone threat
  const droneThreat = new Threat(scene, world, {
    position: new THREE.Vector3(100, 50, 100),
    velocity: new THREE.Vector3(-50, -50, -50),
    targetPosition: new THREE.Vector3(0, 0, 0),
    type: ThreatType.DRONE_SLOW,
  });
  threats.push(droneThreat);

  // Create a rocket threat
  const rocketThreat = new Threat(scene, world, {
    position: new THREE.Vector3(-100, 20, -100),
    velocity: new THREE.Vector3(100, 100, 100),
    targetPosition: new THREE.Vector3(50, 0, 50), // Target position (near the laser battery)
    type: ThreatType.MEDIUM_RANGE,
  });
  threats.push(rocketThreat);

  // Update function to be called in the game loop
  function updateLaserDefense(deltaTime: number) {
    // Update the laser battery with current threats
    laserBattery.update(deltaTime, threats);

    // Remove destroyed threats from the array
    for (let i = threats.length - 1; i >= 0; i--) {
      if (!threats[i].isActive) {
        threats.splice(i, 1);
      }
    }
  }

  // Integration with existing game systems:
  // 1. Add the laser battery to the BatteryCoordinator (requires modification to accept IBattery)
  // 2. Add UI controls to select between IronDomeBattery and LaserBattery
  // 3. Update the DomePlacementSystem to support different battery types

  return {
    laserBattery,
    threats,
    updateLaserDefense,
  };
}

// Example of how to integrate with the main game loop:
/*
// In main.ts or similar:
const laserDemo = createLaserBatteryDemo(scene, world);

// In the animation loop:
function animate() {
  const deltaTime = clock.getDelta();
  
  // Update laser defense
  laserDemo.updateLaserDefense(deltaTime);
  
  // ... rest of the game update logic
}
*/
