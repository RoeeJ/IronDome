/**
 * Log categories and their verbosity levels
 * Used to control which logs are sent to Seq to reduce volume
 */

export enum LogVerbosity {
  CRITICAL = 0,  // Errors, crashes, major issues
  HIGH = 1,      // Important events (battery fire, interception, etc)
  MEDIUM = 2,    // Game state changes, spawning
  LOW = 3,       // Detailed tracking
  VERBOSE = 4,   // Frame-by-frame updates
}

export const LOG_CATEGORY_VERBOSITY: Record<string, LogVerbosity> = {
  // Critical - Always log
  'Error': LogVerbosity.CRITICAL,
  'Fatal': LogVerbosity.CRITICAL,
  'Crash': LogVerbosity.CRITICAL,
  
  // High - Important game events
  'Battery': LogVerbosity.HIGH,
  'Interception': LogVerbosity.HIGH,
  'Explosion': LogVerbosity.HIGH,
  'ThreatSpawn': LogVerbosity.HIGH,
  'GameState': LogVerbosity.HIGH,
  
  // Medium - Normal operations
  'ThreatManager': LogVerbosity.MEDIUM,
  'Radar': LogVerbosity.MEDIUM,
  'BuildingSystem': LogVerbosity.MEDIUM,
  'ResourceManager': LogVerbosity.MEDIUM,
  'SoundSystem': LogVerbosity.MEDIUM,
  
  // Low - Detailed but not frame-by-frame
  'Trajectory': LogVerbosity.LOW,
  'Physics': LogVerbosity.LOW,
  'Rendering': LogVerbosity.LOW,
  'Memory': LogVerbosity.LOW,
  
  // Verbose - Frame-by-frame updates (usually disabled)
  'ProximityFuse': LogVerbosity.VERBOSE,
  'Guidance': LogVerbosity.VERBOSE,
  'LaunchEffects': LogVerbosity.VERBOSE,
  'WindowUpdate': LogVerbosity.VERBOSE,
  'MouseMove': LogVerbosity.VERBOSE,
  'CameraUpdate': LogVerbosity.VERBOSE,
};

// Default verbosity level for Seq logging
export const DEFAULT_SEQ_VERBOSITY = LogVerbosity.HIGH;

// Categories that should be rate-limited even when enabled
export const RATE_LIMITED_CATEGORIES = new Set([
  'ProximityFuse',
  'Guidance',
  'WindowUpdate',
  'CameraUpdate',
  'MouseMove',
]);

// Maximum logs per second for rate-limited categories
export const RATE_LIMIT_PER_SECOND = 10;