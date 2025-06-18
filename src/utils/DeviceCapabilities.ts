import { debug } from './DebugLogger'

export interface DeviceInfo {
  isMobile: boolean
  isTablet: boolean
  isDesktop: boolean
  hasTouch: boolean
  screenSize: 'small' | 'medium' | 'large'
  devicePixelRatio: number
  gpu: 'low' | 'medium' | 'high'
  memory: number // in GB
  cores: number
}

export interface PerformanceProfile {
  particleCount: number
  maxInterceptors: number
  shadowQuality: 'none' | 'low' | 'high'
  textureQuality: 'low' | 'medium' | 'high'
  effectsQuality: 'low' | 'medium' | 'high'
  targetFPS: number
  renderScale: number
}

export class DeviceCapabilities {
  private static instance: DeviceCapabilities
  private deviceInfo: DeviceInfo
  private performanceProfile: PerformanceProfile
  
  private constructor() {
    this.deviceInfo = this.detectDevice()
    this.performanceProfile = this.determinePerformanceProfile()
    this.logCapabilities()
  }
  
  static getInstance(): DeviceCapabilities {
    if (!DeviceCapabilities.instance) {
      DeviceCapabilities.instance = new DeviceCapabilities()
    }
    return DeviceCapabilities.instance
  }
  
  private detectDevice(): DeviceInfo {
    const userAgent = navigator.userAgent.toLowerCase()
    const width = window.innerWidth
    const height = window.innerHeight
    const minDimension = Math.min(width, height)
    const maxDimension = Math.max(width, height)
    
    // Detect device type
    const isMobile = /android|webos|iphone|ipod|blackberry|iemobile|opera mini/i.test(userAgent)
    const isTablet = /ipad|android|tablet/i.test(userAgent) && minDimension >= 600
    const isDesktop = !isMobile && !isTablet
    const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0
    
    // Determine screen size category
    let screenSize: 'small' | 'medium' | 'large'
    if (maxDimension < 768) {
      screenSize = 'small'
    } else if (maxDimension < 1366) {
      screenSize = 'medium'
    } else {
      screenSize = 'large'
    }
    
    // Get hardware info
    const devicePixelRatio = window.devicePixelRatio || 1
    const memory = (navigator as any).deviceMemory || 4 // Default to 4GB if not available
    const cores = navigator.hardwareConcurrency || 4
    
    // Estimate GPU tier based on various factors
    const gpu = this.estimateGPUTier(devicePixelRatio, memory, cores, isMobile)
    
    return {
      isMobile,
      isTablet,
      isDesktop,
      hasTouch,
      screenSize,
      devicePixelRatio,
      gpu,
      memory,
      cores
    }
  }
  
  private estimateGPUTier(pixelRatio: number, memory: number, cores: number, isMobile: boolean): 'low' | 'medium' | 'high' {
    // Simple heuristic for GPU tier estimation
    let score = 0
    
    // Mobile devices generally have lower GPU performance
    if (isMobile) {
      score -= 2
    }
    
    // High pixel ratio might indicate newer device
    if (pixelRatio >= 2) {
      score += 1
    }
    if (pixelRatio >= 3) {
      score += 1
    }
    
    // Memory is a good indicator
    if (memory >= 8) {
      score += 2
    } else if (memory >= 4) {
      score += 1
    }
    
    // Core count
    if (cores >= 8) {
      score += 2
    } else if (cores >= 4) {
      score += 1
    }
    
    // Determine tier
    if (score >= 3) {
      return 'high'
    } else if (score >= 0) {
      return 'medium'
    } else {
      return 'low'
    }
  }
  
  private determinePerformanceProfile(): PerformanceProfile {
    const { isMobile, isTablet, gpu, screenSize, devicePixelRatio } = this.deviceInfo
    
    // Base profiles for different device types
    let profile: PerformanceProfile
    
    if (isMobile) {
      // Mobile profile - aggressive optimization
      profile = {
        particleCount: gpu === 'high' ? 50 : 30,
        maxInterceptors: gpu === 'high' ? 6 : 4,
        shadowQuality: gpu === 'high' ? 'low' : 'none',
        textureQuality: gpu === 'high' ? 'medium' : 'low',
        effectsQuality: gpu === 'high' ? 'medium' : 'low',
        targetFPS: 30,
        renderScale: Math.min(1, 2 / devicePixelRatio) // Reduce resolution on high DPI
      }
    } else if (isTablet) {
      // Tablet profile - balanced
      profile = {
        particleCount: gpu === 'high' ? 80 : 50,
        maxInterceptors: gpu === 'high' ? 8 : 6,
        shadowQuality: gpu === 'high' ? 'high' : 'low',
        textureQuality: gpu === 'high' ? 'high' : 'medium',
        effectsQuality: gpu === 'high' ? 'high' : 'medium',
        targetFPS: gpu === 'high' ? 60 : 30,
        renderScale: gpu === 'high' ? 1 : 0.8
      }
    } else {
      // Desktop profile - full quality
      profile = {
        particleCount: gpu === 'high' ? 200 : gpu === 'medium' ? 100 : 50,
        maxInterceptors: gpu === 'high' ? 12 : gpu === 'medium' ? 8 : 6,
        shadowQuality: gpu === 'high' ? 'high' : gpu === 'medium' ? 'high' : 'low',
        textureQuality: 'high',
        effectsQuality: gpu === 'high' ? 'high' : gpu === 'medium' ? 'medium' : 'low',
        targetFPS: 60,
        renderScale: 1
      }
    }
    
    // Adjust for screen size
    if (screenSize === 'small' && profile.particleCount > 50) {
      profile.particleCount = Math.floor(profile.particleCount * 0.7)
    }
    
    return profile
  }
  
  private logCapabilities() {
    debug.log('Device Capabilities Detected:', {
      device: this.deviceInfo,
      performance: this.performanceProfile
    })
  }
  
  // Public API
  getDeviceInfo(): DeviceInfo {
    return { ...this.deviceInfo }
  }
  
  getPerformanceProfile(): PerformanceProfile {
    return { ...this.performanceProfile }
  }
  
  isMobile(): boolean {
    return this.deviceInfo.isMobile
  }
  
  isTablet(): boolean {
    return this.deviceInfo.isTablet
  }
  
  isDesktop(): boolean {
    return this.deviceInfo.isDesktop
  }
  
  hasTouch(): boolean {
    return this.deviceInfo.hasTouch
  }
  
  // Quality adjustment methods
  adjustParticleCount(baseCount: number): number {
    const ratio = this.performanceProfile.particleCount / 100
    return Math.floor(baseCount * ratio)
  }
  
  shouldEnableShadows(): boolean {
    return this.performanceProfile.shadowQuality !== 'none'
  }
  
  getTextureScale(): number {
    switch (this.performanceProfile.textureQuality) {
      case 'low': return 0.5
      case 'medium': return 0.75
      case 'high': return 1
    }
  }
  
  getMaxSimultaneousInterceptors(): number {
    return this.performanceProfile.maxInterceptors
  }
  
  getTargetFPS(): number {
    return this.performanceProfile.targetFPS
  }
  
  getRenderScale(): number {
    return this.performanceProfile.renderScale
  }
  
  // Dynamic quality adjustment based on runtime performance
  adjustQualityForFPS(currentFPS: number): void {
    const targetFPS = this.performanceProfile.targetFPS
    const threshold = targetFPS * 0.9 // 90% of target
    
    if (currentFPS < threshold) {
      // Reduce quality
      if (this.performanceProfile.particleCount > 20) {
        this.performanceProfile.particleCount = Math.floor(this.performanceProfile.particleCount * 0.8)
        debug.log('Reducing particle count due to low FPS:', this.performanceProfile.particleCount)
      }
      if (this.performanceProfile.renderScale > 0.5) {
        this.performanceProfile.renderScale = Math.max(0.5, this.performanceProfile.renderScale - 0.1)
        debug.log('Reducing render scale due to low FPS:', this.performanceProfile.renderScale)
      }
    }
  }
}