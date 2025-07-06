// Test file to verify laser battery rendering with the new instanced renderer
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { LaserBattery } from '../entities/LaserBattery';
import { IronDomeBattery } from '../entities/IronDomeBattery';
import { InstancedBatteryRenderer } from '../rendering/InstancedBatteryRenderer';
import { BatteryType } from '../config/BatteryTypes';
import { IBattery } from '../entities/IBattery';

// Create a simple test scene
async function testLaserBatteryRendering() {
  const scene = new THREE.Scene();
  const world = new CANNON.World();
  
  // Create instanced renderer
  const instancedRenderer = new InstancedBatteryRenderer(scene, 10);
  
  // Wait for models to load
  await instancedRenderer.waitForLoad();
  
  // Create test batteries
  const batteries = new Map<string, { battery: IBattery; level: number; type: BatteryType }>();
  
  // Add an Iron Dome battery
  const ironDome = new IronDomeBattery(scene, world, new THREE.Vector3(-50, 0, 0));
  batteries.set('ironDome1', {
    battery: ironDome,
    level: 1,
    type: BatteryType.IRON_DOME
  });
  
  // Add a Laser Cannon battery
  const laserCannon = new LaserBattery(scene, world, new THREE.Vector3(50, 0, 0));
  batteries.set('laser1', {
    battery: laserCannon,
    level: 1,
    type: BatteryType.LASER
  });
  
  // Hide individual models since we're using instanced rendering
  ironDome.setVisualVisibility(false);
  laserCannon.setVisualVisibility(false);
  
  // Update the instanced renderer
  instancedRenderer.updateBatteries(batteries);
  
  console.log('Test complete: Both battery types should be rendered via instancing');
  console.log('Iron Dome at (-50, 0, 0)');
  console.log('Laser Cannon at (50, 0, 0)');
}

// Run the test
testLaserBatteryRendering().catch(console.error);