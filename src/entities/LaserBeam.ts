
import * as THREE from 'three';

export class LaserBeam {
    private scene: THREE.Scene;
    private beamGroup: THREE.Group;
    private coreMesh: THREE.Mesh;
    private glowMesh: THREE.Mesh;
    private pulseTime: number = 0;

    constructor(scene: THREE.Scene, startPoint: THREE.Vector3, endPoint: THREE.Vector3) {
        this.scene = scene;
        this.beamGroup = new THREE.Group();

        const distance = startPoint.distanceTo(endPoint);
        
        // Core beam - bright white center
        const coreGeometry = new THREE.CylinderGeometry(0.2, 0.2, distance, 8, 1);
        const coreMaterial = new THREE.MeshBasicMaterial({ 
            color: 0xffffff,
            emissive: 0xffffff,
            emissiveIntensity: 2,
            transparent: true, 
            opacity: 0.9
        });
        this.coreMesh = new THREE.Mesh(coreGeometry, coreMaterial);
        
        // Outer glow - red with bloom effect
        const glowGeometry = new THREE.CylinderGeometry(0.5, 0.5, distance, 8, 1);
        const glowMaterial = new THREE.MeshBasicMaterial({ 
            color: 0xff0000,
            transparent: true, 
            opacity: 0.3,
            blending: THREE.AdditiveBlending
        });
        this.glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
        
        this.beamGroup.add(this.glowMesh);
        this.beamGroup.add(this.coreMesh);

        this.update(startPoint, endPoint);

        this.scene.add(this.beamGroup);
    }

    public update(startPoint: THREE.Vector3, endPoint: THREE.Vector3, deltaTime?: number) {
        const distance = startPoint.distanceTo(endPoint);
        
        // Update beam length
        this.coreMesh.scale.y = distance / this.coreMesh.geometry.parameters.height;
        this.glowMesh.scale.y = distance / this.glowMesh.geometry.parameters.height;

        // Position at midpoint
        const midpoint = new THREE.Vector3().addVectors(startPoint, endPoint).multiplyScalar(0.5);
        this.beamGroup.position.copy(midpoint);

        // Orient towards target
        const direction = new THREE.Vector3().subVectors(endPoint, startPoint).normalize();
        this.beamGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
        
        // Pulse effect
        if (deltaTime) {
            this.pulseTime += deltaTime * 3;
            const pulseFactor = 0.8 + Math.sin(this.pulseTime) * 0.2;
            (this.coreMesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * pulseFactor;
            (this.glowMesh.material as THREE.MeshBasicMaterial).opacity = 0.3 * pulseFactor;
        }
    }

    public destroy() {
        this.scene.remove(this.beamGroup);
        this.coreMesh.geometry.dispose();
        this.glowMesh.geometry.dispose();
        (this.coreMesh.material as THREE.Material).dispose();
        (this.glowMesh.material as THREE.Material).dispose();
    }
}
