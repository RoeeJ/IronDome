import React, { useState, useEffect, useRef } from 'react';
import './GuidanceDiagnosticPanel.css';

interface InterceptorData {
  id: string;
  hasTarget: boolean;
  targetId?: string;
  launchTime: number;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  speed: number;
  acceleration: number;
  guidanceActive: boolean;
  flightTime: number;
}

export const GuidanceDiagnosticPanel: React.FC = () => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [interceptors, setInterceptors] = useState<InterceptorData[]>([]);
  const [isPaused, setPaused] = useState(false);
  const updateInterval = useRef<NodeJS.Timeout>();

  useEffect(() => {
    if (!isPaused) {
      updateInterval.current = setInterval(updateDiagnostics, 100);
    }

    return () => {
      if (updateInterval.current) {
        clearInterval(updateInterval.current);
      }
    };
  }, [isPaused]);

  const updateDiagnostics = () => {
    // Get interceptors from the interception system
    const interceptionSystem = (window as any).__interceptionSystem;
    if (!interceptionSystem) return;

    const interceptorList = interceptionSystem.getInterceptors
      ? interceptionSystem.getInterceptors()
      : [];
    const now = Date.now();

    const diagnosticData: InterceptorData[] = [];

    interceptorList.forEach((interceptor: any) => {
      if (!interceptor.isInterceptor || !interceptor.isActive) return;

      const pos = interceptor.getPosition();
      const vel = interceptor.getVelocity();
      const speed = vel.length();

      // Calculate acceleration (simplified - would need history for accurate calc)
      const prevData = interceptors.find(i => i.id === interceptor.id);
      let acceleration = 0;
      if (prevData) {
        const timeDelta = 0.1; // 100ms update interval
        const speedDelta = speed - prevData.speed;
        acceleration = speedDelta / timeDelta;
      }

      diagnosticData.push({
        id: interceptor.id,
        hasTarget: !!interceptor.target,
        targetId: interceptor.target?.id,
        launchTime: interceptor.launchTime || now,
        position: { x: pos.x, y: pos.y, z: pos.z },
        velocity: { x: vel.x, y: vel.y, z: vel.z },
        speed,
        acceleration,
        guidanceActive: Math.abs(acceleration) > 5, // > 5 m/s² indicates active guidance
        flightTime: (now - (interceptor.launchTime || now)) / 1000,
      });
    });

    setInterceptors(diagnosticData);
  };

  const formatVector = (v: { x: number; y: number; z: number }) => {
    return `(${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)})`;
  };

  const getGuidanceStatus = (interceptor: InterceptorData) => {
    if (!interceptor.hasTarget) return { text: 'NO TARGET', color: '#ff0000' };
    if (interceptor.guidanceActive) return { text: 'ACTIVE', color: '#00ff00' };
    if (interceptor.flightTime < 0.5) return { text: 'LAUNCH', color: '#ffff00' };
    return { text: 'BALLISTIC', color: '#ff8800' };
  };

  return (
    <div className={`guidance-diagnostic-panel ${isExpanded ? 'expanded' : 'collapsed'}`}>
      <div className="gd-header" onClick={() => setIsExpanded(!isExpanded)}>
        <span className="gd-title">
          🎯 Guidance Diagnostic
          {interceptors.length > 0 && <span className="gd-count"> ({interceptors.length})</span>}
        </span>
        <span className="gd-toggle">{isExpanded ? '▼' : '▲'}</span>
      </div>

      {isExpanded && (
        <div className="gd-content">
          <div className="gd-controls">
            <button
              className={`gd-button ${isPaused ? 'paused' : ''}`}
              onClick={() => setPaused(!isPaused)}
            >
              {isPaused ? '▶ Resume' : '⏸ Pause'}
            </button>
            <button
              className="gd-button"
              onClick={() => {
                console.log('=== Guidance Diagnostic Report ===');
                interceptors.forEach(i => {
                  console.log(`Interceptor ${i.id}:`);
                  console.log(`  Target: ${i.hasTarget ? i.targetId : 'None'}`);
                  console.log(`  Flight Time: ${i.flightTime.toFixed(1)}s`);
                  console.log(`  Speed: ${i.speed.toFixed(1)} m/s`);
                  console.log(`  Acceleration: ${i.acceleration.toFixed(1)} m/s²`);
                  console.log(`  Guidance: ${i.guidanceActive ? 'ACTIVE' : 'INACTIVE'}`);
                });
              }}
            >
              📋 Log Report
            </button>
          </div>

          {interceptors.length === 0 ? (
            <div className="gd-empty">No active interceptors</div>
          ) : (
            <div className="gd-interceptor-list">
              {interceptors.map(interceptor => {
                const status = getGuidanceStatus(interceptor);
                return (
                  <div key={interceptor.id} className="gd-interceptor">
                    <div className="gd-interceptor-header">
                      <span className="gd-id">{interceptor.id.slice(-8)}</span>
                      <span className="gd-status" style={{ color: status.color }}>
                        {status.text}
                      </span>
                    </div>

                    <div className="gd-interceptor-data">
                      <div className="gd-row">
                        <span className="gd-label">Target:</span>
                        <span className="gd-value">
                          {interceptor.hasTarget ? interceptor.targetId?.slice(-8) : 'None'}
                        </span>
                      </div>

                      <div className="gd-row">
                        <span className="gd-label">Flight Time:</span>
                        <span className="gd-value">{interceptor.flightTime.toFixed(1)}s</span>
                      </div>

                      <div className="gd-row">
                        <span className="gd-label">Speed:</span>
                        <span className="gd-value">{interceptor.speed.toFixed(1)} m/s</span>
                      </div>

                      <div className="gd-row">
                        <span className="gd-label">Acceleration:</span>
                        <span className="gd-value">{interceptor.acceleration.toFixed(1)} m/s²</span>
                      </div>

                      <div className="gd-row">
                        <span className="gd-label">Position:</span>
                        <span className="gd-value small">{formatVector(interceptor.position)}</span>
                      </div>

                      <div className="gd-row">
                        <span className="gd-label">Velocity:</span>
                        <span className="gd-value small">{formatVector(interceptor.velocity)}</span>
                      </div>
                    </div>

                    <div className="gd-guidance-bar">
                      <div
                        className="gd-guidance-fill"
                        style={{
                          width: `${Math.min(100, Math.abs(interceptor.acceleration) * 2)}%`,
                          backgroundColor: interceptor.guidanceActive ? '#00ff00' : '#ff8800',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
