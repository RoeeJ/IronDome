import * as THREE from 'three';
import { MaterialCache } from '../utils/MaterialCache';
import { GeometryFactory } from '../utils/GeometryFactory';
import { debug } from '../utils/logger';

interface TrailSegment {
  id: string;
  startIndex: number;
  length: number;
  maxLength: number;
  positions: Float32Array;
  colors: Float32Array;
  currentIndex: number;
  active: boolean;
  lastUpdateTime: number;
}

/**
 * Pooled trail rendering system that batches all trails into a single geometry
 * to dramatically reduce draw calls. Uses vertex colors instead of multiple materials.
 */
export class PooledTrailSystem {
  private static instance: PooledTrailSystem;
  private scene: THREE.Scene;
  
  // Single mesh for all trails
  private trailMesh: THREE.Line;
  private geometry: THREE.BufferGeometry;
  private material: THREE.LineBasicMaterial;
  
  // Buffer management
  private readonly MAX_TOTAL_POINTS = 10000; // Total points across all trails
  private readonly MAX_TRAILS = 100; // Maximum number of concurrent trails
  private positions: Float32Array;
  private colors: Float32Array;
  private positionAttribute: THREE.BufferAttribute;
  private colorAttribute: THREE.BufferAttribute;
  
  // Trail management
  private trails = new Map<string, TrailSegment>();
  private freeSegments: { startIndex: number; length: number }[] = [];
  private nextTrailId = 0;
  
  // Optimization
  private updateQueue = new Set<string>();
  private lastCleanupTime = 0;
  private readonly CLEANUP_INTERVAL = 5000; // Clean up inactive trails every 5 seconds

  private constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.initializeGeometry();
  }

  static getInstance(scene: THREE.Scene): PooledTrailSystem {
    if (!PooledTrailSystem.instance) {
      PooledTrailSystem.instance = new PooledTrailSystem(scene);
    }
    return PooledTrailSystem.instance;
  }

  private initializeGeometry(): void {
    // Create large buffers for all trails
    this.positions = new Float32Array(this.MAX_TOTAL_POINTS * 3);
    this.colors = new Float32Array(this.MAX_TOTAL_POINTS * 3);
    
    // Initialize positions far away to avoid artifacts
    for (let i = 0; i < this.MAX_TOTAL_POINTS * 3; i += 3) {
      this.positions[i] = -10000;
      this.positions[i + 1] = -10000;
      this.positions[i + 2] = -10000;
      
      // Default color (will be overridden per trail)
      this.colors[i] = 1;
      this.colors[i + 1] = 1;
      this.colors[i + 2] = 1;
    }
    
    // Create geometry with dynamic buffer attributes
    this.geometry = new THREE.BufferGeometry();
    this.positionAttribute = new THREE.BufferAttribute(this.positions, 3);
    this.colorAttribute = new THREE.BufferAttribute(this.colors, 3);
    
    this.positionAttribute.setUsage(THREE.DynamicDrawUsage);
    this.colorAttribute.setUsage(THREE.DynamicDrawUsage);
    
    this.geometry.setAttribute('position', this.positionAttribute);
    this.geometry.setAttribute('color', this.colorAttribute);
    
    // Single material with vertex colors
    this.material = MaterialCache.getInstance().getLineMaterial({
      color: 0xffffff, // White base color, actual color from vertices
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      linewidth: 1,
    });
    
    // Create the single trail mesh
    this.trailMesh = new THREE.Line(this.geometry, this.material);
    this.trailMesh.frustumCulled = false; // Always render trails
    this.trailMesh.name = 'PooledTrails';
    this.scene.add(this.trailMesh);
    
    // Initialize free segments pool
    this.freeSegments.push({ startIndex: 0, length: this.MAX_TOTAL_POINTS });
    
    debug.log('PooledTrailSystem initialized with capacity for', this.MAX_TRAILS, 'trails');
  }

  /**
   * Create a new trail
   */
  createTrail(maxLength: number = 50, color: number = 0xffffff): string {
    const id = `trail_${this.nextTrailId++}`;
    
    // Find a free segment
    let segment: { startIndex: number; length: number } | undefined;
    let segmentIndex = -1;
    
    for (let i = 0; i < this.freeSegments.length; i++) {
      if (this.freeSegments[i].length >= maxLength) {
        segment = this.freeSegments[i];
        segmentIndex = i;
        break;
      }
    }
    
    if (!segment) {
      debug.warn('PooledTrailSystem: No free segments available for new trail');
      return id;
    }
    
    // Allocate from the free segment
    const startIndex = segment.startIndex;
    
    // Update or remove the free segment
    if (segment.length === maxLength) {
      this.freeSegments.splice(segmentIndex, 1);
    } else {
      segment.startIndex += maxLength;
      segment.length -= maxLength;
    }
    
    // Convert hex color to RGB
    const color3 = new THREE.Color(color);
    const r = color3.r;
    const g = color3.g;
    const b = color3.b;
    
    // Create trail segment
    const trail: TrailSegment = {
      id,
      startIndex,
      length: maxLength,
      maxLength,
      positions: new Float32Array(maxLength * 3),
      colors: new Float32Array(maxLength * 3),
      currentIndex: 0,
      active: true,
      lastUpdateTime: Date.now(),
    };
    
    // Initialize trail buffers
    for (let i = 0; i < maxLength * 3; i += 3) {
      trail.positions[i] = -10000;
      trail.positions[i + 1] = -10000;
      trail.positions[i + 2] = -10000;
      
      trail.colors[i] = r;
      trail.colors[i + 1] = g;
      trail.colors[i + 2] = b;
    }
    
    this.trails.set(id, trail);
    return id;
  }

  /**
   * Update trail with new position
   */
  updateTrail(id: string, position: THREE.Vector3): void {
    const trail = this.trails.get(id);
    if (!trail || !trail.active) return;
    
    trail.lastUpdateTime = Date.now();
    
    // Add new position to trail buffer
    const idx = trail.currentIndex * 3;
    trail.positions[idx] = position.x;
    trail.positions[idx + 1] = position.y;
    trail.positions[idx + 2] = position.z;
    
    // Advance circular buffer index
    trail.currentIndex = (trail.currentIndex + 1) % trail.maxLength;
    
    // Mark for update
    this.updateQueue.add(id);
  }

  /**
   * Remove a trail
   */
  removeTrail(id: string): void {
    const trail = this.trails.get(id);
    if (!trail) return;
    
    trail.active = false;
    
    // Clear the trail from main buffers immediately
    const baseIdx = trail.startIndex * 3;
    for (let i = 0; i < trail.length * 3; i++) {
      this.positions[baseIdx + i] = -10000;
    }
    
    // Mark the entire range as needing update
    this.positionAttribute.updateRange.offset = trail.startIndex * 3;
    this.positionAttribute.updateRange.count = trail.length * 3;
    this.positionAttribute.needsUpdate = true;
    
    // Return segment to free pool
    this.freeSegments.push({ 
      startIndex: trail.startIndex, 
      length: trail.length 
    });
    
    // Merge adjacent free segments
    this.mergeFreeSegments();
    
    this.trails.delete(id);
  }

  /**
   * Update all active trails - call this in the render loop
   */
  update(): void {
    const now = Date.now();
    
    // Process update queue
    if (this.updateQueue.size > 0) {
      let minOffset = Infinity;
      let maxOffset = 0;
      
      this.updateQueue.forEach(id => {
        const trail = this.trails.get(id);
        if (!trail || !trail.active) return;
        
        // Copy trail data to main buffers
        const baseIdx = trail.startIndex * 3;
        
        // Reorder positions for continuous line
        // Start from current index to show newest positions first
        let writeIdx = 0;
        for (let i = 0; i < trail.maxLength; i++) {
          const readIdx = ((trail.currentIndex + i) % trail.maxLength) * 3;
          const targetIdx = baseIdx + writeIdx * 3;
          
          this.positions[targetIdx] = trail.positions[readIdx];
          this.positions[targetIdx + 1] = trail.positions[readIdx + 1];
          this.positions[targetIdx + 2] = trail.positions[readIdx + 2];
          
          this.colors[targetIdx] = trail.colors[readIdx];
          this.colors[targetIdx + 1] = trail.colors[readIdx + 1];
          this.colors[targetIdx + 2] = trail.colors[readIdx + 2];
          
          writeIdx++;
        }
        
        // Track update range
        minOffset = Math.min(minOffset, baseIdx);
        maxOffset = Math.max(maxOffset, baseIdx + trail.length * 3);
      });
      
      // Update buffer attributes efficiently
      if (minOffset < Infinity) {
        this.positionAttribute.updateRange.offset = minOffset;
        this.positionAttribute.updateRange.count = maxOffset - minOffset;
        this.positionAttribute.needsUpdate = true;
        
        this.colorAttribute.updateRange.offset = minOffset;
        this.colorAttribute.updateRange.count = maxOffset - minOffset;
        this.colorAttribute.needsUpdate = true;
      }
      
      this.updateQueue.clear();
    }
    
    // Periodic cleanup of inactive trails
    if (now - this.lastCleanupTime > this.CLEANUP_INTERVAL) {
      this.cleanupInactiveTrails();
      this.lastCleanupTime = now;
    }
  }

  private cleanupInactiveTrails(): void {
    const now = Date.now();
    const inactiveTimeout = 2000; // Remove trails inactive for 2 seconds
    
    const toRemove: string[] = [];
    this.trails.forEach((trail, id) => {
      if (trail.active && now - trail.lastUpdateTime > inactiveTimeout) {
        toRemove.push(id);
      }
    });
    
    toRemove.forEach(id => this.removeTrail(id));
    
    if (toRemove.length > 0) {
      debug.log(`PooledTrailSystem: Cleaned up ${toRemove.length} inactive trails`);
    }
  }

  private mergeFreeSegments(): void {
    if (this.freeSegments.length < 2) return;
    
    // Sort by start index
    this.freeSegments.sort((a, b) => a.startIndex - b.startIndex);
    
    // Merge adjacent segments
    const merged: typeof this.freeSegments = [];
    let current = this.freeSegments[0];
    
    for (let i = 1; i < this.freeSegments.length; i++) {
      const next = this.freeSegments[i];
      if (current.startIndex + current.length === next.startIndex) {
        // Merge
        current.length += next.length;
      } else {
        // Can't merge, save current and move to next
        merged.push(current);
        current = next;
      }
    }
    merged.push(current);
    
    this.freeSegments = merged;
  }

  /**
   * Get statistics about the trail system
   */
  getStats(): {
    activeTrails: number;
    totalCapacity: number;
    usedPoints: number;
    freeSegments: number;
  } {
    let usedPoints = 0;
    this.trails.forEach(trail => {
      if (trail.active) usedPoints += trail.length;
    });
    
    return {
      activeTrails: this.trails.size,
      totalCapacity: this.MAX_TOTAL_POINTS,
      usedPoints,
      freeSegments: this.freeSegments.length,
    };
  }
}