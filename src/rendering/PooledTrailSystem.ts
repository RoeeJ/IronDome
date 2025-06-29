import * as THREE from 'three';
import { debug } from '../utils/logger';

interface TrailSegment {
  id: string;
  startIndex: number;
  length: number;
  maxLength: number;
  positions: Float32Array;
  colors: Float32Array;
  currentIndex: number;
  pointCount: number; // Track actual number of valid points
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
  private trailMesh!: THREE.LineSegments;
  private geometry!: THREE.BufferGeometry;
  private material!: THREE.LineBasicMaterial;

  // Buffer management
  private readonly MAX_TOTAL_POINTS = 50000; // Total points across all trails - increased for high-rate launches
  private readonly MAX_TRAILS = 500; // Maximum number of concurrent trails - increased for all-out assault
  private positions!: Float32Array;
  private colors!: Float32Array;
  private positionAttribute!: THREE.BufferAttribute;
  private colorAttribute!: THREE.BufferAttribute;
  // Trail management
  private trails = new Map<string, TrailSegment>();
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

    // Create geometry with dynamic buffer attributes
    this.geometry = new THREE.BufferGeometry();
    this.positionAttribute = new THREE.BufferAttribute(this.positions, 3);
    this.colorAttribute = new THREE.BufferAttribute(this.colors, 3);

    this.positionAttribute.setUsage(THREE.DynamicDrawUsage);
    this.colorAttribute.setUsage(THREE.DynamicDrawUsage);

    this.geometry.setAttribute('position', this.positionAttribute);
    this.geometry.setAttribute('color', this.colorAttribute);

    // Start with no points drawn
    this.geometry.setDrawRange(0, 0);

    // Single material with vertex colors
    this.material = new THREE.LineBasicMaterial({
      color: 0xffffff, // White base color, actual color from vertices
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      linewidth: 1,
    });

    // Create the single trail mesh using LineSegments to avoid connecting different trails
    this.trailMesh = new THREE.LineSegments(this.geometry, this.material);
    this.trailMesh.frustumCulled = false; // Always render trails
    this.trailMesh.name = 'PooledTrails';
    this.scene.add(this.trailMesh);

    debug.log('PooledTrailSystem initialized with capacity for', this.MAX_TRAILS, 'trails');
  }

  /**
   * Create a new trail
   */
  createTrail(maxLength: number = 50, color: number = 0xffffff): string {
    const id = `trail_${this.nextTrailId++}`;

    // Convert hex color to RGB
    const color3 = new THREE.Color(color);
    const r = color3.r;
    const g = color3.g;
    const b = color3.b;

    // Create trail segment - no fixed allocation in main buffer
    const trail: TrailSegment = {
      id,
      startIndex: 0, // Will be dynamically assigned during update
      length: maxLength,
      maxLength,
      positions: new Float32Array(maxLength * 3),
      colors: new Float32Array(maxLength * 3),
      currentIndex: 0,
      pointCount: 0, // Start with no valid points
      active: true,
      lastUpdateTime: Date.now(),
    };

    // Initialize trail colors
    for (let i = 0; i < maxLength * 3; i += 3) {
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

    // Track actual point count (up to max)
    if (trail.pointCount < trail.maxLength) {
      trail.pointCount++;
    }

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
    this.trails.delete(id);

    // Mark all trails for update to recalculate positions
    this.trails.forEach((t, tid) => {
      if (t.active) {
        this.updateQueue.add(tid);
      }
    });
  }

  /**
   * Update all active trails - call this in the render loop
   */
  update(): void {
    const now = Date.now();

    // Always update all trails for correct rendering
    let totalSegments = 0;

    // First pass: calculate total segments needed (points - 1 per trail)
    this.trails.forEach(trail => {
      if (trail.active && trail.pointCount > 1) {
        totalSegments += trail.pointCount - 1;
      }
    });

    // LineSegments needs 2 points per segment
    const totalPoints = totalSegments * 2;

    // Update draw range to only show valid points
    this.geometry.setDrawRange(0, totalPoints);

    // Second pass: copy trail data to main buffers as line segments
    let writeOffset = 0;

    this.trails.forEach(trail => {
      if (!trail.active || trail.pointCount < 2) return;

      // Start from oldest valid point
      const startIdx = trail.pointCount >= trail.maxLength ? trail.currentIndex : 0;

      // Create line segments from consecutive points
      for (let i = 0; i < trail.pointCount - 1; i++) {
        // Get two consecutive points
        const idx1 = ((startIdx + i) % trail.maxLength) * 3;
        const idx2 = ((startIdx + i + 1) % trail.maxLength) * 3;

        // Write first point of segment
        const targetIdx1 = writeOffset * 3;
        this.positions[targetIdx1] = trail.positions[idx1];
        this.positions[targetIdx1 + 1] = trail.positions[idx1 + 1];
        this.positions[targetIdx1 + 2] = trail.positions[idx1 + 2];

        this.colors[targetIdx1] = trail.colors[idx1];
        this.colors[targetIdx1 + 1] = trail.colors[idx1 + 1];
        this.colors[targetIdx1 + 2] = trail.colors[idx1 + 2];

        // Write second point of segment
        const targetIdx2 = (writeOffset + 1) * 3;
        this.positions[targetIdx2] = trail.positions[idx2];
        this.positions[targetIdx2 + 1] = trail.positions[idx2 + 1];
        this.positions[targetIdx2 + 2] = trail.positions[idx2 + 2];

        this.colors[targetIdx2] = trail.colors[idx2];
        this.colors[targetIdx2 + 1] = trail.colors[idx2 + 1];
        this.colors[targetIdx2 + 2] = trail.colors[idx2 + 2];

        writeOffset += 2; // Move to next segment
      }
    });

    // Update buffer attributes for the exact range we wrote
    if (totalPoints > 0) {
      this.positionAttribute.needsUpdate = true;
      this.colorAttribute.needsUpdate = true;

      // Mark attributes as needing update
      this.positionAttribute.needsUpdate = true;
      this.colorAttribute.needsUpdate = true;
    }

    this.updateQueue.clear();

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

  /**
   * Get statistics about the trail system
   */
  getStats(): {
    activeTrails: number;
    totalCapacity: number;
    usedPoints: number;
  } {
    let usedPoints = 0;
    this.trails.forEach(trail => {
      if (trail.active) usedPoints += trail.length;
    });

    return {
      activeTrails: this.trails.size,
      totalCapacity: this.MAX_TOTAL_POINTS,
      usedPoints,
    };
  }
}
