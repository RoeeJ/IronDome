import * as THREE from 'three';
import { ThreatType } from '../entities/Threat';

export const ThreatShaderMaterial = (threatType: ThreatType, baseColor: number) => {
  const color = new THREE.Color(baseColor);

  // Threat-specific shader parameters
  const shaderParams: Record<ThreatType, any> = {
    // Rockets
    [ThreatType.SHORT_RANGE]: {
      pulseSpeed: 5.0,
      glowIntensity: 0.3,
      trailHeat: 0.7,
    },
    [ThreatType.MEDIUM_RANGE]: {
      pulseSpeed: 4.0,
      glowIntensity: 0.4,
      trailHeat: 0.8,
    },
    [ThreatType.LONG_RANGE]: {
      pulseSpeed: 3.0,
      glowIntensity: 0.5,
      trailHeat: 0.9,
    },
    // Mortars
    [ThreatType.MORTAR]: {
      pulseSpeed: 2.0,
      glowIntensity: 0.5,
      trailHeat: 0.4,
    },
    // Drones
    [ThreatType.DRONE_SLOW]: {
      pulseSpeed: 10.0, // Fast pulse for rotor effect
      glowIntensity: 0.2,
      trailHeat: 0.1,
    },
    [ThreatType.DRONE_FAST]: {
      pulseSpeed: 15.0, // Faster rotor
      glowIntensity: 0.3,
      trailHeat: 0.2,
    },
    // Cruise missile
    [ThreatType.CRUISE_MISSILE]: {
      pulseSpeed: 8.0,
      glowIntensity: 0.4,
      trailHeat: 0.6,
    },
    // Specific rocket variants
    [ThreatType.QASSAM_1]: {
      pulseSpeed: 5.0,
      glowIntensity: 0.3,
      trailHeat: 0.6,
    },
    [ThreatType.QASSAM_2]: {
      pulseSpeed: 4.5,
      glowIntensity: 0.35,
      trailHeat: 0.7,
    },
    [ThreatType.QASSAM_3]: {
      pulseSpeed: 4.0,
      glowIntensity: 0.4,
      trailHeat: 0.8,
    },
    [ThreatType.GRAD_ROCKET]: {
      pulseSpeed: 3.5,
      glowIntensity: 0.5,
      trailHeat: 0.9,
    },
  };

  const params = shaderParams[threatType];

  return new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      baseColor: { value: color },
      cameraPosition: { value: new THREE.Vector3() },
      // Threat-specific parameters
      pulseSpeed: { value: params.pulseSpeed },
      glowIntensity: { value: params.glowIntensity },
      trailHeat: { value: params.trailHeat },
      // Common parameters
      rimPower: { value: 3.0 },
      rimIntensity: { value: 0.5 },
      fadeStart: { value: 300.0 },
      fadeEnd: { value: 500.0 },
    },

    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      varying vec3 vWorldPosition;
      varying float vDistanceToCamera;
      
      void main() {
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        
        vNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);
        vViewPosition = -mvPosition.xyz;
        vWorldPosition = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
        vDistanceToCamera = length(cameraPosition - vWorldPosition);
      }
    `,

    fragmentShader: `
      uniform float time;
      uniform vec3 baseColor;
      uniform vec3 cameraPosition;
      uniform float pulseSpeed;
      uniform float glowIntensity;
      uniform float trailHeat;
      uniform float rimPower;
      uniform float rimIntensity;
      uniform float fadeStart;
      uniform float fadeEnd;
      
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      varying vec3 vWorldPosition;
      varying float vDistanceToCamera;
      
      void main() {
        vec3 normal = normalize(vNormal);
        vec3 viewDir = normalize(vViewPosition);
        
        // Base color
        vec3 color = baseColor;
        
        // Rim lighting for visibility
        float rimFactor = 1.0 - max(0.0, dot(normal, viewDir));
        rimFactor = pow(rimFactor, rimPower);
        vec3 rim = baseColor * rimFactor * rimIntensity;
        
        // Threat-specific effects
        float pulse = sin(time * pulseSpeed) * 0.5 + 0.5;
        
        // Heat glow effect (stronger at rear)
        float heatMask = 1.0 - smoothstep(-1.0, 1.0, vWorldPosition.y);
        vec3 heatGlow = mix(baseColor, vec3(1.0, 0.5, 0.2), trailHeat) * heatMask * glowIntensity;
        
        // Warning pulse for threats
        float warningPulse = sin(time * 2.0) * 0.5 + 0.5;
        color = mix(color, color * 1.5, warningPulse * 0.3);
        
        // Combine effects
        color += rim;
        color += heatGlow * pulse;
        
        // Distance fade
        float fadeFactor = 1.0 - smoothstep(fadeStart, fadeEnd, vDistanceToCamera);
        
        // Simple lighting
        float lighting = dot(normal, normalize(vec3(1.0, 1.0, 0.5))) * 0.5 + 0.5;
        color *= lighting;
        
        gl_FragColor = vec4(color, fadeFactor);
      }
    `,

    transparent: true,
    side: THREE.DoubleSide,
  });
};

// Special shader for drones with spinning rotor effect
export const DroneShaderMaterial = (baseColor: number = 0xff0000) => {
  const color = new THREE.Color(baseColor);

  return new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      baseColor: { value: color },
      rotorSpeed: { value: 20.0 },
      bladeCount: { value: 4.0 },
    },

    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vPosition;
      varying vec2 vUv;
      
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vPosition = position;
        vUv = uv;
        
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,

    fragmentShader: `
      uniform float time;
      uniform vec3 baseColor;
      uniform float rotorSpeed;
      uniform float bladeCount;
      
      varying vec3 vNormal;
      varying vec3 vPosition;
      varying vec2 vUv;
      
      void main() {
        vec3 color = baseColor;
        
        // Simulate rotor blur on top of drone
        if (vPosition.y > 0.3) {
          float angle = atan(vUv.x - 0.5, vUv.y - 0.5);
          float rotorPattern = sin(angle * bladeCount + time * rotorSpeed) * 0.5 + 0.5;
          
          // Create blur effect
          float blur = 1.0 - rotorPattern * 0.7;
          color *= blur;
          
          // Add slight transparency to rotor area
          gl_FragColor = vec4(color, 0.8);
        } else {
          // Body of drone
          float lighting = dot(vNormal, normalize(vec3(1.0, 1.0, 0.5))) * 0.5 + 0.5;
          color *= lighting;
          gl_FragColor = vec4(color, 1.0);
        }
      }
    `,

    transparent: true,
  });
};
