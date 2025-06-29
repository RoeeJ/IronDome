// Test script to verify sounds are working
import { SoundSystem } from './systems/SoundSystem';
import * as THREE from 'three';

// Initialize sound system
const soundSystem = SoundSystem.getInstance();

// Test function to play sounds
export function testSounds() {
  console.log('Testing Iron Dome sounds...');

  // Test launch sound
  console.log('Playing interceptor launch sound...');
  soundSystem.playLaunch(new THREE.Vector3(0, 0, 0));

  setTimeout(() => {
    console.log('Playing rocket launch sound...');
    soundSystem.playThreatLaunch('rocket', new THREE.Vector3(10, 0, 10));
  }, 2000);

  setTimeout(() => {
    console.log('Playing explosion sound...');
    soundSystem.playExplosion('air', new THREE.Vector3(0, 20, 0));
  }, 4000);

  setTimeout(() => {
    console.log('Playing mortar launch sound...');
    soundSystem.playThreatLaunch('mortar', new THREE.Vector3(-10, 0, -10));
  }, 6000);

  setTimeout(() => {
    console.log('Playing ground impact explosion...');
    soundSystem.playExplosion('ground', new THREE.Vector3(0, 0, 0));
  }, 8000);
}

// Add test button to window
if (typeof window !== 'undefined') {
  (window as any).testSounds = testSounds;

  // Create a test button
  const button = document.createElement('button');
  button.textContent = 'Test Sounds';
  button.style.position = 'fixed';
  button.style.top = '10px';
  button.style.right = '10px';
  button.style.zIndex = '10000';
  button.style.padding = '10px 20px';
  button.style.backgroundColor = '#00ffff';
  button.style.color = '#000';
  button.style.border = 'none';
  button.style.borderRadius = '4px';
  button.style.cursor = 'pointer';
  button.style.fontWeight = 'bold';

  button.addEventListener('click', testSounds);

  // Add button when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      document.body.appendChild(button);
    });
  } else {
    document.body.appendChild(button);
  }
}
