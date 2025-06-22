import * as THREE from 'three'

/**
 * Centralized geometry factory that caches and reuses geometry instances
 * to prevent duplicate geometry creation and reduce memory usage.
 * 
 * This factory implements a singleton pattern and uses a cache key system
 * based on geometry type and parameters to ensure geometries are only
 * created once and shared across all objects that need them.
 * 
 * Usage:
 * ```typescript
 * const sphereGeometry = GeometryFactory.getInstance().getSphere(1, 16, 8)
 * const boxGeometry = GeometryFactory.getInstance().getBox(1, 1, 1)
 * ```
 */
export class GeometryFactory {
  private static instance: GeometryFactory
  private geometries = new Map<string, THREE.BufferGeometry>()
  
  private constructor() {}
  
  static getInstance(): GeometryFactory {
    if (!this.instance) {
      this.instance = new GeometryFactory()
    }
    return this.instance
  }
  
  /**
   * Get or create a sphere geometry
   */
  getSphere(
    radius: number = 1,
    widthSegments: number = 32,
    heightSegments: number = 16,
    phiStart?: number,
    phiLength?: number,
    thetaStart?: number,
    thetaLength?: number
  ): THREE.SphereGeometry {
    const key = `sphere_${radius}_${widthSegments}_${heightSegments}_${phiStart ?? 0}_${phiLength ?? Math.PI * 2}_${thetaStart ?? 0}_${thetaLength ?? Math.PI}`
    
    let geometry = this.geometries.get(key) as THREE.SphereGeometry
    if (!geometry) {
      geometry = new THREE.SphereGeometry(
        radius,
        widthSegments,
        heightSegments,
        phiStart,
        phiLength,
        thetaStart,
        thetaLength
      )
      this.geometries.set(key, geometry)
    }
    
    return geometry
  }
  
  /**
   * Get or create a box geometry
   */
  getBox(
    width: number = 1,
    height: number = 1,
    depth: number = 1,
    widthSegments: number = 1,
    heightSegments: number = 1,
    depthSegments: number = 1
  ): THREE.BoxGeometry {
    const key = `box_${width}_${height}_${depth}_${widthSegments}_${heightSegments}_${depthSegments}`
    
    let geometry = this.geometries.get(key) as THREE.BoxGeometry
    if (!geometry) {
      geometry = new THREE.BoxGeometry(
        width,
        height,
        depth,
        widthSegments,
        heightSegments,
        depthSegments
      )
      this.geometries.set(key, geometry)
    }
    
    return geometry
  }
  
  /**
   * Get or create a cone geometry
   */
  getCone(
    radius: number = 1,
    height: number = 1,
    radialSegments: number = 32,
    heightSegments: number = 1,
    openEnded: boolean = false,
    thetaStart?: number,
    thetaLength?: number
  ): THREE.ConeGeometry {
    const key = `cone_${radius}_${height}_${radialSegments}_${heightSegments}_${openEnded}_${thetaStart ?? 0}_${thetaLength ?? Math.PI * 2}`
    
    let geometry = this.geometries.get(key) as THREE.ConeGeometry
    if (!geometry) {
      geometry = new THREE.ConeGeometry(
        radius,
        height,
        radialSegments,
        heightSegments,
        openEnded,
        thetaStart,
        thetaLength
      )
      this.geometries.set(key, geometry)
    }
    
    return geometry
  }
  
  /**
   * Get or create a cylinder geometry
   */
  getCylinder(
    radiusTop: number = 1,
    radiusBottom: number = 1,
    height: number = 1,
    radialSegments: number = 32,
    heightSegments: number = 1,
    openEnded: boolean = false,
    thetaStart?: number,
    thetaLength?: number
  ): THREE.CylinderGeometry {
    const key = `cylinder_${radiusTop}_${radiusBottom}_${height}_${radialSegments}_${heightSegments}_${openEnded}_${thetaStart ?? 0}_${thetaLength ?? Math.PI * 2}`
    
    let geometry = this.geometries.get(key) as THREE.CylinderGeometry
    if (!geometry) {
      geometry = new THREE.CylinderGeometry(
        radiusTop,
        radiusBottom,
        height,
        radialSegments,
        heightSegments,
        openEnded,
        thetaStart,
        thetaLength
      )
      this.geometries.set(key, geometry)
    }
    
    return geometry
  }
  
  /**
   * Get or create a plane geometry
   */
  getPlane(
    width: number = 1,
    height: number = 1,
    widthSegments: number = 1,
    heightSegments: number = 1
  ): THREE.PlaneGeometry {
    const key = `plane_${width}_${height}_${widthSegments}_${heightSegments}`
    
    let geometry = this.geometries.get(key) as THREE.PlaneGeometry
    if (!geometry) {
      geometry = new THREE.PlaneGeometry(width, height, widthSegments, heightSegments)
      this.geometries.set(key, geometry)
    }
    
    return geometry
  }
  
  /**
   * Get or create a torus geometry
   */
  getTorus(
    radius: number = 1,
    tube: number = 0.4,
    radialSegments: number = 12,
    tubularSegments: number = 48,
    arc?: number
  ): THREE.TorusGeometry {
    const key = `torus_${radius}_${tube}_${radialSegments}_${tubularSegments}_${arc ?? Math.PI * 2}`
    
    let geometry = this.geometries.get(key) as THREE.TorusGeometry
    if (!geometry) {
      geometry = new THREE.TorusGeometry(
        radius,
        tube,
        radialSegments,
        tubularSegments,
        arc
      )
      this.geometries.set(key, geometry)
    }
    
    return geometry
  }
  
  /**
   * Get or create a ring geometry
   */
  getRing(
    innerRadius: number = 0.5,
    outerRadius: number = 1,
    thetaSegments: number = 32,
    phiSegments: number = 1,
    thetaStart?: number,
    thetaLength?: number
  ): THREE.RingGeometry {
    const key = `ring_${innerRadius}_${outerRadius}_${thetaSegments}_${phiSegments}_${thetaStart ?? 0}_${thetaLength ?? Math.PI * 2}`
    
    let geometry = this.geometries.get(key) as THREE.RingGeometry
    if (!geometry) {
      geometry = new THREE.RingGeometry(
        innerRadius,
        outerRadius,
        thetaSegments,
        phiSegments,
        thetaStart,
        thetaLength
      )
      this.geometries.set(key, geometry)
    }
    
    return geometry
  }
  
  /**
   * Get or create an octahedron geometry
   */
  getOctahedron(radius: number = 1, detail: number = 0): THREE.OctahedronGeometry {
    const key = `octahedron_${radius}_${detail}`
    
    let geometry = this.geometries.get(key) as THREE.OctahedronGeometry
    if (!geometry) {
      geometry = new THREE.OctahedronGeometry(radius, detail)
      this.geometries.set(key, geometry)
    }
    
    return geometry
  }
  
  /**
   * Get or create a buffer geometry from arrays
   */
  getBufferGeometry(
    positions: Float32Array,
    normals?: Float32Array,
    uvs?: Float32Array,
    indices?: Uint16Array | Uint32Array
  ): THREE.BufferGeometry {
    // Create a hash from the array data
    const posHash = this.hashArray(positions)
    const key = `buffer_${posHash}_${normals ? this.hashArray(normals) : 'none'}_${uvs ? this.hashArray(uvs) : 'none'}_${indices ? this.hashArray(indices) : 'none'}`
    
    let geometry = this.geometries.get(key)
    if (!geometry) {
      geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      
      if (normals) {
        geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
      }
      
      if (uvs) {
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
      }
      
      if (indices) {
        geometry.setIndex(new THREE.BufferAttribute(indices, 1))
      }
      
      this.geometries.set(key, geometry)
    }
    
    return geometry
  }
  
  /**
   * Create a simple hash from array data for cache key generation
   */
  private hashArray(array: ArrayLike<number>): string {
    let hash = 0
    const len = Math.min(array.length, 100) // Sample first 100 elements
    for (let i = 0; i < len; i++) {
      hash = ((hash << 5) - hash) + array[i]
      hash = hash & hash // Convert to 32bit integer
    }
    return `${hash}_${array.length}`
  }
  
  /**
   * Apply transformations to a geometry (creates a new instance)
   */
  applyTransform(
    geometry: THREE.BufferGeometry,
    position?: THREE.Vector3,
    rotation?: THREE.Euler,
    scale?: THREE.Vector3
  ): THREE.BufferGeometry {
    const transformed = geometry.clone()
    
    if (position) {
      transformed.translate(position.x, position.y, position.z)
    }
    
    if (rotation) {
      transformed.rotateX(rotation.x)
      transformed.rotateY(rotation.y)
      transformed.rotateZ(rotation.z)
    }
    
    if (scale) {
      transformed.scale(scale.x, scale.y, scale.z)
    }
    
    return transformed
  }
  
  /**
   * Get statistics about cached geometries
   */
  getStats(): {
    totalGeometries: number
    byType: Record<string, number>
    memoryEstimate: number
  } {
    const byType: Record<string, number> = {}
    let memoryEstimate = 0
    
    this.geometries.forEach((geometry, key) => {
      const type = key.split('_')[0]
      byType[type] = (byType[type] || 0) + 1
      
      // Estimate memory usage
      if (geometry.attributes.position) {
        memoryEstimate += geometry.attributes.position.array.length * 4 // 4 bytes per float
      }
      if (geometry.attributes.normal) {
        memoryEstimate += geometry.attributes.normal.array.length * 4
      }
      if (geometry.attributes.uv) {
        memoryEstimate += geometry.attributes.uv.array.length * 4
      }
      if (geometry.index) {
        memoryEstimate += geometry.index.array.length * 2 // 2 bytes per uint16
      }
    })
    
    return {
      totalGeometries: this.geometries.size,
      byType,
      memoryEstimate
    }
  }
  
  /**
   * Clear all cached geometries
   */
  clear(): void {
    this.geometries.forEach(geometry => geometry.dispose())
    this.geometries.clear()
  }
  
  /**
   * Remove a specific geometry from cache
   */
  remove(key: string): boolean {
    const geometry = this.geometries.get(key)
    if (geometry) {
      geometry.dispose()
      this.geometries.delete(key)
      return true
    }
    return false
  }
}