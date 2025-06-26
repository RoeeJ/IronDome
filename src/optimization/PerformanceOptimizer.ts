import * as THREE from 'three';
import { debug } from '../utils/logger';
import { SimpleLODSystem } from '../rendering/SimpleLODSystem';
import { PooledTrailSystem } from '../rendering/PooledTrailSystem';
import { InstancedBuildingRenderer } from '../rendering/InstancedBuildingRenderer';

interface PerformanceMetrics {
  fps: number;
  frameTime: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
}

interface OptimizationSettings {
  targetFPS: number;
  enableInstancing: boolean;
  enableLOD: boolean;
  enablePooledTrails: boolean;
  maxParticles: number;
  maxLights: number;
  shadowMapSize: number;
  renderScale: number;
}

/**
 * Performance optimization coordinator that monitors performance and
 * automatically adjusts quality settings to maintain target FPS.
 */
export class PerformanceOptimizer {
  private static instance: PerformanceOptimizer;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  
  // Performance monitoring
  private frameCount = 0;
  private lastTime = performance.now();
  private metrics: PerformanceMetrics = {
    fps: 60,
    frameTime: 16.67,
    drawCalls: 0,
    triangles: 0,
    geometries: 0,
    textures: 0,
    programs: 0,
  };
  
  // Settings
  private settings: OptimizationSettings = {
    targetFPS: 60,
    enableInstancing: true,
    enableLOD: true,
    enablePooledTrails: true,
    maxParticles: 5000,
    maxLights: 10,
    shadowMapSize: 2048,
    renderScale: 1.0,
  };
  
  // Optimization systems
  private lodSystem?: SimpleLODSystem;
  private trailSystem?: PooledTrailSystem;
  private buildingRenderer?: InstancedBuildingRenderer;
  
  // Quality levels
  private qualityLevel = 2; // 0=Low, 1=Medium, 2=High
  private readonly QUALITY_PRESETS = [
    // Low quality
    {
      maxParticles: 1000,
      maxLights: 5,
      shadowMapSize: 512,
      renderScale: 0.75,
      particleSize: 0.5,
    },
    // Medium quality  
    {
      maxParticles: 3000,
      maxLights: 8,
      shadowMapSize: 1024,
      renderScale: 0.9,
      particleSize: 0.75,
    },
    // High quality
    {
      maxParticles: 5000,
      maxLights: 10,
      shadowMapSize: 2048,
      renderScale: 1.0,
      particleSize: 1.0,
    },
  ];
  
  // Auto-adjustment
  private autoAdjust = true;
  private adjustmentCooldown = 0;
  private readonly ADJUSTMENT_INTERVAL = 2000; // Adjust every 2 seconds max

  private constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    
    this.detectDeviceCapabilities();
    this.initializeOptimizationSystems();
  }

  static getInstance(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera
  ): PerformanceOptimizer {
    if (!PerformanceOptimizer.instance) {
      PerformanceOptimizer.instance = new PerformanceOptimizer(renderer, scene, camera);
    }
    return PerformanceOptimizer.instance;
  }

  private detectDeviceCapabilities(): void {
    const gl = this.renderer.getContext();
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    
    if (debugInfo) {
      const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
      const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
      debug.log('GPU:', vendor, renderer);
    }
    
    // Detect mobile
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );
    
    // Set initial quality based on device
    if (isMobile) {
      this.qualityLevel = 0; // Low quality for mobile
      this.settings.targetFPS = 30; // Lower target FPS
      debug.log('Mobile device detected, using low quality settings');
    } else {
      // Check for high-end GPU indicators
      const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      if (maxTextureSize >= 16384) {
        this.qualityLevel = 2; // High quality
      } else if (maxTextureSize >= 8192) {
        this.qualityLevel = 1; // Medium quality
      } else {
        this.qualityLevel = 0; // Low quality
      }
    }
    
    this.applyQualityPreset(this.qualityLevel);
  }

  private initializeOptimizationSystems(): void {
    // Initialize LOD system
    if (this.settings.enableLOD) {
      this.lodSystem = SimpleLODSystem.getInstance(this.camera);
      debug.log('LOD system initialized');
    }
    
    // Initialize pooled trail system
    if (this.settings.enablePooledTrails) {
      this.trailSystem = PooledTrailSystem.getInstance(this.scene);
      debug.log('Pooled trail system initialized');
    }
    
    // Building renderer is initialized by BuildingSystem
  }

  /**
   * Update performance metrics and auto-adjust quality
   */
  update(deltaTime: number): void {
    this.frameCount++;
    const currentTime = performance.now();
    const elapsed = currentTime - this.lastTime;
    
    // Update metrics every second
    if (elapsed >= 1000) {
      this.metrics.fps = (this.frameCount * 1000) / elapsed;
      this.metrics.frameTime = elapsed / this.frameCount;
      
      // Get renderer info
      const info = this.renderer.info;
      this.metrics.drawCalls = info.render.calls;
      this.metrics.triangles = info.render.triangles;
      this.metrics.geometries = info.memory.geometries;
      this.metrics.textures = info.memory.textures;
      this.metrics.programs = info.programs?.length || 0;
      
      // Reset counters
      this.frameCount = 0;
      this.lastTime = currentTime;
      
      // Auto-adjust quality if enabled
      if (this.autoAdjust && this.adjustmentCooldown <= 0) {
        this.autoAdjustQuality();
      }
    }
    
    // Update cooldown
    if (this.adjustmentCooldown > 0) {
      this.adjustmentCooldown -= deltaTime;
    }
    
    // Update optimization systems
    if (this.lodSystem) {
      this.lodSystem.update();
    }
    
    if (this.trailSystem) {
      this.trailSystem.update();
    }
  }

  private autoAdjustQuality(): void {
    const targetFPS = this.settings.targetFPS;
    const currentFPS = this.metrics.fps;
    
    // Threshold for adjustment
    const lowerThreshold = targetFPS * 0.9; // 90% of target
    const upperThreshold = targetFPS * 1.1; // 110% of target
    
    if (currentFPS < lowerThreshold && this.qualityLevel > 0) {
      // Performance too low, reduce quality
      this.setQualityLevel(this.qualityLevel - 1);
      this.adjustmentCooldown = this.ADJUSTMENT_INTERVAL;
      debug.log(`Reducing quality to ${this.getQualityName()} (FPS: ${currentFPS.toFixed(1)})`);
    } else if (currentFPS > upperThreshold && this.qualityLevel < 2) {
      // Performance good, try increasing quality
      const headroom = currentFPS - targetFPS;
      if (headroom > 10) { // Only increase if we have significant headroom
        this.setQualityLevel(this.qualityLevel + 1);
        this.adjustmentCooldown = this.ADJUSTMENT_INTERVAL;
        debug.log(`Increasing quality to ${this.getQualityName()} (FPS: ${currentFPS.toFixed(1)})`);
      }
    }
  }

  /**
   * Set quality level (0=Low, 1=Medium, 2=High)
   */
  setQualityLevel(level: number): void {
    this.qualityLevel = Math.max(0, Math.min(2, level));
    this.applyQualityPreset(this.qualityLevel);
  }

  private applyQualityPreset(level: number): void {
    const preset = this.QUALITY_PRESETS[level];
    
    // Update settings
    this.settings.maxParticles = preset.maxParticles;
    this.settings.maxLights = preset.maxLights;
    this.settings.shadowMapSize = preset.shadowMapSize;
    this.settings.renderScale = preset.renderScale;
    
    // Apply shadow map size
    if (this.renderer.shadowMap) {
      // Would need to recreate shadow map with new size
      this.renderer.shadowMap.enabled = level > 0; // Disable shadows on low quality
    }
    
    // Apply render scale
    const canvas = this.renderer.domElement;
    const pixelRatio = Math.min(window.devicePixelRatio, 2) * preset.renderScale;
    this.renderer.setPixelRatio(pixelRatio);
    
    // Update LOD system if available
    if (this.lodSystem) {
      const distances = level === 0 
        ? [0, 30, 80, 150, 250] // Aggressive LOD for low quality
        : level === 1
        ? [0, 50, 120, 250, 400] // Moderate LOD for medium
        : [0, 80, 200, 400, 600]; // Relaxed LOD for high quality
        
      this.lodSystem.setConfig({ distances });
    }
  }

  /**
   * Get optimization recommendations based on current metrics
   */
  getOptimizationReport(): {
    issues: string[];
    recommendations: string[];
    metrics: PerformanceMetrics;
  } {
    const issues: string[] = [];
    const recommendations: string[] = [];
    
    // Check draw calls
    if (this.metrics.drawCalls > 100) {
      issues.push(`High draw calls: ${this.metrics.drawCalls}`);
      recommendations.push('Enable instancing for repeated objects');
      recommendations.push('Merge static geometry where possible');
    }
    
    // Check triangle count
    if (this.metrics.triangles > 1000000) {
      issues.push(`High triangle count: ${(this.metrics.triangles / 1000000).toFixed(1)}M`);
      recommendations.push('Implement LOD for complex models');
      recommendations.push('Reduce geometric complexity');
    }
    
    // Check texture memory
    if (this.metrics.textures > 50) {
      issues.push(`Many textures loaded: ${this.metrics.textures}`);
      recommendations.push('Implement texture atlasing');
      recommendations.push('Share materials between objects');
    }
    
    // Check shader programs
    if (this.metrics.programs > 30) {
      issues.push(`Many shader programs: ${this.metrics.programs}`);
      recommendations.push('Reuse materials with same properties');
      recommendations.push('Use MaterialCache for all materials');
    }
    
    // FPS specific recommendations
    if (this.metrics.fps < this.settings.targetFPS * 0.8) {
      recommendations.push('Consider reducing particle effects');
      recommendations.push('Disable shadows for distant objects');
      recommendations.push('Reduce number of dynamic lights');
    }
    
    return {
      issues,
      recommendations,
      metrics: { ...this.metrics },
    };
  }

  /**
   * Get current quality settings
   */
  getSettings(): OptimizationSettings {
    return { ...this.settings };
  }

  /**
   * Get quality level name
   */
  getQualityName(): string {
    return ['Low', 'Medium', 'High'][this.qualityLevel];
  }

  /**
   * Enable/disable auto quality adjustment
   */
  setAutoAdjust(enabled: boolean): void {
    this.autoAdjust = enabled;
    debug.log(`Auto quality adjustment ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Force garbage collection of unused resources
   */
  collectGarbage(): void {
    // Dispose of unused geometries
    this.scene.traverse(object => {
      if (object instanceof THREE.Mesh) {
        if (object.geometry && object.geometry.attributes.position.count === 0) {
          object.geometry.dispose();
        }
      }
    });
    
    // Clear renderer info
    this.renderer.info.reset();
    
    debug.log('Garbage collection completed');
  }

  /**
   * Get reference to optimization systems
   */
  getSystems(): {
    lod: SimpleLODSystem | undefined;
    trails: PooledTrailSystem | undefined;
    buildings: InstancedBuildingRenderer | undefined;
  } {
    return {
      lod: this.lodSystem,
      trails: this.trailSystem,
      buildings: this.buildingRenderer,
    };
  }
}