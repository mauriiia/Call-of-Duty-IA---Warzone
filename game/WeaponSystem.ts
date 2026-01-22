import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { AssetLoader } from './AssetLoader';
import { CONFIG } from '../constants';
import { PhysicsWorld } from './PhysicsWorld';
import { PlayerStats } from '../types';
import { SoundManager, MaterialType } from './SoundManager';
import { ParticleManager } from './ParticleManager';
import { VFXSystem } from './VFXSystem';

// 1. Multiplicadores de Raridade
const RARITY_MULTIPLIERS: Record<string, number> = {
    'common': 1.0,      
    'uncommon': 1.25,   
    'rare': 1.5,        
    'legendary': 2.0    
};

// 2. Status Base
const WEAPON_BASE_STATS: Record<string, { damage: number, fireRate: number, range: number }> = {
    'M16':       { damage: 19, fireRate: 0.11, range: 160 },
    'AK-27':     { damage: 24, fireRate: 0.12, range: 140 }, 
    'M15':       { damage: 16, fireRate: 0.09, range: 140 }, 

    'P890':      { damage: 14, fireRate: 0.18,  range: 60 },

    'Cypher 091':{ damage: 11, fireRate: 0.7,  range: 25 },  

    'AWM':       { damage: 110, fireRate: 1.5, range: 600 }, 
    'Kar98k':    { damage: 95,  fireRate: 1.3, range: 500 },
    
    'default':   { damage: 10,  fireRate: 0.1, range: 100 }
};

export enum WeaponType {
  NONE = -1,
  RIFLE = 0,
  PISTOL = 1,
  SHOTGUN = 2,
  SNIPER = 3,
  GRENADE = 4
}

export enum WeaponTier {
    COMMON = 0,    
    UNCOMMON = 1,  
    RARE = 2,      
    LEGENDARY = 3  
}

export interface WeaponData {
    type: WeaponType;
    tier: WeaponTier;
    ammoInClip: number;
    reserveAmmo: number;
    modelName: string;
}

export interface DamageProfile {
    body: number;
    head: number;
    variance: number; 
}

// Otimização: Estruturas de Pool
interface Shell {
    mesh: THREE.Mesh;
    active: boolean;
    velocity: THREE.Vector3;
    rotVel: THREE.Vector3;
    life: number;
}

interface Tracer {
    mesh: THREE.Mesh;
    active: boolean;
    life: number;
    maxLife: number;
    startPos: THREE.Vector3;
    endPos: THREE.Vector3;
}

export class WeaponSystem {
  public mesh: THREE.Group; 
  private modelContainer: THREE.Group; 
  
  public inventory: (WeaponData | null)[] = [null, null, null];
  public activeSlot: number = 0;

  public currentWeapon: WeaponType = WeaponType.NONE;
  public currentTier: WeaponTier = WeaponTier.COMMON;
  public currentModelName: string = "";
  
  public isAiming: boolean = false;
  public isReloading: boolean = false;
  private reloadTimer: number = 0;
  
  public fireMode: 'AUTO' | 'SEMI' | 'BOLT' | 'PUMP' = 'AUTO';
  public canShootSemi: boolean = true;
  private gunHeat: number = 0;
  
  private camera: THREE.Camera;
  private scene: THREE.Scene;
  private raycaster = new THREE.Raycaster();
  private soundManager: SoundManager;
  private particleManager: ParticleManager;
  private vfxSystem: VFXSystem;
  
  private lastShotTime: number = 0;
  
  // Positions
  private hipPosition: THREE.Vector3 = new THREE.Vector3(0.2, -0.25, -0.4);
  private aimPosition: THREE.Vector3 = new THREE.Vector3(0.0, -0.1224, -0.2);
  private sprintPosition: THREE.Vector3 = new THREE.Vector3(0.15, -0.1, -0.25);
  private sprintRotation: THREE.Vector3 = new THREE.Vector3(0.8, 0.5, -0.3); 
  private reloadPosition: THREE.Vector3 = new THREE.Vector3(0.15, -0.3, -0.3); 
  private reloadRotation: THREE.Vector3 = new THREE.Vector3(0.5, 0.5, 0.2);   
  
  private currentBaseRotation: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  private currentPosition: THREE.Vector3;
  private swayPosition: THREE.Vector3 = new THREE.Vector3();
  private recoil: THREE.Vector3 = new THREE.Vector3();
  private recoilRot: THREE.Vector3 = new THREE.Vector3();

  private muzzleFlashMesh: THREE.Mesh;
  private muzzleLight: THREE.PointLight;
  private flashDuration: number = 0;
  
  // POOLS (Otimização)
  private shellPool: Shell[] = [];
  private shellIndex: number = 0;
  private ejectionPort: THREE.Object3D | null = null; 

  private tracerPool: Tracer[] = [];
  private tracerIndex: number = 0;

  // Shared Geometries
  private tracerGeometry: THREE.BufferGeometry;
  private tracerMaterial: THREE.MeshBasicMaterial;

  public onDropWeapon: ((type: WeaponType, tier: WeaponTier, pos: THREE.Vector3) => void) | null = null;

  constructor(camera: THREE.Camera, scene: THREE.Scene, physics: PhysicsWorld) {
    this.camera = camera;
    this.scene = scene;
    this.soundManager = SoundManager.getInstance();
    this.particleManager = ParticleManager.getInstance();
    this.vfxSystem = new VFXSystem(scene);
    
    this.currentPosition = this.hipPosition.clone();

    this.mesh = new THREE.Group();
    this.modelContainer = new THREE.Group();
    this.mesh.add(this.modelContainer);
    this.camera.add(this.mesh);

    const flashGeo = new THREE.PlaneGeometry(0.3, 0.3);
    const flashMat = AssetLoader.getInstance().materials['muzzle'].clone(); 
    flashMat.depthWrite = false; 
    
    this.muzzleFlashMesh = new THREE.Mesh(flashGeo, flashMat);
    this.muzzleFlashMesh.name = 'muzzle'; 
    this.muzzleFlashMesh.visible = false;
    this.muzzleFlashMesh.castShadow = false; 
    this.muzzleFlashMesh.receiveShadow = false;
    
    this.muzzleLight = new THREE.PointLight(0xffaa00, 0, 10);
    this.mesh.add(this.muzzleLight);

    // TRACER INIT (Shared)
    const geo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    geo.rotateX(-Math.PI / 2); // Align Z
    geo.translate(0, 0, 0.5);  // Pivot start
    this.tracerGeometry = geo;

    this.tracerMaterial = new THREE.MeshBasicMaterial({ 
        color: 0xffffaa, 
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    this.initShells();
    this.initTracers(); // Start pool
  }

  private initShells() {
      const geo = new THREE.CylinderGeometry(0.01, 0.01, 0.03, 6);
      geo.rotateX(Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.3, metalness: 1.0 });

      for(let i=0; i<40; i++) {
          const mesh = new THREE.Mesh(geo, mat.clone());
          mesh.name = "Shell";
          mesh.visible = false;
          mesh.frustumCulled = false; 
          this.scene.add(mesh);
          this.shellPool.push({
              mesh, active: false, velocity: new THREE.Vector3(), rotVel: new THREE.Vector3(), life: 0
          });
      }
  }

  private initTracers() {
      // Create 20 recycled tracer meshes
      for(let i=0; i<20; i++) {
          const mesh = new THREE.Mesh(this.tracerGeometry, this.tracerMaterial.clone());
          mesh.name = "Tracer";
          mesh.visible = false;
          mesh.frustumCulled = false;
          this.scene.add(mesh);
          
          this.tracerPool.push({
              mesh,
              active: false,
              life: 0,
              maxLife: 0,
              startPos: new THREE.Vector3(),
              endPos: new THREE.Vector3()
          });
      }
  }

  // --- GAMEPLAY CALCULATIONS ---

  public getCurrentStats() {
      return WEAPON_BASE_STATS[this.currentModelName] || WEAPON_BASE_STATS['default'];
  }

  public getCalculatedDamage(): number {
      const stats = this.getCurrentStats();
      const tierMap: Record<number, string> = {
          [WeaponTier.COMMON]: 'common',
          [WeaponTier.UNCOMMON]: 'uncommon',
          [WeaponTier.RARE]: 'rare',
          [WeaponTier.LEGENDARY]: 'legendary'
      };
      const rarityKey = tierMap[this.currentTier] || 'common';
      const multiplier = RARITY_MULTIPLIERS[rarityKey];
      return Math.floor(stats.damage * multiplier);
  }

  public getCalculatedFireRateMs(): number {
      const stats = this.getCurrentStats();
      return stats.fireRate * 1000;
  }

  public selectSlot(slotIndex: number) {
      if (slotIndex < 0 || slotIndex > 2) return;
      if (this.activeSlot === slotIndex) return;

      this.activeSlot = slotIndex;
      const data = this.inventory[slotIndex];
      
      if (data) {
          this.switchWeapon(data.type, data.tier, data.modelName);
      } else {
          this.switchWeapon(WeaponType.NONE, WeaponTier.COMMON);
      }
  }

  public pickup(type: WeaponType, tier: WeaponTier): boolean {
      const dummyGroup = this.generateMesh(type, tier); 
      const modelName = dummyGroup.name;

      const newWeapon: WeaponData = {
          type,
          tier,
          ammoInClip: this.getMaxAmmo(type), 
          reserveAmmo: this.getMaxAmmo(type) * 3,
          modelName
      };

      let targetSlot = -1;

      if (type === WeaponType.PISTOL) {
          targetSlot = 1;
      } else {
          if (this.activeSlot !== 1) {
              if (this.inventory[this.activeSlot] === null) {
                  targetSlot = this.activeSlot;
              } else {
                  targetSlot = this.activeSlot;
              }
          } 
          if (targetSlot === -1) {
              if (this.inventory[0] === null) targetSlot = 0;
              else if (this.inventory[2] === null) targetSlot = 2;
              else targetSlot = 0; 
          }
      }

      const oldItem = this.inventory[targetSlot];
      
      if (oldItem) {
          if (this.onDropWeapon) {
              const dropPos = this.camera.getWorldPosition(new THREE.Vector3());
              const dropDir = this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(2.0);
              dropPos.add(dropDir); 
              this.onDropWeapon(oldItem.type, oldItem.tier, dropPos);
          }
      }

      this.inventory[targetSlot] = newWeapon;
      this.activeSlot = targetSlot;
      this.switchWeapon(newWeapon.type, newWeapon.tier, newWeapon.modelName);
      
      return true;
  }

  private getMaxAmmo(type: WeaponType): number {
      if (type === WeaponType.SNIPER) return 5;
      if (type === WeaponType.SHOTGUN) return 8;
      if (type === WeaponType.PISTOL) return 12;
      return 30; // Rifle
  }

  // --- VISUALS ---

  public generateMesh(type: WeaponType, tier: WeaponTier, forcedModelName?: string): THREE.Group {
      let group = new THREE.Group();
      
      if (forcedModelName) {
          if (forcedModelName === "M16") group = this.createM16();
          else if (forcedModelName === "AK-27") group = this.createAK27();
          else if (forcedModelName === "M15") group = this.createM15();
          else if (forcedModelName === "P890") group = this.createP890();
          else if (forcedModelName === "Cypher 091") group = this.createCypher091();
          else if (forcedModelName === "AWM") group = this.createAWM();
          else if (forcedModelName === "Kar98k") group = this.createKar98k();
          else {
              if (type === WeaponType.PISTOL) group = this.createP890();
              else if (type === WeaponType.SHOTGUN) group = this.createCypher091();
              else group = this.createM15(); 
          }
      } else {
          if (type === WeaponType.PISTOL) group = this.createP890();
          else if (type === WeaponType.SHOTGUN) group = this.createCypher091();
          else if (type === WeaponType.SNIPER) group = Math.random() > 0.5 ? this.createAWM() : this.createKar98k();
          else if (type === WeaponType.RIFLE) {
              const rnd = Math.random();
              if (rnd < 0.33) group = this.createM16();
              else if (rnd < 0.66) group = this.createAK27();
              else group = this.createM15();
          }
      }

      return group;
  }

  private switchWeapon(type: WeaponType, tier: WeaponTier, modelName?: string) {
      this.currentWeapon = type;
      this.currentTier = tier;
      
      while(this.modelContainer.children.length > 0){ 
          this.modelContainer.remove(this.modelContainer.children[0]); 
      }
      this.ejectionPort = null;

      if (type === WeaponType.NONE) return;

      const weaponGroup = this.generateMesh(type, tier, modelName);
      this.currentModelName = weaponGroup.name;
      
      this.modelContainer.add(weaponGroup);
      
      weaponGroup.add(this.muzzleFlashMesh); 
      
      const port = weaponGroup.getObjectByName("EjectionPort");
      if (port) this.ejectionPort = port;

      // Stats Configuration
      if (this.currentWeapon === WeaponType.RIFLE) {
          this.fireMode = 'AUTO';
          
          if (this.currentModelName === 'M16') {
              this.aimPosition.set(0.0, -0.13, -0.2); 
          } else if (this.currentModelName === 'AK-27') {
              this.aimPosition.set(0.0, -0.19, -0.2); 
          } else {
              this.aimPosition.set(0.0, -0.18, -0.2);
          }

      } else if (this.currentWeapon === WeaponType.PISTOL) {
          this.fireMode = 'SEMI';
          this.aimPosition.set(0.0, -0.068, -0.25); 
      } else if (this.currentWeapon === WeaponType.SHOTGUN) {
          this.fireMode = 'PUMP';
          this.aimPosition.set(0.0, -0.11, -0.25); 
      } else if (this.currentWeapon === WeaponType.SNIPER) {
          this.fireMode = 'BOLT';
          this.aimPosition.set(0.0, -0.11, -0.2);
      }

      this.isReloading = false;
      this.reloadTimer = 0;
      this.currentPosition.y -= 0.3; 
  }

  // --- DAMAGE SYSTEM IMPLEMENTATION ---
  
  public getDamageStats(): DamageProfile {
      const multiplier = this.getTierMultiplier();
      const stats: DamageProfile = { body: 25, head: 50, variance: 5 }; 

      if (this.currentWeapon === WeaponType.SNIPER) {
          if (this.currentModelName === 'AWM') {
              stats.body = 110;  
              stats.head = 250; 
              stats.variance = 5;
          } else {
              stats.body = 95;
              stats.head = 190;
              stats.variance = 10; 
          }
      } 
      else if (this.currentWeapon === WeaponType.RIFLE) {
          stats.body = 28;
          stats.head = 55;
          stats.variance = 4;
      }
      else if (this.currentWeapon === WeaponType.SHOTGUN) {
          stats.body = 15;
          stats.head = 22;
          stats.variance = 2;
      }
      else if (this.currentWeapon === WeaponType.PISTOL) {
          stats.body = 20; 
          stats.head = 40;
          stats.variance = 3;
      }

      stats.body *= multiplier;
      stats.head *= multiplier;
      stats.variance *= multiplier;

      return stats;
  }

  private getTierMultiplier(): number {
      switch (this.currentTier) {
          case WeaponTier.COMMON: return 1.0;
          case WeaponTier.UNCOMMON: return 1.1; 
          case WeaponTier.RARE: return 1.25;    
          case WeaponTier.LEGENDARY: return 1.5; 
          default: return 1.0;
      }
  }

  public getWeaponName(): string {
      if (this.currentWeapon === WeaponType.NONE) return "DESARMADO"; 
      let name = this.currentModelName || WeaponType[this.currentWeapon];
      return name;
  }

  public getDesiredFOV(baseFov: number): number {
      if (!this.isAiming || this.currentWeapon === WeaponType.NONE) return baseFov;
      
      if (this.currentWeapon === WeaponType.SNIPER) return 11.25; 
      if (this.currentWeapon === WeaponType.RIFLE) return 35; 
      if (this.currentWeapon === WeaponType.SHOTGUN) return 55; 
      if (this.currentWeapon === WeaponType.PISTOL) return 60; 
      
      return 60;
  }

  public toggleFireMode() {
      if (this.currentWeapon === WeaponType.RIFLE) {
          this.fireMode = this.fireMode === 'AUTO' ? 'SEMI' : 'AUTO';
      }
  }

  public fire(stats: PlayerStats): boolean {
    if (this.currentWeapon === WeaponType.NONE) return false;
    if (this.isReloading) return false;
    if (this.fireMode === 'SEMI' && !this.canShootSemi) return false;
    if (this.fireMode === 'PUMP' && !this.canShootSemi) return false;
    if (this.fireMode === 'BOLT' && !this.canShootSemi) return false;

    const currentItem = this.inventory[this.activeSlot];
    if (!currentItem || currentItem.ammoInClip <= 0) {
        this.soundManager.playVoice("Dry Fire"); 
        return false;
    }

    const now = performance.now();
    const fireRateMs = this.getCalculatedFireRateMs();

    if (now - this.lastShotTime > fireRateMs) {
      this.lastShotTime = now;
      if (this.fireMode !== 'AUTO') this.canShootSemi = false;

      this.triggerRecoil(); 
      this.triggerMuzzleFlash();
      
      this.ejectShell();
      
      let soundType: any = 'RIFLE';
      if (this.currentWeapon === WeaponType.PISTOL) soundType = 'PISTOL';
      if (this.currentWeapon === WeaponType.SHOTGUN) soundType = 'SHOTGUN';
      if (this.currentWeapon === WeaponType.SNIPER) soundType = 'SNIPER';
      this.soundManager.playGunshot(soundType);

      this.performRaycastVisuals();
      
      currentItem.ammoInClip--;

      return true;
    }
    return false;
  }

  public triggerRecoil() {
      if (this.currentWeapon === WeaponType.NONE) return;
      let aimFactor = this.isAiming ? 0.3 : 1.0; 
      
      let kick = 0.08;
      if (this.currentWeapon === WeaponType.PISTOL) kick = 0.05;
      if (this.currentWeapon === WeaponType.SNIPER) kick = 0.3; 
      if (this.currentWeapon === WeaponType.SHOTGUN) kick = 0.2;

      this.recoil.z += kick * aimFactor; 
      
      this.recoilRot.x += (kick * 1.5) * aimFactor; 
      this.recoilRot.y += (Math.random() - 0.5) * 0.05 * aimFactor; 
      this.recoilRot.z += (Math.random() - 0.5) * 0.05 * aimFactor; 
  }

  public startReload(stats: PlayerStats) {
      const currentItem = this.inventory[this.activeSlot];
      if (!currentItem) return;
      if (this.isReloading || currentItem.ammoInClip === this.getMaxAmmo(currentItem.type)) return;
      
      this.isReloading = true;
      stats.isReloading = true; 
      this.soundManager.playVoice("Reloading!");
      this.recoilRot.x -= 0.2; 
      
      switch (this.currentWeapon) {
          case WeaponType.PISTOL: this.reloadTimer = 1.5; break;
          case WeaponType.RIFLE: this.reloadTimer = 2.5; break;
          case WeaponType.SHOTGUN: this.reloadTimer = 3.0; break;
          case WeaponType.SNIPER: this.reloadTimer = 3.5; break;
          default: this.reloadTimer = 2.5;
      }
  }

  public update(dt: number, inputDelta: { x: number, y: number }, isMoving: boolean, isAimingInput: boolean, stats: PlayerStats, isSprinting: boolean = false, forceHide: boolean = false) {
      const isSniperAiming = isAimingInput && this.currentWeapon === WeaponType.SNIPER;
      
      this.vfxSystem.update(dt);

      if (forceHide || this.currentWeapon === WeaponType.NONE || isSniperAiming) {
          this.mesh.visible = false;
          if (forceHide || this.currentWeapon === WeaponType.NONE) return;
      } else {
          this.mesh.visible = true;
      }

      if (this.isReloading) {
          this.reloadTimer -= dt;
          if (this.reloadTimer <= 0) {
              const currentItem = this.inventory[this.activeSlot];
              if (currentItem) {
                  currentItem.ammoInClip = this.getMaxAmmo(currentItem.type);
              }
              this.isReloading = false;
              stats.isReloading = false;
          }
      } else {
          stats.isReloading = false;
      }

      this.isAiming = isAimingInput && !this.isReloading && !isSprinting;

      this.updateShells(dt);
      this.updateTracers(dt); // NEW TRACER UPDATE

      if (this.flashDuration > 0) {
          this.flashDuration--;
          if (this.muzzleFlashMesh.visible) {
              this.muzzleFlashMesh.lookAt(this.camera.position);
          }
      } else {
          this.muzzleFlashMesh.visible = false;
          this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 40);
      }

      this.gunHeat = Math.max(0, this.gunHeat - dt * 0.5);

      let targetPos = this.hipPosition;
      let targetRot = new THREE.Vector3(0, 0, 0); 

      if (this.isReloading) {
          targetPos = this.reloadPosition;
          targetRot = this.reloadRotation;
      } else if (this.isAiming) {
          targetPos = this.aimPosition;
      } else if (isSprinting) {
          targetPos = this.sprintPosition;
          targetRot = this.sprintRotation;
      }

      const speed = this.isAiming ? 18 : 12;
      this.currentPosition.lerp(targetPos, dt * speed);
      this.currentBaseRotation.lerp(targetRot, dt * speed);

      const swayIntensity = this.isAiming ? 0.00005 : 0.0005; 
      const maxSway = this.isAiming ? 0.005 : 0.08;

      const targetSwayX = -Math.max(-maxSway, Math.min(maxSway, inputDelta.x * swayIntensity));
      const targetSwayY = Math.max(-maxSway, Math.min(maxSway, inputDelta.y * swayIntensity));

      this.swayPosition.x = THREE.MathUtils.lerp(this.swayPosition.x, targetSwayX, dt * 10);
      this.swayPosition.y = THREE.MathUtils.lerp(this.swayPosition.y, targetSwayY, dt * 10);

      let bobX = 0, bobY = 0;
      if (isMoving && !this.isAiming) {
          const freq = isSprinting ? 20 : 15; 
          const amp = isSprinting ? 0.015 : 0.008;
          const time = performance.now() * 0.001 * freq;
          bobY = Math.sin(time) * amp;
          bobX = Math.cos(time * 0.5) * amp;
          if (this.isReloading) { bobX *= 0.5; bobY *= 0.5; }
      }

      this.recoil.lerp(new THREE.Vector3(0, 0, 0), dt * 10);
      this.recoilRot.lerp(new THREE.Vector3(0, 0, 0), dt * 10);

      this.mesh.position.copy(this.currentPosition)
          .add(this.swayPosition)
          .add(new THREE.Vector3(bobX, bobY, 0));
      
      this.mesh.position.z += this.recoil.z;

      this.mesh.rotation.set(
          this.currentBaseRotation.x + (this.swayPosition.y * 2) + this.recoilRot.x, 
          this.currentBaseRotation.y + (this.swayPosition.x * 2) + this.recoilRot.y, 
          this.currentBaseRotation.z + this.recoilRot.z
      );
  }

  // ... (Model creations M16, AK27 etc are fine, keep them) ...
  private createP890(): THREE.Group {
      const group = new THREE.Group(); group.name = "P890"; const S = 0.8;
      const matSlide = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.3, metalness: 0.8 }); 
      const matFrame = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.7 });
      const matGrip = new THREE.MeshStandardMaterial({ color: 0x3d2817, roughness: 0.9 });
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.03, 0.18), matFrame);
      frame.position.set(0, 0.005, 0.01); group.add(frame);
      const slide = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.045, 0.21), matSlide);
      slide.position.set(0, 0.04, 0.02); group.add(slide);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.12, 0.06), matFrame);
      grip.position.set(0, -0.07, 0.06); grip.rotation.x = 0.15; group.add(grip);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.043, 0.1, 0.05), matGrip);
      panel.position.set(0, -0.07, 0.06); panel.rotation.x = 0.15; group.add(panel);
      const triggerGuard = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.04, 0.06), matFrame);
      triggerGuard.position.set(0, -0.03, -0.02); group.add(triggerGuard);
      const port = new THREE.Object3D(); port.name = "EjectionPort"; port.position.set(0.03, 0.04, 0.01); group.add(port);
      this.muzzleFlashMesh.position.set(0, 0.035, -0.22); this.muzzleLight.position.set(0, 0.035, -0.3);
      group.scale.set(S,S,S); return group;
  }
  private createAK27(): THREE.Group {
      const group = new THREE.Group(); group.name = "AK-27"; const S = 0.9;
      const matWood = new THREE.MeshStandardMaterial({ color: 0x6e3b1e, roughness: 0.6 });
      const matMetal = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5, metalness: 0.6 });
      const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.3), matMetal); receiver.position.set(0, 0, 0.1); group.add(receiver);
      const dustCover = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.3, 8, 1, false, 0, Math.PI), matMetal);
      dustCover.rotation.z = Math.PI/2; dustCover.rotation.y = Math.PI/2; dustCover.position.set(0, 0.035, 0.1); group.add(dustCover);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.1, 0.3), matWood); stock.position.set(0, -0.05, 0.4); stock.rotation.x = 0.2; group.add(stock);
      const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.2), matWood); handguard.position.set(0, 0, -0.2); group.add(handguard);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 8), matMetal); barrel.rotation.x = Math.PI/2; barrel.position.set(0, 0.01, -0.45); group.add(barrel);
      const gasTube = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.2, 8), matMetal); gasTube.rotation.x = Math.PI/2; gasTube.position.set(0, 0.04, -0.2); group.add(gasTube);
      const magTop = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.06), matMetal); magTop.position.set(0, -0.08, -0.02); magTop.rotation.x = 0.3; group.add(magTop);
      const magBot = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.06), matMetal); magBot.position.set(0, -0.16, 0.03); magBot.rotation.x = 0.6; group.add(magBot);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.12, 0.05), matWood); grip.position.set(0, -0.1, 0.15); grip.rotation.x = 0.2; group.add(grip);
      const port = new THREE.Object3D(); port.name = "EjectionPort"; port.position.set(0.04, 0.02, 0.05); group.add(port);
      this.muzzleFlashMesh.position.set(0, 0.01, -0.75); this.muzzleLight.position.set(0, 0.01, -0.8);
      group.scale.set(S,S,S); return group;
  }
  private createM16(): THREE.Group { 
      const group = new THREE.Group(); group.name = "M16"; const S = 0.9;
      const matBlack = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6, metalness: 0.2 });
      const matGrey = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5 });
      const lower = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.25), matGrey); lower.position.set(0, -0.02, 0.1); group.add(lower);
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.25), matGrey); upper.position.set(0, 0.04, 0.1); group.add(upper);
      const handleLeg1 = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.04), matBlack); handleLeg1.position.set(0, 0.09, 0.18); group.add(handleLeg1);
      const handleLeg2 = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.04), matBlack); handleLeg2.position.set(0, 0.09, 0.02); group.add(handleLeg2);
      const handleTop = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.015, 0.22), matBlack); handleTop.position.set(0, 0.11, 0.1); group.add(handleTop);
      const handguard = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.35, 8), matBlack); handguard.rotation.x = Math.PI/2; handguard.position.set(0, 0.02, -0.2); group.add(handguard);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.15), matGrey); barrel.rotation.x = Math.PI/2; barrel.position.set(0, 0.02, -0.45); group.add(barrel);
      const frontSight = new THREE.Mesh(new THREE.ConeGeometry(0.01, 0.05, 4), matBlack); frontSight.position.set(0, 0.05, -0.4); group.add(frontSight);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.25), matBlack); stock.position.set(0, 0.0, 0.35); group.add(stock);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.06), matBlack); grip.position.set(0, -0.1, 0.15); grip.rotation.x = 0.2; group.add(grip);
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.15, 0.07), matGrey); mag.position.set(0, -0.1, 0.05); mag.rotation.x = 0.1; group.add(mag);
      const port = new THREE.Object3D(); port.name = "EjectionPort"; port.position.set(0.035, 0.04, 0.1); group.add(port);
      this.muzzleFlashMesh.position.set(0, 0.02, -0.6); group.scale.set(S,S,S); return group;
  }
  private createM15(): THREE.Group { 
      const group = this.createM16(); group.name = "M15";
      group.clear(); const S = 0.9;
      const matBlack = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 });
      const matGrey = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5 });
      const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.25), matGrey); receiver.position.set(0, 0, 0.1); group.add(receiver);
      const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.07, 0.25), matBlack); handguard.position.set(0, 0, -0.15); group.add(handguard);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.55), matGrey); barrel.rotation.x = Math.PI/2; barrel.position.set(0, 0.02, -0.3); group.add(barrel);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.25), matBlack); stock.position.set(0, -0.02, 0.35); group.add(stock);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.06), matBlack); grip.position.set(0, -0.1, 0.15); grip.rotation.x = 0.2; group.add(grip);
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.15, 0.07), matGrey); mag.position.set(0, -0.12, 0.05); mag.rotation.x = 0.1; group.add(mag);
      const sight = this.createReflexSight(false); sight.position.set(0, 0.06, 0.1); group.add(sight);
      const port = new THREE.Object3D(); port.name = "EjectionPort"; port.position.set(0.035, 0.02, 0.1); group.add(port);
      this.muzzleFlashMesh.position.set(0, 0.02, -0.6); group.scale.set(S,S,S); return group;
  }
  private createKar98k(): THREE.Group { 
      const group = new THREE.Group(); group.name = "Kar98k";
      const wood = new THREE.MeshStandardMaterial({ color: 0x5c3a21, roughness: 0.7 });
      const metal = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4, metalness: 0.8 });
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.85), wood); stock.position.set(0, -0.02, 0.1); group.add(stock);
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.09, 0.02), metal); band.position.set(0, -0.02, -0.25); group.add(band);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.01, 0.95), metal); barrel.rotation.x = Math.PI/2; barrel.position.set(0, 0.04, -0.2); group.add(barrel);
      const receiver = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.2), metal); receiver.rotation.x = Math.PI/2; receiver.position.set(0, 0.04, 0.25); group.add(receiver);
      const boltHandle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.01, 0.01), metal); boltHandle.position.set(0.04, 0.04, 0.3); group.add(boltHandle);
      const boltKnob = new THREE.Mesh(new THREE.SphereGeometry(0.015), metal); boltKnob.position.set(0.08, 0.04, 0.3); group.add(boltKnob);
      const tGuard = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.08), metal); tGuard.position.set(0, -0.08, 0.2); group.add(tGuard);
      const port = new THREE.Object3D(); port.name = "EjectionPort"; port.position.set(0.0, 0.05, 0.25); group.add(port);
      this.muzzleFlashMesh.position.set(0, 0.04, -0.7); return group; 
  }
  private createAWM(): THREE.Group { 
      const group = new THREE.Group(); group.name = "AWM";
      const greenPoly = new THREE.MeshStandardMaterial({ color: 0x4b5320, roughness: 0.6 });
      const metal = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.5), greenPoly); body.position.set(0, 0, 0.2); group.add(body);
      const stockBack = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.2), greenPoly); stockBack.position.set(0, -0.02, 0.6); group.add(stockBack);
      const stockBridge = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.2), greenPoly); stockBridge.position.set(0, 0.03, 0.4); group.add(stockBridge);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.8), metal); barrel.rotation.x = Math.PI/2; barrel.position.set(0, 0.03, -0.45); group.add(barrel);
      const brake = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.08), metal); brake.position.set(0, 0.03, -0.85); group.add(brake);
      const scopeBody = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.35), metal); scopeBody.rotation.x = Math.PI/2; scopeBody.position.set(0, 0.11, 0.1); group.add(scopeBody);
      const scopeBellFront = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.025, 0.05), metal); scopeBellFront.rotation.x = Math.PI/2; scopeBellFront.position.set(0, 0.11, -0.08); group.add(scopeBellFront);
      const scopeBellBack = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.05), metal); scopeBellBack.rotation.x = Math.PI/2; scopeBellBack.position.set(0, 0.11, 0.28); group.add(scopeBellBack);
      const bipod = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.2), metal); bipod.position.set(0, -0.05, -0.3); group.add(bipod);
      const port = new THREE.Object3D(); port.name = "EjectionPort"; port.position.set(0.03, 0.04, 0.15); group.add(port);
      this.muzzleFlashMesh.position.set(0, 0.03, -0.9); return group; 
  }
  private createCypher091(): THREE.Group { 
      const group = new THREE.Group(); group.name = "Cypher 091";
      const matBody = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.4, metalness: 0.8 });
      const matGrip = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
      const matNeon = new THREE.MeshBasicMaterial({ color: 0x00ffff });
      const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.4), matBody); receiver.position.set(0, 0.02, 0.1); group.add(receiver);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.01, 0.38), matNeon); rail.position.set(0, 0.085, 0.1); group.add(rail);
      const sideLightL = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.02, 0.2), matNeon); sideLightL.position.set(-0.041, 0.02, 0.1); group.add(sideLightL);
      const sideLightR = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.02, 0.2), matNeon); sideLightR.position.set(0.041, 0.02, 0.1); group.add(sideLightR);
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.5), matBody); barrel.position.set(0, 0.02, -0.35); group.add(barrel);
      const pump = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.2), matGrip); pump.position.set(0, -0.04, -0.3); group.add(pump);
      const stockTop = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.3), matBody); stockTop.position.set(0, 0.04, 0.4); group.add(stockTop);
      const stockBot = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.3), matBody); stockBot.position.set(0, -0.06, 0.4); group.add(stockBot);
      const buttPad = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.02), matGrip); buttPad.position.set(0, -0.01, 0.55); group.add(buttPad);
      const muzzleRing = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.005, 8, 16), matNeon); muzzleRing.position.set(0, 0.02, -0.6); group.add(muzzleRing);
      const sight = this.createCoyoteSight(); sight.position.set(0, 0.09, 0.1); group.add(sight);
      const port = new THREE.Object3D(); port.name = "EjectionPort"; port.position.set(0.04, 0.03, 0.1); group.add(port);
      this.muzzleFlashMesh.position.set(0, 0.02, -0.65); 
      return group; 
  }

  public getShootingRays(): THREE.Ray[] {
      const rays: THREE.Ray[] = [];
      const origin = this.camera.getWorldPosition(new THREE.Vector3());
      const baseDir = this.camera.getWorldDirection(new THREE.Vector3());
      
      const count = this.currentWeapon === WeaponType.SHOTGUN ? 8 : 1;
      let spread = this.isAiming ? 0 : 0.015;
      if (this.currentWeapon === WeaponType.SHOTGUN) spread = 0.08;
      if (this.currentWeapon === WeaponType.SNIPER && !this.isAiming) spread = 0.2;

      for(let i=0; i<count; i++) {
          const dir = baseDir.clone();
          dir.x += (Math.random() - 0.5) * spread;
          dir.y += (Math.random() - 0.5) * spread;
          dir.z += (Math.random() - 0.5) * spread;
          dir.normalize();
          rays.push(new THREE.Ray(origin, dir));
      }
      return rays;
  }

  // --- RECYCLED TRACER SYSTEM ---
  private createBulletTracer(startPos: THREE.Vector3, endPos: THREE.Vector3, weaponName: string) {
      // Get tracer from pool
      const tracer = this.tracerPool[this.tracerIndex];
      this.tracerIndex = (this.tracerIndex + 1) % this.tracerPool.length;

      tracer.active = true;
      tracer.life = 1.0;
      tracer.maxLife = 0.08; // Very short life (0.08s)
      tracer.startPos.copy(startPos);
      tracer.endPos.copy(endPos);

      // Determine Style
      let color = 0xffffaa;
      let thickness = 0.02;

      if (this.currentModelName === 'AK-27') { thickness = 0.05; color = 0xff8800; } 
      else if (this.currentModelName === 'M16') { thickness = 0.035; color = 0xffffaa; }
      else if (this.currentModelName === 'Cypher 091') { thickness = 0.02; color = 0x00ffff; }
      else if (this.currentModelName === 'AWM') { thickness = 0.05; color = 0xffffff; }

      // Setup Visuals
      tracer.mesh.visible = true;
      (tracer.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
      (tracer.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8;
      
      const dist = startPos.distanceTo(endPos);
      tracer.mesh.position.copy(startPos);
      tracer.mesh.lookAt(endPos);
      tracer.mesh.scale.set(thickness, thickness, dist);
  }

  private updateTracers(dt: number) {
      for (const t of this.tracerPool) {
          if (!t.active) continue;

          t.life -= dt;
          if (t.life <= 1.0 - t.maxLife) { // Expired
              t.active = false;
              t.mesh.visible = false;
          } else {
              // Fade out effect
              const progress = (t.life - (1.0 - t.maxLife)) / t.maxLife;
              (t.mesh.material as THREE.MeshBasicMaterial).opacity = progress * 0.8;
          }
      }
  }

  private performRaycastVisuals() {
      const muzzlePos = this.muzzleFlashMesh.getWorldPosition(new THREE.Vector3());
      const baseDir = new THREE.Vector3();
      this.camera.getWorldDirection(baseDir);
      
      const count = this.currentWeapon === WeaponType.SHOTGUN ? 6 : 1; 
      
      for(let i=0; i<count; i++) {
          const dir = baseDir.clone();
          
          let spread = this.isAiming ? 0 : 0.015;
          if (this.currentWeapon === WeaponType.SHOTGUN) spread = 0.08;
          if (this.currentWeapon === WeaponType.SNIPER && !this.isAiming) spread = 0.2;

          if (spread > 0) {
              dir.x += (Math.random() - 0.5) * spread;
              dir.y += (Math.random() - 0.5) * spread;
              dir.z += (Math.random() - 0.5) * spread;
              dir.normalize();
          }

          this.raycaster.set(muzzlePos, dir);
          let targetPoint = muzzlePos.clone().add(dir.multiplyScalar(200));
          
          const intersects = this.raycaster.intersectObjects(this.scene.children, true);
          for (const hit of intersects) {
               if (hit.object.name === "Shell" || hit.object.name === "Tracer" || hit.object.name === "muzzle") continue;
               let isSelf = false;
               let parent = hit.object;
               while(parent) {
                   if (parent === this.mesh || parent.name.includes("Player")) { isSelf = true; break; }
                   parent = parent.parent as any;
               }
               if (isSelf) continue;
               if (hit.distance < 1 && !hit.object.name.includes("Enemy")) continue;

               targetPoint = hit.point;
               
               let matType: MaterialType = 'CONCRETE';
               if (hit.object.name === 'HEAD' || hit.object.name === 'BODY') matType = 'FLESH';
               else if (hit.object.name.includes('Metal') || hit.object.name.includes('Pole')) matType = 'METAL';
               
               if (i === 0) {
                   this.soundManager.playImpact(matType);
               }
               
               if (hit.face) {
                   const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
                   if (matType === 'FLESH') {
                       this.vfxSystem.createBloodEffect(hit.point);
                   } else if (matType === 'METAL') {
                       this.vfxSystem.createImpactSparks(hit.point, normal);
                       this.vfxSystem.createBulletHole(hit.point, normal);
                   } else {
                       this.vfxSystem.createBulletHole(hit.point, normal);
                       this.particleManager.emit('CONCRETE', hit.point, normal);
                   }
               }
               break;
          }
          
          const safeStart = muzzlePos.clone().add(dir.clone().multiplyScalar(0.5));
          this.createBulletTracer(safeStart, targetPoint, this.getWeaponName());
      }
  }

  private triggerMuzzleFlash() {
      this.muzzleFlashMesh.visible = true;
      this.muzzleFlashMesh.rotation.z = Math.random() * Math.PI;
      this.muzzleLight.intensity = 5.0; 
      this.flashDuration = 2; 
  }

  private ejectShell() {
      if (!this.ejectionPort) return;
      const shell = this.shellPool[this.shellIndex];
      this.shellIndex = (this.shellIndex + 1) % this.shellPool.length;
      
      shell.active = true; 
      shell.life = 0.8; 
      shell.mesh.visible = true;
      
      let scale = new THREE.Vector3(1, 1, 1);
      let colorHex = 0xd4af37; 

      switch (this.currentWeapon) {
          case WeaponType.PISTOL:
              scale.set(0.7, 0.7, 0.7); 
              break;
          case WeaponType.RIFLE:
              scale.set(0.8, 1.8, 0.8); 
              break;
          case WeaponType.SNIPER:
              scale.set(1.2, 2.8, 1.2); 
              break;
          case WeaponType.SHOTGUN:
              scale.set(1.8, 1.8, 1.8); 
              colorHex = 0xcc0000; 
              break;
          default:
              scale.set(1, 1, 1);
              break;
      }

      shell.mesh.scale.copy(scale);
      if (shell.mesh.material instanceof THREE.MeshStandardMaterial) {
          shell.mesh.material.color.setHex(colorHex);
      }

      const worldPos = new THREE.Vector3();
      this.ejectionPort.getWorldPosition(worldPos);
      shell.mesh.position.copy(worldPos);
      
      shell.mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      
      const weaponQuat = new THREE.Quaternion();
      this.mesh.getWorldQuaternion(weaponQuat);
      
      const forceLocal = new THREE.Vector3(
          3.0 + Math.random() * 2.0, 
          2.0 + Math.random() * 1.5, 
          1.0 + Math.random() * 1.0  
      );
      
      const force = forceLocal.applyQuaternion(weaponQuat);
      
      shell.velocity.copy(force);
      shell.rotVel.set(
          (Math.random()-0.5)*30, 
          (Math.random()-0.5)*30, 
          (Math.random()-0.5)*30
      );
  }

  private updateShells(dt: number) {
      const g = -9.8;
      for (const shell of this.shellPool) {
          if (!shell.active) continue;
          shell.velocity.y += g * dt;
          shell.mesh.position.addScaledVector(shell.velocity, dt);
          shell.mesh.rotation.x += shell.rotVel.x * dt;
          shell.mesh.rotation.y += shell.rotVel.y * dt;
          shell.life -= dt;
          if (shell.mesh.position.y < 0.01) {
              shell.mesh.position.y = 0.01;
              shell.velocity.multiplyScalar(0.5); 
              shell.velocity.y = Math.abs(shell.velocity.y) * 0.3;
              if(shell.velocity.lengthSq() < 0.1) shell.active = false; 
          }
          if (shell.life <= 0) {
              shell.active = false;
              shell.mesh.visible = false;
          }
      }
  }
  
  private createReflexSight(isGreen: boolean = true): THREE.Group {
      const sight = new THREE.Group();
      const matFrame = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5, metalness: 0.7 });
      const matGlass = new THREE.MeshPhysicalMaterial({ color: 0x88ccff, roughness: 0.0, metalness: 0.9, transmission: 0.9, transparent: true, opacity: 0.4 });
      const matGlow = new THREE.MeshBasicMaterial({ color: isGreen ? 0x39ff14 : 0xff0000 }); 
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.01, 0.06), matFrame); sight.add(base);
      const leftPost = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.04, 0.01), matFrame); leftPost.position.set(-0.02, 0.02, 0); sight.add(leftPost);
      const rightPost = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.04, 0.01), matFrame); rightPost.position.set(0.02, 0.02, 0); sight.add(rightPost);
      const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 0.03), matGlass); lens.position.set(0, 0.03, 0.02); sight.add(lens);
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0015, 8), matGlow); dot.position.set(0, 0.03, 0.019); sight.add(dot);
      return sight;
  }

  private createCoyoteSight(): THREE.Group {
      const sight = new THREE.Group();
      const matDark = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.7, metalness: 0.6 });
      const matLens = new THREE.MeshPhysicalMaterial({ color: 0x55aaee, roughness: 0.0, metalness: 0.5, transmission: 0.9, transparent: true, opacity: 0.4 });
      const matReticle = new THREE.MeshBasicMaterial({ color: 0xff0000 });
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.015, 0.06), matDark); sight.add(base);
      const lGuard = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.04, 0.04), matDark); lGuard.position.set(-0.022, 0.025, 0); sight.add(lGuard);
      const rGuard = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.04, 0.04), matDark); rGuard.position.set(0.022, 0.025, 0); sight.add(rGuard);
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.005, 0.04), matDark); top.position.set(0, 0.045, 0); sight.add(top);
      const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.038, 0.035), matLens); lens.position.set(0, 0.025, 0.01); sight.add(lens);
      const reticle = new THREE.Mesh(new THREE.CircleGeometry(0.0015, 8), matReticle); reticle.position.set(0, 0.025, 0.009); sight.add(reticle);
      return sight;
  }
}