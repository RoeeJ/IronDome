import * as THREE from 'three';
import { debug } from '../utils/DebugLogger';

export interface SpatialObject {
  id: string;
  position: THREE.Vector3;
  radius: number;
  type: string;
  data?: any;
}

export interface QuadTreeNode {
  bounds: THREE.Box2;
  objects: SpatialObject[];
  children: QuadTreeNode[] | null;
  depth: number;
}

export class SpatialIndex {
  private root: QuadTreeNode;
  private maxObjects: number = 10;
  private maxDepth: number = 5;
  private objects: Map<string, SpatialObject> = new Map();

  constructor(worldBounds: { min: THREE.Vector3; max: THREE.Vector3 }) {
    // Convert 3D bounds to 2D (ignore Y)
    const bounds = new THREE.Box2(
      new THREE.Vector2(worldBounds.min.x, worldBounds.min.z),
      new THREE.Vector2(worldBounds.max.x, worldBounds.max.z)
    );

    this.root = {
      bounds,
      objects: [],
      children: null,
      depth: 0,
    };

    debug.log('SpatialIndex initialized', {
      bounds: `(${bounds.min.x}, ${bounds.min.y}) to (${bounds.max.x}, ${bounds.max.y})`,
    });
  }

  private subdivide(node: QuadTreeNode): void {
    const { min, max } = node.bounds;
    const midX = (min.x + max.x) / 2;
    const midY = (min.y + max.y) / 2;

    node.children = [
      // Top-left
      {
        bounds: new THREE.Box2(min, new THREE.Vector2(midX, midY)),
        objects: [],
        children: null,
        depth: node.depth + 1,
      },
      // Top-right
      {
        bounds: new THREE.Box2(new THREE.Vector2(midX, min.y), new THREE.Vector2(max.x, midY)),
        objects: [],
        children: null,
        depth: node.depth + 1,
      },
      // Bottom-left
      {
        bounds: new THREE.Box2(new THREE.Vector2(min.x, midY), new THREE.Vector2(midX, max.y)),
        objects: [],
        children: null,
        depth: node.depth + 1,
      },
      // Bottom-right
      {
        bounds: new THREE.Box2(new THREE.Vector2(midX, midY), max),
        objects: [],
        children: null,
        depth: node.depth + 1,
      },
    ];

    // Redistribute objects to children
    const objectsToRedistribute = [...node.objects];
    node.objects = [];

    for (const obj of objectsToRedistribute) {
      this.insertIntoNode(node, obj);
    }
  }

  private getChildIndex(node: QuadTreeNode, position: THREE.Vector2): number {
    const { min, max } = node.bounds;
    const midX = (min.x + max.x) / 2;
    const midY = (min.y + max.y) / 2;

    if (position.x < midX) {
      return position.y < midY ? 0 : 2; // Left side
    } else {
      return position.y < midY ? 1 : 3; // Right side
    }
  }

  private insertIntoNode(node: QuadTreeNode, obj: SpatialObject): void {
    // If node has children, insert into appropriate child
    if (node.children) {
      const pos2D = new THREE.Vector2(obj.position.x, obj.position.z);
      const childIndex = this.getChildIndex(node, pos2D);
      this.insertIntoNode(node.children[childIndex], obj);
      return;
    }

    // Add to this node
    node.objects.push(obj);

    // Check if we need to subdivide
    if (node.objects.length > this.maxObjects && node.depth < this.maxDepth) {
      this.subdivide(node);
    }
  }

  insert(obj: SpatialObject): void {
    this.objects.set(obj.id, obj);
    this.insertIntoNode(this.root, obj);
  }

  update(id: string, position: THREE.Vector3): void {
    const obj = this.objects.get(id);
    if (!obj) return;

    // Remove and re-insert (simple but not most efficient)
    this.remove(id);
    obj.position = position;
    this.insert(obj);
  }

  remove(id: string): void {
    const obj = this.objects.get(id);
    if (!obj) return;

    this.objects.delete(id);
    this.removeFromNode(this.root, obj);
  }

  private removeFromNode(node: QuadTreeNode, obj: SpatialObject): boolean {
    // Check this node's objects
    const index = node.objects.findIndex(o => o.id === obj.id);
    if (index !== -1) {
      node.objects.splice(index, 1);
      return true;
    }

    // Check children
    if (node.children) {
      for (const child of node.children) {
        if (this.removeFromNode(child, obj)) {
          return true;
        }
      }
    }

    return false;
  }

  // Query objects within a radius
  queryRadius(center: THREE.Vector3, radius: number): SpatialObject[] {
    const results: SpatialObject[] = [];
    const searchBox = new THREE.Box2(
      new THREE.Vector2(center.x - radius, center.z - radius),
      new THREE.Vector2(center.x + radius, center.z + radius)
    );

    this.queryNode(this.root, searchBox, obj => {
      // Check actual distance (circle test)
      const dx = obj.position.x - center.x;
      const dz = obj.position.z - center.z;
      const distSq = dx * dx + dz * dz;

      if (distSq <= radius * radius) {
        results.push(obj);
      }
    });

    return results;
  }

  // Query objects within a box
  queryBox(box: THREE.Box3): SpatialObject[] {
    const results: SpatialObject[] = [];
    const box2D = new THREE.Box2(
      new THREE.Vector2(box.min.x, box.min.z),
      new THREE.Vector2(box.max.x, box.max.z)
    );

    this.queryNode(this.root, box2D, obj => {
      // Check Y bounds as well
      if (obj.position.y >= box.min.y && obj.position.y <= box.max.y) {
        results.push(obj);
      }
    });

    return results;
  }

  // Query nearest neighbors
  queryNearest(position: THREE.Vector3, count: number, maxDistance?: number): SpatialObject[] {
    const candidates = maxDistance
      ? this.queryRadius(position, maxDistance)
      : Array.from(this.objects.values());

    // Sort by distance
    candidates.sort((a, b) => {
      const distA = a.position.distanceToSquared(position);
      const distB = b.position.distanceToSquared(position);
      return distA - distB;
    });

    return candidates.slice(0, count);
  }

  private queryNode(
    node: QuadTreeNode,
    searchBounds: THREE.Box2,
    callback: (obj: SpatialObject) => void
  ): void {
    // Check if node bounds intersect search bounds
    if (!node.bounds.intersectsBox(searchBounds)) {
      return;
    }

    // Check objects in this node
    for (const obj of node.objects) {
      const objPos = new THREE.Vector2(obj.position.x, obj.position.z);
      if (searchBounds.containsPoint(objPos)) {
        callback(obj);
      }
    }

    // Check children
    if (node.children) {
      for (const child of node.children) {
        this.queryNode(child, searchBounds, callback);
      }
    }
  }

  // Get objects by type within radius
  queryByType(center: THREE.Vector3, radius: number, type: string): SpatialObject[] {
    return this.queryRadius(center, radius).filter(obj => obj.type === type);
  }

  // Debug visualization
  getDebugLines(): THREE.Line[] {
    const lines: THREE.Line[] = [];
    this.getNodeDebugLines(this.root, lines);
    return lines;
  }

  private getNodeDebugLines(node: QuadTreeNode, lines: THREE.Line[]): void {
    const { min, max } = node.bounds;
    const y = 0.1; // Slightly above ground

    // Create box outline
    const points = [
      new THREE.Vector3(min.x, y, min.y),
      new THREE.Vector3(max.x, y, min.y),
      new THREE.Vector3(max.x, y, max.y),
      new THREE.Vector3(min.x, y, max.y),
      new THREE.Vector3(min.x, y, min.y),
    ];

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: node.depth === 0 ? 0xff0000 : 0x00ff00,
      opacity: 1 - node.depth * 0.2,
      transparent: true,
    });

    lines.push(new THREE.Line(geometry, material));

    // Recurse to children
    if (node.children) {
      for (const child of node.children) {
        this.getNodeDebugLines(child, lines);
      }
    }
  }

  getStats(): {
    totalObjects: number;
    nodeCount: number;
    maxDepth: number;
    objectsByType: Record<string, number>;
  } {
    const stats = {
      totalObjects: this.objects.size,
      nodeCount: 0,
      maxDepth: 0,
      objectsByType: {} as Record<string, number>,
    };

    // Count objects by type
    for (const obj of this.objects.values()) {
      stats.objectsByType[obj.type] = (stats.objectsByType[obj.type] || 0) + 1;
    }

    // Count nodes and find max depth
    this.countNodes(this.root, stats);

    return stats;
  }

  private countNodes(node: QuadTreeNode, stats: any): void {
    stats.nodeCount++;
    stats.maxDepth = Math.max(stats.maxDepth, node.depth);

    if (node.children) {
      for (const child of node.children) {
        this.countNodes(child, stats);
      }
    }
  }

  clear(): void {
    this.objects.clear();
    this.root.objects = [];
    this.root.children = null;
  }
}
