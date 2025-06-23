export class PerformanceMonitor {
  private fpsHistory: number[] = [];
  private readonly historyLength = 60; // 1 second of history at 60fps
  private lowFpsThreshold = 30;
  private criticalFpsThreshold = 15;
  private lastWarningTime = 0;
  private warningCooldown = 5000; // 5 seconds between warnings

  update(fps: number): void {
    this.fpsHistory.push(fps);
    if (this.fpsHistory.length > this.historyLength) {
      this.fpsHistory.shift();
    }
  }

  getAverageFPS(): number {
    if (this.fpsHistory.length === 0) return 0;
    const sum = this.fpsHistory.reduce((a, b) => a + b, 0);
    return sum / this.fpsHistory.length;
  }

  getMinFPS(): number {
    if (this.fpsHistory.length === 0) return 0;
    return Math.min(...this.fpsHistory);
  }

  shouldReduceEffects(): boolean {
    const avgFPS = this.getAverageFPS();
    return avgFPS < this.lowFpsThreshold && avgFPS > 0;
  }

  isCritical(): boolean {
    const minFPS = this.getMinFPS();
    return minFPS < this.criticalFpsThreshold && minFPS > 0;
  }

  checkPerformance(): { warning: boolean; message: string } {
    const now = Date.now();
    if (now - this.lastWarningTime < this.warningCooldown) {
      return { warning: false, message: '' };
    }

    const avgFPS = this.getAverageFPS();
    const minFPS = this.getMinFPS();

    if (minFPS < this.criticalFpsThreshold && minFPS > 0) {
      this.lastWarningTime = now;
      return {
        warning: true,
        message: `Performance Critical: ${minFPS.toFixed(0)} FPS - Reducing effects`,
      };
    }

    if (avgFPS < this.lowFpsThreshold && avgFPS > 0) {
      this.lastWarningTime = now;
      return {
        warning: true,
        message: `Performance Warning: ${avgFPS.toFixed(0)} FPS average`,
      };
    }

    return { warning: false, message: '' };
  }

  getStats() {
    return {
      current: this.fpsHistory[this.fpsHistory.length - 1] || 0,
      average: this.getAverageFPS(),
      min: this.getMinFPS(),
      shouldReduce: this.shouldReduceEffects(),
      isCritical: this.isCritical(),
    };
  }
}
