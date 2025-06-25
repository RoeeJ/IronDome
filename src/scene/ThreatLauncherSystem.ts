import * as THREE from 'three';
import { ThreatType } from '../entities/Threat';

export interface LauncherConfig {
  id: string;
  position: THREE.Vector3;
  type: ThreatType;
  volleySize: { min: number; max: number };
  volleyDelay: number; // ms between shots in a volley
  reloadTime: number; // ms between volleys
  spread: number; // targeting spread in meters
  active: boolean;
}

export interface LauncherSite {
  id: string;
  name: string;
  position: THREE.Vector3;
  launchers: LauncherConfig[];
  lastFireTime: number;
  nextFireTime: number;
}

export class ThreatLauncherSystem {
  private launcherSites: Map<string, LauncherSite> = new Map();
  private activeSites: Set<string> = new Set();
  private lastGlobalFireTime: number = 0;
  private globalFireDelay: number = 5000; // Minimum 5s between any site firing
  
  // Predefined launcher positions - farther from the city
  private readonly LAUNCHER_POSITIONS = {
    north: [
      { x: 0, z: -1200, name: "North Alpha" },
      { x: -300, z: -1100, name: "North Bravo" },
      { x: 300, z: -1100, name: "North Charlie" },
    ],
    south: [
      { x: 0, z: 1200, name: "South Alpha" },
      { x: -300, z: 1100, name: "South Bravo" },
      { x: 300, z: 1100, name: "South Charlie" },
    ],
    east: [
      { x: 1200, z: 0, name: "East Alpha" },
      { x: 1100, z: -300, name: "East Bravo" },
      { x: 1100, z: 300, name: "East Charlie" },
    ],
    west: [
      { x: -1200, z: 0, name: "West Alpha" },
      { x: -1100, z: -300, name: "West Bravo" },
      { x: -1100, z: 300, name: "West Charlie" },
    ],
  };
  
  constructor() {
    this.initializeLauncherSites();
  }
  
  private initializeLauncherSites(): void {
    // Create launcher sites at each position
    Object.entries(this.LAUNCHER_POSITIONS).forEach(([direction, positions]) => {
      positions.forEach((pos, index) => {
        const siteId = `${direction}_${index}`;
        const site: LauncherSite = {
          id: siteId,
          name: pos.name,
          position: new THREE.Vector3(pos.x, 0, pos.z),
          launchers: this.createLaunchersForSite(siteId, new THREE.Vector3(pos.x, 0, pos.z)),
          lastFireTime: 0,
          nextFireTime: 0,
        };
        this.launcherSites.set(siteId, site);
      });
    });
  }
  
  private createLaunchersForSite(siteId: string, position: THREE.Vector3): LauncherConfig[] {
    const launchers: LauncherConfig[] = [];
    
    // Each site has multiple launchers of different types
    const launcherTypes = [
      {
        type: ThreatType.QASSAM_1,
        count: 2,  // Reduced from 3
        volleySize: { min: 1, max: 3 },  // Reduced from 2-5
        volleyDelay: 1200,  // Increased from 500ms
        reloadTime: 30000,  // Increased from 15s to 30s
        spread: 50,
      },
      {
        type: ThreatType.GRAD_ROCKET,
        count: 1,  // Reduced from 2
        volleySize: { min: 2, max: 4 },  // Reduced from 3-8
        volleyDelay: 800,   // Increased from 300ms
        reloadTime: 45000,  // Increased from 20s to 45s
        spread: 30,
      },
      {
        type: ThreatType.MORTAR,
        count: 2,  // Reduced from 4
        volleySize: { min: 1, max: 2 },  // Reduced from 1-3
        volleyDelay: 1500,  // Increased from 800ms
        reloadTime: 20000,  // Increased from 8s to 20s
        spread: 20,
      },
    ];
    
    launcherTypes.forEach((config, typeIndex) => {
      for (let i = 0; i < config.count; i++) {
        // Slightly offset each launcher within the site
        const offset = new THREE.Vector3(
          (Math.random() - 0.5) * 50,
          0,
          (Math.random() - 0.5) * 50
        );
        
        launchers.push({
          id: `${siteId}_${config.type}_${i}`,
          position: position.clone().add(offset),
          type: config.type,
          volleySize: config.volleySize,
          volleyDelay: config.volleyDelay,
          reloadTime: config.reloadTime,
          spread: config.spread,
          active: true,
        });
      }
    });
    
    return launchers;
  }
  
  activateSite(siteId: string): void {
    if (this.launcherSites.has(siteId)) {
      this.activeSites.add(siteId);
    }
  }
  
  deactivateSite(siteId: string): void {
    this.activeSites.delete(siteId);
  }
  
  activateDirection(direction: 'north' | 'south' | 'east' | 'west'): void {
    this.launcherSites.forEach((site, id) => {
      if (id.startsWith(direction)) {
        this.activeSites.add(id);
      }
    });
  }
  
  deactivateDirection(direction: 'north' | 'south' | 'east' | 'west'): void {
    this.launcherSites.forEach((site, id) => {
      if (id.startsWith(direction)) {
        this.activeSites.delete(id);
      }
    });
  }
  
  activateAllSites(): void {
    this.launcherSites.forEach((site, id) => {
      this.activeSites.add(id);
    });
  }
  
  deactivateAllSites(): void {
    this.activeSites.clear();
  }
  
  // Get launchers ready to fire
  getReadyLaunchers(currentTime: number): Array<{launcher: LauncherConfig, site: LauncherSite}> {
    const readyLaunchers: Array<{launcher: LauncherConfig, site: LauncherSite}> = [];
    
    // Global throttle - prevent any site from firing too soon after another
    if (currentTime < this.lastGlobalFireTime + this.globalFireDelay) {
      return readyLaunchers;
    }
    
    // Find sites ready to fire and pick one
    const readySites: LauncherSite[] = [];
    
    this.activeSites.forEach(siteId => {
      const site = this.launcherSites.get(siteId);
      if (!site) return;
      
      // Check if site is ready to fire
      if (currentTime >= site.nextFireTime) {
        readySites.push(site);
      }
    });
    
    // Only allow one site to fire at a time
    if (readySites.length > 0) {
      const site = readySites[Math.floor(Math.random() * readySites.length)];
      // Select random launchers from this site to fire
      const activeLaunchers = site.launchers.filter(l => l.active);
      if (activeLaunchers.length > 0) {
        // Fire only 1 launcher from this site at a time
        const launchersToFire = 1;
        
        for (let i = 0; i < launchersToFire; i++) {
          const launcher = activeLaunchers[Math.floor(Math.random() * activeLaunchers.length)];
          readyLaunchers.push({ launcher, site });
        }
        
        // Update site fire time
        site.lastFireTime = currentTime;
        site.nextFireTime = currentTime + 20000 + Math.random() * 40000; // 20-60 seconds between site volleys
        
        // Update global fire time
        this.lastGlobalFireTime = currentTime;
      }
    }
    
    return readyLaunchers;
  }
  
  // Get active launcher sites for visualization
  getActiveSites(): LauncherSite[] {
    return Array.from(this.activeSites).map(id => this.launcherSites.get(id)!).filter(Boolean);
  }
  
  // Get all launcher sites
  getAllSites(): LauncherSite[] {
    return Array.from(this.launcherSites.values());
  }
  
  // Set custom attack pattern
  setAttackPattern(pattern: 'concentrated' | 'distributed' | 'sequential' | 'random'): void {
    this.deactivateAllSites();
    
    switch (pattern) {
      case 'concentrated':
        // Attack from one direction only
        const directions = ['north', 'south', 'east', 'west'] as const;
        const chosenDirection = directions[Math.floor(Math.random() * directions.length)];
        this.activateDirection(chosenDirection);
        break;
        
      case 'distributed':
        // Attack from all directions
        this.activateAllSites();
        break;
        
      case 'sequential':
        // Will be handled by the update loop - activate sites one by one
        this.activateSite('north_0');
        break;
        
      case 'random':
        // Activate random sites
        const allSiteIds = Array.from(this.launcherSites.keys());
        const sitesToActivate = Math.floor(allSiteIds.length * 0.3 + Math.random() * allSiteIds.length * 0.4);
        for (let i = 0; i < sitesToActivate; i++) {
          const randomSite = allSiteIds[Math.floor(Math.random() * allSiteIds.length)];
          this.activateSite(randomSite);
        }
        break;
    }
  }
}