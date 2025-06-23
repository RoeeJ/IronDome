import * as THREE from 'three';
import { MaterialCache } from '../utils/MaterialCache';
import { GeometryFactory } from '../utils/GeometryFactory';
import { debug } from '../utils/DebugLogger';

export enum ZoneType {
  SAFE = 'safe',
  DEFENDED = 'defended',
  CONTESTED = 'contested',
  HOSTILE = 'hostile',
  RESTRICTED = 'restricted',
}

export interface Zone {
  id: string;
  type: ZoneType;
  center: THREE.Vector3;
  radius: number;
  priority: number;
  mesh?: THREE.Mesh;
  border?: THREE.Line;
  label?: THREE.Sprite;
}

export interface ThreatCorridor {
  id: string;
  points: THREE.Vector3[];
  width: number;
  threatFrequency: number;
  active: boolean;
  visualization?: THREE.Group;
}

export class BattlefieldZones {
  private scene: THREE.Scene;
  private zones: Map<string, Zone> = new Map();
  private threatCorridors: Map<string, ThreatCorridor> = new Map();
  private zoneGroup: THREE.Group = new THREE.Group();
  private corridorGroup: THREE.Group = new THREE.Group();
  private borderGroup: THREE.Group = new THREE.Group();

  // Zone colors
  private readonly zoneColors = {
    [ZoneType.SAFE]: { color: 0x00ff00, opacity: 0.1 },
    [ZoneType.DEFENDED]: { color: 0x0088ff, opacity: 0.15 },
    [ZoneType.CONTESTED]: { color: 0xffaa00, opacity: 0.2 },
    [ZoneType.HOSTILE]: { color: 0xff0000, opacity: 0.25 },
    [ZoneType.RESTRICTED]: { color: 0x8800ff, opacity: 0.15 },
  };

  // Battlefield bounds
  private bounds = {
    minX: -1000,
    maxX: 1000,
    minZ: -1000,
    maxZ: 1000,
  };

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.zoneGroup.name = 'BattlefieldZones';
    this.corridorGroup.name = 'ThreatCorridors';
    this.borderGroup.name = 'BattlefieldBorders';
  }

  initialize() {
    // Create default zones
    this.createDefaultZones();

    // Create battlefield borders
    this.createBattlefieldBorders();

    // Create threat corridors
    this.createDefaultThreatCorridors();

    // Add all groups to scene
    this.scene.add(this.zoneGroup);
    this.scene.add(this.corridorGroup);
    this.scene.add(this.borderGroup);

    debug.log('Battlefield zones initialized');
  }

  private createDefaultZones() {
    // Central safe zone (city center)
    this.addZone({
      id: 'city-center',
      type: ZoneType.SAFE,
      center: new THREE.Vector3(0, 0, 0),
      radius: 150,
      priority: 10,
    });

    // Defended zones (residential areas)
    const defendedPositions = [
      { x: 250, z: 0 },
      { x: -250, z: 0 },
      { x: 0, z: 250 },
      { x: 0, z: -250 },
    ];

    defendedPositions.forEach((pos, index) => {
      this.addZone({
        id: `residential-${index}`,
        type: ZoneType.DEFENDED,
        center: new THREE.Vector3(pos.x, 0, pos.z),
        radius: 120,
        priority: 7,
      });
    });

    // Contested zones (border areas)
    const contestedPositions = [
      { x: 400, z: 400 },
      { x: -400, z: 400 },
      { x: 400, z: -400 },
      { x: -400, z: -400 },
    ];

    contestedPositions.forEach((pos, index) => {
      this.addZone({
        id: `contested-${index}`,
        type: ZoneType.CONTESTED,
        center: new THREE.Vector3(pos.x, 0, pos.z),
        radius: 100,
        priority: 5,
      });
    });

    // Hostile zones (enemy launch areas)
    const hostilePositions = [
      { x: 700, z: 700 },
      { x: -700, z: 700 },
      { x: 700, z: -700 },
      { x: -700, z: -700 },
    ];

    hostilePositions.forEach((pos, index) => {
      this.addZone({
        id: `hostile-${index}`,
        type: ZoneType.HOSTILE,
        center: new THREE.Vector3(pos.x, 0, pos.z),
        radius: 150,
        priority: 3,
      });
    });

    // Restricted zones (military installations)
    this.addZone({
      id: 'military-base',
      type: ZoneType.RESTRICTED,
      center: new THREE.Vector3(-300, 0, -300),
      radius: 80,
      priority: 8,
    });
  }

  private createBattlefieldBorders() {
    const materialCache = MaterialCache.getInstance();

    // Create outer border
    const borderGeometry = new THREE.BufferGeometry();
    const borderPoints = [
      new THREE.Vector3(this.bounds.minX, 1, this.bounds.minZ),
      new THREE.Vector3(this.bounds.maxX, 1, this.bounds.minZ),
      new THREE.Vector3(this.bounds.maxX, 1, this.bounds.maxZ),
      new THREE.Vector3(this.bounds.minX, 1, this.bounds.maxZ),
      new THREE.Vector3(this.bounds.minX, 1, this.bounds.minZ),
    ];
    borderGeometry.setFromPoints(borderPoints);

    const borderMaterial = materialCache.getLineMaterial({
      color: 0xff0000,
      opacity: 0.5,
      transparent: true,
    });

    const borderLine = new THREE.Line(borderGeometry, borderMaterial);
    this.borderGroup.add(borderLine);

    // Create warning zone inside border
    const warningOffset = 100;
    const warningPoints = [
      new THREE.Vector3(this.bounds.minX + warningOffset, 1, this.bounds.minZ + warningOffset),
      new THREE.Vector3(this.bounds.maxX - warningOffset, 1, this.bounds.minZ + warningOffset),
      new THREE.Vector3(this.bounds.maxX - warningOffset, 1, this.bounds.maxZ - warningOffset),
      new THREE.Vector3(this.bounds.minX + warningOffset, 1, this.bounds.maxZ - warningOffset),
      new THREE.Vector3(this.bounds.minX + warningOffset, 1, this.bounds.minZ + warningOffset),
    ];

    const warningGeometry = new THREE.BufferGeometry();
    warningGeometry.setFromPoints(warningPoints);

    const warningMaterial = materialCache.getLineMaterial({
      color: 0xffaa00,
      opacity: 0.3,
      transparent: true,
    });

    const warningLine = new THREE.Line(warningGeometry, warningMaterial);
    warningLine.userData = { isWarningZone: true };
    this.borderGroup.add(warningLine);

    // Add border markers
    this.createBorderMarkers();
  }

  private createBorderMarkers() {
    const materialCache = MaterialCache.getInstance();
    const geometryFactory = GeometryFactory.getInstance();

    // Create markers at corners and midpoints
    const markerPositions = [
      // Corners
      { x: this.bounds.minX, z: this.bounds.minZ },
      { x: this.bounds.maxX, z: this.bounds.minZ },
      { x: this.bounds.maxX, z: this.bounds.maxZ },
      { x: this.bounds.minX, z: this.bounds.maxZ },
      // Midpoints
      { x: 0, z: this.bounds.minZ },
      { x: 0, z: this.bounds.maxZ },
      { x: this.bounds.minX, z: 0 },
      { x: this.bounds.maxX, z: 0 },
    ];

    markerPositions.forEach((pos, index) => {
      // Create marker post
      const postGeometry = geometryFactory.getCylinder(2, 2, 30, 8);
      const postMaterial = materialCache.getMeshStandardMaterial({
        color: 0xff0000,
        emissive: 0xff0000,
        emissiveIntensity: 0.3,
      });

      const post = new THREE.Mesh(postGeometry, postMaterial);
      post.position.set(pos.x, 15, pos.z);
      this.borderGroup.add(post);

      // Add warning light
      const lightGeometry = geometryFactory.getSphere(3, 8, 6);
      const lightMaterial = materialCache.getMeshBasicMaterial({
        color: 0xff0000,
        transparent: true,
        opacity: 0.8,
      });

      const light = new THREE.Mesh(lightGeometry, lightMaterial);
      light.position.set(pos.x, 31, pos.z);
      light.userData = {
        isMarkerLight: true,
        phase: (index * Math.PI) / 4,
        baseIntensity: 0.8,
      };
      this.borderGroup.add(light);
    });
  }

  private createDefaultThreatCorridors() {
    // North corridor
    this.addThreatCorridor({
      id: 'north-corridor',
      points: [
        new THREE.Vector3(0, 50, -900),
        new THREE.Vector3(0, 100, -600),
        new THREE.Vector3(0, 80, -300),
        new THREE.Vector3(0, 30, 0),
      ],
      width: 200,
      threatFrequency: 0.7,
      active: true,
    });

    // Northeast corridor
    this.addThreatCorridor({
      id: 'northeast-corridor',
      points: [
        new THREE.Vector3(700, 50, -700),
        new THREE.Vector3(500, 120, -500),
        new THREE.Vector3(300, 100, -300),
        new THREE.Vector3(100, 40, -100),
      ],
      width: 150,
      threatFrequency: 0.5,
      active: true,
    });

    // East corridor
    this.addThreatCorridor({
      id: 'east-corridor',
      points: [
        new THREE.Vector3(900, 30, 0),
        new THREE.Vector3(600, 80, 0),
        new THREE.Vector3(300, 60, 0),
        new THREE.Vector3(0, 20, 0),
      ],
      width: 180,
      threatFrequency: 0.6,
      active: true,
    });

    // Southwest corridor
    this.addThreatCorridor({
      id: 'southwest-corridor',
      points: [
        new THREE.Vector3(-700, 40, 700),
        new THREE.Vector3(-500, 90, 500),
        new THREE.Vector3(-300, 70, 300),
        new THREE.Vector3(-100, 30, 100),
      ],
      width: 160,
      threatFrequency: 0.4,
      active: false,
    });
  }

  addZone(config: Zone) {
    const materialCache = MaterialCache.getInstance();
    const geometryFactory = GeometryFactory.getInstance();

    // Create zone visualization
    const zoneGeometry = new THREE.CircleGeometry(config.radius, 32);
    const zoneMaterial = materialCache.getMeshBasicMaterial({
      color: this.zoneColors[config.type].color,
      transparent: true,
      opacity: this.zoneColors[config.type].opacity,
      side: THREE.DoubleSide,
    });

    const zoneMesh = new THREE.Mesh(zoneGeometry, zoneMaterial);
    zoneMesh.rotation.x = -Math.PI / 2;
    zoneMesh.position.copy(config.center);
    zoneMesh.position.y = 0.5;

    // Create zone border
    const borderCurve = new THREE.EllipseCurve(
      0,
      0,
      config.radius,
      config.radius,
      0,
      2 * Math.PI,
      false,
      0
    );
    const borderPoints = borderCurve.getPoints(64);
    const borderGeometry = new THREE.BufferGeometry().setFromPoints(borderPoints);

    const borderMaterial = materialCache.getLineMaterial({
      color: this.zoneColors[config.type].color,
      opacity: 0.8,
      transparent: true,
    });

    const borderLine = new THREE.Line(borderGeometry, borderMaterial);
    borderLine.rotation.x = -Math.PI / 2;
    borderLine.position.copy(config.center);
    borderLine.position.y = 1;

    // Store zone with visualization
    config.mesh = zoneMesh;
    config.border = borderLine;

    this.zones.set(config.id, config);
    this.zoneGroup.add(zoneMesh);
    this.zoneGroup.add(borderLine);
  }

  addThreatCorridor(config: ThreatCorridor) {
    const materialCache = MaterialCache.getInstance();

    const corridorGroup = new THREE.Group();

    // Create spline curve for smooth path
    const curve = new THREE.CatmullRomCurve3(config.points);
    const points = curve.getPoints(50);

    // Create corridor path line
    const pathGeometry = new THREE.BufferGeometry().setFromPoints(points);
    const pathMaterial = materialCache.getLineMaterial({
      color: config.active ? 0xff0000 : 0x666666,
      opacity: config.active ? 0.6 : 0.3,
      transparent: true,
    });

    const pathLine = new THREE.Line(pathGeometry, pathMaterial);
    corridorGroup.add(pathLine);

    // Create corridor volume visualization
    const tubeGeometry = new THREE.TubeGeometry(curve, 20, config.width / 2, 8, false);
    const tubeMaterial = materialCache.getMeshBasicMaterial({
      color: config.active ? 0xff0000 : 0x666666,
      transparent: true,
      opacity: 0.05,
      side: THREE.DoubleSide,
    });

    const tubeMesh = new THREE.Mesh(tubeGeometry, tubeMaterial);
    corridorGroup.add(tubeMesh);

    // Add direction indicators
    const arrowCount = 5;
    for (let i = 0; i < arrowCount; i++) {
      const t = (i + 1) / (arrowCount + 1);
      const position = curve.getPoint(t);
      const tangent = curve.getTangent(t);

      const arrowGeometry = new THREE.ConeGeometry(10, 20, 4);
      const arrowMaterial = materialCache.getMeshBasicMaterial({
        color: config.active ? 0xff0000 : 0x666666,
        transparent: true,
        opacity: 0.4,
      });

      const arrow = new THREE.Mesh(arrowGeometry, arrowMaterial);
      arrow.position.copy(position);
      arrow.lookAt(position.clone().add(tangent));
      arrow.rotateX(Math.PI / 2);

      corridorGroup.add(arrow);
    }

    config.visualization = corridorGroup;
    this.threatCorridors.set(config.id, config);
    this.corridorGroup.add(corridorGroup);
  }

  getZoneAt(position: THREE.Vector3): Zone | null {
    for (const zone of this.zones.values()) {
      const distance = position.distanceTo(zone.center);
      if (distance <= zone.radius) {
        return zone;
      }
    }
    return null;
  }

  getZonePriority(position: THREE.Vector3): number {
    const zone = this.getZoneAt(position);
    return zone ? zone.priority : 1;
  }

  isInBounds(position: THREE.Vector3): boolean {
    return (
      position.x >= this.bounds.minX &&
      position.x <= this.bounds.maxX &&
      position.z >= this.bounds.minZ &&
      position.z <= this.bounds.maxZ
    );
  }

  getDistanceToBorder(position: THREE.Vector3): number {
    const distances = [
      Math.abs(position.x - this.bounds.minX),
      Math.abs(position.x - this.bounds.maxX),
      Math.abs(position.z - this.bounds.minZ),
      Math.abs(position.z - this.bounds.maxZ),
    ];
    return Math.min(...distances);
  }

  getNearestCorridor(position: THREE.Vector3): ThreatCorridor | null {
    let nearestCorridor: ThreatCorridor | null = null;
    let minDistance = Infinity;

    for (const corridor of this.threatCorridors.values()) {
      if (!corridor.active) continue;

      // Find nearest point on corridor
      const curve = new THREE.CatmullRomCurve3(corridor.points);
      const testPoints = curve.getPoints(20);

      for (const point of testPoints) {
        const distance = position.distanceTo(point);
        if (distance < minDistance) {
          minDistance = distance;
          nearestCorridor = corridor;
        }
      }
    }

    return nearestCorridor;
  }

  update(deltaTime: number) {
    const time = Date.now() * 0.001;

    // Animate zone borders
    this.zoneGroup.traverse(child => {
      if (child instanceof THREE.Line) {
        child.rotation.z = time * 0.1;
      }
    });

    // Animate border marker lights
    this.borderGroup.traverse(child => {
      if (child.userData.isMarkerLight) {
        const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
        const intensity = 0.5 + 0.5 * Math.sin(time * 3 + child.userData.phase);
        material.opacity = child.userData.baseIntensity * intensity;
      }
    });

    // Pulse warning zone
    this.borderGroup.traverse(child => {
      if (child.userData.isWarningZone) {
        const material = (child as THREE.Line).material as THREE.LineBasicMaterial;
        material.opacity = 0.3 + 0.2 * Math.sin(time * 2);
      }
    });
  }

  setCorridorActive(corridorId: string, active: boolean) {
    const corridor = this.threatCorridors.get(corridorId);
    if (corridor) {
      corridor.active = active;

      // Update visualization
      if (corridor.visualization) {
        corridor.visualization.traverse(child => {
          if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
            const material = child.material as any;
            material.color.setHex(active ? 0xff0000 : 0x666666);
            material.opacity = active ? material.opacity * 2 : material.opacity * 0.5;
          }
        });
      }
    }
  }

  getActiveCorridors(): ThreatCorridor[] {
    return Array.from(this.threatCorridors.values()).filter(c => c.active);
  }

  setBounds(minX: number, maxX: number, minZ: number, maxZ: number) {
    this.bounds = { minX, maxX, minZ, maxZ };

    // Recreate borders with new bounds
    this.borderGroup.clear();
    this.createBattlefieldBorders();
  }

  dispose() {
    this.zoneGroup.traverse(child => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        child.geometry.dispose();
        // Don't dispose materials from MaterialCache
      }
    });

    this.corridorGroup.traverse(child => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        child.geometry.dispose();
        // Don't dispose materials from MaterialCache
      }
    });

    this.borderGroup.traverse(child => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        child.geometry.dispose();
        // Don't dispose materials from MaterialCache
      }
    });

    this.scene.remove(this.zoneGroup);
    this.scene.remove(this.corridorGroup);
    this.scene.remove(this.borderGroup);
  }
}
