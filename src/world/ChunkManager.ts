import * as THREE from 'three';
import { debug } from '../utils/DebugLogger';

export interface ChunkConfig {
  chunkSize: number; // Size of each chunk in world units
  viewDistance: number; // Number of chunks to render around camera
  worldSize: number; // Total world size in chunks
  groundMaterial?: THREE.Material;
}

export interface Chunk {
  id: string;
  x: number; // Chunk coordinate X
  z: number; // Chunk coordinate Z
  worldX: number; // World position X
  worldZ: number; // World position Z
  group: THREE.Group; // Container for all chunk objects
  ground: THREE.Mesh; // Ground mesh
  isLoaded: boolean;
  lastAccessTime: number;
}

export class ChunkManager {
  private scene: THREE.Scene;
  private config: ChunkConfig;
  private chunks: Map<string, Chunk> = new Map();
  private loadedChunks: Set<string> = new Set();
  private camera: THREE.Camera | null = null;
  private lastCameraChunk: { x: number; z: number } | null = null;

  constructor(scene: THREE.Scene, config: Partial<ChunkConfig> = {}) {
    this.scene = scene;
    this.config = {
      chunkSize: 200, // 200m chunks
      viewDistance: 3, // Render 3 chunks in each direction
      worldSize: 10, // 10x10 chunks = 2km x 2km world
      ...config,
    };

    debug.log('ChunkManager initialized', this.config);
  }

  setCamera(camera: THREE.Camera): void {
    this.camera = camera;
  }

  private getChunkId(x: number, z: number): string {
    return `${x}_${z}`;
  }

  private getChunkCoords(worldPos: THREE.Vector3): { x: number; z: number } {
    const x = Math.floor(worldPos.x / this.config.chunkSize);
    const z = Math.floor(worldPos.z / this.config.chunkSize);
    return { x, z };
  }

  private createChunk(x: number, z: number): Chunk {
    const id = this.getChunkId(x, z);
    const worldX = x * this.config.chunkSize + this.config.chunkSize / 2;
    const worldZ = z * this.config.chunkSize + this.config.chunkSize / 2;

    // Create chunk group
    const group = new THREE.Group();
    group.position.set(worldX, 0, worldZ);

    // Create ground mesh
    const groundGeometry = new THREE.PlaneGeometry(this.config.chunkSize, this.config.chunkSize);
    const groundMaterial =
      this.config.groundMaterial ||
      new THREE.MeshStandardMaterial({
        color: 0x3a5f3a,
        roughness: 0.8,
        metalness: 0.2,
      });

    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    group.add(ground);

    // Add grid for this chunk
    const gridHelper = new THREE.GridHelper(this.config.chunkSize, 10, 0x000000, 0x000000);
    gridHelper.material.opacity = 0.2;
    gridHelper.material.transparent = true;
    group.add(gridHelper);

    const chunk: Chunk = {
      id,
      x,
      z,
      worldX,
      worldZ,
      group,
      ground,
      isLoaded: false,
      lastAccessTime: Date.now(),
    };

    this.chunks.set(id, chunk);
    return chunk;
  }

  private loadChunk(x: number, z: number): void {
    const id = this.getChunkId(x, z);

    // Check if already loaded
    if (this.loadedChunks.has(id)) {
      const chunk = this.chunks.get(id);
      if (chunk) {
        chunk.lastAccessTime = Date.now();
      }
      return;
    }

    // Get or create chunk
    let chunk = this.chunks.get(id);
    if (!chunk) {
      chunk = this.createChunk(x, z);
    }

    // Add to scene
    this.scene.add(chunk.group);
    chunk.isLoaded = true;
    chunk.lastAccessTime = Date.now();
    this.loadedChunks.add(id);

    debug.category('Chunk', `Loaded chunk ${id} at (${x}, ${z})`);
  }

  private unloadChunk(x: number, z: number): void {
    const id = this.getChunkId(x, z);
    const chunk = this.chunks.get(id);

    if (!chunk || !chunk.isLoaded) return;

    // Remove from scene
    this.scene.remove(chunk.group);
    chunk.isLoaded = false;
    this.loadedChunks.delete(id);

    debug.category('Chunk', `Unloaded chunk ${id}`);
  }

  update(): void {
    if (!this.camera) return;

    // Get camera's current chunk
    const cameraChunk = this.getChunkCoords(this.camera.position);

    // Check if camera moved to a new chunk
    if (
      !this.lastCameraChunk ||
      cameraChunk.x !== this.lastCameraChunk.x ||
      cameraChunk.z !== this.lastCameraChunk.z
    ) {
      this.lastCameraChunk = cameraChunk;
      this.updateLoadedChunks(cameraChunk);
    }
  }

  private updateLoadedChunks(centerChunk: { x: number; z: number }): void {
    const viewDist = this.config.viewDistance;
    const halfWorld = Math.floor(this.config.worldSize / 2);

    // Calculate which chunks should be loaded
    const chunksToLoad = new Set<string>();

    for (let dx = -viewDist; dx <= viewDist; dx++) {
      for (let dz = -viewDist; dz <= viewDist; dz++) {
        const x = centerChunk.x + dx;
        const z = centerChunk.z + dz;

        // Keep chunks within world bounds
        if (x >= -halfWorld && x < halfWorld && z >= -halfWorld && z < halfWorld) {
          chunksToLoad.add(this.getChunkId(x, z));
        }
      }
    }

    // Load new chunks
    for (const id of chunksToLoad) {
      if (!this.loadedChunks.has(id)) {
        const [x, z] = id.split('_').map(Number);
        this.loadChunk(x, z);
      }
    }

    // Unload chunks that are too far
    for (const id of this.loadedChunks) {
      if (!chunksToLoad.has(id)) {
        const [x, z] = id.split('_').map(Number);
        this.unloadChunk(x, z);
      }
    }

    debug.category('Chunk', `Loaded chunks: ${this.loadedChunks.size}`);
  }

  getChunkAt(worldPos: THREE.Vector3): Chunk | null {
    const coords = this.getChunkCoords(worldPos);
    const id = this.getChunkId(coords.x, coords.z);
    return this.chunks.get(id) || null;
  }

  isPositionLoaded(worldPos: THREE.Vector3): boolean {
    const coords = this.getChunkCoords(worldPos);
    const id = this.getChunkId(coords.x, coords.z);
    return this.loadedChunks.has(id);
  }

  getLoadedChunks(): Chunk[] {
    const loaded: Chunk[] = [];
    for (const id of this.loadedChunks) {
      const chunk = this.chunks.get(id);
      if (chunk) loaded.push(chunk);
    }
    return loaded;
  }

  getWorldBounds(): { min: THREE.Vector3; max: THREE.Vector3 } {
    const halfSize = (this.config.worldSize * this.config.chunkSize) / 2;
    return {
      min: new THREE.Vector3(-halfSize, 0, -halfSize),
      max: new THREE.Vector3(halfSize, 1000, halfSize),
    };
  }

  // Cleanup method
  dispose(): void {
    // Unload all chunks
    for (const id of this.loadedChunks) {
      const [x, z] = id.split('_').map(Number);
      this.unloadChunk(x, z);
    }

    // Dispose geometries and materials
    for (const chunk of this.chunks.values()) {
      chunk.ground.geometry.dispose();
      if (chunk.ground.material instanceof THREE.Material) {
        chunk.ground.material.dispose();
      }
    }

    this.chunks.clear();
    this.loadedChunks.clear();
  }
}
