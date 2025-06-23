import { Profiler } from '../utils/Profiler';

export class ProfilerDisplay {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private profiler: Profiler;
  private visible: boolean = false;
  private updateInterval: number = 100; // ms
  private lastUpdate: number = 0;
  private expandedSections: Set<string> = new Set(['Frame', 'Render', 'Interception System']); // Auto-expand these
  private renderStats: any = null;

  constructor(profiler: Profiler) {
    this.profiler = profiler;

    // Create canvas
    this.canvas = document.createElement('canvas');
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '320px';
    this.canvas.style.left = '10px';
    this.canvas.style.width = '400px';
    this.canvas.style.height = '250px';
    this.canvas.style.backgroundColor = 'rgba(20, 20, 30, 0.95)';
    this.canvas.style.border = '1px solid rgba(100, 100, 255, 0.3)';
    this.canvas.style.borderRadius = '8px';
    this.canvas.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.5)';
    this.canvas.style.display = 'none';
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.zIndex = '1001';
    this.canvas.style.fontFamily =
      "'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, monospace";
    this.canvas.width = 400;
    this.canvas.height = 250;

    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    // Set up keyboard toggle
    window.addEventListener('keydown', e => {
      if (e.key === 'p' || e.key === 'P') {
        this.toggle();
      }
    });
  }

  toggle(): void {
    this.visible = !this.visible;
    this.canvas.style.display = this.visible ? 'block' : 'none';
    // Save visibility state to localStorage
    localStorage.setItem('ironDome_profilerVisible', this.visible.toString());
  }

  show(): void {
    this.visible = true;
    this.canvas.style.display = 'block';
    localStorage.setItem('ironDome_profilerVisible', 'true');
  }

  hide(): void {
    this.visible = false;
    this.canvas.style.display = 'none';
    localStorage.setItem('ironDome_profilerVisible', 'false');
  }

  isVisible(): boolean {
    return this.visible;
  }

  update(): void {
    if (!this.visible) return;

    const now = performance.now();
    if (now - this.lastUpdate < this.updateInterval) return;
    this.lastUpdate = now;

    // Calculate required height based on content
    const averages = this.profiler.getAverages();
    const sectionCount = averages.size;
    const baseHeight = 150; // Header + summary
    const sectionHeight = 18;
    const requiredHeight = Math.min(600, baseHeight + sectionCount * sectionHeight);

    // Resize canvas if needed
    if (this.canvas.height !== requiredHeight) {
      this.canvas.height = requiredHeight;
      this.canvas.style.height = requiredHeight + 'px';
    }

    // Clear canvas
    this.ctx.fillStyle = 'rgba(20, 20, 30, 0.95)';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw header
    this.ctx.fillStyle = '#6e7edb';
    this.ctx.font = 'bold 13px monospace';
    this.ctx.fillText('Performance Profiler (P)', 10, 20);

    // Get profiler data
    const hotspots = this.profiler.getHotspots(1); // Show everything above 1ms

    // Draw hierarchical timing data
    const y = 45;
    const barHeight = 16;
    const maxBarWidth = 350;
    const indentWidth = 15;

    // Find max time for scaling
    const averageValues = Array.from(averages.values());
    const maxTime = averageValues.length > 0 ? Math.max(...averageValues, 16.67) : 16.67; // At least one frame time

    // Draw frame time reference line (60 FPS = 16.67ms)
    this.ctx.strokeStyle = 'rgba(255, 200, 0, 0.5)';
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([3, 3]);
    const frameLineX = 10 + (16.67 / maxTime) * maxBarWidth;
    this.ctx.beginPath();
    this.ctx.moveTo(frameLineX, 35);
    this.ctx.lineTo(frameLineX, this.canvas.height - 20);
    this.ctx.stroke();
    this.ctx.setLineDash([]);

    this.ctx.font = '9px monospace';
    this.ctx.fillStyle = 'rgba(255, 200, 0, 0.8)';
    this.ctx.fillText('60 FPS', frameLineX + 3, 42);

    // Draw hierarchical sections
    const sectionsEndY = this.drawHierarchicalSections(
      y,
      barHeight,
      maxBarWidth,
      indentWidth,
      maxTime
    );

    // Draw render stats if available
    this.drawRenderStats(sectionsEndY + 20);

    // Draw summary
    const totalTime = Array.from(averages.values()).reduce((a, b) => a + b, 0);
    this.ctx.fillStyle = '#a3b3ff';
    this.ctx.font = '11px monospace';
    this.ctx.fillText(`Frame: ${totalTime.toFixed(2)}ms`, 10, this.canvas.height - 25);
    this.ctx.fillText(`FPS: ${(1000 / totalTime).toFixed(0)}`, 150, this.canvas.height - 25);

    // Draw warning if over budget
    if (totalTime > 16.67) {
      this.ctx.fillStyle = '#ff6b6b';
      this.ctx.font = 'bold 11px monospace';
      this.ctx.fillText('⚠ OVER BUDGET', 230, this.canvas.height - 25);
    }

    // Draw help text
    this.ctx.fillStyle = 'rgba(150, 150, 180, 0.6)';
    this.ctx.font = '9px monospace';
    this.ctx.fillText('Press P to hide', 10, this.canvas.height - 8);
  }

  private drawHierarchicalSections(
    startY: number,
    barHeight: number,
    maxBarWidth: number,
    indentWidth: number,
    maxTime: number
  ): number {
    const averages = this.profiler.getAverages();
    let y = startY;

    // Define hierarchy
    const hierarchy = [
      {
        name: 'Frame',
        children: [
          'Performance Monitor',
          'Physics',
          'Threat Manager',
          'Radar Network',
          'Projectiles',
          {
            name: 'Interception System',
            children: [
              'Battery Updates',
              'Fragmentation System',
              'Debris System',
              'Fragment Hit Detection',
              'Interceptor Updates',
              'Evaluate Threats',
              'Check Interceptions',
              'Cleanup',
            ],
          },
          'GUI Update',
          'Controls',
          {
            name: 'Render',
            children: ['Scene Analysis', 'Renderer Prepare', 'WebGL Render'],
          },
        ],
      },
    ];

    // Draw sections recursively
    const drawSection = (section: any, indent: number) => {
      if (y > this.canvas.height - 60) return;

      const sectionName = typeof section === 'string' ? section : section.name;
      const avgTime = averages.get(sectionName) || 0;

      if (avgTime > 0.01) {
        // Only show if > 0.01ms
        const barWidth = (avgTime / maxTime) * maxBarWidth;
        const x = 10 + indent * indentWidth;

        // Color based on performance impact
        let color = '#4ade80'; // Green
        if (avgTime > 16.67)
          color = '#ef4444'; // Red if over frame budget
        else if (avgTime > 8)
          color = '#f97316'; // Orange if over half frame
        else if (avgTime > 4)
          color = '#fbbf24'; // Yellow if significant
        else if (avgTime > 2) color = '#84cc16'; // Light green

        // Draw bar background
        this.ctx.fillStyle = 'rgba(100, 100, 150, 0.2)';
        this.ctx.fillRect(x, y, maxBarWidth, barHeight - 2);

        // Draw bar
        this.ctx.fillStyle = color;
        this.ctx.globalAlpha = 0.8;
        this.ctx.fillRect(x, y, barWidth, barHeight - 2);
        this.ctx.globalAlpha = 1.0;

        // Draw text
        this.ctx.font = indent > 0 ? '10px monospace' : '11px monospace';
        this.ctx.fillStyle = indent > 0 ? 'rgba(255, 255, 255, 0.8)' : '#ffffff';
        const prefix = indent > 0 ? '└─ ' : '';
        this.ctx.fillText(`${prefix}${sectionName}: ${avgTime.toFixed(2)}ms`, x + 5, y + 13);

        y += barHeight;

        // Draw children if expanded
        if (
          typeof section === 'object' &&
          section.children &&
          this.expandedSections.has(sectionName)
        ) {
          section.children.forEach((child: any) => {
            drawSection(child, indent + 1);
          });
        }
      }
    };

    hierarchy.forEach(section => drawSection(section, 0));

    return y;
  }

  setRenderStats(stats: any): void {
    this.renderStats = stats;
  }

  private drawRenderStats(startY: number): void {
    if (!this.renderStats) return;

    let y = startY;

    // Draw header
    this.ctx.fillStyle = '#00ffff';
    this.ctx.font = 'bold 12px monospace';
    this.ctx.fillText('RENDER STATISTICS', 10, y);
    y += 20;

    // Draw stats
    this.ctx.fillStyle = '#aaaaaa';
    this.ctx.font = '11px monospace';

    const stats = [
      `Draw Calls: ${this.renderStats.calls || 0}`,
      `Triangles: ${(this.renderStats.triangles || 0).toLocaleString()}`,
      `Points: ${(this.renderStats.points || 0).toLocaleString()}`,
      `Meshes: ${this.renderStats.meshes || 0}`,
      `Particles: ${this.renderStats.particles || 0}`,
      `Transparent: ${this.renderStats.transparent || 0}`,
    ];

    stats.forEach(stat => {
      this.ctx.fillText(stat, 20, y);
      y += 15;
    });
  }

  destroy(): void {
    if (this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
  }
}
