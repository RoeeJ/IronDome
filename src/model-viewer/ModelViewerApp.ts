import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ModelLoader } from './ModelLoader';
import { ModelInfo } from './ModelInfo';
import { ViewerControls } from './ViewerControls';

interface ModelConfig {
  id: string;
  name: string;
  path: string;
  type: 'obj' | 'gltf' | 'glb';
  scale?: number;
}

export class ModelViewerApp {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private modelLoader: ModelLoader;
  private modelInfo: ModelInfo;
  private viewerControls: ViewerControls;
  
  private currentModel?: THREE.Object3D;
  private currentModelConfig?: ModelConfig;
  private autoRotate = false;
  private clock = new THREE.Clock();
  private orbitRadius = 8;
  private orbitHeight = 5;
  
  private models: ModelConfig[] = [
    { id: 'battery', name: 'Iron Dome Battery', path: '/assets/Battery.obj', type: 'obj', scale: 0.01 },
    { id: 'radar', name: 'Radar System', path: '/assets/Radar.obj', type: 'obj', scale: 0.01 },
    { id: 'tamir-original', name: 'Tamir Original', path: '/assets/tamir/scene.gltf', type: 'gltf' },
    { id: 'tamir-optimized', name: 'Tamir Optimized', path: '/assets/tamir/scene_optimized.glb', type: 'glb' },
    { id: 'tamir-simple', name: 'Tamir Simple', path: '/assets/tamir/scene_simple.glb', type: 'glb' },
    { id: 'tamir-ultra', name: 'Tamir Ultra Simple', path: '/assets/tamir/scene_ultra_simple.glb', type: 'glb' },
    { id: 'arrow-1', name: 'Arrow-3 System', path: '/assets/arrow/israels_arrow-3_missile_defense_system.glb', type: 'glb' },
    { id: 'arrow-2', name: 'Arrow-3 Alt', path: '/assets/arrow/israels_arrow-3_missile_defense_system (1).glb', type: 'glb' }
  ];
  
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0a0a);
    
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    this.renderer = new THREE.WebGLRenderer({ 
      canvas, 
      antialias: true,
      alpha: true 
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth - 280, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    this.camera = new THREE.PerspectiveCamera(
      45, 
      (window.innerWidth - 280) / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(5, 3, 5);
    
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.screenSpacePanning = false;
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 50;
    
    this.modelLoader = new ModelLoader();
    this.modelInfo = new ModelInfo();
    this.viewerControls = new ViewerControls(this.scene, this.camera, this.renderer);
    
    this.setupLighting();
    this.setupHelpers();
    this.setupEventListeners();
    this.hideLoading();
    
    this.animate();
  }
  
  private setupLighting(): void {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 5);
    directionalLight.castShadow = true;
    directionalLight.shadow.camera.far = 50;
    directionalLight.shadow.camera.left = -10;
    directionalLight.shadow.camera.right = 10;
    directionalLight.shadow.camera.top = 10;
    directionalLight.shadow.camera.bottom = -10;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    this.scene.add(directionalLight);
    
    const fillLight = new THREE.DirectionalLight(0x4488ff, 0.3);
    fillLight.position.set(-5, 3, -5);
    this.scene.add(fillLight);
  }
  
  private setupHelpers(): void {
    const gridHelper = new THREE.GridHelper(10, 10, 0x444444, 0x222222);
    this.scene.add(gridHelper);
    
    const axesHelper = new THREE.AxesHelper(1);
    axesHelper.visible = false;
    this.scene.add(axesHelper);
  }
  
  private setupEventListeners(): void {
    window.addEventListener('resize', this.onWindowResize.bind(this));
    
    document.querySelectorAll('.model-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const modelId = (e.currentTarget as HTMLElement).dataset.model;
        if (modelId) {
          this.loadModel(modelId);
          document.querySelectorAll('.model-item').forEach(el => el.classList.remove('active'));
          (e.currentTarget as HTMLElement).classList.add('active');
        }
      });
    });
    
    document.getElementById('btn-wireframe')?.addEventListener('click', () => {
      this.viewerControls.toggleWireframe();
    });
    
    document.getElementById('btn-normals')?.addEventListener('click', () => {
      this.viewerControls.toggleNormals();
    });
    
    document.getElementById('btn-bounds')?.addEventListener('click', () => {
      this.viewerControls.toggleBounds();
    });
    
    document.getElementById('btn-rotate')?.addEventListener('click', (e) => {
      this.autoRotate = !this.autoRotate;
      (e.target as HTMLElement).classList.toggle('active');
      
      // Disable orbit controls during auto-rotate
      this.controls.enabled = !this.autoRotate;
    });
    
    document.getElementById('light-intensity')?.addEventListener('input', (e) => {
      const value = parseInt((e.target as HTMLInputElement).value) / 100;
      this.scene.traverse(child => {
        if (child instanceof THREE.Light && child.type === 'DirectionalLight') {
          child.intensity = child.position.y > 5 ? 0.8 * value : 0.3 * value;
        } else if (child instanceof THREE.AmbientLight) {
          child.intensity = 0.6 * value;
        }
      });
    });
    
    document.getElementById('btn-screenshot')?.addEventListener('click', () => {
      this.takeScreenshot();
    });
    
    document.getElementById('btn-fullscreen')?.addEventListener('click', () => {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        document.getElementById('viewport')?.requestFullscreen();
      }
    });
    
    document.addEventListener('keydown', (e) => {
      if (e.key === 'h' || e.key === 'H') {
        const infoPanel = document.getElementById('info-panel');
        if (infoPanel) {
          infoPanel.style.display = infoPanel.style.display === 'none' ? 'block' : 'none';
        }
      }
    });
  }
  
  private async loadModel(modelId: string): Promise<void> {
    const config = this.models.find(m => m.id === modelId);
    if (!config) return;
    
    this.showLoading();
    
    try {
      if (this.currentModel) {
        this.scene.remove(this.currentModel);
        this.viewerControls.clearHelpers();
        this.disposeObject(this.currentModel);
      }
      
      const model = await this.modelLoader.load(config.path, config.type);
      
      // First, get the original bounds
      const originalBox = new THREE.Box3().setFromObject(model);
      const originalCenter = originalBox.getCenter(new THREE.Vector3());
      const originalSize = originalBox.getSize(new THREE.Vector3());
      
      // Apply config scale if specified
      if (config.scale) {
        model.scale.setScalar(config.scale);
        // Recalculate size after config scale
        const scaledBox = new THREE.Box3().setFromObject(model);
        const scaledSize = scaledBox.getSize(new THREE.Vector3());
        
        // Then apply our standard scaling based on scaled size
        const maxDim = Math.max(scaledSize.x, scaledSize.y, scaledSize.z);
        const targetSize = 3;
        const additionalScale = targetSize / maxDim;
        model.scale.multiplyScalar(additionalScale);
      } else {
        // No config scale, just apply standard scaling
        const maxDim = Math.max(originalSize.x, originalSize.y, originalSize.z);
        const targetSize = 3;
        const scale = targetSize / maxDim;
        model.scale.setScalar(scale);
      }
      
      // Now position the model at origin
      // We need to account for the total scaling when setting position
      const totalScale = model.scale.x; // Assuming uniform scale
      model.position.set(
        -originalCenter.x * totalScale,
        -originalCenter.y * totalScale,
        -originalCenter.z * totalScale
      );
      
      // Finally, adjust Y so the bottom sits on the grid
      const finalBox = new THREE.Box3().setFromObject(model);
      model.position.y += -finalBox.min.y;
      
      this.currentModel = model;
      this.currentModelConfig = config;
      this.scene.add(model);
      
      const info = this.modelInfo.analyze(model);
      this.updateStats(info);
      
      // Recalculate bounds after final positioning
      finalBox.setFromObject(model); // Reuse existing finalBox
      const finalSize = finalBox.getSize(new THREE.Vector3());
      const finalCenter = finalBox.getCenter(new THREE.Vector3());
      
      // Set camera to view the model nicely
      const distance = Math.max(finalSize.x, finalSize.y, finalSize.z) * 2.5;
      this.orbitRadius = distance;
      this.orbitHeight = distance * 0.6;
      
      this.camera.position.set(distance * 0.8, this.orbitHeight, distance * 0.8);
      this.camera.lookAt(finalCenter);
      this.controls.target.copy(finalCenter);
      this.controls.update();
      
      this.viewerControls.setModel(model);
      
    } catch (error) {
      console.error('Failed to load model:', error);
      alert(`Failed to load model: ${config.name}`);
    } finally {
      this.hideLoading();
    }
  }
  
  private updateStats(info: any): void {
    document.getElementById('stat-vertices')!.textContent = info.vertices.toLocaleString();
    document.getElementById('stat-faces')!.textContent = info.faces.toLocaleString();
    document.getElementById('stat-draws')!.textContent = info.drawCalls.toString();
    document.getElementById('stat-textures')!.textContent = info.textures.toString();
    document.getElementById('stat-materials')!.textContent = info.materials.toString();
    document.getElementById('stat-size')!.textContent = info.memoryEstimate;
  }
  
  private showLoading(): void {
    const loading = document.getElementById('loading');
    if (loading) loading.style.display = 'block';
  }
  
  private hideLoading(): void {
    const loading = document.getElementById('loading');
    if (loading) loading.style.display = 'none';
  }
  
  private takeScreenshot(): void {
    this.renderer.render(this.scene, this.camera);
    const dataURL = this.renderer.domElement.toDataURL('image/png');
    
    const link = document.createElement('a');
    link.download = `model-${this.currentModelConfig?.id || 'screenshot'}-${Date.now()}.png`;
    link.href = dataURL;
    link.click();
  }
  
  private disposeObject(object: THREE.Object3D): void {
    object.traverse(child => {
      if (child instanceof THREE.Mesh) {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(mat => mat.dispose());
          } else {
            child.material.dispose();
          }
        }
      }
    });
  }
  
  private onWindowResize(): void {
    const width = window.innerWidth - 280;
    const height = window.innerHeight;
    
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }
  
  private animate(): void {
    requestAnimationFrame(this.animate.bind(this));
    
    this.controls.update();
    
    if (this.autoRotate) {
      // Orbit camera around the target instead of rotating the model
      const time = Date.now() * 0.001;
      
      this.camera.position.x = Math.cos(time * 0.5) * this.orbitRadius;
      this.camera.position.z = Math.sin(time * 0.5) * this.orbitRadius;
      this.camera.position.y = this.orbitHeight;
      
      this.camera.lookAt(this.controls.target);
    }
    
    this.viewerControls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

new ModelViewerApp();