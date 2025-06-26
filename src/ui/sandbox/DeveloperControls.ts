import GUI from 'lil-gui';
import { ThreatManager } from '../../scene/ThreatManager';
import { ExplosionManager } from '../../systems/ExplosionManager';
import { debug } from '../../utils/logger';

export interface DeveloperControlsConfig {
  threatManager: ThreatManager;
  simulationControls: any;
  showNotification: (message: string, type?: string) => void;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
}

/**
 * Hidden developer controls for debugging and performance testing
 * Activated with Ctrl+Shift+D
 */
export class DeveloperControls {
  private gui: GUI;
  private config: DeveloperControlsConfig;
  private visible: boolean = false;
  
  constructor(config: DeveloperControlsConfig) {
    this.config = config;
    
    // Create hidden GUI
    this.gui = new GUI({ title: '🔧 Developer Tools' });
    this.gui.domElement.style.position = 'fixed';
    this.gui.domElement.style.top = '10px';
    this.gui.domElement.style.right = '10px';
    this.gui.hide();
    
    this.setupControls();
    this.setupKeyboardShortcuts();
  }
  
  private setupControls(): void {
    // Performance Testing
    const perfFolder = this.gui.addFolder('⚡ Performance Testing');
    
    perfFolder.add({
      stressTest: () => {
        // Spawn 50 threats rapidly
        for (let i = 0; i < 50; i++) {
          setTimeout(() => {
            this.config.threatManager.spawnSpecificThreat(
              ['rocket', 'mortar'][i % 2]
            );
          }, i * 100);
        }
        this.config.showNotification('Stress test: 50 threats incoming!');
      }
    }, 'stressTest').name('Stress Test (50 threats)');
    
    perfFolder.add({
      explosionTest: () => {
        const explosionManager = ExplosionManager.getInstance(this.config.scene);
        // Create 25 explosions in a grid
        for (let x = -100; x <= 100; x += 50) {
          for (let z = -100; z <= 100; z += 50) {
            explosionManager.createExplosion({
              type: 'ground_impact' as any,
              position: new THREE.Vector3(x, 0, z),
              radius: 15
            });
          }
        }
        this.config.showNotification('25 explosions created');
      }
    }, 'explosionTest').name('Explosion Test (25)');
    
    // Debug Info
    const debugFolder = this.gui.addFolder('🔍 Debug Info');
    
    debugFolder.add({
      logStats: () => {
        const stats = {
          threats: this.config.threatManager.getActiveThreats().length,
          craters: this.config.threatManager.getCraterStats().count,
          drawCalls: this.config.renderer.info.render.calls,
          triangles: this.config.renderer.info.render.triangles,
          geometries: this.config.renderer.info.memory.geometries,
          textures: this.config.renderer.info.memory.textures
        };
        debug.log('=== DEBUG STATS ===');
        debug.log('Stats:', stats);
        this.config.showNotification('Stats logged to console');
      }
    }, 'logStats').name('Log Stats to Console');
    
    debugFolder.add({
      logThreatInfo: () => {
        const threats = this.config.threatManager.getActiveThreats();
        debug.log('=== ACTIVE THREATS ===');
        threats.forEach((threat, i) => {
          debug.log(`Threat ${i}: Type=${threat.type}, Active=${threat.isActive}, ` +
            `Position=(${threat.getPosition().x.toFixed(1)}, ${threat.getPosition().y.toFixed(1)}, ${threat.getPosition().z.toFixed(1)})`);
        });
      }
    }, 'logThreatInfo').name('Log Threat Info');
    
    // Cleanup
    const cleanupFolder = this.gui.addFolder('🧹 Cleanup');
    
    cleanupFolder.add({
      cleanupEffects: () => {
        const launchEffects = this.config.threatManager.getLaunchEffectsSystem();
        launchEffects.cleanup(true);
        this.config.showNotification('Ground effects cleaned');
      }
    }, 'cleanupEffects').name('Force Cleanup Ground Effects');
    
    cleanupFolder.add({
      resetScene: () => {
        this.config.threatManager.clearAll();
        // Additional cleanup could go here
        this.config.showNotification('Scene reset');
      }
    }, 'resetScene').name('Reset Scene');
    
    // Individual Threat Spawning
    const spawnFolder = this.gui.addFolder('🚀 Spawn Individual Threats');
    
    const threatTypes = [
      'rocket', 'mortar', 'drone', 'ballistic',
      'qassam1', 'qassam2', 'qassam3', 'grad'
    ];
    
    threatTypes.forEach(type => {
      spawnFolder.add({
        spawn: () => {
          this.config.threatManager.spawnSpecificThreat(type);
          this.config.showNotification(`Spawned ${type}`);
        }
      }, 'spawn').name(`Spawn ${type}`);
    });
    
    // Time controls
    const timeFolder = this.gui.addFolder('⏱️ Time Control');
    
    timeFolder.add(this.config.simulationControls, 'timeScale', 0.1, 5, 0.1)
      .name('Time Scale');
    
    timeFolder.add(this.config.simulationControls, 'pause')
      .name('Pause Simulation');
  }
  
  private setupKeyboardShortcuts(): void {
    window.addEventListener('keydown', (e) => {
      // Ctrl+Shift+D to toggle developer panel
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        this.toggle();
      }
      
      // Ctrl+Shift+P for performance overlay (already exists)
      // Ctrl+Shift+S for screenshot mode
      if (e.ctrlKey && e.shiftKey && e.key === 'S') {
        this.toggleScreenshotMode();
      }
    });
  }
  
  private toggle(): void {
    this.visible = !this.visible;
    if (this.visible) {
      this.gui.show();
      this.config.showNotification('Developer mode activated');
    } else {
      this.gui.hide();
    }
  }
  
  private toggleScreenshotMode(): void {
    // Hide all UI elements for clean screenshots
    const gameUI = document.getElementById('game-ui-root');
    const debugPanel = document.querySelector('.lil-gui');
    
    if (gameUI) {
      gameUI.style.display = gameUI.style.display === 'none' ? '' : 'none';
    }
    
    if (debugPanel && debugPanel !== this.gui.domElement) {
      (debugPanel as HTMLElement).style.display = 
        (debugPanel as HTMLElement).style.display === 'none' ? '' : 'none';
    }
    
    this.config.showNotification(
      gameUI?.style.display === 'none' ? 
      '📸 Screenshot mode ON' : 
      'Screenshot mode OFF'
    );
  }
  
  destroy(): void {
    this.gui.destroy();
  }
}