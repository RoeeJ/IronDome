import * as THREE from 'three';

export interface Bone {
  name: string;
  position: THREE.Vector3;
  parent?: Bone;
  children: Bone[];
  object?: THREE.Object3D;
}

export interface RigData {
  bones: Bone[];
  root: Bone;
}

export class BoneVisualizer {
  private scene: THREE.Scene;
  private boneGroup: THREE.Group;
  private boneMeshes: Map<string, THREE.Mesh> = new Map();
  private connectionLines: Map<string, THREE.Line> = new Map();
  private visible: boolean = true;

  private boneMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ff00,
    transparent: true,
    opacity: 0.8
  });

  private lineMaterial = new THREE.LineBasicMaterial({
    color: 0x00ff00,
    transparent: true,
    opacity: 0.5
  });

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.boneGroup = new THREE.Group();
    this.boneGroup.name = 'bone-visualization';
    this.scene.add(this.boneGroup);
  }

  visualizeRig(rigData: RigData): void {
    this.clear();

    // Visualize each bone
    rigData.bones.forEach(bone => {
      this.visualizeBone(bone);
    });

    // Create connections between bones
    rigData.bones.forEach(bone => {
      if (bone.parent) {
        this.createBoneConnection(bone, bone.parent);
      }
    });
  }

  private visualizeBone(bone: Bone): void {
    // Create a small sphere for the bone joint
    const geometry = new THREE.SphereGeometry(0.2, 8, 6);
    const mesh = new THREE.Mesh(geometry, this.boneMaterial);
    
    // Position the bone visualization
    if (bone.object) {
      // Get world position of the bone's object
      const worldPos = new THREE.Vector3();
      bone.object.getWorldPosition(worldPos);
      mesh.position.copy(worldPos);
    } else {
      mesh.position.copy(bone.position);
    }

    mesh.name = `bone-${bone.name}`;
    this.boneGroup.add(mesh);
    this.boneMeshes.set(bone.name, mesh);

    // Add label
    this.createBoneLabel(bone.name, mesh.position);
  }

  private createBoneConnection(child: Bone, parent: Bone): void {
    const childMesh = this.boneMeshes.get(child.name);
    const parentMesh = this.boneMeshes.get(parent.name);

    if (!childMesh || !parentMesh) return;

    const points = [
      parentMesh.position.clone(),
      childMesh.position.clone()
    ];

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, this.lineMaterial);
    line.name = `connection-${parent.name}-${child.name}`;

    this.boneGroup.add(line);
    this.connectionLines.set(`${parent.name}-${child.name}`, line);
  }

  private createBoneLabel(text: string, position: THREE.Vector3): void {
    // For now, we'll skip text labels as they require additional setup
    // In a full implementation, you'd use CSS2DRenderer or sprites
  }

  updateBonePositions(rigData: RigData): void {
    rigData.bones.forEach(bone => {
      const mesh = this.boneMeshes.get(bone.name);
      if (mesh && bone.object) {
        const worldPos = new THREE.Vector3();
        bone.object.getWorldPosition(worldPos);
        mesh.position.copy(worldPos);
      }
    });

    // Update connection lines
    this.connectionLines.forEach((line, key) => {
      const [parentName, childName] = key.split('-');
      const parentMesh = this.boneMeshes.get(parentName);
      const childMesh = this.boneMeshes.get(childName);

      if (parentMesh && childMesh) {
        const positions = line.geometry.attributes.position as THREE.BufferAttribute;
        positions.setXYZ(0, parentMesh.position.x, parentMesh.position.y, parentMesh.position.z);
        positions.setXYZ(1, childMesh.position.x, childMesh.position.y, childMesh.position.z);
        positions.needsUpdate = true;
      }
    });
  }

  toggleVisibility(): void {
    this.visible = !this.visible;
    this.boneGroup.visible = this.visible;
  }

  setVisibility(visible: boolean): void {
    this.visible = visible;
    this.boneGroup.visible = visible;
  }

  highlightBone(boneName: string, highlight: boolean = true): void {
    const mesh = this.boneMeshes.get(boneName);
    if (mesh) {
      mesh.material = highlight
        ? new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 1 })
        : this.boneMaterial;
    }
  }

  clear(): void {
    // Remove all bone meshes
    this.boneMeshes.forEach(mesh => {
      this.boneGroup.remove(mesh);
      mesh.geometry.dispose();
    });
    this.boneMeshes.clear();

    // Remove all connection lines
    this.connectionLines.forEach(line => {
      this.boneGroup.remove(line);
      line.geometry.dispose();
    });
    this.connectionLines.clear();
  }

  dispose(): void {
    this.clear();
    this.boneMaterial.dispose();
    this.lineMaterial.dispose();
    this.scene.remove(this.boneGroup);
  }
}