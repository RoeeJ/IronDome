import GUI from 'lil-gui';
import * as THREE from 'three';
import { ThreatManager } from '../../scene/ThreatManager';
import { DomePlacementSystem } from '../../game/DomePlacementSystem';
import { CameraController, CameraMode } from '../../camera/CameraController';
import { DayNightCycle } from '../../world/DayNightCycle';
import { WorldScaleIndicators } from '../../world/WorldScaleIndicators';
import { SoundSystem } from '../../systems/SoundSystem';
import { 
  AttackIntensity, 
  AttackPattern, 
  SCENARIO_PRESETS 
} from '../../game/scenarios/AttackScenarios';

export interface SandboxControlsConfig {
  threatManager: ThreatManager;
  domePlacementSystem: DomePlacementSystem;
  cameraController: CameraController;
  dayNightCycle: DayNightCycle;
  worldScaleIndicators: WorldScaleIndicators;
  projectiles: any[];
  simulationControls: any;
  showNotification: (message: string, type?: string) => void;
}

/**
 * Player-friendly sandbox controls
 * Focuses on fun and experimentation rather than technical debugging
 */
export class SandboxControls {
  private gui: GUI;
  private config: SandboxControlsConfig;
  private quickActionsFolder!: GUI;
  private scenariosFolder!: GUI;
  private timeFolder!: GUI;
  private viewFolder!: GUI;
  private audioFolder!: GUI;
  
  // State
  private activeScenarioId: string | null = null;
  private timeUpdateInterval: number | null = null;
  
  constructor(gui: GUI, config: SandboxControlsConfig) {
    this.gui = gui;
    this.config = config;
    
    this.setupControls();
    this.startTimeUpdates();
  }
  
  private setupControls(): void {
    // Clear any existing controls
    while (this.gui.children.length > 0) {
      this.gui.children[0].destroy();
    }
    
    // 1. Quick Actions (always open)
    this.setupQuickActions();
    
    // 2. Create Scenarios
    this.setupScenarios();
    
    // 3. Time & Weather
    this.setupTimeControls();
    
    // 4. View Options
    this.setupViewControls();
    
    // 5. Audio
    this.setupAudioControls();
  }
  
  private setupQuickActions(): void {
    this.quickActionsFolder = this.gui.addFolder('⚡ Quick Actions');
    
    const actions = {
      launchAttack: () => {
        this.config.threatManager.spawnSalvo(10, 'mixed');
        this.config.showNotification('Incoming attack! 10 threats launched');
      },
      
      clearSkies: () => {
        this.config.threatManager.clearAll();
        this.config.showNotification('All threats cleared');
      },
      
      addDefender: () => {
        const angle = Math.random() * Math.PI * 2;
        const distance = 50 + Math.random() * 100;
        const position = new THREE.Vector3(
          Math.cos(angle) * distance,
          0,
          Math.sin(angle) * distance
        );
        
        if (this.config.domePlacementSystem.isPositionValid(position)) {
          this.config.domePlacementSystem.placeBatteryAt(
            position, 
            `battery_${Date.now()}`, 
            1
          );
          this.config.showNotification('New defender added');
        } else {
          // Try again with different position
          actions.addDefender();
        }
      }
    };
    
    this.quickActionsFolder.add(actions, 'launchAttack').name('🚀 Launch Attack');
    this.quickActionsFolder.add(actions, 'clearSkies').name('🧹 Clear Skies');
    this.quickActionsFolder.add(actions, 'addDefender').name('🛡️ Add Defender');
    
    this.quickActionsFolder.open();
  }
  
  private setupScenarios(): void {
    this.scenariosFolder = this.gui.addFolder('⚔️ Attack Scenarios');
    
    // Manual controls
    const manualControls = {
      intensity: AttackIntensity.MODERATE,
      pattern: AttackPattern.SPREAD,
      active: false,
      
      start: () => {
        if (manualControls.active) {
          this.stopScenario();
        }
        
        this.config.threatManager.setAttackIntensity(manualControls.intensity);
        this.config.threatManager.setAttackPattern(manualControls.pattern);
        this.config.threatManager.startSpawning();
        manualControls.active = true;
        this.activeScenarioId = 'manual';
        this.config.showNotification('Custom attack started');
      },
      
      stop: () => {
        this.stopScenario();
      }
    };
    
    const customFolder = this.scenariosFolder.addFolder('Custom Attack');
    
    customFolder.add(manualControls, 'intensity', {
      'Light (1-2 threats)': AttackIntensity.LIGHT,
      'Moderate (3-5 threats)': AttackIntensity.MODERATE,
      'Heavy (5-10 threats)': AttackIntensity.HEAVY,
      'Extreme (continuous)': AttackIntensity.EXTREME
    }).name('Intensity');
    
    customFolder.add(manualControls, 'pattern', {
      'Spread': AttackPattern.SPREAD,
      'Focused': AttackPattern.FOCUSED,
      'Waves': AttackPattern.WAVES,
      'Surround': AttackPattern.SURROUND
    }).name('Pattern');
    
    // Launcher direction controls
    const launcherControls = {
      north: false,
      south: false,
      east: false,
      west: false,
      attackPattern: 'distributed',
      
      updateLaunchers: () => {
        // Deactivate all first
        this.config.threatManager.deactivateLauncherDirection('north');
        this.config.threatManager.deactivateLauncherDirection('south');
        this.config.threatManager.deactivateLauncherDirection('east');
        this.config.threatManager.deactivateLauncherDirection('west');
        
        // Activate selected directions
        if (launcherControls.north) this.config.threatManager.activateLauncherDirection('north');
        if (launcherControls.south) this.config.threatManager.activateLauncherDirection('south');
        if (launcherControls.east) this.config.threatManager.activateLauncherDirection('east');
        if (launcherControls.west) this.config.threatManager.activateLauncherDirection('west');
      }
    };
    
    const launcherFolder = customFolder.addFolder('Launcher Sites');
    
    launcherFolder.add(launcherControls, 'attackPattern', {
      'Concentrated': 'concentrated',
      'Distributed': 'distributed',
      'Sequential': 'sequential',
      'Random': 'random'
    }).name('Attack Mode').onChange((value: string) => {
      this.config.threatManager.setLauncherAttackPattern(value as any);
    });
    
    launcherFolder.add(launcherControls, 'north').name('🔴 North').onChange(() => launcherControls.updateLaunchers());
    launcherFolder.add(launcherControls, 'south').name('🔴 South').onChange(() => launcherControls.updateLaunchers());
    launcherFolder.add(launcherControls, 'east').name('🔴 East').onChange(() => launcherControls.updateLaunchers());
    launcherFolder.add(launcherControls, 'west').name('🔴 West').onChange(() => launcherControls.updateLaunchers());
    
    customFolder.add(manualControls, 'start').name('▶️ Start Attack');
    customFolder.add(manualControls, 'stop').name('⏹️ Stop Attack');
    
    // Preset scenarios
    const presetsFolder = this.scenariosFolder.addFolder('Preset Scenarios');
    
    Object.values(SCENARIO_PRESETS).forEach(preset => {
      const action = () => {
        if (this.activeScenarioId) {
          this.stopScenario();
        }
        
        this.config.threatManager.startScenario(preset);
        this.activeScenarioId = preset.id;
        this.config.showNotification(`${preset.icon} ${preset.name} started!`);
      };
      
      presetsFolder.add({ action }, 'action').name(`${preset.icon} ${preset.name}`);
    });
    
    // Stop button
    this.scenariosFolder.add({
      stop: () => this.stopScenario()
    }, 'stop').name('⏹️ Stop All Attacks');
  }
  
  private setupTimeControls(): void {
    this.timeFolder = this.gui.addFolder('🌅 Time & Weather');
    
    const timeControls = {
      currentTime: '',
      speed: 1,
      
      // Preset times
      dawn: () => {
        this.config.dayNightCycle.setDawn();
        this.config.showNotification('Time set to dawn');
      },
      
      day: () => {
        this.config.dayNightCycle.setNoon();
        this.config.showNotification('Time set to noon');
      },
      
      dusk: () => {
        this.config.dayNightCycle.setDusk();
        this.config.showNotification('Time set to dusk');
      },
      
      night: () => {
        this.config.dayNightCycle.setMidnight();
        this.config.showNotification('Time set to midnight');
      }
    };
    
    // Time display (read-only)
    const timeDisplay = this.timeFolder.add(timeControls, 'currentTime')
      .name('⏰ Current Time')
      .disable()
      .listen();
    
    // Speed control with preset buttons
    const speedFolder = this.timeFolder.addFolder('Time Speed');
    speedFolder.add({
      normal: () => {
        this.config.dayNightCycle.setTimeSpeed(1);
        timeControls.speed = 1;
      }
    }, 'normal').name('1x Normal');
    
    speedFolder.add({
      fast: () => {
        this.config.dayNightCycle.setTimeSpeed(10);
        timeControls.speed = 10;
      }
    }, 'fast').name('10x Fast');
    
    speedFolder.add({
      veryFast: () => {
        this.config.dayNightCycle.setTimeSpeed(30);
        timeControls.speed = 30;
      }
    }, 'veryFast').name('30x Very Fast');
    
    // Time presets in a row
    const presetsFolder = this.timeFolder.addFolder('Quick Time');
    presetsFolder.add(timeControls, 'dawn').name('🌅 Dawn');
    presetsFolder.add(timeControls, 'day').name('☀️ Day');
    presetsFolder.add(timeControls, 'dusk').name('🌇 Dusk');
    presetsFolder.add(timeControls, 'night').name('🌙 Night');
    
    // Store controls for updates
    (this.timeFolder as any).controls = timeControls;
  }
  
  private setupViewControls(): void {
    this.viewFolder = this.gui.addFolder('👁️ View Options');
    
    const viewControls = {
      cameraMode: 'orbit',
      showGrid: true,
      showWind: true,
      showBuildings: true,
      
      followAction: () => {
        const threats = this.config.threatManager.getActiveThreats();
        if (threats.length > 0) {
          this.config.cameraController.setMode(CameraMode.FOLLOW_THREAT, threats[0]);
          viewControls.cameraMode = 'follow';
          this.config.showNotification('Following threat');
        } else {
          this.config.showNotification('No active threats to follow');
        }
      },
      
      orbitMode: () => {
        this.config.cameraController.setMode(CameraMode.ORBIT);
        viewControls.cameraMode = 'orbit';
      }
    };
    
    // Camera mode toggle
    this.viewFolder.add({
      toggle: () => {
        if (viewControls.cameraMode === 'orbit') {
          viewControls.followAction();
        } else {
          viewControls.orbitMode();
        }
      }
    }, 'toggle').name('📷 Toggle Camera (Orbit/Follow)');
    
    // Visual toggles
    this.viewFolder.add(viewControls, 'showGrid')
      .name('📏 Ground Grid')
      .onChange(() => this.updateVisuals(viewControls));
    
    this.viewFolder.add(viewControls, 'showWind')
      .name('💨 Wind Effects')
      .onChange(() => this.updateVisuals(viewControls));
    
    this.viewFolder.add(viewControls, 'showBuildings')
      .name('🏢 Buildings')
      .onChange(() => this.updateVisuals(viewControls));
  }
  
  private setupAudioControls(): void {
    this.audioFolder = this.gui.addFolder('🔊 Audio');
    
    const soundSystem = SoundSystem.getInstance();
    const audioControls = {
      masterVolume: soundSystem.getMasterVolume(),
      muted: !soundSystem.isEnabled(),
      
      toggleMute: () => {
        audioControls.muted = !audioControls.muted;
        soundSystem.setEnabled(!audioControls.muted);
        this.config.showNotification(audioControls.muted ? '🔇 Muted' : '🔊 Unmuted');
      }
    };
    
    this.audioFolder.add(audioControls, 'toggleMute')
      .name(audioControls.muted ? '🔇 Unmute' : '🔊 Mute');
    
    this.audioFolder.add(audioControls, 'masterVolume', 0, 1, 0.1)
      .name('Volume')
      .onChange((value: number) => {
        soundSystem.setMasterVolume(value);
      });
  }
  
  private updateVisuals(controls: any): void {
    this.config.worldScaleIndicators.updateVisibility({
      showGrid: controls.showGrid,
      showWindParticles: controls.showWind,
      showReferenceObjects: controls.showBuildings,
      showDistanceMarkers: false,
      showAltitudeMarkers: false
    });
  }
  
  private stopScenario(): void {
    if (this.activeScenarioId) {
      this.config.threatManager.stopScenario();
      this.config.threatManager.stopSpawning();
      this.activeScenarioId = null;
      this.config.showNotification('Attack stopped');
    }
  }
  
  private startTimeUpdates(): void {
    const updateTime = () => {
      const timeFolder = this.timeFolder as any;
      if (timeFolder.controls) {
        timeFolder.controls.currentTime = this.config.dayNightCycle.formatTime();
      }
    };
    
    // Update immediately
    updateTime();
    
    // Update every second
    this.timeUpdateInterval = window.setInterval(updateTime, 1000);
  }
  
  destroy(): void {
    if (this.timeUpdateInterval) {
      clearInterval(this.timeUpdateInterval);
    }
    
    // Clean up GUI
    while (this.gui.children.length > 0) {
      this.gui.children[0].destroy();
    }
  }
}