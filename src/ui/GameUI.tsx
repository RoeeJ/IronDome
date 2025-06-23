import React, { useState, useEffect } from 'react'
import { GameState } from '../game/GameState'
import { WaveManager } from '../game/WaveManager'
import { ResourceManager } from '../game/ResourceManager'
import { DomePlacementSystem } from '../game/DomePlacementSystem'
import { DeviceCapabilities } from '../utils/DeviceCapabilities'
import { DomeContextMenu } from './DomeContextMenu'
import { HelpModal } from './HelpModal'
import * as THREE from 'three'

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
  const [hasViewedHelp, setHasViewedHelp] = useState(() => {
    return localStorage.getItem('helpViewed') === 'true'
  })
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
  const [contextMenu, setContextMenu] = useState<{
    battery: any
    batteryId: string
    position: { x: number; y: number }
  } | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  const [confirmNewGame, setConfirmNewGame] = useState(false)
  const [autoIntercept, setAutoIntercept] = useState(false) // Default to manual for game mode
  const [isPaused, setIsPaused] = useState(false)
  const [shopCollapsed, setShopCollapsed] = useState(true) // Shop starts collapsed
  const confirmTimeoutRef = React.useRef<NodeJS.Timeout | null>(null)
  
  // Store interval reference to clear it when needed
  const preparationIntervalRef = React.useRef<NodeJS.Timeout | null>(null)
  
  const gameState = GameState.getInstance()
  const resourceManager = ResourceManager.getInstance()
  const deviceInfo = DeviceCapabilities.getInstance().getDeviceInfo()
  
  useEffect(() => {
    // Initial state
    updateResourceDisplay()
    setPlacementMode(placementSystem.isInPlacementMode())
    
    // Sync initial auto intercept state
    const controls = (window as any).__simulationControls
    if (controls) {
      setAutoIntercept(controls.autoIntercept)
    }
    
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
      
      // Check if auto-intercept was just unlocked
      if (data.waveNumber === 4 && isGameMode) {
        setTimeout(() => {
          showNotification('🎆 AUTO-INTERCEPT UNLOCKED! Toggle between manual and auto modes.')
          // Enable auto-intercept by default when unlocked
          const controls = (window as any).__simulationControls
          controls.autoIntercept = true
          setAutoIntercept(true)
        }, 2000)
      }
    }
    
    const handleNewGame = () => {
      // Update all displays when new game starts
      updateResourceDisplay()
      setGameOver(null)
      // Reset to manual mode for new game
      const controls = (window as any).__simulationControls
      if (controls) {
        controls.autoIntercept = false
        setAutoIntercept(false)
        localStorage.setItem('ironDome_interceptMode', 'false')
      }
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
        
        // Pause the entire simulation
        const simulationControls = (window as any).__simulationControls
        if (simulationControls) {
          simulationControls.pause = true
        }
        
        // Disable OrbitControls
        const controls = (window as any).__controls
        if (controls) controls.enabled = false
      }
    }
    
    // Handle right-click on batteries
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault()
      
      // Cast ray to find clicked battery
      const canvas = document.querySelector('canvas')
      if (!canvas) return
      
      const rect = canvas.getBoundingClientRect()
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      const y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      
      // Get camera and scene from Three.js
      const camera = (window as any).__camera
      const scene = (window as any).__scene
      if (!camera || !scene) return
      
      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(new THREE.Vector2(x, y), camera)
      
      // Check all batteries
      const batteries = placementSystem.getAllBatteries()
      for (const battery of batteries) {
        const batteryMesh = battery.getGroup()
        if (!batteryMesh) continue
        
        const intersects = raycaster.intersectObject(batteryMesh, true)
        if (intersects.length > 0) {
          // Check if we hit a hitbox with battery reference
          const hitObject = intersects[0].object
          if (hitObject.userData.isHitbox && hitObject.userData.battery) {
            // Use the battery from the hitbox userData
            const hitBattery = hitObject.userData.battery
            const batteryId = placementSystem.getBatteryId(hitBattery)
            if (batteryId) {
              // Ensure battery is in game state before showing context menu
              const placement = gameState.getDomePlacements().find(p => p.id === batteryId)
              if (!placement) {
                console.warn('[GameUI] Battery (hitbox) found but not in game state, adding it now')
                const pos = hitBattery.getPosition()
                gameState.addDomePlacement(batteryId, { x: pos.x, z: pos.z })
              }
              
              setContextMenu({
                battery: hitBattery,
                batteryId,
                position: { x: event.clientX, y: event.clientY }
              })
              // Disable OrbitControls while context menu is open
              const controls = (window as any).__controls
              if (controls) controls.enabled = false
              break
            }
          } else {
            // Normal battery mesh hit
            const batteryId = placementSystem.getBatteryId(battery)
            if (batteryId) {
              // Ensure battery is in game state before showing context menu
              const placement = gameState.getDomePlacements().find(p => p.id === batteryId)
              if (!placement) {
                console.warn('[GameUI] Battery found but not in game state, adding it now')
                const pos = battery.getPosition()
                gameState.addDomePlacement(batteryId, { x: pos.x, z: pos.z })
              }
              
              setContextMenu({
                battery,
                batteryId,
                position: { x: event.clientX, y: event.clientY }
              })
              // Disable OrbitControls while context menu is open
              const controls = (window as any).__controls
              if (controls) controls.enabled = false
              break
            }
          }
        }
      }
    }
    
    document.addEventListener('contextmenu', handleContextMenu)
    
    // Handle long press for mobile
    let longPressTimer: NodeJS.Timeout | null = null
    let touchStartPos = { x: 0, y: 0 }
    
    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return
      
      const touch = event.touches[0]
      touchStartPos = { x: touch.clientX, y: touch.clientY }
      
      longPressTimer = setTimeout(() => {
        // Simulate right-click
        const mouseEvent = new MouseEvent('contextmenu', {
          clientX: touch.clientX,
          clientY: touch.clientY,
          bubbles: true,
          cancelable: true
        })
        handleContextMenu(mouseEvent)
        vibrate(20)
      }, 500) // 500ms for long press
    }
    
    const handleTouchEnd = () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer)
        longPressTimer = null
      }
    }
    
    const handleTouchMove = (event: TouchEvent) => {
      if (!longPressTimer || event.touches.length !== 1) return
      
      const touch = event.touches[0]
      const distance = Math.sqrt(
        Math.pow(touch.clientX - touchStartPos.x, 2) +
        Math.pow(touch.clientY - touchStartPos.y, 2)
      )
      
      // Cancel long press if moved too far
      if (distance > 10) {
        clearTimeout(longPressTimer)
        longPressTimer = null
      }
    }
    
    if (deviceInfo?.hasTouch) {
      document.addEventListener('touchstart', handleTouchStart, { passive: true })
      document.addEventListener('touchend', handleTouchEnd)
      document.addEventListener('touchmove', handleTouchMove, { passive: true })
    }
    
    // Listen for battery updates
    const handleBatteryUpdate = () => {
      updateResourceDisplay()
      // Force re-render to update placement info
      setPlacementMode(placementSystem.isInPlacementMode())
    }
    
    window.addEventListener('batteryRemoved', handleBatteryUpdate)
    window.addEventListener('batteryUpgraded', handleBatteryUpdate)
    
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
      
      // Remove context menu handler
      document.removeEventListener('contextmenu', handleContextMenu)
      
      // Remove touch handlers
      if (deviceInfo?.hasTouch) {
        document.removeEventListener('touchstart', handleTouchStart)
        document.removeEventListener('touchend', handleTouchEnd)
        document.removeEventListener('touchmove', handleTouchMove)
      }
      
      // Remove battery update handlers
      window.removeEventListener('batteryRemoved', handleBatteryUpdate)
      window.removeEventListener('batteryUpgraded', handleBatteryUpdate)
      
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
  
  // Show/hide shop panel based on game mode
  useEffect(() => {
    setShowShop(isGameMode)
    setShopCollapsed(true) // Always start collapsed
  }, [isGameMode])
  
  // Handle pause functionality
  useEffect(() => {
    const togglePause = () => {
      if (isGameMode && !gameOver) {
        const controls = (window as any).__simulationControls
        if (controls) {
          const newPauseState = !isPaused
          setIsPaused(newPauseState)
          controls.pause = newPauseState
          
          if (newPauseState) {
            waveManager.pauseWave()
          } else {
            waveManager.resumeWave()
          }
        }
      }
    }
    
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        
        // Close modals first if any are open
        if (showShop && !shopCollapsed) {
          // Collapse shop instead of closing
          setShopCollapsed(true)
          // Reset time scale
          const simulationControls = (window as any).__simulationControls
          if (simulationControls) {
            simulationControls.timeScale = 1.0
          }
        } else if (showHelp) {
          setShowHelp(false)
        } else if (contextMenu) {
          setContextMenu(null)
        } else {
          // Otherwise toggle pause
          togglePause()
        }
      } else if (e.key === 'p' || e.key === 'P') {
        e.preventDefault()
        togglePause()
      }
    }
    
    window.addEventListener('keydown', handleKeyPress)
    
    return () => {
      window.removeEventListener('keydown', handleKeyPress)
    }
  }, [isPaused, isGameMode, gameOver, showShop, showHelp, contextMenu, shopCollapsed])
  
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
    
    // Disable automatic initial battery creation during new game setup
    placementSystem.setSkipInitialBatteryCheck(true)
    
    // First, remove all batteries
    const allBatteries = placementSystem.getAllBatteries()
    const batteryIds: string[] = []
    
    allBatteries.forEach(battery => {
      const batteryId = placementSystem.getBatteryId(battery)
      if (batteryId) batteryIds.push(batteryId)
    })
    
    // Remove all batteries
    batteryIds.forEach(id => {
      placementSystem.removeBattery(id)
    })
    
    // Clear game state (this clears domePlacements)
    gameState.startNewGame()
    
    // Create a fresh initial battery with consistent ID
    const initialId = 'battery_initial'
    
    // Place the battery first (this adds it to placedDomes and game state)
    placementSystem.placeBatteryAt(new THREE.Vector3(0, 0, 0), initialId, 1)
    
    // Apply auto-repair rate to the new battery
    const autoRepairLevel = gameState.getAutoRepairLevel()
    const repairRates = [0, 0.5, 1.0, 2.0]
    const battery = placementSystem.getBattery(initialId)
    if (battery) {
      battery.setAutoRepairRate(repairRates[autoRepairLevel])
    }
    
    // Re-enable automatic initial battery check after setup
    setTimeout(() => {
      placementSystem.setSkipInitialBatteryCheck(false)
    }, 200)
    
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
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          width: 100%;
          position: relative;
          gap: 20px;
        }
        
        .top-left, .top-center, .top-right {
          flex: 1;
          display: flex;
          align-items: flex-start;
          min-height: 35px;
        }
        
        .top-left {
          justify-content: flex-start;
        }
        
        .top-center {
          justify-content: center;
        }
        
        .top-right {
          justify-content: flex-end;
        }
        
        .resource-panel {
          display: flex;
          gap: 20px;
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
          color: #ffffff;
        }
        
        .wave-panel {
          text-align: center;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          padding: 12px 20px;
        }
        
        .wave-number {
          font-size: 20px;
          font-weight: bold;
          color: #ffffff;
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
        
        .wave-text {
          font-size: 14px;
          color: #ffffff;
          margin-top: 5px;
        }
        
        .preparation-timer {
          font-size: 14px;
          color: #ffffff;
          margin-top: 5px;
        }
        
        .left-panels {
          display: flex;
          flex-direction: column;
          gap: 10px;
          align-items: flex-start;
        }
        
        .score-panel {
          display: flex;
          gap: 12px;
          align-items: center;
          background: rgba(0, 0, 0, 0.85) !important;
          padding: 12px 16px !important;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
        }
        
        .score-value {
          font-size: 24px;
          font-weight: bold;
          color: #ffffff;
          text-shadow: 0 0 8px rgba(255, 255, 255, 0.5);
          line-height: 1.2;
        }
        
        .high-score {
          font-size: 14px;
          color: #cccccc;
          text-shadow: 0 0 4px rgba(255, 255, 255, 0.3);
        }
        
        .action-buttons {
          position: fixed;
          bottom: 90px;
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
        
        .control-button.warning {
          background: #ff6600;
          border-color: #ff6600;
        }
        
        .control-button.warning:hover {
          background: #ff8800;
          border-color: #ff8800;
        }
        
        .help-button {
          position: fixed;
          top: 90px;
          right: 25px;
          min-width: 50px;
          min-height: 50px;
          background: #0038b8;
          border: 2px solid #0038b8;
          border-radius: 50%;
          color: white;
          font-size: 20px;
          font-weight: bold;
          cursor: pointer;
          transition: all 0.3s;
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: auto;
        }
        
        .help-button:hover {
          background: #0056d6;
          border-color: #0056d6;
          transform: scale(1.1);
          box-shadow: 0 0 15px rgba(0, 56, 184, 0.5);
        }
        
        .help-button:active {
          transform: scale(0.95);
        }
        
        .help-button.pulse {
          animation: helpPulse 2s ease-in-out infinite;
        }
        
        @keyframes helpPulse {
          0% {
            transform: scale(1);
            box-shadow: 0 0 0 0 rgba(0, 56, 184, 0.7);
          }
          50% {
            transform: scale(1.05);
            box-shadow: 0 0 15px 10px rgba(0, 149, 255, 0.4);
          }
          100% {
            transform: scale(1);
            box-shadow: 0 0 0 0 rgba(0, 56, 184, 0);
          }
        }
        
        .help-arrow {
          position: fixed;
          top: 92px;
          right: 90px;
          font-size: 36px;
          color: #0095ff;
          animation: arrowBounce 1s ease-in-out infinite;
          pointer-events: none;
          z-index: 999;
          transform: rotate(45deg);
          text-shadow: 0 0 10px rgba(0, 149, 255, 0.8);
        }
        
        @keyframes arrowBounce {
          0%, 100% {
            transform: translateX(0);
          }
          50% {
            transform: translateX(10px);
          }
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
          }
          
          .top-left, .top-center, .top-right {
            width: 100%;
            justify-content: center;
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
            width: auto;
            padding: 12px 16px;
          }
          
          .wave-number {
            font-size: 22px;
          }
          
          .score-panel {
            order: 3;
            justify-self: center;
            text-align: center;
            background: rgba(0, 0, 0, 0.9) !important;
            padding: 10px 14px !important;
          }
          
          .score-value {
            font-size: 22px;
            color: #ffffff;
          }
          
          .high-score {
            font-size: 13px;
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
        
        .shop-container {
          position: fixed;
          bottom: 20px;
          right: 20px;
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 10px;
          z-index: 100;
          pointer-events: auto;
        }
        
        .shop-panel {
          width: 450px;
          max-width: calc(100vw - 40px);
          background: rgba(0, 0, 0, 0.95);
          border: 3px solid #0038b8;
          border-radius: 15px;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 0 30px rgba(0, 56, 184, 0.3);
          transform-origin: bottom right;
          overflow: hidden;
        }
        
        .shop-panel.collapsed {
          transform: scale(0);
          opacity: 0;
          pointer-events: none;
        }
        
        .shop-toggle {
          background: #0038b8;
          border: 2px solid #0038b8;
          border-radius: 5px;
          padding: 12px 20px;
          cursor: pointer;
          color: white;
          font-weight: bold;
          font-size: 16px;
          transition: all 0.3s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          min-width: 200px;
          -webkit-tap-highlight-color: transparent;
          touch-action: manipulation;
        }
        
        .shop-toggle:hover {
          background: #0056d6;
          border-color: #0056d6;
          box-shadow: 0 0 15px rgba(0, 56, 184, 0.5);
        }
        
        .shop-toggle:active {
          transform: scale(0.98);
          background: #0045b0;
        }
        
        .shop-toggle-icon {
          font-size: 18px;
        }
        
        .shop-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 15px;
          border-bottom: 1px solid #0038b8;
        }
        
        .shop-title {
          font-size: 16px;
          color: #0038b8;
          margin: 0;
        }
        
        .shop-close {
          background: none;
          border: none;
          color: #ff0000;
          font-size: 20px;
          cursor: pointer;
          padding: 5px 10px;
          transition: all 0.2s;
        }
        
        .shop-close:hover {
          color: #ff6600;
          transform: scale(1.1);
        }
        
        .shop-content {
          padding: 10px;
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
          max-height: 250px;
          overflow-y: auto;
        }
        
        .shop-item {
          background: rgba(0, 56, 184, 0.2);
          border: 2px solid #0038b8;
          border-radius: 8px;
          padding: 10px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          transition: all 0.2s;
          aspect-ratio: 1;
          justify-content: space-between;
        }
        
        .shop-item:hover {
          background: rgba(0, 56, 184, 0.3);
          transform: translateY(-2px);
          box-shadow: 0 5px 15px rgba(0, 56, 184, 0.3);
        }
        
        .shop-item-header {
          flex: 1;
        }
        
        .shop-item-icon {
          font-size: 24px;
          text-align: center;
          margin-bottom: 4px;
        }
        
        .shop-item-name {
          font-size: 11px;
          font-weight: bold;
          color: white;
          text-align: center;
          line-height: 1.2;
          margin-bottom: 2px;
        }
        
        .shop-item-description {
          font-size: 10px;
          color: #aaa;
          line-height: 1.2;
          text-align: center;
        }
        
        .shop-item-buy {
          margin-top: auto;
        }
        
        .shop-item-button {
          width: 100%;
          background: #0038b8;
          border: 1px solid #0038b8;
          color: white;
          padding: 6px 8px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: bold;
          cursor: pointer;
          transition: all 0.3s;
        }
        
        .shop-item-button:hover:not(:disabled) {
          background: #0056d6;
          border-color: #0056d6;
        }
        
        .shop-item-button:disabled {
          background: rgba(50, 50, 50, 0.8);
          border-color: #666;
          color: #666;
          cursor: not-allowed;
        }
        
        .shop-dimmer {
          display: none; /* Remove dimmer for less intrusive design */
        }
        
        @media (max-width: 768px) {
          .shop-container {
            bottom: 15px;
            right: 15px;
          }
          
          .shop-panel {
            width: 100%;
            max-width: 400px;
          }
          
          .shop-content {
            grid-template-columns: repeat(2, 1fr);
            max-height: 200px;
          }
          
          .shop-toggle {
            padding: 14px 24px;
            font-size: 16px;
            min-height: 48px;
            min-width: 160px;
          }
          
          .action-buttons {
            bottom: 80px !important; /* Move up to avoid shop button */
          }
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
          z-index: 10000;
          animation: fadeIn 0.5s;
          pointer-events: auto;
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
          pointer-events: auto;
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
        
        .intercept-mode-panel {
          text-align: center;
        }
        
        .intercept-mode-button {
          background: rgba(0, 56, 184, 0.3);
          border: 2px solid #0038b8;
          color: #0095ff;
          padding: 4px 8px;
          border-radius: 5px;
          font-size: 16px;
          font-weight: bold;
          cursor: pointer;
          transition: all 0.3s;
          display: inline-block;
          margin: 0 auto;
        }
        
        .intercept-mode-button:hover {
          background: rgba(0, 56, 184, 0.5);
          transform: scale(1.05);
        }
        
        .intercept-mode-button.active {
          background: #0038b8;
          color: white;
          box-shadow: 0 0 10px rgba(0, 149, 255, 0.5);
        }
        
        .auto-intercept-locked {
          padding: 4px;
          text-align: center;
        }
        
        .unlock-progress {
          width: 100%;
          height: 6px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 3px;
          margin-top: 8px;
          overflow: hidden;
        }
        
        .unlock-progress-bar {
          height: 100%;
          background: linear-gradient(90deg, #0038b8, #0095ff);
          transition: width 0.5s;
          box-shadow: 0 0 10px rgba(0, 149, 255, 0.5);
        }
        
        .pause-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.8);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 999;
          pointer-events: auto;
        }
        
        .pause-modal {
          background: rgba(0, 0, 0, 0.95);
          border: 2px solid #0038b8;
          border-radius: 10px;
          padding: 40px;
          text-align: center;
          max-width: 400px;
          box-shadow: 0 0 30px rgba(0, 56, 184, 0.8);
        }
        
        .pause-title {
          font-size: 48px;
          color: #0095ff;
          margin-bottom: 20px;
          text-shadow: 0 0 20px rgba(0, 149, 255, 0.8);
          letter-spacing: 8px;
        }
        
        .pause-subtitle {
          font-size: 16px;
          color: #cccccc;
          margin-bottom: 40px;
        }
        
        .pause-buttons {
          display: flex;
          flex-direction: column;
          gap: 15px;
          align-items: center;
        }
        
        .pause-button {
          background: rgba(0, 56, 184, 0.3);
          border: 2px solid #0038b8;
          color: #ffffff;
          padding: 12px 30px;
          border-radius: 5px;
          font-size: 18px;
          font-weight: bold;
          cursor: pointer;
          transition: all 0.3s;
          min-width: 200px;
        }
        
        .pause-button:hover {
          background: #0038b8;
          transform: scale(1.05);
          box-shadow: 0 0 20px rgba(0, 149, 255, 0.8);
        }
        
        .pause-hint {
          margin-top: 30px;
          font-size: 14px;
          color: #888;
        }
        
        .time-dilation-effect {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          pointer-events: none;
          background: radial-gradient(circle at center, transparent 30%, rgba(0, 56, 184, 0.1) 100%);
          z-index: 998;
          opacity: 0;
          transition: opacity 0.5s ease-in-out;
        }
        
        .time-dilation-effect.active {
          opacity: 1;
        }
        
      `}</style>
      
      {/* Time dilation visual effect */}
      <div className={`time-dilation-effect ${showShop && !shopCollapsed ? 'active' : ''}`} />
      
      {!hasViewedHelp && (
        <div className="help-arrow">→</div>
      )}
      
      <button 
        className={`help-button ${!hasViewedHelp ? 'pulse' : ''}`}
        onClick={() => {
          setShowHelp(true)
          // Mark help as viewed
          if (!hasViewedHelp) {
            localStorage.setItem('helpViewed', 'true')
            setHasViewedHelp(true)
          }
          // Disable OrbitControls
          const controls = (window as any).__controls
          if (controls) controls.enabled = false
        }}
        title="Help & Tutorial"
      >
        ?
      </button>
      
      <div className="game-ui">
        <div className="top-bar">
          {isGameMode ? (
            // Game mode: Show all game panels
            <>
              <div className="top-left">
                <div className="left-panels">
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
                  <div className="ui-panel score-panel">
                    <span style={{ fontSize: '20px' }}>🏆</span>
                    <div>
                      <div className="score-value">{score.toLocaleString()}</div>
                      <div className="high-score">High: {highScore.toLocaleString()}</div>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="top-center">
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
              </div>
              
              <div className="top-right">
                <div className="ui-panel intercept-mode-panel">
                  {currentWave >= 5 ? (
                    <button 
                      className={`intercept-mode-button ${autoIntercept ? 'active' : ''}`}
                      onClick={() => {
                        vibrate(15)
                        const controls = (window as any).__simulationControls
                        const newValue = !controls.autoIntercept
                        controls.autoIntercept = newValue
                        setAutoIntercept(newValue)
                        // Save to localStorage
                        localStorage.setItem('ironDome_interceptMode', newValue.toString())
                        showNotification(newValue ? 'Auto-Intercept Enabled' : 'Manual Targeting Mode')
                      }}
                      title={autoIntercept ? 'Automatic interception enabled' : 'Click on threats to intercept'}
                    >
                      {autoIntercept ? '🤖' : '🎯'}
                    </button>
                  ) : (
                    <div className="auto-intercept-locked" title={`Auto-intercept unlocks at Wave 5 (${5 - currentWave} waves to go)`}>
                      <div style={{ fontSize: '14px' }}>🔒</div>
                      <div style={{ fontSize: '9px', color: '#ccc' }}>Wave 5</div>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            // Sandbox mode: Show sandbox info and intercept mode toggle
            <>
              <div className="top-left">
                {/* Empty left section for consistency */}
              </div>
              
              <div className="top-center">
                <div className="ui-panel wave-panel">
                  <div className="wave-number">Sandbox Mode</div>
                  <div style={{ fontSize: '14px', marginTop: '5px' }}>Free Play</div>
                </div>
              </div>
              
              <div className="top-right">
                <div className="ui-panel intercept-mode-panel">
                  <button 
                    className={`intercept-mode-button ${autoIntercept ? 'active' : ''}`}
                    onClick={() => {
                      vibrate(15)
                      const controls = (window as any).__simulationControls
                      const newValue = !controls.autoIntercept
                      controls.autoIntercept = newValue
                      setAutoIntercept(newValue)
                      // Save to localStorage
                      localStorage.setItem('ironDome_interceptMode', newValue.toString())
                      showNotification(newValue ? 'Auto-Intercept Enabled' : 'Manual Targeting Mode')
                    }}
                    title={autoIntercept ? 'Automatic interception enabled' : 'Click on threats to intercept'}
                  >
                    {autoIntercept ? '🤖' : '🎯'}
                  </button>
                </div>
              </div>
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
              className={`control-button ${confirmNewGame ? 'warning' : ''}`}
              onClick={() => {
                vibrate(20)
                if (!confirmNewGame) {
                  // First click - show confirmation
                  setConfirmNewGame(true)
                  // Reset after 3 seconds
                  confirmTimeoutRef.current = setTimeout(() => {
                    setConfirmNewGame(false)
                  }, 3000)
                } else {
                  // Second click - actually start new game
                  setConfirmNewGame(false)
                  if (confirmTimeoutRef.current) {
                    clearTimeout(confirmTimeoutRef.current)
                    confirmTimeoutRef.current = null
                  }
                  startNewGame()
                }
              }}
            >
              {confirmNewGame ? 'Are you sure?' : 'New Game'}
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
          {!placementMode && isGameMode && placementInfo.placedDomes >= placementInfo.unlockedDomes && (
            <div className="button-cost">Cost: {costs.domeUnlock}</div>
          )}
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
        <div className="game-over-screen" onClick={(e) => e.stopPropagation()}>
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
                // Re-enable OrbitControls
                const controls = (window as any).__controls
                if (controls) controls.enabled = true
                // Unpause simulation
                const simulationControls = (window as any).__simulationControls
                if (simulationControls) {
                  simulationControls.pause = false
                }
                startNewGame()
              }}
            >
              New Game
            </button>
            <button 
              className="game-over-button"
              onClick={() => {
                setGameOver(null)
                // Re-enable OrbitControls
                const controls = (window as any).__controls
                if (controls) controls.enabled = true
                // Unpause simulation
                const simulationControls = (window as any).__simulationControls
                if (simulationControls) {
                  simulationControls.pause = false
                }
                onModeChange?.(false)
              }}
            >
              Sandbox Mode
            </button>
          </div>
        </div>
      )}
      
      {/* Shop Container */}
      {showShop && (
        <div className="shop-container">
          {/* Shop Panel (shows above button when expanded) */}
          <div className={`shop-panel ${shopCollapsed ? 'collapsed' : ''}`}>
              <div className="shop-header">
                <h2 className="shop-title">Supply Shop</h2>
                <button className="shop-close" onClick={() => {
                  vibrate(10)
                  setShopCollapsed(true)
                  // Reset time scale
                  const simulationControls = (window as any).__simulationControls
                  if (simulationControls) {
                    simulationControls.timeScale = 1.0
                  }
                }}>✕</button>
              </div>
              
              <div className="shop-content">
            <div className="shop-item">
              <div className="shop-item-header">
                <div className="shop-item-icon">🚀</div>
                <div className="shop-item-name">Interceptors</div>
                <div className="shop-item-description">+50 units</div>
              </div>
              <div className="shop-item-buy">
                <button 
                  className="shop-item-button"
                  onClick={handlePurchaseInterceptors}
                  disabled={credits < costs.interceptorRestock}
                >
                  ${costs.interceptorRestock}
                </button>
              </div>
            </div>
            
            <div className="shop-item">
              <div className="shop-item-header">
                <div className="shop-item-icon">🛡️</div>
                <div className="shop-item-name">Dome Slot</div>
                <div className="shop-item-description">+1 battery</div>
              </div>
              <div className="shop-item-buy">
                <button 
                  className="shop-item-button"
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
                  ${costs.domeUnlock}
                </button>
              </div>
            </div>
            
            <div className="shop-item">
              <div className="shop-item-header">
                <div className="shop-item-icon">🔧</div>
                <div className="shop-item-name">Auto-Repair</div>
                <div className="shop-item-description">
                  {gameState.getAutoRepairLevel() === 0 
                    ? 'Auto fix'
                    : `Lvl ${gameState.getAutoRepairLevel()}/3`
                  }
                </div>
              </div>
              <div className="shop-item-buy">
                <button 
                  className="shop-item-button"
                  onClick={() => {
                    const currentLevel = gameState.getAutoRepairLevel()
                    if (currentLevel >= 3) {
                      showNotification('Auto-repair is already at maximum level!')
                      return
                    }
                    const cost = resourceManager.getCosts().autoRepair(currentLevel + 1)
                    if (gameState.spendCredits(cost)) {
                      gameState.upgradeAutoRepair()
                      vibrate(30)
                      showNotification(`Auto-repair upgraded to level ${gameState.getAutoRepairLevel()}!`)
                      updateResourceDisplay()
                      // Apply auto-repair rate to all batteries
                      const repairRates = [0, 0.5, 1.0, 2.0]
                      const newRate = repairRates[gameState.getAutoRepairLevel()]
                      placementSystem.getAllBatteries().forEach(battery => {
                        battery.setAutoRepairRate(newRate)
                      })
                    } else {
                      vibrate([10, 10, 10]) // Error pattern
                      showNotification('Insufficient credits!')
                    }
                  }}
                  disabled={gameState.getAutoRepairLevel() >= 3 || credits < resourceManager.getCosts().autoRepair((gameState.getAutoRepairLevel() || 0) + 1)}
                >
                  {gameState.getAutoRepairLevel() >= 3 
                    ? 'MAX' 
                    : `$${resourceManager.getCosts().autoRepair((gameState.getAutoRepairLevel() || 0) + 1)}`
                  }
                </button>
              </div>
            </div>
          </div>
          </div>
          
          {/* Toggle Button (always visible) */}
          <button
            className="shop-toggle"
            onClick={() => {
              vibrate(10)
              setShopCollapsed(!shopCollapsed)
              // Toggle time dilation
              const simulationControls = (window as any).__simulationControls
              if (simulationControls) {
                simulationControls.timeScale = shopCollapsed ? 0.1 : 1.0
              }
            }}
          >
            <span className="shop-toggle-icon">🛒</span>
            <span>Shop</span>
          </button>
        </div>
      )}
      
      {contextMenu && (
        <DomeContextMenu
          battery={contextMenu.battery}
          batteryId={contextMenu.batteryId}
          position={contextMenu.position}
          onClose={() => {
            setContextMenu(null)
            // Re-enable OrbitControls
            const controls = (window as any).__controls
            if (controls) controls.enabled = true
          }}
          placementSystem={placementSystem}
          isGameMode={isGameMode}
        />
      )}
      
      {/* Pause Overlay */}
      {isPaused && isGameMode && !gameOver && (
        <div className="pause-overlay">
          <div className="pause-modal">
            <div className="pause-title">PAUSED</div>
            <div className="pause-subtitle">Game is paused</div>
            <div className="pause-buttons">
              <button 
                className="pause-button"
                onClick={() => {
                  const controls = (window as any).__simulationControls
                  if (controls) {
                    setIsPaused(false)
                    controls.pause = false
                    waveManager.resumeWave()
                  }
                }}
              >
                Resume Game
              </button>
              <button 
                className="pause-button"
                onClick={() => setShowHelp(true)}
              >
                Help
              </button>
              <button 
                className="pause-button"
                onClick={() => {
                  setIsPaused(false)
                  handleNewGame()
                }}
              >
                New Game
              </button>
            </div>
            <div className="pause-hint">Press ESC or P to resume</div>
          </div>
        </div>
      )}
      
      <HelpModal 
        isOpen={showHelp}
        onClose={() => {
          setShowHelp(false)
          // Re-enable OrbitControls
          const controls = (window as any).__controls
          if (controls) controls.enabled = true
        }}
        isGameMode={isGameMode}
      />
    </>
  )
}