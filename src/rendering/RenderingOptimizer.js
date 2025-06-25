import * as THREE from 'three';
import { TextureCache } from '../utils/TextureCache.ts';

export class RenderingOptimizer {
    constructor(scene, renderer, camera) {
        this.scene = scene;
        this.renderer = renderer;
        this.camera = camera;
        
        // Shadow optimization
        this.shadowLOD = {
            near: 50,    // Full shadows
            medium: 150, // Reduced shadows  
            far: 300     // No shadows
        };
        
        // Visibility culling
        this.frustum = new THREE.Frustum();
        this.frustumMatrix = new THREE.Matrix4();
        
        // Performance metrics
        this.stats = {
            totalObjects: 0,
            visibleObjects: 0,
            culledObjects: 0,
            shadowCasters: 0,
            drawCalls: 0
        };
    }
    
    optimizeScene() {
        // 1. Shadow optimization
        this.optimizeShadows();
        
        // 2. Visibility culling
        this.performFrustumCulling();
        
        // 3. LOD updates
        this.updateLODs();
        
        // 4. Material optimization
        this.optimizeMaterials();
        
        return this.stats;
    }
    
    optimizeShadows() {
        const cameraPosition = this.camera.position;
        let shadowCasters = 0;
        
        this.scene.traverse((object) => {
            if (object.isMesh && object.castShadow) {
                const distance = object.position.distanceTo(cameraPosition);
                
                if (distance > this.shadowLOD.far) {
                    object.castShadow = false;
                } else if (distance > this.shadowLOD.medium) {
                    // Only large objects cast shadows at medium distance
                    const size = object.geometry.boundingSphere?.radius || 1;
                    object.castShadow = size > 2;
                } else {
                    object.castShadow = true;
                    shadowCasters++;
                }
            }
        });
        
        this.stats.shadowCasters = shadowCasters;
    }
    
    performFrustumCulling() {
        // Update frustum
        this.frustumMatrix.multiplyMatrices(
            this.camera.projectionMatrix,
            this.camera.matrixWorldInverse
        );
        this.frustum.setFromProjectionMatrix(this.frustumMatrix);
        
        let visible = 0;
        let culled = 0;
        
        this.scene.traverse((object) => {
            if (object.isMesh) {
                // Skip if already invisible
                if (!object.visible) return;
                
                // Check if object is in frustum
                if (object.geometry.boundingSphere) {
                    object.geometry.computeBoundingSphere();
                }
                
                if (object.geometry.boundingSphere) {
                    const sphere = object.geometry.boundingSphere.clone();
                    sphere.applyMatrix4(object.matrixWorld);
                    
                    if (this.frustum.intersectsSphere(sphere)) {
                        visible++;
                    } else {
                        object.visible = false;
                        culled++;
                    }
                }
            }
        });
        
        this.stats.visibleObjects = visible;
        this.stats.culledObjects = culled;
    }
    
    updateLODs() {
        const cameraPosition = this.camera.position;
        
        this.scene.traverse((object) => {
            if (object.isLOD) {
                object.update(this.camera);
            } else if (object.isMesh && object.userData.lod) {
                // Custom LOD logic for specific objects
                const distance = object.position.distanceTo(cameraPosition);
                const lodLevel = this.getLODLevel(distance);
                
                if (object.userData.currentLOD !== lodLevel) {
                    this.applyLOD(object, lodLevel);
                    object.userData.currentLOD = lodLevel;
                }
            }
        });
    }
    
    getLODLevel(distance) {
        if (distance < 50) return 0;  // High detail
        if (distance < 150) return 1; // Medium detail
        if (distance < 300) return 2; // Low detail
        return 3; // Very low detail
    }
    
    applyLOD(object, level) {
        // Reduce geometry detail based on LOD level
        if (object.geometry && object.userData.originalGeometry) {
            switch (level) {
                case 0: // Full detail
                    object.geometry = object.userData.originalGeometry;
                    break;
                case 1: // Medium detail
                    object.geometry = this.simplifyGeometry(
                        object.userData.originalGeometry, 0.7
                    );
                    break;
                case 2: // Low detail
                    object.geometry = this.simplifyGeometry(
                        object.userData.originalGeometry, 0.4
                    );
                    break;
                case 3: // Very low detail
                    object.geometry = this.simplifyGeometry(
                        object.userData.originalGeometry, 0.2
                    );
                    break;
            }
        }
    }
    
    simplifyGeometry(geometry, factor) {
        // Simple geometry reduction (in production, use proper simplification algorithm)
        // This is a placeholder - use THREE.SimplifyModifier or similar
        return geometry; // TODO: Implement actual simplification
    }
    
    optimizeMaterials() {
        const materialCache = new Map();
        
        this.scene.traverse((object) => {
            if (object.isMesh && object.material) {
                // Share materials with same properties
                const key = this.getMaterialKey(object.material);
                
                if (materialCache.has(key)) {
                    object.material = materialCache.get(key);
                } else {
                    materialCache.set(key, object.material);
                }
                
                // Optimize material based on distance
                const distance = object.position.distanceTo(this.camera.position);
                if (distance > 200) {
                    // Disable expensive features for distant objects
                    object.material.envMap = null;
                    object.material.aoMap = null;
                    object.material.normalMap = null;
                }
            }
        });
    }
    
    getMaterialKey(material) {
        // Create unique key based on material properties
        return `${material.type}_${material.color?.getHex()}_${material.transparent}_${material.opacity}`;
    }
    
    // Call this before render
    preRender() {
        this.optimizeScene();
        
        // Update renderer stats
        if (this.renderer.info) {
            this.stats.drawCalls = this.renderer.info.render.calls;
            this.stats.totalObjects = this.renderer.info.render.triangles;
        }
    }
    
    // Performance analysis
    analyzePerformance() {
        const analysis = {
            drawCalls: this.stats.drawCalls,
            recommendations: []
        };
        
        // Analyze shadow casters
        if (this.stats.shadowCasters > 20) {
            analysis.recommendations.push({
                issue: 'Too many shadow casters',
                count: this.stats.shadowCasters,
                suggestion: 'Reduce shadow casting objects or use shadow LOD'
            });
        }
        
        // Analyze visible objects
        if (this.stats.visibleObjects > 100) {
            analysis.recommendations.push({
                issue: 'Too many visible objects',
                count: this.stats.visibleObjects,
                suggestion: 'Implement object pooling or merge static geometry'
            });
        }
        
        // Analyze draw calls
        if (this.stats.drawCalls > 500) {
            analysis.recommendations.push({
                issue: 'High draw call count',
                count: this.stats.drawCalls,
                suggestion: 'Use instanced rendering or batch similar objects'
            });
        }
        
        return analysis;
    }
}

// Helper class for render order optimization
export class RenderOrderOptimizer {
    static optimize(scene) {
        const transparentObjects = [];
        const opaqueObjects = [];
        
        scene.traverse((object) => {
            if (object.isMesh) {
                if (object.material?.transparent) {
                    transparentObjects.push(object);
                } else {
                    opaqueObjects.push(object);
                }
            }
        });
        
        // Opaque objects render first (front to back)
        opaqueObjects.forEach((obj, index) => {
            obj.renderOrder = index;
        });
        
        // Transparent objects render last (back to front)
        transparentObjects.sort((a, b) => {
            return b.position.z - a.position.z;
        });
        
        transparentObjects.forEach((obj, index) => {
            obj.renderOrder = 1000 + index;
        });
    }
}

// Batch UI elements using CSS3D or sprites
export class UIBatchRenderer {
    constructor(scene, camera) {
        this.scene = scene;
        this.camera = camera;
        this.uiSprites = new Map();
        
        // Create sprite material for UI elements
        this.spriteMaterial = new THREE.SpriteMaterial({
            map: this.createUITexture(),
            sizeAttenuation: false
        });
    }
    
    createUITexture() {
        // Use shared texture cache to prevent shader program explosion
        const textureCache = TextureCache.getInstance();
        return textureCache.getParticleTexture(256, {
            inner: 'rgba(255, 0, 0, 0.8)',
            outer: 'rgba(255, 0, 0, 0.4)'
        });
    }
    
    addHealthBar(entity) {
        if (this.uiSprites.has(entity)) return;
        
        const sprite = new THREE.Sprite(this.spriteMaterial.clone());
        sprite.scale.set(2, 0.5, 1);
        this.uiSprites.set(entity, sprite);
        
        // Remove 3D health bar if exists
        if (entity.healthBar) {
            entity.healthBar.removeFromParent();
            entity.healthBar = null;
        }
        
        return sprite;
    }
    
    update() {
        for (const [entity, sprite] of this.uiSprites) {
            if (entity.position) {
                sprite.position.copy(entity.position);
                sprite.position.y += 3;
                
                // Billboard effect
                sprite.lookAt(this.camera.position);
            }
        }
    }
}