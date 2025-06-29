import * as THREE from 'three';
import { TubePosition } from './TubeEditor';

export class TubeVisualizer {
  private scene: THREE.Scene;
  private tubeMarkers: Map<number, THREE.Group> = new Map();
  private previewLine: THREE.Line | null = null;
  private activeTubeIndex: number = -1;
  private previewMode: boolean = false;
  private showLabels: boolean = true;

  // Visual elements for each tube
  private startMarkers: Map<number, THREE.Mesh> = new Map();
  private endMarkers: Map<number, THREE.Mesh> = new Map();
  private tubeLines: Map<number, THREE.Line> = new Map();
  private directionArrows: Map<number, THREE.ArrowHelper> = new Map();
  private xMarkers: Map<number, THREE.Group> = new Map();
  private smokePreview: THREE.Group | null = null;
  private labelSprites: Map<number, { start: THREE.Sprite; end: THREE.Sprite }> = new Map();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.createPreviewLine();
    this.createSmokePreview();
  }

  private createPreviewLine(): void {
    const geometry = new THREE.BufferGeometry();
    const material = new THREE.LineBasicMaterial({
      color: 0xffff00,
      linewidth: 2,
      opacity: 0.5,
      transparent: true,
    });

    this.previewLine = new THREE.Line(geometry, material);
    this.previewLine.visible = false;
    this.scene.add(this.previewLine);
  }

  private createSmokePreview(): void {
    this.smokePreview = new THREE.Group();

    // Create simple smoke particles preview
    const particleCount = 5;
    for (let i = 0; i < particleCount; i++) {
      const geometry = new THREE.SphereGeometry(0.3 + i * 0.1, 8, 8);
      const material = new THREE.MeshBasicMaterial({
        color: 0x888888,
        transparent: true,
        opacity: 0.3 - i * 0.05,
      });

      const particle = new THREE.Mesh(geometry, material);
      particle.position.y = i * 0.5;
      this.smokePreview.add(particle);
    }

    this.smokePreview.visible = false;
    this.scene.add(this.smokePreview);
  }

  public updateTube(tube: TubePosition): void {
    const group = this.getOrCreateTubeGroup(tube.id);

    // Clear existing visuals
    this.clearTubeVisuals(tube.id);

    if (tube.start) {
      // Create start marker
      const startMarker = this.createMarker(0x00ff00, 0.3);
      startMarker.position.copy(tube.start);
      group.add(startMarker);
      this.startMarkers.set(tube.id, startMarker);

      // Add label
      const startLabel = this.createTextSprite(`${tube.id + 1}S`, 0x00ff00);
      startLabel.position.copy(tube.start);
      startLabel.position.y += 1;
      startLabel.visible = this.showLabels;
      group.add(startLabel);

      if (tube.end) {
        // Create end marker
        const endMarker = this.createMarker(0xff0000, 0.3);
        endMarker.position.copy(tube.end);
        group.add(endMarker);
        this.endMarkers.set(tube.id, endMarker);

        // Add label
        const endLabel = this.createTextSprite(`${tube.id + 1}E`, 0xff0000);
        endLabel.position.copy(tube.end);
        endLabel.position.y += 1;
        endLabel.visible = this.showLabels;
        group.add(endLabel);

        // Store label references
        this.labelSprites.set(tube.id, { start: startLabel, end: endLabel });

        // Create tube line
        const lineGeometry = new THREE.BufferGeometry().setFromPoints([tube.start, tube.end]);
        const lineMaterial = new THREE.LineBasicMaterial({
          color: 0x00ffff,
          linewidth: 2,
        });
        const line = new THREE.Line(lineGeometry, lineMaterial);
        group.add(line);
        this.tubeLines.set(tube.id, line);

        // Create direction arrow
        if (tube.direction) {
          const arrowHelper = new THREE.ArrowHelper(
            tube.direction,
            tube.end,
            2,
            0xffff00,
            0.8,
            0.4
          );
          group.add(arrowHelper);
          this.directionArrows.set(tube.id, arrowHelper);
        }

        // Create X marker at start position (for empty tube visualization)
        const xMarker = this.createXMarker(tube.direction);
        xMarker.position.copy(tube.start);
        xMarker.visible = this.previewMode;
        group.add(xMarker);
        this.xMarkers.set(tube.id, xMarker);
      }
    }
  }

  private createMarker(color: number, size: number): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(size, 16, 16);
    const material = new THREE.MeshBasicMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.5,
    });
    return new THREE.Mesh(geometry, material);
  }

  private createXMarker(direction: THREE.Vector3 | null): THREE.Group {
    const group = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });

    // Create two crossing lines for X
    const thickness = 0.05;
    const length = 0.8;

    const bar1 = new THREE.Mesh(new THREE.BoxGeometry(length, thickness, thickness), material);
    bar1.rotation.z = Math.PI / 4;

    const bar2 = new THREE.Mesh(new THREE.BoxGeometry(length, thickness, thickness), material);
    bar2.rotation.z = -Math.PI / 4;

    group.add(bar1);
    group.add(bar2);

    // Orient the X to be perpendicular to the tube direction (flat against the tube opening)
    if (direction) {
      // The X should be oriented so that it's flat against the tube opening
      // This means the X plane should be perpendicular to the tube direction

      // Create a rotation that aligns the Z axis (normal to the X plane) with the tube direction
      const normalizedDirection = direction.clone().normalize();
      const defaultNormal = new THREE.Vector3(0, 0, 1); // Default normal of the X plane

      // Calculate the rotation needed to align the default normal with the tube direction
      const quaternion = new THREE.Quaternion();
      quaternion.setFromUnitVectors(defaultNormal, normalizedDirection);

      group.quaternion.copy(quaternion);
    }

    return group;
  }

  private createTextSprite(text: string, color: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;

    const context = canvas.getContext('2d')!;
    context.font = 'Bold 40px Arial';
    context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, 64, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture,
      sizeAttenuation: false,
    });

    const sprite = new THREE.Sprite(material);
    sprite.scale.set(0.5, 0.25, 1);

    return sprite;
  }

  private getOrCreateTubeGroup(id: number): THREE.Group {
    let group = this.tubeMarkers.get(id);
    if (!group) {
      group = new THREE.Group();
      group.name = `tube-${id}`;
      this.scene.add(group);
      this.tubeMarkers.set(id, group);
    }
    return group;
  }

  private clearTubeVisuals(id: number): void {
    const group = this.tubeMarkers.get(id);
    if (group) {
      // Remove all children
      while (group.children.length > 0) {
        const child = group.children[0];
        group.remove(child);

        // Dispose of geometries and materials
        if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach(m => m.dispose());
            } else {
              child.material.dispose();
            }
          }
        }
      }
    }

    // Clear references
    this.startMarkers.delete(id);
    this.endMarkers.delete(id);
    this.tubeLines.delete(id);
    this.directionArrows.delete(id);
    this.xMarkers.delete(id);
    this.labelSprites.delete(id);
  }

  public showPreview(start: THREE.Vector3, end: THREE.Vector3): void {
    if (!this.previewLine) return;

    const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    this.previewLine.geometry.dispose();
    this.previewLine.geometry = geometry;
    this.previewLine.visible = true;

    // Show smoke preview at end position
    if (this.smokePreview && this.previewMode) {
      this.smokePreview.position.copy(end);
      this.smokePreview.visible = true;
    }
  }

  public hidePreview(): void {
    if (this.previewLine) {
      this.previewLine.visible = false;
    }
    if (this.smokePreview) {
      this.smokePreview.visible = false;
    }
  }

  public setActiveTube(index: number): void {
    this.activeTubeIndex = index;

    // Highlight active tube
    this.tubeMarkers.forEach((group, id) => {
      const isActive = id === index;
      group.traverse(child => {
        if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
          if ('emissiveIntensity' in child.material) {
            (child.material as any).emissiveIntensity = isActive ? 1 : 0.5;
          }
          if ('opacity' in child.material) {
            (child.material as any).opacity = isActive ? 1 : 0.7;
          }
        }
      });
    });
  }

  public setPreviewMode(enabled: boolean): void {
    this.previewMode = enabled;

    // Toggle X markers visibility
    this.xMarkers.forEach(marker => {
      marker.visible = enabled;
    });

    // Toggle smoke preview
    if (this.smokePreview) {
      this.smokePreview.visible = enabled && this.previewLine?.visible;
    }
  }

  public update(): void {
    // Animate smoke preview
    if (this.smokePreview && this.smokePreview.visible) {
      this.smokePreview.rotation.y += 0.01;

      // Animate particles
      this.smokePreview.children.forEach((child, i) => {
        if (child instanceof THREE.Mesh) {
          child.scale.setScalar(1 + Math.sin(Date.now() * 0.001 + i) * 0.1);
        }
      });
    }

    // Pulse active markers
    if (this.activeTubeIndex >= 0) {
      const startMarker = this.startMarkers.get(this.activeTubeIndex);
      const endMarker = this.endMarkers.get(this.activeTubeIndex);

      const scale = 1 + Math.sin(Date.now() * 0.005) * 0.2;

      if (startMarker) {
        startMarker.scale.setScalar(scale);
      }
      if (endMarker) {
        endMarker.scale.setScalar(scale);
      }
    }
  }

  public setShowLabels(show: boolean): void {
    this.showLabels = show;

    // Update all label visibility
    this.tubeMarkers.forEach(group => {
      group.traverse(child => {
        if (child instanceof THREE.Sprite) {
          child.visible = show;
        }
      });
    });
  }

  public updateTubeLabel(tubeId: number, customLabel: string): void {
    const group = this.tubeMarkers.get(tubeId);
    if (!group) return;

    // Find and update the start label sprite
    const labels = this.labelSprites.get(tubeId);
    if (labels && labels.start) {
      // Update the texture with new text
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 64;

      const context = canvas.getContext('2d')!;
      context.font = 'Bold 32px Arial';
      context.fillStyle = '#00ff00';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillText(customLabel, 128, 32);

      const texture = new THREE.CanvasTexture(canvas);
      labels.start.material.map = texture;
      labels.start.material.needsUpdate = true;
    }
  }
}
