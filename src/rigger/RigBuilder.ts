import * as THREE from 'three';
import { Bone, RigData } from './BoneVisualizer';

export class RigBuilder {
  constructor() {}

  createLaserCannonRig(model: THREE.Object3D): RigData {
    const bones: Bone[] = [];
    
    // Create root bone at model position
    const rootBone: Bone = {
      name: 'root',
      position: new THREE.Vector3(0, 0, 0),
      children: [],
      object: model
    };
    bones.push(rootBone);

    // Create base bone (for yaw rotation)
    const baseBone: Bone = {
      name: 'base',
      position: new THREE.Vector3(0, 0, 0),
      parent: rootBone,
      children: [],
      object: model // The entire model rotates for yaw
    };
    rootBone.children.push(baseBone);
    bones.push(baseBone);

    // Find the Cube001 container that holds all barrel parts
    // Note: This model has Cube001 without dot, so no underscore conversion
    let barrelContainer: THREE.Object3D | null = null;
    model.traverse(child => {
      if (child.name === 'Cube001') {
        barrelContainer = child;
      }
    });
    
    if (barrelContainer) {
      // Create barrel bone (for pitch rotation) - this rotates the entire container
      const barrelBone: Bone = {
        name: 'barrel',
        position: new THREE.Vector3(0, 0, 0), // Use container's position
        parent: baseBone,
        children: [],
        object: barrelContainer // This contains all the barrel parts
      };
      baseBone.children.push(barrelBone);
      bones.push(barrelBone);

      // Log what we found
      console.log('Found barrel container:', barrelContainer.name);
      console.log('Barrel container children:', barrelContainer.children.map(c => c.name));
      console.log('Barrel container parent chain:', this.getParentChain(barrelContainer));
    } else {
      // Fallback: try to find individual parts
      console.warn('Cube001 not found, looking for individual parts...');
      
      // Find all the barrel parts
      const barrelParts = [
        'Cube_0', 'Cube_1', 'Cube_2',
        'Cylinder_001_0', 'Cylinder_001_1',
        'Cylinder_002_0', 'Cylinder_002_1',
        'Cylinder_003_0', 'Cylinder_003_1',
        'Cylinder_004_0', 'Cylinder_004_1',
        'Cylinder_005_0', 'Cylinder_006_0'
      ];

      // Create a group to hold all barrel parts
      const barrelGroup = new THREE.Group();
      barrelGroup.name = 'barrel_group';
      
      barrelParts.forEach(partName => {
        const part = model.getObjectByName(partName);
        if (part) {
          console.log(`Found barrel part: ${partName}`);
          // Note: In a real implementation, you'd need to reparent these carefully
        }
      });
    }

    return {
      bones,
      root: rootBone
    };
  }

  private getParentChain(object: THREE.Object3D): string[] {
    const chain: string[] = [];
    let current = object;
    while (current.parent) {
      chain.push(current.parent.name || 'unnamed');
      current = current.parent;
    }
    return chain.reverse();
  }

  createGenericRig(model: THREE.Object3D): RigData {
    const bones: Bone[] = [];
    
    // Create a simple root bone
    const rootBone: Bone = {
      name: 'root',
      position: new THREE.Vector3(0, 0, 0),
      children: [],
      object: model
    };
    bones.push(rootBone);

    // Add bones for each named child
    let boneIndex = 0;
    model.traverse(child => {
      if (child !== model && child.name) {
        const bone: Bone = {
          name: child.name || `bone_${boneIndex++}`,
          position: child.position.clone(),
          parent: rootBone,
          children: [],
          object: child
        };
        rootBone.children.push(bone);
        bones.push(bone);
      }
    });

    return {
      bones,
      root: rootBone
    };
  }

  addBone(rigData: RigData, parentBone: Bone, name: string, position: THREE.Vector3): Bone {
    const newBone: Bone = {
      name,
      position,
      parent: parentBone,
      children: []
    };

    parentBone.children.push(newBone);
    rigData.bones.push(newBone);

    return newBone;
  }

  removeBone(rigData: RigData, bone: Bone): void {
    // Remove from parent's children
    if (bone.parent) {
      const index = bone.parent.children.indexOf(bone);
      if (index > -1) {
        bone.parent.children.splice(index, 1);
      }
    }

    // Remove from bones array
    const boneIndex = rigData.bones.indexOf(bone);
    if (boneIndex > -1) {
      rigData.bones.splice(boneIndex, 1);
    }

    // Reparent children to bone's parent
    bone.children.forEach(child => {
      child.parent = bone.parent;
      if (bone.parent) {
        bone.parent.children.push(child);
      }
    });
  }

  exportRigData(rigData: RigData): string {
    const exportData = {
      bones: rigData.bones.map(bone => ({
        name: bone.name,
        position: {
          x: bone.position.x,
          y: bone.position.y,
          z: bone.position.z
        },
        parent: bone.parent?.name || null,
        objectName: bone.object?.name || null
      }))
    };

    return JSON.stringify(exportData, null, 2);
  }

  importRigData(jsonString: string, model: THREE.Object3D): RigData {
    const importData = JSON.parse(jsonString);
    const bones: Bone[] = [];
    const boneMap = new Map<string, Bone>();

    // First pass: create all bones
    importData.bones.forEach((boneData: any) => {
      const bone: Bone = {
        name: boneData.name,
        position: new THREE.Vector3(boneData.position.x, boneData.position.y, boneData.position.z),
        children: [],
        object: boneData.objectName ? model.getObjectByName(boneData.objectName) : undefined
      };
      bones.push(bone);
      boneMap.set(bone.name, bone);
    });

    // Second pass: establish relationships
    importData.bones.forEach((boneData: any, index: number) => {
      const bone = bones[index];
      if (boneData.parent) {
        const parentBone = boneMap.get(boneData.parent);
        if (parentBone) {
          bone.parent = parentBone;
          parentBone.children.push(bone);
        }
      }
    });

    // Find root bone
    const rootBone = bones.find(bone => !bone.parent) || bones[0];

    return {
      bones,
      root: rootBone
    };
  }
}