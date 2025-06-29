import * as THREE from 'three';

export const InterceptorShaderMaterial = (baseColor: number = 0x00ffff) => {
  const color = new THREE.Color(baseColor);

  return new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      baseColor: { value: color },
      cameraPosition: { value: new THREE.Vector3() },
      // Engine pulse controls
      pulseSpeed: { value: 3.0 },
      pulseIntensity: { value: 0.5 },
      // Rim lighting
      rimPower: { value: 2.0 },
      rimIntensity: { value: 1.0 },
      rimColor: { value: new THREE.Color(0x00ffff) },
      // Heat glow
      heatIntensity: { value: 0.0 }, // 0-1, increases with flight time
      heatColor: { value: new THREE.Color(0xff6600) },
      // Distance fade
      fadeStart: { value: 200.0 },
      fadeEnd: { value: 400.0 },
    },

    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      varying vec3 vWorldPosition;
      varying float vDistanceToCamera;
      
      void main() {
        // Standard transformations
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        
        // Pass data to fragment shader
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
      
      // Engine pulse
      uniform float pulseSpeed;
      uniform float pulseIntensity;
      
      // Rim lighting
      uniform float rimPower;
      uniform float rimIntensity;
      uniform vec3 rimColor;
      
      // Heat glow
      uniform float heatIntensity;
      uniform vec3 heatColor;
      
      // Distance fade
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
        
        // 1. RIM LIGHTING - Creates nice edge glow
        float rimFactor = 1.0 - max(0.0, dot(normal, viewDir));
        rimFactor = pow(rimFactor, rimPower);
        vec3 rim = rimColor * rimFactor * rimIntensity;
        
        // 2. ENGINE PULSE - Animated emissive glow
        float pulse = sin(time * pulseSpeed) * 0.5 + 0.5;
        float engineGlow = pulse * pulseIntensity;
        
        // Engine glow is stronger at the base (assuming Y-up orientation)
        float engineMask = 1.0 - smoothstep(-0.5, 1.0, vWorldPosition.y);
        vec3 emissive = baseColor * engineGlow * engineMask;
        
        // 3. HEAT GLOW - Increases with flight time
        vec3 heat = heatColor * heatIntensity * engineMask;
        
        // 4. DISTANCE FADE - LOD without mesh swapping
        float fadeFactor = 1.0 - smoothstep(fadeStart, fadeEnd, vDistanceToCamera);
        
        // Combine all effects
        color = mix(color, color + heat, heatIntensity);
        color += rim;
        color += emissive;
        
        // Apply distance fade
        float alpha = fadeFactor;
        
        // Simple lighting (can be enhanced later)
        float lighting = dot(normal, normalize(vec3(1.0, 1.0, 0.5))) * 0.5 + 0.5;
        color *= lighting;
        
        gl_FragColor = vec4(color, alpha);
      }
    `,

    transparent: true,
    side: THREE.DoubleSide,
  });
};

// Optimized version for mobile/low-end devices
export const InterceptorShaderMaterialMobile = (baseColor: number = 0x00ffff) => {
  const color = new THREE.Color(baseColor);

  return new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      baseColor: { value: color },
      pulseIntensity: { value: 0.3 },
      rimIntensity: { value: 0.5 },
    },

    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      
      void main() {
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        
        vNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);
        vViewPosition = -mvPosition.xyz;
      }
    `,

    fragmentShader: `
      uniform float time;
      uniform vec3 baseColor;
      uniform float pulseIntensity;
      uniform float rimIntensity;
      
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      
      void main() {
        vec3 normal = normalize(vNormal);
        vec3 viewDir = normalize(vViewPosition);
        
        // Simplified rim lighting
        float rimFactor = 1.0 - max(0.0, dot(normal, viewDir));
        
        // Simplified pulse
        float pulse = sin(time * 3.0) * 0.5 + 0.5;
        
        // Combine
        vec3 color = baseColor;
        color += baseColor * rimFactor * rimIntensity;
        color += baseColor * pulse * pulseIntensity * 0.5;
        
        gl_FragColor = vec4(color, 1.0);
      }
    `,

    transparent: false,
  });
};

// Helper to update shader uniforms
export class InterceptorShaderController {
  private material: THREE.ShaderMaterial;
  private launchTime: number;
  private maxHeatTime: number = 5.0; // Seconds to reach max heat

  constructor(material: THREE.ShaderMaterial) {
    this.material = material;
    this.launchTime = Date.now() / 1000;
  }

  update(time: number, cameraPosition: THREE.Vector3): void {
    const uniforms = this.material.uniforms;

    // Update time
    uniforms.time.value = time;

    // Update camera position for rim lighting
    if (uniforms.cameraPosition) {
      uniforms.cameraPosition.value.copy(cameraPosition);
    }

    // Update heat based on flight time
    if (uniforms.heatIntensity) {
      const flightTime = time - this.launchTime;
      const heat = Math.min(1.0, flightTime / this.maxHeatTime);
      uniforms.heatIntensity.value = heat * 0.7; // Max 70% heat glow
    }
  }

  setLaunchTime(time: number): void {
    this.launchTime = time;
  }
}
