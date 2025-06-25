import { debug } from '../utils/DebugLogger';

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

  private constructor() {
    // Initialize category volumes
    this.categoryVolumes.set('launch', 0.8);
    this.categoryVolumes.set('explosion', 0.9);
    this.categoryVolumes.set('alert', 0.7);
    this.categoryVolumes.set('ambient', 0.5);
    this.categoryVolumes.set('ui', 0.6);

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
      // @ts-ignore - WebKit prefix for Safari
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioContextClass();

      // Create master gain node
      this.masterGainNode = this.audioContext.createGain();
      this.masterGainNode.gain.value = this.masterVolume;
      this.masterGainNode.connect(this.audioContext.destination);

      // Set up listener (camera position)
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

      debug.log('Audio context initialized');
    } catch (error) {
      debug.error('Failed to initialize audio context:', error);
      this.enabled = false;
    }
  }

  private loadSounds() {
    // Define sound files to preload
    const soundFiles = {
      // Launch sounds
      interceptor_launch: 'assets/sounds/interceptor_launch.mp3',
      interceptor_launch_alt: 'assets/sounds/interceptor_launch_alt.mp3',

      // Explosion sounds
      explosion_air: 'assets/sounds/explosion_air.mp3',
      explosion_ground: 'assets/sounds/explosion_ground.mp3',
      explosion_intercept: 'assets/sounds/explosion_intercept.mp3',

      // Threat sounds
      threat_incoming: 'assets/sounds/threat_incoming.mp3',
      threat_rocket: 'assets/sounds/threat_rocket.mp3',
      threat_mortar: 'assets/sounds/threat_mortar.mp3',

      // Alert sounds
      alert_siren: 'assets/sounds/alert_siren.mp3',
      alert_critical: 'assets/sounds/alert_critical.mp3',

      // UI sounds
      ui_click: 'assets/sounds/ui_click.mp3',
      ui_success: 'assets/sounds/ui_success.mp3',
      ui_fail: 'assets/sounds/ui_fail.mp3',
      ui_upgrade: 'assets/sounds/ui_upgrade.mp3',

      // Ambient sounds
      ambient_base: 'assets/sounds/ambient_base.mp3',
    };

    // For now, we'll create placeholder audio elements
    // In production, these would load actual sound files
    Object.entries(soundFiles).forEach(([key, path]) => {
      const audio = new Audio();
      audio.preload = 'auto';
      // Don't set src yet as we don't have the actual files
      // audio.src = path
      this.sounds.set(key, audio);
    });

    debug.log('Sound placeholders created');
  }

  play(soundName: string, category: string = 'ui', options: SoundOptions = {}): string | null {
    if (!this.enabled || !this.audioContext || !this.masterGainNode) {
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
      const volume = (options.volume || 1) * categoryVolume;
      gainNode.gain.value = options.fadeIn ? 0 : volume;

      // Set up audio graph
      let lastNode: AudioNode = gainNode;

      // Add spatial audio if requested
      if (options.spatialized && options.position) {
        const pannerNode = this.audioContext.createPanner();
        pannerNode.panningModel = 'HRTF';
        pannerNode.distanceModel = 'inverse';
        pannerNode.refDistance = options.refDistance || 10;
        pannerNode.maxDistance = options.maxDistance || 200;
        pannerNode.rolloffFactor = 1;
        pannerNode.coneInnerAngle = 360;
        pannerNode.coneOuterAngle = 0;
        pannerNode.coneOuterGain = 0;

        // Set position (validate values are finite)
        const x = isFinite(options.position.x) ? options.position.x : 0;
        const y = isFinite(options.position.y) ? options.position.y : 0;
        const z = isFinite(options.position.z) ? options.position.z : 0;
        
        if (pannerNode.positionX) {
          pannerNode.positionX.value = x;
          pannerNode.positionY.value = y;
          pannerNode.positionZ.value = z;
        } else if (pannerNode.setPosition) {
          pannerNode.setPosition(x, y, z);
        }

        gainNode.connect(pannerNode);
        pannerNode.connect(this.masterGainNode);

        lastNode = pannerNode;
      } else {
        gainNode.connect(this.masterGainNode);
      }

      source.connect(gainNode);

      // Configure audio element
      audioClone.loop = options.loop || false;
      audioClone.playbackRate = options.playbackRate || 1;

      // Store sound instance
      const soundInstance: SoundInstance = {
        id: soundId,
        audio: audioClone,
        source,
        gainNode,
        pannerNode: options.spatialized ? (lastNode as PannerNode) : undefined,
        startTime: Date.now(),
        fadeIn: options.fadeIn,
        fadeOut: options.fadeOut,
        originalVolume: volume,
      };

      this.activeSounds.set(soundId, soundInstance);

      // Handle fade in
      if (options.fadeIn) {
        this.fadeIn(soundInstance, options.fadeIn);
      }

      // Set up cleanup on end
      audioClone.addEventListener('ended', () => {
        this.stopSound(soundId);
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

  stop(soundId: string, fadeOut?: number) {
    const sound = this.activeSounds.get(soundId);
    if (!sound) return;

    if (fadeOut && sound.gainNode) {
      this.fadeOut(sound, fadeOut);
    } else {
      this.stopSound(soundId);
    }
  }

  stopAll(category?: string, fadeOut?: number) {
    this.activeSounds.forEach((sound, id) => {
      if (!category || sound.id.startsWith(category)) {
        this.stop(id, fadeOut);
      }
    });
  }

  private stopSound(soundId: string) {
    const sound = this.activeSounds.get(soundId);
    if (!sound) return;

    try {
      sound.audio.pause();
      sound.audio.currentTime = 0;

      // Disconnect nodes
      if (sound.source) {
        sound.source.disconnect();
      }
      if (sound.gainNode) {
        sound.gainNode.disconnect();
      }
      if (sound.pannerNode) {
        sound.pannerNode.disconnect();
      }

      this.activeSounds.delete(soundId);
    } catch (error) {
      debug.error('Error stopping sound:', error);
    }
  }

  private fadeIn(sound: SoundInstance, duration: number) {
    if (!sound.gainNode || !this.audioContext) return;

    const targetVolume = sound.originalVolume;
    const startTime = this.audioContext.currentTime;

    sound.gainNode.gain.setValueAtTime(0, startTime);
    sound.gainNode.gain.linearRampToValueAtTime(targetVolume, startTime + duration);
  }

  private fadeOut(sound: SoundInstance, duration: number) {
    if (!sound.gainNode || !this.audioContext) return;

    const startTime = this.audioContext.currentTime;
    const currentVolume = sound.gainNode.gain.value;

    sound.gainNode.gain.setValueAtTime(currentVolume, startTime);
    sound.gainNode.gain.linearRampToValueAtTime(0, startTime + duration);

    // Schedule stop
    setTimeout(() => {
      this.stopSound(sound.id);
    }, duration * 1000);
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
      maxDistance: 300,
      refDistance: 20,
    });
  }

  playExplosion(
    type: 'air' | 'ground' | 'intercept',
    position?: { x: number; y: number; z: number }
  ): string | null {
    const soundName = `explosion_${type}`;
    return this.play(soundName, 'explosion', {
      volume: type === 'ground' ? 1.0 : 0.9,
      spatialized: !!position,
      position,
      maxDistance: 500,
      refDistance: 50,
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
      fadeIn: 2,
    });
  }
}
