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
  pitchVariation?: number; // Random pitch variation range (0-1)
}

interface SoundInstance {
  id: string;
  audio: HTMLAudioElement;
  source?: MediaElementAudioSourceNode;
  gainNode?: GainNode;
  pannerNode?: PannerNode;
  startTime: number;
  fadeIn?: number;
  fadeOut?: number;
  fadeStartTime?: number;
  isFading?: boolean;
  originalVolume: number;
}

export class SoundSystem {
  private static instance: SoundSystem | null = null;
  private audioContext: AudioContext | null = null;
  private masterGainNode: GainNode | null = null;
  private sounds: Map<string, HTMLAudioElement> = new Map();
  private activeSounds: Map<string, SoundInstance> = new Map();
  private enabled: boolean = true;
  private masterVolume: number = 0.7;
  private categoryVolumes: Map<string, number> = new Map();
  private listenerPosition = { x: 0, y: 0, z: 0 };
  private listenerOrientation = { forward: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 } };
  private bgmInstance: SoundInstance | null = null;
  private sfxEnabled: boolean = true;
  private bgmEnabled: boolean = true;
  private sfxVolume: number = 1.0;
  private bgmVolume: number = 0.5;

  private constructor() {
    // Initialize category volumes
    this.categoryVolumes.set('launch', 0.8);
    this.categoryVolumes.set('explosion', 0.9);
    this.categoryVolumes.set('alert', 0.7);
    this.categoryVolumes.set('ambient', 0.5);
    this.categoryVolumes.set('ui', 0.6);
    this.categoryVolumes.set('bgm', 1.0);

    // Load saved preferences
    this.loadPreferences();

    this.initializeAudioContext();
    this.loadSounds();

    // Load saved preferences
    const savedEnabled = localStorage.getItem('ironDome_soundEnabled');
    const savedVolume = localStorage.getItem('ironDome_masterVolume');

    if (savedEnabled !== null) {
      this.enabled = savedEnabled === 'true';
    }

    if (savedVolume !== null) {
      this.masterVolume = parseFloat(savedVolume);
      if (this.masterGainNode) {
        this.masterGainNode.gain.value = this.masterVolume;
      }
    }
  }

  static getInstance(): SoundSystem {
    if (!SoundSystem.instance) {
      SoundSystem.instance = new SoundSystem();
    }
    return SoundSystem.instance;
  }

  private initializeAudioContext() {
    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.masterGainNode = this.audioContext.createGain();
      this.masterGainNode.gain.value = this.masterVolume;
      this.masterGainNode.connect(this.audioContext.destination);

      // Set up listener position
      if (this.audioContext.listener) {
        const listener = this.audioContext.listener;

        // Set default position
        if (listener.positionX) {
          listener.positionX.value = 0;
          listener.positionY.value = 0;
          listener.positionZ.value = 0;
        } else if (listener.setPosition) {
          listener.setPosition(0, 0, 0);
        }

        // Set default orientation
        if (listener.forwardX) {
          listener.forwardX.value = 0;
          listener.forwardY.value = 0;
          listener.forwardZ.value = -1;
          listener.upX.value = 0;
          listener.upY.value = 1;
          listener.upZ.value = 0;
        } else if (listener.setOrientation) {
          listener.setOrientation(0, 0, -1, 0, 1, 0);
        }
      }

      debug.log('Audio context initialized', { state: this.audioContext.state });

      // Set up user interaction handler to resume audio context and retry BGM
      const resumeAudio = () => {
        if (this.audioContext && this.audioContext.state === 'suspended') {
          this.audioContext.resume().then(() => {
            debug.log('Audio context resumed after user interaction');
            // Try to start BGM after audio context is resumed
            if (this.bgmEnabled && !this.bgmInstance) {
              this.playBackgroundMusic();
            }
          });
        } else if (this.audioContext && this.audioContext.state === 'running') {
          // Audio context already running, start BGM if enabled
          if (this.bgmEnabled && !this.bgmInstance) {
            this.playBackgroundMusic();
          }
        }

        // Keep listeners active until BGM successfully starts
        if (this.bgmEnabled && !this.bgmInstance) {
          // Don't remove listeners yet - BGM hasn't started
          return;
        }

        // Remove listeners only after BGM is playing
        document.removeEventListener('click', resumeAudio);
        document.removeEventListener('keydown', resumeAudio);
        document.removeEventListener('touchstart', resumeAudio);
      };

      // Add listeners for user interaction
      document.addEventListener('click', resumeAudio);
      document.addEventListener('keydown', resumeAudio);
      document.addEventListener('touchstart', resumeAudio);
    } catch (error) {
      debug.error('Failed to initialize audio context:', error);
      this.enabled = false;
    }
  }

  private loadSounds() {
    // Define sound files to preload - using our normalized sounds
    const soundFiles = {
      // Launch sounds
      interceptor_launch: 'assets/sounds/normalized/launch/firing.mp3',
      interceptor_launch_alt: 'assets/sounds/normalized/launch/launch2.mp3',
      rocket_launch: 'assets/sounds/normalized/launch/grad.mp3',
      mortar_launch: 'assets/sounds/normalized/launch/launch_smol.mp3',

      // Explosion sounds - using new explosion files
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

      // Alert sounds (placeholders for now)
      alert_siren: 'assets/sounds/alert_siren.mp3',
      alert_critical: 'assets/sounds/alert_critical.mp3',

      // UI sounds (placeholders for now)
      ui_click: 'assets/sounds/ui_click.mp3',
      ui_success: 'assets/sounds/ui_success.mp3',
      ui_fail: 'assets/sounds/ui_fail.mp3',
      ui_upgrade: 'assets/sounds/ui_upgrade.mp3',

      // Ambient sounds (placeholders for now)
      ambient_base: 'assets/sounds/ambient_base.mp3',

      // Background music
      bgm_picaroon: 'assets/sounds/normalized/bgm/picaroon.mp3',
    };

    // Load actual sound files
    Object.entries(soundFiles).forEach(([key, path]) => {
      const audio = new Audio();
      audio.preload = 'auto';
      audio.crossOrigin = 'anonymous'; // Add CORS support

      // Only set src for files that exist (our normalized sounds)
      if (path.includes('normalized/')) {
        audio.src = path;

        // Add load event listener for BGM
        if (key === 'bgm_picaroon') {
          audio.addEventListener('canplaythrough', () => {
            debug.log('BGM audio loaded and ready to play');
          });

          audio.addEventListener('error', e => {
            debug.error('Failed to load BGM:', e);
          });
        }
      }

      this.sounds.set(key, audio);
    });

    debug.log('Sounds loaded');
  }

  play(soundName: string, category: string = 'ui', options: SoundOptions = {}): string | null {
    if (!this.enabled || !this.audioContext || !this.masterGainNode) {
      return null;
    }

    // Check if SFX is disabled (except for BGM)
    if (!this.sfxEnabled && category !== 'bgm') {
      return null;
    }

    const audio = this.sounds.get(soundName);
    if (!audio) {
      debug.warn(`Sound not found: ${soundName}`);
      return null;
    }

    // Check if audio has a valid source
    if (!audio.src || audio.src === '') {
      // Silently skip playing sounds that aren't loaded yet
      return null;
    }

    // Clone audio element for multiple simultaneous plays
    const audioClone = audio.cloneNode(true) as HTMLAudioElement;
    const soundId = `${soundName}_${Date.now()}_${Math.random()}`;

    // Add error handler for audio loading
    audioClone.addEventListener('error', e => {
      debug.error(`Failed to load audio ${soundName}:`, e);
      this.activeSounds.delete(soundId);
    });

    try {
      // Resume audio context if suspended (mobile browsers)
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }

      // Create audio nodes
      const source = this.audioContext.createMediaElementSource(audioClone);
      const gainNode = this.audioContext.createGain();

      // Calculate volume
      const categoryVolume = this.categoryVolumes.get(category) || 1;
      let volume = (options.volume || 1) * categoryVolume;

      // Apply SFX volume for non-BGM sounds
      if (category !== 'bgm') {
        volume *= this.sfxVolume;
      }

      gainNode.gain.value = options.fadeIn ? 0 : volume;

      // Set up audio graph
      let lastNode: AudioNode = gainNode;

      // Add spatial audio if requested
      if (options.spatialized && options.position) {
        const pannerNode = this.audioContext.createPanner();
        pannerNode.panningModel = 'HRTF';
        pannerNode.distanceModel = 'inverse';
        pannerNode.refDistance = options.refDistance || 1;
        pannerNode.maxDistance = options.maxDistance || 100;
        pannerNode.rolloffFactor = 1;

        // Set position
        if (pannerNode.positionX) {
          pannerNode.positionX.value = options.position.x;
          pannerNode.positionY.value = options.position.y;
          pannerNode.positionZ.value = options.position.z;
        } else if (pannerNode.setPosition) {
          pannerNode.setPosition(options.position.x, options.position.y, options.position.z);
        }

        gainNode.connect(pannerNode);
        pannerNode.connect(this.masterGainNode);
        lastNode = pannerNode;

        // Store panner node reference
        const soundInstance: SoundInstance = {
          id: soundId,
          audio: audioClone,
          source,
          gainNode,
          pannerNode,
          startTime: Date.now(),
          fadeIn: options.fadeIn,
          fadeOut: options.fadeOut,
          originalVolume: volume,
        };
        this.activeSounds.set(soundId, soundInstance);
      } else {
        gainNode.connect(this.masterGainNode);

        // Store sound instance
        const soundInstance: SoundInstance = {
          id: soundId,
          audio: audioClone,
          source,
          gainNode,
          startTime: Date.now(),
          fadeIn: options.fadeIn,
          fadeOut: options.fadeOut,
          originalVolume: volume,
        };
        this.activeSounds.set(soundId, soundInstance);
      }

      source.connect(gainNode);

      // Apply options
      audioClone.loop = options.loop || false;
      audioClone.playbackRate = options.playbackRate || 1;

      // Apply pitch variation if requested
      if (options.pitchVariation) {
        const variation = 1 + (Math.random() - 0.5) * 2 * options.pitchVariation;
        audioClone.playbackRate *= variation;
      }

      // Set up fade in
      if (options.fadeIn) {
        gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
        gainNode.gain.linearRampToValueAtTime(
          volume,
          this.audioContext.currentTime + options.fadeIn / 1000
        );
      }

      // Handle audio end
      audioClone.addEventListener('ended', () => {
        this.activeSounds.delete(soundId);
        audioClone.remove();
      });

      // Play the sound
      audioClone.play().catch(error => {
        debug.warn(`Failed to play sound ${soundName}:`, error);
        this.activeSounds.delete(soundId);
      });

      return soundId;
    } catch (error) {
      debug.error(`Error playing sound ${soundName}:`, error);
      return null;
    }
  }

  stop(soundId: string, fadeOut?: number): void {
    const sound = this.activeSounds.get(soundId);
    if (!sound) return;

    if (fadeOut && sound.gainNode && this.audioContext) {
      // Fade out
      sound.gainNode.gain.linearRampToValueAtTime(
        0,
        this.audioContext.currentTime + fadeOut / 1000
      );
      setTimeout(() => {
        sound.audio.pause();
        this.activeSounds.delete(soundId);
      }, fadeOut);
    } else {
      // Immediate stop
      sound.audio.pause();
      this.activeSounds.delete(soundId);
    }
  }

  stopAll(category?: string, fadeOut?: number): void {
    this.activeSounds.forEach((sound, id) => {
      if (!category || sound.audio.dataset.category === category) {
        this.stop(id, fadeOut);
      }
    });
  }

  private stopSound(soundId: string): void {
    const sound = this.activeSounds.get(soundId);
    if (sound) {
      sound.audio.pause();
      sound.audio.currentTime = 0;
      this.activeSounds.delete(soundId);
    }
  }

  updateListenerPosition(position: { x: number; y: number; z: number }) {
    this.listenerPosition = position;

    if (!this.audioContext || !this.audioContext.listener) return;

    const listener = this.audioContext.listener;

    if (listener.positionX) {
      listener.positionX.value = position.x;
      listener.positionY.value = position.y;
      listener.positionZ.value = position.z;
    } else if (listener.setPosition) {
      listener.setPosition(position.x, position.y, position.z);
    }
  }

  updateListenerOrientation(
    forward: { x: number; y: number; z: number },
    up: { x: number; y: number; z: number }
  ) {
    this.listenerOrientation = { forward, up };

    if (!this.audioContext || !this.audioContext.listener) return;

    const listener = this.audioContext.listener;

    if (listener.forwardX) {
      listener.forwardX.value = forward.x;
      listener.forwardY.value = forward.y;
      listener.forwardZ.value = forward.z;
      listener.upX.value = up.x;
      listener.upY.value = up.y;
      listener.upZ.value = up.z;
    } else if (listener.setOrientation) {
      listener.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  updateSoundPosition(soundId: string, position: { x: number; y: number; z: number }) {
    const sound = this.activeSounds.get(soundId);
    if (!sound || !sound.pannerNode) return;

    if (sound.pannerNode.positionX) {
      sound.pannerNode.positionX.value = position.x;
      sound.pannerNode.positionY.value = position.y;
      sound.pannerNode.positionZ.value = position.z;
    } else if (sound.pannerNode.setPosition) {
      sound.pannerNode.setPosition(position.x, position.y, position.z);
    }
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    localStorage.setItem('ironDome_soundEnabled', enabled.toString());

    if (!enabled) {
      this.stopAll();
    }
  }

  setMasterVolume(volume: number) {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    localStorage.setItem('ironDome_masterVolume', this.masterVolume.toString());

    if (this.masterGainNode) {
      this.masterGainNode.gain.value = this.masterVolume;
    }
  }

  setCategoryVolume(category: string, volume: number) {
    this.categoryVolumes.set(category, Math.max(0, Math.min(1, volume)));
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getMasterVolume(): number {
    return this.masterVolume;
  }

  getCategoryVolume(category: string): number {
    return this.categoryVolumes.get(category) || 1;
  }

  // Helper methods for common sounds
  playLaunch(position?: { x: number; y: number; z: number }): string | null {
    const variant = Math.random() > 0.5 ? 'interceptor_launch' : 'interceptor_launch_alt';
    return this.play(variant, 'launch', {
      volume: 0.8,
      spatialized: !!position,
      position,
      maxDistance: 1000, // Increased from 300
      refDistance: 50, // Increased from 20
      pitchVariation: 0.15, // ±15% pitch variation
    });
  }

  playExplosion(
    type: 'air' | 'ground' | 'intercept',
    position?: { x: number; y: number; z: number }
  ): string | null {
    // Map explosion types to available sounds with variety
    const explosionVariants: Record<string, string[]> = {
      air: ['explosion_air', 'explosion_small', 'explosion_medium'],
      ground: ['explosion_ground', 'explosion_large', 'explosion_debris'],
      intercept: [
        'explosion_intercept',
        'explosion_distant',
        'explosion_small',
        'explosion_air',
        'explosion_medium',
      ],
    };

    // Select a random variant for the explosion type
    const variants = explosionVariants[type];
    const soundName = variants[Math.floor(Math.random() * variants.length)];

    return this.play(soundName, 'explosion', {
      volume: type === 'ground' ? 1.0 : 0.9,
      spatialized: !!position,
      position,
      maxDistance: 2000, // Increased from 500
      refDistance: 100, // Increased from 50
      pitchVariation: 0.2, // ±20% pitch variation for explosions
    });
  }

  playAlert(type: 'siren' | 'critical'): string | null {
    return this.play(`alert_${type}`, 'alert', {
      volume: 1.0,
      loop: type === 'siren',
    });
  }

  playUI(type: 'click' | 'success' | 'fail' | 'upgrade'): string | null {
    return this.play(`ui_${type}`, 'ui', {
      volume: 0.5,
    });
  }

  startAmbient(): string | null {
    return this.play('ambient_base', 'ambient', {
      volume: 0.3,
      loop: true,
      fadeIn: 3000,
    });
  }

  playThreatLaunch(
    type: 'rocket' | 'mortar' | 'missile',
    position?: { x: number; y: number; z: number }
  ): string | null {
    const soundMap = {
      rocket: 'rocket_launch',
      mortar: 'mortar_launch',
      missile: 'rocket_launch', // Use rocket sound for missiles too
    };

    const soundName = soundMap[type];
    return this.play(soundName, 'launch', {
      volume: 0.7,
      spatialized: !!position,
      position,
      maxDistance: 1500, // Increased from 400
      refDistance: 75, // Increased from 30
      pitchVariation: 0.1,
    });
  }

  playThreatFlyby(position?: { x: number; y: number; z: number }): string | null {
    return this.play('threat_flyby', 'threat', {
      volume: 0.6,
      spatialized: !!position,
      position,
      maxDistance: 200,
      refDistance: 10,
      pitchVariation: 0.15,
    });
  }

  // Background music methods
  playBackgroundMusic(): void {
    debug.log('playBackgroundMusic called', {
      bgmEnabled: this.bgmEnabled,
      hasBgmInstance: !!this.bgmInstance,
      bgmVolume: this.bgmVolume,
      audioContextState: this.audioContext?.state,
    });

    if (!this.bgmEnabled || this.bgmInstance) return;

    // Ensure audio context is resumed
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume().then(() => {
        debug.log('Audio context resumed');
        // Retry BGM after context is resumed
        this.playBackgroundMusic();
      });
      return; // Exit and retry after resume
    }

    const id = this.play('bgm_picaroon', 'bgm', {
      volume: this.bgmVolume,
      loop: true,
      fadeIn: 2000, // 2 second fade in
    });

    debug.log('BGM play result:', { id, bgmInstance: !!id });

    if (id) {
      this.bgmInstance = this.activeSounds.get(id) || null;
    } else {
      debug.warn('Failed to start BGM - will retry on next user interaction');
    }
  }

  stopBackgroundMusic(): void {
    if (this.bgmInstance) {
      this.stop(this.bgmInstance.id, 2000); // 2 second fade out
      this.bgmInstance = null;
    }
  }

  // Settings methods
  setSFXEnabled(enabled: boolean): void {
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

  setBGMEnabled(enabled: boolean): void {
    this.bgmEnabled = enabled;
    localStorage.setItem('ironDome_bgmEnabled', enabled.toString());

    if (enabled) {
      // If we have a BGM instance, just unmute it
      if (this.bgmInstance && this.bgmInstance.gainNode) {
        this.bgmInstance.gainNode.gain.value = this.bgmVolume * this.masterVolume;
      } else {
        // Otherwise start playing
        this.playBackgroundMusic();
      }
    } else {
      // Just mute, don't stop
      if (this.bgmInstance && this.bgmInstance.gainNode) {
        this.bgmInstance.gainNode.gain.value = 0;
      }
    }
  }

  setSFXVolume(volume: number): void {
    this.sfxVolume = Math.max(0, Math.min(1, volume));
    localStorage.setItem('ironDome_sfxVolume', this.sfxVolume.toString());
  }

  setBGMVolume(volume: number): void {
    this.bgmVolume = Math.max(0, Math.min(1, volume));
    localStorage.setItem('ironDome_bgmVolume', this.bgmVolume.toString());

    // Update BGM volume if playing
    if (this.bgmInstance && this.bgmInstance.gainNode) {
      this.bgmInstance.gainNode.gain.value = this.bgmVolume * this.masterVolume;
    }
  }

  getSFXEnabled(): boolean {
    return this.sfxEnabled;
  }

  getBGMEnabled(): boolean {
    return this.bgmEnabled;
  }

  getSFXVolume(): number {
    return this.sfxVolume;
  }

  getBGMVolume(): number {
    return this.bgmVolume;
  }

  private loadPreferences(): void {
    // Load saved preferences from localStorage
    const savedMasterVolume = localStorage.getItem('ironDome_masterVolume');
    const savedSFXEnabled = localStorage.getItem('ironDome_sfxEnabled');
    const savedBGMEnabled = localStorage.getItem('ironDome_bgmEnabled');
    const savedSFXVolume = localStorage.getItem('ironDome_sfxVolume');
    const savedBGMVolume = localStorage.getItem('ironDome_bgmVolume');

    if (savedMasterVolume !== null) {
      this.masterVolume = parseFloat(savedMasterVolume);
    }
    if (savedSFXEnabled !== null) {
      this.sfxEnabled = savedSFXEnabled === 'true';
    }
    if (savedBGMEnabled !== null) {
      this.bgmEnabled = savedBGMEnabled === 'true';
    }
    if (savedSFXVolume !== null) {
      this.sfxVolume = parseFloat(savedSFXVolume);
    }
    if (savedBGMVolume !== null) {
      this.bgmVolume = parseFloat(savedBGMVolume);
    }
  }

  // Debug method to check BGM status
  debugBGM(): void {
    debug.log('BGM Debug Info:', {
      bgmEnabled: this.bgmEnabled,
      hasBgmInstance: !!this.bgmInstance,
      bgmVolume: this.bgmVolume,
      audioContextState: this.audioContext?.state,
      bgmAudioElement: this.bgmInstance?.audio,
      bgmPlaying: this.bgmInstance?.audio && !this.bgmInstance.audio.paused,
      bgmCurrentTime: this.bgmInstance?.audio?.currentTime,
      bgmDuration: this.bgmInstance?.audio?.duration,
      bgmReadyState: this.bgmInstance?.audio?.readyState,
      bgmError: this.bgmInstance?.audio?.error,
    });
  }

  // Force retry BGM playback
  retryBGM(): void {
    debug.log('Manually retrying BGM playback');
    if (this.bgmInstance) {
      this.stopBackgroundMusic();
    }
    this.playBackgroundMusic();
  }
}
