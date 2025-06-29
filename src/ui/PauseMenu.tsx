import React, { useState, useEffect } from 'react';
import { SoundSystem } from '../systems/SoundSystem';

interface PauseMenuProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PauseMenu: React.FC<PauseMenuProps> = ({ isOpen, onClose }) => {
  const soundSystem = SoundSystem.getInstance();

  // Sound settings state
  const [masterVolume, setMasterVolume] = useState(soundSystem.getMasterVolume() * 100);
  const [sfxEnabled, setSfxEnabled] = useState(soundSystem.getSFXEnabled());
  const [bgmEnabled, setBgmEnabled] = useState(soundSystem.getBGMEnabled());
  const [sfxVolume, setSfxVolume] = useState(soundSystem.getSFXVolume() * 100);
  const [bgmVolume, setBgmVolume] = useState(soundSystem.getBGMVolume() * 100);

  useEffect(() => {
    if (isOpen) {
      // Refresh settings when menu opens
      setMasterVolume(soundSystem.getMasterVolume() * 100);
      setSfxEnabled(soundSystem.getSFXEnabled());
      setBgmEnabled(soundSystem.getBGMEnabled());
      setSfxVolume(soundSystem.getSFXVolume() * 100);
      setBgmVolume(soundSystem.getBGMVolume() * 100);
    }
  }, [isOpen]);

  const handleMasterVolumeChange = (value: number) => {
    setMasterVolume(value);
    soundSystem.setMasterVolume(value / 100);
  };

  const handleSfxToggle = () => {
    const newValue = !sfxEnabled;
    setSfxEnabled(newValue);
    soundSystem.setSFXEnabled(newValue);
  };

  const handleBgmToggle = () => {
    const newValue = !bgmEnabled;
    setBgmEnabled(newValue);
    soundSystem.setBGMEnabled(newValue);
  };

  const handleSfxVolumeChange = (value: number) => {
    setSfxVolume(value);
    soundSystem.setSFXVolume(value / 100);
  };

  const handleBgmVolumeChange = (value: number) => {
    setBgmVolume(value);
    soundSystem.setBGMVolume(value / 100);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      style={{ pointerEvents: 'auto' }}
    >
      <div
        className="bg-gray-900 border border-cyan-500/30 rounded-lg p-8 max-w-md w-full mx-4 shadow-2xl"
        style={{ pointerEvents: 'auto' }}
      >
        <h2 className="text-3xl font-bold text-cyan-400 mb-6 text-center">PAUSED</h2>

        {/* Sound Settings */}
        <div className="space-y-6 mb-8">
          <h3 className="text-xl font-semibold text-cyan-300 mb-4">Sound Settings</h3>

          {/* Master Volume */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-gray-300">Master Volume</label>
              <span className="text-cyan-400 font-mono">{Math.round(masterVolume)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={masterVolume}
              onChange={e => handleMasterVolumeChange(Number(e.target.value))}
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
            />
          </div>

          {/* SFX Toggle and Volume */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-gray-300 flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={sfxEnabled}
                  onChange={handleSfxToggle}
                  className="w-5 h-5 text-cyan-500 bg-gray-700 border-gray-600 rounded focus:ring-cyan-500"
                />
                Sound Effects
              </label>
              <span className="text-cyan-400 font-mono">{Math.round(sfxVolume)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={sfxVolume}
              onChange={e => handleSfxVolumeChange(Number(e.target.value))}
              disabled={!sfxEnabled}
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>

          {/* BGM Toggle and Volume */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-gray-300 flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={bgmEnabled}
                  onChange={handleBgmToggle}
                  className="w-5 h-5 text-cyan-500 bg-gray-700 border-gray-600 rounded focus:ring-cyan-500"
                />
                Background Music
              </label>
              <span className="text-cyan-400 font-mono">{Math.round(bgmVolume)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={bgmVolume}
              onChange={e => handleBgmVolumeChange(Number(e.target.value))}
              disabled={!bgmEnabled}
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-3">
          <button
            onClick={onClose}
            className="w-full py-3 px-6 bg-cyan-500 hover:bg-cyan-400 text-black font-bold rounded-lg transition-colors duration-200 transform hover:scale-105"
          >
            RESUME GAME
          </button>
        </div>
      </div>

      <style>{`
        .slider::-webkit-slider-thumb {
          appearance: none;
          width: 16px;
          height: 16px;
          background: #00e5ff;
          cursor: pointer;
          border-radius: 50%;
          box-shadow: 0 0 10px rgba(0, 229, 255, 0.5);
        }

        .slider::-moz-range-thumb {
          width: 16px;
          height: 16px;
          background: #00e5ff;
          cursor: pointer;
          border-radius: 50%;
          border: none;
          box-shadow: 0 0 10px rgba(0, 229, 255, 0.5);
        }

        .slider::-webkit-slider-thumb:hover {
          box-shadow: 0 0 20px rgba(0, 229, 255, 0.8);
        }

        .slider::-moz-range-thumb:hover {
          box-shadow: 0 0 20px rgba(0, 229, 255, 0.8);
        }
      `}</style>
    </div>
  );
};
