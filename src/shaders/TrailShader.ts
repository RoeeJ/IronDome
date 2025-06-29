import * as THREE from 'three';

export const EnhancedTrailShader = () => {
  return {
    vertexShader: `
      attribute float trailAge;
      attribute float trailIntensity;
      
      varying float vAge;
      varying float vIntensity;
      varying vec3 vColor;
      
      void main() {
        vAge = trailAge;
        vIntensity = trailIntensity;
        vColor = color;
        
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,

    fragmentShader: `
      uniform float time;
      
      varying float vAge;
      varying float vIntensity;
      varying vec3 vColor;
      
      void main() {
        // Base color from vertex colors
        vec3 color = vColor;
        
        // Enhance brightness for fresh trail segments (exhaust effect)
        float freshness = 1.0 - vAge;
        float glowIntensity = freshness * freshness * vIntensity;
        
        // Add white-hot core for very fresh segments
        vec3 hotCore = vec3(1.0, 1.0, 1.0);
        color = mix(color, hotCore, glowIntensity * 0.5);
        
        // Pulsing effect for active thrust
        float pulse = sin(time * 10.0) * 0.1 + 0.9;
        color *= (1.0 + glowIntensity * pulse * 0.3);
        
        // Fade out based on age
        float alpha = (1.0 - vAge) * 0.8;
        
        gl_FragColor = vec4(color, alpha);
      }
    `,
  };
};

// Helper to add trail attributes for enhanced rendering
export function enhanceTrailGeometry(geometry: THREE.BufferGeometry, maxPoints: number): void {
  // Add custom attributes for trail enhancement
  const trailAge = new Float32Array(maxPoints);
  const trailIntensity = new Float32Array(maxPoints);

  geometry.setAttribute('trailAge', new THREE.BufferAttribute(trailAge, 1));
  geometry.setAttribute('trailIntensity', new THREE.BufferAttribute(trailIntensity, 1));
}
