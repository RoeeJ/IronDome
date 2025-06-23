import * as THREE from 'three';
import { GeometryFactory } from '../utils/GeometryFactory';
import { MaterialCache } from '../utils/MaterialCache';

export interface RadarConfig {
  position: THREE.Vector3;
  range: number;
  sweepSpeed: number; // radians per second
  coneAngle: number; // degrees
  color: number;
}

export class RadarSystem {
  private scene: THREE.Scene;
  private config: RadarConfig;
  private sweepAngle: number = 0;
  private radarGroup: THREE.Group;
  private sweepMesh: THREE.Mesh;
  private rangeRing: THREE.Line;
  private detectedObjects: Set<THREE.Object3D> = new Set();

  constructor(scene: THREE.Scene, config: Partial<RadarConfig> = {}) {
    this.scene = scene;
    this.config = {
      position: new THREE.Vector3(0, 0, 0),
      range: 70,
      sweepSpeed: Math.PI / 2, // 90 degrees per second
      coneAngle: 30,
      color: 0x00ff00,
      ...config,
    };

    this.radarGroup = new THREE.Group();
    this.radarGroup.position.copy(this.config.position);

    this.createRadarVisuals();
    this.scene.add(this.radarGroup);
  }

  private createRadarVisuals(): void {
    // Create range ring at base
    const ringPoints = [];
    const segments = 64;
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      ringPoints.push(
        new THREE.Vector3(
          Math.cos(angle) * this.config.range,
          0.2,
          Math.sin(angle) * this.config.range
        )
      );
    }

    const ringGeometry = new THREE.BufferGeometry().setFromPoints(ringPoints);
    const ringMaterial = MaterialCache.getInstance().getLineBasicMaterial({
      color: this.config.color,
      opacity: 0.3,
      transparent: true,
    });
    this.rangeRing = new THREE.Line(ringGeometry, ringMaterial);
    this.radarGroup.add(this.rangeRing);

    // Create dome wireframe to show 3D coverage
    const domeGeometry = GeometryFactory.getInstance().getSphere(
      this.config.range,
      16, // width segments
      8, // height segments
      0, // phiStart
      Math.PI * 2, // phiLength
      0, // thetaStart
      Math.PI / 3 // thetaLength (60 degrees for partial dome)
    );

    const domeMaterial = MaterialCache.getInstance().getMeshBasicMaterial({
      color: this.config.color,
      opacity: 0.1,
      transparent: true,
      wireframe: true,
    });

    const dome = new THREE.Mesh(domeGeometry, domeMaterial);
    this.radarGroup.add(dome);

    // Create 3D sweep wedge
    const coneAngleRad = (this.config.coneAngle * Math.PI) / 180;
    const sweepHeight = this.config.range * 0.6; // Height of sweep wedge

    // Create a custom geometry for the sweep wedge
    const sweepGeometry = GeometryFactory.getInstance().getCone(
      this.config.range,
      sweepHeight,
      32,
      1,
      true,
      -coneAngleRad / 2,
      coneAngleRad
    );

    const sweepMaterial = MaterialCache.getInstance().getMeshBasicMaterial({
      color: this.config.color,
      opacity: 0.25,
      transparent: true,
      side: THREE.DoubleSide,
    });

    this.sweepMesh = new THREE.Mesh(sweepGeometry, sweepMaterial);
    this.sweepMesh.position.y = sweepHeight / 2; // Position wedge above ground
    this.sweepMesh.rotation.x = Math.PI; // Point downward
    this.radarGroup.add(this.sweepMesh);

    // Add sweep line (bright edge of radar beam)
    const lineGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(this.config.range, 0, 0),
    ]);

    const lineMaterial = MaterialCache.getInstance().getLineBasicMaterial({
      color: this.config.color,
      linewidth: 3,
      opacity: 1.0,
      transparent: true,
    });

    const sweepLine = new THREE.Line(lineGeometry, lineMaterial);
    sweepLine.position.y = 0.1; // Slightly above the sweep mesh
    this.sweepMesh.add(sweepLine);

    // Add radar glow effect
    this.createRadarGlow();
  }

  private createRadarGlow(): void {
    // Center glow
    const glowGeometry = GeometryFactory.getInstance().getSphere(2, 16, 8);
    const glowMaterial = MaterialCache.getInstance().getMeshBasicMaterial({
      color: this.config.color,
      opacity: 0.5,
      transparent: true,
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    glow.position.y = 1;
    this.radarGroup.add(glow);

    // Pulsing point light
    const light = new THREE.PointLight(this.config.color, 0.5, this.config.range * 0.5);
    light.position.y = 5;
    this.radarGroup.add(light);
  }

  update(deltaTime: number, threats: THREE.Object3D[]): THREE.Object3D[] {
    // Update sweep angle
    this.sweepAngle += this.config.sweepSpeed * deltaTime;
    if (this.sweepAngle > Math.PI * 2) {
      this.sweepAngle -= Math.PI * 2;
    }

    // Rotate entire radar group around Y axis for horizontal sweep
    this.radarGroup.rotation.y = this.sweepAngle;

    // Detect threats in radar cone
    const detected: THREE.Object3D[] = [];
    const coneAngleRad = (this.config.coneAngle * Math.PI) / 180;

    threats.forEach(threat => {
      const relativePos = threat.position.clone().sub(this.config.position);
      const distance = relativePos.length();

      // Check if within range
      if (distance > this.config.range) return;

      // Check if within sweep angle
      const angle = Math.atan2(relativePos.z, relativePos.x);
      let angleDiff = Math.abs(angle - this.sweepAngle);
      if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;

      if (angleDiff < coneAngleRad / 2) {
        detected.push(threat);
        this.onDetection(threat, relativePos);
      }
    });

    // Update detected objects set
    this.detectedObjects = new Set(detected);

    return detected;
  }

  private onDetection(threat: THREE.Object3D, relativePos: THREE.Vector3): void {
    // Create ping effect at detection point
    const pingGeometry = GeometryFactory.getInstance().getRing(0.5, 2, 16);
    const pingMaterial = new THREE.MeshBasicMaterial({
      color: 0xffff00,
      opacity: 0.8,
      transparent: true,
      side: THREE.DoubleSide,
    });

    const ping = new THREE.Mesh(pingGeometry, pingMaterial);
    ping.rotation.x = -Math.PI / 2;
    ping.position.copy(threat.position);
    ping.position.y = 0.5;
    this.scene.add(ping);

    // Animate ping
    const startTime = Date.now();
    const duration = 1000;

    const animatePing = () => {
      const elapsed = Date.now() - startTime;
      const progress = elapsed / duration;

      if (progress >= 1) {
        this.scene.remove(ping);
        ping.geometry.dispose();
        pingMaterial.dispose();
        return;
      }

      const scale = 1 + progress * 2;
      ping.scale.set(scale, scale, scale);
      pingMaterial.opacity = 0.8 * (1 - progress);

      requestAnimationFrame(animatePing);
    };

    animatePing();
  }

  isDetected(object: THREE.Object3D): boolean {
    return this.detectedObjects.has(object);
  }

  setPosition(position: THREE.Vector3): void {
    this.config.position = position;
    this.radarGroup.position.copy(position);
  }

  setSweepSpeed(speed: number): void {
    this.config.sweepSpeed = speed;
  }
}
