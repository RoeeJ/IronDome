/**
 * Centralized geometry configuration for performance optimization
 * Adjust these values based on device capabilities
 */

// Define sphere configs separately to avoid self-reference issues
const sphereConfigs = {
  high: { widthSegments: 16, heightSegments: 16 },
  medium: { widthSegments: 10, heightSegments: 8 },
  low: { widthSegments: 6, heightSegments: 5 },
  minimal: { widthSegments: 4, heightSegments: 3 }
}

const cylinderConfigs = {
  high: 16,
  medium: 8,
  low: 6,
  minimal: 4
}

export const GeometryConfig = {
  // Sphere segments - reduce for better performance
  sphere: sphereConfigs,
  
  // Cylinder segments
  cylinder: cylinderConfigs,
  
  // Default quality level (can be adjusted based on device)
  defaultQuality: 'medium' as 'high' | 'medium' | 'low' | 'minimal',
  
  // Get sphere config based on quality
  getSphereConfig(quality?: 'high' | 'medium' | 'low' | 'minimal') {
    const q = quality || this.defaultQuality
    return this.sphere[q]
  },
  
  // Get cylinder segments based on quality
  getCylinderSegments(quality?: 'high' | 'medium' | 'low' | 'minimal') {
    const q = quality || this.defaultQuality
    return this.cylinder[q]
  },
  
  // Specific optimized configs for common uses
  radarDome: {
    radius: 4,
    ...sphereConfigs.medium,
    phiStart: 0,
    phiLength: Math.PI * 2,
    thetaStart: 0,
    thetaLength: Math.PI / 2
  },
  
  explosionSphere: {
    radius: 15,
    ...sphereConfigs.low // Explosions are temporary, use lower detail
  },
  
  projectileSphere: {
    radius: 0.4,
    ...sphereConfigs.minimal // Small and numerous, use minimal detail
  }
}