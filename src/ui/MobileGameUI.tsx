import React, { useState, useEffect } from 'react';
import { GameState } from '../game/GameState';
import { WaveManager } from '../game/WaveManager';
import { DomePlacementSystem } from '../game/DomePlacementSystem';
import { SoundSystem } from '../systems/SoundSystem';
import { HelpModal } from './HelpModal';

interface MobileGameUIProps {
  waveManager: WaveManager;
  placementSystem: DomePlacementSystem;
  onModeChange?: (gameMode: boolean) => void;
  isGameMode: boolean;
}

export const MobileGameUI: React.FC<MobileGameUIProps> = ({
  waveManager,
  placementSystem,
  onModeChange,
  isGameMode,
}) => {
  const [credits, setCredits] = useState(0);
  const [interceptors, setInterceptors] = useState(0);
  const [currentWave, setCurrentWave] = useState(1);
  const [waveProgress, setWaveProgress] = useState({ destroyed: 0, total: 0 });
  const [score, setScore] = useState(0);
  const [showMenu, setShowMenu] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [autoIntercept, setAutoIntercept] = useState(true); // Default to auto
  const [showShop, setShowShop] = useState(false);
  const [placementMode, setPlacementMode] = useState(false);
  const [isWaveActive, setIsWaveActive] = useState(false);
  const [showControls, setShowControls] = useState(false);

  const gameState = GameState.getInstance();

  useEffect(() => {
    const updateState = () => {
      setCredits(gameState.getCredits());
      setInterceptors(gameState.getInterceptorStock());
      setScore(gameState.getScore());
      setPlacementMode(placementSystem.isInPlacementMode());
    };

    updateState();
    const interval = setInterval(updateState, 100);
    
    // Event listeners
    const handleWaveProgress = (data: any) => {
      setWaveProgress({ destroyed: data.destroyed, total: data.total });
    };
    
    const handleWaveStarted = (data: any) => {
      setCurrentWave(data.waveNumber);
      setIsWaveActive(true);
      setWaveProgress({ destroyed: 0, total: data.totalThreats || 0 });
    };
    
    const handleWaveCompleted = () => {
      setIsWaveActive(false);
    };
    
    // Sync auto intercept state
    const controls = (window as any).__simulationControls;
    if (controls) {
      setAutoIntercept(controls.autoIntercept);
    }

    waveManager.on('waveProgress', handleWaveProgress);
    waveManager.on('waveStarted', handleWaveStarted);
    waveManager.on('waveCompleted', handleWaveCompleted);

    return () => {
      clearInterval(interval);
      waveManager.off('waveProgress', handleWaveProgress);
      waveManager.off('waveStarted', handleWaveStarted);
      waveManager.off('waveCompleted', handleWaveCompleted);
    };
  }, []);

  const vibrate = (pattern: number | number[]) => {
    if ('vibrate' in navigator) navigator.vibrate(pattern);
  };
  
  const showNotification = (message: string) => {
    if ((window as any).showNotification) {
      (window as any).showNotification(message);
    }
  };

  return (
    <>
      <style>{`
        /* Mobile-first design */
        .mobile-ui {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          pointer-events: none;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          -webkit-user-select: none;
          user-select: none;
          -webkit-touch-callout: none;
          z-index: 1000; /* Ensure UI is on top */
        }
        
        /* Top HUD - Ultra compact */
        .mobile-hud {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          background: rgba(0, 0, 0, 0.7);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          padding: 8px;
          padding-top: max(8px, env(safe-area-inset-top));
          pointer-events: auto;
          z-index: 100;
        }
        
        .hud-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0 12px;
          gap: 8px;
        }
        
        .hud-item {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 13px;
          color: rgba(255, 255, 255, 0.9);
          font-weight: 500;
        }
        
        .hud-icon {
          font-size: 16px;
        }
        
        .hud-value {
          min-width: 35px;
          font-variant-numeric: tabular-nums;
        }
        
        .wave-display {
          background: rgba(0, 56, 184, 0.8);
          padding: 6px 12px;
          border-radius: 16px;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .wave-number {
          font-size: 14px;
        }
        
        .wave-progress {
          width: 60px;
          height: 3px;
          background: rgba(0, 0, 0, 0.3);
          border-radius: 2px;
          overflow: hidden;
        }
        
        .wave-progress-bar {
          height: 100%;
          background: #00ff00;
          transition: width 0.3s ease;
        }
        
        /* Bottom action bar - Ultra compact */
        .mobile-actions {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          background: rgba(0, 0, 0, 0.85);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          padding: 6px;
          padding-bottom: max(6px, env(safe-area-inset-bottom));
          pointer-events: auto;
          z-index: 100;
        }
        
        .action-row {
          display: flex;
          gap: 6px;
          justify-content: center;
          align-items: center;
        }
        
        .action-btn {
          flex: 1;
          max-width: 100px;
          background: rgba(0, 56, 184, 0.9);
          border: none;
          color: white;
          padding: 8px 6px;
          border-radius: 10px;
          font-size: 12px;
          font-weight: 500;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          touch-action: manipulation;
          -webkit-tap-highlight-color: transparent;
          transition: all 0.15s ease;
        }
        
        .action-btn:active {
          transform: scale(0.95);
          background: rgba(0, 56, 184, 1);
        }
        
        .action-btn.active {
          background: rgba(255, 102, 0, 0.9);
        }
        
        .action-btn:disabled {
          background: rgba(50, 50, 50, 0.6);
          color: rgba(255, 255, 255, 0.4);
        }
        
        .action-icon {
          font-size: 18px;
        }
        
        .action-label {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }
        
        /* Floating menu button - Smaller and cleaner */
        .menu-btn {
          position: absolute;
          top: 58px;
          right: 12px;
          width: 40px;
          height: 40px;
          background: rgba(0, 0, 0, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 20px;
          color: white;
          font-size: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: auto;
          z-index: 101;
          touch-action: manipulation;
          -webkit-tap-highlight-color: transparent;
          transition: all 0.2s ease;
        }
        
        .menu-btn:active {
          transform: scale(0.9);
          background: rgba(0, 0, 0, 0.9);
        }
        
        /* Slide-out menu */
        .mobile-menu {
          position: absolute;
          top: 0;
          right: 0;
          bottom: 0;
          width: 80%;
          max-width: 300px;
          background: rgba(0, 0, 0, 0.95);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          transform: translateX(100%);
          transition: transform 0.3s;
          pointer-events: auto;
          z-index: 200;
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
        }
        
        .mobile-menu.open {
          transform: translateX(0);
        }
        
        .menu-header {
          padding: 20px;
          border-bottom: 1px solid #333;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .menu-title {
          font-size: 20px;
          font-weight: bold;
          color: white;
        }
        
        .menu-close {
          font-size: 24px;
          color: white;
          background: none;
          border: none;
          touch-action: manipulation;
        }
        
        .menu-content {
          padding: 20px;
        }
        
        .menu-section {
          margin-bottom: 25px;
        }
        
        .menu-section-title {
          font-size: 14px;
          color: #888;
          margin-bottom: 10px;
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        
        .menu-item {
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid #333;
          border-radius: 10px;
          padding: 15px;
          margin-bottom: 10px;
          color: white;
          display: flex;
          justify-content: space-between;
          align-items: center;
          touch-action: manipulation;
          -webkit-tap-highlight-color: transparent;
        }
        
        .menu-item:active {
          background: rgba(255, 255, 255, 0.2);
        }
        
        .menu-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          pointer-events: none; /* Don't block touches when hidden */
          z-index: 199;
          opacity: 0;
          transition: opacity 0.3s;
        }
        
        .menu-overlay.open {
          opacity: 1;
          pointer-events: auto; /* Only block touches when menu is open */
        }
        
        /* Interceptor warning */
        .interceptor-warning {
          color: #ff6600;
          animation: blink 1s infinite;
        }
        
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        
        /* Mode toggle - Mobile-friendly style */
        .mode-btn {
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.2);
          color: rgba(255, 255, 255, 0.7);
          padding: 8px 6px;
          border-radius: 10px;
          font-size: 12px;
          font-weight: 500;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          touch-action: manipulation;
          -webkit-tap-highlight-color: transparent;
          transition: all 0.15s ease;
          min-width: 65px;
        }
        
        .mode-btn:active {
          transform: scale(0.95);
        }
        
        .mode-icon {
          font-size: 18px;
        }
        
        .mode-label {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }
        
        /* Shop modal */
        .shop-modal {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 90%;
          max-width: 400px;
          max-height: 80vh;
          background: rgba(0, 0, 0, 0.95);
          border: 2px solid #0038b8;
          border-radius: 15px;
          padding: 20px;
          pointer-events: auto;
          z-index: 300;
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
        }
        
        .shop-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          margin-top: 20px;
        }
        
        /* If there are 3 items, make the last one span full width */
        .shop-grid > :nth-child(3):last-child {
          grid-column: 1 / -1;
          max-width: 200px;
          margin: 0 auto;
        }
        
        .shop-item-card {
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid #333;
          border-radius: 10px;
          padding: 15px;
          text-align: center;
          color: white;
        }
        
        .shop-item-icon {
          font-size: 32px;
          margin-bottom: 10px;
        }
        
        .shop-item-name {
          font-size: 14px;
          font-weight: 600;
          margin-bottom: 5px;
        }
        
        .shop-buy-btn {
          width: 100%;
          background: #0038b8;
          border: none;
          color: white;
          padding: 10px;
          border-radius: 5px;
          font-weight: 600;
          margin-top: 10px;
          touch-action: manipulation;
          -webkit-tap-highlight-color: transparent;
        }
        
        .shop-buy-btn:disabled {
          background: #333;
          color: #666;
        }
      `}</style>

      <div className="mobile-ui">
        {/* Top HUD */}
        <div className="mobile-hud">
          <div className="hud-row">
            <div className="hud-item">
              <span className="hud-icon">💰</span>
              <span className="hud-value">{credits}</span>
            </div>
            
            <div className="wave-display">
              <span className="wave-number">Wave {currentWave}</span>
              {isWaveActive && waveProgress.total > 0 && (
                <div className="wave-progress">
                  <div 
                    className="wave-progress-bar" 
                    style={{ width: `${(waveProgress.destroyed / waveProgress.total) * 100}%` }}
                  />
                </div>
              )}
            </div>
            
            <div className="hud-item">
              <span className="hud-icon">🚀</span>
              <span className={`hud-value ${interceptors < 10 ? 'interceptor-warning' : ''}`}>
                {interceptors}
              </span>
            </div>
            
            <div className="hud-item">
              <span className="hud-icon">⭐</span>
              <span className="hud-value">{score}</span>
            </div>
          </div>
        </div>

        {/* Menu button */}
        <button 
          className="menu-btn"
          onClick={() => {
            vibrate(10);
            setShowMenu(true);
          }}
        >
          ☰
        </button>


        {/* Bottom action bar */}
        <div className="mobile-actions">
          <div className="action-row">
            {/* Mode toggle */}
            <button
              className="mode-btn"
              onClick={() => {
                vibrate(10);
                onModeChange?.(!isGameMode);
              }}
            >
              <span className="mode-icon">{isGameMode ? '🎮' : '🔧'}</span>
              <span className="mode-label">{isGameMode ? 'Game' : 'Sandbox'}</span>
            </button>

            <button
              className={`action-btn ${placementMode ? 'active' : ''}`}
              onClick={() => {
                vibrate(20);
                if (placementMode) {
                  placementSystem.exitPlacementMode();
                } else {
                  placementSystem.enterPlacementMode();
                }
              }}
              disabled={!placementSystem.canPlaceNewDome()}
            >
              <span className="action-icon">🛡️</span>
              <span className="action-label">
                {placementMode ? 'Cancel' : 'Dome'}
              </span>
            </button>

            <button
              className={`action-btn ${autoIntercept ? 'active' : ''}`}
              onClick={() => {
                vibrate(15);
                const controls = (window as any).__simulationControls;
                if (controls) {
                  controls.autoIntercept = !controls.autoIntercept;
                  setAutoIntercept(controls.autoIntercept);
                }
              }}
            >
              <span className="action-icon">{autoIntercept ? '🤖' : '🎯'}</span>
              <span className="action-label">
                {autoIntercept ? 'Auto' : 'Manual'}
              </span>
            </button>

            {isGameMode && (
              <button
                className="action-btn"
                onClick={() => {
                  vibrate(10);
                  setShowShop(true);
                }}
              >
                <span className="action-icon">🛒</span>
                <span className="action-label">Shop</span>
              </button>
            )}
            
            {!isGameMode && (
              <button
                className="action-btn"
                onClick={() => {
                  vibrate(10);
                  setShowControls(!showControls);
                  // Toggle the GUI visibility
                  const gui = (window as any).__gui;
                  if (gui) {
                    if (showControls) {
                      gui.domElement.style.display = 'none';
                    } else {
                      gui.domElement.style.display = 'block';
                    }
                  }
                }}
              >
                <span className="action-icon">⚙️</span>
                <span className="action-label">Controls</span>
              </button>
            )}
          </div>
        </div>

        {/* Slide-out menu */}
        <div className={`menu-overlay ${showMenu ? 'open' : ''}`} 
          onClick={() => setShowMenu(false)} 
        />
        <div className={`mobile-menu ${showMenu ? 'open' : ''}`}>
          <div className="menu-header">
            <div className="menu-title">Menu</div>
            <button className="menu-close" onClick={() => setShowMenu(false)}>
              ✕
            </button>
          </div>
          <div className="menu-content">
            <div className="menu-section">
              <div className="menu-section-title">Game</div>
              {isGameMode && (
                <div className="menu-item" onClick={() => {
                  vibrate(20);
                  // Use the same new game logic as desktop UI
                  const placementSystem = (window as any).__domePlacementSystem;
                  if (placementSystem) {
                    // Remove all batteries
                    const allBatteries = placementSystem.getAllBatteries();
                    const batteryIds = [];
                    allBatteries.forEach((battery: any) => {
                      const batteryId = placementSystem.getBatteryId(battery);
                      if (batteryId) batteryIds.push(batteryId);
                    });
                    batteryIds.forEach((id: string) => {
                      placementSystem.removeBattery(id);
                    });
                    
                    // Clear game state
                    gameState.startNewGame();
                    
                    // Create initial battery
                    const THREE = (window as any).THREE;
                    if (THREE) {
                      placementSystem.placeBatteryAt(new THREE.Vector3(0, 0, 0), 'battery_initial', 1);
                    }
                  }
                  
                  waveManager.startGame();
                  setShowMenu(false);
                  showNotification('New game started!');
                }}>
                  <span>New Game</span>
                  <span>🔄</span>
                </div>
              )}
              <div className="menu-item" onClick={() => {
                vibrate(10);
                setShowHelp(true);
                setShowMenu(false);
              }}>
                <span>Help</span>
                <span>❓</span>
              </div>
            </div>

            <div className="menu-section">
              <div className="menu-section-title">Camera</div>
              <div className="menu-item" onClick={() => {
                vibrate(10);
                const controller = (window as any).__cameraController;
                if (controller) controller.setMode('orbit');
                setShowMenu(false);
              }}>
                <span>Orbit View</span>
              </div>
              <div className="menu-item" onClick={() => {
                vibrate(10);
                const controller = (window as any).__cameraController;
                if (controller) controller.setMode('tactical');
                setShowMenu(false);
              }}>
                <span>Tactical View</span>
              </div>
            </div>
          </div>
        </div>

        {/* Shop Modal */}
        {showShop && (
          <>
            <div className="menu-overlay open" onClick={() => setShowShop(false)} />
            <div className="shop-modal">
              <h2 style={{color: 'white', textAlign: 'center', marginBottom: '10px'}}>
                Supply Shop
              </h2>
              <div className="shop-grid">
                <div className="shop-item-card">
                  <div className="shop-item-icon">🚀</div>
                  <div className="shop-item-name">Interceptors</div>
                  <div style={{fontSize: '12px', color: '#888'}}>+50 units</div>
                  <button 
                    className="shop-buy-btn"
                    onClick={() => {
                      const resourceManager = (window as any).__resourceManager;
                      if (resourceManager?.purchaseInterceptorRestock()) {
                        vibrate(30);
                        SoundSystem.getInstance().playUI('success');
                        showNotification('Purchased 50 interceptors!');
                      } else {
                        vibrate([10, 10, 10]);
                        SoundSystem.getInstance().playUI('fail');
                        showNotification('Insufficient credits!');
                      }
                    }}
                    disabled={credits < 200}
                  >
                    $200
                  </button>
                </div>

                <div className="shop-item-card">
                  <div className="shop-item-icon">🛡️</div>
                  <div className="shop-item-name">Dome Slot</div>
                  <div style={{fontSize: '12px', color: '#888'}}>+1 battery</div>
                  <button 
                    className="shop-buy-btn"
                    onClick={() => {
                      const resourceManager = (window as any).__resourceManager;
                      if (resourceManager?.purchaseNewDome()) {
                        vibrate(30);
                        SoundSystem.getInstance().playUI('success');
                        showNotification('New dome slot unlocked!');
                      } else {
                        vibrate([10, 10, 10]);
                        SoundSystem.getInstance().playUI('fail');
                        showNotification('Insufficient credits!');
                      }
                    }}
                    disabled={credits < 500}
                  >
                    $500
                  </button>
                </div>

                <div className="shop-item-card">
                  <div className="shop-item-icon">🔧</div>
                  <div className="shop-item-name">Auto-Repair</div>
                  <div style={{fontSize: '12px', color: '#888'}}>
                    {gameState.getAutoRepairLevel() === 0 
                      ? 'Auto fix' 
                      : `Lvl ${gameState.getAutoRepairLevel()}/3`}
                  </div>
                  <button 
                    className="shop-buy-btn"
                    onClick={() => {
                      const currentLevel = gameState.getAutoRepairLevel();
                      if (currentLevel >= 3) {
                        showNotification('Auto-repair is already at maximum level!');
                        return;
                      }
                      const resourceManager = (window as any).__resourceManager;
                      const cost = resourceManager.getCosts().autoRepair(currentLevel + 1);
                      if (gameState.spendCredits(cost)) {
                        gameState.upgradeAutoRepair();
                        vibrate(30);
                        SoundSystem.getInstance().playUI('success');
                        showNotification(`Auto-repair upgraded to level ${gameState.getAutoRepairLevel()}!`);
                        
                        // Apply auto-repair rate to all batteries
                        const repairRates = [0, 0.5, 1.0, 2.0];
                        const newRate = repairRates[gameState.getAutoRepairLevel()];
                        placementSystem.getAllBatteries().forEach((battery: any) => {
                          battery.setAutoRepairRate(newRate);
                        });
                      } else {
                        vibrate([10, 10, 10]);
                        SoundSystem.getInstance().playUI('fail');
                        showNotification('Insufficient credits!');
                      }
                    }}
                    disabled={
                      gameState.getAutoRepairLevel() >= 3 || 
                      credits < ((window as any).__resourceManager?.getCosts()?.autoRepair((gameState.getAutoRepairLevel() || 0) + 1) || 999999)
                    }
                  >
                    {gameState.getAutoRepairLevel() >= 3 
                      ? 'MAX' 
                      : `$${(window as any).__resourceManager?.getCosts()?.autoRepair((gameState.getAutoRepairLevel() || 0) + 1) || '???'}`}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Help Modal */}
        <HelpModal
          isOpen={showHelp}
          onClose={() => setShowHelp(false)}
          isGameMode={isGameMode}
        />
      </div>
    </>
  );
};