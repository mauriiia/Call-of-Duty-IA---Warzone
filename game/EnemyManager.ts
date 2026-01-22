import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Enemy, IBRManager, Difficulty } from './Enemy';
import { PhysicsWorld } from './PhysicsWorld';
import { Player } from './Player';
import { World } from './World'; 
import { WeaponType } from './WeaponSystem';
import { AssetLoader } from './AssetLoader';
import { GameEngine } from './Engine';

export interface HitResult {
    hit: boolean;
    killed: boolean;
    isHeadshot: boolean;
}

interface Ragdoll {
    meshes: THREE.Mesh[];
    bodies: CANNON.Body[];
    constraints: CANNON.Constraint[];
    life: number;
}

const BOT_NAMES = [
    "Slayer", "NoobMaster", "ProGamer", "Camper", "SniperWolf", 
    "Tank", "Rusher", "Ghost", "Viper", "Cobra", "Shadow", "Reaper",
    "Toxic", "Sweaty", "Bot_Alpha", "Bot_Bravo", "Zero", "Echo",
    "Killa", "Boss", "Rogue", "Bandit", "Stalker", "Raider",
    "Donnager", "CyRaX", "Neo", "Trinity", "Morpheus", "Smith"
];

// OTIMIZAÇÃO: Limite rígido de cadáveres físicos para não explodir a CPU
const MAX_RAGDOLLS = 3; 

export class EnemyManager {
  public enemies: Enemy[] = [];
  public ragdolls: Ragdoll[] = []; 
  
  // Cache para Raycast rápido (evita .map() a cada tiro)
  private enemyMeshes: THREE.Object3D[] = [];

  private scene: THREE.Scene;
  private physics: PhysicsWorld;
  private nextId: number = 0;
  private worldRef: World | null = null; 
  private currentDifficulty: Difficulty = 'MEDIUM';

  // --- REUSABLE GEOMETRIES & SHAPES (ZERO GC) ---
  private sharedGeos: { [key: string]: THREE.BufferGeometry } = {};
  private sharedShapes: { [key: string]: CANNON.Shape } = {};
  private matSkin!: THREE.MeshStandardMaterial;
  private matDark!: THREE.MeshStandardMaterial;

  constructor(scene: THREE.Scene, physics: PhysicsWorld) {
    this.scene = scene;
    this.physics = physics;

    // Inicializa geometrias compartilhadas (Cria apenas 1 vez na vida do jogo)
    this.initSharedResources();
  }

  private initSharedResources() {
      // Materials
      this.matSkin = new THREE.MeshStandardMaterial({ color: 0xdcb898, roughness: 0.8 });
      this.matDark = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.7 });

      // Geometries
      this.sharedGeos = {
          chest: new THREE.BoxGeometry(0.32, 0.3, 0.25),
          head: new THREE.BoxGeometry(0.2, 0.24, 0.22),
          limb: new THREE.CylinderGeometry(0.05, 0.04, 0.28, 8),
          leg: new THREE.CylinderGeometry(0.07, 0.05, 0.38, 8)
      };

      // Physics Shapes
      this.sharedShapes = {
          chest: new CANNON.Box(new CANNON.Vec3(0.16, 0.15, 0.125)),
          head: new CANNON.Box(new CANNON.Vec3(0.1, 0.12, 0.11)),
          limb: new CANNON.Box(new CANNON.Vec3(0.05, 0.14, 0.05)),
          leg: new CANNON.Box(new CANNON.Vec3(0.07, 0.19, 0.07))
      };
  }
  
  public setWorld(world: World) {
      this.worldRef = world;
  }

  public setDifficulty(diff: Difficulty) {
      this.currentDifficulty = diff;
  }

  public reset() {
      for (let i = this.enemies.length - 1; i >= 0; i--) {
          this.removeEnemyEntity(i); 
      }
      // Limpa ragdolls instantaneamente
      while (this.ragdolls.length > 0) {
          this.cleanupRagdoll(this.ragdolls.pop()!);
      }
      this.ragdolls = [];
      this.enemies = [];
      this.enemyMeshes = [];
      this.nextId = 0;
  }

  private cleanupRagdoll(rd: Ragdoll) {
      rd.meshes.forEach(m => this.scene.remove(m));
      rd.constraints.forEach(c => this.physics.world.removeConstraint(c));
      rd.bodies.forEach(b => this.physics.world.removeBody(b));
      // Não damos dispose nas geometrias pois são compartilhadas!
  }

  public spawnWave(count: number, center: THREE.Vector3, waveNumber: number = 1) {
      if (!this.worldRef) return;
      
      let possibleWeapons: WeaponType[] = [WeaponType.PISTOL];
      
      if (waveNumber <= 2) {
          possibleWeapons = [WeaponType.PISTOL];
      } else if (waveNumber <= 5) {
          possibleWeapons = [WeaponType.SHOTGUN, WeaponType.PISTOL, WeaponType.SHOTGUN];
          if (waveNumber === 5) possibleWeapons.push(WeaponType.RIFLE);
      } else {
          possibleWeapons = [WeaponType.RIFLE, WeaponType.SNIPER, WeaponType.SHOTGUN, WeaponType.RIFLE];
      }

      for (let i = 0; i < count; i++) {
          const angle = Math.random() * Math.PI * 2;
          const radius = 30 + Math.random() * 40; 
          const x = center.x + Math.cos(angle) * radius;
          const z = center.z + Math.sin(angle) * radius;
          const y = this.worldRef.mapGenerator.getHeightAt(x, z);
          
          const enemy = this.spawnEnemy(x, y, z, 'RED');
          const weapon = possibleWeapons[Math.floor(Math.random() * possibleWeapons.length)];
          enemy.setWeapon(weapon);
      }
  }

  private getRandomName(): string {
      return BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
  }

  public spawnEnemy(x: number, y: number, z: number, team: string = 'RED'): Enemy {
      const name = this.getRandomName();
      const enemy = new Enemy(this.nextId++, name, x, y, z, this.scene, this.physics, team);
      enemy.setDifficulty(this.currentDifficulty);
      
      // OTIMIZAÇÃO: Link direto na mesh para evitar loops no Raycast
      enemy.mesh.userData.enemyRef = enemy;
      
      this.enemies.push(enemy);
      this.enemyMeshes.push(enemy.mesh); // Mantém cache atualizado
      return enemy;
  }

  public spawnBRBot(x: number, z: number) {
      if (!this.worldRef) return;
      const y = this.worldRef.mapGenerator.getHeightAt(x, z);
      const id = this.nextId++;
      const name = `[ROBÔ]${this.getRandomName()}`;
      const enemy = new Enemy(id, name, x, y, z, this.scene, this.physics, `BOT_${id}`);
      enemy.setDifficulty(this.currentDifficulty);
      
      enemy.setArmed(true);
      enemy.setWeapon(WeaponType.PISTOL);
      enemy.mesh.userData.enemyRef = enemy;
      
      this.enemies.push(enemy);
      this.enemyMeshes.push(enemy.mesh);
  }

  public spawnDummy(x: number, z: number) {
      const y = 10.0;
      const id = this.nextId++;
      const enemy = new Enemy(id, "Boneco de Alvo", x, y, z, this.scene, this.physics, 'RED');
      enemy.isDummy = true; 
      enemy.health = 99999;
      enemy.setArmed(false);
      enemy.mesh.userData.enemyRef = enemy;
      
      this.enemies.push(enemy);
      this.enemyMeshes.push(enemy.mesh);
  }

  public update(dt: number, player: Player, brManager?: IBRManager) {
    const coverPoints = this.worldRef ? this.worldRef.mapGenerator.coverPoints : [];
    const patrolPoints = this.worldRef ? this.worldRef.mapGenerator.patrolPoints : [];

    for (let i = this.enemies.length - 1; i >= 0; i--) {
        const enemy = this.enemies[i];
        enemy.update(dt, player, this.enemies, coverPoints, patrolPoints, brManager);

        if (enemy.health <= 0) {
            // Morte natural (sem tiro direto, ex: explosão ou queda)
            this.killEnemy(i, new THREE.Vector3(0, 0, 1)); 
        }
    }

    // Update Ragdolls
    for (let i = this.ragdolls.length - 1; i >= 0; i--) {
        const rd = this.ragdolls[i];
        rd.life -= dt;
        
        // Sync visuals
        for(let j=0; j<rd.meshes.length; j++) {
            rd.meshes[j].position.copy(rd.bodies[j].position as any);
            rd.meshes[j].quaternion.copy(rd.bodies[j].quaternion as any);
        }

        if (rd.life <= 0) {
            this.cleanupRagdoll(rd);
            this.ragdolls.splice(i, 1);
        }
    }
  }

  private killEnemy(index: number, impulse: THREE.Vector3, killPoint: THREE.Vector3 = new THREE.Vector3()) {
      const enemy = this.enemies[index];
      
      if (enemy.health <= 0) { 
          this.spawnRagdoll(enemy, impulse);
      }
      
      this.removeEnemyEntity(index);
  }

  private removeEnemyEntity(index: number) {
      const enemy = this.enemies[index];
      this.scene.remove(enemy.mesh);
      this.physics.world.removeBody(enemy.body);
      
      // Remove do array de meshes (Swap and Pop é mais rápido que splice, mas aqui a ordem importa pouco)
      const meshIdx = this.enemyMeshes.indexOf(enemy.mesh);
      if (meshIdx > -1) this.enemyMeshes.splice(meshIdx, 1);

      this.enemies.splice(index, 1);
  }

  private spawnRagdoll(enemy: Enemy, force: THREE.Vector3) {
      // OTIMIZAÇÃO: Se já tem muitos corpos no chão, remove o mais antigo AGORA.
      if (this.ragdolls.length >= MAX_RAGDOLLS) {
          const oldRagdoll = this.ragdolls.shift(); // Remove o primeiro (mais velho)
          if (oldRagdoll) this.cleanupRagdoll(oldRagdoll);
      }

      const pos = enemy.mesh.position.clone();
      const quat = enemy.mesh.quaternion.clone(); 
      
      const matArmor = (enemy.team === 'BLUE' ? 
          AssetLoader.getInstance().materials['enemy_armor_blue'] : 
          AssetLoader.getInstance().materials['enemy_armor_red']
      );

      const ragdoll: Ragdoll = {
          meshes: [],
          bodies: [],
          constraints: [],
          life: 5.0 // Reduzido para 5s (15s é muito tempo para WebGL)
      };

      const partsConfig = {
          collisionFilterGroup: 4,
          linearDamping: 0.5,
          angularDamping: 0.5
      };

      // Helper que usa Shape e Geo compartilhados
      const createPart = (geo: THREE.BufferGeometry, shape: CANNON.Shape, mass: number, offset: number[], mat: THREE.Material) => {
          const mesh = new THREE.Mesh(geo, mat);
          mesh.castShadow = true;
          this.scene.add(mesh);
          ragdoll.meshes.push(mesh);

          const body = new CANNON.Body({ mass: mass, shape: shape, material: this.physics.getMaterial('object'), ...partsConfig });
          
          const localOffset = new THREE.Vector3(offset[0], offset[1], offset[2]);
          localOffset.applyQuaternion(quat); 
          body.position.copy(pos.clone().add(localOffset) as any);
          body.quaternion.copy(quat as any);

          this.physics.world.addBody(body);
          ragdoll.bodies.push(body);
          return body;
      };

      // --- 1. TORSO ---
      const torsoBody = createPart(this.sharedGeos.chest, this.sharedShapes.chest, 20, [0, 1.35, 0], this.matDark);
      torsoBody.applyImpulse(new CANNON.Vec3(force.x, force.y, force.z), new CANNON.Vec3(0,0,0));
      torsoBody.angularVelocity.set(Math.random()*5, Math.random()*5, Math.random()*5);

      // --- 2. HEAD ---
      const headBody = createPart(this.sharedGeos.head, this.sharedShapes.head, 5, [0, 1.65, 0], this.matSkin);
      const cHead = new CANNON.PointToPointConstraint(torsoBody, new CANNON.Vec3(0, 0.15, 0), headBody, new CANNON.Vec3(0, -0.12, 0));
      this.physics.world.addConstraint(cHead);
      ragdoll.constraints.push(cHead);

      // --- 3. LEFT ARM ---
      const lArmBody = createPart(this.sharedGeos.limb, this.sharedShapes.limb, 5, [-0.24, 1.3, 0], matArmor);
      const cLArm = new CANNON.PointToPointConstraint(torsoBody, new CANNON.Vec3(-0.16, 0.1, 0), lArmBody, new CANNON.Vec3(0, 0.14, 0));
      this.physics.world.addConstraint(cLArm);
      ragdoll.constraints.push(cLArm);

      // --- 4. RIGHT ARM ---
      const rArmBody = createPart(this.sharedGeos.limb, this.sharedShapes.limb, 5, [0.24, 1.3, 0], matArmor);
      const cRArm = new CANNON.PointToPointConstraint(torsoBody, new CANNON.Vec3(0.16, 0.1, 0), rArmBody, new CANNON.Vec3(0, 0.14, 0));
      this.physics.world.addConstraint(cRArm);
      ragdoll.constraints.push(cRArm);

      // --- 5. LEFT LEG ---
      const lLegBody = createPart(this.sharedGeos.leg, this.sharedShapes.leg, 10, [-0.1, 0.7, 0], matArmor);
      const cLLeg = new CANNON.PointToPointConstraint(torsoBody, new CANNON.Vec3(-0.1, -0.15, 0), lLegBody, new CANNON.Vec3(0, 0.19, 0));
      this.physics.world.addConstraint(cLLeg);
      ragdoll.constraints.push(cLLeg);

      // --- 6. RIGHT LEG ---
      const rLegBody = createPart(this.sharedGeos.leg, this.sharedShapes.leg, 10, [0.1, 0.7, 0], matArmor);
      const cRLeg = new CANNON.PointToPointConstraint(torsoBody, new CANNON.Vec3(0.1, -0.15, 0), rLegBody, new CANNON.Vec3(0, 0.19, 0));
      this.physics.world.addConstraint(cRLeg);
      ragdoll.constraints.push(cRLeg);

      this.ragdolls.push(ragdoll);
  }

  public checkHit(raycaster: THREE.Raycaster, damage: number): HitResult {
      const result: HitResult = { hit: false, killed: false, isHeadshot: false };
      
      // OTIMIZAÇÃO: Usar o array cacheado de meshes, não criar um novo com .map()
      const intersects = raycaster.intersectObjects(this.enemyMeshes, true);

      if (intersects.length > 0) {
          const hitObj = intersects[0].object;
          
          // OTIMIZAÇÃO: Busca direta via userData (sem loops for)
          // Procura o enemyRef no objeto atingido ou nos pais dele (caso acerte parte do corpo)
          let enemy: Enemy | undefined;
          let curr: THREE.Object3D | null = hitObj;
          
          while(curr) {
              if (curr.userData && curr.userData.enemyRef) {
                  enemy = curr.userData.enemyRef;
                  break;
              }
              curr = curr.parent;
          }

          if (enemy) {
              if (enemy.team === 'BLUE') return result; 

              result.hit = true;
              let finalDamage = damage;
              
              if (hitObj.name === 'HEAD') {
                  result.isHeadshot = true;
                  finalDamage *= 2.0; 
              } 
              
              enemy.takeDamage(finalDamage);

              const dir = raycaster.ray.direction.clone().normalize();
              const forceMulti = result.isHeadshot ? 80 : 50; 
              const force = dir.multiplyScalar(forceMulti);
              force.y += 10; 

              if (enemy.health <= 0) {
                  result.killed = true;
                  GameEngine.getInstance().reportKill("Maurii IA", enemy.name, WeaponType[GameEngine.getInstance().player.weapon.currentWeapon], result.isHeadshot);
                  
                  // Precisamos do índice para remover. O indexOf é rápido o suficiente aqui.
                  const idx = this.enemies.indexOf(enemy);
                  if (idx !== -1) {
                      this.killEnemy(idx, force, intersects[0].point);
                  }
              }
          }
      }
      return result;
  }
}