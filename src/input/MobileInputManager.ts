import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { debug } from '../utils/logger';

interface TouchState {
  active: boolean;
  identifier: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  startTime: number;
}

interface PinchState {
  active: boolean;
  startDistance: number;
  currentDistance: number;
}

export class MobileInputManager {
  private camera: THREE.Camera;
  private controls: OrbitControls;
  private domElement: HTMLElement;

  // Touch tracking
  private touches: Map<number, TouchState> = new Map();
  private pinch: PinchState = { active: false, startDistance: 0, currentDistance: 0 };

  // Callbacks
  private onTapCallback?: (position: THREE.Vector2) => void;
  private onSwipeCallback?: (direction: THREE.Vector2, velocity: number) => void;
  private onLongPressCallback?: (position: THREE.Vector2) => void;

  // Settings
  private tapMaxDuration = 300; // ms
  private tapMaxDistance = 10; // pixels
  private longPressMinDuration = 500; // ms
  private swipeMinDistance = 50; // pixels
  private swipeMinVelocity = 0.3; // pixels/ms

  // Device capabilities
  private supportsTouch: boolean;
  private supportsGyroscope: boolean = false;
  private gyroscopeActive: boolean = false;

  constructor(camera: THREE.Camera, controls: OrbitControls, domElement: HTMLElement) {
    this.camera = camera;
    this.controls = controls;
    this.domElement = domElement;

    // Check device capabilities
    this.supportsTouch = 'ontouchstart' in window;
    this.checkGyroscopeSupport();

    // Set up event listeners
    this.setupEventListeners();

    debug.log('MobileInputManager initialized', {
      supportsTouch: this.supportsTouch,
      supportsGyroscope: this.supportsGyroscope,
    });
  }

  private async checkGyroscopeSupport() {
    if ('DeviceOrientationEvent' in window) {
      try {
        // Check if permission is needed (iOS 13+)
        if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
          const response = await (DeviceOrientationEvent as any).requestPermission();
          this.supportsGyroscope = response === 'granted';
        } else {
          // Non-iOS devices
          this.supportsGyroscope = true;
        }
      } catch (error) {
        debug.error('Gyroscope permission error:', error);
        this.supportsGyroscope = false;
      }
    }
  }

  private setupEventListeners() {
    if (this.supportsTouch) {
      // Touch events
      this.domElement.addEventListener('touchstart', this.onTouchStart.bind(this), {
        passive: false,
      });
      this.domElement.addEventListener('touchmove', this.onTouchMove.bind(this), {
        passive: false,
      });
      this.domElement.addEventListener('touchend', this.onTouchEnd.bind(this), { passive: false });
      this.domElement.addEventListener('touchcancel', this.onTouchCancel.bind(this), {
        passive: false,
      });
    }

    // Prevent default touch behaviors
    this.domElement.style.touchAction = 'none';
    this.domElement.style.userSelect = 'none';
    this.domElement.style.webkitUserSelect = 'none';
  }

  private onTouchStart(event: TouchEvent) {
    event.preventDefault();

    // Track all new touches
    for (let i = 0; i < event.changedTouches.length; i++) {
      const touch = event.changedTouches[i];
      this.touches.set(touch.identifier, {
        active: true,
        identifier: touch.identifier,
        startX: touch.clientX,
        startY: touch.clientY,
        currentX: touch.clientX,
        currentY: touch.clientY,
        startTime: performance.now(),
      });
    }

    // Handle pinch start (two fingers)
    if (this.touches.size === 2) {
      const touchArray = Array.from(this.touches.values());
      const dx = touchArray[0].currentX - touchArray[1].currentX;
      const dy = touchArray[0].currentY - touchArray[1].currentY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      this.pinch = {
        active: true,
        startDistance: distance,
        currentDistance: distance,
      };

      // Disable orbit controls during pinch
      this.controls.enabled = false;
    }
  }

  private onTouchMove(event: TouchEvent) {
    event.preventDefault();

    // Update touch positions
    for (let i = 0; i < event.changedTouches.length; i++) {
      const touch = event.changedTouches[i];
      const touchState = this.touches.get(touch.identifier);
      if (touchState) {
        touchState.currentX = touch.clientX;
        touchState.currentY = touch.clientY;
      }
    }

    // Handle pinch zoom
    if (this.pinch.active && this.touches.size >= 2) {
      const touchArray = Array.from(this.touches.values());
      const dx = touchArray[0].currentX - touchArray[1].currentX;
      const dy = touchArray[0].currentY - touchArray[1].currentY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      this.pinch.currentDistance = distance;

      // Calculate zoom factor
      const zoomFactor = this.pinch.currentDistance / this.pinch.startDistance;

      // Apply zoom by modifying camera distance
      const newDistance = this.controls.getDistance() / zoomFactor;
      this.controls.minDistance = Math.min(this.controls.minDistance, newDistance);
      this.controls.maxDistance = Math.max(this.controls.maxDistance, newDistance);

      // Update camera position
      const direction = new THREE.Vector3();
      direction.subVectors(this.camera.position, this.controls.target);
      direction.normalize();
      direction.multiplyScalar(newDistance);
      this.camera.position.copy(this.controls.target).add(direction);

      // Reset pinch reference
      this.pinch.startDistance = distance;
    }
  }

  private onTouchEnd(event: TouchEvent) {
    event.preventDefault();

    // Process ended touches
    for (let i = 0; i < event.changedTouches.length; i++) {
      const touch = event.changedTouches[i];
      const touchState = this.touches.get(touch.identifier);

      if (touchState) {
        const duration = performance.now() - touchState.startTime;
        const dx = touchState.currentX - touchState.startX;
        const dy = touchState.currentY - touchState.startY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const velocity = distance / duration;

        // Check for tap
        if (duration < this.tapMaxDuration && distance < this.tapMaxDistance) {
          this.handleTap(touchState.currentX, touchState.currentY);
        }
        // Check for swipe
        else if (distance > this.swipeMinDistance && velocity > this.swipeMinVelocity) {
          const direction = new THREE.Vector2(dx, dy).normalize();
          this.handleSwipe(direction, velocity);
        }
        // Check for long press
        else if (duration > this.longPressMinDuration && distance < this.tapMaxDistance) {
          this.handleLongPress(touchState.currentX, touchState.currentY);
        }

        this.touches.delete(touch.identifier);
      }
    }

    // End pinch if needed
    if (this.touches.size < 2) {
      this.pinch.active = false;
      this.controls.enabled = true;
    }
  }

  private onTouchCancel(event: TouchEvent) {
    // Clean up cancelled touches
    for (let i = 0; i < event.changedTouches.length; i++) {
      const touch = event.changedTouches[i];
      this.touches.delete(touch.identifier);
    }

    if (this.touches.size < 2) {
      this.pinch.active = false;
      this.controls.enabled = true;
    }
  }

  private handleTap(x: number, y: number) {
    const position = new THREE.Vector2(
      (x / this.domElement.clientWidth) * 2 - 1,
      -(y / this.domElement.clientHeight) * 2 + 1
    );

    debug.log('Tap detected', { x, y, normalized: position });

    if (this.onTapCallback) {
      this.onTapCallback(position);
    }

    // Haptic feedback if available
    if ('vibrate' in navigator) {
      navigator.vibrate(10);
    }
  }

  private handleSwipe(direction: THREE.Vector2, velocity: number) {
    debug.log('Swipe detected', { direction, velocity });

    if (this.onSwipeCallback) {
      this.onSwipeCallback(direction, velocity);
    }
  }

  private handleLongPress(x: number, y: number) {
    const position = new THREE.Vector2(
      (x / this.domElement.clientWidth) * 2 - 1,
      -(y / this.domElement.clientHeight) * 2 + 1
    );

    debug.log('Long press detected', { x, y });

    if (this.onLongPressCallback) {
      this.onLongPressCallback(position);
    }

    // Stronger haptic feedback for long press
    if ('vibrate' in navigator) {
      navigator.vibrate([50, 50, 50]);
    }
  }

  // Public methods for setting callbacks
  public onTap(callback: (position: THREE.Vector2) => void) {
    this.onTapCallback = callback;
  }

  public onSwipe(callback: (direction: THREE.Vector2, velocity: number) => void) {
    this.onSwipeCallback = callback;
  }

  public onLongPress(callback: (position: THREE.Vector2) => void) {
    this.onLongPressCallback = callback;
  }

  // Gyroscope controls
  public async enableGyroscope(): Promise<boolean> {
    if (!this.supportsGyroscope) {
      await this.checkGyroscopeSupport();
    }

    if (!this.supportsGyroscope) {
      debug.warn('Gyroscope not supported or permission denied');
      return false;
    }

    window.addEventListener('deviceorientation', this.onDeviceOrientation.bind(this));
    this.gyroscopeActive = true;
    debug.log('Gyroscope controls enabled');
    return true;
  }

  public disableGyroscope() {
    window.removeEventListener('deviceorientation', this.onDeviceOrientation.bind(this));
    this.gyroscopeActive = false;
    debug.log('Gyroscope controls disabled');
  }

  private onDeviceOrientation(event: DeviceOrientationEvent) {
    if (!this.gyroscopeActive || !event.alpha || !event.beta || !event.gamma) return;

    // Convert device orientation to camera rotation
    // These values may need adjustment based on device orientation
    const alpha = (event.alpha * Math.PI) / 180; // Z axis
    const beta = (event.beta * Math.PI) / 180; // X axis
    const gamma = (event.gamma * Math.PI) / 180; // Y axis

    // Apply smooth rotation (you may need to adjust these based on testing)
    // This is a simplified implementation - production would need proper quaternion math
    this.controls.rotateSpeed = 0.5;
  }

  // Utility methods
  public isMobile(): boolean {
    return this.supportsTouch;
  }

  public vibrate(pattern: number | number[]) {
    if ('vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  }

  public dispose() {
    if (this.supportsTouch) {
      this.domElement.removeEventListener('touchstart', this.onTouchStart.bind(this));
      this.domElement.removeEventListener('touchmove', this.onTouchMove.bind(this));
      this.domElement.removeEventListener('touchend', this.onTouchEnd.bind(this));
      this.domElement.removeEventListener('touchcancel', this.onTouchCancel.bind(this));
    }

    if (this.gyroscopeActive) {
      this.disableGyroscope();
    }
  }
}
