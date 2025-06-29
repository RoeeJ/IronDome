import React from 'react';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
  isGameMode: boolean;
}

export const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose, isGameMode }) => {
  if (!isOpen) return null;

  return (
    <>
      <style>{`
        .help-modal-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.8);
          z-index: 10000;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: auto;
        }
        
        .help-modal {
          background: rgba(0, 0, 0, 0.95);
          border: 3px solid #0038b8;
          border-radius: 15px;
          padding: 30px;
          max-width: 600px;
          max-height: 80vh;
          overflow-y: auto;
          color: white;
          font-family: Arial, sans-serif;
          position: relative;
        }
        
        .help-title {
          font-size: 28px;
          font-weight: bold;
          color: #0038b8;
          text-align: center;
          margin-bottom: 25px;
        }
        
        .help-section {
          margin-bottom: 25px;
        }
        
        .help-section-title {
          font-size: 20px;
          color: #0095ff;
          margin-bottom: 10px;
          font-weight: bold;
        }
        
        .help-text {
          font-size: 16px;
          line-height: 1.6;
          color: #ddd;
        }
        
        .help-controls {
          background: rgba(0, 56, 184, 0.2);
          padding: 15px;
          border-radius: 8px;
          margin: 10px 0;
        }
        
        .help-key {
          display: inline-block;
          background: #0038b8;
          padding: 4px 10px;
          border-radius: 4px;
          margin: 0 5px;
          font-weight: bold;
          font-size: 14px;
        }
        
        .help-close {
          position: absolute;
          top: 15px;
          right: 15px;
          background: none;
          border: none;
          color: #ff0000;
          font-size: 28px;
          cursor: pointer;
          padding: 5px;
          width: 40px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        .help-close:hover {
          color: #ff6666;
        }
        
        .help-footer {
          text-align: center;
          margin-top: 30px;
          padding-top: 20px;
          border-top: 1px solid #0038b8;
        }
        
        .star-of-david {
          font-size: 48px;
          color: #0038b8;
          margin: 10px 0;
        }
        
        .hebrew-text {
          font-size: 24px;
          font-weight: bold;
          color: #0095ff;
          margin: 10px 0;
        }
        
        @media (max-width: 768px) {
          .help-modal {
            max-width: 90vw;
            padding: 20px;
          }
          
          .help-title {
            font-size: 24px;
          }
          
          .help-section-title {
            font-size: 18px;
          }
          
          .help-text {
            font-size: 14px;
          }
        }
      `}</style>

      <div className="help-modal-backdrop" onClick={onClose}>
        <div className="help-modal" onClick={e => e.stopPropagation()}>
          <button className="help-close" onClick={onClose}>
            ✕
          </button>

          <h2 className="help-title">Iron Dome Defense System</h2>

          <div className="help-section">
            <h3 className="help-section-title">Overview</h3>
            <p className="help-text">
              Command Israel's Iron Dome missile defense system. Protect cities by intercepting
              incoming threats including rockets, missiles, and drones. Place defense batteries
              strategically and manage your resources wisely.
            </p>
          </div>

          <div className="help-section">
            <h3 className="help-section-title">Game Modes</h3>
            <p className="help-text">
              <strong>Game Mode:</strong> Progress through increasingly difficult waves. Every 10th
              wave is a boss wave with double difficulty. Manage limited resources, earn credits for
              successful defenses, and unlock upgrades. Batteries can be damaged and destroyed by
              nearby impacts.
            </p>
            <p className="help-text">
              <strong>Sandbox Mode:</strong> Free play with unlimited resources. Place batteries
              freely, infinite interceptors, and no damage system. Perfect for practicing and
              experimenting.
            </p>
          </div>

          <div className="help-section">
            <h3 className="help-section-title">Controls</h3>
            <div className="help-controls">
              <p className="help-text">
                <span className="help-key">Left Click</span> Fire interceptor at threat / Rotate
                camera
              </p>
              <p className="help-text">
                <span className="help-key">Shift + Click</span> Mark threat as priority
              </p>
              <p className="help-text">
                <span className="help-key">Right Click</span> Open battery context menu
              </p>
              <p className="help-text">
                <span className="help-key">Scroll</span> Zoom in/out
              </p>
              <p className="help-text">
                <span className="help-key">ESC</span> Pause game / Open pause menu
              </p>
              <p className="help-text">
                <span className="help-key">R</span> Toggle performance stats
              </p>
              <p className="help-text">
                <span className="help-key">Ctrl+Shift+D</span> Developer tools
              </p>
              <p className="help-text">
                <span className="help-key">Ctrl+Shift+S</span> Screenshot mode
              </p>
              <p className="help-text">
                <strong>Mobile:</strong> Touch to fire/rotate, pinch to zoom, long press for menu
              </p>
            </div>
          </div>

          <div className="help-section">
            <h3 className="help-section-title">Threat Types</h3>
            <p className="help-text">
              <strong>🚀 Rockets:</strong> Fast, low-altitude threats. Common but dangerous in large
              numbers.
            </p>
            <p className="help-text">
              <strong>💣 Mortars:</strong> High-arc projectiles with steep descent. Short range but
              hard to track.
            </p>
            <p className="help-text">
              <strong>🎯 Missiles:</strong> High-altitude ballistic threats. Slower but harder to
              intercept.
            </p>
            <p className="help-text">
              <strong>🚁 Cruise Missiles:</strong> Low-flying guided missiles. Can maneuver around
              defenses.
            </p>
            <p className="help-text">
              <strong>✈️ Drones:</strong> Slow-moving aerial threats. Can change direction and are
              persistent.
            </p>
          </div>

          <div className="help-section">
            <h3 className="help-section-title">Battery Management</h3>
            <p className="help-text">
              {isGameMode ? (
                <>
                  • Each battery has limited interceptors that reload over time
                  <br />
                  • Upgrade batteries to improve range, accuracy, and reload speed
                  <br />
                  • Protect your batteries - they can be damaged by impacts
                  <br />
                  • Place new batteries strategically to cover blind spots
                  <br />• Each interceptor costs resources - use them wisely
                </>
              ) : (
                <>
                  • Unlimited interceptors with instant reload
                  <br />
                  • Free upgrades to experiment with different configurations
                  <br />
                  • No damage - batteries cannot be destroyed
                  <br />
                  • Place as many batteries as you want
                  <br />• Perfect for learning threat patterns and practicing
                </>
              )}
            </p>
          </div>

          <div className="help-section">
            <h3 className="help-section-title">Interception Mechanics</h3>
            <p className="help-text">
              • Interceptors use proximity fuses - they detonate within 5m of threats
              <br />
              • Blast damage is physics-based with lethal range of 3m
              <br />
              • Manual targeting (clicking threats) bypasses automatic systems
              <br />
              • Failed intercepts allow other interceptors to try
              <br />• Interceptors have limited fuel and guidance time
            </p>
          </div>

          <div className="help-section">
            <h3 className="help-section-title">Audio & Settings</h3>
            <p className="help-text">
              • Background music and sound effects can be adjusted in the pause menu
              <br />
              • Separate volume controls for BGM and SFX
              <br />
              • All audio settings are saved automatically
              <br />
              • Spatial audio for explosions and launches - sounds come from their 3D position
              <br />• Multiple explosion sound variants for variety
            </p>
          </div>

          <div className="help-section">
            <h3 className="help-section-title">Camera Controls</h3>
            <p className="help-text">
              <span className="help-key">1</span> Orbit camera mode
              <br />
              <span className="help-key">2</span> Tactical view
              <br />
              <span className="help-key">3</span> Battle overview
              <br />
              <span className="help-key">4</span> Cinematic mode
              <br />
              <span className="help-key">5</span> Follow threat camera
              <br />
              <span className="help-key">6</span> Follow interceptor camera
              <br />
              • Smooth camera transitions between modes
              <br />
              • Camera automatically returns after target is destroyed
              <br />• Use scroll wheel to zoom in/out at any time
            </p>
          </div>

          <div className="help-section">
            <h3 className="help-section-title">Tips & Strategy</h3>
            <p className="help-text">
              • Watch for red impact prediction circles on the ground
              <br />
              • Prioritize threats heading toward your batteries
              <br />
              • Multiple interceptors improve success rate against difficult targets
              <br />
              • Place batteries to cover different approach angles
              <br />
              • Save credits for upgrades rather than many basic batteries
              <br />
              • Boss waves (every 10th) require maximum defense readiness
              <br />• Use the pause menu (ESC) to adjust settings mid-game
            </p>
          </div>

          <div className="help-footer">
            <div className="star-of-david">✡️</div>
            <div className="hebrew-text">עם ישראל חי</div>
          </div>
        </div>
      </div>
    </>
  );
};
