import * as THREE from 'three';
import { debug } from '../utils/logger';

interface SoundOptions {
  volume?: number;
  loop?: boolean;
  playbackRate?: number;
  fadeIn?: number;
  fadeOut?: number;
  spatialized?: boolean;
  position?: { x: number; y: number; z: number };
  maxDistance?: number;
  refDistance?: number;
  pitchVariation?: number;
}

interface SoundInstance {
  id: string;
  audio: THREE.Audio | THREE.PositionalAudio;
  startTime: number;
  fadeIn?: number;
  fadeOut?: number;
  fadeStartTime?: number;
  isFading?: boolean;
  originalVolume: number;
  category?: string;
}

export class SoundSystem {
  private static instance: SoundSystem | null = null;
  private listener: THREE.AudioListener;
  private audioLoader: THREE.AudioLoader;
  private sounds: Map<string, AudioBuffer> = new Map();
  private activeSounds: Map<string, SoundInstance> = new Map();
  private audioPool: Map<string, (THREE.Audio | THREE.PositionalAudio)[]> = new Map();
  private enabled: boolean = true;
  private masterVolume: number = 0.7;
  private categoryVolumes: Map<string, number> = new Map();
  private maxActiveSounds: number = 500; // Increased for high-rate launches
  private bgmInstance: SoundInstance | null = null;
  private sfxEnabled: boolean = true;
  private bgmEnabled: boolean = true;
  private sfxVolume: number = 1.0;
  private bgmVolume: number = 0.5;
  private audioContextResumed = false;

  private constructor() {
    // Initialize Three.js audio
    this.listener = new THREE.AudioListener();
    this.audioLoader = new THREE.AudioLoader();

    // Initialize category volumes
    this.categoryVolumes.set('launch', 0.8);
    this.categoryVolumes.set('explosion', 0.9);
    this.categoryVolumes.set('alert', 0.7);
    this.categoryVolumes.set('ambient', 0.5);
    this.categoryVolumes.set('ui', 0.6);
    this.categoryVolumes.set('bgm', 1.0);

    // Load saved preferences
    this.loadPreferences();

    this.loadSounds();

    // Load saved preferences
    const savedEnabled = localStorage.getItem('ironDome_soundEnabled');
    const savedVolume = localStorage.getItem('ironDome_masterVolume');

    if (savedEnabled !== null) {
      this.enabled = savedEnabled === 'true';
    }

    if (savedVolume !== null) {
      this.masterVolume = parseFloat(savedVolume);
      this.listener.setMasterVolume(this.masterVolume);
    }
  }

  static getInstance(): SoundSystem {
    if (!SoundSystem.instance) {
      SoundSystem.instance = new SoundSystem();
    }
    return SoundSystem.instance;
  }

  // Get the audio listener to attach to camera
  getListener(): THREE.AudioListener {
    return this.listener;
  }

  private loadSounds() {
    // Define sound files to preload
    const soundFiles = {
      // Launch sounds
      interceptor_launch: 'assets/sounds/normalized/launch/firing.mp3',
      interceptor_launch_alt: 'assets/sounds/normalized/launch/launch2.mp3',
      rocket_launch: 'assets/sounds/normalized/launch/grad.mp3',
      mortar_launch: 'assets/sounds/normalized/launch/launch_smol.mp3',

      // Explosion sounds
      explosion_air: 'assets/sounds/normalized/explosion/explosion1.mp3',
      explosion_ground: 'assets/sounds/normalized/explosion/explosion3.mp3',
      explosion_intercept: 'assets/sounds/normalized/explosion/explosion2.mp3',
      explosion_large: 'assets/sounds/normalized/explosion/explosion4.mp3',
      explosion_medium: 'assets/sounds/normalized/explosion/explosion5.mp3',
      explosion_small: 'assets/sounds/normalized/explosion/explosion6.mp3',
      explosion_distant: 'assets/sounds/normalized/explosion/explosion7.mp3',
      explosion_debris: 'assets/sounds/normalized/explosion/explosion8.mp3',

      // Threat sounds
      threat_flyby: 'assets/sounds/normalized/flyby/flyby.mp3',

      // Alert sounds (placeholders)
      alert_siren: 'assets/sounds/alert_siren.mp3',
      alert_critical: 'assets/sounds/alert_critical.mp3',

      // UI sounds (placeholders)
      ui_click: 'assets/sounds/ui_click.mp3',
      ui_success: 'assets/sounds/ui_success.mp3',
      ui_fail: 'assets/sounds/ui_fail.mp3',
      ui_upgrade: 'assets/sounds/ui_upgrade.mp3',

      // Ambient sounds (placeholders)
      ambient_base: 'assets/sounds/ambient_base.mp3',

      // Background music
      bgm_picaroon: 'assets/sounds/normalized/bgm/picaroon.mp3',
    };

    // Load actual sound files
    Object.entries(soundFiles).forEach(([key, path]) => {
      // Only load files that exist (our normalized sounds)
      if (path.includes('normalized/')) {
        this.audioLoader.load(
          path,
          buffer => {
            this.sounds.set(key, buffer);
            debug.log(`Sound loaded: ${key}`);

            // Don't auto-start BGM here - let main.ts handle initial playback
          },
          undefined,
          error => {
            debug.warn(`Failed to load sound ${key}:`, error);
          }
        );
      }
    });

    debug.log('Sound loading initiated');
  }

  private getPooledAudio(spatialized: boolean = false): THREE.Audio | THREE.PositionalAudio {
    const poolKey = spatialized ? 'positional' : 'standard';
    let pool = this.audioPool.get(poolKey);

    if (!pool) {
      pool = [];
      this.audioPool.set(poolKey, pool);
    }

    // Find an available audio object
    const available = pool.find(audio => !audio.isPlaying);
    if (available) {
      return available;
    }

    // Create new audio object if none available
    const audio = spatialized
      ? new THREE.PositionalAudio(this.listener)
      : new THREE.Audio(this.listener);

    pool.push(audio);
    return audio;
  }

  play(soundName: string, category: string = 'ui', options: SoundOptions = {}): string | null {
    if (!this.enabled) {
      return null;
    }

    // Check if SFX is disabled (except for BGM)
    if (!this.sfxEnabled && category !== 'bgm') {
      return null;
    }

    const buffer = this.sounds.get(soundName);
    if (!buffer) {
      // Silently skip sounds that aren't loaded yet
      return null;
    }

    // Clean up old sounds if we're at the limit
    if (this.activeSounds.size >= this.maxActiveSounds) {
      // Find and remove the oldest non-BGM sound
      let oldestSound: SoundInstance | null = null;
      let oldestTime = Date.now();

      this.activeSounds.forEach(sound => {
        if (sound.id !== this.bgmInstance?.id && sound.startTime < oldestTime) {
          oldestSound = sound;
          oldestTime = sound.startTime;
        }
      });

      if (oldestSound) {
        this.stopSound((oldestSound as SoundInstance).id);
      }
    }

    const soundId = `${soundName}_${Date.now()}_${Math.random()}`;

    try {
      // Get pooled audio object
      const audio = this.getPooledAudio(options.spatialized);

      // Set buffer
      audio.setBuffer(buffer);

      // Apply options
      const categoryVolume = this.categoryVolumes.get(category) || 1.0;
      const finalVolume =
        (options.volume || 1.0) *
        categoryVolume *
        (category === 'bgm' ? this.bgmVolume : this.sfxVolume);

      audio.setVolume(finalVolume);
      audio.setLoop(options.loop || false);

      // Apply pitch variation if specified
      if (options.pitchVariation) {
        const variation = 1 + (Math.random() - 0.5) * options.pitchVariation;
        audio.setPlaybackRate((options.playbackRate || 1.0) * variation);
      } else {
        audio.setPlaybackRate(options.playbackRate || 1.0);
      }

      // Set position for positional audio
      if (options.spatialized && audio instanceof THREE.PositionalAudio) {
        if (options.position) {
          audio.position.set(options.position.x, options.position.y, options.position.z);
        }
        audio.setRefDistance(options.refDistance || 10);
        audio.setMaxDistance(options.maxDistance || 1000);
        audio.setRolloffFactor(1);
      }

      // Play the sound
      audio.play();

      // Store sound instance
      const soundInstance: SoundInstance = {
        id: soundId,
        audio,
        startTime: Date.now(),
        fadeIn: options.fadeIn,
        fadeOut: options.fadeOut,
        originalVolume: finalVolume,
        category,
      };

      this.activeSounds.set(soundId, soundInstance);

      // Handle fade in
      if (options.fadeIn) {
        soundInstance.isFading = true;
        soundInstance.fadeStartTime = Date.now();
        audio.setVolume(0);
      }

      // Auto-cleanup when sound ends (for non-looping sounds)
      if (!options.loop) {
        const duration = (buffer.duration * 1000) / (options.playbackRate || 1.0);
        setTimeout(() => {
          if (this.activeSounds.has(soundId)) {
            this.stopSound(soundId);
          }
        }, duration + 100); // Add small buffer
      }

      return soundId;
    } catch (error) {
      debug.error(`Failed to play sound ${soundName}:`, error);
      return null;
    }
  }

  private stopSound(soundId: string) {
    const sound = this.activeSounds.get(soundId);
    if (sound) {
      try {
        if (sound.audio.isPlaying) {
          sound.audio.stop();
        }
        // Only disconnect if the audio has a source (is connected)
        if (sound.audio.source) {
          sound.audio.disconnect();
        }
      } catch (error) {
        // Silently ignore disconnect errors - they're harmless
        if (error instanceof Error && !error.message.includes('disconnect')) {
          debug.error('Error stopping sound:', error);
        }
      }
      this.activeSounds.delete(soundId);
    }
  }

  stop(soundId: string, fadeOut?: number) {
    const sound = this.activeSounds.get(soundId);
    if (!sound) return;

    if (fadeOut && fadeOut > 0) {
      sound.fadeOut = fadeOut;
      sound.fadeStartTime = Date.now();
      sound.isFading = true;
    } else {
      this.stopSound(soundId);
    }
  }

  stopAll(category?: string, fadeOut?: number) {
    this.activeSounds.forEach((sound, id) => {
      if (!category || sound.category === category) {
        this.stop(id, fadeOut);
      }
    });
  }

  // Convenience methods for specific sound types
  playLaunch(position?: THREE.Vector3 | { x: number; y: number; z: number }) {
    const sounds = ['interceptor_launch', 'interceptor_launch_alt'];
    const sound = sounds[Math.floor(Math.random() * sounds.length)];

    return this.play(sound, 'launch', {
      volume: 0.8,
      spatialized: !!position,
      position: position ? { x: position.x, y: position.y, z: position.z } : undefined,
      pitchVariation: 0.1,
      maxDistance: 2000,
      refDistance: 50,
    });
  }

  playExplosion(
    type: string = 'medium',
    position?: THREE.Vector3 | { x: number; y: number; z: number }
  ) {
    const explosionMap: { [key: string]: string } = {
      air: 'explosion_air',
      ground: 'explosion_ground',
      intercept: 'explosion_intercept',
      large: 'explosion_large',
      medium: 'explosion_medium',
      small: 'explosion_small',
      distant: 'explosion_distant',
      debris: 'explosion_debris',
    };

    const sound = explosionMap[type] || 'explosion_medium';

    return this.play(sound, 'explosion', {
      volume: type === 'large' ? 1.0 : type === 'intercept' ? 1.0 : 0.8,
      spatialized: type === 'intercept' ? false : !!position, // Make intercept sounds non-positional
      position: position ? { x: position.x, y: position.y, z: position.z } : undefined,
      pitchVariation: 0.15,
      maxDistance: type === 'large' ? 5000 : type === 'intercept' ? 5000 : 3000,
      refDistance: type === 'large' ? 100 : type === 'intercept' ? 100 : 50,
    });
  }

  playAlert(type: string = 'siren') {
    const alertMap: { [key: string]: string } = {
      siren: 'alert_siren',
      critical: 'alert_critical',
    };

    const sound = alertMap[type] || 'alert_siren';

    return this.play(sound, 'alert', {
      volume: 1.0,
      loop: type === 'siren',
    });
  }

  playUI(type: string = 'click') {
    const uiMap: { [key: string]: string } = {
      click: 'ui_click',
      success: 'ui_success',
      fail: 'ui_fail',
      upgrade: 'ui_upgrade',
    };

    const sound = uiMap[type] || 'ui_click';

    return this.play(sound, 'ui', {
      volume: 0.5,
    });
  }

  playThreatLaunch(
    type: string = 'rocket',
    position?: THREE.Vector3 | { x: number; y: number; z: number }
  ) {
    const launchMap: { [key: string]: string } = {
      rocket: 'rocket_launch',
      mortar: 'mortar_launch',
      drone: 'threat_flyby',
      ballistic: 'rocket_launch',
    };

    const sound = launchMap[type] || 'rocket_launch';

    return this.play(sound, 'launch', {
      volume: 0.7,
      spatialized: !!position,
      position: position ? { x: position.x, y: position.y, z: position.z } : undefined,
      pitchVariation: 0.1,
      maxDistance: 3000,
      refDistance: 50,
    });
  }

  async playBackgroundMusic() {
    // Don't start if disabled or already playing
    if (!this.bgmEnabled || this.bgmInstance) return;

    // Double-check that BGM isn't already in active sounds
    for (const [, sound] of this.activeSounds) {
      if (sound.category === 'bgm' && sound.audio.isPlaying) {
        this.bgmInstance = sound;
        return;
      }
    }

    // Ensure audio context is resumed before playing
    await this.ensureAudioContext();

    const bgmId = this.play('bgm_picaroon', 'bgm', {
      volume: 1.0, // Don't multiply by bgmVolume here, it's already applied in play()
      loop: true,
      fadeIn: 2000,
    });

    if (bgmId) {
      this.bgmInstance = this.activeSounds.get(bgmId) || null;
      debug.log('Background music started');
    }
  }

  stopBackgroundMusic(fadeOut: number = 2000) {
    if (this.bgmInstance) {
      const bgmId = this.bgmInstance.id;
      this.bgmInstance = null; // Clear reference immediately to prevent race conditions
      this.stop(bgmId, fadeOut);
    }
  }

  // Update methods for listener position/orientation
  updateListenerPosition(position: { x: number; y: number; z: number }) {
    // Three.js AudioListener automatically updates position with camera
    // This method is kept for compatibility but isn't needed
  }

  updateListenerOrientation(
    forward: { x: number; y: number; z: number },
    up: { x: number; y: number; z: number }
  ) {
    // Three.js AudioListener automatically updates orientation with camera
    // This method is kept for compatibility but isn't needed
  }

  // Settings methods
  setMasterVolume(volume: number) {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    this.listener.setMasterVolume(this.masterVolume);
    localStorage.setItem('ironDome_masterVolume', this.masterVolume.toString());
  }

  getMasterVolume(): number {
    return this.masterVolume;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    localStorage.setItem('ironDome_soundEnabled', enabled.toString());

    if (!enabled) {
      this.stopAll(undefined, 100);
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setSFXEnabled(enabled: boolean) {
    this.sfxEnabled = enabled;
    localStorage.setItem('ironDome_sfxEnabled', enabled.toString());

    if (!enabled) {
      // Stop all non-BGM sounds
      this.activeSounds.forEach((sound, id) => {
        if (sound !== this.bgmInstance) {
          this.stop(id);
        }
      });
    }
  }

  isSFXEnabled(): boolean {
    return this.sfxEnabled;
  }

  getSFXEnabled(): boolean {
    return this.sfxEnabled;
  }

  setBGMEnabled(enabled: boolean) {
    this.bgmEnabled = enabled;
    localStorage.setItem('ironDome_bgmEnabled', enabled.toString());

    if (enabled && !this.bgmInstance) {
      this.playBackgroundMusic();
    } else if (!enabled && this.bgmInstance) {
      this.stopBackgroundMusic();
    }
  }

  isBGMEnabled(): boolean {
    return this.bgmEnabled;
  }

  getBGMEnabled(): boolean {
    return this.bgmEnabled;
  }

  isBGMPlaying(): boolean {
    // Check both bgmInstance and scan active sounds to be sure
    if (this.bgmInstance && this.bgmInstance.audio.isPlaying) {
      return true;
    }
    
    // Double-check active sounds in case bgmInstance is stale
    for (const [, sound] of this.activeSounds) {
      if (sound.category === 'bgm' && sound.audio.isPlaying) {
        return true;
      }
    }
    
    return false;
  }

  setSFXVolume(volume: number) {
    this.sfxVolume = Math.max(0, Math.min(1, volume));
    localStorage.setItem('ironDome_sfxVolume', this.sfxVolume.toString());

    // Update volume of active SFX
    this.activeSounds.forEach(sound => {
      if (sound.category !== 'bgm') {
        const categoryVolume = this.categoryVolumes.get(sound.category || 'ui') || 1.0;
        sound.audio.setVolume((sound.originalVolume * this.sfxVolume) / categoryVolume);
      }
    });
  }

  getSFXVolume(): number {
    return this.sfxVolume;
  }

  setBGMVolume(volume: number) {
    this.bgmVolume = Math.max(0, Math.min(1, volume));
    localStorage.setItem('ironDome_bgmVolume', this.bgmVolume.toString());

    // Update BGM volume if playing
    if (this.bgmInstance) {
      // Recalculate volume based on all factors
      const categoryVolume = this.categoryVolumes.get('bgm') || 1.0;
      const finalVolume = this.bgmInstance.originalVolume * categoryVolume * this.bgmVolume;
      this.bgmInstance.audio.setVolume(finalVolume);
    }
  }

  getBGMVolume(): number {
    return this.bgmVolume;
  }

  getCategoryVolume(category: string): number {
    return this.categoryVolumes.get(category) || 1.0;
  }

  setCategoryVolume(category: string, volume: number) {
    const clampedVolume = Math.max(0, Math.min(1, volume));
    this.categoryVolumes.set(category, clampedVolume);

    // Update volume of active sounds in this category
    this.activeSounds.forEach(sound => {
      if (sound.category === category) {
        const baseVolume = sound.originalVolume / this.getCategoryVolume(category);
        sound.audio.setVolume(
          baseVolume * clampedVolume * (category === 'bgm' ? this.bgmVolume : this.sfxVolume)
        );
      }
    });
  }

  private loadPreferences() {
    const sfxEnabled = localStorage.getItem('ironDome_sfxEnabled');
    const bgmEnabled = localStorage.getItem('ironDome_bgmEnabled');
    const sfxVolume = localStorage.getItem('ironDome_sfxVolume');
    const bgmVolume = localStorage.getItem('ironDome_bgmVolume');

    if (sfxEnabled !== null) this.sfxEnabled = sfxEnabled === 'true';
    if (bgmEnabled !== null) this.bgmEnabled = bgmEnabled === 'true';
    if (sfxVolume !== null) this.sfxVolume = parseFloat(sfxVolume);
    if (bgmVolume !== null) this.bgmVolume = parseFloat(bgmVolume);
  }

  async ensureAudioContext(): Promise<void> {
    const context = THREE.AudioContext.getContext();
    if (context.state === 'suspended' && !this.audioContextResumed) {
      try {
        await context.resume();
        this.audioContextResumed = true;
        debug.log('SoundSystem', 'AudioContext resumed successfully');
      } catch (error) {
        debug.error('SoundSystem', 'Failed to resume AudioContext:', error);
      }
    }
  }

  // Update method for fading
  update() {
    const now = Date.now();

    this.activeSounds.forEach((sound, id) => {
      if (sound.isFading && sound.fadeStartTime) {
        const elapsed = now - sound.fadeStartTime;

        if (sound.fadeIn && elapsed < sound.fadeIn) {
          // Fade in
          const progress = elapsed / sound.fadeIn;
          sound.audio.setVolume(sound.originalVolume * progress);

          if (progress >= 1) {
            sound.isFading = false;
          }
        } else if (sound.fadeOut && elapsed < sound.fadeOut) {
          // Fade out
          const progress = 1 - elapsed / sound.fadeOut;
          sound.audio.setVolume(sound.originalVolume * progress);

          if (progress <= 0) {
            this.stopSound(id);
          }
        }
      }
    });
  }

  // Debug method
  getDebugInfo() {
    return {
      enabled: this.enabled,
      masterVolume: this.masterVolume,
      activeSounds: this.activeSounds.size,
      maxSounds: this.maxActiveSounds,
      loadedSounds: this.sounds.size,
      bgmPlaying: !!this.bgmInstance,
      sfxEnabled: this.sfxEnabled,
      bgmEnabled: this.bgmEnabled,
    };
  }
}
