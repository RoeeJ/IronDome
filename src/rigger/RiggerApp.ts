import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { ModelManager } from '../utils/ModelManager';
import { MODEL_IDS } from '../config/ModelRegistry';
import { BoneVisualizer } from './BoneVisualizer';
import { AimController } from './AimController';
import { RigBuilder } from './RigBuilder';
import { RotationDebugHelper } from './RotationDebugHelper';
import { ProceduralLaserTurret } from './ProceduralLaserTurret';

export class RiggerApp {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private transformControls: TransformControls;
  
  private currentModel?: THREE.Object3D;
  private selectedPart?: THREE.Object3D;
  private targetMesh?: THREE.Mesh;
  private proceduralTurret?: ProceduralLaserTurret;
  
  private boneVisualizer: BoneVisualizer;
  private aimController: AimController;
  private rigBuilder: RigBuilder;
  private rotationDebugHelper: RotationDebugHelper;
  
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  
  // Animation state
  private isAimTestRunning = false;
  private autoRotateTarget = false;
  private targetSpeed = 1.0;
  private clock = new THREE.Clock();
  
  // UI Elements
  private elements: { [key: string]: HTMLElement | null } = {};

  constructor() {
    this.initializeScene();
    this.initializeUI();
    this.setupEventListeners();
    
    // Auto-load laser cannon model and start sine wave target
    this.autoLoadLaserCannon();
    
    this.animate();
  }

  private initializeScene(): void {
    // Scene setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0f0f0f);

    // Camera setup
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    this.camera = new THREE.PerspectiveCamera(
      50,
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      1000
    );
    // Position camera to the side for better view of pitch motion
    this.camera.position.set(20, 10, 0);

    // Renderer setup
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Controls setup
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 50;

    // Transform controls
    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.addEventListener('dragging-changed', (event) => {
      this.controls.enabled = !event.value;
    });
    this.transformControls.addEventListener('change', () => {
      this.updateTransformUI();
    });
    this.scene.add(this.transformControls);

    // Initialize components
    this.boneVisualizer = new BoneVisualizer(this.scene);
    this.aimController = new AimController();
    this.rigBuilder = new RigBuilder();
    this.rotationDebugHelper = new RotationDebugHelper(this.scene);

    // Setup lighting
    this.setupLighting();
    
    // Setup helpers
    this.setupHelpers();
    
    // Create target mesh
    this.createTargetMesh();
  }

  private setupLighting(): void {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 20, 10);
    directionalLight.castShadow = true;
    directionalLight.shadow.camera.far = 50;
    directionalLight.shadow.camera.left = -20;
    directionalLight.shadow.camera.right = 20;
    directionalLight.shadow.camera.top = 20;
    directionalLight.shadow.camera.bottom = -20;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    this.scene.add(directionalLight);

    const fillLight = new THREE.DirectionalLight(0x4488ff, 0.3);
    fillLight.position.set(-10, 5, -10);
    this.scene.add(fillLight);
  }

  private setupHelpers(): void {
    // Grid
    const gridHelper = new THREE.GridHelper(30, 30, 0x444444, 0x222222);
    gridHelper.name = 'grid';
    this.scene.add(gridHelper);

    // Axes
    const axesHelper = new THREE.AxesHelper(5);
    axesHelper.name = 'axes';
    axesHelper.visible = false;
    this.scene.add(axesHelper);
  }

  private createTargetMesh(): void {
    // Create a simple target sphere
    const geometry = new THREE.SphereGeometry(0.5, 16, 16);
    const material = new THREE.MeshStandardMaterial({
      color: 0xff4444,
      emissive: 0xff0000,
      emissiveIntensity: 0.3
    });
    this.targetMesh = new THREE.Mesh(geometry, material);
    this.targetMesh.position.set(10, 5, 10);
    this.targetMesh.name = 'target';
    this.targetMesh.visible = false; // Will be made visible when test starts
    this.targetMesh.castShadow = true;
    this.targetMesh.receiveShadow = true;
    this.scene.add(this.targetMesh);
  }

  private initializeUI(): void {
    // Cache UI elements
    const elementIds = [
      'load-model', 'model-dropdown', 'parts-list', 'bone-list',
      'selected-part', 'pos-x', 'pos-y', 'pos-z',
      'rot-x', 'rot-y', 'rot-z', 'aim-mode',
      'target-x', 'target-y', 'target-z', 'place-target',
      'yaw-limit', 'yaw-limit-value', 'pitch-min', 'pitch-min-value',
      'pitch-max', 'pitch-max-value', 'rotation-smoothing', 'smoothing-value',
      'start-aim-test', 'stop-aim-test', 'auto-rotate-target',
      'target-speed', 'target-speed-value', 'add-bone', 'toggle-bones',
      'reset-camera', 'toggle-grid', 'toggle-axes', 'screenshot',
      'export-rig', 'export-config', 'fps-counter', 'target-name',
      'aim-angle', 'target-distance'
    ];

    elementIds.forEach(id => {
      this.elements[id] = document.getElementById(id);
    });
  }

  private setupEventListeners(): void {
    // Window resize
    window.addEventListener('resize', this.onWindowResize.bind(this));

    // Model loading
    this.elements['load-model']?.addEventListener('click', this.loadModel.bind(this));

    // Transform controls
    this.elements['pos-x']?.addEventListener('input', this.updatePartTransform.bind(this));
    this.elements['pos-y']?.addEventListener('input', this.updatePartTransform.bind(this));
    this.elements['pos-z']?.addEventListener('input', this.updatePartTransform.bind(this));
    this.elements['rot-x']?.addEventListener('input', this.updatePartTransform.bind(this));
    this.elements['rot-y']?.addEventListener('input', this.updatePartTransform.bind(this));
    this.elements['rot-z']?.addEventListener('input', this.updatePartTransform.bind(this));

    // Aiming controls
    this.elements['aim-mode']?.addEventListener('change', this.updateAimMode.bind(this));
    this.elements['place-target']?.addEventListener('click', this.placeTarget.bind(this));
    this.elements['yaw-limit']?.addEventListener('input', this.updateConstraints.bind(this));
    this.elements['pitch-min']?.addEventListener('input', this.updateConstraints.bind(this));
    this.elements['pitch-max']?.addEventListener('input', this.updateConstraints.bind(this));
    this.elements['rotation-smoothing']?.addEventListener('input', this.updateSmoothing.bind(this));

    // Animation controls
    this.elements['start-aim-test']?.addEventListener('click', this.startAimTest.bind(this));
    this.elements['stop-aim-test']?.addEventListener('click', this.stopAimTest.bind(this));
    this.elements['auto-rotate-target']?.addEventListener('change', this.toggleAutoRotate.bind(this));
    this.elements['target-speed']?.addEventListener('input', this.updateTargetSpeed.bind(this));

    // Viewport controls
    this.elements['reset-camera']?.addEventListener('click', this.resetCamera.bind(this));
    this.elements['toggle-grid']?.addEventListener('click', this.toggleGrid.bind(this));
    this.elements['toggle-axes']?.addEventListener('click', this.toggleAxes.bind(this));
    this.elements['screenshot']?.addEventListener('click', this.takeScreenshot.bind(this));

    // Bone controls
    this.elements['add-bone']?.addEventListener('click', this.addBone.bind(this));
    this.elements['toggle-bones']?.addEventListener('click', this.toggleBones.bind(this));

    // Export controls
    this.elements['export-rig']?.addEventListener('click', this.exportRig.bind(this));
    this.elements['export-config']?.addEventListener('click', this.exportConfig.bind(this));

    // Mouse events for selection
    this.renderer.domElement.addEventListener('click', this.onMouseClick.bind(this));
    this.renderer.domElement.addEventListener('mousemove', this.onMouseMove.bind(this));
  }

  private async loadModel(): Promise<void> {
    const modelId = (this.elements['model-dropdown'] as HTMLSelectElement)?.value;
    if (!modelId) return;

    this.showLoading();

    try {
      // Remove existing model
      if (this.currentModel) {
        this.scene.remove(this.currentModel);
        this.selectedPart = undefined;
        this.transformControls.detach();
        this.proceduralTurret = undefined;
      }

      // Load new model
      const modelManager = ModelManager.getInstance();
      let modelConfig;

      switch (modelId) {
        case 'procedural-turret':
          // Use procedural turret instead of loading GLTF
          this.proceduralTurret = new ProceduralLaserTurret();
          this.currentModel = this.proceduralTurret;
          this.currentModel.scale.setScalar(2);
          this.scene.add(this.currentModel);
          
          // Update parts list
          this.updatePartsList();
          
          // Reset camera
          this.resetCamera();
          
          this.hideLoading();
          return;
          
        case 'laser-cannon':
          modelConfig = await modelManager.loadModel(MODEL_IDS.LASER_CANNON);
          break;
        case 'battery':
          modelConfig = await modelManager.loadModel(MODEL_IDS.BATTERY);
          break;
        case 'radar':
          modelConfig = await modelManager.loadModel(MODEL_IDS.RADAR);
          break;
        default:
          throw new Error(`Unknown model: ${modelId}`);
      }

      this.currentModel = modelConfig.scene;
      
      // Scale and position model
      this.currentModel.scale.setScalar(10);
      this.currentModel.position.set(0, 0, 0);
      
      // For GLTF models, the structure might be nested
      // Let's find the actual model root
      if (modelId === 'laser-cannon') {
        console.log('=== Laser Cannon Model Analysis ===');
        
        // Log the complete hierarchy
        this.currentModel.traverse(child => {
          if (child.name) {
            const path = this.getObjectPath(child);
            console.log(`${path}: rotation=[${child.rotation.x.toFixed(2)}, ${child.rotation.y.toFixed(2)}, ${child.rotation.z.toFixed(2)}]`);
          }
        });
        
        // Find key nodes
        const sketchfab = this.currentModel.getObjectByName('Sketchfab_model');
        const root = this.currentModel.getObjectByName('Root');
        const cube001 = this.currentModel.getObjectByName('Cube001');
        
        console.log('Key nodes found:', {
          sketchfab: !!sketchfab,
          root: !!root,
          cube001: !!cube001
        });
        
        // Add axes helpers at different levels
        if (sketchfab) {
          const axesHelper = new THREE.AxesHelper(30);
          axesHelper.name = 'sketchfab-axes';
          sketchfab.add(axesHelper);
        }
        
        if (cube001) {
          const axesHelper = new THREE.AxesHelper(20);
          axesHelper.name = 'cube001-axes';
          cube001.add(axesHelper);
        }
      }
      
      this.scene.add(this.currentModel);

      // Update parts list
      this.updatePartsList();

      // Reset camera to view model
      this.resetCamera();

      // Setup rig for laser cannon
      if (modelId === 'laser-cannon') {
        this.setupLaserCannonRig();
      }

    } catch (error) {
      console.error('Failed to load model:', error);
      alert(`Failed to load model: ${error}`);
    } finally {
      this.hideLoading();
    }
  }

  private setupLaserCannonRig(): void {
    if (!this.currentModel) return;

    // Debug: Log the model structure
    console.log('=== Laser Cannon Model Structure ===');
    this.currentModel.traverse(child => {
      if (child.name) {
        const indent = '  '.repeat(this.getDepth(child, this.currentModel));
        console.log(`${indent}${child.name} [${child.type}]`);
      }
    });

    // Create rig structure for laser cannon
    const rigData = this.rigBuilder.createLaserCannonRig(this.currentModel);
    
    // Set up aim controller with the rig
    this.aimController.setRig(rigData);
    
    // Visualize bones
    this.boneVisualizer.visualizeRig(rigData);
    
    // Update UI
    this.updateBonesList(rigData);
  }

  private getDepth(object: THREE.Object3D, root: THREE.Object3D): number {
    let depth = 0;
    let current = object;
    while (current.parent && current.parent !== root) {
      depth++;
      current = current.parent;
    }
    return depth;
  }

  private getObjectPath(object: THREE.Object3D): string {
    const path: string[] = [object.name];
    let current = object;
    while (current.parent && current.parent.name) {
      current = current.parent;
      path.unshift(current.name);
    }
    return path.join(' > ');
  }

  private updatePartsList(): void {
    const partsList = this.elements['parts-list'];
    if (!partsList || !this.currentModel) return;

    partsList.innerHTML = '';
    
    // Helper function to create hierarchical display
    const addPartToList = (part: THREE.Object3D, level: number = 0) => {
      if (part.name && part !== this.currentModel) {
        const item = document.createElement('div');
        item.className = 'part-item';
        item.style.paddingLeft = `${level * 20}px`;
        
        // Add hierarchy indicator
        const prefix = level > 0 ? '└─ ' : '';
        const childCount = part.children.length > 0 ? ` (${part.children.length} children)` : '';
        item.textContent = prefix + part.name + childCount;
        
        item.addEventListener('click', () => this.selectPart(part));
        partsList.appendChild(item);

        // Log important parts for debugging
        if (part.name === 'Cube001' || part.name.includes('Cylinder') || part.name.includes('Cube')) {
          console.log(`Part: ${part.name}, Type: ${part.type}, Children: ${part.children.length}`);
        }
      }

      // Recursively add children
      part.children.forEach(child => {
        addPartToList(child, level + 1);
      });
    };

    // Start from the root
    this.currentModel.children.forEach(child => {
      addPartToList(child, 0);
    });
  }

  private updateBonesList(rigData: any): void {
    const bonesList = this.elements['bone-list'];
    if (!bonesList) return;

    bonesList.innerHTML = '';
    
    rigData.bones.forEach((bone: any) => {
      const item = document.createElement('div');
      item.className = 'bone-item';
      item.textContent = bone.name;
      bonesList.appendChild(item);
    });
  }

  private selectPart(part: THREE.Object3D): void {
    // Update selection
    this.selectedPart = part;
    this.transformControls.attach(part);

    // Update UI
    this.updateTransformUI();
    
    // Update selected part display
    const selectedPartEl = this.elements['selected-part'];
    if (selectedPartEl) {
      selectedPartEl.textContent = part.name;
    }

    // Update parts list highlighting
    const partsList = this.elements['parts-list'];
    if (partsList) {
      partsList.querySelectorAll('.part-item').forEach((item, index) => {
        item.classList.toggle('selected', item.textContent === part.name);
      });
    }
  }

  private updateTransformUI(): void {
    if (!this.selectedPart) return;

    const pos = this.selectedPart.position;
    const rot = this.selectedPart.rotation;

    (this.elements['pos-x'] as HTMLInputElement).value = pos.x.toFixed(2);
    (this.elements['pos-y'] as HTMLInputElement).value = pos.y.toFixed(2);
    (this.elements['pos-z'] as HTMLInputElement).value = pos.z.toFixed(2);

    (this.elements['rot-x'] as HTMLInputElement).value = THREE.MathUtils.radToDeg(rot.x).toFixed(0);
    (this.elements['rot-y'] as HTMLInputElement).value = THREE.MathUtils.radToDeg(rot.y).toFixed(0);
    (this.elements['rot-z'] as HTMLInputElement).value = THREE.MathUtils.radToDeg(rot.z).toFixed(0);
  }

  private updatePartTransform(): void {
    if (!this.selectedPart) return;

    const posX = parseFloat((this.elements['pos-x'] as HTMLInputElement).value) || 0;
    const posY = parseFloat((this.elements['pos-y'] as HTMLInputElement).value) || 0;
    const posZ = parseFloat((this.elements['pos-z'] as HTMLInputElement).value) || 0;

    const rotX = THREE.MathUtils.degToRad(parseFloat((this.elements['rot-x'] as HTMLInputElement).value) || 0);
    const rotY = THREE.MathUtils.degToRad(parseFloat((this.elements['rot-y'] as HTMLInputElement).value) || 0);
    const rotZ = THREE.MathUtils.degToRad(parseFloat((this.elements['rot-z'] as HTMLInputElement).value) || 0);

    this.selectedPart.position.set(posX, posY, posZ);
    this.selectedPart.rotation.set(rotX, rotY, rotZ);
  }

  private updateAimMode(): void {
    const mode = (this.elements['aim-mode'] as HTMLSelectElement).value;
    this.aimController.setMode(mode as 'manual' | 'look-at' | 'ik');
  }

  private placeTarget(): void {
    const x = parseFloat((this.elements['target-x'] as HTMLInputElement).value) || 10;
    const y = parseFloat((this.elements['target-y'] as HTMLInputElement).value) || 5;
    const z = parseFloat((this.elements['target-z'] as HTMLInputElement).value) || 10;

    if (this.targetMesh) {
      this.targetMesh.position.set(x, y, z);
      this.targetMesh.visible = true;
    }
  }

  private updateConstraints(): void {
    const yawLimit = parseFloat((this.elements['yaw-limit'] as HTMLInputElement).value);
    const pitchMin = parseFloat((this.elements['pitch-min'] as HTMLInputElement).value);
    const pitchMax = parseFloat((this.elements['pitch-max'] as HTMLInputElement).value);

    this.aimController.setConstraints({
      yawLimit: THREE.MathUtils.degToRad(yawLimit),
      pitchMin: THREE.MathUtils.degToRad(pitchMin),
      pitchMax: THREE.MathUtils.degToRad(pitchMax)
    });

    // Update display values
    if (this.elements['yaw-limit-value']) {
      this.elements['yaw-limit-value'].textContent = `${yawLimit}°`;
    }
    if (this.elements['pitch-min-value']) {
      this.elements['pitch-min-value'].textContent = `${pitchMin}°`;
    }
    if (this.elements['pitch-max-value']) {
      this.elements['pitch-max-value'].textContent = `${pitchMax}°`;
    }
  }

  private updateSmoothing(): void {
    const smoothing = parseFloat((this.elements['rotation-smoothing'] as HTMLInputElement).value);
    this.aimController.setSmoothing(smoothing);
    
    if (this.elements['smoothing-value']) {
      this.elements['smoothing-value'].textContent = smoothing.toFixed(2);
    }
  }

  private startAimTest(): void {
    this.isAimTestRunning = true;
    if (this.targetMesh) {
      this.targetMesh.visible = true;
    }
  }

  private stopAimTest(): void {
    this.isAimTestRunning = false;
  }

  private toggleAutoRotate(): void {
    this.autoRotateTarget = (this.elements['auto-rotate-target'] as HTMLInputElement).checked;
  }

  private updateTargetSpeed(): void {
    this.targetSpeed = parseFloat((this.elements['target-speed'] as HTMLInputElement).value);
    if (this.elements['target-speed-value']) {
      this.elements['target-speed-value'].textContent = this.targetSpeed.toFixed(1);
    }
  }

  private resetCamera(): void {
    // Side view for better pitch observation
    this.camera.position.set(20, 10, 0);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  private toggleGrid(): void {
    const grid = this.scene.getObjectByName('grid');
    if (grid) {
      grid.visible = !grid.visible;
    }
  }

  private toggleAxes(): void {
    const axes = this.scene.getObjectByName('axes');
    if (axes) {
      axes.visible = !axes.visible;
    }
  }

  private toggleBones(): void {
    this.boneVisualizer.toggleVisibility();
  }

  private addBone(): void {
    // TODO: Implement bone addition
    console.log('Add bone - not yet implemented');
  }

  private takeScreenshot(): void {
    this.renderer.render(this.scene, this.camera);
    const dataURL = this.renderer.domElement.toDataURL('image/png');
    
    const link = document.createElement('a');
    link.download = `rigger-screenshot-${Date.now()}.png`;
    link.href = dataURL;
    link.click();
  }

  private exportRig(): void {
    // TODO: Implement rig export
    console.log('Export rig - not yet implemented');
  }

  private exportConfig(): void {
    const config = this.aimController.exportConfig();
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.download = `rig-config-${Date.now()}.json`;
    link.href = url;
    link.click();
    
    URL.revokeObjectURL(url);
  }

  private onMouseClick(event: MouseEvent): void {
    // Handle part selection via clicking
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    if (this.currentModel) {
      const intersects = this.raycaster.intersectObject(this.currentModel, true);
      if (intersects.length > 0) {
        let object = intersects[0].object;
        // Find the named parent
        while (object && !object.name && object.parent) {
          object = object.parent;
        }
        if (object && object.name && object !== this.currentModel) {
          this.selectPart(object);
        }
      }
    }
  }

  private onMouseMove(event: MouseEvent): void {
    // Update mouse position for hover effects
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private showLoading(): void {
    const loading = document.getElementById('loading');
    if (loading) loading.style.display = 'block';
  }

  private hideLoading(): void {
    const loading = document.getElementById('loading');
    if (loading) loading.style.display = 'none';
  }

  private onWindowResize(): void {
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private autoLoadLaserCannon(): void {
    // Auto-select procedural turret in dropdown
    const dropdown = this.elements['model-dropdown'] as HTMLSelectElement;
    if (dropdown) {
      dropdown.value = 'procedural-turret';
    }
    
    // Load the model
    setTimeout(() => {
      this.loadModel().then(() => {
        // After model loads, auto-start aim test with sine wave
        setTimeout(() => {
          // Set aim mode to look-at
          const aimMode = this.elements['aim-mode'] as HTMLSelectElement;
          if (aimMode) {
            aimMode.value = 'look-at';
            this.updateAimMode();
          }
          
          // Place target and start test
          this.placeTarget();
          this.startAimTest();
          
          // Enable auto-rotate for sine wave motion
          this.autoRotateTarget = true;
          const autoRotateCheckbox = this.elements['auto-rotate-target'] as HTMLInputElement;
          if (autoRotateCheckbox) {
            autoRotateCheckbox.checked = true;
          }
        }, 500);
      });
    }, 100);
  }

  private animate(): void {
    requestAnimationFrame(this.animate.bind(this));

    const deltaTime = this.clock.getDelta();

    // Update controls
    this.controls.update();

    // Update target with sine wave motion (both horizontal circle and vertical sine)
    if (this.autoRotateTarget && this.targetMesh) {
      const time = this.clock.getElapsedTime();
      const radius = 15;
      
      // Circular motion in X-Z plane
      this.targetMesh.position.x = Math.cos(time * this.targetSpeed) * radius;
      this.targetMesh.position.z = Math.sin(time * this.targetSpeed) * radius;
      
      // Add sine wave motion in Y (vertical)
      const baseHeight = 5;
      const waveAmplitude = 8; // How high/low the target moves
      const waveFrequency = 2; // How fast it moves up/down
      this.targetMesh.position.y = baseHeight + Math.sin(time * waveFrequency) * waveAmplitude;
    }

    // Update procedural turret animations
    if (this.proceduralTurret) {
      this.proceduralTurret.update();
    }

    // Update aiming if test is running
    if (this.isAimTestRunning && this.targetMesh && this.currentModel) {
      // Check if we're using the procedural turret
      if (this.proceduralTurret) {
        // Use the built-in aiming method
        this.proceduralTurret.aimAt(this.targetMesh.position);
      } else {
        // Use the aim controller for GLTF models
        this.aimController.updateAim(this.currentModel, this.targetMesh.position, deltaTime);
      }
      
      // Update debug visualization
      this.rotationDebugHelper.updateModelRotation(this.currentModel, this.targetMesh.position);
      
      // Update aim info display
      const aimInfo = this.aimController.getAimInfo();
      if (aimInfo) {
        if (this.elements['target-name']) {
          this.elements['target-name'].textContent = 'Target Sphere';
        }
        if (this.elements['aim-angle']) {
          this.elements['aim-angle'].textContent = `${aimInfo.angle.toFixed(1)}°`;
        }
        if (this.elements['target-distance']) {
          this.elements['target-distance'].textContent = `${aimInfo.distance.toFixed(1)}m`;
        }
      }
    }

    // Update FPS counter
    if (this.elements['fps-counter']) {
      const fps = 1 / deltaTime;
      this.elements['fps-counter'].textContent = `FPS: ${Math.round(fps)}`;
    }

    // Render
    this.renderer.render(this.scene, this.camera);
  }
}

// Initialize the app
new RiggerApp();