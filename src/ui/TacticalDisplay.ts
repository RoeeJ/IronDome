import * as THREE from 'three';
import { Threat } from '../entities/Threat';
import { DeviceCapabilities } from '../utils/DeviceCapabilities';

export class TacticalDisplay {
  private canvas: HTMLCanvasElement;
  private container: HTMLDivElement;
  private ctx: CanvasRenderingContext2D;
  private radarCenter: { x: number; y: number };
  private radarRadius: number;
  private scale: number = 0.5; // World units to pixels
  private threatTracks: Map<
    Threat,
    { id: string; positions: THREE.Vector2[]; firstDetected: number; pinged: boolean }
  > = new Map();
  private nextId: number = 1;
  private radarPings: { position: THREE.Vector2; time: number }[] = [];

  // Performance optimizations
  private lastSweepAngle: number = 0;
  private frameSkip: number = 0;
  private readonly TRACK_HISTORY_LENGTH = 10; // Reduced from 20
  private readonly UPDATE_SKIP_FRAMES = 0; // Update every frame for smooth display

  // Animation timers
  private animationTime: number = 0;
  private glitchTimer: number = 0;
  private scanlineOffset: number = 0;

  constructor() {
    this.initialize();
  }

  private initialize(): void {
    const deviceCaps = DeviceCapabilities.getInstance();
    const deviceInfo = deviceCaps.getDeviceInfo();

    // Adjust size based on device - much smaller for mobile
    const baseSize = deviceInfo.isMobile ? 120 : deviceInfo.isTablet ? 180 : 300;
    const scale = deviceInfo.devicePixelRatio > 2 ? 2 : 1;

    // Create canvas overlay
    this.canvas = document.createElement('canvas');
    this.canvas.width = baseSize * scale;
    this.canvas.height = baseSize * scale;

    // Add modern styling with circular shape
    this.canvas.style.background = 'transparent';
    this.canvas.style.borderRadius = '50%';
    this.canvas.style.overflow = 'hidden';
    this.canvas.style.boxShadow = '0 0 20px rgba(0, 255, 255, 0.3)';

    // Mobile-specific adjustments
    if (deviceInfo.isMobile) {
      this.canvas.style.opacity = '0.9';
      // Add a subtle border for better visibility
      this.canvas.style.border = '1px solid rgba(0, 255, 255, 0.3)';
    }

    // Create a container div to ensure proper layering
    this.container = document.createElement('div');
    this.container.style.position = 'fixed';
    this.container.style.bottom = '10px'; // Lower positioning
    this.container.style.left = '10px';
    this.container.style.width = `${baseSize}px`;
    this.container.style.height = `${baseSize}px`;
    this.container.style.pointerEvents = 'none';
    this.container.style.zIndex = '5000'; // Very high z-index to ensure it's on top
    this.container.style.borderRadius = '50%';
    this.container.style.overflow = 'hidden';
    this.container.style.background = 'rgba(0, 0, 0, 0.5)'; // Semi-transparent background

    // Style the canvas
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';

    this.container.appendChild(this.canvas);

    // Don't append yet - let the UI system handle it
    this.ctx = this.canvas.getContext('2d')!;

    // Scale context for high DPI
    if (scale > 1) {
      this.ctx.scale(scale, scale);
    }

    this.radarCenter = { x: baseSize / 2, y: baseSize / 2 };
    this.radarRadius = baseSize / 2 - 20;

    // Append to document body
    document.body.appendChild(this.container);
  }

  public getContainer(): HTMLDivElement {
    return this.container;
  }

  update(
    threats: Threat[],
    batteryPosition: THREE.Vector3,
    interceptorCount: number,
    successRate: number,
    totalCapacity: number = 20
  ): void {
    // Update animation time
    this.animationTime = Date.now() / 1000;
    this.glitchTimer += 0.016; // ~60fps
    this.scanlineOffset = (this.scanlineOffset + 1) % 4;

    // Update sweep angle
    this.lastSweepAngle = this.animationTime % (Math.PI * 2);

    // Skip frames if configured (0 = no skip)
    if (this.UPDATE_SKIP_FRAMES > 0) {
      this.frameSkip++;
      if (this.frameSkip % (this.UPDATE_SKIP_FRAMES + 1) !== 0) {
        return;
      }
    }

    // Clear canvas completely for transparency
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Create circular clipping mask
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.arc(this.radarCenter.x, this.radarCenter.y, this.radarRadius + 10, 0, Math.PI * 2);
    this.ctx.clip();

    // Fill with subtle gradient background within the circle
    const gradient = this.ctx.createRadialGradient(
      this.radarCenter.x,
      this.radarCenter.y,
      0,
      this.radarCenter.x,
      this.radarCenter.y,
      this.radarRadius
    );
    gradient.addColorStop(0, 'rgba(0, 10, 20, 0.9)');
    gradient.addColorStop(0.7, 'rgba(0, 15, 30, 0.95)');
    gradient.addColorStop(1, 'rgba(0, 5, 15, 0.98)');
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Removed scanlines and hex grid for cleaner look

    // Draw radar circles
    this.drawRadarGrid();

    // Draw battery at center
    this.drawBattery();

    // Update and draw threats
    this.updateThreatTracks(threats, batteryPosition);

    // Draw radar pings
    this.drawRadarPings();

    // Removed info panel for cleaner display

    // Removed corner decorations for circular display

    // Removed glitch effect for cleaner display

    // Restore canvas state (remove clipping)
    this.ctx.restore();

    // Draw circular border
    this.ctx.strokeStyle = 'rgba(0, 255, 255, 0.5)';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.arc(this.radarCenter.x, this.radarCenter.y, this.radarRadius + 10, 0, Math.PI * 2);
    this.ctx.stroke();
  }

  private drawHexGrid(): void {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.05)';
    ctx.lineWidth = 0.5;

    const hexSize = 20;
    const rows = Math.ceil(this.canvas.height / (hexSize * 1.5));
    const cols = Math.ceil(this.canvas.width / (hexSize * Math.sqrt(3)));

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = col * hexSize * Math.sqrt(3) + ((row % 2) * hexSize * Math.sqrt(3)) / 2;
        const y = row * hexSize * 1.5;

        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 3) * i;
          const hx = x + hexSize * Math.cos(angle);
          const hy = y + hexSize * Math.sin(angle);
          if (i === 0) ctx.moveTo(hx, hy);
          else ctx.lineTo(hx, hy);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
  }

  private drawRadarGrid(): void {
    const ctx = this.ctx;

    // Draw concentric circles with gradient
    for (let i = 1; i <= 4; i++) {
      const gradient = ctx.createRadialGradient(
        this.radarCenter.x,
        this.radarCenter.y,
        0,
        this.radarCenter.x,
        this.radarCenter.y,
        (this.radarRadius * i) / 4
      );
      gradient.addColorStop(0, 'rgba(0, 255, 255, 0)');
      gradient.addColorStop(0.7, 'rgba(0, 255, 255, 0.1)');
      gradient.addColorStop(1, 'rgba(0, 255, 255, 0.3)');

      ctx.strokeStyle = gradient;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(this.radarCenter.x, this.radarCenter.y, (this.radarRadius * i) / 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Draw cross lines with glow
    ctx.shadowBlur = 5;
    ctx.shadowColor = 'rgba(0, 255, 255, 0.5)';
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.4)';
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.moveTo(this.radarCenter.x - this.radarRadius, this.radarCenter.y);
    ctx.lineTo(this.radarCenter.x + this.radarRadius, this.radarCenter.y);
    ctx.moveTo(this.radarCenter.x, this.radarCenter.y - this.radarRadius);
    ctx.lineTo(this.radarCenter.x, this.radarCenter.y + this.radarRadius);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Draw range labels with better styling
    ctx.fillStyle = 'rgba(0, 255, 255, 0.7)';
    ctx.font = '9px "Courier New", monospace';
    ctx.fillText('50m', this.radarCenter.x + this.radarRadius / 4 - 10, this.radarCenter.y - 5);
    ctx.fillText('100m', this.radarCenter.x + this.radarRadius / 2 - 15, this.radarCenter.y - 5);
    ctx.fillText(
      '150m',
      this.radarCenter.x + (this.radarRadius * 3) / 4 - 15,
      this.radarCenter.y - 5
    );

    // Draw rotating sweep with enhanced effect
    this.drawRadarSweep();
  }

  private drawRadarSweep(): void {
    const ctx = this.ctx;

    // Simple sweep line
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(this.radarCenter.x, this.radarCenter.y);
    ctx.lineTo(
      this.radarCenter.x + Math.cos(this.lastSweepAngle) * this.radarRadius,
      this.radarCenter.y + Math.sin(this.lastSweepAngle) * this.radarRadius
    );
    ctx.stroke();

    // Simple fade trail
    for (let i = 1; i <= 3; i++) {
      const trailAngle = this.lastSweepAngle - (i * Math.PI) / 30;
      const opacity = 0.3 - i * 0.1;
      ctx.strokeStyle = `rgba(0, 255, 255, ${opacity})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(this.radarCenter.x, this.radarCenter.y);
      ctx.lineTo(
        this.radarCenter.x + Math.cos(trailAngle) * this.radarRadius,
        this.radarCenter.y + Math.sin(trailAngle) * this.radarRadius
      );
      ctx.stroke();
    }
  }

  private drawBattery(): void {
    const ctx = this.ctx;

    // Draw battery icon with glow
    ctx.shadowBlur = 10;
    ctx.shadowColor = 'rgba(0, 255, 255, 0.8)';
    ctx.fillStyle = '#00ffff';
    ctx.strokeStyle = '#00ffff';
    ctx.lineWidth = 2;

    // Draw animated hexagon
    const size = 8 + Math.sin(this.animationTime * 2) * 1;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i + this.animationTime * 0.5;
      const x = this.radarCenter.x + Math.cos(angle) * size;
      const y = this.radarCenter.y + Math.sin(angle) * size;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = 'rgba(0, 255, 255, 0.3)';
    ctx.fill();

    // Inner core
    ctx.beginPath();
    ctx.arc(this.radarCenter.x, this.radarCenter.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#00ffff';
    ctx.fill();

    ctx.shadowBlur = 0;
  }

  private updateThreatTracks(threats: Threat[], batteryPosition: THREE.Vector3): void {
    const ctx = this.ctx;

    // Clean up old tracks
    const activeThreats = new Set(threats);
    for (const [threat, track] of this.threatTracks) {
      if (!activeThreats.has(threat)) {
        this.threatTracks.delete(threat);
      }
    }

    // Update tracks
    threats.forEach(threat => {
      if (!this.threatTracks.has(threat)) {
        const screenPos = this.worldToScreen(threat.getPosition(), batteryPosition);

        // New threat detected - create radar ping
        this.radarPings.push({
          position: screenPos,
          time: Date.now(),
        });

        this.threatTracks.set(threat, {
          id: `T${String(this.nextId++).padStart(3, '0')}`,
          positions: [],
          firstDetected: Date.now(),
          pinged: false,
        });
      }

      const track = this.threatTracks.get(threat)!;
      const screenPos = this.worldToScreen(threat.getPosition(), batteryPosition);

      // Add to track history
      track.positions.push(screenPos.clone());
      if (track.positions.length > this.TRACK_HISTORY_LENGTH) {
        track.positions.shift();
      }

      // Draw simple threat trail
      if (track.positions.length > 1) {
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        track.positions.forEach((pos, i) => {
          if (i === 0) ctx.moveTo(pos.x, pos.y);
          else ctx.lineTo(pos.x, pos.y);
        });
        ctx.stroke();
      }

      // Draw threat icon
      const relativePos = threat.getPosition().clone().sub(batteryPosition);
      const isInRange = relativePos.length() < this.radarRadius / this.scale;
      if (isInRange) {
        // Threat shape based on type
        ctx.fillStyle = '#ff0000';
        ctx.strokeStyle = '#ff0000';
        ctx.lineWidth = 1.5;

        ctx.save();
        ctx.translate(screenPos.x, screenPos.y);

        // Rotate based on velocity
        const vel = threat.getVelocity();
        const angle = Math.atan2(-vel.z, vel.x);
        ctx.rotate(angle);

        // Different shapes for different threat types
        const speed = vel.length();
        ctx.beginPath();

        if (speed < 50) {
          // Mortar - circle
          ctx.arc(0, 0, 4, 0, Math.PI * 2);
          ctx.fillStyle = '#ff9900';
        } else if (speed < 100) {
          // Rocket - triangle
          ctx.moveTo(6, 0);
          ctx.lineTo(-4, -3);
          ctx.lineTo(-4, 3);
          ctx.closePath();
          ctx.fillStyle = '#ff6600';
        } else {
          // Missile - diamond
          ctx.moveTo(6, 0);
          ctx.lineTo(0, -4);
          ctx.lineTo(-6, 0);
          ctx.lineTo(0, 4);
          ctx.closePath();
          ctx.fillStyle = '#ff0000';
        }

        ctx.fill();
        ctx.stroke();
        ctx.restore();

        // Show minimal threat info - just ID
        ctx.fillStyle = '#ff6666';
        ctx.font = '8px "Courier New", monospace';
        ctx.fillText(track.id, screenPos.x + 8, screenPos.y - 8);
      }
    });
  }

  private drawThreatInfo(
    ctx: CanvasRenderingContext2D,
    screenPos: THREE.Vector2,
    track: any,
    threat: Threat
  ): void {
    // Info background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(screenPos.x + 10, screenPos.y - 15, 60, 50);

    // Info border
    ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(screenPos.x + 10, screenPos.y - 15, 60, 50);

    // Threat ID
    ctx.fillStyle = '#ff6666';
    ctx.font = 'bold 9px "Courier New", monospace';
    ctx.fillText(track.id, screenPos.x + 13, screenPos.y - 5);

    // Time to impact with warning color
    const tti = threat.getTimeToImpact();
    if (tti > 0) {
      ctx.fillStyle = tti < 5 ? '#ff0000' : tti < 10 ? '#ffaa00' : '#ff6666';
      ctx.font = '8px "Courier New", monospace';
      ctx.fillText(`TTI: ${tti.toFixed(1)}s`, screenPos.x + 13, screenPos.y + 5);
    }

    // Altitude and speed
    const speed = threat.getVelocity().length();
    ctx.fillStyle = '#ff9999';
    ctx.font = '8px "Courier New", monospace';
    ctx.fillText(`ALT: ${threat.getPosition().y.toFixed(0)}m`, screenPos.x + 13, screenPos.y + 15);
    ctx.fillText(`SPD: ${speed.toFixed(0)}m/s`, screenPos.x + 13, screenPos.y + 25);

    // Threat classification
    let classification = 'UNK';
    let classColor = '#999999';
    if (speed < 50) {
      classification = 'MRT'; // Mortar
      classColor = '#ff9900';
    } else if (speed < 100) {
      classification = 'RKT'; // Rocket
      classColor = '#ff6600';
    } else {
      classification = 'MSL'; // Missile
      classColor = '#ff0000';
    }

    ctx.font = 'bold 8px "Courier New", monospace';
    ctx.fillStyle = classColor;
    ctx.fillText(classification, screenPos.x + 45, screenPos.y - 5);
  }

  private drawInfoPanel(
    threatCount: number,
    interceptorCount: number,
    successRate: number,
    totalCapacity: number = 20
  ): void {
    const ctx = this.ctx;

    // Position info panel to the right of radar to avoid overlap
    const canvasWidth = this.canvas.width / (this.ctx.getTransform().a || 1);
    const infoPanelX = canvasWidth - 150; // 150 = panel width + margin
    const infoPanelY = 5;

    // Panel background with gradient
    const panelGradient = ctx.createLinearGradient(
      infoPanelX,
      infoPanelY,
      infoPanelX,
      infoPanelY + 105
    );
    panelGradient.addColorStop(0, 'rgba(0, 20, 40, 0.9)');
    panelGradient.addColorStop(1, 'rgba(0, 10, 30, 0.9)');
    ctx.fillStyle = panelGradient;
    ctx.fillRect(infoPanelX, infoPanelY, 140, 105);

    // Panel border
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(infoPanelX, infoPanelY, 140, 105);

    // Header with glow
    ctx.shadowBlur = 5;
    ctx.shadowColor = 'rgba(0, 255, 255, 0.8)';
    ctx.fillStyle = '#00ffff';
    ctx.font = 'bold 11px "Courier New", monospace';
    ctx.fillText('◆ TACTICAL DISPLAY ◆', infoPanelX + 10, infoPanelY + 15);
    ctx.shadowBlur = 0;

    // Divider line
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.3)';
    ctx.beginPath();
    ctx.moveTo(infoPanelX + 5, infoPanelY + 20);
    ctx.lineTo(infoPanelX + 135, infoPanelY + 20);
    ctx.stroke();

    // System status with animated indicator
    ctx.font = '10px "Courier New", monospace';
    const statusColor = interceptorCount > 0 ? '#00ff00' : '#ff0000';
    const statusText = interceptorCount > 0 ? 'ACTIVE' : 'DEPLETED';
    const pulse = Math.sin(this.animationTime * 5) * 0.5 + 0.5;

    ctx.fillStyle = statusColor;
    ctx.fillText('SYS STATUS:', infoPanelX + 10, infoPanelY + 33);
    ctx.fillStyle =
      interceptorCount > 0
        ? `rgba(0, 255, 0, ${0.5 + pulse * 0.5})`
        : `rgba(255, 0, 0, ${0.5 + pulse * 0.5})`;
    ctx.fillText(statusText, infoPanelX + 80, infoPanelY + 33);

    // Stats with icons
    ctx.fillStyle = '#00ffff';
    ctx.fillText('◈ THREATS:', infoPanelX + 10, infoPanelY + 47);
    ctx.fillStyle = threatCount > 0 ? '#ff6666' : '#66ff66';
    ctx.fillText(String(threatCount).padStart(3, '0'), infoPanelX + 80, infoPanelY + 47);

    ctx.fillStyle = '#00ffff';
    ctx.fillText('◎ READY:', infoPanelX + 10, infoPanelY + 60);
    ctx.fillStyle =
      interceptorCount > 10 ? '#66ff66' : interceptorCount > 5 ? '#ffaa00' : '#ff6666';
    ctx.fillText(`${interceptorCount}/${totalCapacity}`, infoPanelX + 80, infoPanelY + 60);

    ctx.fillStyle = '#00ffff';
    ctx.fillText('◉ P(HIT):', infoPanelX + 10, infoPanelY + 73);
    ctx.fillStyle = successRate > 0.8 ? '#66ff66' : successRate > 0.6 ? '#ffaa00' : '#ff6666';
    ctx.fillText(`${(successRate * 100).toFixed(0)}%`, infoPanelX + 80, infoPanelY + 73);

    // Alert level with background
    const alertLevel = threatCount === 0 ? 'GREEN' : threatCount < 3 ? 'YELLOW' : 'RED';
    const alertColor = threatCount === 0 ? '#00ff00' : threatCount < 3 ? '#ffff00' : '#ff0000';

    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(infoPanelX + 5, infoPanelY + 83, 130, 17);

    ctx.fillStyle = alertColor;
    ctx.font = 'bold 10px "Courier New", monospace';
    ctx.fillText(`DEFCON: ${alertLevel}`, infoPanelX + 10, infoPanelY + 95);

    // Blinking alert indicator for high threat
    if (threatCount >= 3 && Math.sin(this.animationTime * 10) > 0) {
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(125, 92, 10, 10);
    }
  }

  private drawCornerDecorations(): void {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.5)';
    ctx.lineWidth = 1;

    // Top-left corner
    ctx.beginPath();
    ctx.moveTo(0, 20);
    ctx.lineTo(0, 0);
    ctx.lineTo(20, 0);
    ctx.stroke();

    // Top-right corner
    ctx.beginPath();
    ctx.moveTo(this.canvas.width - 20, 0);
    ctx.lineTo(this.canvas.width, 0);
    ctx.lineTo(this.canvas.width, 20);
    ctx.stroke();

    // Bottom-left corner
    ctx.beginPath();
    ctx.moveTo(0, this.canvas.height - 20);
    ctx.lineTo(0, this.canvas.height);
    ctx.lineTo(20, this.canvas.height);
    ctx.stroke();

    // Bottom-right corner
    ctx.beginPath();
    ctx.moveTo(this.canvas.width - 20, this.canvas.height);
    ctx.lineTo(this.canvas.width, this.canvas.height);
    ctx.lineTo(this.canvas.width, this.canvas.height - 20);
    ctx.stroke();
  }

  private drawScanlines(): void {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.03)';
    ctx.lineWidth = 1;

    for (let y = this.scanlineOffset; y < this.canvas.height; y += 4) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.canvas.width, y);
      ctx.stroke();
    }
  }

  private drawGlitchEffect(): void {
    const ctx = this.ctx;
    const glitchHeight = 5 + Math.random() * 20;
    const glitchY = Math.random() * (this.canvas.height - glitchHeight);

    // Save current image data
    const imageData = ctx.getImageData(0, glitchY, this.canvas.width, glitchHeight);

    // Offset and redraw with color shift
    ctx.globalCompositeOperation = 'screen';
    ctx.putImageData(imageData, Math.random() * 10 - 5, glitchY);
    ctx.globalCompositeOperation = 'source-over';
  }

  private worldToScreen(worldPos: THREE.Vector3, batteryPosition: THREE.Vector3): THREE.Vector2 {
    const relativePos = worldPos.clone().sub(batteryPosition);
    return new THREE.Vector2(
      this.radarCenter.x + relativePos.x * this.scale,
      this.radarCenter.y - relativePos.z * this.scale // Flip Z for top-down view
    );
  }

  private drawRadarPings(): void {
    const ctx = this.ctx;
    const currentTime = Date.now();

    // Update and draw pings
    this.radarPings = this.radarPings.filter(ping => {
      const age = currentTime - ping.time;
      if (age > 1000) return false; // Remove old pings

      const opacity = 1 - age / 1000;
      const radius = 10 + age / 50; // Expanding ring

      // Single simple ring
      ctx.strokeStyle = `rgba(255, 255, 0, ${opacity})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ping.position.x, ping.position.y, radius, 0, Math.PI * 2);
      ctx.stroke();

      return true;
    });
  }

  destroy(): void {
    if (this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
  }
}
