/**
 * Memory monitoring system to detect WebGL memory leaks and prevent crashes
 */

import { debug } from './logger';

interface MemoryStats {
  usedJSSize: number;
  totalJSSize: number;
  usedJSPercent: number;
  performanceMemory?: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
}

interface WebGLInfo {
  vendor: string;
  renderer: string;
  version: string;
  maxTextures: number;
  maxTextureSize: number;
  maxVertexUniforms: number;
  maxFragmentUniforms: number;
}

export class MemoryMonitor {
  private static instance: MemoryMonitor;
  private isMonitoring = false;
  private monitoringInterval?: NodeJS.Timeout;
  private lastStats?: MemoryStats;
  private webglInfo?: WebGLInfo;
  private consecutiveHighMemoryWarnings = 0;

  // Critical thresholds
  private static readonly MEMORY_WARNING_THRESHOLD = 0.75; // 75%
  private static readonly MEMORY_CRITICAL_THRESHOLD = 0.90; // 90%
  private static readonly MAX_CONSECUTIVE_WARNINGS = 5;

  static getInstance(): MemoryMonitor {
    if (!MemoryMonitor.instance) {
      MemoryMonitor.instance = new MemoryMonitor();
    }
    return MemoryMonitor.instance;
  }

  private constructor() {
    this.detectWebGLInfo();
  }

  startMonitoring(intervalMs: number = 5000): void {
    if (this.isMonitoring) return;

    this.isMonitoring = true;
    debug.log('[MemoryMonitor] Starting memory monitoring', { intervalMs });

    this.monitoringInterval = setInterval(() => {
      this.checkMemoryUsage();
    }, intervalMs);

    // Initial check
    this.checkMemoryUsage();
  }

  stopMonitoring(): void {
    if (!this.isMonitoring) return;

    this.isMonitoring = false;
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
    debug.log('[MemoryMonitor] Stopped memory monitoring');
  }

  private detectWebGLInfo(): void {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) {
        debug.warn('[MemoryMonitor] WebGL not available');
        return;
      }

      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      this.webglInfo = {
        vendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : 'Unknown',
        renderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'Unknown',
        version: gl.getParameter(gl.VERSION),
        maxTextures: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
        maxVertexUniforms: gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS),
        maxFragmentUniforms: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
      };

      debug.log('[MemoryMonitor] WebGL Info detected', this.webglInfo);
    } catch (error) {
      debug.error('[MemoryMonitor] Failed to detect WebGL info', error);
    }
  }

  private checkMemoryUsage(): void {
    const stats = this.getMemoryStats();
    if (!stats) return;

    const previousStats = this.lastStats;
    this.lastStats = stats;

    // Calculate memory growth
    let memoryGrowth = 0;
    if (previousStats) {
      memoryGrowth = stats.usedJSSize - previousStats.usedJSSize;
    }

    // Log periodic status
    debug.category('MemoryMonitor', 
      `Memory: ${(stats.usedJSSize / 1024 / 1024).toFixed(1)}MB (${stats.usedJSPercent.toFixed(1)}%), ` +
      `Growth: ${memoryGrowth > 0 ? '+' : ''}${(memoryGrowth / 1024 / 1024).toFixed(2)}MB`
    );

    // Check for warnings
    if (stats.usedJSPercent >= MemoryMonitor.MEMORY_CRITICAL_THRESHOLD) {
      this.consecutiveHighMemoryWarnings++;
      debug.error('[MemoryMonitor] CRITICAL MEMORY USAGE', {
        usedPercent: stats.usedJSPercent,
        usedMB: stats.usedJSSize / 1024 / 1024,
        totalMB: stats.totalJSSize / 1024 / 1024,
        consecutiveWarnings: this.consecutiveHighMemoryWarnings
      });

      if (this.consecutiveHighMemoryWarnings >= MemoryMonitor.MAX_CONSECUTIVE_WARNINGS) {
        this.triggerEmergencyCleanup();
      }
    } else if (stats.usedJSPercent >= MemoryMonitor.MEMORY_WARNING_THRESHOLD) {
      this.consecutiveHighMemoryWarnings++;
      debug.warn('[MemoryMonitor] High memory usage detected', {
        usedPercent: stats.usedJSPercent,
        usedMB: stats.usedJSSize / 1024 / 1024,
        growthMB: memoryGrowth / 1024 / 1024
      });
    } else {
      this.consecutiveHighMemoryWarnings = 0;
    }

    // Check for rapid growth (>10MB in one interval)
    if (memoryGrowth > 10 * 1024 * 1024) {
      debug.error('[MemoryMonitor] Rapid memory growth detected!', {
        growthMB: memoryGrowth / 1024 / 1024,
        currentMB: stats.usedJSSize / 1024 / 1024
      });
    }
  }

  private getMemoryStats(): MemoryStats | null {
    try {
      // Modern browsers with performance.memory
      if ('performance' in window && 'memory' in (performance as any)) {
        const memory = (performance as any).memory;
        return {
          usedJSSize: memory.usedJSHeapSize,
          totalJSSize: memory.totalJSHeapSize,
          usedJSPercent: (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100,
          performanceMemory: {
            usedJSHeapSize: memory.usedJSHeapSize,
            totalJSHeapSize: memory.totalJSHeapSize,
            jsHeapSizeLimit: memory.jsHeapSizeLimit,
          }
        };
      }

      // Fallback estimation
      debug.warn('[MemoryMonitor] performance.memory not available, using estimation');
      return null;
    } catch (error) {
      debug.error('[MemoryMonitor] Failed to get memory stats', error);
      return null;
    }
  }

  private triggerEmergencyCleanup(): void {
    debug.error('[MemoryMonitor] TRIGGERING EMERGENCY CLEANUP - WebGL crash imminent!');
    
    // Emit global cleanup event
    window.dispatchEvent(new CustomEvent('emergency-memory-cleanup', {
      detail: { reason: 'Memory usage critical', stats: this.lastStats }
    }));

    // Force garbage collection if available
    if ('gc' in window) {
      debug.log('[MemoryMonitor] Forcing garbage collection');
      (window as any).gc();
    }

    // Reset consecutive warnings after emergency cleanup
    this.consecutiveHighMemoryWarnings = 0;
  }

  getWebGLInfo(): WebGLInfo | undefined {
    return this.webglInfo;
  }

  getCurrentStats(): MemoryStats | undefined {
    return this.lastStats;
  }

  // Manual cleanup trigger for development
  forceCleanup(): void {
    debug.log('[MemoryMonitor] Manual cleanup triggered');
    this.triggerEmergencyCleanup();
  }
}

// Make available globally for debugging
if (typeof window !== 'undefined') {
  (window as any).memoryMonitor = MemoryMonitor.getInstance();
  (window as any).forceCleanup = () => MemoryMonitor.getInstance().forceCleanup();
}