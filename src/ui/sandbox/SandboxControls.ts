import GUI from 'lil-gui';
import * as THREE from 'three';
import { ThreatManager } from '../../scene/ThreatManager';
import { DomePlacementSystem } from '../../game/DomePlacementSystem';
import { CameraController, CameraMode } from '../../camera/CameraController';
import { WorldScaleIndicators } from '../../world/WorldScaleIndicators';
import { SoundSystem } from '../../systems/SoundSystem';
import {
  AttackIntensity,
  AttackPattern,
  SCENARIO_PRESETS,
} from '../../game/scenarios/AttackScenarios';

export interface SandboxControlsConfig {
  threatManager: ThreatManager;
  domePlacementSystem: DomePlacementSystem;
  cameraController: CameraController;
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
        // Ensure at least one launcher site is active
        const activeSites = this.config.threatManager.getLauncherSystem().getActiveSites();
        if (activeSites.length === 0) {
          // Activate north by default for quick action
          this.config.threatManager.activateLauncherDirection('north');
          this.config.showNotification('Activating North launchers for attack...');
        }

        // Start spawning if not already
        if (!this.config.threatManager.isSpawning) {
          this.config.threatManager.startSpawning();
        }

        // Fire a quick volley
        this.config.threatManager.spawnSalvo(5, 'mixed');
        this.config.showNotification('Incoming attack! 5 threats launched');
      },

      clearSkies: () => {
        this.config.threatManager.clearAll();
        this.config.showNotification('All threats cleared');
      },

      addDefender: () => {
        // Try up to 10 times to find valid position
        for (let attempts = 0; attempts < 10; attempts++) {
          const angle = Math.random() * Math.PI * 2;
          const distance = 50 + Math.random() * 100;
          const position = new THREE.Vector3(
            Math.cos(angle) * distance,
            0,
            Math.sin(angle) * distance
          );

          if (this.config.domePlacementSystem.isPositionValid(position)) {
            this.config.domePlacementSystem.placeBatteryAt(position, `battery_${Date.now()}`, 1);
            this.config.showNotification('New defender added');
            return; // Success, exit
          }
        }
        // All attempts failed
        this.config.showNotification('Could not find valid position for defender');
      },
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
      },
    };

    const customFolder = this.scenariosFolder.addFolder('Custom Attack');

    customFolder
      .add(manualControls, 'intensity', {
        'Light (1-2 threats)': AttackIntensity.LIGHT,
        'Moderate (3-5 threats)': AttackIntensity.MODERATE,
        'Heavy (5-10 threats)': AttackIntensity.HEAVY,
        'Extreme (continuous)': AttackIntensity.EXTREME,
      })
      .name('Intensity');

    customFolder
      .add(manualControls, 'pattern', {
        Spread: AttackPattern.SPREAD,
        Focused: AttackPattern.FOCUSED,
        Waves: AttackPattern.WAVES,
        Surround: AttackPattern.SURROUND,
      })
      .name('Pattern');

    // Launcher direction controls - start with north active by default
    const launcherControls = {
      north: true,
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

        // If no directions selected, show warning
        if (
          !launcherControls.north &&
          !launcherControls.south &&
          !launcherControls.east &&
          !launcherControls.west
        ) {
          this.config.showNotification(
            '⚠️ No launcher sites active! Enable at least one direction.'
          );
        }
      },
    };

    // Initialize with north active
    launcherControls.updateLaunchers();

    const launcherFolder = customFolder.addFolder('Launcher Sites');

    launcherFolder
      .add(launcherControls, 'attackPattern', {
        Concentrated: 'concentrated',
        Distributed: 'distributed',
        Sequential: 'sequential',
        Random: 'random',
      })
      .name('Attack Mode')
      .onChange((value: string) => {
        this.config.threatManager.setLauncherAttackPattern(value as any);
      });

    launcherFolder
      .add(launcherControls, 'north')
      .name('🔴 North')
      .onChange(() => launcherControls.updateLaunchers());
    launcherFolder
      .add(launcherControls, 'south')
      .name('🔴 South')
      .onChange(() => launcherControls.updateLaunchers());
    launcherFolder
      .add(launcherControls, 'east')
      .name('🔴 East')
      .onChange(() => launcherControls.updateLaunchers());
    launcherFolder
      .add(launcherControls, 'west')
      .name('🔴 West')
      .onChange(() => launcherControls.updateLaunchers());

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
    this.scenariosFolder
      .add(
        {
          stop: () => this.stopScenario(),
        },
        'stop'
      )
      .name('⏹️ Stop All Attacks');
  }

  private setupTimeControls(): void {
    this.timeFolder = this.gui.addFolder('⏰ Time & Lighting');

    const optimizedDayNight = (window as any).__optimizedDayNight;
    if (!optimizedDayNight) return;

    const timeControls = {
      currentTime: optimizedDayNight.getTime().hours,
      timeSpeed: 1,

      setMorning: () => {
        optimizedDayNight.setTime(8);
        timeControls.currentTime = 8;
        // Force building system update
        const buildingSystem = (window as any).__buildingSystem;
        if (buildingSystem) buildingSystem.updateTimeOfDay(8, true);
        const environmentSystem = (window as any).__environmentSystem;
        if (environmentSystem) environmentSystem.setTimeOfDay(8);
        this.config.showNotification('🌅 Morning - 8:00 AM');
      },

      setNoon: () => {
        optimizedDayNight.setTime(12);
        timeControls.currentTime = 12;
        const buildingSystem = (window as any).__buildingSystem;
        if (buildingSystem) buildingSystem.updateTimeOfDay(12, true);
        const environmentSystem = (window as any).__environmentSystem;
        if (environmentSystem) environmentSystem.setTimeOfDay(12);
        this.config.showNotification('☀️ Noon - 12:00 PM');
      },

      setEvening: () => {
        optimizedDayNight.setTime(18);
        timeControls.currentTime = 18;
        const buildingSystem = (window as any).__buildingSystem;
        if (buildingSystem) buildingSystem.updateTimeOfDay(18, true);
        const environmentSystem = (window as any).__environmentSystem;
        if (environmentSystem) environmentSystem.setTimeOfDay(18);
        this.config.showNotification('🌆 Evening - 6:00 PM');
      },

      setNight: () => {
        optimizedDayNight.setTime(22);
        timeControls.currentTime = 22;
        const buildingSystem = (window as any).__buildingSystem;
        if (buildingSystem) buildingSystem.updateTimeOfDay(22, true);
        const environmentSystem = (window as any).__environmentSystem;
        if (environmentSystem) environmentSystem.setTimeOfDay(22);
        this.config.showNotification('🌙 Night - 10:00 PM');
      },
    };

    // Time of day slider with force update
    this.timeFolder
      .add(timeControls, 'currentTime', 0, 24, 0.5)
      .name('Time of Day')
      .onChange((value: number) => {
        optimizedDayNight.setTime(value);
        // Force building system update on manual slider change
        const buildingSystem = (window as any).__buildingSystem;
        if (buildingSystem) buildingSystem.updateTimeOfDay(value, true);
        const environmentSystem = (window as any).__environmentSystem;
        if (environmentSystem) environmentSystem.setTimeOfDay(value);
      });

    // Quick time buttons
    this.timeFolder.add(timeControls, 'setMorning').name('🌅 Morning');
    this.timeFolder.add(timeControls, 'setNoon').name('☀️ Noon');
    this.timeFolder.add(timeControls, 'setEvening').name('🌆 Evening');
    this.timeFolder.add(timeControls, 'setNight').name('🌙 Night');

    // Time speed control
    this.timeFolder
      .add(timeControls, 'timeSpeed', 0, 10, 0.5)
      .name('Time Speed')
      .onChange((value: number) => {
        optimizedDayNight.setTimeSpeed(value);
      });
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
      },
    };

    // Camera mode toggle
    this.viewFolder
      .add(
        {
          toggle: () => {
            if (viewControls.cameraMode === 'orbit') {
              viewControls.followAction();
            } else {
              viewControls.orbitMode();
            }
          },
        },
        'toggle'
      )
      .name('📷 Toggle Camera (Orbit/Follow)');

    // Visual toggles
    this.viewFolder
      .add(viewControls, 'showGrid')
      .name('📏 Ground Grid')
      .onChange(() => this.updateVisuals(viewControls));

    this.viewFolder
      .add(viewControls, 'showWind')
      .name('💨 Wind Effects')
      .onChange(() => this.updateVisuals(viewControls));

    this.viewFolder
      .add(viewControls, 'showBuildings')
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
      },
    };

    this.audioFolder
      .add(audioControls, 'toggleMute')
      .name(audioControls.muted ? '🔇 Unmute' : '🔊 Mute');

    this.audioFolder
      .add(audioControls, 'masterVolume', 0, 1, 0.1)
      .name('Volume')
      .onChange((value: number) => {
        soundSystem.setMasterVolume(value);
      });
  }

  private updateVisuals(controls: any): void {
    this.config.worldScaleIndicators.updateVisibility({
      showGrid: controls.showGrid,
      showWindParticles: false, // Keep disabled for performance
      showReferenceObjects: controls.showBuildings,
      showDistanceMarkers: false,
      showAltitudeMarkers: false,
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
    // Update time display every 5 seconds (matches optimized system interval)
    this.timeUpdateInterval = window.setInterval(() => {
      const optimizedDayNight = (window as any).__optimizedDayNight;
      if (optimizedDayNight && this.timeFolder) {
        // Update folder title with current time
        const currentTime = optimizedDayNight.formatTime();
        this.timeFolder.title(`⏰ Time & Lighting (${currentTime})`);
      }
    }, 5000);
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
