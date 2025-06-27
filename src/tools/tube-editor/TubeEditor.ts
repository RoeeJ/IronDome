import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { TubeEditorUI } from './TubeEditorUI';
import { TubeVisualizer } from './TubeVisualizer';

export interface TubePosition {
  id: number;
  start: THREE.Vector3 | null;
  end: THREE.Vector3 | null;
  direction: THREE.Vector3 | null;
}

export class TubeEditor {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;
  
  private batteryModel: THREE.Object3D | null = null;
  private tubePositions: TubePosition[] = [];
  private currentTubeIndex: number = -1;
  private isPlacingStart: boolean = true;
  
  private ui: TubeEditorUI;
  private visualizer: TubeVisualizer;
  
  private container: HTMLElement;
  private helpersVisible: boolean = true;
  private previewMode: boolean = false;
  
  // Grid normalization
  private gridCorners: THREE.Vector3[] = [];
  private isSelectingCorners: boolean = false;
  private snapEnabled: boolean = false;
  private snapSize: number = 0.1;
  private cornerMarkers: THREE.Mesh[] = [];
  private selectionMode: 'corners' | 'centers' | 'tube-corners' = 'corners';
  private showLabels: boolean = true;
  private currentTubeCornerSet: number = 0; // Which tube we're selecting corners for (0-3)
  
  constructor() {
    this.container = document.getElementById('canvas-container')!;
    
    // Initialize Three.js scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a1a);
    
    // Camera setup
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(30, 20, 30);
    this.camera.lookAt(0, 0, 0);
    
    // Renderer setup
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);
    
    // Controls setup
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 100;
    
    // Raycaster for picking
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    
    // Initialize tube positions
    for (let i = 0; i < 20; i++) {
      this.tubePositions.push({
        id: i,
        start: null,
        end: null,
        direction: null
      });
    }
    
    // Initialize UI and visualizer
    this.ui = new TubeEditorUI(this);
    this.visualizer = new TubeVisualizer(this.scene);
    
    // Setup scene
    this.setupLighting();
    this.setupHelpers();
    this.loadBatteryModel();
    
    // Event listeners
    this.setupEventListeners();
    
    // Initialize grid controls
    this.initializeGridControls();
    
    // Start render loop
    this.animate();
  }
  
  private setupLighting(): void {
    // Ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambientLight);
    
    // Main directional light
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(20, 40, 20);
    dirLight.castShadow = true;
    dirLight.shadow.camera.left = -30;
    dirLight.shadow.camera.right = 30;
    dirLight.shadow.camera.top = 30;
    dirLight.shadow.camera.bottom = -30;
    dirLight.shadow.camera.near = 0.1;
    dirLight.shadow.camera.far = 100;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    this.scene.add(dirLight);
    
    // Helper light from below
    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3);
    fillLight.position.set(-10, -10, -10);
    this.scene.add(fillLight);
  }
  
  private setupHelpers(): void {
    // Grid
    const gridHelper = new THREE.GridHelper(40, 40, 0x444444, 0x222222);
    gridHelper.name = 'grid';
    this.scene.add(gridHelper);
    
    // Axes
    const axesHelper = new THREE.AxesHelper(10);
    axesHelper.name = 'axes';
    this.scene.add(axesHelper);
  }
  
  private async loadBatteryModel(): Promise<void> {
    const loader = new OBJLoader();
    
    try {
      const object = await new Promise<THREE.Group>((resolve, reject) => {
        loader.load(
          '/assets/Battery.obj',
          obj => resolve(obj),
          progress => {
            const percent = (progress.loaded / progress.total) * 100;
            console.log(`Loading: ${percent.toFixed(0)}%`);
          },
          error => reject(error)
        );
      });
      
      // Process the model
      this.batteryModel = object;
      
      // Calculate bounds and center
      const box = new THREE.Box3().setFromObject(object);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      
      // Scale to reasonable size
      const targetHeight = 15;
      const scaleFactor = targetHeight / size.y;
      object.scale.multiplyScalar(scaleFactor);
      
      // Center at origin
      object.position.set(
        -center.x * scaleFactor,
        -box.min.y * scaleFactor,
        -center.z * scaleFactor
      );
      
      // Update materials for better visibility
      object.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          
          // Make material double-sided and adjust color
          if (child.material) {
            const material = child.material as THREE.Material;
            if ('color' in material) {
              (material as any).color.setHex(0x888888);
            }
            if ('side' in material) {
              (material as any).side = THREE.DoubleSide;
            }
            if ('metalness' in material) {
              (material as any).metalness = 0.3;
              (material as any).roughness = 0.7;
            }
          }
        }
      });
      
      this.scene.add(object);
      
      // Add ground plane for shadows
      const groundGeometry = new THREE.PlaneGeometry(50, 50);
      const groundMaterial = new THREE.ShadowMaterial({ opacity: 0.3 });
      const ground = new THREE.Mesh(groundGeometry, groundMaterial);
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.01;
      ground.receiveShadow = true;
      ground.name = 'ground';
      this.scene.add(ground);
      
      // Hide loading message
      const loadingEl = document.getElementById('loading');
      if (loadingEl) loadingEl.style.display = 'none';
      
      // Update UI
      this.ui.onModelLoaded();
      
    } catch (error) {
      console.error('Failed to load battery model:', error);
      const loadingEl = document.getElementById('loading');
      if (loadingEl) {
        loadingEl.textContent = 'Failed to load model!';
        loadingEl.style.color = '#ff4444';
      }
    }
  }
  
  private setupEventListeners(): void {
    // Mouse events
    this.renderer.domElement.addEventListener('click', this.onMouseClick.bind(this));
    this.renderer.domElement.addEventListener('mousemove', this.onMouseMove.bind(this));
    
    // Keyboard events
    window.addEventListener('keydown', this.onKeyDown.bind(this));
    
    // Window resize
    window.addEventListener('resize', this.onWindowResize.bind(this));
  }
  
  private onMouseClick(event: MouseEvent): void {
    if (!this.batteryModel) return;
    
    // Calculate mouse position in normalized device coordinates
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    // Update raycaster
    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    // Check intersections with battery model
    const intersects = this.raycaster.intersectObject(this.batteryModel, true);
    
    if (intersects.length > 0) {
      let point = intersects[0].point.clone();
      
      // Apply snap if enabled
      if (this.snapEnabled) {
        point = this.snapToGrid(point);
      }
      
      // Handle corner selection mode
      if (this.isSelectingCorners) {
        this.addGridCorner(point);
        return;
      }
      
      // Normal tube placement
      if (this.currentTubeIndex < 0) return;
      
      const tube = this.tubePositions[this.currentTubeIndex];
      
      if (this.isPlacingStart || !tube.start) {
        // Place start position
        tube.start = point;
        tube.end = null;
        tube.direction = null;
        this.isPlacingStart = false;
        
        // Update visualization
        this.visualizer.updateTube(tube);
        
      } else {
        // Place end position
        tube.end = point;
        
        // Calculate direction
        tube.direction = new THREE.Vector3()
          .subVectors(tube.end, tube.start)
          .normalize();
        
        this.isPlacingStart = true;
        
        // Update visualization
        this.visualizer.updateTube(tube);
        
        // Update UI
        this.ui.onTubeCompleted(this.currentTubeIndex);
      }
      
      // Update current tube info display
      this.ui.updateCurrentTubeInfo(tube);
    }
  }
  
  private onMouseMove(event: MouseEvent): void {
    if (!this.batteryModel || this.currentTubeIndex < 0) return;
    
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    // Update raycaster
    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    // Show preview if placing end position
    const tube = this.tubePositions[this.currentTubeIndex];
    if (tube.start && !tube.end) {
      const intersects = this.raycaster.intersectObject(this.batteryModel, true);
      if (intersects.length > 0) {
        this.visualizer.showPreview(tube.start, intersects[0].point);
      }
    }
  }
  
  private onKeyDown(event: KeyboardEvent): void {
    switch (event.key.toLowerCase()) {
      case 'h':
        this.toggleHelpers();
        break;
      case 'p':
        this.togglePreviewMode();
        break;
      case 'l':
        this.toggleLabels();
        break;
    }
  }
  
  private onWindowResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
  
  private toggleHelpers(): void {
    this.helpersVisible = !this.helpersVisible;
    
    const grid = this.scene.getObjectByName('grid');
    const axes = this.scene.getObjectByName('axes');
    
    if (grid) grid.visible = this.helpersVisible;
    if (axes) axes.visible = this.helpersVisible;
  }
  
  private togglePreviewMode(): void {
    this.previewMode = !this.previewMode;
    this.visualizer.setPreviewMode(this.previewMode);
  }
  
  private toggleLabels(): void {
    this.showLabels = !this.showLabels;
    this.visualizer.setShowLabels(this.showLabels);
    const checkbox = document.getElementById('show-labels') as HTMLInputElement;
    if (checkbox) checkbox.checked = this.showLabels;
  }
  
  private animate(): void {
    requestAnimationFrame(() => this.animate());
    
    this.controls.update();
    this.visualizer.update();
    this.renderer.render(this.scene, this.camera);
  }
  
  // Public methods for UI interaction
  public selectTube(index: number): void {
    this.currentTubeIndex = index;
    this.isPlacingStart = true;
    this.visualizer.setActiveTube(index);
    this.ui.updateCurrentTubeInfo(this.tubePositions[index]);
  }
  
  public clearCurrentTube(): void {
    if (this.currentTubeIndex < 0) return;
    
    const tube = this.tubePositions[this.currentTubeIndex];
    tube.start = null;
    tube.end = null;
    tube.direction = null;
    
    this.visualizer.updateTube(tube);
    this.ui.updateCurrentTubeInfo(tube);
    this.ui.onTubeCleared(this.currentTubeIndex);
  }
  
  public getTubePositions(): TubePosition[] {
    return this.tubePositions;
  }
  
  public getCurrentTubeIndex(): number {
    return this.currentTubeIndex;
  }
  
  public copyTubeData(): TubePosition | null {
    if (this.currentTubeIndex < 0) return null;
    const tube = this.tubePositions[this.currentTubeIndex];
    
    return {
      id: -1, // Temporary ID for clipboard
      start: tube.start ? tube.start.clone() : null,
      end: tube.end ? tube.end.clone() : null,
      direction: tube.direction ? tube.direction.clone() : null
    };
  }
  
  public pasteTubeData(data: TubePosition): void {
    if (this.currentTubeIndex < 0 || !data) return;
    
    const tube = this.tubePositions[this.currentTubeIndex];
    tube.start = data.start ? data.start.clone() : null;
    tube.end = data.end ? data.end.clone() : null;
    tube.direction = data.direction ? data.direction.clone() : null;
    
    this.visualizer.updateTube(tube);
    this.ui.updateCurrentTubeInfo(tube);
    
    if (tube.start && tube.end) {
      this.ui.onTubeCompleted(this.currentTubeIndex);
    }
  }
  
  public applyTubePosition(data: TubePosition): void {
    if (data.id < 0 || data.id >= 20) return;
    
    const tube = this.tubePositions[data.id];
    tube.start = data.start;
    tube.end = data.end;
    tube.direction = data.direction;
    
    this.visualizer.updateTube(tube);
    this.ui.updateCurrentTubeInfo(tube);
    
    if (tube.start && tube.end) {
      this.ui.onTubeCompleted(data.id);
    }
  }
  
  public importTubeConfigurations(configs: any[]): void {
    configs.forEach(config => {
      if (config.id >= 0 && config.id < 20) {
        const tube = this.tubePositions[config.id];
        
        if (config.start) {
          tube.start = new THREE.Vector3(config.start.x, config.start.y, config.start.z);
        }
        
        if (config.end) {
          tube.end = new THREE.Vector3(config.end.x, config.end.y, config.end.z);
        }
        
        if (config.direction) {
          tube.direction = new THREE.Vector3(config.direction.x, config.direction.y, config.direction.z);
        }
        
        // Update visualization
        this.visualizer.updateTube(tube);
      }
    });
    
    // Select first tube
    if (configs.length > 0) {
      this.selectTube(0);
    }
  }
  
  private initializeGridControls(): void {
    const selectPointsBtn = document.getElementById('select-points')!;
    const applyGridBtn = document.getElementById('apply-grid')!;
    const snapCheckbox = document.getElementById('snap-enabled') as HTMLInputElement;
    const snapSizeInput = document.getElementById('snap-size') as HTMLInputElement;
    const showLabelsCheckbox = document.getElementById('show-labels') as HTMLInputElement;
    const selectionModeSelect = document.getElementById('selection-mode') as HTMLSelectElement;
    const cornerStatus = document.getElementById('corner-status')!;
    
    selectPointsBtn.addEventListener('click', () => {
      this.isSelectingCorners = true;
      this.gridCorners = [];
      this.currentTubeCornerSet = 0;
      this.clearCornerMarkers();
      const mode = (document.getElementById('selection-mode') as HTMLSelectElement).value;
      this.selectionMode = mode as 'corners' | 'centers' | 'tube-corners';
      
      if (this.selectionMode === 'corners') {
        cornerStatus.innerHTML = 'Click corners in order: <span style="color:#ff0000">1. Top-Left</span>, <span style="color:#00ff00">2. Top-Right</span>, <span style="color:#0000ff">3. Bottom-Right</span>, <span style="color:#ffff00">4. Bottom-Left</span>';
      } else if (this.selectionMode === 'centers') {
        cornerStatus.innerHTML = 'Click center tubes in order: <span style="color:#ff0000">1. Row1,Col1</span>, <span style="color:#00ff00">2. Row1,Col5</span>, <span style="color:#0000ff">3. Row4,Col5</span>, <span style="color:#ffff00">4. Row4,Col1</span>';
      } else {
        cornerStatus.innerHTML = 'Select 4 corners of <span style="color:#ff0000">Tube 1 (Row1,Col1)</span> - Corner 1/4';
      }
      applyGridBtn.disabled = true;
    });
    
    applyGridBtn.addEventListener('click', () => {
      this.applyGridNormalization();
    });
    
    snapCheckbox.addEventListener('change', (e) => {
      this.snapEnabled = (e.target as HTMLInputElement).checked;
    });
    
    snapSizeInput.addEventListener('change', (e) => {
      this.snapSize = parseFloat((e.target as HTMLInputElement).value);
    });
    
    showLabelsCheckbox.addEventListener('change', (e) => {
      this.showLabels = (e.target as HTMLInputElement).checked;
      this.visualizer.setShowLabels(this.showLabels);
    });
    
    selectionModeSelect.addEventListener('change', (e) => {
      this.selectionMode = (e.target as HTMLSelectElement).value as 'corners' | 'centers' | 'tube-corners';
    });
  }
  
  private snapToGrid(point: THREE.Vector3): THREE.Vector3 {
    return new THREE.Vector3(
      Math.round(point.x / this.snapSize) * this.snapSize,
      Math.round(point.y / this.snapSize) * this.snapSize,
      Math.round(point.z / this.snapSize) * this.snapSize
    );
  }
  
  private addGridCorner(point: THREE.Vector3): void {
    const maxPoints = this.selectionMode === 'tube-corners' ? 16 : 4;
    if (this.gridCorners.length >= maxPoints) return;
    
    this.gridCorners.push(point.clone());
    
    // Create visual marker - smaller for tube corners mode
    const markerSize = this.selectionMode === 'tube-corners' ? 0.15 : 0.5;
    const markerGeometry = new THREE.SphereGeometry(markerSize, 16, 16);
    
    // Color based on which tube/corner we're selecting
    let color: number;
    if (this.selectionMode === 'tube-corners') {
      // Color by tube (4 corners per tube)
      const tubeIndex = Math.floor((this.gridCorners.length - 1) / 4);
      color = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00][tubeIndex];
    } else {
      color = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00][(this.gridCorners.length - 1) % 4];
    }
    
    const markerMaterial = new THREE.MeshBasicMaterial({ color });
    const marker = new THREE.Mesh(markerGeometry, markerMaterial);
    marker.position.copy(point);
    this.scene.add(marker);
    this.cornerMarkers.push(marker);
    
    const cornerStatus = document.getElementById('corner-status')!;
    
    if (this.selectionMode === 'tube-corners') {
      const tubeIndex = Math.floor((this.gridCorners.length - 1) / 4);
      const cornerIndex = (this.gridCorners.length - 1) % 4;
      const tubeNames = ['Tube 1 (Row1,Col1)', 'Tube 2 (Row1,Col5)', 'Tube 3 (Row4,Col5)', 'Tube 4 (Row4,Col1)'];
      const tubeColors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00'];
      
      if (this.gridCorners.length < 16) {
        const nextTubeIndex = Math.floor(this.gridCorners.length / 4);
        const nextCornerIndex = this.gridCorners.length % 4;
        cornerStatus.innerHTML = `Select 4 corners of <span style="color:${tubeColors[nextTubeIndex]}">${tubeNames[nextTubeIndex]}</span> - Corner ${nextCornerIndex + 1}/4`;
      } else {
        this.isSelectingCorners = false;
        document.getElementById('apply-grid')!.disabled = false;
        cornerStatus.textContent = 'Ready to apply grid! All 16 corners selected.';
      }
    } else {
      const cornerNames = this.selectionMode === 'corners' 
        ? ['Top-Left', 'Top-Right', 'Bottom-Right', 'Bottom-Left']
        : ['Row1,Col1', 'Row1,Col5', 'Row4,Col5', 'Row4,Col1'];
      
      const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00'];
      
      if (this.gridCorners.length < 4) {
        cornerStatus.innerHTML = `Selected ${this.gridCorners.length}/4 points. Next: <span style="color:${colors[this.gridCorners.length % 4]}">${cornerNames[this.gridCorners.length] || 'Done!'}</span>`;
      } else {
        this.isSelectingCorners = false;
        document.getElementById('apply-grid')!.disabled = false;
        cornerStatus.textContent = 'Ready to apply grid! Adjust parameters and click Apply Grid.';
      }
    }
  }
  
  private clearCornerMarkers(): void {
    this.cornerMarkers.forEach(marker => {
      this.scene.remove(marker);
      marker.geometry.dispose();
      (marker.material as THREE.Material).dispose();
    });
    this.cornerMarkers = [];
  }
  
  private applyGridNormalization(): void {
    const expectedPoints = this.selectionMode === 'tube-corners' ? 16 : 4;
    if (this.gridCorners.length !== expectedPoints) return;
    
    const rows = parseInt((document.getElementById('grid-rows') as HTMLInputElement).value);
    const cols = parseInt((document.getElementById('grid-cols') as HTMLInputElement).value);
    const rowOrder = (document.getElementById('row-order') as HTMLSelectElement).value;
    const rowSpacing = parseFloat((document.getElementById('row-spacing') as HTMLInputElement).value);
    const colSpacing = parseFloat((document.getElementById('col-spacing') as HTMLInputElement).value);
    const tubeLength = parseFloat((document.getElementById('tube-length') as HTMLInputElement).value);
    
    let points: THREE.Vector3[] = [];
    
    // Process tube corners mode - calculate center of each tube from its 4 corners
    if (this.selectionMode === 'tube-corners') {
      for (let i = 0; i < 4; i++) {
        const tubeCorners = this.gridCorners.slice(i * 4, (i + 1) * 4);
        
        // Calculate center of the tube from its 4 corners
        const center = new THREE.Vector3();
        tubeCorners.forEach(corner => center.add(corner));
        center.divideScalar(4);
        
        points.push(center);
      }
    } else {
      points = this.gridCorners;
    }
    
    if (this.selectionMode === 'centers' || this.selectionMode === 'tube-corners') {
      // Points are: Row1Col1, Row1Col5, Row4Col5, Row4Col1
      const [r1c1, r1c5, r4c5, r4c1] = points;
      
      // Calculate the vectors between the reference points
      // Column vector from col 1 to col 5 (4 spaces)
      const colFullVector = new THREE.Vector3().subVectors(r1c5, r1c1);
      const colUnitVector = colFullVector.clone().divideScalar(4); // 4 spaces between col 1 and 5
      
      // Row vector from row 1 to row 4 (3 spaces)
      const rowFullVector = new THREE.Vector3().subVectors(r4c1, r1c1);
      const rowUnitVector = rowFullVector.clone().divideScalar(3); // 3 spaces between row 1 and 4
      
      // Now generate all positions
      let tubeIndex = 0;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          if (tubeIndex >= 20) break;
          
          // Use the actual row order
          const actualRow = rowOrder === 'bottom-to-top' ? (rows - 1 - row) : row;
          
          // Calculate position based on the reference point (r1c1)
          const startPoint = r1c1.clone()
            .add(colUnitVector.clone().multiplyScalar(col))
            .add(rowUnitVector.clone().multiplyScalar(actualRow));
          
          // Calculate end point
          const avgDirection = new THREE.Vector3(-0.5, -0.84, -0.19).normalize();
          const endPoint = startPoint.clone().add(
            avgDirection.clone().multiplyScalar(tubeLength)
          );
          
          // Apply to tube
          const tube = this.tubePositions[tubeIndex];
          tube.start = startPoint;
          tube.end = endPoint;
          tube.direction = avgDirection.clone();
          
          this.visualizer.updateTube(tube);
          tubeIndex++;
        }
      }
    } else {
      // Corner mode - Points are: top-left, top-right, bottom-right, bottom-left
      const [tl, tr, br, bl] = points;
      
      let tubeIndex = 0;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          if (tubeIndex >= 20) break;
          
          // Use the actual row order
          const actualRow = rowOrder === 'bottom-to-top' ? (rows - 1 - row) : row;
          
          // Calculate normalized position in grid (0-1)
          const u = cols > 1 ? col / (cols - 1) : 0.5;
          const v = rows > 1 ? actualRow / (rows - 1) : 0.5;
          
          // Bilinear interpolation between corners
          // Top edge: interpolate between tl and tr
          const topPoint = new THREE.Vector3().lerpVectors(tl, tr, u);
          // Bottom edge: interpolate between bl and br
          const bottomPoint = new THREE.Vector3().lerpVectors(bl, br, u);
          // Final position: interpolate between top and bottom
          const startPoint = new THREE.Vector3().lerpVectors(topPoint, bottomPoint, v);
          
          // Calculate end point
          const avgDirection = new THREE.Vector3(-0.5, -0.84, -0.19).normalize();
          const endPoint = startPoint.clone().add(
            avgDirection.clone().multiplyScalar(tubeLength)
          );
          
          // Apply to tube with row/column info for debugging
          const tube = this.tubePositions[tubeIndex];
          tube.start = startPoint;
          tube.end = endPoint;
          tube.direction = avgDirection.clone();
          
          this.visualizer.updateTube(tube);
          
          // Update label to show row/column
          this.visualizer.updateTubeLabel(tubeIndex, `${tubeIndex + 1} (R${actualRow + 1}C${col + 1})`);
          
          tubeIndex++;
        }
      }
    }
    
    // Clear corner markers
    this.clearCornerMarkers();
    this.gridCorners = [];
    
    // Update UI
    this.ui.updateCompletedCount();
    document.getElementById('corner-status')!.textContent = 'Grid applied successfully!';
  }
}

// Initialize editor when DOM is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new TubeEditor());
} else {
  new TubeEditor();
}