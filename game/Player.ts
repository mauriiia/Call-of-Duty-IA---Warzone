
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PhysicsWorld } from './PhysicsWorld';
import { InputManager } from './InputManager';
import { WeaponSystem, WeaponType, WeaponTier } from './WeaponSystem';
import { CONFIG, MOVEMENT, WATER_LEVEL, TIER_COLORS } from '../constants';
import { PlayerStats, GameMode } from '../types';
import { DamageIndicatorSystem } from './DamageIndicatorSystem';
import { SoundManager } from './SoundManager';

export class Player {
  public mesh: THREE.Group;
  public camera: THREE.PerspectiveCamera;
  public body: CANNON.Body;
  public weapon: WeaponSystem;
  public onShoot?: () => void;
  public hasWeapon: boolean = false; 
  public baseFov: number = CONFIG.fov;
  
  private scene: THREE.Scene;
  private physics: PhysicsWorld;
  
  // Physics Shapes (Box for better collision than Sphere)
  private standingShape = new CANNON.Box(new CANNON.Vec3(0.3, 0.9, 0.3)); // 1.8m height
  private crouchingShape = new CANNON.Box(new CANNON.Vec3(0.3, 0.45, 0.3)); // 0.9m height

  // Gameplay State
  public stats: PlayerStats = {
    health: 100,
    ammo: 0,
    maxAmmo: 30,
    isReloading: false,
    isAiming: false,
    fireMode: 'AUTO',
    weaponName: 'DESARMADO', // Translated
    currentRegion: null,
    score: 0,
    radarBlips: [],
    killFeed: [],
    gameMode: 'BATTLE_ROYALE',
    wave: 1,
    enemiesRemaining: 0,
    isDead: false,
    isVictory: false
  };

  public yaw: number = 0; 
  private pitch: number = 0;
  private canJump: boolean = false;
  private velocity = new THREE.Vector3();
  private inputVector = new THREE.Vector3();
  
  private isSprinting: boolean = false;
  private isCrouching: boolean = false;
  private isInWater: boolean = false;
  
  private isFalling: boolean = false;
  private isParachuting: boolean = false;
  private wasAirborne: boolean = false; // Audio trigger track
  private distToGround: number = 0; 
  
  private isSliding: boolean = false;
  private slideTimer: number = 0;
  private lastSlideTime: number = 0;
  private slideVector: THREE.Vector3 = new THREE.Vector3();

  private currentLean: number = 0;
  private vaultRaycaster = new THREE.Raycaster();

  private lastDamageTime: number = 0;
  private damageOverlay: HTMLElement | null;
  private damageIntensity: number = 0; 
  
  private cameraRecoil = new THREE.Vector3(0, 0, 0); 
  private punchParams = new THREE.Vector3(0, 0, 0); 

  private lastFootstepTime: number = 0;
  private distanceTraveled: number = 0;
  
  private waterTime: number = 0;

  // Editor State
  public isFlyMode: boolean = false; 

  constructor(scene: THREE.Scene, physics: PhysicsWorld, input: InputManager) {
    this.scene = scene;
    this.physics = physics;
    this.damageOverlay = document.getElementById('damage-overlay');

    this.mesh = new THREE.Group();
    scene.add(this.mesh);

    this.camera = new THREE.PerspectiveCamera(this.baseFov, window.innerWidth / window.innerHeight, 0.01, 3500); // Increased far plane for open world
    this.mesh.add(this.camera);

    this.weapon = new WeaponSystem(this.camera, scene, physics);
    // Init empty
    this.hasWeapon = false;

    // Physics Body - Use Box Shape for FPS Controller
    this.body = new CANNON.Body({
      mass: 70, 
      shape: this.standingShape,
      material: physics.getMaterial('player'),
      fixedRotation: true,
      angularDamping: 0.0, 
      linearDamping: 0.0,
      allowSleep: false // FIX: Impedir que o player durma e trave em paredes
    });

    (this.body as any).ccdSpeedThreshold = 1.0;
    (this.body as any).ccdIterations = 10;
    
    this.body.position.set(0, 40, 0); 
    
    physics.world.addBody(this.body);

    input.onReload = () => this.reload();
    input.onToggleFireMode = () => this.weapon.toggleFireMode();
    input.onWeaponSelect = (index) => {
        if (!this.hasWeapon) return;
        this.weapon.selectSlot(index);
    }
  }

  // Helper for Bots to know where to shoot
  public getHeadPosition(): THREE.Vector3 {
      const pos = this.mesh.position.clone();
      // If crouching, head is lower (approx 1.0m from feet), standing is 1.6m
      pos.y += this.isCrouching ? 1.0 : 1.6; 
      return pos;
  }

  public setGameMode(mode: GameMode) {
      this.stats.gameMode = mode;
      this.stats.isDead = false;
      this.stats.isVictory = false;
      
      // Reset Drop State specifically for transitioning from BR
      this.stats.showDropPrompt = false;
      this.isParachuting = false;
      this.isFalling = false;
      this.stats.isOutsideZone = false;
      
      this.isFlyMode = false;
      this.body.mass = 70;
      this.body.type = CANNON.Body.DYNAMIC;
      this.body.collisionFilterGroup = 1;
      this.body.updateMassProperties();
      this.body.wakeUp(); // Garante que começa acordado
      
      if (this.camera.parent !== this.mesh) {
          this.mesh.add(this.camera);
      }
      
      this.mesh.position.copy(this.body.position as any);
      this.mesh.rotation.set(0,0,0);
      this.camera.position.set(0, MOVEMENT.HEIGHT_STAND, 0);
      this.camera.rotation.set(0,0,0);
  }

  public setBaseFOV(fov: number) {
      this.baseFov = fov;
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
  }

  public setArmed(armed: boolean) {
      if (!armed) {
          this.hasWeapon = false;
          // Clear Inventory
          this.weapon.inventory = [null, null, null];
          this.weapon.selectSlot(-1); // Force clear
          this.stats.ammo = 0;
      } else {
          // Default Loadout (e.g. for testing)
          this.hasWeapon = true;
          this.weapon.pickup(WeaponType.PISTOL, WeaponTier.COMMON);
          this.weapon.pickup(WeaponType.RIFLE, WeaponTier.COMMON);
      }
  }

  public takeDamage(amount: number, sourcePosition?: THREE.Vector3) {
      if (this.isFlyMode || this.stats.isDead || this.stats.isVictory) return; 

      this.body.wakeUp(); // FIX: Acorda física se levar tiro parado

      this.stats.health = Math.max(0, this.stats.health - amount);
      this.lastDamageTime = performance.now();
      SoundManager.getInstance().playImpact('FLESH');
      
      this.damageIntensity = 1.0; 

      this.punchParams.x = (Math.random() - 0.5) * 0.1;
      this.punchParams.y = 0.1 + Math.random() * 0.05; 
      this.punchParams.z = (Math.random() - 0.5) * 0.1;

      if (sourcePosition) {
          this.showDamageIndicator(sourcePosition);
      }

      if (this.stats.health <= 0) {
          if (this.stats.gameMode === 'BATTLE_ROYALE') {
              this.stats.health = 0;
              this.stats.isDead = true;
              this.body.velocity.set(0,0,0);
              this.punchParams.z = 0.5; 
              this.pitch = -0.5; 
          } else {
              // Non-BR modes respawn (Training/Editor)
              this.stats.health = 100;
              this.damageIntensity = 0;
              this.body.position.set(0, 50, 0); 
              this.body.velocity.set(0,0,0);
              this.pitch = 0;
              this.cameraRecoil.set(0,0,0);
              this.punchParams.set(0,0,0);
              this.isParachuting = false;
              this.isFalling = false;
          }
      }
  }

  private showDamageIndicator(sourcePos: THREE.Vector3) {
      const playerPos = this.mesh.position;
      const dx = sourcePos.x - playerPos.x;
      const dz = sourcePos.z - playerPos.z;
      const angleToEnemy = Math.atan2(dx, dz);
      const playerAngle = this.yaw;
      const relativeAngleRad = Math.PI + playerAngle - angleToEnemy;
      const deg = THREE.MathUtils.radToDeg(relativeAngleRad);
      DamageIndicatorSystem.show(deg);
  }

  private tryShoot() {
    if (this.isFlyMode) return; 
    if (this.stats.isDead || this.stats.isVictory) return;
    if (!this.hasWeapon) return;
    if (this.isInWater) return; 
    if (this.stats.showDropPrompt) return; 
    
    // Prevent shooting while in the sky
    if (this.isFalling || this.isParachuting) return;

    if (this.weapon.fire(this.stats)) {
        if (this.onShoot) this.onShoot();
        const recoilMult = this.weapon.isAiming ? 0.6 : 1.0;
        this.cameraRecoil.x += 0.008 * recoilMult; 
        this.cameraRecoil.y += (Math.random() - 0.5) * 0.005 * recoilMult;
    }
  }

  private reload() {
    if (!this.hasWeapon) return;
    if (this.stats.isDead || this.stats.isVictory) return;
    this.weapon.startReload(this.stats);
  }

  private checkGroundStatus() {
      if (this.isFlyMode) return;
      if (this.isInWater) { this.canJump = false; this.isFalling = false; this.isParachuting = false; return; }
      if (this.stats.showDropPrompt) { this.isFalling = false; this.isParachuting = false; this.canJump = false; return; }
      
      const playerRadius = this.isCrouching ? 0.45 : 0.9;
      
      const from = new CANNON.Vec3(this.body.position.x, this.body.position.y, this.body.position.z);
      const rayLen = 50.0;
      const to = new CANNON.Vec3(this.body.position.x, this.body.position.y - rayLen, this.body.position.z);
      const result = new CANNON.RaycastResult();
      const options = { skipBackfaces: true, collisionFilterMask: 1, collisionFilterGroup: 2 };
      this.physics.world.raycastClosest(from, to, options, result);
      
      if (result.hasHit) {
          this.distToGround = result.distance - playerRadius; 
          if (this.distToGround < 0 && this.body.velocity.y < 0) {
              this.body.position.y = result.hitPointWorld.y + playerRadius;
              this.body.velocity.y = 0;
              this.distToGround = 0;
              
              if (this.isFalling && this.body.velocity.y < -8.0) {
                  SoundManager.getInstance().playImpact('CONCRETE');
                  this.punchParams.x = 0.2; 
              }
              this.isFalling = false; 
              this.isParachuting = false;
          }
      } else { this.distToGround = Infinity; }
      
      const isGrounded = result.hasHit && this.distToGround < 0.2; 
      const isLandedVelocity = this.isParachuting && Math.abs(this.body.velocity.y) < 1.0;
      if (isGrounded || isLandedVelocity) { this.canJump = true; this.isFalling = false; this.isParachuting = false; } 
      else { this.canJump = false; if (this.body.velocity.y < -8.0 && !this.isFalling && !this.isParachuting) { this.isFalling = true; } }
  }

  private handleWaterPhysics(dt: number) {
      if (this.isFlyMode) return;
      if (this.stats.showDropPrompt) return;
      this.waterTime += dt;
      const x = this.body.position.x; const z = this.body.position.z;
      const speed = 0.75; const scale = 0.3;  
      const wave1 = Math.sin(x * 0.02 + this.waterTime * speed * 0.5) * scale * 2.0;
      const wave2 = Math.sin(x * 0.1 + z * 0.05 + this.waterTime * speed) * scale;
      const wave3 = Math.cos(z * 0.08 + this.waterTime * speed * 0.8) * scale;
      const totalWave = wave1 + wave2 + wave3;
      const currentWaterHeight = WATER_LEVEL + totalWave;
      this.isInWater = this.body.position.y < currentWaterHeight;
      if (this.isInWater) {
          const depth = currentWaterHeight - this.body.position.y;
          const buoyancyForce = Math.min(depth * 1500, 1500); 
          this.body.applyForce(new CANNON.Vec3(0, buoyancyForce, 0), new CANNON.Vec3(0, 0, 0));
          this.body.linearDamping = 0.9; this.body.angularDamping = 0.9;
      }
  }

  public update(dt: number, input: InputManager) {
    const now = performance.now();
    this.mesh.visible = true;

    if (this.stats.showDropPrompt) {
        this.mesh.position.copy(this.body.position as any);
        this.camera.position.set(0, 12, 35); 
        this.handleLook(dt, input);
        this.isFalling = false; this.isParachuting = false; this.canJump = false;
        
        // Force hide weapon during dropship
        this.weapon.update(dt, {x:0, y:0}, false, false, this.stats, false, true);
        return; 
    }

    if (this.stats.isDead || this.stats.isVictory) {
        this.mesh.position.copy(this.body.position as any);
        this.body.velocity.x *= 0.9;
        this.body.velocity.z *= 0.9;
        return;
    }

    this.handleWaterPhysics(dt);
    this.checkGroundStatus();
    
    // --- WIND AUDIO TRIGGER ---
    // If falling or parachuting, we are "airborne"
    const isAirborne = this.isFalling || this.isParachuting;
    
    if (isAirborne) {
        if (!this.wasAirborne) {
            SoundManager.getInstance().startWind();
            this.wasAirborne = true;
        }
        // Calculate Wind Intensity based on downward velocity
        // Terminal velocity ~50m/s
        // Parachute ~5m/s
        const downwardSpeed = Math.abs(this.body.velocity.y);
        const intensity = Math.min(1.0, downwardSpeed / 30.0);
        SoundManager.getInstance().updateWind(intensity);
    } else {
        if (this.wasAirborne) {
            SoundManager.getInstance().stopWind();
            this.wasAirborne = false;
        }
    }
    // -------------------------

    if (this.stats.health < 100 && (now - this.lastDamageTime > 5000) && !this.stats.isOutsideZone) {
        this.stats.health = Math.min(100, this.stats.health + (20 * dt));
    }

    if (this.damageOverlay) {
        this.damageIntensity = THREE.MathUtils.lerp(this.damageIntensity, 0, dt * 2.0);
        const lowHealthIntensity = Math.max(0, (50 - this.stats.health) / 50); 
        let zoneOverlay = 0;
        if (this.stats.isOutsideZone) zoneOverlay = 0.3 + Math.sin(now * 0.005) * 0.1;
        const finalOpacity = Math.max(this.damageIntensity, lowHealthIntensity * 0.8, zoneOverlay);
        this.damageOverlay.style.opacity = finalOpacity.toFixed(2);
    }

    if (input.isMouseDown && !input.keys['ShiftLeft'] && !this.isSprinting) {
        this.tryShoot();
    }
    
    if (!input.isMouseDown) {
        this.weapon.canShootSemi = true;
    }

    this.handleLook(dt, input);
    this.handleMovement(dt, input);
    this.handleCameraHeight(dt, input);
    this.handleFOV(dt);
    
    this.mesh.position.copy(this.body.position as any);

    this.stats.isAiming = this.weapon.isAiming && this.hasWeapon; 
    this.stats.fireMode = this.weapon.fireMode;
    this.stats.weaponName = this.weapon.getWeaponName();
    
    const item = this.weapon.inventory[this.weapon.activeSlot];
    if (item) {
        this.stats.ammo = item.ammoInClip;
        this.stats.maxAmmo = item.reserveAmmo;
    } else {
        this.stats.ammo = 0;
    }

    let tierColor = TIER_COLORS.COMMON;
    if (this.weapon.currentTier === WeaponTier.UNCOMMON) tierColor = TIER_COLORS.UNCOMMON;
    if (this.weapon.currentTier === WeaponTier.RARE) tierColor = TIER_COLORS.RARE;
    if (this.weapon.currentTier === WeaponTier.LEGENDARY) tierColor = TIER_COLORS.LEGENDARY;
    this.stats.weaponTierColor = '#' + tierColor.toString(16).padStart(6, '0');

    this.stats.isFalling = this.isFalling;
    this.stats.isParachuting = this.isParachuting;
    
    const isMoving = this.inputVector.lengthSq() > 0.1 || this.isSliding;
    
    const isAirborneForWeapon = this.isFalling || this.isParachuting || (this.stats.showDropPrompt || false) || this.isInWater;
    
    this.weapon.update(
        dt, 
        input.mouseDelta, 
        isMoving, 
        input.isAiming && this.hasWeapon && !isAirborneForWeapon, 
        this.stats, 
        this.isSprinting,
        isAirborneForWeapon 
    );
  }

  private handleCameraHeight(dt: number, input: InputManager) {
      if (this.stats.showDropPrompt) return; 
      let targetHeight = MOVEMENT.HEIGHT_STAND; 
      if (this.isSliding) targetHeight = MOVEMENT.HEIGHT_CROUCH - 0.2;
      else if (this.isCrouching) targetHeight = MOVEMENT.HEIGHT_CROUCH;
      if (this.isInWater && !input.keys['KeyC']) {
          if (this.body.position.y > WATER_LEVEL - 0.5) targetHeight = MOVEMENT.HEIGHT_STAND; 
      }
      this.camera.position.y = THREE.MathUtils.lerp(this.camera.position.y, targetHeight, dt * 10);
      this.camera.position.z = THREE.MathUtils.lerp(this.camera.position.z, 0, dt * 10);
  }

  private handleFOV(dt: number) {
      let target = this.baseFov;
      if (this.isParachuting) target = this.baseFov + 10;
      else if (this.isFalling) {
           const vel = this.body.velocity.length();
           const speedEffect = Math.min(Math.max((vel - 10) / 40, 0), 1) * 35;
           target = this.baseFov + 10 + speedEffect;
      }
      else if (this.weapon.isAiming && this.hasWeapon) target = this.weapon.getDesiredFOV(this.baseFov); 
      else if (this.isSliding) target = this.baseFov + 10;
      else if (this.isSprinting) target = this.baseFov + 5;

      if (Math.abs(this.camera.fov - target) > 0.1) {
          this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, target, dt * 5);
          this.camera.updateProjectionMatrix();
      }
  }

  private handleLook(dt: number, input: InputManager) {
    if (!input.isLocked) return;
    let sensMultiplier = 1.0;
    if (this.weapon.isAiming && this.hasWeapon) {
        sensMultiplier = this.weapon.getDesiredFOV(this.baseFov) < 30 ? 0.2 : 0.5;
    }
    this.pitch += this.cameraRecoil.x;
    this.yaw += this.cameraRecoil.y;
    this.cameraRecoil.lerp(new THREE.Vector3(0,0,0), 8 * dt);
    this.yaw -= input.mouseDelta.x * CONFIG.mouseSensitivity * sensMultiplier;
    this.pitch -= input.mouseDelta.y * CONFIG.mouseSensitivity * sensMultiplier;
    this.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.pitch));
    this.punchParams.lerp(new THREE.Vector3(0,0,0), 8 * dt);
    this.mesh.rotation.y = this.yaw + this.punchParams.x; 
    
    let targetLean = 0;
    if (input.keys['KeyQ']) targetLean = 1;
    if (input.keys['KeyE']) targetLean = -1;
    if (!this.canJump && (this.isFalling || this.isParachuting)) {
        if (input.keys['KeyA']) targetLean = 0.5; 
        if (input.keys['KeyD']) targetLean = -0.5;
    }
    this.currentLean = THREE.MathUtils.lerp(this.currentLean, targetLean, dt * 5);
    let roll = this.punchParams.z;
    if (this.isSliding) roll -= 0.05; 
    roll += this.currentLean * MOVEMENT.LEAN_ANGLE;
    if (!this.stats.showDropPrompt) this.camera.position.x = this.currentLean * -MOVEMENT.LEAN_OFFSET;
    this.camera.rotation.x = this.pitch + this.punchParams.y; 
    this.camera.rotation.z = roll; 
  }

  private handleMovement(dt: number, input: InputManager) {
    const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    this.inputVector.set(0, 0, 0);
    if (input.keys['KeyW']) this.inputVector.add(forward);
    if (input.keys['KeyS']) this.inputVector.sub(forward);
    if (input.keys['KeyD']) this.inputVector.add(right);
    if (input.keys['KeyA']) this.inputVector.sub(right);
    const isMovingInput = this.inputVector.lengthSq() > 0;
    if (isMovingInput) this.inputVector.normalize();
    const isMovingForward = input.keys['KeyW'];
    this.isSprinting = input.keys['ShiftLeft'] && isMovingForward && !this.weapon.isAiming && !this.isCrouching && !this.isInWater;
    const crouchPressed = input.keys['KeyC'];
    const jumpPressed = input.keys['Space'];
    if (this.isParachuting && crouchPressed) {
        this.isParachuting = false; this.isFalling = true;
        const diveDir = forward.clone().multiplyScalar(15);
        this.body.velocity.x += diveDir.x; this.body.velocity.z += diveDir.z; this.body.velocity.y -= 5; 
    }
    else if (this.isFalling && jumpPressed && !this.isParachuting && this.distToGround > 15) {
        this.isParachuting = true; this.body.velocity.y *= 0.1; 
        this.body.applyImpulse(new CANNON.Vec3(0, 300, 0), new CANNON.Vec3(0,0,0)); 
    }
    const now = performance.now();
    if (crouchPressed && this.isSprinting && !this.isSliding && (now - this.lastSlideTime > MOVEMENT.SLIDE_COOLDOWN * 1000) && this.canJump) {
        this.startSlide();
    } else if (crouchPressed && !this.isSliding && !this.isParachuting) {
        // Crouch Start
        if (!this.isCrouching) {
            this.isCrouching = true;
            this.body.shapes[0] = this.crouchingShape; 
            // FIX: Don't offset shape (unstable), instead move body down
            this.body.shapeOffsets[0].set(0, 0, 0); 
            this.body.position.y -= 0.45; // Teleport body center down to keep feet grounded
            this.body.updateBoundingRadius();
        }
    } else if (!crouchPressed && !this.isSliding) {
        // Crouch End
        if (this.isCrouching) {
            this.isCrouching = false;
            this.body.shapes[0] = this.standingShape;
            this.body.shapeOffsets[0].set(0, 0, 0); 
            this.body.position.y += 0.45; // Teleport body center up
            this.body.updateBoundingRadius();
        }
    }
    
    if (this.isInWater) {
        this.body.linearDamping = 0.9; const swimSpeed = 3.0; const camDir = new THREE.Vector3(); this.camera.getWorldDirection(camDir);
        if (input.keys['KeyW']) { this.body.velocity.x += camDir.x * swimSpeed * dt * 2; this.body.velocity.z += camDir.z * swimSpeed * dt * 2; this.body.velocity.y += camDir.y * swimSpeed * dt * 2; }
        if (input.keys['KeyS']) { this.body.velocity.x -= camDir.x * swimSpeed * dt * 2; this.body.velocity.z -= camDir.z * swimSpeed * dt * 2; this.body.velocity.y -= camDir.y * swimSpeed * dt * 2; }
        if (input.keys['KeyA'] || input.keys['KeyD']) { const sideVector = new THREE.Vector3(this.inputVector.x, 0, this.inputVector.z).normalize(); this.body.velocity.x += sideVector.x * swimSpeed * dt * 2; this.body.velocity.z += sideVector.z * swimSpeed * dt * 2; }
        if (input.keys['Space']) this.body.velocity.y += 10 * dt;
        if (input.keys['KeyC']) this.body.velocity.y -= 10 * dt;
    } else if (!this.isSliding && (this.canJump || (!this.isParachuting && !this.isFalling))) {
        this.isParachuting = false;
        this.body.linearDamping = this.canJump ? MOVEMENT.DAMPING_GROUND : MOVEMENT.DAMPING_AIR;
        if (this.canJump) {
            if (!isMovingInput) { this.body.velocity.x = 0; this.body.velocity.z = 0; } else {
                let speed = MOVEMENT.WALK_SPEED;
                if (this.isCrouching) speed = MOVEMENT.CROUCH_SPEED;
                else if (this.isSprinting) speed = MOVEMENT.SPRINT_SPEED;
                if (this.weapon.isAiming && this.hasWeapon) speed = MOVEMENT.CROUCH_SPEED; 
                this.body.velocity.x = this.inputVector.x * speed;
                this.body.velocity.z = this.inputVector.z * speed;
            }
        } else {
            if (isMovingInput) {
                 const airSpeed = 8.0;
                 this.body.velocity.x += this.inputVector.x * airSpeed * dt;
                 this.body.velocity.z += this.inputVector.z * airSpeed * dt;
                 const xz = new THREE.Vector2(this.body.velocity.x, this.body.velocity.z);
                 if (xz.length() > MOVEMENT.SPRINT_SPEED) { xz.normalize().multiplyScalar(MOVEMENT.SPRINT_SPEED); this.body.velocity.x = xz.x; this.body.velocity.z = xz.y; }
            }
        }
    } else if (this.isParachuting) {
        this.body.linearDamping = 0.9; 
        const liftForce = 67 * 9.8; 
        this.body.applyForce(new CANNON.Vec3(0, liftForce, 0), new CANNON.Vec3(0,0,0)); 
        const paraSpeed = 15.0; 
        if (input.keys['KeyW']) { const camDir = new THREE.Vector3(); this.camera.getWorldDirection(camDir); camDir.y = 0; camDir.normalize(); this.body.applyForce(new CANNON.Vec3(camDir.x * paraSpeed, 0, camDir.z * paraSpeed), new CANNON.Vec3(0,0,0)); }
        else if (isMovingInput) { this.body.applyForce(new CANNON.Vec3(this.inputVector.x * paraSpeed, 0, this.inputVector.z * paraSpeed), new CANNON.Vec3(0,0,0)); }
    } else if (this.isFalling) {
        this.body.velocity.x *= 0.99; this.body.velocity.z *= 0.99;
        if (input.keys['KeyW'] && this.distToGround > 20) { const camDir = new THREE.Vector3(); this.camera.getWorldDirection(camDir); const diveSpeed = 20.0 * dt; this.body.velocity.x += camDir.x * diveSpeed; this.body.velocity.z += camDir.z * diveSpeed; if (camDir.y < -0.2) { this.body.velocity.y += camDir.y * diveSpeed * 2.0; } this.body.linearDamping = 0.05; } 
        else if (input.keys['KeyS']) { this.body.linearDamping = 0.8; } else { this.body.linearDamping = 0.1; }
        if (input.keys['KeyA'] || input.keys['KeyD']) { const sideSpeed = 15.0 * dt; const sideVec = new THREE.Vector3(this.inputVector.x, 0, this.inputVector.z).normalize(); this.body.velocity.x += sideVec.x * sideSpeed; this.body.velocity.z += sideVec.z * sideSpeed; }
    } else if (this.isSliding) {
        this.body.linearDamping = MOVEMENT.DAMPING_SLIDE; this.slideTimer -= dt;
        if (this.slideTimer <= 0 || !this.canJump) { 
            this.isSliding = false; 
            // Force crouch at end of slide
            if (!this.isCrouching) {
                this.isCrouching = true;
                this.body.shapes[0] = this.crouchingShape;
                this.body.shapeOffsets[0].set(0, 0, 0); // No offset
                this.body.position.y -= 0.45; // Move down
                this.body.updateBoundingRadius();
            }
        }
    }
    if (input.keys['Space'] && this.canJump && !this.isCrouching && !this.isSliding && !this.isInWater) {
      if (isMovingForward && !this.tryVault()) { this.body.velocity.y = 5.5; this.canJump = false; } else if (!isMovingForward) { this.body.velocity.y = 5.5; this.canJump = false; }
    }
    if (isMovingInput && this.canJump && !this.isInWater) {
        this.body.wakeUp(); // Garante que a física está ativa ao mover
        let speed = this.isSprinting ? MOVEMENT.SPRINT_SPEED : MOVEMENT.WALK_SPEED;
        if(this.isCrouching) speed = MOVEMENT.CROUCH_SPEED;
        const stepDist = speed * dt; this.distanceTraveled += stepDist;
        let stride = 3.0; if (this.isSprinting) stride = 4.5; if (this.isCrouching) stride = 2.0;
        if (this.distanceTraveled > stride) { this.distanceTraveled = 0; SoundManager.getInstance().playFootstep(this.isSprinting); }
    }
  }

  private startSlide() {
      this.isSliding = true; this.isSprinting = false; this.slideTimer = MOVEMENT.SLIDE_DURATION; this.lastSlideTime = performance.now();
      const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
      this.slideVector.copy(forward);
      const burst = forward.multiplyScalar(MOVEMENT.SLIDE_INITIAL_SPEED);
      this.body.velocity.x = burst.x; this.body.velocity.z = burst.z;
      SoundManager.getInstance().playFootstep(true); 
  }

  private tryVault(): boolean {
      const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw).normalize();
      const pos = this.mesh.position.clone();
      const lowOrigin = pos.clone().add(new THREE.Vector3(0, -0.5, 0)); 
      this.vaultRaycaster.set(lowOrigin, forward); this.vaultRaycaster.far = MOVEMENT.VAULT_DIST;
      const lowHits = this.vaultRaycaster.intersectObjects(this.scene.children, true); 
      let obstacleDetected = false;
      for (let hit of lowHits) { if (hit.object.name !== "Shell" && !hit.object.name.includes("Player") && !hit.object.name.includes("muzzle")) { obstacleDetected = true; break; } }
      if (!obstacleDetected) return false;
      const highOrigin = pos.clone().add(new THREE.Vector3(0, 0.5, 0));
      this.vaultRaycaster.set(highOrigin, forward); this.vaultRaycaster.far = MOVEMENT.VAULT_DIST;
      const highHits = this.vaultRaycaster.intersectObjects(this.scene.children, true);
      let clearance = true;
      for (let hit of highHits) { if (hit.object.name !== "Shell" && !hit.object.name.includes("Player") && !hit.object.name.includes("muzzle")) { clearance = false; break; } }
      if (clearance) {
          this.body.velocity.y = MOVEMENT.VAULT_IMPULSE_Y;
          const push = forward.multiplyScalar(MOVEMENT.VAULT_IMPULSE_FWD);
          this.body.velocity.x += push.x; this.body.velocity.z += push.z;
          this.canJump = false; SoundManager.getInstance().playVault();
          return true;
      }
      return false;
  }
}
