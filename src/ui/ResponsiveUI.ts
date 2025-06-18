import GUI from 'lil-gui'
import { DeviceCapabilities } from '../utils/DeviceCapabilities'
import { debug } from '../utils/DebugLogger'

export interface UILayout {
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  scale: number
  collapsed: boolean
  opacity: number
  fontSize: number
}

export class ResponsiveUI {
  private gui: GUI
  private deviceCaps: DeviceCapabilities
  private layout: UILayout
  private mobileMenuButton?: HTMLDivElement
  private touchControlsOverlay?: HTMLDivElement
  
  constructor(gui: GUI) {
    this.gui = gui
    this.deviceCaps = DeviceCapabilities.getInstance()
    this.layout = this.determineLayout()
    
    this.applyResponsiveStyles()
    this.setupMobileUI()
    this.setupOrientationHandler()
  }
  
  private determineLayout(): UILayout {
    const deviceInfo = this.deviceCaps.getDeviceInfo()
    
    if (deviceInfo.isMobile) {
      return {
        position: 'top-right',
        scale: 1.2, // Larger for touch
        collapsed: true, // Start collapsed on mobile
        opacity: 0.9,
        fontSize: 14
      }
    } else if (deviceInfo.isTablet) {
      return {
        position: 'top-right',
        scale: 1.1,
        collapsed: false,
        opacity: 0.95,
        fontSize: 13
      }
    } else {
      return {
        position: 'top-right',
        scale: 1,
        collapsed: false,
        opacity: 1,
        fontSize: 12
      }
    }
  }
  
  private applyResponsiveStyles() {
    const guiElement = this.gui.domElement
    const deviceInfo = this.deviceCaps.getDeviceInfo()
    
    // Base styles
    guiElement.style.position = 'absolute'
    guiElement.style.opacity = this.layout.opacity.toString()
    guiElement.style.fontSize = `${this.layout.fontSize}px`
    guiElement.style.transform = `scale(${this.layout.scale})`
    guiElement.style.transformOrigin = 'top right'
    guiElement.style.maxHeight = '90vh'
    guiElement.style.overflowY = 'auto'
    guiElement.style.zIndex = '999'
    
    // Position based on layout
    switch (this.layout.position) {
      case 'top-right':
        guiElement.style.top = '10px'
        guiElement.style.right = '10px'
        break
      case 'top-left':
        guiElement.style.top = '10px'
        guiElement.style.left = '10px'
        break
      case 'bottom-right':
        guiElement.style.bottom = '10px'
        guiElement.style.right = '10px'
        break
      case 'bottom-left':
        guiElement.style.bottom = '10px'
        guiElement.style.left = '10px'
        break
    }
    
    // Mobile-specific styles
    if (deviceInfo.isMobile || deviceInfo.isTablet) {
      // Add touch-friendly spacing
      const style = document.createElement('style')
      style.textContent = `
        .lil-gui {
          --widget-height: 32px !important;
          --spacing: 6px !important;
          --title-height: 32px !important;
        }
        
        .lil-gui .controller {
          touch-action: none;
        }
        
        .lil-gui .controller.number input {
          font-size: 16px !important; /* Prevent zoom on iOS */
        }
        
        .lil-gui button {
          min-height: 32px !important;
          font-size: 14px !important;
        }
        
        /* Scrollbar for mobile */
        .lil-gui::-webkit-scrollbar {
          width: 8px;
        }
        
        .lil-gui::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.3);
          border-radius: 4px;
        }
      `
      document.head.appendChild(style)
      
      // Start collapsed on mobile
      if (this.layout.collapsed) {
        this.gui.close()
      }
    }
  }
  
  private setupMobileUI() {
    const deviceInfo = this.deviceCaps.getDeviceInfo()
    
    if (deviceInfo.isMobile || deviceInfo.isTablet) {
      // Create menu toggle button
      this.createMobileMenuButton()
      
      // Create touch controls overlay
      this.createTouchControlsOverlay()
    }
  }
  
  private createMobileMenuButton() {
    this.mobileMenuButton = document.createElement('div')
    this.mobileMenuButton.innerHTML = '☰'
    this.mobileMenuButton.style.cssText = `
      position: absolute;
      top: 10px;
      right: 10px;
      width: 44px;
      height: 44px;
      background: rgba(0, 0, 0, 0.7);
      color: white;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      cursor: pointer;
      z-index: 1000;
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
    `
    
    this.mobileMenuButton.addEventListener('click', () => {
      this.toggleGUI()
    })
    
    document.body.appendChild(this.mobileMenuButton)
    
    // Update button position when GUI is shown/hidden
    this.updateMenuButtonPosition()
  }
  
  private createTouchControlsOverlay() {
    this.touchControlsOverlay = document.createElement('div')
    this.touchControlsOverlay.style.cssText = `
      position: absolute;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.6);
      color: white;
      padding: 15px 25px;
      border-radius: 25px;
      font-family: monospace;
      font-size: 14px;
      text-align: center;
      z-index: 998;
      pointer-events: none;
      opacity: 0.8;
    `
    
    this.touchControlsOverlay.innerHTML = `
      <div style="margin-bottom: 8px"><b>Touch Controls</b></div>
      <div style="font-size: 12px; line-height: 1.4">
        Tap: Launch Interceptor<br>
        Pinch: Zoom Camera<br>
        Swipe: Rotate View<br>
        Long Press: Target Info
      </div>
    `
    
    document.body.appendChild(this.touchControlsOverlay)
    
    // Hide after 5 seconds
    setTimeout(() => {
      if (this.touchControlsOverlay) {
        this.touchControlsOverlay.style.transition = 'opacity 1s'
        this.touchControlsOverlay.style.opacity = '0'
        setTimeout(() => {
          this.touchControlsOverlay?.remove()
        }, 1000)
      }
    }, 5000)
  }
  
  private toggleGUI() {
    if (this.gui._closed) {
      this.gui.open()
      if (this.mobileMenuButton) {
        this.mobileMenuButton.innerHTML = '✕'
      }
    } else {
      this.gui.close()
      if (this.mobileMenuButton) {
        this.mobileMenuButton.innerHTML = '☰'
      }
    }
    this.updateMenuButtonPosition()
  }
  
  private updateMenuButtonPosition() {
    if (!this.mobileMenuButton) return
    
    const guiVisible = !this.gui._closed
    if (guiVisible) {
      // Move button to avoid overlap with GUI
      const guiWidth = this.gui.domElement.offsetWidth * this.layout.scale
      this.mobileMenuButton.style.right = `${guiWidth + 20}px`
    } else {
      this.mobileMenuButton.style.right = '10px'
    }
  }
  
  private setupOrientationHandler() {
    let lastOrientation = window.orientation
    
    window.addEventListener('orientationchange', () => {
      const newOrientation = window.orientation
      const isLandscape = Math.abs(newOrientation) === 90
      
      debug.log('Orientation changed:', {
        from: lastOrientation,
        to: newOrientation,
        isLandscape
      })
      
      // Update layout based on new orientation
      if (this.deviceCaps.isMobile()) {
        if (isLandscape) {
          // In landscape, move GUI to the side
          this.layout.position = 'top-right'
          this.layout.scale = 1.0
        } else {
          // In portrait, keep GUI compact
          this.layout.position = 'top-right'
          this.layout.scale = 1.2
        }
        
        this.applyResponsiveStyles()
      }
      
      lastOrientation = newOrientation
    })
  }
  
  // Public methods
  public showNotification(message: string, duration: number = 3000) {
    const notification = document.createElement('div')
    notification.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 20px 30px;
      border-radius: 10px;
      font-family: monospace;
      font-size: 16px;
      z-index: 9999;
      animation: fadeIn 0.3s ease-in;
      pointer-events: none;
    `
    notification.textContent = message
    
    // Add fade-in animation
    const style = document.createElement('style')
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
        to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
      }
    `
    document.head.appendChild(style)
    
    document.body.appendChild(notification)
    
    setTimeout(() => {
      notification.style.transition = 'opacity 0.3s'
      notification.style.opacity = '0'
      setTimeout(() => {
        notification.remove()
        style.remove()
      }, 300)
    }, duration)
  }
  
  public createMobileButton(text: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button')
    button.textContent = text
    button.style.cssText = `
      position: absolute;
      padding: 12px 24px;
      background: rgba(0, 0, 0, 0.7);
      color: white;
      border: 2px solid white;
      border-radius: 25px;
      font-family: monospace;
      font-size: 16px;
      cursor: pointer;
      z-index: 997;
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
    `
    
    button.addEventListener('click', () => {
      onClick()
      // Haptic feedback
      if ('vibrate' in navigator) {
        navigator.vibrate(10)
      }
    })
    
    return button
  }
  
  public dispose() {
    if (this.mobileMenuButton) {
      this.mobileMenuButton.remove()
    }
    if (this.touchControlsOverlay) {
      this.touchControlsOverlay.remove()
    }
  }
}