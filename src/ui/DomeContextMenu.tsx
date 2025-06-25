import React, { useState, useEffect } from 'react';
import { IronDomeBattery } from '../entities/IronDomeBattery';
import { DomePlacementSystem } from '../game/DomePlacementSystem';

interface DomeContextMenuProps {
  battery: IronDomeBattery | null;
  batteryId: string | null;
  position: { x: number; y: number };
  onClose: () => void;
  placementSystem: DomePlacementSystem;
  isGameMode: boolean;
}

export const DomeContextMenu: React.FC<DomeContextMenuProps> = ({
  battery,
  batteryId,
  position,
  onClose,
  placementSystem,
  isGameMode,
}) => {
  const [batteryConfig, setBatteryConfig] = useState<any>(null);
  const [batteryStats, setBatteryStats] = useState<any>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Update placement info in real-time - MUST be before any conditional returns
  const [placementInfo, setPlacementInfo] = useState<any>(() => {
    const placements = placementSystem.getPlacementInfo();
    const domePlacement = placementSystem.getDomePlacements().find(p => p.id === batteryId);
    return { ...placements, level: domePlacement?.level || 1 };
  });

  useEffect(() => {
    if (battery) {
      // Initial update
      setBatteryConfig(battery.getConfig());
      setBatteryStats(battery.getStats());

      // Set up interval for real-time updates
      const interval = setInterval(() => {
        setBatteryStats(battery.getStats());
        // Also update config in case it changed (e.g., from damage)
        setBatteryConfig(battery.getConfig());
      }, 100); // Update every 100ms for smooth real-time updates

      return () => clearInterval(interval);
    }
  }, [battery, refreshKey]);

  useEffect(() => {
    const updatePlacementInfo = () => {
      const placements = placementSystem.getPlacementInfo();
      const domePlacement = placementSystem.getDomePlacements().find(p => p.id === batteryId);
      setPlacementInfo({ ...placements, level: domePlacement?.level || 1 });
    };

    // Update placement info with battery stats
    const interval = setInterval(updatePlacementInfo, 100);

    // Also update on battery upgrade event
    const handleBatteryUpgraded = (event: any) => {
      // Add a small delay to ensure the new battery is fully initialized
      setTimeout(() => {
        updatePlacementInfo();
        setRefreshKey(prev => prev + 1);
        
        // Force re-fetch battery reference
        const newBattery = placementSystem.getBattery(batteryId);
        if (newBattery) {
          setBatteryConfig(newBattery.getConfig());
          setBatteryStats(newBattery.getStats());
        }
      }, 100);
    };
    window.addEventListener('batteryUpgraded', handleBatteryUpgraded);

    return () => {
      clearInterval(interval);
      window.removeEventListener('batteryUpgraded', handleBatteryUpgraded);
    };
  }, [batteryId, placementSystem]);

  if (!battery || !batteryId || !batteryConfig || !batteryStats) return null;

  const handleSell = () => {
    if (!isLastBattery) {
      const sellValue = getSellValue();
      const message = isGameMode
        ? `Sell this Level ${placementInfo.level} battery for ${sellValue} credits?`
        : `Remove this Level ${placementInfo.level} battery?`;

      if (window.confirm(message)) {
        const success = placementSystem.sellBattery(batteryId);
        if (success) {
          onClose();
          // Force UI update by dispatching event
          window.dispatchEvent(new Event('batteryRemoved'));
        }
      }
    }
  };

  const getSellValue = () => {
    // Return 60% of total investment
    let totalCost = 0;
    for (let i = 1; i < placementInfo.level; i++) {
      totalCost += 500 * i; // Cost formula from getDomeUpgradeCost
    }
    return Math.floor(totalCost * 0.6);
  };

  const handleUpgrade = () => {
    const success = placementSystem.upgradeBattery(batteryId);
    if (success) {
      // Don't close the menu - just update the battery config
      const updatedBattery = placementSystem.getBattery(batteryId);
      if (updatedBattery) {
        setBatteryConfig(updatedBattery.getConfig());
      }
      // Force re-render to update stats and level
      setRefreshKey(prev => prev + 1);
      // Force UI update by dispatching event
      window.dispatchEvent(new Event('batteryUpgraded'));
    }
  };

  const isLastBattery = placementInfo.placedDomes <= 1;

  return (
    <div
      style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', zIndex: 9999 }}
    >
      <style>{`
        .context-menu-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 9999;
          pointer-events: auto;
          background: transparent;
        }
        
        .dome-context-menu {
          position: fixed;
          background: rgba(0, 0, 0, 0.95);
          border: 2px solid #0038b8;
          border-radius: 10px;
          padding: 20px;
          min-width: 280px;
          z-index: 10000;
          color: white;
          font-family: Arial, sans-serif;
          box-shadow: 0 0 20px rgba(0, 56, 184, 0.5);
          pointer-events: auto;
        }
        
        .context-menu-title {
          font-size: 18px;
          font-weight: bold;
          color: #0038b8;
          margin-bottom: 15px;
          text-align: center;
        }
        
        .battery-stats {
          margin-bottom: 20px;
          font-size: 14px;
        }
        
        .stat-row {
          display: flex;
          justify-content: space-between;
          margin: 8px 0;
          padding: 4px 8px;
          background: rgba(0, 56, 184, 0.2);
          border-radius: 4px;
        }
        
        .stat-label {
          color: #aaa;
        }
        
        .stat-value {
          color: #0095ff;
          font-weight: bold;
        }
        
        .context-menu-actions {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-top: 15px;
        }
        
        .context-menu-button {
          background: #0038b8;
          border: 2px solid #0038b8;
          color: white;
          padding: 12px 20px;
          border-radius: 5px;
          font-size: 14px;
          font-weight: bold;
          cursor: pointer;
          transition: all 0.3s;
          text-align: center;
          pointer-events: auto !important;
          position: relative;
          z-index: 10001;
        }
        
        .context-menu-button:hover {
          background: #0056d6;
          border-color: #0056d6;
          transform: scale(1.02);
        }
        
        .context-menu-button:active {
          transform: scale(0.98);
        }
        
        .context-menu-button.repair {
          background: #00a000;
          border-color: #00a000;
        }
        
        .context-menu-button.repair:hover {
          background: #00c000;
          border-color: #00c000;
        }
        
        .context-menu-button.danger {
          background: #b80000;
          border-color: #b80000;
        }
        
        .context-menu-button.danger:hover {
          background: #d60000;
          border-color: #d60000;
        }
        
        .context-menu-button:disabled {
          background: #333;
          border-color: #555;
          color: #666;
          cursor: not-allowed;
          transform: none;
        }
        
        .upgrade-cost {
          font-size: 12px;
          color: #ffcc00;
          margin-left: 5px;
        }
        
        .close-button {
          position: absolute;
          top: 10px;
          right: 10px;
          background: none;
          border: none;
          color: #ff0000;
          font-size: 20px;
          cursor: pointer;
          padding: 5px;
          width: 30px;
          height: 30px;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: auto !important;
          z-index: 10002;
        }
        
        .close-button:hover {
          color: #ff6666;
        }
        
        .battery-level {
          display: inline-block;
          background: #0038b8;
          color: white;
          padding: 2px 8px;
          border-radius: 3px;
          font-size: 12px;
          margin-left: 10px;
        }
        
        .battery-health {
          width: 100%;
          height: 10px;
          background: #333;
          border-radius: 5px;
          overflow: hidden;
          margin-top: 5px;
        }
        
        .battery-health-fill {
          height: 100%;
          background: #00ff00;
          transition: width 0.3s;
        }
        
        .health-warning {
          background: #ffaa00;
        }
        
        .health-critical {
          background: #ff0000;
        }
      `}</style>

      <div
        className="context-menu-backdrop"
        onClick={e => {
          e.stopPropagation();
          onClose();
        }}
        onContextMenu={e => {
          e.preventDefault();
          onClose();
        }}
      />

      <div
        className="dome-context-menu"
        style={{
          left: `${position.x}px`,
          top: `${position.y}px`,
          transform: position.x > window.innerWidth - 300 ? 'translateX(-100%)' : 'none',
        }}
        onClick={e => e.stopPropagation()}
        onContextMenu={e => e.preventDefault()}
      >
        <button
          className="close-button"
          onClick={e => {
            e.stopPropagation();
            onClose();
          }}
        >
          ✕
        </button>

        <div className="context-menu-title">
          Iron Dome Battery
          <span className="battery-level">Level {placementInfo.level}</span>
        </div>

        <div className="battery-stats">
          <div className="stat-row">
            <span className="stat-label">Position</span>
            <span className="stat-value">
              {Math.round(batteryConfig.position.x)}, {Math.round(batteryConfig.position.z)}
            </span>
          </div>

          <div className="stat-row">
            <span className="stat-label">Range</span>
            <span className="stat-value">{batteryConfig.maxRange}m</span>
          </div>

          <div className="stat-row">
            <span className="stat-label">Loaded Tubes</span>
            <span className="stat-value">
              {batteryStats.loadedTubes}/{batteryStats.totalTubes}
            </span>
          </div>

          <div className="stat-row">
            <span className="stat-label">Success Rate</span>
            <span className="stat-value">{(batteryConfig.successRate * 100).toFixed(0)}%</span>
          </div>

          {isGameMode && (
            <div className="stat-row">
              <span className="stat-label">Health</span>
              <span className="stat-value">
                {batteryStats.health.current}/{batteryStats.health.max}
              </span>
            </div>
          )}

          {isGameMode && (
            <div className="battery-health">
              <div
                className={`battery-health-fill ${
                  batteryStats.health.percent < 0.3
                    ? 'health-critical'
                    : batteryStats.health.percent < 0.6
                      ? 'health-warning'
                      : ''
                }`}
                style={{ width: `${batteryStats.health.percent * 100}%` }}
              />
            </div>
          )}
        </div>

        <div className="context-menu-actions">
          {isGameMode && batteryStats.health.percent < 1 && (
            <button
              className="context-menu-button repair"
              onClick={e => {
                e.stopPropagation();
                const repairCost = Math.ceil(
                  (batteryStats.health.max - batteryStats.health.current) * 2
                );
                const success = placementSystem.repairBattery(batteryId, repairCost);
                if (success) {
                  // Force re-render to update stats
                  setRefreshKey(prev => prev + 1);
                  window.dispatchEvent(new Event('batteryRepaired'));
                }
              }}
              disabled={!placementSystem.canAffordRepair(batteryId)}
              title={batteryStats.health.percent === 1 ? 'Battery at full health' : ''}
            >
              Repair Battery
              <span className="upgrade-cost">
                (Cost: {Math.ceil((batteryStats.health.max - batteryStats.health.current) * 2)})
              </span>
            </button>
          )}

          <button
            className="context-menu-button"
            onClick={e => {
              e.stopPropagation();
              handleUpgrade();
            }}
            disabled={placementInfo.level >= 5 || !placementSystem.canUpgradeBattery(batteryId)}
            title={placementInfo.level >= 5 ? 'Maximum level reached' : ''}
          >
            Upgrade Battery
            {placementInfo.level >= 5 ? (
              <span className="upgrade-cost">(Max Level)</span>
            ) : isGameMode ? (
              <span className="upgrade-cost">
                (Cost: {placementSystem.getUpgradeCost(batteryId)})
              </span>
            ) : null}
          </button>

          <button
            className="context-menu-button danger"
            onClick={e => {
              e.stopPropagation();
              if (isLastBattery) {
                alert('Cannot sell the last battery!');
              } else {
                handleSell();
              }
            }}
            disabled={isLastBattery}
            title={isLastBattery ? 'Cannot sell the last battery' : ''}
          >
            {isGameMode ? `Sell Battery (${getSellValue()} credits)` : 'Remove Battery'}
          </button>
        </div>
      </div>
    </div>
  );
};
