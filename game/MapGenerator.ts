
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { PhysicsWorld } from './PhysicsWorld';
import { AssetLoader } from './AssetLoader';
import { WATER_LEVEL } from '../constants'; 
import { TextureGenerator } from './TextureGenerator';
import { Water } from 'three/addons/objects/Water.js';

// --- CONFIGURAÇÃO OTIMIZADA DO MAPA ---
const MAP_SIZE = 600; 
const SEGMENTS = 100; 
const ELEMENT_SIZE = MAP_SIZE / SEGMENTS;

// ASSETS COUNTS 
const TREE_COUNT = 800; 
const ROCK_COUNT = 400; 
const CONTAINER_COUNT = 30; 
const GRASS_COUNT = 1500; 
const RUIN_COUNT = 15; 

// CITY CONFIG
const CITY_LEVEL = 15.0; 
const BLOCK_SIZE = 50; 
const ROAD_WIDTH = 12; 
const CITY_BLEND = 40;

interface TownConfig {
    x: number;
    y: number; 
    radius: number;
    density: number; 
    type: 'CITY' | 'VILLAGE';
    name: string; 
    themeColor: number; 
}

// Configuração para os Lagos
interface LakeConfig {
    x: number;
    y: number; // Z no mundo 3D
    radius: number;
}

interface RoadSegment {
    p1: THREE.Vector2;
    p2: THREE.Vector2;
    width: number;
}

export interface CoverPoint {
    position: THREE.Vector3;
    occupied: boolean;
}

export interface Region {
    name: string;
    x: number;
    z: number;
    radius: number;
}

export interface HouseOptions {
    width: number;
    depth: number;
    stories: number; // 1 or 2
    hasFence: boolean;
    hasPath: boolean;
    wallColor: number;
    hasStairs?: boolean;
}

export class MapGenerator {
  private scene: THREE.Scene;
  private physics: PhysicsWorld;
  
  // Instanced Meshes
  public treeMesh!: THREE.InstancedMesh;
  public rockMesh!: THREE.InstancedMesh;
  public containerMesh!: THREE.InstancedMesh;
  public grassMesh!: THREE.InstancedMesh;
  public wallMesh!: THREE.InstancedMesh;

  // Água Otimizada
  public waterMeshes: THREE.Object3D[] = [];
  private useHighQualityWater: boolean = false; // Estado interno
  
  // Tree Animation & Water Animation
  private treeUniforms = { uTime: { value: 0 } };
  private waterUniforms = { uTime: { value: 0 } }; // Usado apenas para a água simples

  // Helpers
  private dummy = new THREE.Object3D();
  
  // Cleanup Tracking
  private generatedBodies: CANNON.Body[] = [];
  private generatedMeshes: (THREE.Mesh | THREE.InstancedMesh | THREE.Group | THREE.Object3D)[] = [];

  // Gameplay Data
  public spawnPoints: THREE.Vector3[] = [];
  public coverPoints: CoverPoint[] = [];
  public patrolPoints: THREE.Vector3[] = [];
  public lootSpawns: THREE.Vector3[] = [];
  
  // Region Data
  public regions: Region[] = [];
  
  // Road Data
  private roads: RoadSegment[] = [];

  private towns: TownConfig[] = [
      { x: 0, y: 0, radius: 90, density: 0.6, type: 'CITY', name: 'Centro Residencial', themeColor: 0xcccccc },
      { x: 0, y: 220, radius: 60, density: 0.5, type: 'VILLAGE', name: 'Vila Norte', themeColor: 0x88aacc },
      { x: -220, y: 25, radius: 50, density: 0.6, type: 'VILLAGE', name: 'Posto Serrano', themeColor: 0x8b5a2b },
      { x: 170, y: -170, radius: 60, density: 0.5, type: 'VILLAGE', name: 'Porto Sul', themeColor: 0xeebb99 },
      { x: -150, y: 150, radius: 40, density: 0.4, type: 'VILLAGE', name: 'Refúgio Alpino', themeColor: 0x777777 }
  ];

  // Configuração dos 3 Lagos
  private lakes: LakeConfig[] = [
      { x: 100, y: 80, radius: 45 },  
      { x: -120, y: -100, radius: 35 }, 
      { x: 50, y: -200, radius: 30 }    
  ];

  constructor(scene: THREE.Scene, physics: PhysicsWorld) {
    this.scene = scene;
    this.physics = physics;
  }

  public clear() {
      // 1. Remove Physics Bodies
      this.generatedBodies.forEach(body => {
          this.physics.world.removeBody(body);
      });
      this.generatedBodies = [];

      // 2. Remove Visual Meshes
      this.generatedMeshes.forEach(mesh => {
          this.scene.remove(mesh);
          if (mesh instanceof THREE.Mesh && mesh.geometry) mesh.geometry.dispose();
      });
      this.generatedMeshes = [];

      // 3. Limpar Água
      this.waterMeshes.forEach(mesh => {
          this.scene.remove(mesh);
          if ((mesh as any).geometry) (mesh as any).geometry.dispose();
          if ((mesh as any).material) (mesh as any).material.dispose();
      });
      this.waterMeshes = [];

      // 4. Reset Data Structures
      this.spawnPoints = [];
      this.coverPoints = [];
      this.patrolPoints = [];
      this.lootSpawns = [];
      this.regions = [];
      this.roads = [];
  }
  
  public removeSpecificObject(mesh: THREE.Object3D, body: CANNON.Body) {
      this.scene.remove(mesh);
      this.physics.world.removeBody(body);
      this.generatedMeshes = this.generatedMeshes.filter(m => m !== mesh);
      this.generatedBodies = this.generatedBodies.filter(b => b !== body);
  }

  // --- CONFIGURAÇÃO DE GRÁFICOS ---
  public setWaterQuality(isHigh: boolean) {
      if (this.useHighQualityWater !== isHigh) {
          this.useHighQualityWater = isHigh;
          
          // Remove old water
          this.waterMeshes.forEach(mesh => {
              this.scene.remove(mesh);
              // Clean up memory
              if ((mesh as any).geometry) (mesh as any).geometry.dispose();
              if ((mesh as any).material) (mesh as any).material.dispose();
          });
          this.waterMeshes = [];

          // Create new water only if generation has already happened (scene isn't empty)
          // We check generatedMeshes length to infer if a map is loaded
          if (this.generatedMeshes.length > 0) {
              this.createLakes();
          }
      }
  }

  // --- PERSISTENCE HELPERS ---
  public loadMapData(data: any[]) {
      data.forEach(item => {
          this.spawnObject(item.type, item.x, item.y, item.z, item.rotationY);
      });
  }

  public spawnObject(type: string, x: number, y: number, z: number, rotationY: number) {
      const mats = AssetLoader.getInstance().materials;
      const pos = new THREE.Vector3(x, y, z);
      let result: { mesh: THREE.Object3D, body: CANNON.Body } | undefined;

      if (type === 'ROAD') {
            const geo = new THREE.PlaneGeometry(8, 8);
            geo.rotateX(-Math.PI/2);
            const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.9 }));
            mesh.position.copy(pos);
            mesh.position.y += 0.05; 
            mesh.rotation.y = rotationY;
            mesh.receiveShadow = true;
            this.scene.add(mesh);
            this.generatedMeshes.push(mesh);
            result = { mesh, body: new CANNON.Body() }; 
      }
      else if (type === 'BUILDING') {
          result = this.createHouse(x, y, z, rotationY, {
              width: 12, depth: 10, stories: 2,
              hasFence: true, hasPath: true, wallColor: 0xcccccc
          });
      }
      else if (type === 'TREE') {
          const mesh = this.createPineTreeModel(); 
          mesh.position.copy(pos);
          mesh.rotation.y = rotationY;
          mesh.castShadow = true;
          mesh.name = 'TREE';
          this.scene.add(mesh);
          this.generatedMeshes.push(mesh);
          
          const shape = new CANNON.Cylinder(0.3, 0.3, 2, 6);
          const body = new CANNON.Body({ mass: 0, shape, material: this.physics.getMaterial('object') });
          body.position.set(pos.x, pos.y + 1, pos.z);
          body.quaternion.setFromAxisAngle(new CANNON.Vec3(0,1,0), rotationY);
          this.physics.world.addBody(body);
          this.generatedBodies.push(body);
          (mesh as any).physicsBody = body;
          result = { mesh, body };
      }
      else if (type === 'ROCK') {
          const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(1.0, 0), new THREE.MeshStandardMaterial({ color: 0x555555 }));
          mesh.position.copy(pos);
          mesh.rotation.y = rotationY;
          mesh.castShadow = true;
          mesh.name = 'ROCK';
          this.scene.add(mesh);
          this.generatedMeshes.push(mesh);
          
          const shape = new CANNON.Sphere(1.0);
          const body = new CANNON.Body({ mass: 0, shape, material: this.physics.getMaterial('object') });
          body.position.copy(pos as any);
          body.quaternion.setFromAxisAngle(new CANNON.Vec3(0,1,0), rotationY);
          this.physics.world.addBody(body);
          this.generatedBodies.push(body);
          (mesh as any).physicsBody = body;
          result = { mesh, body };
      }
      else if (type === 'WALL') {
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 0.5), mats['wall_concrete']);
          mesh.position.copy(pos);
          mesh.position.y += 1.5;
          mesh.rotation.y = rotationY;
          mesh.name = 'WALL'; 
          this.scene.add(mesh);
          this.generatedMeshes.push(mesh);
          
          const shape = new CANNON.Box(new CANNON.Vec3(2, 1.5, 0.25));
          const body = new CANNON.Body({ mass: 0, shape, material: this.physics.getMaterial('object') });
          body.position.copy(mesh.position as any);
          body.quaternion.setFromAxisAngle(new CANNON.Vec3(0,1,0), rotationY);
          this.physics.world.addBody(body);
          this.generatedBodies.push(body);
          (mesh as any).physicsBody = body;
          result = { mesh, body };
      }

      return result;
  }

  // --- EDITOR MODE GENERATION ---
  public generateBlank() {
      this.clear();
      const groundHeight = 10.0;
      this.createFlatGround(groundHeight); 
      this.spawnPoints.push(new THREE.Vector3(0, groundHeight + 2, 0));
  }

  // --- TRAINING MODE GENERATION ---
  public generateTraining() {
      this.clear();
      const height = 10.0;
      
      const size = 200;
      const geo = new THREE.PlaneGeometry(size, size);
      const mat = AssetLoader.getInstance().materials['wall_concrete'];
      const ground = new THREE.Mesh(geo, mat);
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(0, height, 0);
      ground.receiveShadow = true;
      this.scene.add(ground);
      this.generatedMeshes.push(ground);

      const shape = new CANNON.Plane();
      const body = new CANNON.Body({ mass: 0, material: this.physics.getMaterial('ground') });
      body.addShape(shape);
      body.position.set(0, height, 0);
      body.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
      this.physics.world.addBody(body);
      this.generatedBodies.push(body);

      // Weapon Table
      const tableW = 8;
      const tableD = 2;
      const tableH = 1.0;
      const tableMesh = new THREE.Mesh(
          new THREE.BoxGeometry(tableW, 0.1, tableD),
          new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.6 })
      );
      tableMesh.position.set(0, height + tableH, 5); 
      tableMesh.castShadow = true;
      tableMesh.receiveShadow = true;
      this.scene.add(tableMesh);
      this.generatedMeshes.push(tableMesh);

      const legGeo = new THREE.BoxGeometry(0.2, tableH, 0.2);
      const legPositions = [
          [-tableW/2 + 0.2, -tableD/2 + 0.2],
          [tableW/2 - 0.2, -tableD/2 + 0.2],
          [-tableW/2 + 0.2, tableD/2 - 0.2],
          [tableW/2 - 0.2, tableD/2 - 0.2]
      ];
      legPositions.forEach(pos => {
          const leg = new THREE.Mesh(legGeo, new THREE.MeshStandardMaterial({color: 0x333333}));
          leg.position.set(pos[0], -tableH/2, pos[1]);
          tableMesh.add(leg);
      });

      const tableBody = new CANNON.Body({ mass: 0, material: this.physics.getMaterial('object') });
      tableBody.addShape(new CANNON.Box(new CANNON.Vec3(tableW/2, tableH/2, tableD/2)), new CANNON.Vec3(0, tableH/2, 5));
      tableBody.position.set(0, height, 0);
      this.physics.world.addBody(tableBody);
      this.generatedBodies.push(tableBody);

      // Shooting Range Walls
      const rangeDist = 50;
      const wallW = 40;
      const wallH = 6;
      const backWall = new THREE.Mesh(new THREE.BoxGeometry(wallW, wallH, 1), mat);
      backWall.position.set(0, height + wallH/2, -rangeDist);
      backWall.castShadow = true;
      backWall.receiveShadow = true;
      backWall.name = 'WALL'; 
      this.scene.add(backWall);
      this.generatedMeshes.push(backWall);
      
      const wallBody = new CANNON.Body({ mass: 0, material: this.physics.getMaterial('object') });
      wallBody.addShape(new CANNON.Box(new CANNON.Vec3(wallW/2, wallH/2, 0.5)));
      wallBody.position.copy(backWall.position as any);
      this.physics.world.addBody(wallBody);
      this.generatedBodies.push(wallBody);

      for(let s=-1; s<=1; s+=2) {
          const sideWall = new THREE.Mesh(new THREE.BoxGeometry(1, wallH, rangeDist), mat);
          sideWall.position.set(s * (wallW/2), height + wallH/2, -rangeDist/2);
          sideWall.name = 'WALL';
          this.scene.add(sideWall);
          this.generatedMeshes.push(sideWall);
          const sb = new CANNON.Body({ mass: 0 });
          sb.addShape(new CANNON.Box(new CANNON.Vec3(0.5, wallH/2, rangeDist/2)));
          sb.position.copy(sideWall.position as any);
          this.physics.world.addBody(sb);
          this.generatedBodies.push(sb);
      }

      this.spawnPoints.push(new THREE.Vector3(0, height + 2, 20));
      this.regions.push({ name: "CAMPO DE TREINO", x: 0, z: 0, radius: 100 });
  }

  // --- PROCEDURAL HOUSE GENERATOR ---
  public createHouse(x: number, y: number, z: number, rotationY: number = 0, options: HouseOptions) {
      // (Mantido igual)
      const { width, depth, stories, hasFence, hasPath, wallColor } = options;
      
      const mats = AssetLoader.getInstance().materials;
      const wallMat = (mats['wall_brick'] as THREE.MeshStandardMaterial).clone();
      wallMat.color.setHex(wallColor);

      const group = new THREE.Group();
      group.position.set(x, y, z);
      group.rotation.y = rotationY; 
      this.scene.add(group);
      this.generatedMeshes.push(group);

      const thick = 0.5;
      const floorH = 4.0;
      const totalH = floorH * stories;
      const doorW = 2.5;
      const doorH = 3.0;

      const houseBody = new CANNON.Body({ mass: 0, material: this.physics.getMaterial('object') });
      houseBody.position.set(x, y, z);
      houseBody.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), rotationY);

      // Foundation
      const floor = new THREE.Mesh(new THREE.BoxGeometry(width, 0.5, depth), mats['floor']);
      floor.position.y = 0.25;
      floor.receiveShadow = true;
      group.add(floor);
      houseBody.addShape(new CANNON.Box(new CANNON.Vec3(width/2, 0.25, depth/2)), new CANNON.Vec3(0, 0.25, 0));

      // Walls
      const wallBack = new THREE.Mesh(new THREE.BoxGeometry(width, totalH, thick), wallMat);
      wallBack.position.set(0, totalH/2, -depth/2 + thick/2);
      wallBack.castShadow = true; wallBack.receiveShadow = true;
      wallBack.name = 'WALL';
      group.add(wallBack);
      houseBody.addShape(new CANNON.Box(new CANNON.Vec3(width/2, totalH/2, thick/2)), new CANNON.Vec3(0, totalH/2, -depth/2 + thick/2));

      const wallLeft = new THREE.Mesh(new THREE.BoxGeometry(thick, totalH, depth - thick*2), wallMat);
      wallLeft.position.set(-width/2 + thick/2, totalH/2, 0);
      wallLeft.castShadow = true; wallLeft.receiveShadow = true;
      wallLeft.name = 'WALL';
      group.add(wallLeft);
      houseBody.addShape(new CANNON.Box(new CANNON.Vec3(thick/2, totalH/2, (depth - thick*2)/2)), new CANNON.Vec3(-width/2 + thick/2, totalH/2, 0));

      const wallRight = new THREE.Mesh(new THREE.BoxGeometry(thick, totalH, depth - thick*2), wallMat);
      wallRight.position.set(width/2 - thick/2, totalH/2, 0);
      wallRight.castShadow = true; wallRight.receiveShadow = true;
      wallRight.name = 'WALL';
      group.add(wallRight);
      houseBody.addShape(new CANNON.Box(new CANNON.Vec3(thick/2, totalH/2, (depth - thick*2)/2)), new CANNON.Vec3(width/2 - thick/2, totalH/2, 0));

      // Front
      const frontLeftW = (width - doorW) / 2;
      const frontLeft = new THREE.Mesh(new THREE.BoxGeometry(frontLeftW, floorH, thick), wallMat);
      frontLeft.position.set(-width/2 + frontLeftW/2, floorH/2, depth/2 - thick/2);
      frontLeft.castShadow = true;
      frontLeft.name = 'WALL';
      group.add(frontLeft);
      houseBody.addShape(new CANNON.Box(new CANNON.Vec3(frontLeftW/2, floorH/2, thick/2)), new CANNON.Vec3(-width/2 + frontLeftW/2, floorH/2, depth/2 - thick/2));

      const frontRight = new THREE.Mesh(new THREE.BoxGeometry(frontLeftW, floorH, thick), wallMat);
      frontRight.position.set(width/2 - frontLeftW/2, floorH/2, depth/2 - thick/2);
      frontRight.castShadow = true;
      frontRight.name = 'WALL';
      group.add(frontRight);
      houseBody.addShape(new CANNON.Box(new CANNON.Vec3(frontLeftW/2, floorH/2, thick/2)), new CANNON.Vec3(width/2 - frontLeftW/2, floorH/2, depth/2 - thick/2));

      // Door Lintel
      const lintelH = floorH - doorH;
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(doorW, lintelH, thick), wallMat);
      lintel.position.set(0, floorH - lintelH/2, depth/2 - thick/2);
      lintel.castShadow = true;
      lintel.name = 'WALL';
      group.add(lintel);
      houseBody.addShape(new CANNON.Box(new CANNON.Vec3(doorW/2, lintelH/2, thick/2)), new CANNON.Vec3(0, floorH - lintelH/2, depth/2 - thick/2));

      if (stories > 1) {
          const upperFront = new THREE.Mesh(new THREE.BoxGeometry(width, floorH, thick), wallMat);
          upperFront.position.set(0, floorH + floorH/2, depth/2 - thick/2);
          upperFront.castShadow = true;
          upperFront.name = 'WALL';
          group.add(upperFront);
          houseBody.addShape(new CANNON.Box(new CANNON.Vec3(width/2, floorH/2, thick/2)), new CANNON.Vec3(0, floorH + floorH/2, depth/2 - thick/2));
      }

      // Roof
      const roofH = 3.5;
      const roofW = width + 1.5;
      const roofD = depth + 1.5;
      const roofGeo = new THREE.ConeGeometry(Math.max(roofW, roofD) * 0.75, roofH, 4);
      roofGeo.rotateY(Math.PI/4);
      const roof = new THREE.Mesh(roofGeo, new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.9 }));
      roof.position.set(0, totalH + roofH/2, 0);
      roof.scale.set(width/10 * 1.2, 1, depth/10 * 1.2);
      roof.castShadow = true;
      group.add(roof);

      // 2nd Floor & Stairs
      if (stories > 1) {
          const stairW = 3.0;
          const stairRun = 5.5; 
          const gapSize = stairRun + 1.0; 

          const leftSlabW = width - stairW - 0.5;
          const floorThickness = 0.4;
          
          const floor2Geo = new THREE.BoxGeometry(leftSlabW, floorThickness, depth);
          const floor2 = new THREE.Mesh(floor2Geo, mats['floor']);
          floor2.position.set(-width/2 + leftSlabW/2, floorH, 0);
          floor2.receiveShadow = true;
          group.add(floor2);
          houseBody.addShape(new CANNON.Box(new CANNON.Vec3(leftSlabW/2, floorThickness/2, depth/2)), new CANNON.Vec3(-width/2 + leftSlabW/2, floorH, 0));

          const landingD = depth - gapSize; 
          if (landingD > 0) {
              const landGeo = new THREE.BoxGeometry(stairW + 0.5, floorThickness, landingD);
              const landMesh = new THREE.Mesh(landGeo, mats['floor']);
              const landZ = -depth/2 + landingD/2; 
              const landX = width/2 - (stairW + 0.5)/2;
              landMesh.position.set(landX, floorH, landZ);
              group.add(landMesh);
              houseBody.addShape(new CANNON.Box(new CANNON.Vec3((stairW+0.5)/2, floorThickness/2, landingD/2)), new CANNON.Vec3(landX, floorH, landZ));
          }

          // Stairs
          const steps = 12;
          const stepH = floorH / steps;
          const stepD = stairRun / steps;
          
          const stairGroup = new THREE.Group();
          stairGroup.position.set(width/2 - thick - stairW/2 - 0.2, 0, depth/2 - 2); 
          stairGroup.rotation.y = Math.PI; 
          group.add(stairGroup);

          for(let i=0; i<steps; i++) {
              const step = new THREE.Mesh(new THREE.BoxGeometry(stairW, stepH, stepD), mats['wall_concrete']);
              step.position.set(0, i * stepH + stepH/2, i * stepD);
              step.castShadow = true;
              step.receiveShadow = true;
              stairGroup.add(step);
          }

          const rampLen = Math.sqrt(stairRun*stairRun + floorH*floorH);
          const rampAngle = Math.atan2(floorH, stairRun); 
          
          const rampShape = new CANNON.Box(new CANNON.Vec3(stairW/2, 0.1, rampLen/2));
          const startZ = depth/2 - 2;
          const centerZ = startZ - (stairRun/2); 
          
          const rampPos = new CANNON.Vec3(width/2 - thick - stairW/2 - 0.2, floorH/2, centerZ);
          const rampQuat = new CANNON.Quaternion();
          rampQuat.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), rampAngle); 
          
          houseBody.addShape(rampShape, rampPos, rampQuat);
      }

      // Fence
      if (hasFence) {
          const yardMargin = 3;
          const fenceH = 1.2;
          const fenceThick = 0.2;
          const fenceW = width + yardMargin * 2;
          const fenceD = depth + yardMargin * 2;
          
          const fenceMat = new THREE.MeshStandardMaterial({ color: 0x5c4d38, roughness: 0.9 }); 

          const createFenceSeg = (w: number, px: number, pz: number, rot: number) => {
              const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, fenceH, fenceThick), fenceMat);
              mesh.position.set(px, fenceH/2, pz);
              mesh.rotation.y = rot;
              mesh.castShadow = true;
              mesh.name = 'WALL'; 
              group.add(mesh);
              houseBody.addShape(new CANNON.Box(new CANNON.Vec3(w/2, fenceH/2, fenceThick/2)), new CANNON.Vec3(px, fenceH/2, pz), new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(0,1,0), rot));
          };

          createFenceSeg(fenceW, 0, -fenceD/2, 0); // Back
          createFenceSeg(fenceD, -fenceW/2, 0, Math.PI/2); // Left
          createFenceSeg(fenceD, fenceW/2, 0, Math.PI/2); // Right
          
          const gap = 4;
          const segW = (fenceW - gap) / 2;
          createFenceSeg(segW, -fenceW/2 + segW/2, fenceD/2, 0);
          createFenceSeg(segW, fenceW/2 - segW/2, fenceD/2, 0);
      }

      // Path
      if (hasPath) {
          const yardMargin = hasFence ? 3 : 0;
          const pathLen = (depth/2) + yardMargin + 2; 
          const pathGeo = new THREE.PlaneGeometry(2.5, pathLen);
          pathGeo.rotateX(-Math.PI/2);
          const pathMat = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 1.0, polygonOffset: true, polygonOffsetFactor: -1 });
          const path = new THREE.Mesh(pathGeo, pathMat);
          
          path.position.set(0, 0.05, depth/2 + (pathLen/2) - (depth/2) ); 
          path.receiveShadow = true;
          group.add(path);
      }

      this.physics.world.addBody(houseBody);
      this.generatedBodies.push(houseBody);
      (group as any).userData = { physicsBody: houseBody };
      
      return { mesh: group, body: houseBody };
  }

  private createFlatGround(height: number) {
      const shape = new CANNON.Plane();
      const body = new CANNON.Body({ mass: 0, material: this.physics.getMaterial('ground') });
      body.addShape(shape);
      body.position.set(0, height, 0);
      body.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
      this.physics.world.addBody(body);
      this.generatedBodies.push(body);

      const geo = new THREE.PlaneGeometry(MAP_SIZE * 3, MAP_SIZE * 3, 64, 64);
      const mat = new THREE.MeshStandardMaterial({ color: 0x3a5f2d, roughness: 0.9, metalness: 0.1, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = height;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.generatedMeshes.push(mesh);
  }

  // --- STANDARD GAME GENERATION ---
  public generate() {
    this.clear();
    this.generateRoadNetwork();
    this.populateRegions(); 
    this.createGround(); // Gera o terreno com "buracos" para os lagos
    this.createLakes();  // Gera a água visual (PLANO GLOBAL COM REFLEXO)
    this.createSettlements(); 
    this.createVegetation();
    this.createRocks();
    this.createIndustrialZones();
    this.createRuins();
  }

  // --- ÁGUA: SISTEMA HÍBRIDO (RT vs PADRÃO) ---
  public createLakes() {
        const waterGeo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE);
        let mesh;

        if (this.useHighQualityWater) {
            // --- HIGH QUALITY: REFLEXOS REAIS (Water.js) ---
            const waterNormals = TextureGenerator.createWaterNormal(512); 
            waterNormals.wrapS = waterNormals.wrapT = THREE.RepeatWrapping;

            mesh = new Water(waterGeo, {
                textureWidth: 512, 
                textureHeight: 512,
                waterNormals: waterNormals,
                sunDirection: new THREE.Vector3(80, 250, 120).normalize(), 
                sunColor: 0xffffff,
                waterColor: 0x004455, 
                distortionScale: 3.7,
                fog: this.scene.fog !== undefined
            });
        } else {
            // --- LOW QUALITY: SHADER LEVE SEM REFLEXO ---
            const waterMat = new THREE.MeshStandardMaterial({
                color: 0x006994,
                roughness: 0.2,
                metalness: 0.1, // Menos metal para não ficar preto sem environment map
                transparent: true,
                opacity: 0.8,
                side: THREE.DoubleSide
            });

            // Shader Injection para ondas simples (Vertex Displacement + Color Mod)
            waterMat.onBeforeCompile = (shader) => {
                shader.uniforms.uTime = this.waterUniforms.uTime;

                shader.vertexShader = `
                    varying vec3 vWorldPosition;
                    ${shader.vertexShader}
                `;
                shader.vertexShader = shader.vertexShader.replace(
                    '#include <worldpos_vertex>',
                    `
                    #include <worldpos_vertex>
                    vWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
                    `
                );

                shader.fragmentShader = `
                    uniform float uTime;
                    varying vec3 vWorldPosition;
                    ${shader.fragmentShader}
                `;
                shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <color_fragment>',
                    `
                    #include <color_fragment>
                    // Onda simples baseada na posição do mundo
                    float wave = sin(vWorldPosition.x * 0.1 + uTime * 0.5) * cos(vWorldPosition.z * 0.1 + uTime * 0.4);
                    // Clareia e escurece levemente a cor base
                    diffuseColor.rgb += wave * 0.05; 
                    `
                );
            };
            
            mesh = new THREE.Mesh(waterGeo, waterMat);
        }

        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(0, WATER_LEVEL, 0); 

        this.scene.add(mesh);
        this.waterMeshes.push(mesh);
        this.generatedMeshes.push(mesh); // Adiciona ao array geral para limpeza no clear()
  }

  public update(dt: number, renderer: THREE.WebGLRenderer) {
        // Apenas atualiza uniforms leves
        this.treeUniforms.uTime.value += dt;
        this.waterUniforms.uTime.value += dt; // Importante para o modo Low Quality
        
        // Animação da Água (Ripples) para High Quality
        this.waterMeshes.forEach((water: any) => {
            // Verifica se é o objeto Water (que tem uniforms no material.uniforms['time'])
            if (water.material && water.material.uniforms && water.material.uniforms['time']) {
                water.material.uniforms['time'].value += dt * 0.5; 
            }
        });
  }

  // ... (createVegetation, createRocks, etc. mantidos iguais) ...
  public createVegetation() {
        const treeGeo = this.createPineGeometry();
        const treeMat = new THREE.MeshStandardMaterial({ color: 0x1a551a, roughness: 0.8 });
        
        // WIND SHADER
        treeMat.onBeforeCompile = (shader) => {
            shader.uniforms.uTime = this.treeUniforms.uTime;
            shader.vertexShader = `uniform float uTime;\n` + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                `
                #include <begin_vertex>
                float height = max(0.0, transformed.y);
                if (height > 1.5) {
                    float theta = uTime * 1.5;
                    float swayX = sin(theta + transformed.y * 0.5) * (height * height) * 0.015;
                    float swayZ = cos(theta * 0.8 + transformed.x * 0.5) * (height * height) * 0.015;
                    float flutter = sin(uTime * 5.0 + transformed.y * 2.0) * 0.02 * (height > 2.5 ? 1.0 : 0.0);
                    transformed.x += swayX + flutter;
                    transformed.z += swayZ + flutter;
                }
                `
            );
        };

        this.treeMesh = new THREE.InstancedMesh(treeGeo, treeMat, TREE_COUNT);
        this.treeMesh.castShadow = true; 
        this.treeMesh.receiveShadow = true;
        this.treeMesh.name = 'TREE'; 
        
        let idx = 0;
        for(let i=0; i<TREE_COUNT; i++) {
            const x = (Math.random() - 0.5) * MAP_SIZE * 0.9;
            const z = (Math.random() - 0.5) * MAP_SIZE * 0.9;
            
            if (this.isBlocked(x, z)) continue;

            const y = this.getHeightAt(x, z);
            // Evita árvores dentro d'água
            if (y < WATER_LEVEL + 2) continue;

            this.dummy.position.set(x, y, z);
            const scale = 0.8 + Math.random() * 0.6;
            this.dummy.scale.set(scale, scale, scale);
            this.dummy.rotation.set(0, Math.random() * Math.PI, 0);
            this.dummy.updateMatrix();
            this.treeMesh.setMatrixAt(idx, this.dummy.matrix);
            this.treeMesh.setColorAt(idx, new THREE.Color().setHSL(0.25 + Math.random()*0.1, 0.6, 0.2 + Math.random()*0.2));
            
            const shape = new CANNON.Cylinder(0.5, 0.5, 3);
            const body = new CANNON.Body({ mass: 0, shape, material: this.physics.getMaterial('object') });
            body.position.set(x, y + 1.5, z);
            this.physics.world.addBody(body);
            this.generatedBodies.push(body);
            this.coverPoints.push({ position: new THREE.Vector3(x, y, z), occupied: false });
            
            idx++;
        }
        this.treeMesh.count = idx;
        this.treeMesh.computeBoundingSphere();
        this.scene.add(this.treeMesh);
        this.generatedMeshes.push(this.treeMesh);

        // Grass
        const g1 = new THREE.PlaneGeometry(1, 1);
        const g2 = new THREE.PlaneGeometry(1, 1); g2.rotateY(Math.PI/2);
        const mergedGrass = BufferGeometryUtils.mergeGeometries([g1, g2]);
        const grassMat = AssetLoader.getInstance().materials['grass'];
        
        this.grassMesh = new THREE.InstancedMesh(mergedGrass, grassMat, GRASS_COUNT);
        this.grassMesh.receiveShadow = true;
        this.grassMesh.castShadow = false; 
        
        let gIdx = 0;
        for(let i=0; i<GRASS_COUNT; i++) {
             const x = (Math.random() - 0.5) * MAP_SIZE;
             const z = (Math.random() - 0.5) * MAP_SIZE;
             const y = this.getHeightAt(x, z);
             
             if (y < WATER_LEVEL + 1) continue;
             if (this.isBlocked(x, z)) continue;

             this.dummy.position.set(x, y + 0.5, z);
             this.dummy.scale.set(1, 1 + Math.random() * 0.5, 1);
             this.dummy.rotation.set(0, Math.random() * Math.PI, 0);
             this.dummy.updateMatrix();
             this.grassMesh.setMatrixAt(gIdx, this.dummy.matrix);
             this.grassMesh.setColorAt(gIdx, new THREE.Color().setHSL(0.25 + Math.random()*0.15, 0.8, 0.4 + Math.random()*0.2));
             gIdx++;
        }
        this.grassMesh.count = gIdx;
        this.scene.add(this.grassMesh);
        this.generatedMeshes.push(this.grassMesh);
  }

  public createRocks() {
        const geo = new THREE.DodecahedronGeometry(1.0, 0); 
        const mat = new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.9 });
        this.rockMesh = new THREE.InstancedMesh(geo, mat, ROCK_COUNT);
        this.rockMesh.castShadow = true; this.rockMesh.receiveShadow = true;
        this.rockMesh.name = 'ROCK';
        
        let idx = 0;
        for(let i=0; i<ROCK_COUNT; i++) {
            const x = (Math.random() - 0.5) * MAP_SIZE;
            const z = (Math.random() - 0.5) * MAP_SIZE;
            if (this.isBlocked(x, z)) continue;
            
            const y = this.getHeightAt(x, z);
            if (y < WATER_LEVEL - 2) continue;

            this.dummy.position.set(x, y, z);
            const s = 1 + Math.random() * 2;
            this.dummy.scale.set(s, s, s);
            this.dummy.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
            this.dummy.updateMatrix();
            
            this.rockMesh.setMatrixAt(idx, this.dummy.matrix);
            
            const shape = new CANNON.Sphere(s * 0.8);
            const body = new CANNON.Body({ mass: 0, shape, material: this.physics.getMaterial('object') });
            body.position.set(x, y, z);
            this.physics.world.addBody(body);
            this.generatedBodies.push(body);
            this.coverPoints.push({ position: new THREE.Vector3(x, y, z), occupied: false });
            
            idx++;
        }
        this.rockMesh.count = idx;
        this.rockMesh.computeBoundingSphere();
        this.scene.add(this.rockMesh);
        this.generatedMeshes.push(this.rockMesh);
  }

  private createSettlements() {
      // (Mantido igual)
      const HOUSE_SPACING = 20;
      const VARIANTS: Partial<HouseOptions>[] = [
          { width: 8,  depth: 8,  stories: 1, hasFence: false }, 
          { width: 10, depth: 10, stories: 1, hasFence: true  }, 
          { width: 12, depth: 12, stories: 1, hasFence: true  }, 
          { width: 10, depth: 8,  stories: 2, hasFence: false }, 
          { width: 12, depth: 10, stories: 2, hasFence: true  }  
      ];

      for (const town of this.towns) {
          const startX = Math.floor((town.x - town.radius) / HOUSE_SPACING) * HOUSE_SPACING;
          const endX = Math.floor((town.x + town.radius) / HOUSE_SPACING) * HOUSE_SPACING;
          const startZ = Math.floor((town.y - town.radius) / HOUSE_SPACING) * HOUSE_SPACING;
          const endZ = Math.floor((town.y + town.radius) / HOUSE_SPACING) * HOUSE_SPACING;

          let houseCounter = 0;

          for (let x = startX; x <= endX; x += HOUSE_SPACING) {
              for (let z = startZ; z <= endZ; z += HOUSE_SPACING) {
                  
                  const dx = x - town.x;
                  const dz = z - town.y;
                  if (Math.sqrt(dx*dx + dz*dz) > town.radius) continue;

                  if (Math.random() > town.density) {
                      if (Math.random() < 0.2) this.lootSpawns.push(new THREE.Vector3(x, CITY_LEVEL + 1, z));
                      continue;
                  }

                  const posX = x + (Math.random() - 0.5) * 4;
                  const posZ = z + (Math.random() - 0.5) * 4;

                  const terrainH = this.getHeightAt(posX, posZ);
                  if (terrainH < WATER_LEVEL + 3.0) continue;

                  const p = new THREE.Vector2(posX, posZ);
                  let onRoad = false;
                  for (const road of this.roads) {
                      const distSq = this.distToSegmentSquared(p, road.p1, road.p2);
                      if (distSq < (road.width + 6) ** 2) { onRoad = true; break; }
                  }
                  if (onRoad) continue;

                  let rotY = 0;
                  if (town.type === 'CITY') rotY = (Math.floor(Math.random() * 4) * Math.PI) / 2;
                  else rotY = Math.atan2(town.x - posX, town.y - posZ); 

                  const posY = CITY_LEVEL;
                  const vIndex = houseCounter % 5;
                  const variant = VARIANTS[vIndex];
                  const is2Story = (variant.stories || 1) > 1;

                  this.createHouse(posX, posY, posZ, rotY, {
                      width: variant.width || 10,
                      depth: variant.depth || 10,
                      stories: variant.stories || 1,
                      hasFence: variant.hasFence || false,
                      hasPath: true,
                      hasStairs: is2Story, 
                      wallColor: town.themeColor
                  });

                  this.lootSpawns.push(new THREE.Vector3(posX, posY + 1, posZ));
                  if (is2Story) {
                      this.lootSpawns.push(new THREE.Vector3(posX, posY + 5, posZ));
                  }

                  if (Math.random() < 0.4) {
                      this.patrolPoints.push(new THREE.Vector3(posX + 5, posY, posZ + 5));
                  }
                  
                  houseCounter++;
              }
          }
      }
  }

  public createPineGeometry(): THREE.BufferGeometry {
      const trunkGeo = new THREE.CylinderGeometry(0.3, 0.5, 2, 5); 
      trunkGeo.translate(0, 1, 0); 
      const level1 = new THREE.ConeGeometry(2.0, 2.0, 5); level1.translate(0, 2.5, 0);
      const level2 = new THREE.ConeGeometry(1.5, 2.0, 5); level2.translate(0, 3.8, 0);
      const level3 = new THREE.ConeGeometry(1.0, 2.0, 5); level3.translate(0, 5.0, 0);
      return BufferGeometryUtils.mergeGeometries([trunkGeo, level1, level2, level3], true);
  }

  private populateRegions() {
      this.towns.forEach(t => {
          this.regions.push({ name: t.name, x: t.x, z: t.y, radius: t.radius + 20 });
      });
      this.regions.push({ name: "Montanhas do Leste", x: 200, z: 200, radius: 80 });
      this.regions.push({ name: "Floresta Densa", x: -100, z: -100, radius: 70 });
  }

  private generateRoadNetwork() {
      const center = this.towns[0];
      for (let i = 1; i < this.towns.length; i++) {
          const village = this.towns[i];
          this.roads.push({ p1: new THREE.Vector2(center.x, center.y), p2: new THREE.Vector2(village.x, village.y), width: 8 });
      }
      for (let i = 1; i < this.towns.length; i++) {
          const t1 = this.towns[i];
          const t2 = this.towns[i === this.towns.length - 1 ? 1 : i + 1];
          this.roads.push({ p1: new THREE.Vector2(t1.x, t1.y), p2: new THREE.Vector2(t2.x, t2.y), width: 6 });
      }
  }

  // --- GET HEIGHT AT (COM AJUSTE DE BASE) ---
  public getHeightAt(x: number, z: number): number {
      // 1. Terreno Base (Montanhoso suave)
      // Aumentei o offset de +12 para +14 para reduzir chances de lagos acidentais
      let height = Math.sin(x * 0.015) * 8 + Math.cos(z * 0.015) * 8 + 14; 
      height += Math.sin(x * 0.05 + z * 0.05) * 2; 

      // 2. Buracos dos Lagos
      for (const lake of this.lakes) {
          const dx = x - lake.x;
          const dy = z - lake.y;
          const dist = Math.sqrt(dx*dx + dy*dy);
          
          if (dist < lake.radius + 20) {
              let blend = 1.0 - Math.min(1, dist / (lake.radius + 15));
              blend = blend * blend * (3 - 2 * blend); 
              const lakeDepth = -8; 
              height = THREE.MathUtils.lerp(height, lakeDepth, blend);
          }
      }

      // 3. Aplanar Cidades e Estradas
      let flattenFactor = 0.0;
      for (const town of this.towns) {
          const dx = x - town.x;
          const dy = z - town.y;
          const dist = Math.sqrt(dx*dx + dy*dy);
          if (dist < town.radius + CITY_BLEND) {
              let blend = 1.0;
              if (dist > town.radius) blend = 1.0 - ((dist - town.radius) / CITY_BLEND);
              blend = blend * blend * (3 - 2 * blend);
              if (blend > flattenFactor) flattenFactor = blend;
          }
      }

      const p = new THREE.Vector2(x, z);
      for (const road of this.roads) {
          const distSq = this.distToSegmentSquared(p, road.p1, road.p2);
          const totalWidth = road.width + 10;
          if (distSq < totalWidth * totalWidth) {
              const d = Math.sqrt(distSq);
              let roadBlend = 1.0 - (d / totalWidth);
              roadBlend = Math.max(0, roadBlend);
              if (roadBlend > 0) height = THREE.MathUtils.lerp(height, 12, roadBlend * 0.8);
          }
      }

      if (flattenFactor > 0) height = THREE.MathUtils.lerp(height, CITY_LEVEL, flattenFactor);
      
      // 4. PAREDES DE BORDA CORRIGIDAS (Quadrado vs Círculo)
      const halfMap = MAP_SIZE / 2;
      const margin = 80; // A montanha começa 80 metros antes do fim do mapa
      const distEdge = Math.max(Math.abs(x), Math.abs(z));
      
      if (distEdge > halfMap - margin) {
          const ramp = (distEdge - (halfMap - margin)) / margin; 
          height += (ramp * ramp) * 45; 
          const edgeNoise = (Math.sin(x * 0.1) + Math.cos(z * 0.1)) * 4;
          height += edgeNoise * ramp; 
      }

      return height;
  }

  private distToSegmentSquared(p: THREE.Vector2, v: THREE.Vector2, w: THREE.Vector2) {
      const l2 = v.distanceToSquared(w);
      if (l2 == 0) return p.distanceToSquared(v);
      let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
      t = Math.max(0, Math.min(1, t));
      return p.distanceToSquared(new THREE.Vector2(v.x + t * (w.x - v.x), v.y + t * (w.y - v.y)));
  }

  private isBlocked(x: number, z: number): boolean {
      const p = new THREE.Vector2(x, z);
      // Bloqueia spawn nos lagos
      for (const lake of this.lakes) {
          if (p.distanceTo(new THREE.Vector2(lake.x, lake.y)) < lake.radius - 2) return true;
      }
      for (const town of this.towns) {
          if (p.distanceTo(new THREE.Vector2(town.x, town.y)) < town.radius + 5) return true;
      }
      for (const road of this.roads) {
          if (this.distToSegmentSquared(p, road.p1, road.p2) < (road.width + 3) ** 2) return true;
      }
      return false;
  }

  public getRandomSpawnPoint(): THREE.Vector3 {
      let attempts = 0;
      while(attempts < 100) {
          const angle = Math.random() * Math.PI * 2;
          const r = Math.random() * 150; 
          const x = Math.cos(angle) * r;
          const z = Math.sin(angle) * r;
          const y = this.getHeightAt(x, z);
          if (y > WATER_LEVEL + 1) return new THREE.Vector3(x, y + 2.0, z);
          attempts++;
      }
      return new THREE.Vector3(0, 20, 0); 
  }

  private createGround() {
    const geometry = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, SEGMENTS, SEGMENTS);
    const posAttribute = geometry.attributes.position;
    const count = posAttribute.count;
    const colors: number[] = [];
    
    // Cores
    const colorSnow = new THREE.Color(0xffffff);     
    const colorRock = new THREE.Color(0x555555); 
    const colorGrass = new THREE.Color(0x3a5f2d);
    const colorSand = new THREE.Color(0xd2b48c);
    const colorAsphalt = new THREE.Color(0x1a1a1a);  
    const colorDirtRoad = new THREE.Color(0x5d4037); 
    const colorConcrete = new THREE.Color(0x888888); 
    
    for (let i = 0; i < count; i++) {
        const x = posAttribute.getX(i);
        const y = posAttribute.getY(i); 
        const worldZ = -y;
        const height = this.getHeightAt(x, worldZ); 
        posAttribute.setZ(i, height);

        let vertexColor = new THREE.Color();
        let inAnyTown = false;
        let isStreet = false;
        let townType = 'VILLAGE';

        for(const town of this.towns) {
            const dx = x - town.x;
            const dz = worldZ - town.y;
            const dist = Math.sqrt(dx*dx + dz*dz);
            if (dist < town.radius + 10) {
                inAnyTown = true;
                townType = town.type;
                const absX = Math.abs(x - town.x + 10000); 
                const absZ = Math.abs(worldZ - town.y + 10000);
                if ((absX % BLOCK_SIZE < ROAD_WIDTH) || (absZ % BLOCK_SIZE < ROAD_WIDTH)) isStreet = true;
            }
        }

        let isConnectingRoad = false;
        if (!inAnyTown) {
            const p = new THREE.Vector2(x, worldZ);
            for (const road of this.roads) {
                if (this.distToSegmentSquared(p, road.p1, road.p2) < road.width * road.width) {
                    isConnectingRoad = true; break;
                }
            }
        }

        if (inAnyTown) {
            if (isStreet) {
                vertexColor.copy(townType === 'CITY' ? colorAsphalt : colorDirtRoad).multiplyScalar(0.9 + Math.random() * 0.2);
            } else {
                vertexColor.copy(townType === 'VILLAGE' ? colorGrass.clone().lerp(colorConcrete, 0.4) : colorConcrete).multiplyScalar(0.9 + Math.random() * 0.2);
            }
        } else if (isConnectingRoad) {
            vertexColor.copy(colorDirtRoad).multiplyScalar(0.8 + Math.random() * 0.3);
        } else {
            const noise = (Math.random() - 0.5) * 4.0; 
            if (height > 50 + noise) vertexColor.copy(colorRock).lerp(colorSnow, Math.min(1, (height - 50) / 20));
            else if (height > 25 + noise) vertexColor.copy(colorRock).multiplyScalar(0.9 + Math.random()*0.2);
            else if (height > (WATER_LEVEL + 1.5) + (noise * 0.5)) {
                vertexColor.copy(colorGrass);
                const grassNoise = (Math.random() - 0.5) * 0.05;
                vertexColor.offsetHSL(0, 0, grassNoise);
            }
            else vertexColor.copy(colorSand);
        }
        colors.push(vertexColor.r, vertexColor.g, vertexColor.b);
    }
    
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    
    // Texture logic
    const detailMap = TextureGenerator.createTerrainDetail(512);
    detailMap.repeat.set(32, 32); 
    const normalMap = TextureGenerator.createTerrainNormal(512);
    normalMap.repeat.set(32, 32);

    const material = new THREE.MeshStandardMaterial({ 
        vertexColors: true, 
        map: detailMap,
        normalMap: normalMap, 
        normalScale: new THREE.Vector2(0.5, 0.5),
        roughness: 0.9, 
        metalness: 0.1, 
        flatShading: false 
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.generatedMeshes.push(mesh);

    const matrix: number[][] = [];
    for (let i = 0; i <= SEGMENTS; i++) {
        const row: number[] = [];
        for (let j = 0; j <= SEGMENTS; j++) {
            const x = (i / SEGMENTS) * MAP_SIZE - (MAP_SIZE / 2);
            const z = (MAP_SIZE / 2) - (j / SEGMENTS) * MAP_SIZE;
            row.push(this.getHeightAt(x, z));
        }
        matrix.push(row);
    }
    const hfShape = new CANNON.Heightfield(matrix, { elementSize: ELEMENT_SIZE });
    const groundBody = new CANNON.Body({ mass: 0, material: this.physics.getMaterial('ground') });
    groundBody.addShape(hfShape);
    groundBody.position.set(-MAP_SIZE / 2, 0, MAP_SIZE / 2);
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.physics.world.addBody(groundBody);
    this.generatedBodies.push(groundBody);
  }

  public createPineTreeModel(): THREE.Mesh {
      const geo = this.createPineGeometry();
      const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.1, flatShading: true });
      return new THREE.Mesh(geo, material);
  }

  public createIndustrialZones() {
      const geo = new THREE.BoxGeometry(2.5, 2.5, 6);
      const mat = AssetLoader.getInstance().materials['container_panel'].clone(); 
      this.containerMesh = new THREE.InstancedMesh(geo, mat, CONTAINER_COUNT);
      this.containerMesh.castShadow = true; this.containerMesh.receiveShadow = true;
      this.containerMesh.name = 'CONTAINER';
      
      let idx = 0;
      for (const town of this.towns) {
          if (town.type !== 'CITY') continue; 
          for(let i=0; i<5; i++) { 
              const angle = Math.random() * Math.PI * 2;
              const r = town.radius * 0.8 * Math.sqrt(Math.random());
              const x = town.x + Math.cos(angle) * r;
              const z = town.y + Math.sin(angle) * r;
              if (this.isBlocked(x, z)) continue;
              const y = this.getHeightAt(x, z);
              this.dummy.position.set(x, y + 1.25, z);
              this.dummy.rotation.set(0, Math.random() * Math.PI, 0);
              this.dummy.scale.set(1, 1, 1);
              this.dummy.updateMatrix();
              this.containerMesh.setMatrixAt(idx, this.dummy.matrix);
              this.containerMesh.setColorAt(idx, new THREE.Color().setHSL(Math.random(), 0.6, 0.4));
              const shape = new CANNON.Box(new CANNON.Vec3(1.25, 1.25, 3));
              const body = new CANNON.Body({ mass: 0, shape, material: this.physics.getMaterial('object') });
              body.position.set(x, y + 1.25, z);
              body.quaternion.setFromAxisAngle(new CANNON.Vec3(0,1,0), this.dummy.rotation.y);
              this.physics.world.addBody(body);
              this.generatedBodies.push(body);
              this.coverPoints.push({ position: new THREE.Vector3(x, y, z), occupied: false });
              idx++;
          }
      }
      this.containerMesh.count = idx;
      this.containerMesh.computeBoundingSphere();
      this.scene.add(this.containerMesh);
      this.generatedMeshes.push(this.containerMesh);
  }
  
  public createRuins() {
      const geo = new THREE.BoxGeometry(4, 3, 0.5);
      const mat = AssetLoader.getInstance().materials['wall_concrete'];
      this.wallMesh = new THREE.InstancedMesh(geo, mat, RUIN_COUNT);
      this.wallMesh.castShadow = true; this.wallMesh.receiveShadow = true;
      this.wallMesh.name = 'WALL';
      
      let idx = 0;
      for(let i=0; i<RUIN_COUNT; i++) {
          const x = (Math.random() - 0.5) * MAP_SIZE * 0.8;
          const z = (Math.random() - 0.5) * MAP_SIZE * 0.8;
          let nearTown = false;
          for(const t of this.towns) { if (Math.sqrt((x-t.x)**2 + (z-t.y)**2) < t.radius + 20) nearTown = true; }
          if (nearTown) continue;
          const y = this.getHeightAt(x, z);
          if (y < WATER_LEVEL + 1) continue;
          this.dummy.position.set(x, y + 1.5, z);
          this.dummy.rotation.set(0, Math.random() * Math.PI, 0);
          this.dummy.updateMatrix();
          this.wallMesh.setMatrixAt(idx, this.dummy.matrix);
          const shape = new CANNON.Box(new CANNON.Vec3(2, 1.5, 0.25));
          const body = new CANNON.Body({ mass: 0, shape, material: this.physics.getMaterial('object') });
          body.position.set(x, y + 1.5, z);
          body.quaternion.setFromAxisAngle(new CANNON.Vec3(0,1,0), this.dummy.rotation.y);
          this.physics.world.addBody(body);
          this.generatedBodies.push(body);
          this.coverPoints.push({ position: new THREE.Vector3(x, y, z), occupied: false });
          idx++;
      }
      this.wallMesh.count = idx;
      this.wallMesh.computeBoundingSphere(); 
      this.scene.add(this.wallMesh);
      this.generatedMeshes.push(this.wallMesh);
  }
}
