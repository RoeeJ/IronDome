import * as THREE from 'three';

export class OptimizedInstancedRenderer {
    constructor(geometry, material, maxInstances = 1000) {
        this.geometry = geometry;
        this.material = material;
        this.maxInstances = maxInstances;
        this.currentInstances = 0;
        this.entities = new Map();
        this.entitiesList = [];
        
        // Create instanced mesh
        this.mesh = new THREE.InstancedMesh(geometry, material, maxInstances);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.frustumCulled = false; // We'll handle culling manually
        
        // Optimization: Disable shadows for performance-heavy objects
        this.mesh.castShadow = false;
        this.mesh.receiveShadow = false;
        
        // Pre-allocate matrices
        this.tempMatrix = new THREE.Matrix4();
        this.tempPosition = new THREE.Vector3();
        this.tempQuaternion = new THREE.Quaternion();
        this.tempScale = new THREE.Vector3();
        
        // Visibility tracking
        this.visibilityBuffer = new Float32Array(maxInstances);
        this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
            new Float32Array(maxInstances * 3).fill(1), 3
        );
    }
    
    add(entity) {
        if (this.entities.has(entity)) return;
        
        // CRITICAL: Remove the entity's mesh from scene to prevent double rendering
        if (entity.mesh && entity.mesh.parent) {
            entity.mesh.removeFromParent();
            entity.mesh.visible = false;
        }
        
        const index = this.currentInstances++;
        this.entities.set(entity, index);
        this.entitiesList[index] = entity;
        
        // Store original visibility state
        entity._originalVisible = entity.visible !== false;
        
        this.updateInstance(entity);
    }
    
    remove(entity) {
        if (!this.entities.has(entity)) return;
        
        const index = this.entities.get(entity);
        this.entities.delete(entity);
        
        // Swap with last element for efficient removal
        const lastIndex = --this.currentInstances;
        if (index !== lastIndex) {
            const lastEntity = this.entitiesList[lastIndex];
            this.entitiesList[index] = lastEntity;
            this.entities.set(lastEntity, index);
        }
        
        this.entitiesList[lastIndex] = null;
        
        // Restore entity's mesh if needed
        if (entity.mesh) {
            entity.mesh.visible = true;
        }
        
        this.mesh.count = this.currentInstances;
    }
    
    updateInstance(entity) {
        const index = this.entities.get(entity);
        if (index === undefined) return;
        
        // Use entity's world matrix if available, otherwise compute from position/rotation
        if (entity.mesh && entity.mesh.matrixWorld) {
            this.mesh.setMatrixAt(index, entity.mesh.matrixWorld);
        } else if (entity.position && entity.quaternion) {
            this.tempMatrix.compose(
                entity.position,
                entity.quaternion,
                entity.scale || this.tempScale.set(1, 1, 1)
            );
            this.mesh.setMatrixAt(index, this.tempMatrix);
        }
        
        // Update visibility through color (alpha not supported in instanced rendering)
        const visible = entity.visible !== false && entity._originalVisible;
        if (!visible) {
            this.mesh.setColorAt(index, new THREE.Color(0, 0, 0));
        } else if (entity.color) {
            this.mesh.setColorAt(index, entity.color);
        }
    }
    
    update(camera) {
        // Batch update all instances
        for (let i = 0; i < this.currentInstances; i++) {
            const entity = this.entitiesList[i];
            if (entity) {
                this.updateInstance(entity);
            }
        }
        
        // Update instance count
        this.mesh.count = this.currentInstances;
        
        // Mark for GPU update
        if (this.currentInstances > 0) {
            this.mesh.instanceMatrix.needsUpdate = true;
            if (this.mesh.instanceColor) {
                this.mesh.instanceColor.needsUpdate = true;
            }
        }
    }
    
    setFrustumCulling(enabled) {
        this.mesh.frustumCulled = enabled;
    }
    
    setShadows(cast, receive) {
        this.mesh.castShadow = cast;
        this.mesh.receiveShadow = receive;
    }
    
    dispose() {
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
        if (this.mesh.parent) {
            this.mesh.removeFromParent();
        }
        this.entities.clear();
        this.entitiesList = [];
    }
    
    // Get statistics
    getStats() {
        return {
            instances: this.currentInstances,
            maxInstances: this.maxInstances,
            utilization: (this.currentInstances / this.maxInstances) * 100
        };
    }
}

// Specialized renderer for projectile trails
export class InstancedTrailRenderer extends THREE.EventDispatcher {
    constructor(maxTrails = 500, maxPointsPerTrail = 50) {
        super();
        this.maxTrails = maxTrails;
        this.maxPointsPerTrail = maxPointsPerTrail;
        this.trails = new Map();
        this.currentTrails = 0;
        this.trailIndexPool = [];
        
        // Initialize index pool
        for (let i = 0; i < maxTrails; i++) {
            this.trailIndexPool.push(i);
        }
        
        // Create merged geometry for all trails
        const positions = new Float32Array(maxTrails * maxPointsPerTrail * 3);
        const colors = new Float32Array(maxTrails * maxPointsPerTrail * 3);
        const sizes = new Float32Array(maxTrails * maxPointsPerTrail);
        
        this.geometry = new THREE.BufferGeometry();
        this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        this.geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        
        // Use point cloud material for performance
        this.material = new THREE.PointsMaterial({
            vertexColors: true,
            size: 2,
            sizeAttenuation: true,
            blending: THREE.AdditiveBlending,
            transparent: true,
            opacity: 0.6
        });
        
        this.mesh = new THREE.Points(this.geometry, this.material);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 10; // Render after opaque objects
    }
    
    addTrail(entity, color = new THREE.Color(1, 0.5, 0)) {
        if (this.trails.has(entity) || this.trailIndexPool.length === 0) {
            return false;
        }
        
        const trailIndex = this.trailIndexPool.pop();
        this.currentTrails++;
        this.trails.set(entity, {
            index: trailIndex,
            points: [],
            currentPoint: 0,
            color: color,
            lastUpdate: Date.now()
        });
        
        // Remove individual trail mesh if exists
        if (entity.trail && entity.trail.parent) {
            entity.trail.removeFromParent();
            if (entity.trail.geometry) entity.trail.geometry.dispose();
            if (entity.trail.material && entity.trail.material.dispose) entity.trail.material.dispose();
            entity.trail = null;
        }
        
        // Also remove from UnifiedTrailSystem if it exists
        if (window.UnifiedTrailSystem?.getInstance) {
            try {
                const unifiedSystem = window.UnifiedTrailSystem.getInstance();
                unifiedSystem.removeTrail(entity.id);
            } catch (e) {
                // Ignore if not available
            }
        }
        
        return true;
    }
    
    updateTrail(entity) {
        const trail = this.trails.get(entity);
        if (!trail) return;
        
        const baseIndex = trail.index * this.maxPointsPerTrail * 3;
        const positions = this.geometry.attributes.position.array;
        const colors = this.geometry.attributes.color.array;
        const sizes = this.geometry.attributes.size.array;
        
        // Add new point
        if (entity.position) {
            trail.points.push({
                x: entity.position.x,
                y: entity.position.y,
                z: entity.position.z,
                time: Date.now()
            });
            
            // Limit trail length
            if (trail.points.length > this.maxPointsPerTrail) {
                trail.points.shift();
            }
        }
        
        // Update geometry
        const now = Date.now();
        for (let i = 0; i < this.maxPointsPerTrail; i++) {
            const idx = baseIndex + i * 3;
            const sizeIdx = trail.index * this.maxPointsPerTrail + i;
            
            if (i < trail.points.length) {
                const point = trail.points[i];
                const age = (now - point.time) / 1000; // seconds
                const alpha = Math.max(0, 1 - age * 2); // Fade over 0.5 seconds
                
                positions[idx] = point.x;
                positions[idx + 1] = point.y;
                positions[idx + 2] = point.z;
                
                // Color based on entity type
                const color = trail.color || entity.trailColor || new THREE.Color(1, 0.5, 0);
                colors[idx] = color.r * alpha;
                colors[idx + 1] = color.g * alpha;
                colors[idx + 2] = color.b * alpha;
                
                sizes[sizeIdx] = (1 - i / trail.points.length) * 3 * alpha;
            } else {
                // Hide unused points
                positions[idx] = 0;
                positions[idx + 1] = -1000;
                positions[idx + 2] = 0;
                sizes[sizeIdx] = 0;
            }
        }
    }
    
    removeTrail(entity) {
        const trail = this.trails.get(entity);
        if (!trail) return;
        
        // Clear trail data
        const baseIndex = trail.index * this.maxPointsPerTrail * 3;
        const positions = this.geometry.attributes.position.array;
        const sizes = this.geometry.attributes.size.array;
        const sizeBaseIndex = trail.index * this.maxPointsPerTrail;
        
        for (let i = 0; i < this.maxPointsPerTrail; i++) {
            const idx = baseIndex + i * 3;
            positions[idx] = 0;
            positions[idx + 1] = -1000;
            positions[idx + 2] = 0;
            sizes[sizeBaseIndex + i] = 0;
        }
        
        // Return index to pool
        this.trailIndexPool.push(trail.index);
        this.currentTrails--;
        this.trails.delete(entity);
    }
    
    update() {
        // Update all active trails
        for (const [entity, trail] of this.trails) {
            this.updateTrail(entity);
        }
        
        // Mark attributes for update
        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.color.needsUpdate = true;
        this.geometry.attributes.size.needsUpdate = true;
    }
    
    dispose() {
        this.geometry.dispose();
        this.material.dispose();
        if (this.mesh.parent) {
            this.mesh.removeFromParent();
        }
        this.trails.clear();
    }
}

// Batch renderer for static world geometry
export class StaticGeometryBatcher {
    static batchGeometries(meshes, options = {}) {
        const {
            mergeByMaterial = true,
            generateLightmapUVs = false,
            computeBoundingSphere = true
        } = options;
        
        // Group meshes by material
        const materialGroups = new Map();
        
        for (const mesh of meshes) {
            if (!mesh.geometry || !mesh.material) continue;
            
            const key = mergeByMaterial ? mesh.material.uuid : 'default';
            if (!materialGroups.has(key)) {
                materialGroups.set(key, {
                    material: mesh.material,
                    meshes: []
                });
            }
            materialGroups.get(key).meshes.push(mesh);
        }
        
        // Create merged meshes
        const mergedMeshes = [];
        
        for (const [key, group] of materialGroups) {
            const geometries = [];
            
            for (const mesh of group.meshes) {
                const geometry = mesh.geometry.clone();
                geometry.applyMatrix4(mesh.matrixWorld);
                geometries.push(geometry);
                
                // Remove original mesh
                mesh.removeFromParent();
                mesh.geometry.dispose();
            }
            
            // Merge geometries
            const mergedGeometry = THREE.BufferGeometryUtils.mergeGeometries(
                geometries,
                false
            );
            
            if (computeBoundingSphere) {
                mergedGeometry.computeBoundingSphere();
            }
            
            const mergedMesh = new THREE.Mesh(mergedGeometry, group.material);
            mergedMesh.castShadow = false; // Static geometry usually doesn't need shadows
            mergedMesh.receiveShadow = true;
            
            mergedMeshes.push(mergedMesh);
        }
        
        return mergedMeshes;
    }
}