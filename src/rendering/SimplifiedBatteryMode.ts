import * as THREE from 'three'
import { BufferGeometryUtils } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export class SimplifiedBatteryGeometry {
  static createMergedLauncherTubes(tubeCount: number): THREE.BufferGeometry {
    const tubeGeometry = new THREE.CylinderGeometry(0.2, 0.2, 3, 8)
    const geometries: THREE.BufferGeometry[] = []
    
    // Create tubes in circular pattern
    for (let i = 0; i < tubeCount; i++) {
      const angle = (i / tubeCount) * Math.PI * 2
      const tubeClone = tubeGeometry.clone()
      
      // Position the tube
      const matrix = new THREE.Matrix4()
      matrix.makeTranslation(
        Math.cos(angle) * 0.8,
        0,
        Math.sin(angle) * 0.8
      )
      
      // Apply slight rotation
      const rotMatrix = new THREE.Matrix4()
      rotMatrix.makeRotationZ(Math.PI / 8)
      matrix.multiply(rotMatrix)
      
      tubeClone.applyMatrix4(matrix)
      geometries.push(tubeClone)
    }
    
    // Merge all tubes into a single geometry
    const mergedGeometry = BufferGeometryUtils.mergeGeometries(geometries)
    
    // Clean up individual geometries
    geometries.forEach(g => g.dispose())
    tubeGeometry.dispose()
    
    return mergedGeometry
  }
  
  static createSimplifiedBattery(launcherCount: number): THREE.Group {
    const group = new THREE.Group()
    
    // Base (single mesh)
    const baseGeometry = new THREE.BoxGeometry(6, 1, 6)
    const baseMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a4a4a,
      roughness: 0.8,
      metalness: 0.3
    })
    const base = new THREE.Mesh(baseGeometry, baseMaterial)
    base.position.y = 0.5
    base.castShadow = true
    base.receiveShadow = true
    group.add(base)
    
    // Merged launcher tubes (single mesh for all tubes!)
    const mergedTubesGeometry = this.createMergedLauncherTubes(launcherCount)
    const tubesMaterial = new THREE.MeshStandardMaterial({
      color: 0x666666,
      roughness: 0.5,
      metalness: 0.7
    })
    const tubes = new THREE.Mesh(mergedTubesGeometry, tubesMaterial)
    tubes.position.y = 2.5
    tubes.castShadow = true
    group.add(tubes)
    
    // Central mount (single mesh)
    const mountGeometry = new THREE.CylinderGeometry(1.2, 1.5, 1, 8)
    const mount = new THREE.Mesh(mountGeometry, tubesMaterial)
    mount.position.y = 2.5
    mount.castShadow = true
    group.add(mount)
    
    // Radar dome (single mesh)
    const domeGeometry = new THREE.SphereGeometry(1, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2)
    const domeMaterial = new THREE.MeshStandardMaterial({
      color: 0x888888,
      roughness: 0.3,
      metalness: 0.8,
      opacity: 0.9,
      transparent: true
    })
    const dome = new THREE.Mesh(domeGeometry, domeMaterial)
    dome.position.y = 4
    dome.castShadow = true
    group.add(dome)
    
    // Total: 4 meshes instead of 40+!
    return group
  }
}