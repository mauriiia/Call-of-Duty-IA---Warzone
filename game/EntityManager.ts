import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PhysicsWorld } from './PhysicsWorld';
import { AssetLoader } from './AssetLoader';

interface TargetEntity {
    id: number;
    mesh: THREE.Group;
    body: CANNON.Body;
    hp: number;
    active: boolean; // For Time Trial
}

export class EntityManager {
    public targets: TargetEntity[] = [];
    private scene: THREE.Scene;
    private physics: PhysicsWorld;
    private nextId: number = 0;
    
    // Locations for time trial
    private initialLocations = [
            { x: -6, z: -5 },
            { x: 6, z: -12 },
            { x: -2, z: -25 }, 
            { x: 10, z: 5 },
            { x: -10, z: 15 },
            { x: 0, z: 30 }
    ];

    constructor(scene: THREE.Scene, physics: PhysicsWorld) {
        this.scene = scene;
        this.physics = physics;
        this.spawnInitialTargets();
    }

    private spawnInitialTargets() {
        this.initialLocations.forEach(loc => {
            this.spawnTargetDummy(loc.x, 0.1, loc.z);
        });
    }

    public resetTargets() {
        // Respawn or Reset HP
        this.targets.forEach((t, i) => {
             const loc = this.initialLocations[i % this.initialLocations.length];
             t.active = true;
             t.hp = 100;
             t.mesh.visible = true;
             // Reset Physics
             t.body.position.set(loc.x, 0.9, loc.z);
             t.body.quaternion.set(0,0,0,1);
             t.body.velocity.set(0,0,0);
             t.body.angularVelocity.set(0,0,0);
             
             // Reset Color
             t.mesh.traverse(o => {
                 if (o instanceof THREE.Mesh && o.name === 'TARGET_BODY') {
                      (o.material as THREE.MeshStandardMaterial).emissive.setHex(0x220000);
                 }
             });
        });
    }
    
    public getActiveCount(): number {
        return this.targets.filter(t => t.active).length;
    }

    // Creates a Simple Target Dummy: Base -> Pole -> Red Box
    public spawnTargetDummy(x: number, y: number, z: number) {
        const group = new THREE.Group();
        group.position.set(x, y, z);
        this.scene.add(group);

        const mats = AssetLoader.getInstance().materials;

        // 1. Base (Heavy Stand) - Grey Cylinder
        const baseGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.1, 16);
        const base = new THREE.Mesh(baseGeo, mats['dummy_dark']);
        base.position.y = 0.05;
        base.castShadow = true;
        base.receiveShadow = true;
        group.add(base);

        // 2. Pole - Thin Cylinder
        const poleGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.2, 8);
        const pole = new THREE.Mesh(poleGeo, mats['dummy_metal']);
        pole.position.y = 0.65;
        pole.castShadow = true;
        group.add(pole);

        // 3. Body - Red Box
        const bodyGeo = new THREE.BoxGeometry(0.5, 0.6, 0.2);
        const bodyMesh = new THREE.Mesh(bodyGeo, mats['dummy_body']); // Uses 0xff0000 RED
        bodyMesh.position.y = 1.35; // 0.1 (base) + 1.2 (pole) -> Center approx
        bodyMesh.castShadow = true;
        bodyMesh.name = 'TARGET_BODY';
        
        // Add a "target circle" texture or geometry for visual flair
        const center = new THREE.Mesh(new THREE.CircleGeometry(0.15, 16), mats['dummy_dark']);
        center.position.z = 0.11;
        center.position.y = 0;
        bodyMesh.add(center);
        
        group.add(bodyMesh);

        // Physics Body (Simple Box wrapping the upper part)
        const shape = new CANNON.Box(new CANNON.Vec3(0.3, 0.9, 0.3));
        const body = new CANNON.Body({
            mass: 15, // Light enough to react to shots
            shape: shape,
            material: this.physics.getMaterial('object'),
            angularDamping: 0.9, 
            linearDamping: 0.9
        });
        body.position.set(x, 0.9, z); 
        
        this.physics.world.addBody(body);

        this.targets.push({
            id: this.nextId++,
            mesh: group,
            body,
            hp: 100,
            active: true
        });
    }

    public update() {
        this.targets.forEach(t => {
            t.mesh.position.copy(t.body.position as any);
            t.mesh.quaternion.copy(t.body.quaternion as any);
            
            // Correction offset because Physics body center != Mesh pivot
            const offset = new THREE.Vector3(0, -0.9, 0); 
            offset.applyQuaternion(t.mesh.quaternion);
            t.mesh.position.add(offset);

            // Reset if fallen off map
            if (t.body.position.y < -10) {
                this.respawn(t);
            }
        });
    }

    public checkHit(raycaster: THREE.Raycaster): boolean {
        // Recursive intersection to hit children
        const allMeshes = this.targets.map(t => t.mesh);
        const intersects = raycaster.intersectObjects(allMeshes, true);
        
        if (intersects.length > 0) {
            const hitObj = intersects[0].object;
            // Traverse up to find which group this mesh belongs to
            let currentObj = hitObj;
            let target: TargetEntity | undefined;
            
            while(currentObj.parent) {
                target = this.targets.find(t => t.mesh === currentObj);
                if (target) break;
                currentObj = currentObj.parent;
            }

            // Hit!
            if (target && target.active) {
                this.applyDamage(target, hitObj as THREE.Mesh, intersects[0].point, raycaster.ray.direction);
                return true;
            }
        }
        return false;
    }

    private applyDamage(target: TargetEntity, hitPart: THREE.Mesh, point: THREE.Vector3, dir: THREE.Vector3) {
        // Physics Impulse
        const force = dir.clone().multiplyScalar(15);
        force.y += 2; // Slight lift
        
        const canonPoint = new CANNON.Vec3(point.x, point.y, point.z);
        const canonForce = new CANNON.Vec3(force.x, force.y, force.z);
        target.body.applyImpulse(canonForce, canonPoint);

        // Target Logic (If destroyed/hit)
        // For Time Trial, 1 hit = Deactivate
        target.active = false; 
        
        // Visual Flash Logic (Feedback)
        // Checks if it's the Red Box or other parts
        if (hitPart.material instanceof THREE.MeshStandardMaterial) {
            const mat = hitPart.material;
            const oldEmissive = mat.emissive.getHex();
            const oldIntensity = mat.emissiveIntensity;

            // Flash White
            mat.emissive.setHex(0x00ff00); // Green for "Done"
            mat.emissiveIntensity = 5.0; // High intensity flash

            // Don't revert if inactive? Or revert to "Dead" color?
            // Let's keep it Green to show it's hit
        }
    }

    private respawn(target: TargetEntity) {
        target.body.position.set(target.body.position.x, 2, target.body.position.z);
        target.body.quaternion.set(0,0,0,1);
        target.body.velocity.set(0,0,0);
        target.body.angularVelocity.set(0,0,0);
    }
}