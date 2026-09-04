import * as THREE from 'three';

/** Gameplay state shared by both city renderers. Position is the center of the base. */
export interface BuildingState {
  id: string;
  position: THREE.Vector3;
  width: number;
  height: number;
  depth: number;
  bounds: THREE.Box3;
  health: number;
  maxHealth: number;
  isDestroyed: boolean;
}

export function createBuildingState(
  id: string,
  position: THREE.Vector3,
  width: number,
  height: number,
  depth: number
): BuildingState {
  if (
    ![position.x, position.y, position.z, width, height, depth].every(Number.isFinite) ||
    Math.min(width, height, depth) <= 0
  )
    throw new RangeError('Invalid building dimensions');
  return {
    id,
    position: position.clone(),
    width,
    height,
    depth,
    health: 100,
    maxHealth: 100,
    isDestroyed: false,
    bounds: new THREE.Box3(
      new THREE.Vector3(position.x - width / 2, position.y, position.z - depth / 2),
      new THREE.Vector3(position.x + width / 2, position.y + height, position.z + depth / 2)
    ),
  };
}
