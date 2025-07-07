import * as THREE from 'three';

export class RotationDebugHelper {
  private scene: THREE.Scene;
  private debugGroup: THREE.Group;
  private arrowHelpers: Map<string, THREE.ArrowHelper> = new Map();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.debugGroup = new THREE.Group();
    this.debugGroup.name = 'rotation-debug';
    this.scene.add(this.debugGroup);
  }

  addRotationArrow(
    name: string,
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    color: number = 0xff0000,
    length: number = 10
  ): void {
    // Remove existing arrow if any
    const existing = this.arrowHelpers.get(name);
    if (existing) {
      this.debugGroup.remove(existing);
    }

    const arrow = new THREE.ArrowHelper(
      direction.normalize(),
      origin,
      length,
      color,
      length * 0.3,
      length * 0.2
    );
    arrow.name = name;
    
    this.arrowHelpers.set(name, arrow);
    this.debugGroup.add(arrow);
  }

  updateModelRotation(model: THREE.Object3D, targetPosition: THREE.Vector3): void {
    // Get model world position
    const modelWorldPos = new THREE.Vector3();
    model.getWorldPosition(modelWorldPos);

    // Calculate direction to target
    const direction = new THREE.Vector3().subVectors(targetPosition, modelWorldPos);
    
    // Show the target direction
    this.addRotationArrow('target-direction', modelWorldPos, direction, 0x00ff00, 15);

    // Show model's current forward direction
    // For the laser cannon, forward is along +X axis
    const modelForward = new THREE.Vector3(1, 0, 0);
    modelForward.applyQuaternion(model.quaternion);
    this.addRotationArrow('model-forward', modelWorldPos, modelForward, 0xff0000, 10);
    
    // Find the barrel and show its pivot point
    const barrel = model.getObjectByName('Cube001');
    if (barrel) {
      const barrelWorldPos = new THREE.Vector3();
      barrel.getWorldPosition(barrelWorldPos);
      
      // Add a sphere at the barrel's pivot point
      if (!this.arrowHelpers.has('barrel-pivot')) {
        const pivotGeometry = new THREE.SphereGeometry(0.5, 16, 16);
        const pivotMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
        const pivotMesh = new THREE.Mesh(pivotGeometry, pivotMaterial);
        pivotMesh.name = 'barrel-pivot-sphere';
        this.debugGroup.add(pivotMesh);
        // Store it so we can update position
        this.arrowHelpers.set('barrel-pivot', pivotMesh as any);
      }
      
      const pivotMesh = this.arrowHelpers.get('barrel-pivot') as any;
      if (pivotMesh) {
        pivotMesh.position.copy(barrelWorldPos);
      }
      
      // Show barrel's forward direction
      const barrelForward = new THREE.Vector3(1, 0, 0);
      barrelForward.applyQuaternion(barrel.getWorldQuaternion(new THREE.Quaternion()));
      this.addRotationArrow('barrel-forward', barrelWorldPos, barrelForward, 0xff8800, 8);
    }

    // Show model's up direction
    const modelUp = new THREE.Vector3(0, 1, 0);
    modelUp.applyQuaternion(model.quaternion);
    this.addRotationArrow('model-up', modelWorldPos, modelUp, 0x0000ff, 10);
  }

  clear(): void {
    this.arrowHelpers.forEach(arrow => {
      this.debugGroup.remove(arrow);
    });
    this.arrowHelpers.clear();
  }

  setVisible(visible: boolean): void {
    this.debugGroup.visible = visible;
  }

  dispose(): void {
    this.clear();
    this.scene.remove(this.debugGroup);
  }
}