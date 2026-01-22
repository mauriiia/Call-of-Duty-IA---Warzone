
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { World } from './World';
import { PhysicsWorld } from './PhysicsWorld';
import { InputManager } from './InputManager';
import { Player } from './Player';
import { EntityManager } from './EntityManager';
import { EnemyManager, HitResult } from './EnemyManager';
import { EnvironmentManager } from './EnvironmentManager';
import { BattleRoyaleManager } from './BattleRoyaleManager';
import { PlayerStats, RadarBlip, GameMode, GameSettings, KillFeedEntry, FSRMode } from '../types';
import { SoundManager } from './SoundManager';
import { HitMarkerSystem } from './HitMarkerSystem';
import { ParticleManager } from './ParticleManager';
import { WeaponType, WeaponTier } from './WeaponSystem';
import { MapEditorSystem, ToolType } from './MapEditorSystem';
import { FSRSystem } from './FSRSystem';

import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

export class GameEngine {
  private static instance: GameEngine;
  
  public renderer!: THREE.WebGLRenderer;
  public labelRenderer!: CSS2DRenderer;
  
  // Systems
  public fsr!: FSRSystem;
  
  public world!: World;
  public physics!: PhysicsWorld;
  public player!: Player;
  public entities!: EntityManager;
  public enemyManager!: EnemyManager; 
  public brManager!: BattleRoyaleManager;
  public input!: InputManager;
  public envManager!: EnvironmentManager;
  public particleManager!: ParticleManager;
  public editorSystem!: MapEditorSystem;
  
  private raycaster = new THREE.Raycaster();
  private isRunning: boolean = false;
  private isPaused: boolean = false;
  private animationFrameId: number = 0;
  private lastTime: number = 0;

  // --- OTIMIZAÇÃO DE FÍSICA (FIXED TIMESTEP) ---
  private fixedTimeStep = 1.0 / 60.0; // 60 Hz fixo para física
  private accumulator = 0;
  
  public currentMode: GameMode | null = 'BATTLE_ROYALE'; // Changed to nullable
  private score: number = 0;
  
  private wave: number = 1;
  private waveTimer: number = 0; 
  
  private regionCheckTimer: number = 0;
  private regionLabels: CSS2DObject[] = [];
  private labelUpdateCounter: number = 0; // Para não atualizar DOM todo frame

  // Kill Feed State
  private killFeed: KillFeedEntry[] = [];
  private killFeedIdCounter: number = 0;

  // FPS COUNTER
  private frames: number = 0;
  private prevTime: number = 0;
  private fpsElement: HTMLElement | null = null;

  private onStatsUpdate?: (stats: PlayerStats) => void;
  public rayTracingEnabled: boolean = false;

  private constructor() {}

  public static getInstance(): GameEngine {
    if (!GameEngine.instance) {
      GameEngine.instance = new GameEngine();
    }
    return GameEngine.instance;
  }

  public init(container: HTMLElement, onStatsUpdate: (stats: PlayerStats) => void) {
    this.onStatsUpdate = onStatsUpdate;
    this.fpsElement = document.getElementById('fps-counter');

    // --- GRAPHICS INIT (OTIMIZADO) ---
    this.renderer = new THREE.WebGLRenderer({ 
        antialias: false,            
        powerPreference: "high-performance", 
        precision: "highp",          
        stencil: false,              
        depth: true,
        preserveDrawingBuffer: false // Otimização
    });
    
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // CRÍTICO: Reduzir PixelRatio para 1.0 garante performance estável
    this.renderer.setPixelRatio(1.0); 
    this.renderer.setClearColor(0x7cb1d6, 1);
    
    // DISABLE SHADOWS BY DEFAULT FOR PERFORMANCE
    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.type = THREE.BasicShadowMap; 
    
    // Cinematic Color Grading
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0; 
    this.renderer.outputColorSpace = THREE.SRGBColorSpace; 

    container.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
    this.labelRenderer.domElement.style.position = 'absolute';
    this.labelRenderer.domElement.style.top = '0px';
    this.labelRenderer.domElement.style.pointerEvents = 'none'; 
    container.appendChild(this.labelRenderer.domElement);

    this.input = new InputManager();
    this.physics = new PhysicsWorld();
    this.world = new World(this.physics);
    
    this.editorSystem = new MapEditorSystem(this.world.scene, this.world, this.physics);
    
    this.particleManager = ParticleManager.getInstance();
    this.particleManager.init(this.world.scene);

    this.player = new Player(this.world.scene, this.physics, this.input);
    
    const spawnPoint = this.world.mapGenerator.getRandomSpawnPoint();
    this.player.body.position.set(spawnPoint.x, spawnPoint.y, spawnPoint.z);
    this.player.body.velocity.set(0, 0, 0);
    this.player.mesh.position.copy(spawnPoint);

    // --- AUDIO LISTENER SETUP ---
    SoundManager.getInstance().setListener(this.player.camera);

    this.entities = new EntityManager(this.world.scene, this.physics);
    this.enemyManager = new EnemyManager(this.world.scene, this.physics);
    this.enemyManager.setWorld(this.world);

    this.brManager = new BattleRoyaleManager(this.world.scene, this.world, this.player, this.enemyManager);
    this.envManager = new EnvironmentManager(this.world.scene);

    // Initialize FSR System (Handles Post-Processing)
    this.fsr = new FSRSystem(this.renderer, this.world.scene, this.player.camera);

    this.setupRegionLabels(); 

    window.addEventListener('resize', this.onResize.bind(this));

    this.player.onShoot = () => {
        this.handleShootingRaycast();
    };

    this.lastTime = performance.now();
    this.prevTime = this.lastTime;
    this.isRunning = true;
    this.loop();
  }

  public setPaused(paused: boolean) {
      if (this.currentMode === 'EDITOR') {
      } else {
          this.isPaused = paused;
          if (!paused) {
              this.lastTime = performance.now();
          }
      }
  }

  // --- NEW METHOD: CLEAN EXIT ---
  public exitGame() {
      this.isPaused = true;
      this.currentMode = null; // Stops update loops
      this.input.unlockPointer();
      // Ensure cursor doesn't drift
      this.input.mouseNDC.x = 0;
      this.input.mouseNDC.y = 0;
  }

  public restartMatch() {
      if (!this.currentMode) return; // Guard against null mode
      const settings: GameSettings = { 
          mode: this.currentMode, 
          difficulty: 'MEDIUM', 
          graphics: 'MEDIUM', 
          sound: true,
          fov: this.player.baseFov,
          rayTracing: this.rayTracingEnabled,
          fsrMode: this.fsr.currentMode
      };
      this.startMode(settings);
      this.isPaused = false;
  }
  
  public updateFOV(fov: number) {
      if (this.player) {
          this.player.setBaseFOV(fov);
      }
  }

  public setFSRMode(mode: FSRMode) {
      if (this.fsr) {
          this.fsr.setMode(mode);
      }
  }

  public reportKill(killer: string, victim: string, weapon: string, isHeadshot: boolean = false) {
      this.killFeed.unshift({
          id: this.killFeedIdCounter++,
          killer,
          victim,
          weapon,
          isHeadshot,
          timestamp: Date.now()
      });
      if (this.killFeed.length > 6) {
          this.killFeed.pop();
      }
  }

  public spawnDebugLoot(type: WeaponType, tier: WeaponTier) {
      if (!this.player || !this.brManager) return;
      
      // Calculate spawn position (2 meters in front of player)
      const spawnPos = this.player.mesh.position.clone();
      const direction = new THREE.Vector3();
      this.player.camera.getWorldDirection(direction);
      spawnPos.add(direction.multiplyScalar(2.0));
      spawnPos.y += 1.0; // Slightly higher so it drops

      this.brManager.spawnLootItem(type, tier, spawnPos, true);
      SoundManager.getInstance().playVoice("Weapon Acquired"); // Reusing generic sound for feedback
  }

  private setupRegionLabels() {
      this.regionLabels.forEach(l => this.world.scene.remove(l));
      this.regionLabels = [];

      this.world.mapGenerator.regions.forEach(region => {
          const div = document.createElement('div');
          div.className = 'world-label';
          div.innerHTML = `${region.name} <span>DISTRICT</span>`;
          // Otimização CSS: will-change ajuda o navegador a rasterizar
          div.style.willChange = 'opacity, transform';
          
          const label = new CSS2DObject(div);
          
          const y = this.world.mapGenerator.getHeightAt(region.x, region.z);
          label.position.set(region.x, y + 20, region.z); 
          
          this.world.scene.add(label);
          this.regionLabels.push(label);
      });
  }

  public startMode(settings: GameSettings) {
      this.currentMode = settings.mode;
      this.updateGraphicsSettings(settings); 

      this.brManager.reset();

      this.player.setGameMode(settings.mode);
      this.player.setBaseFOV(settings.fov);
      
      this.world.regenerate(this.currentMode);
      
      // --- UPDATE LOOT SPOTS ---
      if (this.currentMode === 'BATTLE_ROYALE') {
          const savedMap = localStorage.getItem('PROTON_MAP_V1');
          if (savedMap) {
              try {
                  const data = JSON.parse(savedMap);
                  console.log("Loading saved user map into game session...");
                  this.world.mapGenerator.loadMapData(data);
              } catch (e) {
                  console.error("Error loading saved map:", e);
              }
          }
          // Passa os pontos de spawn de loot do mapa para o gerenciador BR
          this.brManager.spawnWorldLoot(this.world.mapGenerator.lootSpawns);
      }

      this.setupRegionLabels(); 
      
      this.score = 0;
      this.killFeed = [];
      this.enemyManager.reset();
      this.enemyManager.setDifficulty(settings.difficulty);

      this.entities.resetTargets(); 
      this.player.stats.health = 100;
      this.player.stats.ammo = this.player.stats.maxAmmo;
      
      this.player.stats.currentRegion = null;
      
      let spawn = this.world.mapGenerator.getRandomSpawnPoint();
      
      if (this.currentMode === 'TRAINING') {
          spawn = new THREE.Vector3(0, 12, 20); 
          this.player.setArmed(false);
          this.player.hasWeapon = false;
          const tableY = 11.2;
          this.brManager.spawnLootItem(WeaponType.PISTOL, WeaponTier.LEGENDARY, new THREE.Vector3(-3, tableY, 5), false);
          this.brManager.spawnLootItem(WeaponType.SHOTGUN, WeaponTier.LEGENDARY, new THREE.Vector3(-1, tableY, 5), false);
          this.brManager.spawnLootItem(WeaponType.RIFLE, WeaponTier.LEGENDARY, new THREE.Vector3(1, tableY, 5), false);
          this.brManager.spawnLootItem(WeaponType.SNIPER, WeaponTier.LEGENDARY, new THREE.Vector3(3, tableY, 5), false);
          this.enemyManager.spawnDummy(-10, -20);
          this.enemyManager.spawnDummy(10, -20);
          this.enemyManager.spawnDummy(0, -30);
      } 
      else if (this.currentMode === 'BATTLE_ROYALE') {
          this.player.setArmed(false);
          const botCount = 29; 
          for(let i=0; i<botCount; i++) {
              const angle = Math.random() * Math.PI * 2;
              const radius = 50 + Math.random() * 200;
              const x = Math.cos(angle) * radius;
              const z = Math.sin(angle) * radius;
              this.enemyManager.spawnBRBot(x, z);
          }
          this.brManager.startMatch(); 
      }
      else if (this.currentMode === 'EDITOR') {
          this.player.setArmed(false);
          this.player.hasWeapon = false;
          
          // CRITICAL FIX: Explicitly hide weapon mesh to prevent it from showing in Editor
          this.player.weapon.mesh.visible = false;
          this.player.weapon.currentWeapon = WeaponType.NONE;
          
          this.player.isFlyMode = true; 
          spawn = new THREE.Vector3(0, 50, 50); 
          this.editorSystem.loadMap();
          
          this.player.body.type = CANNON.Body.KINEMATIC;
          this.player.body.collisionFilterGroup = 0; 
      }
      
      this.player.body.position.set(spawn.x, spawn.y, spawn.z);
      this.player.body.velocity.set(0,0,0);
      
      if (this.currentMode === 'EDITOR') {
          this.input.unlockPointer();
      } else {
          this.input.lockPointer();
      }
  }

  // --- UTILITY: TEXTURE QUALITY ---
  private enforceHighQualityTextures() {
      // Otimização: Só executa se necessário, não força updates desnecessários
      const maxAnisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy()); // Limitado a 4x para performance
      
      this.world.scene.traverse((object) => {
          if ((object as THREE.Mesh).isMesh) {
              const mesh = object as THREE.Mesh;
              const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
              
              materials.forEach((mat: any) => {
                  if (mat.map && mat.map.anisotropy !== maxAnisotropy) { mat.map.anisotropy = maxAnisotropy; mat.needsUpdate = true; }
              });
          }
      });
  }

  public updateGraphicsSettings(settings: GameSettings) {
      this.rayTracingEnabled = settings.rayTracing;
      
      this.fsr.setRayTracing(this.rayTracingEnabled);
      this.fsr.setMode(settings.fsrMode);

      // Trigger Water Quality Switch
      if (this.world) {
          this.world.setWaterQuality(this.rayTracingEnabled);
      }

      if (this.envManager) {
          this.envManager.setShadowQuality(this.rayTracingEnabled);
      }

      if (settings.graphics === 'HIGH') {
          this.renderer.shadowMap.enabled = true;
          this.renderer.shadowMap.type = THREE.PCFSoftShadowMap; 
      } else if (settings.graphics === 'MEDIUM') {
          this.renderer.shadowMap.enabled = true;
          this.renderer.shadowMap.type = THREE.BasicShadowMap;
      } else {
          this.renderer.shadowMap.enabled = false;
      }
      
      this.enforceHighQualityTextures();
  }

  private handleShootingRaycast() {
      if (this.player.stats.ammo >= 0 && !this.player.stats.isReloading && this.player.hasWeapon) {
        const rays = this.player.weapon.getShootingRays();
        let anyHit = false;
        let anyKill = false;
        let anyHeadshot = false;
        
        const damage = this.player.weapon.getCalculatedDamage();

        for (const ray of rays) {
            this.raycaster.set(ray.origin, ray.direction);
            
            // OTIMIZAÇÃO: Primeiro checa objetos estáticos (dummy), mais barato
            const hitDummy = this.entities.checkHit(this.raycaster);
            if (hitDummy) anyHit = true; 
            
            if (!hitDummy) {
                // Checa inimigos (mais caro, raycast com bounding box)
                const result: HitResult = this.enemyManager.checkHit(this.raycaster, damage); 
                if (result.hit) {
                    anyHit = true;
                    if (result.killed) anyKill = true;
                    if (result.isHeadshot) anyHeadshot = true;
                }
            }
        }

        if (anyHit) {
            HitMarkerSystem.show(anyHeadshot);
            SoundManager.getInstance().playHitMarker(anyHeadshot);
            if (anyKill) {
                this.score += anyHeadshot ? 150 : 100;
            }
        }
      }
  }

  private onResize() {
    if (!this.player || !this.renderer) return;
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.labelRenderer.setSize(width, height);
    this.fsr.resize(width, height);
  }

  private calculateRadarBlips(): RadarBlip[] {
      const blips: RadarBlip[] = [];
      const playerPos = this.player.mesh.position;
      const playerRotY = this.player.mesh.rotation.y; 
      const cos = Math.cos(playerRotY);
      const sin = Math.sin(playerRotY);
      const maxDist = this.currentMode === 'BATTLE_ROYALE' ? 30 : 100;
      const maxDistSq = maxDist * maxDist;

      // Otimização: for loop clássico é mais rápido que forEach
      for (let i = 0; i < this.enemyManager.enemies.length; i++) {
          const enemy = this.enemyManager.enemies[i];
          if (enemy.mesh.position.distanceToSquared(playerPos) > maxDistSq) continue;
          
          const dx = enemy.mesh.position.x - playerPos.x;
          const dz = enemy.mesh.position.z - playerPos.z;
          const rx = dx * cos - dz * sin;
          const ry = dx * sin + dz * cos;
          const team = (this.currentMode === 'BATTLE_ROYALE') ? 'RED' : enemy.team;
          blips.push({ x: rx, y: ry, id: enemy.id, team: team as any });
      }
      return blips;
  }

  private updateGameLogic(dt: number) {
      if (this.currentMode === 'BATTLE_ROYALE' || this.currentMode === 'TRAINING') {
          this.brManager.update(dt, this.input);
      }
      
      const now = Date.now();
      if (this.killFeed.length > 0 && now - this.killFeed[this.killFeed.length - 1].timestamp > 5000) {
          this.killFeed.pop();
      }
  }

  // --- O LOOP PRINCIPAL OTIMIZADO ---
  private loop() {
    if (!this.isRunning) return;
    this.animationFrameId = requestAnimationFrame(this.loop.bind(this));

    const now = performance.now();
    this.frames++;
    if (now >= this.prevTime + 1000) {
        if (this.fpsElement) this.fpsElement.innerText = `FPS: ${this.frames}`;
        this.frames = 0;
        this.prevTime = now;
    }

    // Calcula deltaTime, limitando a 0.1s para evitar saltos gigantes se travar
    let dt = (now - this.lastTime) / 1000;
    dt = Math.min(dt, 0.1); 
    this.lastTime = now;

    this.accumulator += dt;

    // IMPORTANT: If mode is null, we are in menu or exiting, do not update game logic.
    if (!this.currentMode) return;

    if (!this.isPaused || this.currentMode === 'EDITOR') {
        
        // EDITOR MODE (Simples)
        if (this.currentMode === 'EDITOR') {
            this.editorSystem.update(this.player, this.input, dt);
            this.world.update(dt, this.renderer, this.player.mesh.position);
            this.envManager.update(dt, this.editorSystem.currentCursorPos); 
        } 
        // GAMEPLAY MODE (Fixed TimeStep Physics)
        else {
            // FÍSICA DESACOPLADA: Roda passos fixos até alcançar o tempo real
            // Isso garante física estável mesmo se o FPS visual cair
            while (this.accumulator >= this.fixedTimeStep) {
                this.physics.step(this.fixedTimeStep);
                this.updateGameLogic(this.fixedTimeStep);
                this.player.update(this.fixedTimeStep, this.input);
                this.enemyManager.update(this.fixedTimeStep, this.player, this.currentMode === 'BATTLE_ROYALE' ? this.brManager : undefined);
                this.accumulator -= this.fixedTimeStep;
            }

            // Interpolation e Visual Updates (Rodam no FPS da tela)
            this.entities.update();
            this.world.update(dt, this.renderer, this.player.mesh.position);
            this.envManager.update(dt, this.player.mesh.position); 
            this.particleManager.update(dt);

            // OTIMIZAÇÃO DE DOM (Labels)
            // Atualiza apenas a cada 10 frames para não engasgar o navegador
            this.labelUpdateCounter++;
            if (this.labelUpdateCounter > 10) {
                this.labelUpdateCounter = 0;
                const playerY = this.player.mesh.position.y;
                this.regionLabels.forEach(label => {
                    const opacity = Math.max(0, Math.min(1, (playerY - 30) / 70));
                    // Check simples para evitar acesso ao DOM se o valor não mudou muito
                    if (Math.abs(parseFloat(label.element.style.opacity || '0') - opacity) > 0.1) {
                        label.element.style.opacity = opacity.toFixed(2);
                    }
                });
            }

            this.regionCheckTimer += dt;
            if (this.regionCheckTimer > 0.5) { 
                this.regionCheckTimer = 0;
                const pos = this.player.mesh.position;
                // Otimização: Só checa regiões se estiver baixo
                if (pos.y < 50) {
                    const regions = this.world.mapGenerator.regions;
                    for (let i = 0; i < regions.length; i++) {
                        const region = regions[i];
                        const distSq = (pos.x - region.x)**2 + (pos.z - region.z)**2;
                        if (distSq < region.radius * region.radius) {
                            if (this.player.stats.currentRegion !== region.name) {
                                this.player.stats.currentRegion = region.name;
                            }
                            break;
                        }
                    }
                }
            }
        }
    }

    // Render using FSR System (Includes Composer)
    this.fsr.render(dt);
    this.labelRenderer.render(this.world.scene, this.player.camera);
    
    if (this.onStatsUpdate && this.currentMode) {
        this.onStatsUpdate({ 
            ...this.player.stats,
            score: this.score,
            gameMode: this.currentMode,
            wave: this.wave,
            enemiesRemaining: this.enemyManager.enemies.length,
            radarBlips: this.calculateRadarBlips(),
            killFeed: this.killFeed
        });
    }

    this.input.resetDelta();
  }

  public setEditorTool(tool: string) {
      if (this.editorSystem) {
          this.editorSystem.setTool(tool as ToolType);
      }
  }

  public dispose() {
    this.isRunning = false;
    cancelAnimationFrame(this.animationFrameId);
    window.removeEventListener('resize', this.onResize.bind(this));
    if (this.fsr) this.fsr.dispose();
    this.renderer.dispose();
    if(this.labelRenderer && this.labelRenderer.domElement && this.labelRenderer.domElement.parentNode) {
        this.labelRenderer.domElement.parentNode.removeChild(this.labelRenderer.domElement);
    }
  }
}
