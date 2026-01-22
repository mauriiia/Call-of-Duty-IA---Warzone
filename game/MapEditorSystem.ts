
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Player } from './Player';
import { World } from './World';
import { PhysicsWorld } from './PhysicsWorld';
import { InputManager } from './InputManager';
import { AssetLoader } from './AssetLoader';

export type ToolType = 'BULLDOZER' | 'ROAD' | 'BUILDING' | 'TREE' | 'ROCK' | 'GRASS' | 'WALL';

interface MapObjectData {
    type: ToolType;
    x: number;
    y: number;
    z: number;
    rotationY: number;
}

interface EditorAction {
    mesh: THREE.Object3D;
    body: CANNON.Body;
    data: MapObjectData;
}

export class MapEditorSystem {
    private scene: THREE.Scene;
    private world: World;
    private physics: PhysicsWorld;
    private raycaster: THREE.Raycaster;
    
    // RTS Camera State
    private cameraPos = new THREE.Vector3(0, 100, 100);
    private cameraTarget = new THREE.Vector3(0, 0, 0);
    private cameraZoom = 100;
    
    // Editor State
    public activeTool: ToolType = 'ROAD';
    private ghostMesh: THREE.Mesh;
    private ghostMaterial: THREE.MeshBasicMaterial;
    
    // Selection / Highlight
    private selectionBox: THREE.BoxHelper;
    public currentCursorPos: THREE.Vector3 = new THREE.Vector3();
    public currentHoveredObject: string = "None";
    
    // Save & Undo System
    private placedObjects: EditorAction[] = [];
    private savedMapName = 'PROTON_MAP_V1';
    
    // Input Handling State
    private lastActionTime: number = 0;
    public currentRotation: number = 0;
    private wasRPressed: boolean = false;
    private wasZPressed: boolean = false; // Undo
    private wasSPressed: boolean = false; // Save
    private wasMousePressed: boolean = false; // For single-click actions
    
    constructor(scene: THREE.Scene, world: World, physics: PhysicsWorld) {
        this.scene = scene;
        this.world = world;
        this.physics = physics;
        this.raycaster = new THREE.Raycaster();
        
        // Materials
        this.ghostMaterial = new THREE.MeshBasicMaterial({ 
            color: 0x00ff88, // Neon Green
            transparent: true, 
            opacity: 0.5, 
            wireframe: false 
        });
        
        this.ghostMesh = new THREE.Mesh(new THREE.BoxGeometry(1,1,1), this.ghostMaterial);
        this.scene.add(this.ghostMesh);
        this.ghostMesh.visible = false;

        // Selection Box (For Bulldozer)
        this.selectionBox = new THREE.BoxHelper(this.ghostMesh, 0xff0000);
        this.selectionBox.visible = false;
        this.scene.add(this.selectionBox);
        
        // Listen to scroll for Zoom
        window.addEventListener('wheel', (e) => {
            if (this.isEditorActive()) {
                this.cameraZoom += e.deltaY * 0.1;
                this.cameraZoom = Math.max(20, Math.min(200, this.cameraZoom));
            }
        }, { passive: true });
        
        // Note: loadMap() is called explicitly by Engine now to avoid race conditions
    }

    private isEditorActive(): boolean {
        return true; 
    }

    public update(player: Player, input: InputManager, dt: number) {
        // 1. Update RTS Camera
        this.updateCamera(player.camera, input, dt);

        // 2. Mouse Interaction
        this.handleCursor(player.camera, input);

        // 3. Shortcuts
        this.handleShortcuts(input);

        // 4. Input State Update
        this.wasMousePressed = input.isMouseDown;
    }

    private handleShortcuts(input: InputManager) {
        // ROTATE (R)
        if (input.keys['KeyR'] && !this.wasRPressed) {
            this.rotate();
            this.wasRPressed = true;
        } else if (!input.keys['KeyR']) {
            this.wasRPressed = false;
        }

        // UNDO (Ctrl + Z)
        const ctrl = input.keys['ControlLeft'] || input.keys['ControlRight'];
        if (ctrl && input.keys['KeyZ'] && !this.wasZPressed) {
            this.undo();
            this.wasZPressed = true;
        } else if (!input.keys['KeyZ']) {
            this.wasZPressed = false;
        }

        // SAVE (Ctrl + S)
        if (ctrl && input.keys['KeyS'] && !this.wasSPressed) {
            this.saveMap();
            this.wasSPressed = true;
        } else if (!input.keys['KeyS']) {
            this.wasSPressed = false;
        }
    }

    private rotate() {
        this.currentRotation += Math.PI / 2; // Rotate 90 degrees
        this.currentRotation %= (Math.PI * 2);
    }

    public undo() {
        if (this.placedObjects.length === 0) return;
        
        const lastAction = this.placedObjects.pop();
        if (lastAction) {
            this.world.mapGenerator.removeSpecificObject(lastAction.mesh, lastAction.body);
        }
    }

    public saveMap() {
        const dataToSave = this.placedObjects.map(obj => obj.data);
        if (dataToSave.length === 0) {
            alert("Nothing to save!");
            return;
        }
        localStorage.setItem(this.savedMapName, JSON.stringify(dataToSave));
        alert(`Map saved! (${dataToSave.length} objects)`);
    }

    public loadMap() {
        const json = localStorage.getItem(this.savedMapName);
        if (!json) return;

        try {
            const data: MapObjectData[] = JSON.parse(json);
            // Clear internal tracking (visuals cleared by generator usually)
            this.placedObjects = [];
            
            // Reconstruct and track
            data.forEach(objData => {
                this.placeObjectInternal(objData);
            });
            console.log(`Editor loaded: ${data.length} saved objects.`);
        } catch (e) {
            console.error("Failed to load map data", e);
        }
    }

    private updateCamera(camera: THREE.Camera, input: InputManager, dt: number) {
        const moveSpeed = input.keys['ShiftLeft'] ? 100 : 40;
        const moveDir = new THREE.Vector3();

        if (input.keys['KeyW']) moveDir.z -= 1;
        if (input.keys['KeyS']) moveDir.z += 1;
        if (input.keys['KeyA']) moveDir.x -= 1;
        if (input.keys['KeyD']) moveDir.x += 1;

        if (moveDir.lengthSq() > 0) moveDir.normalize().multiplyScalar(moveSpeed * dt);

        this.cameraTarget.add(moveDir);
        
        const angle = Math.PI / 3; 
        const yOffset = Math.sin(angle) * this.cameraZoom;
        const zOffset = Math.cos(angle) * this.cameraZoom;

        const desiredPos = this.cameraTarget.clone().add(new THREE.Vector3(0, yOffset, zOffset));
        this.cameraPos.lerp(desiredPos, dt * 5);
        
        camera.position.copy(this.cameraPos);
        camera.lookAt(this.cameraTarget);
    }

    private handleCursor(camera: THREE.Camera, input: InputManager) {
        this.raycaster.setFromCamera(new THREE.Vector2(input.mouseNDC.x, input.mouseNDC.y), camera);
        const intersects = this.raycaster.intersectObjects(this.scene.children, true);
        
        let groundHit: THREE.Vector3 | null = null;
        let objectHit: THREE.Object3D | null = null;
        let instanceId: number | undefined;

        for (const hit of intersects) {
            // Ignore Tools/Helpers
            if (hit.object.name === 'Ghost') continue;
            if (hit.object.type === 'LineSegments') continue; // BoxHelper
            if (hit.object.name.includes('Player')) continue; 

            // Detect valid object for Demolish
            if (!objectHit && hit.object.name !== 'Sky' && !this.isEnvironment(hit.object)) {
                objectHit = hit.object;
                instanceId = hit.instanceId;
            }

            // Detect Ground
            if (!groundHit) {
                 groundHit = hit.point;
            }
        }

        // Infinite Plane fallback
        if (!groundHit) {
            const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
            const target = new THREE.Vector3();
            this.raycaster.ray.intersectPlane(plane, target);
            if (target) groundHit = target;
        }

        if (this.activeTool === 'BULLDOZER') {
            this.handleBulldozer(objectHit, instanceId, input);
        } else {
            if (groundHit) {
                this.handlePlacement(groundHit, input);
            }
        }
    }

    private isEnvironment(obj: THREE.Object3D): boolean {
        // Helper to identify things we shouldn't delete easily
        return obj.name.includes('Ground') || obj.name.includes('Water') || obj.name === 'Sky';
    }

    private handleBulldozer(obj: THREE.Object3D | null, instanceId: number | undefined, input: InputManager) {
        this.ghostMesh.visible = false;
        
        if (obj) {
            // Highlight logic
            let targetRoot = obj;
            // Traverse up to find the "Item" root, but stop before Scene
            while(targetRoot.parent && targetRoot.parent.type !== 'Scene') {
                targetRoot = targetRoot.parent;
            }

            // Update Selection Box
            this.selectionBox.setFromObject(targetRoot);
            this.selectionBox.visible = true;
            this.currentHoveredObject = "Target: " + (targetRoot.name || targetRoot.type);

            // DELETE ACTION: Require a FRESH click (not holding down)
            if (input.isMouseDown && !this.wasMousePressed) {
                this.removeObject(targetRoot, instanceId);
                // Clear selection after delete
                this.selectionBox.visible = false;
            }
        } else {
            this.selectionBox.visible = false;
            this.currentHoveredObject = "None";
        }
    }

    private handlePlacement(pos: THREE.Vector3, input: InputManager) {
        this.ghostMesh.visible = true;
        this.ghostMesh.material = this.ghostMaterial; 
        this.selectionBox.visible = false;

        // Snapping
        const GRID = (this.activeTool === 'ROAD' || this.activeTool === 'BUILDING') ? 5 : 0.5;
        const gx = Math.round(pos.x / GRID) * GRID;
        const gz = Math.round(pos.z / GRID) * GRID;
        const gy = pos.y; 

        this.ghostMesh.position.set(gx, gy, gz);
        this.ghostMesh.rotation.set(0, this.currentRotation, 0);
        
        this.currentCursorPos.set(gx, gy, gz);
        this.currentHoveredObject = "Ready to Place";

        // ACTION: Allow holding for trees/rocks, but single click for buildings
        const isContinuous = (this.activeTool === 'TREE' || this.activeTool === 'GRASS');
        const canPlace = isContinuous ? input.isMouseDown : (input.isMouseDown && !this.wasMousePressed);

        if (canPlace && performance.now() - this.lastActionTime > (isContinuous ? 100 : 200)) {
            const data: MapObjectData = {
                type: this.activeTool,
                x: gx, y: gy, z: gz,
                rotationY: this.currentRotation
            };
            this.placeObjectInternal(data);
            this.lastActionTime = performance.now();
        }
    }

    public setTool(tool: ToolType) {
        this.activeTool = tool;
        this.currentRotation = 0; 
        this.updateGhostGeometry();
    }

    private updateGhostGeometry() {
        this.scene.remove(this.ghostMesh);
        this.selectionBox.visible = false; // Hide selection when switching tools
        
        if (this.activeTool === 'BULLDOZER') {
            this.ghostMesh.visible = false;
            return;
        }

        let geo: THREE.BufferGeometry;
        
        if (this.activeTool === 'ROAD') {
            geo = new THREE.PlaneGeometry(8, 8);
            geo.rotateX(-Math.PI/2);
        }
        else if (this.activeTool === 'BUILDING') {
            geo = new THREE.BoxGeometry(10, 6, 10);
            geo.translate(0, 3, 0); 
        }
        else if (this.activeTool === 'WALL') {
             geo = new THREE.BoxGeometry(4, 3, 0.5);
             geo.translate(0, 1.5, 0);
        }
        else if (this.activeTool === 'TREE') {
            geo = new THREE.ConeGeometry(1, 4, 8);
            geo.translate(0, 2, 0);
        } 
        else if (this.activeTool === 'ROCK') {
            geo = new THREE.DodecahedronGeometry(1.0);
        }
        else {
             geo = new THREE.BoxGeometry(1,1,1);
        }
        
        this.ghostMesh = new THREE.Mesh(geo, this.ghostMaterial);
        this.ghostMesh.name = 'Ghost';
        this.scene.add(this.ghostMesh);
    }

    // Unified placement logic for both Mouse Interaction and Load
    private placeObjectInternal(data: MapObjectData) {
        // Delegate to MapGenerator for actual spawning logic
        const result = this.world.mapGenerator.spawnObject(
            data.type, 
            data.x, 
            data.y, 
            data.z, 
            data.rotationY
        );

        if (result) {
            this.placedObjects.push({
                mesh: result.mesh,
                body: result.body,
                data: data
            });
        }
    }

    private removeObject(root: THREE.Object3D, instanceId: number | undefined) {
        if (!root) return;
        if (this.isEnvironment(root)) return;

        // Special handling for InstancedMesh (optimization)
        if (root instanceof THREE.InstancedMesh && instanceId !== undefined) {
            // Hiding specific instance only visually
            const matrix = new THREE.Matrix4();
            matrix.makeScale(0, 0, 0); 
            root.setMatrixAt(instanceId, matrix);
            root.instanceMatrix.needsUpdate = true;
            return;
        }
        
        // Find in placedObjects to remove from history and physics
        const idx = this.placedObjects.findIndex(po => po.mesh === root);
        if (idx !== -1) {
            const po = this.placedObjects[idx];
            this.world.mapGenerator.removeSpecificObject(po.mesh, po.body);
            this.placedObjects.splice(idx, 1);
        } else {
            // It's a procedural object not tracked by editor history, just remove raw
            this.scene.remove(root);
            if ((root as any).userData && (root as any).userData.physicsBody) {
                 this.physics.world.removeBody((root as any).userData.physicsBody);
            } else if ((root as any).physicsBody) {
                 this.physics.world.removeBody((root as any).physicsBody);
            }
        }
    }
}
