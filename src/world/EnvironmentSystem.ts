import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { MaterialCache } from '../utils/MaterialCache';
import { GeometryFactory } from '../utils/GeometryFactory';
import { debug } from '../utils/logger';

export interface EnvironmentConfig {
  fogEnabled: boolean;
  fogColor: THREE.Color;
  fogNear: number;
  fogFar: number;
  skyboxEnabled: boolean;
  terrainEnabled: boolean;
  cloudsEnabled: boolean;
  atmosphericScattering: boolean;
}

export class EnvironmentSystem {
  private scene: THREE.Scene;
  private sun: THREE.Vector3 = new THREE.Vector3();
  public sky: Sky | null = null; // Made public for day/night cycle access
  private terrain: THREE.Group = new THREE.Group();
  private windDirection: THREE.Vector3 = new THREE.Vector3(1, 0, 0.5).normalize();
  private windSpeed: number = 5;
  private time: number = 0;
  private windAngle: number = Math.atan2(0.5, 1); // Initial angle from windDirection
  private targetWindAngle: number = this.windAngle;
  private windTransitionSpeed: number = 0.1; // How fast wind changes direction

  // Skybox parameters - heavily adjusted to reduce sun brightness
  private turbidity: number = 50; // Very high turbidity for maximum haze
  private rayleigh: number = 0.5; // Much lower for minimal scattering
  private mieCoefficient: number = 0.05; // Much higher for thick atmospheric haze
  private mieDirectionalG: number = 0.999; // Near maximum to diffuse the sun
  private elevation: number = 1; // Lower sun position
  private azimuth: number = 180;

  // Terrain parameters
  private terrainSize: number = 6000; // Expanded from 2000
  private mountainCount: number = 16; // Increased for larger terrain
  private hillCount: number = 0; // No hills, focus on mountains

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.terrain.name = 'Terrain';
  }

  initialize(config: Partial<EnvironmentConfig> = {}) {
    const defaultConfig: EnvironmentConfig = {
      fogEnabled: true,
      fogColor: new THREE.Color(0x1a3560), // Darker fog to match scene background
      fogNear: 2500, // Start fog further away for better visibility
      fogFar: 5000, // Extended fog distance for clearer view
      skyboxEnabled: true,
      terrainEnabled: true,
      cloudsEnabled: false, // Disabled clouds
      atmosphericScattering: true,
    };

    const finalConfig = { ...defaultConfig, ...config };

    // Set up fog
    if (finalConfig.fogEnabled) {
      this.scene.fog = new THREE.Fog(finalConfig.fogColor, finalConfig.fogNear, finalConfig.fogFar);
    }

    // Set up skybox
    if (finalConfig.skyboxEnabled) {
      this.setupSkybox();
    }

    // Set up terrain
    if (finalConfig.terrainEnabled) {
      this.setupTerrain();
      this.scene.add(this.terrain);
    }

    // Clouds removed - no longer needed

    debug.log('Environment system initialized');
  }

  private setupSkybox() {
    // Create sky
    this.sky = new Sky();
    this.sky.scale.setScalar(100000); // Reduced from 450000 for less prominent sky
    this.scene.add(this.sky);

    const skyUniforms = this.sky.material.uniforms;
    skyUniforms['turbidity'].value = this.turbidity;
    skyUniforms['rayleigh'].value = this.rayleigh;
    skyUniforms['mieCoefficient'].value = this.mieCoefficient;
    skyUniforms['mieDirectionalG'].value = this.mieDirectionalG;

    this.updateSun();
  }

  private updateSun() {
    if (!this.sky) return;

    const phi = THREE.MathUtils.degToRad(90 - this.elevation);
    const theta = THREE.MathUtils.degToRad(this.azimuth);

    this.sun.setFromSphericalCoords(1, phi, theta);

    const skyUniforms = this.sky.material.uniforms;
    skyUniforms['sunPosition'].value.copy(this.sun);
  }

  // Improved Perlin-like noise implementation with multiple octaves
  private noise2D(x: number, y: number): number {
    // Create pseudo-random values based on position
    const dot = (gx: number, gy: number, x: number, y: number) => gx * x + gy * y;

    // Hash function for grid points
    const hash = (x: number, y: number): number => {
      let h = x * 374761393 + y * 668265263; // Large primes
      h = (h ^ (h >> 13)) * 1274126177;
      return h ^ (h >> 16);
    };

    // Get pseudo-random gradient
    const gradient = (hash: number): [number, number] => {
      const h = hash & 3;
      switch (h) {
        case 0:
          return [1, 1];
        case 1:
          return [-1, 1];
        case 2:
          return [1, -1];
        default:
          return [-1, -1];
      }
    };

    // Smoothstep interpolation
    const smoothstep = (t: number): number => t * t * (3 - 2 * t);

    // Single octave of noise
    const perlin = (x: number, y: number): number => {
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const x1 = x0 + 1;
      const y1 = y0 + 1;

      const sx = smoothstep(x - x0);
      const sy = smoothstep(y - y0);

      const [g00x, g00y] = gradient(hash(x0, y0));
      const [g10x, g10y] = gradient(hash(x1, y0));
      const [g01x, g01y] = gradient(hash(x0, y1));
      const [g11x, g11y] = gradient(hash(x1, y1));

      const n00 = dot(g00x, g00y, x - x0, y - y0);
      const n10 = dot(g10x, g10y, x - x1, y - y0);
      const n01 = dot(g01x, g01y, x - x0, y - y1);
      const n11 = dot(g11x, g11y, x - x1, y - y1);

      const nx0 = n00 * (1 - sx) + n10 * sx;
      const nx1 = n01 * (1 - sx) + n11 * sx;

      return (nx0 * (1 - sy) + nx1 * sy) * 0.5 + 0.5;
    };

    // Combine multiple octaves for more natural terrain
    let value = 0;
    let amplitude = 1;
    let frequency = 0.003;
    let maxValue = 0;

    for (let i = 0; i < 6; i++) {
      value += perlin(x * frequency, y * frequency) * amplitude;
      maxValue += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }

    return value / maxValue;
  }

  private setupTerrain() {
    const materialCache = MaterialCache.getInstance();

    // Create natural mountain terrain using height map
    const terrainSize = 8000; // Expanded terrain for even more majestic mountains
    const segments = 256; // Higher resolution for detailed terrain
    const maxHeight = 600; // Taller mountains

    const geometry = new THREE.PlaneGeometry(terrainSize, terrainSize, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    const positions = geometry.attributes.position;
    const colors = new Float32Array(positions.count * 3);
    const vertex = new THREE.Vector3();

    // Generate height map using improved noise
    for (let i = 0; i < positions.count; i++) {
      vertex.fromBufferAttribute(positions, i);

      const x = vertex.x;
      const z = vertex.z;
      const distFromCenter = Math.sqrt(x * x + z * z);

      // Smooth transition from city to mountains
      const cityRadius = 900; // Core flat area
      const transitionWidth = 200; // Smooth transition zone

      if (distFromCenter < cityRadius) {
        // Keep center area flat for city
        vertex.y = 0;
        // City area - darker ground
        colors[i * 3] = 0.15;
        colors[i * 3 + 1] = 0.18;
        colors[i * 3 + 2] = 0.15;
      } else if (distFromCenter < cityRadius + transitionWidth) {
        // Smooth transition zone
        const transitionFactor = (distFromCenter - cityRadius) / transitionWidth;
        const smoothFactor = 0.5 - 0.5 * Math.cos(transitionFactor * Math.PI); // Smooth S-curve

        // Gradually increase height
        const baseHeight = this.noise2D(x * 0.02, z * 0.02) * 20; // Gentle rolling
        vertex.y = baseHeight * smoothFactor;

        // Blend ground colors
        colors[i * 3] = 0.15 + (0.2 - 0.15) * smoothFactor;
        colors[i * 3 + 1] = 0.18 + (0.25 - 0.18) * smoothFactor;
        colors[i * 3 + 2] = 0.15 + (0.2 - 0.15) * smoothFactor;
      } else {
        // Create mountain terrain with multiple layers
        const normalizedDist = Math.min(
          (distFromCenter - (cityRadius + transitionWidth)) / 1500,
          1
        );

        // Base terrain shape
        let height = this.noise2D(x, z) * 150;

        // Add mountain ridges
        const ridgeNoise = this.noise2D(x * 0.8, z * 0.8);
        const ridge = Math.pow(Math.abs(ridgeNoise - 0.5) * 2, 0.3);
        height += (1 - ridge) * 200 * normalizedDist;

        // Add peaks
        const peakNoise = this.noise2D(x * 0.3, z * 0.3);
        if (peakNoise > 0.6) {
          const peakStrength = (peakNoise - 0.6) / 0.4;
          height += Math.pow(peakStrength, 2) * maxHeight * normalizedDist;
        }

        // Erosion simulation
        const erosion = this.noise2D(x * 2, z * 2);
        height *= 0.7 + erosion * 0.3;

        // Smooth transition from city
        height *= Math.pow(normalizedDist, 0.5);

        vertex.y = Math.max(0, height);

        // Color based on height and slope
        const slope = height / maxHeight;
        if (slope > 0.7) {
          // Snow cap
          colors[i * 3] = 0.9;
          colors[i * 3 + 1] = 0.9;
          colors[i * 3 + 2] = 0.95;
        } else if (slope > 0.4) {
          // Rocky
          colors[i * 3] = 0.35 + Math.random() * 0.1;
          colors[i * 3 + 1] = 0.3 + Math.random() * 0.1;
          colors[i * 3 + 2] = 0.25 + Math.random() * 0.1;
        } else {
          // Grassy/forest
          colors[i * 3] = 0.2 + slope * 0.2;
          colors[i * 3 + 1] = 0.35 + slope * 0.1;
          colors[i * 3 + 2] = 0.15 + slope * 0.2;
        }
      }

      positions.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }

    // Add vertex colors
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // Compute normals for proper lighting
    geometry.computeVertexNormals();

    // Create material with vertex colors
    const material = materialCache.getMeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      metalness: 0,
      fog: true,
    });

    const terrain = new THREE.Mesh(geometry, material);
    terrain.receiveShadow = true;
    terrain.castShadow = false; // Don't cast shadows for performance

    this.terrain.add(terrain);

    // Removed rocky outcrops and mountain details - they looked too artificial
    // The terrain height map with vertex colors provides sufficient detail
  }

  private addRockyOutcrops() {
    const materialCache = MaterialCache.getInstance();
    const geometryFactory = GeometryFactory.getInstance();

    // Add some rocky outcrops on the mountains
    const rockCount = 20;

    for (let i = 0; i < rockCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = 1200 + Math.random() * 500;

      // Use octahedron geometry instead and clone it for deformation
      const baseGeometry = geometryFactory.getOctahedron(20 + Math.random() * 40, 1);
      const rockGeometry = baseGeometry.clone();
      const positions = rockGeometry.attributes.position;

      // Deform the rock for more natural shape
      for (let j = 0; j < positions.count; j++) {
        const x = positions.getX(j);
        const y = positions.getY(j);
        const z = positions.getZ(j);

        const noise = (Math.random() - 0.5) * 10;
        positions.setX(j, x + noise);
        positions.setY(j, y + noise * 0.5);
        positions.setZ(j, z + noise);
      }

      rockGeometry.computeVertexNormals();

      const rockMaterial = materialCache.getMeshStandardMaterial({
        color: new THREE.Color(0x4a4a4a),
        roughness: 1,
        metalness: 0,
        fog: true,
      });

      const rock = new THREE.Mesh(rockGeometry, rockMaterial);
      rock.position.set(
        Math.cos(angle) * distance,
        this.getTerrainHeightAt(Math.cos(angle) * distance, Math.sin(angle) * distance),
        Math.sin(angle) * distance
      );
      rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      rock.scale.setScalar(0.5 + Math.random() * 1.5);
      rock.castShadow = true;
      rock.receiveShadow = true;

      this.terrain.add(rock);
    }
  }

  private getTerrainHeightAt(x: number, z: number): number {
    const distFromCenter = Math.sqrt(x * x + z * z);

    if (distFromCenter < 1000) {
      return 0;
    }

    const normalizedDist = Math.min((distFromCenter - 1000) / 1500, 1);

    // Base terrain shape
    let height = this.noise2D(x, z) * 150;

    // Add mountain ridges
    const ridgeNoise = this.noise2D(x * 0.8, z * 0.8);
    const ridge = Math.pow(Math.abs(ridgeNoise - 0.5) * 2, 0.3);
    height += (1 - ridge) * 200 * normalizedDist;

    // Add peaks
    const peakNoise = this.noise2D(x * 0.3, z * 0.3);
    if (peakNoise > 0.6) {
      const peakStrength = (peakNoise - 0.6) / 0.4;
      height += Math.pow(peakStrength, 2) * 600 * normalizedDist;
    }

    // Erosion simulation
    const erosion = this.noise2D(x * 2, z * 2);
    height *= 0.7 + erosion * 0.3;

    // Smooth transition
    height *= Math.pow(normalizedDist, 0.5);

    return Math.max(0, height);
  }

  private addMountainDetails() {
    const materialCache = MaterialCache.getInstance();
    const geometryFactory = GeometryFactory.getInstance();

    // Add cliff faces and rock formations
    const formationCount = 30;

    for (let i = 0; i < formationCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = 1500 + Math.random() * 1000;
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      const baseHeight = this.getTerrainHeightAt(x, z);

      // Only add formations on slopes
      if (baseHeight > 100) {
        // Create layered rock formation
        const layers = 3 + Math.floor(Math.random() * 3);
        const formation = new THREE.Group();

        for (let j = 0; j < layers; j++) {
          const layerHeight = 15 + Math.random() * 25;
          const layerRadius = 20 + Math.random() * 30 - j * 5;

          const rockGeometry = geometryFactory.getCylinder(
            layerRadius * 0.8,
            layerRadius,
            layerHeight,
            6 + Math.floor(Math.random() * 4)
          );

          // Deform for natural look
          const positions = rockGeometry.attributes.position;
          for (let k = 0; k < positions.count; k++) {
            const px = positions.getX(k);
            const py = positions.getY(k);
            const pz = positions.getZ(k);

            const noise = (Math.random() - 0.5) * 5;
            positions.setX(k, px + noise);
            positions.setZ(k, pz + noise);
          }
          rockGeometry.computeVertexNormals();

          const rockMaterial = materialCache.getMeshStandardMaterial({
            color: new THREE.Color(0.3 + Math.random() * 0.1, 0.25 + Math.random() * 0.1, 0.2),
            roughness: 1,
            metalness: 0,
            fog: true,
          });

          const rock = new THREE.Mesh(rockGeometry, rockMaterial);
          rock.position.y = j * layerHeight * 0.8;
          rock.rotation.y = Math.random() * Math.PI;
          rock.castShadow = true;
          rock.receiveShadow = true;

          formation.add(rock);
        }

        formation.position.set(x, baseHeight, z);
        formation.rotation.y = Math.random() * Math.PI * 2;
        this.terrain.add(formation);
      }
    }
  }

  update(deltaTime: number) {
    this.time += deltaTime;

    // Update wind direction gradually
    this.updateWindDirection(deltaTime);
    // No cloud updates needed
  }

  setTimeOfDay(hours: number) {
    // Convert hours (0-24) to sun position
    const normalizedTime = hours / 24;

    // Sun elevation: highest at noon, below horizon at night
    this.elevation = Math.sin(normalizedTime * Math.PI) * 90 - 10;

    // Sun azimuth: moves from east to west
    this.azimuth = normalizedTime * 360 - 90;

    // Update sky color based on time
    if (this.sky) {
      // Adjust atmospheric parameters for different times
      if (hours < 6 || hours > 18) {
        // Night time
        this.turbidity = 2;
        this.rayleigh = 0.5;
        this.mieCoefficient = 0.001;
      } else if (hours < 8 || hours > 16) {
        // Sunrise/sunset
        this.turbidity = 10;
        this.rayleigh = 2;
        this.mieCoefficient = 0.01;
      } else {
        // Day time
        this.turbidity = 4;
        this.rayleigh = 1;
        this.mieCoefficient = 0.005;
      }

      const skyUniforms = this.sky.material.uniforms;
      skyUniforms['turbidity'].value = this.turbidity;
      skyUniforms['rayleigh'].value = this.rayleigh;
      skyUniforms['mieCoefficient'].value = this.mieCoefficient;
    }

    this.updateSun();

    // Update fog color based on time
    if (this.scene.fog) {
      const fogColor = new THREE.Color();

      if (hours < 6 || hours > 20) {
        // Night fog
        fogColor.setHSL(0.6, 0.4, 0.1);
      } else if (hours < 8 || hours > 18) {
        // Dawn/dusk fog
        fogColor.setHSL(0.08, 0.3, 0.3);
      } else {
        // Day fog
        fogColor.setHSL(0.6, 0.2, 0.4);
      }

      this.scene.fog.color.copy(fogColor);
    }
  }

  setWindDirection(direction: THREE.Vector3) {
    this.windDirection.copy(direction).normalize();
  }

  setWindSpeed(speed: number) {
    this.windSpeed = THREE.MathUtils.clamp(speed, 0, 20);
  }

  private updateWindDirection(deltaTime: number) {
    // Change target wind direction occasionally (every 20-40 seconds)
    if (Math.random() < deltaTime / 30) {
      // Average every 30 seconds
      // New target angle within ±45 degrees of current
      const angleChange = ((Math.random() - 0.5) * Math.PI) / 2;
      this.targetWindAngle = this.windAngle + angleChange;
    }

    // Smoothly interpolate to target angle
    const angleDiff = this.targetWindAngle - this.windAngle;
    this.windAngle += angleDiff * this.windTransitionSpeed * deltaTime;

    // Update wind direction vector from angle
    this.windDirection.set(Math.cos(this.windAngle), 0, Math.sin(this.windAngle)).normalize();

    // Also vary wind speed slightly (3-8 m/s)
    const targetSpeed = 3 + Math.sin(this.time * 0.1) * 2.5;
    this.windSpeed += (targetSpeed - this.windSpeed) * deltaTime * 0.5;
  }

  getWindAt(position: THREE.Vector3): THREE.Vector3 {
    // Add more turbulence for natural wind flow
    const turbulence = new THREE.Vector3(
      Math.sin(position.x * 0.005 + this.time * 0.8) * 0.3 +
        Math.sin(position.x * 0.02 + this.time * 1.5) * 0.15,
      Math.sin(position.y * 0.01 + this.time * 1.3) * 0.1,
      Math.cos(position.z * 0.005 + this.time * 0.6) * 0.3 +
        Math.cos(position.z * 0.02 + this.time * 1.2) * 0.15
    );

    return this.windDirection.clone().multiplyScalar(this.windSpeed).add(turbulence);
  }

  setFogDensity(near: number, far: number) {
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.near = near;
      this.scene.fog.far = far;
    }
  }

  dispose() {
    // Clean up terrain
    this.terrain.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        // Don't dispose materials from MaterialCache
      }
    });
    this.scene.remove(this.terrain);

    // Clean up sky
    if (this.sky) {
      this.scene.remove(this.sky);
      this.sky.geometry.dispose();
      this.sky.material.dispose();
    }
  }
}
