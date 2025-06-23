import { InterceptionSystem } from '@/scene/InterceptionSystem';
import { ThreatManager } from '@/scene/ThreatManager';
import { ResourceManager } from '@/game/ResourceManager';
import { GameState } from '@/game/GameState';
export class ExtendedStatsDisplay {
  private container: HTMLDivElement;
  private statsElement: HTMLDivElement;
  private updateInterval: number = 500; // Update every 500ms
  private lastUpdate: number = 0;
  private visible: boolean = false;
  private isDragging: boolean = false;
  private dragOffset = { x: 0, y: 0 };

  private interceptionSystem?: InterceptionSystem;
  private threatManager?: ThreatManager;
  private resourceManager: ResourceManager;
  private gameState: GameState;

  constructor() {
    this.resourceManager = ResourceManager.getInstance();
    this.gameState = GameState.getInstance();

    // Load saved position and visibility
    const savedState = localStorage.getItem('extendedStatsState');
    if (savedState) {
      const state = JSON.parse(savedState);
      this.visible = state.visible || false;
    }

    // Create container
    this.container = document.createElement('div');
    this.container.style.cssText = `
      position: absolute;
      top: 80px;
      right: 10px;
      background: rgba(0, 0, 0, 0.8);
      color: #fff;
      padding: 10px;
      font-family: monospace;
      font-size: 12px;
      border-radius: 5px;
      min-width: 250px;
      z-index: 1000;
      user-select: none;
      cursor: move;
      display: ${this.visible ? 'block' : 'none'};
    `;

    // Load saved position
    if (savedState) {
      const state = JSON.parse(savedState);
      if (state.x !== undefined && state.y !== undefined) {
        this.container.style.left = state.x + 'px';
        this.container.style.top = state.y + 'px';
        this.container.style.right = 'auto';
      }
    }

    this.statsElement = document.createElement('div');
    this.container.appendChild(this.statsElement);
    document.body.appendChild(this.container);

    // Add drag event handlers
    this.setupDragHandlers();

    // Add header
    const header = document.createElement('div');
    header.style.cssText = `
      font-weight: bold;
      margin-bottom: 5px;
      padding-bottom: 5px;
      border-bottom: 1px solid #444;
    `;
    header.textContent = '📊 Extended Stats (S to toggle)';
    this.container.insertBefore(header, this.statsElement);

    // Toggle visibility with stats.js
    document.addEventListener('keydown', e => {
      if (e.key === 'h' && e.ctrlKey) {
        this.toggleVisibility();
      }
    });
  }

  setInterceptionSystem(system: InterceptionSystem): void {
    this.interceptionSystem = system;
  }

  setThreatManager(manager: ThreatManager): void {
    this.threatManager = manager;
  }

  update(): void {
    const now = performance.now();
    if (now - this.lastUpdate < this.updateInterval) return;
    this.lastUpdate = now;

    if (!this.interceptionSystem || !this.threatManager) return;

    const stats = this.interceptionSystem.getStats();
    const threats = this.threatManager.getActiveThreats();
    const resources = {
      interceptors: this.resourceManager.getInterceptorStock(),
      credits: this.resourceManager.getCredits(),
    };

    // Calculate additional metrics
    const successRate =
      stats.successful + stats.failed > 0
        ? ((stats.successful / (stats.successful + stats.failed)) * 100).toFixed(1)
        : '0.0';

    const interceptorEfficiency =
      stats.successful > 0
        ? (
            stats.successful /
            Math.max(1, stats.successful + stats.failed + stats.activeInterceptors)
          ).toFixed(2)
        : '0.00';

    // Build stats HTML
    const html = `
      <div style="line-height: 1.4;">
        <div style="color: #4fc3f7;"><b>🎯 Interception System</b></div>
        <div>Mode: <span style="color: ${stats.algorithmMode === 'improved' ? '#81c784' : '#ffd54f'}">${stats.algorithmMode}</span></div>
        <div>Total Fired: ${stats.totalFired || 0}</div>
        <div>Hits/Misses: <span style="color: #81c784">${stats.successful}</span>/<span style="color: #e57373">${stats.failed}</span></div>
        <div>Hit Rate: <span style="color: ${parseFloat(successRate) > 80 ? '#81c784' : '#ffd54f'}">${successRate}%</span></div>
        <div>In Flight: ${stats.active}</div>
        <div>Efficiency: ${interceptorEfficiency}</div>
        
        <div style="margin-top: 8px; color: #ff8a65;"><b>🚀 Threats</b></div>
        <div>Active: ${threats.length}</div>
        <div>Types: ${this.getThreatBreakdown(threats)}</div>
        
        ${
          (window as any).__simulationControls?.gameMode !== false
            ? `
        <div style="margin-top: 8px; color: #ba68c8;"><b>🏭 Resources</b></div>
        <div>Interceptors: ${resources.interceptors}</div>
        <div>Credits: $${resources.credits.toLocaleString()}</div>
        `
            : ''
        }
        <div>Batteries: ${stats.batteries}</div>
        <div>Total Tubes: ${stats.totalInterceptors}</div>
        
        <div style="margin-top: 8px; color: #4db6ac;"><b>🔧 Coordination</b></div>
        <div>Status: <span style="color: ${stats.coordination.enabled ? '#81c784' : '#ffd54f'}">${stats.coordination.enabled ? 'Enabled' : 'Disabled'}</span></div>
        <div>Assignments: ${stats.coordination.activeAssignments}</div>
    </div>`;

    this.statsElement.innerHTML = html;
  }

  private getThreatBreakdown(threats: any[]): string {
    const types: Record<string, number> = {};
    threats.forEach(threat => {
      types[threat.type] = (types[threat.type] || 0) + 1;
    });

    return (
      Object.entries(types)
        .map(([type, count]) => `${type}:${count}`)
        .join(', ') || 'None'
    );
  }

  private setupDragHandlers(): void {
    this.container.addEventListener('mousedown', e => {
      this.isDragging = true;
      const rect = this.container.getBoundingClientRect();
      this.dragOffset.x = e.clientX - rect.left;
      this.dragOffset.y = e.clientY - rect.top;
      e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
      if (!this.isDragging) return;

      const x = e.clientX - this.dragOffset.x;
      const y = e.clientY - this.dragOffset.y;

      this.container.style.left = x + 'px';
      this.container.style.top = y + 'px';
      this.container.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
      if (this.isDragging) {
        this.isDragging = false;
        this.saveState();
      }
    });
  }

  private saveState(): void {
    const rect = this.container.getBoundingClientRect();
    const state = {
      visible: this.visible,
      x: rect.left,
      y: rect.top,
    };
    localStorage.setItem('extendedStatsState', JSON.stringify(state));
  }

  toggleVisibility(): void {
    this.visible = !this.visible;
    this.container.style.display = this.visible ? 'block' : 'none';
    this.saveState();
  }

  isVisible(): boolean {
    return this.visible;
  }

  destroy(): void {
    document.body.removeChild(this.container);
  }
}
