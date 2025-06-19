import React, { useState, useEffect } from 'react'
import { GameState } from '../game/GameState'
import { WaveManager } from '../game/WaveManager'
import { ResourceManager } from '../game/ResourceManager'
import { DomePlacementSystem } from '../game/DomePlacementSystem'
import { DeviceCapabilities } from '../utils/DeviceCapabilities'

interface GameUIProps {
  waveManager: WaveManager
  placementSystem: DomePlacementSystem
}

interface GameUIProps {
  waveManager: WaveManager
  placementSystem: DomePlacementSystem
  onModeChange?: (gameMode: boolean) => void
  isGameMode: boolean
}

interface GameOverData {
  score: number
  wave: number
  isHighScore: boolean
  previousHighScore: number
}

export const GameUI: React.FC<GameUIProps> = ({ waveManager, placementSystem, onModeChange, isGameMode }) => {
  const [credits, setCredits] = useState(0)
  const [interceptors, setInterceptors] = useState(0)
  const [currentWave, setCurrentWave] = useState(1)
  const [waveProgress, setWaveProgress] = useState({ spawned: 0, destroyed: 0, total: 0 })
  const [isWaveActive, setIsWaveActive] = useState(false)
  const [preparationTime, setPreparationTime] = useState(0)
  const [score, setScore] = useState(0)
  const [highScore, setHighScore] = useState(0)
  const [showShop, setShowShop] = useState(false)
  const [placementMode, setPlacementMode] = useState(false)
  const [gameOver, setGameOver] = useState<GameOverData | null>(null)
  
  // Store interval reference to clear it when needed
  const preparationIntervalRef = React.useRef<NodeJS.Timeout | null>(null)
  
  const gameState = GameState.getInstance()
  const resourceManager = ResourceManager.getInstance()
  const deviceInfo = DeviceCapabilities.getInstance().getDeviceInfo()
  
  useEffect(() => {
    // Initial state
    updateResourceDisplay()
    setPlacementMode(placementSystem.isInPlacementMode())
    
    // Check placement mode periodically to stay in sync
    const placementCheckInterval = setInterval(() => {
      const currentMode = placementSystem.isInPlacementMode()
      if (currentMode !== placementMode) {
        setPlacementMode(currentMode)
      }
    }, 100)
    
    // Check for game over periodically
    const gameOverCheckInterval = setInterval(() => {
      checkGameOver()
    }, 500)
    
    // Subscribe to game events
    const handleCreditsChanged = () => setCredits(gameState.getCredits())
    const handleInterceptorsChanged = () => setInterceptors(gameState.getInterceptorStock())
    const handleScoreChanged = () => {
      setScore(gameState.getScore())
      setHighScore(gameState.getHighScore())
    }
    
    const handleWaveStarted = (data: any) => {
      setCurrentWave(data.waveNumber)
      setIsWaveActive(true)
      setPreparationTime(0)
      // Initialize wave progress immediately
      setWaveProgress({
        spawned: 0,
        destroyed: 0,
        total: data.totalThreats || 0
      })
    }
    
    const handleWavePreparation = (data: any) => {
      setCurrentWave(data.waveNumber)
      setIsWaveActive(false)
      setPreparationTime(data.preparationTime)
      startPreparationCountdown(data.preparationTime)
    }
    
    const handleWaveProgress = (data: any) => {
      setWaveProgress({
        spawned: data.spawned,
        destroyed: data.destroyed,
        total: data.total
      })
    }
    
    const handleWaveCompleted = (data: any) => {
      // Show wave complete notification
      showNotification(`Wave ${data.waveNumber} Complete! +${data.creditsEarned} credits`)
    }
    
    const handleNewGame = () => {
      // Update all displays when new game starts
      updateResourceDisplay()
      setGameOver(null)
    }
    
    const handleDomeUnlocked = () => {
      // Force update when dome count changes
      updateResourceDisplay()
    }
    
    // Check for game over
    const checkGameOver = () => {
      if (!isGameMode) return
      
      const allBatteries = placementSystem.getAllBatteries()
      const operationalBatteries = allBatteries.filter(battery => battery.isOperational())
      
      if (operationalBatteries.length === 0 && allBatteries.length > 0) {
        // All batteries destroyed - game over!
        const currentScore = gameState.getScore()
        const previousHigh = gameState.getHighScore()
        const isNewHighScore = currentScore > previousHigh
        
        setGameOver({
          score: currentScore,
          wave: gameState.getCurrentWave(),
          isHighScore: isNewHighScore,
          previousHighScore: previousHigh
        })
        
        // Stop the game
        waveManager.pauseWave()
      }
    }
    
    // Attach listeners
    gameState.on('creditsChanged', handleCreditsChanged)
    gameState.on('interceptorsChanged', handleInterceptorsChanged)
    gameState.on('scoreChanged', handleScoreChanged)
    gameState.on('newGame', handleNewGame)
    gameState.on('domeUnlocked', handleDomeUnlocked)
    waveManager.on('waveStarted', handleWaveStarted)
    waveManager.on('wavePreparation', handleWavePreparation)
    waveManager.on('waveProgress', handleWaveProgress)
    waveManager.on('waveCompleted', handleWaveCompleted)
    
    // Cleanup
    return () => {
      // Clear preparation countdown if active
      if (preparationIntervalRef.current) {
        clearInterval(preparationIntervalRef.current)
        preparationIntervalRef.current = null
      }
      
      // Clear intervals
      clearInterval(placementCheckInterval)
      clearInterval(gameOverCheckInterval)
      
      gameState.off('creditsChanged', handleCreditsChanged)
      gameState.off('interceptorsChanged', handleInterceptorsChanged)
      gameState.off('scoreChanged', handleScoreChanged)
      gameState.off('newGame', handleNewGame)
      gameState.off('domeUnlocked', handleDomeUnlocked)
      waveManager.off('waveStarted', handleWaveStarted)
      waveManager.off('wavePreparation', handleWavePreparation)
      waveManager.off('waveProgress', handleWaveProgress)
      waveManager.off('waveCompleted', handleWaveCompleted)
    }
  }, [placementMode])
  
  const updateResourceDisplay = () => {
    setCredits(gameState.getCredits())
    setInterceptors(gameState.getInterceptorStock())
    setScore(gameState.getScore())
    setHighScore(gameState.getHighScore())
  }
  
  const startPreparationCountdown = (seconds: number) => {
    // Clear any existing countdown
    if (preparationIntervalRef.current) {
      clearInterval(preparationIntervalRef.current)
      preparationIntervalRef.current = null
    }
    
    let remaining = seconds
    preparationIntervalRef.current = setInterval(() => {
      remaining--
      setPreparationTime(remaining)
      if (remaining <= 0) {
        if (preparationIntervalRef.current) {
          clearInterval(preparationIntervalRef.current)
          preparationIntervalRef.current = null
        }
      }
    }, 1000)
  }
  
  const showNotification = (message: string) => {
    const notification = document.createElement('div')
    notification.className = 'game-notification'
    notification.textContent = message
    document.body.appendChild(notification)
    
    setTimeout(() => {
      notification.remove()
    }, 3000)
  }
  
  const startNewGame = () => {
    // Clear any existing countdown
    if (preparationIntervalRef.current) {
      clearInterval(preparationIntervalRef.current)
      preparationIntervalRef.current = null
    }
    setPreparationTime(0)
    
    // Clear current game state
    gameState.startNewGame()
    
    // Reset domes - remove all existing ones
    const allBatteries = placementSystem.getAllBatteries()
    allBatteries.forEach(battery => {
      // Skip the initial battery at center
      if (battery.getPosition().length() > 1) {
        const batteryId = placementSystem.getBatteryId(battery)
        if (batteryId) {
          placementSystem.removeBattery(batteryId)
        }
      }
    })
    
    // Heal the center battery to full health
    const centerBattery = placementSystem.getAllBatteries()[0]
    if (centerBattery) {
      const health = centerBattery.getHealth()
      centerBattery.repair(health.max - health.current)
    }
    
    // Start fresh wave sequence
    waveManager.startGame()
    showNotification('New game started!')
    // Update display
    setScore(0)
    setCredits(gameState.getCredits())
    setInterceptors(gameState.getInterceptorStock())
    // Force update placement info
    updateResourceDisplay()
  }
  
  const vibrate = (pattern: number | number[]) => {
    if ('vibrate' in navigator) {
      navigator.vibrate(pattern)
    }
  }
  
  const handlePlaceDome = () => {
    vibrate(20)
    if (placementSystem.isInPlacementMode()) {
      placementSystem.exitPlacementMode()
      setPlacementMode(false)
    } else {
      placementSystem.enterPlacementMode()
      setPlacementMode(true)
    }
  }
  
  const handlePurchaseInterceptors = () => {
    if (resourceManager.purchaseInterceptorRestock()) {
      vibrate(30)
      showNotification('Purchased 50 interceptors!')
    } else {
      vibrate([10, 10, 10]) // Error pattern
    }
  }
  
  const handleEmergencySupply = () => {
    if (resourceManager.purchaseEmergencySupply()) {
      vibrate([50, 50, 50]) // Success pattern
      showNotification('Emergency supply delivered!')
    } else {
      vibrate([10, 10, 10]) // Error pattern
    }
  }
  
  const costs = resourceManager.getCosts()
  const placementInfo = placementSystem.getPlacementInfo()
  
  return (
    <>
      <style>{`
        .game-ui {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          padding: 20px;
          pointer-events: none;
          font-family: 'Arial', sans-serif;
          z-index: 100;
        }
        
        .ui-panel {
          background: rgba(0, 0, 0, 0.75);
          border: 1px solid #0038b8;
          border-radius: 8px;
          padding: 8px 12px;
          pointer-events: auto;
          color: #fff;
          box-shadow: 0 0 15px rgba(0, 56, 184, 0.3);
        }
        
        .top-bar {
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          gap: 20px;
          margin-bottom: 10px;
          align-items: stretch;
          min-height: 35px;
        }
        
        .resource-panel {
          display: flex;
          gap: 30px;
          justify-self: start;
          align-items: center;
          height: 100%;
        }
        
        .resource-item {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        
        .resource-icon {
          font-size: 18px;
        }
        
        .resource-value {
          font-size: 16px;
          font-weight: bold;
          color: #0038b8;
        }
        
        .wave-panel {
          text-align: center;
          justify-self: center;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          height: 100%;
        }
        
        .wave-number {
          font-size: 20px;
          font-weight: bold;
          color: #0038b8;
          margin-bottom: 5px;
        }
        
        .wave-progress {
          width: 150px;
          height: 8px;
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid #0038b8;
          border-radius: 10px;
          overflow: hidden;
          margin: 5px auto;
        }
        
        .wave-progress-bar {
          height: 100%;
          background: linear-gradient(90deg, #0038b8, #0095ff);
          transition: width 0.3s;
        }
        
        .score-panel {
          text-align: right;
          justify-self: end;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: flex-end;
          height: 100%;
        }
        
        .score-value {
          font-size: 18px;
          font-weight: bold;
          color: #0038b8;
        }
        
        .high-score {
          font-size: 12px;
          color: #aaa;
        }
        
        .action-buttons {
          position: fixed;
          bottom: 20px;
          right: 20px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          pointer-events: auto;
        }
        
        .bottom-controls {
          position: fixed;
          bottom: 20px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          gap: 15px;
          pointer-events: auto;
          background: rgba(0, 0, 0, 0.8);
          padding: 15px 25px;
          border-radius: 10px;
          border: 2px solid #0038b8;
          align-items: center;
        }
        
        .mode-switch {
          display: flex;
          background: rgba(0, 56, 184, 0.1);
          border-radius: 5px;
          overflow: hidden;
          border: 1px solid #0038b8;
        }
        
        .mode-button {
          padding: 10px 20px;
          background: transparent;
          border: none;
          color: white;
          font-weight: bold;
          cursor: pointer;
          transition: all 0.3s;
          font-size: 14px;
          -webkit-tap-highlight-color: transparent;
          touch-action: manipulation;
        }
        
        .mode-button.active {
          background: #0038b8;
          color: white;
        }
        
        .mode-button:hover:not(.active) {
          background: rgba(0, 56, 184, 0.5);
        }
        
        .mode-button:active {
          transform: scale(0.98);
        }
        
        .control-button {
          background: #0038b8;
          border: 2px solid #0038b8;
          color: white;
          padding: 10px 20px;
          border-radius: 5px;
          font-size: 14px;
          font-weight: bold;
          cursor: pointer;
          transition: all 0.3s;
          -webkit-tap-highlight-color: transparent;
          touch-action: manipulation;
        }
        
        .control-button:hover {
          background: rgba(0, 86, 214, 0.9);
          box-shadow: 0 0 10px rgba(0, 56, 184, 0.5);
        }
        
        .control-button:active {
          transform: scale(0.98);
          background: #0045b0;
        }
        
        .control-button:disabled {
          background: rgba(50, 50, 50, 0.8);
          border-color: #666;
          color: #666;
          cursor: not-allowed;
        }
        
        /* Mobile responsive */
        @media (max-width: 768px) {
          .bottom-controls {
            padding: 12px 20px;
            gap: 12px;
            bottom: 15px;
          }
          
          .mode-button {
            padding: 12px 20px;
            font-size: 14px;
            min-height: 44px; /* iOS touch target size */
          }
          
          .control-button {
            padding: 12px 20px;
            font-size: 14px;
            min-height: 44px;
          }
          
          .action-buttons {
            bottom: 90px; /* Move up on mobile */
            right: 15px;
            gap: 12px;
          }
          
          .game-button {
            padding: 14px 24px;
            font-size: 16px;
            min-height: 48px;
            min-width: 160px;
          }
          
          .top-bar {
            display: flex;
            flex-direction: column;
            gap: 10px;
            padding: 15px;
          }
          
          .resource-panel {
            order: 2;
            justify-self: center;
            gap: 20px;
          }
          
          .resource-icon {
            font-size: 20px;
          }
          
          .resource-value {
            font-size: 18px;
          }
          
          .wave-panel {
            order: 1;
            width: 100%;
            padding: 12px 16px;
          }
          
          .wave-number {
            font-size: 22px;
          }
          
          .score-panel {
            order: 3;
            justify-self: center;
            text-align: center;
          }
          
          .score-value {
            font-size: 20px;
          }
          
          /* Touch-friendly modal */
          .shop-modal {
            min-width: 90vw;
            max-width: 400px;
            padding: 25px;
            max-height: 90vh;
            overflow-y: auto;
          }
          
          .shop-item {
            padding: 18px;
            margin-bottom: 12px;
          }
          
          .shop-close {
            font-size: 28px;
            padding: 10px;
            min-width: 44px;
            min-height: 44px;
          }
          
          /* Touch-friendly notification */
          .game-notification {
            font-size: 18px;
            padding: 16px 28px;
          }
        }
        
        .game-button {
          background: #0038b8;
          border: 2px solid #0038b8;
          color: white;
          padding: 12px 20px;
          border-radius: 5px;
          font-size: 16px;
          font-weight: bold;
          cursor: pointer;
          transition: all 0.3s;
          min-width: 200px;
          -webkit-tap-highlight-color: transparent;
          touch-action: manipulation;
        }
        
        .game-button:hover {
          background: #0056d6;
          border-color: #0056d6;
          box-shadow: 0 0 15px rgba(0, 56, 184, 0.5);
        }
        
        .game-button:active {
          transform: scale(0.98);
          background: #0045b0;
        }
        
        .game-button:disabled {
          background: rgba(50, 50, 50, 0.8);
          border-color: #666;
          color: #666;
          cursor: not-allowed;
        }
        
        .game-button.active {
          background: #ff6600;
          border-color: #ff6600;
        }
        
        .button-cost {
          font-size: 12px;
          color: #ffcc00;
          opacity: 0.9;
        }
        
        .wave-text {
          font-size: 10px;
          text-align: center;
          color: #aaa;
          margin-top: 2px;
        }
        
        .preparation-timer {
          font-size: 14px;
          color: #ffff00;
          animation: pulse 1s infinite;
          margin-top: 5px;
        }
        
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.5; }
          100% { opacity: 1; }
        }
        
        .shop-modal {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: rgba(0, 0, 0, 0.95);
          border: 3px solid #0038b8;
          border-radius: 15px;
          padding: 30px;
          min-width: 400px;
          pointer-events: auto;
          z-index: 200;
        }
        
        .shop-title {
          font-size: 24px;
          color: #0038b8;
          margin-bottom: 20px;
          text-align: center;
        }
        
        .shop-item {
          background: rgba(0, 56, 184, 0.5);
          border: 1px solid #0038b8;
          border-radius: 5px;
          padding: 15px;
          margin-bottom: 10px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .shop-close {
          position: absolute;
          top: 10px;
          right: 10px;
          background: none;
          border: none;
          color: #ff0000;
          font-size: 24px;
          cursor: pointer;
        }
        
        .warning {
          color: #ff6600;
          animation: blink 1s infinite;
        }
        
        .warning-low {
          color: #ff0000;
          animation: blink 0.5s infinite;
        }
        
        @keyframes blink {
          0% { opacity: 1; }
          50% { opacity: 0.3; }
          100% { opacity: 1; }
        }
        
        .game-notification {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: rgba(0, 0, 0, 0.85);
          border: 1px solid #0038b8;
          padding: 12px 24px;
          border-radius: 8px;
          color: #0038b8;
          font-size: 16px;
          font-weight: bold;
          pointer-events: none;
          z-index: 300;
          animation: fadeInOut 3s;
        }
        
        .game-over-screen {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.95);
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          z-index: 500;
          animation: fadeIn 0.5s;
        }
        
        .game-over-title {
          font-size: 48px;
          font-weight: bold;
          color: #ff0000;
          margin-bottom: 20px;
          text-shadow: 0 0 20px rgba(255, 0, 0, 0.5);
          animation: pulse 1s infinite;
        }
        
        .game-over-subtitle {
          font-size: 32px;
          font-weight: bold;
          color: #ffff00;
          margin-bottom: 30px;
          text-shadow: 0 0 15px rgba(255, 255, 0, 0.5);
          animation: glow 2s ease-in-out infinite alternate;
        }
        
        .game-over-stats {
          background: rgba(0, 0, 0, 0.8);
          border: 2px solid #0038b8;
          border-radius: 15px;
          padding: 30px 50px;
          margin-bottom: 30px;
        }
        
        .game-over-stat {
          font-size: 24px;
          color: white;
          margin: 15px 0;
          display: flex;
          justify-content: space-between;
          gap: 50px;
        }
        
        .game-over-stat-label {
          color: #aaa;
        }
        
        .game-over-stat-value {
          color: #0038b8;
          font-weight: bold;
        }
        
        .game-over-buttons {
          display: flex;
          gap: 20px;
        }
        
        .game-over-button {
          background: #0038b8;
          border: 2px solid #0038b8;
          color: white;
          padding: 15px 30px;
          border-radius: 8px;
          font-size: 18px;
          font-weight: bold;
          cursor: pointer;
          transition: all 0.3s;
        }
        
        .game-over-button:hover {
          background: #0056d6;
          border-color: #0056d6;
          transform: scale(1.05);
          box-shadow: 0 0 20px rgba(0, 56, 184, 0.5);
        }
        
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        
        @keyframes glow {
          from { text-shadow: 0 0 15px rgba(255, 255, 0, 0.5); }
          to { text-shadow: 0 0 25px rgba(255, 255, 0, 0.8), 0 0 35px rgba(255, 255, 0, 0.6); }
        }
        
        @keyframes fadeInOut {
          0% { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
          20% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          80% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
        }
        
        .placement-mode-indicator {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: rgba(0, 56, 184, 0.9);
          border: 3px solid #0038b8;
          border-radius: 10px;
          padding: 20px 40px;
          color: white;
          font-size: 20px;
          font-weight: bold;
          pointer-events: none;
          z-index: 200;
          animation: pulse 2s infinite;
        }
        
        @media (max-width: 768px) {
          .placement-mode-indicator {
            font-size: 18px;
            padding: 16px 32px;
          }
        }
        .floating-wave-indicator {
          position: fixed;
          top: 60px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(0, 0, 0, 0.7);
          border: 1px solid #0038b8;
          border-radius: 8px;
          padding: 5px 15px;
          color: white;
          font-family: 'Arial', sans-serif;
          box-shadow: 0 0 15px rgba(0, 56, 184, 0.3);
          min-width: 200px;
          z-index: 10;
        }
        
        .floating-wave-number {
          font-size: 16px;
          font-weight: bold;
          color: #0038b8;
          margin-bottom: 8px;
          text-align: center;
        }
        
        .floating-wave-progress {
          width: 100%;
          height: 8px;
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid #0038b8;
          border-radius: 10px;
          overflow: hidden;
          margin-bottom: 3px;
        }
        
        .floating-wave-progress-bar {
          height: 100%;
          background: linear-gradient(90deg, #0038b8, #0095ff);
          transition: width 0.3s;
        }
        
        .floating-wave-text {
          font-size: 10px;
          text-align: center;
          color: #aaa;
        }
        
      `}</style>
      
      <div className="game-ui">
        <div className="top-bar">
          {isGameMode ? (
            // Game mode: Show all game panels
            <>
              <div className="ui-panel resource-panel">
                <div className="resource-item">
                  <span className="resource-icon">💰</span>
                  <span className="resource-value">{credits}</span>
                </div>
                <div className="resource-item">
                  <span className="resource-icon">🚀</span>
                  <span className={`resource-value ${interceptors < 10 ? 'warning' : interceptors < 5 ? 'warning-low' : ''}`}>
                    {interceptors}
                  </span>
                </div>
                <div className="resource-item">
                  <span className="resource-icon">🛡️</span>
                  <span className="resource-value">
                    {placementInfo.placedDomes}/{placementInfo.unlockedDomes}
                  </span>
                </div>
              </div>
              
              <div className="ui-panel wave-panel">
                <div className="wave-number">Wave {currentWave}</div>
                {isWaveActive ? (
                  <>
                    <div className="wave-progress">
                      <div 
                        className="wave-progress-bar" 
                        style={{ width: `${(waveProgress.destroyed / waveProgress.total) * 100}%` }}
                      />
                    </div>
                    <div className="wave-text">{waveProgress.destroyed}/{waveProgress.total} Threats</div>
                  </>
                ) : preparationTime > 0 ? (
                  <div className="preparation-timer">
                    Next wave in {preparationTime}s
                  </div>
                ) : null}
              </div>
              
              <div className="ui-panel score-panel">
                <div className="score-value">{score.toLocaleString()}</div>
                <div className="high-score">High: {highScore.toLocaleString()}</div>
              </div>
            </>
          ) : (
            // Sandbox mode: Centered panel in middle column
            <>
              <div></div>
              <div className="ui-panel wave-panel">
                <div className="wave-number">Sandbox Mode</div>
                <div style={{ fontSize: '14px', marginTop: '5px' }}>Free Play</div>
              </div>
              <div></div>
            </>
          )}
        </div>
      </div>
      
      <div className="bottom-controls">
        <div className="mode-switch">
          <button 
            className={`mode-button ${isGameMode ? 'active' : ''}`}
            onClick={() => {
              vibrate(15)
              onModeChange?.(true)
            }}
          >
            GAME
          </button>
          <button 
            className={`mode-button ${!isGameMode ? 'active' : ''}`}
            onClick={() => {
              vibrate(15)
              onModeChange?.(false)
            }}
          >
            SANDBOX
          </button>
        </div>
        
        {isGameMode && (
          <>
            <button 
              className="control-button"
              onClick={() => {
                vibrate(20)
                startNewGame()
              }}
            >
              New Game
            </button>
            
            {!isWaveActive && preparationTime > 0 && (
              <button 
                className="control-button"
                onClick={() => {
                  vibrate(15)
                  waveManager.skipPreparation()
                  showNotification('Skipping to next wave!')
                }}
              >
                Start Next Wave
              </button>
            )}
          </>
        )}
      </div>
      
      <div className="action-buttons">
        <button 
          className={`game-button ${placementMode ? 'active' : ''}`}
          onClick={handlePlaceDome}
          disabled={!placementSystem.canPlaceNewDome()}
        >
          {placementMode ? 'Cancel Placement' : 'Place Dome'}
          {!placementMode && placementInfo.placedDomes >= placementInfo.unlockedDomes && (
            <div className="button-cost">Cost: {costs.domeUnlock}</div>
          )}
        </button>
        
        <button 
          className="game-button"
          onClick={() => setShowShop(!showShop)}
        >
          Shop
        </button>
        
        {interceptors < 20 && isWaveActive && (
          <button 
            className="game-button warning"
            onClick={handleEmergencySupply}
            disabled={credits < costs.emergencySupply}
          >
            Emergency Supply
            <div className="button-cost">Cost: {costs.emergencySupply}</div>
          </button>
        )}
      </div>
      
      {/* Placement Mode Indicator for Mobile */}
      {placementMode && deviceInfo?.hasTouch && (
        <div className="placement-mode-indicator">
          Tap to place dome
        </div>
      )}
      
      {/* Game Over Screen */}
      {gameOver && (
        <div className="game-over-screen">
          <div className="game-over-title">GAME OVER</div>
          {gameOver.isHighScore && (
            <div className="game-over-subtitle">NEW HIGH SCORE!</div>
          )}
          <div className="game-over-stats">
            <div className="game-over-stat">
              <span className="game-over-stat-label">Final Score</span>
              <span className="game-over-stat-value">{gameOver.score.toLocaleString()}</span>
            </div>
            <div className="game-over-stat">
              <span className="game-over-stat-label">Waves Survived</span>
              <span className="game-over-stat-value">{gameOver.wave - 1}</span>
            </div>
            {gameOver.isHighScore && (
              <div className="game-over-stat">
                <span className="game-over-stat-label">Previous Best</span>
                <span className="game-over-stat-value">{gameOver.previousHighScore.toLocaleString()}</span>
              </div>
            )}
          </div>
          <div className="game-over-buttons">
            <button 
              className="game-over-button"
              onClick={() => {
                setGameOver(null)
                startNewGame()
              }}
            >
              New Game
            </button>
            <button 
              className="game-over-button"
              onClick={() => {
                setGameOver(null)
                onModeChange?.(false)
              }}
            >
              Sandbox Mode
            </button>
          </div>
        </div>
      )}
      
      {showShop && (
        <div className="shop-modal">
          <button className="shop-close" onClick={() => {
            vibrate(10)
            setShowShop(false)
          }}>✕</button>
          <h2 className="shop-title">Supply Shop</h2>
          
          <div className="shop-item">
            <div>
              <div>Interceptor Restock</div>
              <div style={{ fontSize: '14px', color: '#6B7280' }}>+50 Interceptors</div>
            </div>
            <button 
              className="game-button"
              onClick={handlePurchaseInterceptors}
              disabled={credits < costs.interceptorRestock}
            >
              Buy ({costs.interceptorRestock})
            </button>
          </div>
          
          <div className="shop-item">
            <div>
              <div>Unlock New Dome Slot</div>
              <div style={{ fontSize: '14px', color: '#6B7280' }}>+1 Dome placement</div>
            </div>
            <button 
              className="game-button"
              onClick={() => {
                if (resourceManager.purchaseNewDome()) {
                  vibrate(30)
                  showNotification('New dome slot unlocked!')
                  updateResourceDisplay()
                } else {
                  vibrate([10, 10, 10]) // Error pattern
                }
              }}
              disabled={credits < costs.domeUnlock}
            >
              Buy ({costs.domeUnlock})
            </button>
          </div>
        </div>
      )}
    </>
  )
}