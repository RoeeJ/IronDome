import React, { useEffect, useState } from 'react';
import * as THREE from 'three';

interface RenderStatsProps {
  renderer: THREE.WebGLRenderer;
  visible?: boolean;
}

interface Stats {
  drawCalls: number;
  triangles: number;
  points: number;
  lines: number;
  geometries: number;
  textures: number;
  programs: number;
  fps: number;
  frameTime: number;
}

export const RenderStats: React.FC<RenderStatsProps> = ({ renderer, visible = true }) => {
  const [stats, setStats] = useState<Stats>({
    drawCalls: 0,
    triangles: 0,
    points: 0,
    lines: 0,
    geometries: 0,
    textures: 0,
    programs: 0,
    fps: 0,
    frameTime: 0,
  });

  useEffect(() => {
    if (!visible) return;

    let frameCount = 0;
    let lastTime = performance.now();
    let lastFPSUpdate = lastTime;

    const updateStats = () => {
      if (!visible) return;

      const currentTime = performance.now();
      const deltaTime = currentTime - lastTime;
      lastTime = currentTime;

      frameCount++;

      // Update FPS every 500ms
      if (currentTime - lastFPSUpdate > 500) {
        const fps = (frameCount * 1000) / (currentTime - lastFPSUpdate);
        frameCount = 0;
        lastFPSUpdate = currentTime;

        const info = renderer.info;
        setStats({
          drawCalls: info.render.calls,
          triangles: info.render.triangles,
          points: info.render.points,
          lines: info.render.lines,
          geometries: info.memory.geometries,
          textures: info.memory.textures,
          programs: info.programs?.length || 0,
          fps: Math.round(fps),
          frameTime: deltaTime,
        });
      }

      requestAnimationFrame(updateStats);
    };

    updateStats();
  }, [renderer, visible]);

  if (!visible) return null;

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const getDrawCallColor = (calls: number) => {
    if (calls < 300) return '#00ff00';
    if (calls < 500) return '#ffff00';
    if (calls < 1000) return '#ff8800';
    return '#ff0000';
  };

  const getFrameTimeColor = (time: number) => {
    if (time < 8.33) return '#00ff00'; // 120+ FPS
    if (time < 16.67) return '#88ff00'; // 60+ FPS
    if (time < 33.33) return '#ffff00'; // 30+ FPS
    return '#ff0000';
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: '10px',
        right: '10px',
        background: 'rgba(0, 0, 0, 0.8)',
        color: 'white',
        padding: '10px',
        fontFamily: 'monospace',
        fontSize: '12px',
        borderRadius: '4px',
        minWidth: '200px',
        zIndex: 1000,
        backdropFilter: 'blur(4px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
      }}
    >
      <div style={{ marginBottom: '8px', borderBottom: '1px solid #444', paddingBottom: '4px' }}>
        <strong>Render Performance</strong>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: '4px 12px' }}>
        <span>FPS:</span>
        <span style={{ color: getFrameTimeColor(stats.frameTime), fontWeight: 'bold' }}>
          {stats.fps}
        </span>

        <span>Frame Time:</span>
        <span style={{ color: getFrameTimeColor(stats.frameTime) }}>
          {stats.frameTime.toFixed(1)}ms
        </span>

        <span>Draw Calls:</span>
        <span style={{ color: getDrawCallColor(stats.drawCalls), fontWeight: 'bold' }}>
          {stats.drawCalls}
        </span>

        <span>Triangles:</span>
        <span>{formatNumber(stats.triangles)}</span>

        <span>Points:</span>
        <span>{formatNumber(stats.points)}</span>

        <span>Lines:</span>
        <span>{formatNumber(stats.lines)}</span>

        <span style={{ marginTop: '4px' }}>Geometries:</span>
        <span style={{ marginTop: '4px' }}>{stats.geometries}</span>

        <span>Textures:</span>
        <span>{stats.textures}</span>

        <span>Programs:</span>
        <span>{stats.programs}</span>
      </div>

      <div style={{ marginTop: '8px', fontSize: '10px', color: '#888' }}>
        <div>Target: &lt;300 calls, &lt;16.7ms</div>
        {stats.drawCalls > 500 && (
          <div style={{ color: '#ff8800', marginTop: '4px' }}>⚠️ High draw calls detected!</div>
        )}
      </div>
    </div>
  );
};
