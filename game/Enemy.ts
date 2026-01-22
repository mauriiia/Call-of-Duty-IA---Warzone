
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PhysicsWorld } from './PhysicsWorld';
import { AssetLoader } from './AssetLoader';
import { Player } from './Player'; 
import { CoverPoint } from './MapGenerator';
import { ParticleManager } from './ParticleManager';
import { WATER_LEVEL } from '../constants';
import { WeaponType } from './WeaponSystem'; 
import { SoundManager } from './SoundManager';
import { GameEngine } from './Engine';

export type EnemyState = 'IDLE' | 'PATROL' | 'COMBAT' | 'CHASE' | 'FLEE' | 'LOOTING' | 'RUN_TO_ZONE' | 'RELOADING';
export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';

export interface IBRManager {
    isPointInZone(pos: THREE.Vector3): boolean;
    currentCenter: THREE.Vector3;
    tryPickupLoot(pos: THREE.Vector3): boolean;
    getNearestActiveLoot(pos: THREE.Vector3): THREE.Vector3 | null;
}

export class Enemy {
  public id: number;
  public name: string;
  public mesh: THREE.Group;
  public body: CANNON.Body;
  public team: string;
  public isDummy: boolean = false; 
  
  // Stats
  public health: number = 100;
  private speed: number = 2.5; 
  public state: EnemyState = 'PATROL'; 
  public hasWeapon: boolean = true;
  private difficulty: Difficulty = 'MEDIUM';

  // Weapon Stats
  public weaponType: WeaponType = WeaponType.RIFLE;
  private fireRate: number = 600; 
  private damage: number = 12;
  private accuracyError: number = 0.12; 
  private engageDistance: number = 25;
  
  // Ammo & Reloading
  private currentAmmo: number = 30;
  private maxAmmo: number = 30;
  private reloadTime: number = 3.0; // Time needed to reload
  private reloadTimer: number = 0;  // Current timer
  
  // AI Logic
  private aiTickTimer: number = 0;
  private aiUpdateRate: number = 0.2; 
  private visionCheckTimer: number = 0; 
  private reactionTimer: number = 0;
  private stateTimer: number = 0;
  
  // Navigation
  private moveTarget: THREE.Vector3 | null = null;
  private desiredVelocity = new THREE.Vector3();
  
  // STUCK CHECK
  private stuckCheckTimer: number = 0;
  private lastStuckPos = new THREE.Vector3();
  private isStuck: boolean = false;

  // Targeting & Combat
  private currentTarget: { pos: THREE.Vector3, isVisible: boolean, entity: any } | null = null;
  private lastKnownTargetPos: THREE.Vector3 | null = null;
  
  private lastShotTime: number = 0;
  private combatStrafingDir: number = 1; 
  private strafeTimer: number = 0;

  // Animation State
  private animTime: number = 0;
  private damageFlashTimer: number = 0; 
  
  private leftLegContainer!: THREE.Group;
  private rightLegContainer!: THREE.Group;
  private leftArmContainer!: THREE.Group;
  private rightArmContainer!: THREE.Group;
  private hipsContainer!: THREE.Group;

  // Components
  private raycaster: THREE.Raycaster;
  private eyeMaterial: THREE.MeshStandardMaterial;
  private muzzleFlashMesh: THREE.Mesh;
  private flashDuration: number = 0;
  private weaponGroup: THREE.Group; 
  private weaponMesh: THREE.Group; 
  
  public bodyMesh: THREE.Mesh;
  public headMesh: THREE.Mesh;
  
  private sceneRef: THREE.Scene;

  private _vec3A = new THREE.Vector3();
  private _vec3B = new THREE.Vector3();

  constructor(id: number, name: string, x: number, y: number, z: number, scene: THREE.Scene, physics: PhysicsWorld, team: string = 'RED') {
    this.id = id;
    this.name = name;
    this.team = team;
    this.sceneRef = scene;
    this.raycaster = new THREE.Raycaster();
    
    this.aiTickTimer = Math.random() * this.aiUpdateRate;
    this.visionCheckTimer = Math.random() * 1.0; 

    this.mesh = new THREE.Group();
    scene.add(this.mesh);

    const mats = AssetLoader.getInstance().materials;
    
    const armorMat = (team === 'BLUE' ? mats['enemy_armor_blue'] : mats['enemy_armor_red']).clone() as THREE.MeshStandardMaterial;
    if (team.startsWith('BOT_')) {
        const hue = Math.random();
        armorMat.color.setHSL(hue, 0.5, 0.3);
    }
    this.eyeMaterial = (mats['enemy_eye'] as THREE.MeshStandardMaterial).clone();
    if (team === 'BLUE') {
        this.eyeMaterial.color.setHex(0x0000ff);
        this.eyeMaterial.emissive.setHex(0x0088ff);
    }

    const skinMat = new THREE.MeshStandardMaterial({ color: 0xdcb898, roughness: 0.8 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.7 });
    const blackMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5 });

    this.hipsContainer = new THREE.Group();
    this.hipsContainer.position.y = 0.9; 
    this.mesh.add(this.hipsContainer);
    const hipGeo = new THREE.CylinderGeometry(0.14, 0.13, 0.15, 8);
    const hipMesh = new THREE.Mesh(hipGeo, armorMat);
    hipMesh.castShadow = true;
    this.hipsContainer.add(hipMesh);

    const spineGroup = new THREE.Group();
    spineGroup.position.y = 0.075;
    this.hipsContainer.add(spineGroup);
    const stomachGeo = new THREE.CylinderGeometry(0.15, 0.14, 0.15, 8);
    const stomach = new THREE.Mesh(stomachGeo, armorMat);
    stomach.position.y = 0.075;
    spineGroup.add(stomach);
    const chestGeo = new THREE.BoxGeometry(0.32, 0.3, 0.25);
    this.bodyMesh = new THREE.Mesh(chestGeo, darkMat); 
    this.bodyMesh.position.y = 0.3; 
    this.bodyMesh.name = 'BODY';
    this.bodyMesh.castShadow = true;
    this.bodyMesh.receiveShadow = true;
    spineGroup.add(this.bodyMesh);
    const pouchGeo = new THREE.BoxGeometry(0.06, 0.1, 0.04);
    for(let i=-1; i<=1; i++) {
        const pouch = new THREE.Mesh(pouchGeo, blackMat);
        pouch.position.set(i * 0.09, -0.05, 0.13);
        pouch.castShadow = true;
        this.bodyMesh.add(pouch);
    }
    const packGeo = new THREE.BoxGeometry(0.24, 0.35, 0.12);
    const backpack = new THREE.Mesh(packGeo, blackMat);
    backpack.position.set(0, 0, -0.19);
    backpack.castShadow = true;
    this.bodyMesh.add(backpack);
    const antGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.4);
    const antenna = new THREE.Mesh(antGeo, blackMat);
    antenna.position.set(0.1, 0.2, 0);
    backpack.add(antenna);

    const neckGeo = new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8);
    const neck = new THREE.Mesh(neckGeo, skinMat);
    neck.position.y = 0.2;
    this.bodyMesh.add(neck);
    const headSize = 0.2;
    const headGeo = new THREE.BoxGeometry(headSize, 0.24, 0.22);
    this.headMesh = new THREE.Mesh(headGeo, skinMat);
    this.headMesh.position.y = 0.35; 
    this.headMesh.name = 'HEAD';
    this.headMesh.castShadow = true;
    this.bodyMesh.add(this.headMesh);
    const helmetGeo = new THREE.DodecahedronGeometry(0.15);
    const helmet = new THREE.Mesh(helmetGeo, armorMat);
    helmet.position.y = 0.08;
    helmet.scale.set(1, 0.7, 1.1);
    this.headMesh.add(helmet);
    const goggleGeo = new THREE.BoxGeometry(0.16, 0.06, 0.05);
    const goggles = new THREE.Mesh(goggleGeo, blackMat);
    goggles.position.set(0, 0.02, 0.1); 
    this.headMesh.add(goggles);
    const eyeGeo = new THREE.PlaneGeometry(0.05, 0.02);
    const eyeLeft = new THREE.Mesh(eyeGeo, this.eyeMaterial);
    eyeLeft.position.set(-0.04, 0, 0.03);
    goggles.add(eyeLeft);
    const eyeRight = new THREE.Mesh(eyeGeo, this.eyeMaterial);
    eyeRight.position.set(0.04, 0, 0.03);
    goggles.add(eyeRight);

    const armGeo = new THREE.CylinderGeometry(0.05, 0.04, 0.28, 8);
    armGeo.translate(0, -0.14, 0); 
    const shoulderGeo = new THREE.SphereGeometry(0.07, 8, 6);
    const padGeo = new THREE.BoxGeometry(0.08, 0.08, 0.03); 
    const gloveGeo = new THREE.BoxGeometry(0.06, 0.08, 0.08);

    this.rightArmContainer = new THREE.Group();
    this.rightArmContainer.position.set(0.24, 0.15, 0); 
    this.bodyMesh.add(this.rightArmContainer);
    const rShoulder = new THREE.Mesh(shoulderGeo, armorMat);
    this.rightArmContainer.add(rShoulder);
    const rUpper = new THREE.Mesh(armGeo, armorMat);
    this.rightArmContainer.add(rUpper);
    const rForearmGroup = new THREE.Group();
    rForearmGroup.position.y = -0.28;
    rUpper.add(rForearmGroup);
    const rElbow = new THREE.Mesh(padGeo, blackMat);
    rElbow.position.set(0, 0, -0.04);
    rForearmGroup.add(rElbow);
    const rForearm = new THREE.Mesh(armGeo, armorMat); 
    rForearmGroup.add(rForearm);
    const rGlove = new THREE.Mesh(gloveGeo, blackMat);
    rGlove.position.y = -0.3;
    rForearmGroup.add(rGlove);

    this.leftArmContainer = new THREE.Group();
    this.leftArmContainer.position.set(-0.24, 0.15, 0);
    this.bodyMesh.add(this.leftArmContainer);
    const lShoulder = new THREE.Mesh(shoulderGeo, armorMat);
    this.leftArmContainer.add(lShoulder);
    const lUpper = new THREE.Mesh(armGeo, armorMat);
    this.leftArmContainer.add(lUpper);
    const lForearmGroup = new THREE.Group();
    lForearmGroup.position.y = -0.28;
    lUpper.add(lForearmGroup);
    const lElbow = new THREE.Mesh(padGeo, blackMat);
    lElbow.position.set(0, 0, -0.04);
    lForearmGroup.add(lElbow);
    const lForearm = new THREE.Mesh(armGeo, armorMat);
    lForearmGroup.add(lForearm);
    const lGlove = new THREE.Mesh(gloveGeo, blackMat);
    lGlove.position.y = -0.3;
    lForearmGroup.add(lGlove);

    const legGeo = new THREE.CylinderGeometry(0.07, 0.05, 0.38, 8);
    legGeo.translate(0, -0.19, 0);
    const bootGeo = new THREE.BoxGeometry(0.1, 0.12, 0.22);

    this.rightLegContainer = new THREE.Group();
    this.rightLegContainer.position.set(0.1, -0.05, 0);
    this.hipsContainer.add(this.rightLegContainer);
    const rThigh = new THREE.Mesh(legGeo, armorMat);
    this.rightLegContainer.add(rThigh);
    const rShinGroup = new THREE.Group();
    rShinGroup.position.y = -0.38;
    rThigh.add(rShinGroup);
    const rKnee = new THREE.Mesh(padGeo, blackMat);
    rKnee.position.set(0, 0, 0.05); 
    rShinGroup.add(rKnee);
    const rShin = new THREE.Mesh(legGeo, armorMat);
    rShinGroup.add(rShin);
    const rBoot = new THREE.Mesh(bootGeo, darkMat);
    rBoot.position.set(0, -0.42, 0.05);
    rShinGroup.add(rBoot);

    this.leftLegContainer = new THREE.Group();
    this.leftLegContainer.position.set(-0.1, -0.05, 0);
    this.hipsContainer.add(this.leftLegContainer);
    const lThigh = new THREE.Mesh(legGeo, armorMat);
    this.leftLegContainer.add(lThigh);
    const lShinGroup = new THREE.Group();
    lShinGroup.position.y = -0.38;
    lThigh.add(lShinGroup);
    const lKnee = new THREE.Mesh(padGeo, blackMat);
    lKnee.position.set(0, 0, 0.05);
    lShinGroup.add(lKnee);
    const lShin = new THREE.Mesh(legGeo, armorMat);
    lShinGroup.add(lShin);
    const lBoot = new THREE.Mesh(bootGeo, darkMat);
    lBoot.position.set(0, -0.42, 0.05);
    lShinGroup.add(lBoot);

    this.weaponGroup = new THREE.Group();
    this.rightArmContainer.add(this.weaponGroup); 
    this.weaponMesh = new THREE.Group();
    this.weaponGroup.add(this.weaponMesh);

    const flashGeo = new THREE.PlaneGeometry(0.4, 0.4);
    this.muzzleFlashMesh = new THREE.Mesh(flashGeo, mats['muzzle']);
    this.muzzleFlashMesh.visible = false;
    this.weaponGroup.add(this.muzzleFlashMesh);

    this.setWeapon(WeaponType.RIFLE);

    const shape = new CANNON.Box(new CANNON.Vec3(0.3, 0.9, 0.3));
    this.body = new CANNON.Body({
      mass: 80,
      shape: shape,
      material: physics.getMaterial('player'),
      fixedRotation: true, 
      linearDamping: 0.0 
    });
    this.body.position.set(x, y + 2.0, z); 
    physics.world.addBody(this.body);
  }

  public setWeapon(type: WeaponType) {
      this.weaponType = type;
      while(this.weaponMesh.children.length > 0){ 
          this.weaponMesh.remove(this.weaponMesh.children[0]); 
      }

      const matBlack = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5 });
      const matGrey = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.6 });
      const matWood = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.8 });

      this.weaponGroup.position.set(0, -0.52, 0.15);
      this.weaponGroup.rotation.set(0, 0, 0); 

      switch(type) {
          case WeaponType.PISTOL:
              const pBody = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.2), matBlack);
              pBody.position.set(0, 0.04, 0.05); 
              this.weaponMesh.add(pBody);
              const pGrip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.06), matBlack);
              pGrip.position.set(0, -0.02, 0); pGrip.rotation.x = -0.1;
              this.weaponMesh.add(pGrip);

              this.damage = 10; this.fireRate = 400; this.engageDistance = 15;
              this.maxAmmo = 12; this.reloadTime = 2.0;
              
              this.muzzleFlashMesh.position.set(0, 0.04, 0.2); 

              this.rightArmContainer.rotation.set(-1.5, 0, 0); 
              this.weaponGroup.rotation.x = -Math.PI/2; 
              this.leftArmContainer.rotation.set(-1.5, 0.5, 0); 
              break;

          case WeaponType.SHOTGUN:
              const sBody = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.3), matGrey);
              sBody.position.set(0, 0.05, 0.1); 
              this.weaponMesh.add(sBody);
              const sBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.6), matBlack);
              sBarrel.rotation.x = Math.PI/2; sBarrel.position.set(0, 0.05, 0.45); 
              this.weaponMesh.add(sBarrel);
              const sStock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.3), matWood);
              sStock.position.set(0, 0, -0.2); 
              this.weaponMesh.add(sStock);

              this.damage = 8; this.fireRate = 1200; this.engageDistance = 8;
              this.maxAmmo = 8; this.reloadTime = 3.5;

              this.muzzleFlashMesh.position.set(0, 0.05, 0.8);

              this.rightArmContainer.rotation.set(-1.2, -0.2, 0);
              this.weaponGroup.rotation.x = -Math.PI/2; 
              this.leftArmContainer.rotation.set(-1.2, 0.5, 0);
              break;

          case WeaponType.SNIPER:
              const snBody = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.4), matWood);
              snBody.position.set(0, 0.02, 0.1); 
              this.weaponMesh.add(snBody);
              const snBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.015, 1.0), matBlack);
              snBarrel.rotation.x = Math.PI/2; snBarrel.position.set(0, 0.04, 0.7); 
              this.weaponMesh.add(snBarrel);
              const snStock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.35), matWood);
              snStock.position.set(0, -0.02, -0.25); 
              this.weaponMesh.add(snStock);
              const snScope = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.3), matBlack);
              snScope.rotation.x = Math.PI/2; snScope.position.set(0, 0.12, 0.15);
              this.weaponMesh.add(snScope);
              
              this.damage = 60; this.fireRate = 2000; this.engageDistance = 50;
              this.maxAmmo = 5; this.reloadTime = 4.0;

              this.muzzleFlashMesh.position.set(0, 0.04, 1.25);

              this.rightArmContainer.rotation.set(-1.4, -0.1, 0); 
              this.weaponGroup.rotation.x = -Math.PI/2; 
              this.leftArmContainer.rotation.set(-1.3, 0.4, 0); 
              break;

          case WeaponType.RIFLE:
          default:
              const rBody = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.3), matBlack);
              rBody.position.set(0, 0.05, 0.1);
              this.weaponMesh.add(rBody);
              const rMag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.15, 0.08), matGrey);
              rMag.position.set(0, -0.05, 0.15); rMag.rotation.x = 0.2;
              this.weaponMesh.add(rMag);
              const rBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5), matBlack);
              rBarrel.rotation.x = Math.PI/2; rBarrel.position.set(0, 0.06, 0.45);
              this.weaponMesh.add(rBarrel);
              const rStock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.25), matBlack);
              rStock.position.set(0, 0.02, -0.15); 
              this.weaponMesh.add(rStock);

              this.damage = 12; this.fireRate = 150; this.engageDistance = 25;
              this.maxAmmo = 30; this.reloadTime = 3.0;

              this.muzzleFlashMesh.position.set(0, 0.06, 0.75);

              this.rightArmContainer.rotation.set(-1.3, -0.1, 0); 
              this.weaponGroup.rotation.x = -Math.PI/2; 
              this.leftArmContainer.rotation.set(-1.2, 0.6, 0); 
              break;
      }
      // Start full
      this.currentAmmo = this.maxAmmo;
      this.weaponMesh.traverse(c => { if (c instanceof THREE.Mesh) { c.castShadow = true; c.receiveShadow = true; } });
  }

  public setDifficulty(level: Difficulty) {
      this.difficulty = level;
      let multiplier = 1.0;
      if (level === 'EASY') multiplier = 1.5;
      if (level === 'HARD') multiplier = 0.7;
      this.fireRate *= multiplier;
      // Adjust Accuracy based on difficulty
      if (level === 'EASY') this.accuracyError = 0.25;
      if (level === 'MEDIUM') this.accuracyError = 0.12;
      if (level === 'HARD') this.accuracyError = 0.06;
      this.aiUpdateRate = level === 'HARD' ? 0.1 : 0.2;
  }

  public setArmed(armed: boolean) {
      this.hasWeapon = armed;
      this.weaponGroup.visible = armed;
  }

  public update(dt: number, player: Player, allEnemies: Enemy[], coverPoints: CoverPoint[], patrolPoints: THREE.Vector3[], brManager?: IBRManager) {
    this.mesh.position.copy(this.body.position as any);
    this.mesh.position.y -= 0.9; 

    this.flashDuration -= dt * 1000;
    this.muzzleFlashMesh.visible = this.flashDuration > 0;

    // BOT DROPPING CHECK
    if (this.mesh.position.y > 30) {
        this.weaponGroup.visible = false;
        if (this.mesh.position.y > 50) {
            this.body.linearDamping = 0.1;
        } else {
            this.body.linearDamping = 0.9; 
        }
        return; 
    } else {
        if (this.hasWeapon) {
            this.weaponGroup.visible = true;
        }
    }

    if (this.body.position.y < WATER_LEVEL) {
        this.body.applyForce(new CANNON.Vec3(0, 2000, 0), new CANNON.Vec3(0,0,0));
        this.body.linearDamping = 0.9;
    } else {
        this.body.linearDamping = 0.0;
    }

    // --- DUMMY LOGIC (SKIP AI) ---
    if (this.isDummy) {
        this.state = 'IDLE';
        this.body.velocity.set(0,0,0);
        this.body.angularVelocity.set(0,0,0);
        this.updateAnimations(dt);
        this.updateDamageFlash(dt); 
        return; 
    }

    // --- RELOAD LOGIC ---
    if (this.state === 'RELOADING') {
        this.reloadTimer -= dt;
        if (this.reloadTimer <= 0) {
            this.currentAmmo = this.maxAmmo;
            this.state = 'COMBAT'; 
            // Simple visual reset (arms back to normal in updateAnimations)
        } else {
            // While reloading, reduce speed
            this.desiredVelocity.set(0,0,0);
            this.applyLocomotion(dt); 
            this.updateAnimations(dt);
            // Don't do normal AI decision/shooting
            return;
        }
    }

    if (this.reactionTimer > 0) this.reactionTimer -= dt;
    if (this.stateTimer > 0) this.stateTimer -= dt;

    this.aiTickTimer -= dt;
    if (this.aiTickTimer <= 0) {
        this.aiTickTimer = this.aiUpdateRate; 
        
        const distToPlayerSq = this.mesh.position.distanceToSquared(player.mesh.position);
        if (distToPlayerSq < 22500) { 
            this.scanEnvironment(player, allEnemies);
            this.handleDecisionMaking(brManager, patrolPoints, player);
            this.calculateDesiredVelocity();
        } else {
            this.desiredVelocity.set(0,0,0);
            if (brManager && !brManager.isPointInZone(this.mesh.position)) {
                 this.state = 'RUN_TO_ZONE';
                 const dir = new THREE.Vector3().subVectors(brManager.currentCenter, this.mesh.position).normalize();
                 this.desiredVelocity = dir.multiplyScalar(this.speed * 1.5);
            }
        }
    }

    this.applyLocomotion(dt);

    if (this.state === 'COMBAT') {
        this.handleCombatAction(player, allEnemies);
        if (this.currentTarget) {
            const lookPos = new THREE.Vector3(this.currentTarget.pos.x, this.mesh.position.y, this.currentTarget.pos.z);
            this.mesh.lookAt(lookPos);
        }
    } else {
        const vel = this.body.velocity;
        if (Math.abs(vel.x) > 0.1 || Math.abs(vel.z) > 0.1) {
            const targetYaw = Math.atan2(vel.x, vel.z);
            const currentQ = this.mesh.quaternion.clone();
            const targetQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), targetYaw);
            this.mesh.quaternion.slerp(targetQ, dt * 8); 
        }
    }
    
    this.updateAnimations(dt);
    this.updateDamageFlash(dt); 
    this.updateEyeColor();
  }

  private updateDamageFlash(dt: number) {
      if (this.damageFlashTimer > 0) {
          this.damageFlashTimer -= dt;
          if (this.damageFlashTimer <= 0) {
              const baseColor = (this.state === 'COMBAT' || this.state === 'CHASE') ? 0xff0000 : 0xffff00;
              this.eyeMaterial.emissive.setHex(baseColor);
          }
      }
  }

  private updateAnimations(dt: number) {
      const velocity = new THREE.Vector3(this.body.velocity.x, 0, this.body.velocity.z);
      const speed = velocity.length();

      if (this.mesh.visible === false) return; 

      if (speed > 0.2) {
          this.animTime += dt * speed * 5;
          this.leftLegContainer.rotation.x = Math.sin(this.animTime) * 0.6;
          this.rightLegContainer.rotation.x = Math.sin(this.animTime + Math.PI) * 0.6;
          this.hipsContainer.position.y = 0.9 + Math.abs(Math.sin(this.animTime * 2)) * 0.03;
      } else {
          this.leftLegContainer.rotation.x = THREE.MathUtils.lerp(this.leftLegContainer.rotation.x, 0, dt * 5);
          this.rightLegContainer.rotation.x = THREE.MathUtils.lerp(this.rightLegContainer.rotation.x, 0, dt * 5);
          this.hipsContainer.position.y = THREE.MathUtils.lerp(this.hipsContainer.position.y, 0.9, dt * 5);
      }

      // Reload Animation Tilt (Subtle)
      if (this.state === 'RELOADING') {
          // Tilt weapon down
          this.rightArmContainer.rotation.x = THREE.MathUtils.lerp(this.rightArmContainer.rotation.x, -0.8, dt * 5);
          this.leftArmContainer.rotation.x = THREE.MathUtils.lerp(this.leftArmContainer.rotation.x, -0.8, dt * 5);
      } else if (this.state === 'COMBAT' && this.hasWeapon) {
          // Bring back to shooting stance (depends on weapon type, handled in setWeapon normally, but we can lerp back to base)
          // For simplicity, we re-apply weapon pose logic in setWeapon or let it snap, 
          // but here we just ensure we aren't overriding it negatively if we added IK.
          // Since we set rotation in setWeapon, we might need to restore it. 
          // For now, let's just not tilt down.
      }
  }

  private handleDecisionMaking(brManager: IBRManager | undefined, patrolPoints: THREE.Vector3[], player: Player) {
      const myPos = this.mesh.position;
      if (this.team === 'BLUE') { this.state = 'PATROL'; return; }
      if (brManager && !brManager.isPointInZone(myPos)) {
          this.state = 'RUN_TO_ZONE'; this.moveTarget = brManager.currentCenter; return;
      }
      const isSurvival = !brManager;
      
      if (this.hasWeapon) {
          if (this.currentTarget && this.currentTarget.isVisible && this.reactionTimer <= 0) {
              this.state = 'COMBAT'; this.lastKnownTargetPos = this.currentTarget.pos.clone(); return;
          }
          if (this.lastKnownTargetPos) {
              const distToLastKnown = myPos.distanceTo(this.lastKnownTargetPos);
              if (distToLastKnown > 3.0) { this.state = 'CHASE'; this.moveTarget = this.lastKnownTargetPos; return; } 
              else { this.lastKnownTargetPos = null; }
          }
          if (isSurvival && !this.currentTarget) {
              this.state = 'CHASE'; 
              this.moveTarget = player.mesh.position.clone();
              this.moveTarget.x += (Math.random()-0.5)*10;
              this.moveTarget.z += (Math.random()-0.5)*10;
              return;
          }
      }

      if (brManager && !this.hasWeapon) {
          this.state = 'LOOTING';
          if (brManager.tryPickupLoot(myPos)) {
              this.setArmed(true); this.setWeapon(WeaponType.RIFLE); this.state = 'PATROL'; this.moveTarget = null;
          } else {
              if (!this.moveTarget || this.stateTimer <= 0) {
                   const lootPos = brManager.getNearestActiveLoot(myPos);
                   if (lootPos) { this.moveTarget = lootPos; this.stateTimer = 5.0; } 
                   else { this.state = 'PATROL'; }
              }
          }
          return;
      }

      this.state = 'PATROL';
      if (!this.moveTarget || myPos.distanceTo(this.moveTarget) < 3.0) {
          if (patrolPoints.length > 0) { this.moveTarget = patrolPoints[Math.floor(Math.random() * patrolPoints.length)]; } 
          else { this.moveTarget = new THREE.Vector3(myPos.x + (Math.random()-0.5)*60, myPos.y, myPos.z + (Math.random()-0.5)*60); }
      }
  }

  private scanEnvironment(player: Player, allEnemies: Enemy[]) {
      this.visionCheckTimer -= this.aiUpdateRate; 
      if (this.visionCheckTimer > 0) return;
      this.visionCheckTimer = 0.5 + Math.random(); 

      // Reset targets if current is dead or invalid
      if (this.currentTarget) {
          if (this.currentTarget.entity instanceof Player) {
              if (this.currentTarget.entity.stats.health <= 0) this.currentTarget = null;
          } else {
              if ((this.currentTarget.entity as Enemy).health <= 0) this.currentTarget = null;
          }
      }

      const myPos = this.mesh.position;
      const visualRangeSq = 100 * 100;
      
      this._vec3A.set(0,0,1).applyQuaternion(this.mesh.quaternion); 

      let bestTarget = null;
      let minDistanceSq = Infinity;

      // 1. CANDIDATE: PLAYER
      if (player.stats.health > 0) {
          const distToPlayerSq = myPos.distanceToSquared(player.mesh.position);
          const verticalDiffPlayer = Math.abs(player.mesh.position.y - myPos.y);

          if (distToPlayerSq < visualRangeSq && verticalDiffPlayer < 8.0) {
               // FOV Check
               this._vec3B.subVectors(player.mesh.position, myPos).normalize();
               const distToPlayer = Math.sqrt(distToPlayerSq);
               const fovThreshold = distToPlayer < 10 ? -1.0 : 0.2; 

               if (this._vec3A.dot(this._vec3B) > fovThreshold) {
                    if (this.checkLineOfSightToPos(player.mesh.position, distToPlayer)) {
                         bestTarget = { pos: player.mesh.position, isVisible: true, entity: player };
                         minDistanceSq = distToPlayerSq;
                    }
               }
          }
      }

      // 2. CANDIDATES: OTHER BOTS
      // Iterate all enemies to find the closest one.
      for (const other of allEnemies) {
           if (other === this || other.health <= 0 || other.team === this.team) continue;

           const distSq = myPos.distanceToSquared(other.mesh.position);
           
           // Optimization: Only check if it's closer than the current best target (or within range)
           if (distSq < visualRangeSq && distSq < minDistanceSq) {
               const verticalDiff = Math.abs(other.mesh.position.y - myPos.y);
               if (verticalDiff > 8.0) continue;

               // FOV Check
               this._vec3B.subVectors(other.mesh.position, myPos).normalize();
               const dist = Math.sqrt(distSq);
               const fovThreshold = dist < 10 ? -1.0 : 0.2;

               if (this._vec3A.dot(this._vec3B) > fovThreshold) {
                   if (this.checkLineOfSightToPos(other.mesh.position, dist)) {
                       bestTarget = { pos: other.mesh.position, isVisible: true, entity: other };
                       minDistanceSq = distSq;
                   }
               }
           }
      }

      // 3. DECISION
      if (bestTarget) {
          this.currentTarget = bestTarget;
          this.lastKnownTargetPos = bestTarget.pos.clone();
          if (this.state !== 'COMBAT' && this.state !== 'RELOADING') { 
              this.reactionTimer = this.difficulty === 'HARD' ? 0.05 : 0.3; 
          }
      } else {
          // If lost target and not in active combat/chase, clear
          if (this.state !== 'CHASE' && this.state !== 'COMBAT' && this.state !== 'RELOADING') {
              this.currentTarget = null;
          }
      }
  }

  private calculateDesiredVelocity() {
      this.desiredVelocity.set(0,0,0);
      const myPos = this.mesh.position;

      if (this.state === 'COMBAT' && this.currentTarget) {
           const dirToTarget = this._vec3A.subVectors(this.currentTarget.pos, myPos);
           const dist = dirToTarget.length();
           dirToTarget.normalize();

           if (dist > this.engageDistance + 5) {
               this.desiredVelocity.add(dirToTarget.multiplyScalar(this.speed * 1.2)); 
           } else if (dist > this.engageDistance - 5) {
               this.desiredVelocity.add(dirToTarget.multiplyScalar(this.speed * 0.2)); 
               const right = this._vec3B.crossVectors(new THREE.Vector3(0,1,0), dirToTarget).normalize();
               this.desiredVelocity.add(right.multiplyScalar(this.speed * 0.6 * this.combatStrafingDir));
           } else {
               const right = this._vec3B.crossVectors(new THREE.Vector3(0,1,0), dirToTarget).normalize();
               this.desiredVelocity.add(right.multiplyScalar(this.speed * 0.5 * this.combatStrafingDir));
               this.desiredVelocity.add(dirToTarget.multiplyScalar(-this.speed * 0.5)); 
           }
      } 
      else if (this.moveTarget) {
          const dir = this._vec3A.subVectors(this.moveTarget, myPos).normalize();
          let moveSpeed = this.speed;
          if (this.state === 'RUN_TO_ZONE' || this.state === 'CHASE') { moveSpeed *= 1.5; }
          this.desiredVelocity = dir.multiplyScalar(moveSpeed);
      }

      if (this.desiredVelocity.length() > this.speed * 1.5) {
          this.desiredVelocity.normalize().multiplyScalar(this.speed * 1.5);
      }
  }

  private applyLocomotion(dt: number) {
      this.stuckCheckTimer += dt;
      if (this.stuckCheckTimer > 1.0) { 
          this.stuckCheckTimer = 0;
          if (this.desiredVelocity.lengthSq() > 4.0 && this.mesh.position.distanceTo(this.lastStuckPos) < 1.0) {
              this.isStuck = true;
              this.body.velocity.y = 6; 
              this.desiredVelocity.set((Math.random()-0.5)*8, 0, (Math.random()-0.5)*8);
          } else {
              this.isStuck = false;
          }
          this.lastStuckPos.copy(this.mesh.position);
      }

      const currentVel = new THREE.Vector3(this.body.velocity.x, 0, this.body.velocity.z);
      currentVel.lerp(this.desiredVelocity, dt * 6);
      this.body.velocity.x = currentVel.x;
      this.body.velocity.z = currentVel.z;

      if (this.state === 'COMBAT') {
           this.strafeTimer -= dt;
           if (this.strafeTimer <= 0) {
               this.combatStrafingDir *= -1; 
               this.strafeTimer = 0.5 + Math.random();
           }
      }
  }

  private checkLineOfSightToPos(targetPos: THREE.Vector3, dist: number): boolean {
      const origin = this.headMesh.getWorldPosition(new THREE.Vector3());
      const targetCenter = targetPos.clone().add(new THREE.Vector3(0, 1.0, 0));
      this._vec3A.subVectors(targetCenter, origin).normalize();
      origin.add(this._vec3A.clone().multiplyScalar(1.0));

      this.raycaster.set(origin, this._vec3A);
      this.raycaster.far = dist + 1.0; 
      
      const hits = this.raycaster.intersectObjects(this.sceneRef.children, true);
      
      for (const hit of hits) {
          let obj = hit.object;
          if (obj.name === 'muzzle' || obj.name === 'Shell' || obj.name.includes('Particle')) continue;
          
          let isSelf = false;
          let parent = obj;
          while(parent) {
              if (parent === this.mesh) { isSelf = true; break; }
              parent = parent.parent as any;
          }
          if (isSelf) continue;
          
          if (hit.distance < dist - 1.5) { return false; } else { return true; }
      }
      return true;
  }

  private handleCombatAction(player: Player, allEnemies: Enemy[]) {
      if (!this.currentTarget) return;
      
      // CHECK AMMO
      if (this.currentAmmo <= 0) {
          this.state = 'RELOADING';
          this.reloadTimer = this.reloadTime;
          // Reset aim to default pose (implied by updateAnimations handling RELOADING)
          return;
      }

      const now = performance.now();
      if (now - this.lastShotTime > this.fireRate) {
          this.shootAt(this.currentTarget.pos, player, allEnemies);
          this.lastShotTime = now;
          this.currentAmmo--; // Consume ammo
      }
  }

  private shootAt(targetPos: THREE.Vector3, player: Player, allEnemies: Enemy[]) {
      this.muzzleFlashMesh.visible = true;
      this.flashDuration = 50; 

      let soundType: any = 'RIFLE';
      if (this.weaponType === WeaponType.SHOTGUN) soundType = 'SHOTGUN';
      else if (this.weaponType === WeaponType.PISTOL) soundType = 'PISTOL';
      else if (this.weaponType === WeaponType.SNIPER) soundType = 'SNIPER';
      SoundManager.getInstance().playGunshot(soundType, this.mesh.position);

      const origin = this.muzzleFlashMesh.getWorldPosition(new THREE.Vector3());
      const aimPoint = targetPos.clone().add(new THREE.Vector3(0, 1.2, 0)); 
      const baseDir = new THREE.Vector3().subVectors(aimPoint, origin).normalize();

      const isMoving = this.desiredVelocity.lengthSq() > 0.5;
      let finalError = this.accuracyError;
      if (isMoving) finalError *= 1.5; 
      
      const pellets = this.weaponType === WeaponType.SHOTGUN ? 4 : 1; 
      for(let i=0; i<pellets; i++) {
          const dir = baseDir.clone();
          dir.x += (Math.random() - 0.5) * finalError;
          dir.y += (Math.random() - 0.5) * finalError;
          dir.z += (Math.random() - 0.5) * finalError;
          dir.normalize();
          this.performRaycast(origin, dir, player, allEnemies);
      }
  }

  private performRaycast(origin: THREE.Vector3, dir: THREE.Vector3, player: Player, allEnemies: Enemy[]) {
      this.raycaster.set(origin, dir);
      this.raycaster.far = 150;

      const hits = this.raycaster.intersectObjects(this.sceneRef.children, true);
      let hitDistance = Infinity;
      let hitObject: THREE.Object3D | null = null;
      let hitPoint = new THREE.Vector3();
      let hitNormal = new THREE.Vector3(0,1,0);

      for(const hit of hits) {
          if (hit.object.name === 'muzzle' || hit.object.name === 'Shell' || hit.object.name.includes('Particle')) continue;
          let isSelf = false;
          let p = hit.object;
          while(p.parent) { if(p.parent === this.mesh) { isSelf=true; break;} p = p.parent; }
          if (isSelf) continue;

          hitDistance = hit.distance;
          hitObject = hit.object;
          hitPoint = hit.point;
          if (hit.face) hitNormal = hit.face.normal;
          break; 
      }

      let hitPlayer = false;
      const playerCenter = player.mesh.position.clone().add(new THREE.Vector3(0, 1.0, 0)); 
      const ray = new THREE.Ray(origin, dir);
      const distToRay = ray.distanceSqToPoint(playerCenter);
      const playerRadiusSq = 0.5 * 0.5; 

      if (distToRay < playerRadiusSq) {
          const vecToPlayer = new THREE.Vector3().subVectors(playerCenter, origin);
          if (vecToPlayer.dot(dir) > 0) {
              const distToPlayer = vecToPlayer.length();
              if (distToPlayer < hitDistance) {
                  hitPlayer = true;
                  hitPoint = ray.at(distToPlayer, new THREE.Vector3()); 
              }
          }
      }

      if (hitPlayer) {
          const isHeadshot = Math.random() > 0.9; 
          const dmg = isHeadshot ? this.damage * 2 : this.damage;
          player.takeDamage(dmg, this.mesh.position.clone());
          ParticleManager.getInstance().emit('FLESH', hitPoint, dir.clone().negate());
          
          if (player.stats.health <= 0) {
              GameEngine.getInstance().reportKill(this.name, "Maurii IA", WeaponType[this.weaponType], isHeadshot);
          }
      } 
      else if (hitObject) {
          let hitEnemy: Enemy | null = null;
          let currentObj: THREE.Object3D | null = hitObject;
          while(currentObj) {
              if (currentObj.userData && currentObj.userData.enemyRef) {
                  hitEnemy = currentObj.userData.enemyRef as Enemy;
                  break;
              }
              currentObj = currentObj.parent;
          }

          if (hitEnemy && hitEnemy !== this && hitEnemy.team !== this.team && hitEnemy.health > 0) {
              const isHeadshot = hitObject.name === 'HEAD';
              const dmg = isHeadshot ? this.damage * 2 : this.damage;
              hitEnemy.takeDamage(dmg);
              ParticleManager.getInstance().emit('FLESH', hitPoint, hitNormal);

              if (hitEnemy.health <= 0) {
                  GameEngine.getInstance().reportKill(this.name, hitEnemy.name, WeaponType[this.weaponType], isHeadshot);
              }
          } 
          else {
              if (hitObject.name === 'BODY' || hitObject.name === 'HEAD') {
                  ParticleManager.getInstance().emit('FLESH', hitPoint, hitNormal);
              } else {
                  ParticleManager.getInstance().emit('CONCRETE', hitPoint, hitNormal);
              }
          }
      }
  }

  private updateEyeColor() {
      if (this.team === 'BLUE') return;
      let colorHex = 0xffff00; 
      if (this.state === 'COMBAT' || this.state === 'CHASE') colorHex = 0xff0000;
      else if (this.state === 'FLEE') colorHex = 0xffffff; 
      else if (this.state === 'LOOTING') colorHex = 0x00ffff;
      else if (this.state === 'RUN_TO_ZONE') colorHex = 0xff00ff;
      else if (this.state === 'RELOADING') colorHex = 0x888888; // Grey eyes when reloading

      this.eyeMaterial.color.setHex(colorHex);
      this.eyeMaterial.emissive.setHex(colorHex);
  }

  public takeDamage(amount: number) {
      this.health -= amount;
      // If taking damage while reloading, maybe panic? For now, standard behavior.
      if (this.state !== 'COMBAT' && this.state !== 'RELOADING' && this.hasWeapon && !this.isDummy) {
          this.state = 'COMBAT';
          this.reactionTimer = 0; 
      }
      this.eyeMaterial.emissive.setHex(0xffffff);
      this.damageFlashTimer = 0.05; 
  }
}
