import React, { useEffect, useState, useRef } from 'react';
import * as THREE from 'three';

interface InspectorProps {
  scene: THREE.Scene;
  camera: THREE.Camera;
  renderer: THREE.WebGLRenderer;
}

interface ObjectInfo {
  type: string;
  name: string;
  position: { x: number; y: number; z: number };
  material?: {
    type: string;
    color?: string;
    opacity?: number;
    transparent?: boolean;
  };
  geometry?: {
    type: string;
  };
  userData?: any;
  parent?: string;
}

export const Inspector: React.FC<InspectorProps> = ({ scene, camera, renderer }) => {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [objectInfo, setObjectInfo] = useState<ObjectInfo | null>(null);
  const [visible, setVisible] = useState(true);
  const raycaster = useRef(new THREE.Raycaster());
  const mouse = useRef(new THREE.Vector2());

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      // Update mouse position for tooltip
      setMousePos({ x: event.clientX, y: event.clientY });

      // Update normalized mouse coordinates for raycasting
      mouse.current.x = (event.clientX / window.innerWidth) * 2 - 1;
      mouse.current.y = -(event.clientY / window.innerHeight) * 2 + 1;

      // Perform raycasting
      raycaster.current.setFromCamera(mouse.current, camera);
      const intersects = raycaster.current.intersectObjects(scene.children, true);

      if (intersects.length > 0) {
        const object = intersects[0].object;
        const info: ObjectInfo = {
          type: object.type,
          name: object.name || 'Unnamed',
          position: {
            x: object.position.x,
            y: object.position.y,
            z: object.position.z,
          },
        };

        // Add material info if it's a mesh
        if (object instanceof THREE.Mesh && object.material) {
          const mat = object.material as any;
          info.material = {
            type: mat.type,
            color: mat.color ? `#${mat.color.getHexString()}` : undefined,
            opacity: mat.opacity,
            transparent: mat.transparent,
          };
        }

        // Add geometry info
        if (object instanceof THREE.Mesh && object.geometry) {
          info.geometry = {
            type: object.geometry.type,
          };
        }

        // Add userData
        if (object.userData && Object.keys(object.userData).length > 0) {
          info.userData = object.userData;
        }

        // Add parent info
        if (object.parent && object.parent.name) {
          info.parent = object.parent.name;
        }

        setObjectInfo(info);
      } else {
        setObjectInfo(null);
      }
    };

    const handleKeyPress = (event: KeyboardEvent) => {
      if (event.key === 'i' || event.key === 'I') {
        setVisible(prev => !prev);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('keypress', handleKeyPress);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('keypress', handleKeyPress);
    };
  }, [scene, camera]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'fixed',
        left: mousePos.x + 10,
        top: mousePos.y + 10,
        backgroundColor: 'rgba(0, 0, 0, 0.9)',
        color: 'white',
        padding: '10px',
        borderRadius: '5px',
        fontSize: '12px',
        fontFamily: 'monospace',
        pointerEvents: 'none',
        maxWidth: '400px',
        zIndex: 10000,
        border: '1px solid rgba(255, 255, 255, 0.3)',
      }}
    >
      {objectInfo ? (
        <div>
          <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>
            {objectInfo.type}: {objectInfo.name}
          </div>
          <div>
            Position: ({objectInfo.position.x.toFixed(2)}, {objectInfo.position.y.toFixed(2)},{' '}
            {objectInfo.position.z.toFixed(2)})
          </div>

          {objectInfo.material && (
            <div style={{ marginTop: '5px' }}>
              <div style={{ fontWeight: 'bold' }}>Material:</div>
              <div>Type: {objectInfo.material.type}</div>
              {objectInfo.material.color && <div>Color: {objectInfo.material.color}</div>}
              {objectInfo.material.opacity !== undefined && (
                <div>Opacity: {objectInfo.material.opacity.toFixed(2)}</div>
              )}
              {objectInfo.material.transparent !== undefined && (
                <div>Transparent: {objectInfo.material.transparent.toString()}</div>
              )}
            </div>
          )}

          {objectInfo.geometry && (
            <div style={{ marginTop: '5px' }}>
              <div style={{ fontWeight: 'bold' }}>Geometry:</div>
              <div>Type: {objectInfo.geometry.type}</div>
            </div>
          )}

          {objectInfo.userData && (
            <div style={{ marginTop: '5px' }}>
              <div style={{ fontWeight: 'bold' }}>UserData:</div>
              <pre style={{ margin: 0, fontSize: '10px' }}>
                {JSON.stringify(objectInfo.userData, null, 2)}
              </pre>
            </div>
          )}

          {objectInfo.parent && <div style={{ marginTop: '5px' }}>Parent: {objectInfo.parent}</div>}
        </div>
      ) : (
        <div style={{ color: '#888' }}>
          Hover over objects to inspect
          <br />
          Press 'I' to toggle inspector
        </div>
      )}
    </div>
  );
};
