
import * as THREE from 'three';
import { Player } from './Player';
import { EnemyManager } from './EnemyManager';
import { Enemy } from './Enemy';
import { WeaponType, WeaponTier } from './WeaponSystem';
import { InputManager } from './InputManager';
import { AssetLoader } from './AssetLoader';
import { SoundManager } from './SoundManager';
import { TIER_COLORS, WATER_LEVEL } from '../constants';
import { World } from './World';

export type BRState = 'WAITING' | 'DROPPING' | 'PLAYING' | 'WIN' | 'GAMEOVER';

interface ZonePhase {
    id: number;
    time: number;
    hold: number;
    radius: number;
    damage: number;
}

interface LootItem {
    mesh: THREE.Group;
    type: WeaponType;
    tier: WeaponTier;
    active: boolean;
    basePos: THREE.Vector3;
    floatOffset: number;
    staticItem: boolean;
}

const MAX_GROUND_LOOT = 25; // Quantidade de armas espalhadas no chão

export class BattleRoyaleManager {
    public state: BRState = 'WAITING';
    
    // Zone
    public currentRadius: number = 600;
    public targetRadius: number = 600;
    public currentCenter: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
    public targetCenter: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
    private zoneMesh: THREE.Mesh;
    
    private shrinkStartRadius: number = 0;
    private shrinkStartCenter: THREE.Vector3 = new THREE.Vector3();
    
    // Dropship
    private dropshipGroup: THREE.Group;
    private propellers: THREE.Group[] = [];
    private dropPathStart = new THREE.Vector3(-800, 400, -800);
    private dropPathEnd = new THREE.Vector3(800, 400, 800);
    private dropProgress: number = 0; 
    private botsOnBoard: Enemy[] = [];
    private dropPhaseTime: number = 0;
    
    // LOOT SYSTEM
    private lootContainer: THREE.Group;
    public lootItems: LootItem[] = [];
    
    // Logic
    private phaseIndex: number = 0;
    private phaseTimer: number = 0;
    private isShrinking: boolean = false;
    private damageTimer: number = 0;
    private totalTime: number = 0;
    
    private scene: THREE.Scene;
    private world: World;
    private player: Player;
    private enemyManager: EnemyManager;

    private phases: ZonePhase[] = [
        { id: 1, time: 60, hold: 20, radius: 300, damage: 2 },  
        { id: 2, time: 45, hold: 20, radius: 120, damage: 5 },  
        { id: 3, time: 30, hold: 15, radius: 40,  damage: 10 }, 
        { id: 4, time: 20, hold: 10, radius: 0,   damage: 20 }  
    ];

    constructor(scene: THREE.Scene, world: World, player: Player, enemyManager: EnemyManager) {
        this.scene = scene;
        this.world = world;
        this.player = player;
        this.enemyManager = enemyManager;

        // 1. Zone Cylinder
        const geo = new THREE.CylinderGeometry(1, 1, 200, 32, 1, true); 
        const mat = new THREE.MeshBasicMaterial({
            color: 0xff0000,
            transparent: true,
            opacity: 0.3,
            side: THREE.DoubleSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });
        this.zoneMesh = new THREE.Mesh(geo, mat);
        this.zoneMesh.visible = false;
        this.zoneMesh.position.y = 100; 
        this.scene.add(this.zoneMesh);

        // 2. Containers
        this.lootContainer = new THREE.Group();
        this.scene.add(this.lootContainer);
        
        // 3. Dropship
        this.dropshipGroup = this.createDropship();
        this.dropshipGroup.visible = false;
        this.scene.add(this.dropshipGroup);

        this.player.weapon.onDropWeapon = (type, tier, pos) => {
            this.spawnLootItem(type, tier, pos);
        };
    }

    // --- GROUND LOOT LOGIC ---
    public spawnWorldLoot(candidates: THREE.Vector3[]) {
        this.clearLoot();

        // 1. Filter candidates to ensure no water spawns
        const validSpots = candidates.filter(pos => pos.y > WATER_LEVEL + 0.5);

        // 2. Shuffle
        for (let i = validSpots.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [validSpots[i], validSpots[j]] = [validSpots[j], validSpots[i]];
        }

        // 3. Spawn Items
        const count = Math.min(validSpots.length, MAX_GROUND_LOOT);
        
        for (let i = 0; i < count; i++) {
            const pos = validSpots[i];
            
            // Random Weapon Type
            const types = [WeaponType.RIFLE, WeaponType.SHOTGUN, WeaponType.SNIPER, WeaponType.PISTOL];
            const type = types[Math.floor(Math.random() * types.length)];

            // Random Tier (Weighted)
            const rand = Math.random();
            let tier = WeaponTier.COMMON;
            if (rand > 0.90) tier = WeaponTier.LEGENDARY;      // 10%
            else if (rand > 0.75) tier = WeaponTier.RARE;      // 15%
            else if (rand > 0.50) tier = WeaponTier.UNCOMMON;  // 25%
            else tier = WeaponTier.COMMON;                     // 50%

            this.spawnLootItem(type, tier, pos, true);
        }
        
        console.log(`[BR Manager] Spawned ${count} ground loot items.`);
    }

    private clearLoot() {
        while(this.lootContainer.children.length > 0) {
            const child = this.lootContainer.children[0];
            this.lootContainer.remove(child);
            // Clean up geometries if created dynamically
            if (child instanceof THREE.Group) {
                child.traverse(c => {
                    if (c instanceof THREE.Mesh) {
                        if (c.geometry) c.geometry.dispose();
                    }
                });
            }
        }
        this.lootItems = [];
    }

    public reset() {
        this.state = 'WAITING';
        this.dropshipGroup.visible = false;
        this.zoneMesh.visible = false;
        this.currentRadius = 0;
        this.clearLoot();
        SoundManager.getInstance().stopPlaneSound();
    }

    private createDropship(): THREE.Group {
        const group = new THREE.Group();
        const matDark = new THREE.MeshStandardMaterial({ color: 0x303030, roughness: 0.7, metalness: 0.4 });
        const matBlack = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
        const bodyGeo = new THREE.CylinderGeometry(4, 3.5, 30, 16); bodyGeo.rotateX(-Math.PI / 2); const body = new THREE.Mesh(bodyGeo, matDark); group.add(body);
        const nose = new THREE.Mesh(new THREE.SphereGeometry(3.5, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2), matDark); nose.rotateX(-Math.PI / 2); nose.position.z = 15; group.add(nose);
        const tailSection = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 2, 8, 16), matDark); tailSection.rotateX(-Math.PI / 2); tailSection.position.set(0, 1.2, -18); tailSection.rotation.x = 0.2; group.add(tailSection);
        const wings = new THREE.Mesh(new THREE.BoxGeometry(40, 0.8, 8), matDark); wings.position.set(0, 3, 2); group.add(wings);
        const vStab = new THREE.Mesh(new THREE.BoxGeometry(1, 9, 6), matDark); vStab.position.set(0, 6, -20); vStab.rotation.x = 0.3; group.add(vStab);
        const hStab = new THREE.Mesh(new THREE.BoxGeometry(14, 0.8, 5), matDark); hStab.position.set(0, 3, -20); group.add(hStab);
        const engineGeo = new THREE.CylinderGeometry(1, 0.8, 4, 12); engineGeo.rotateX(-Math.PI / 2); const propGeo = new THREE.BoxGeometry(0.2, 7, 0.5);
        [-12, -6, 6, 12].forEach(x => {
            const engine = new THREE.Mesh(engineGeo, matDark); engine.position.set(x, 1.5, 5); group.add(engine);
            const propGroup = new THREE.Group(); propGroup.position.set(x, 1.5, 7.2); 
            const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1, 8), matBlack); spinner.rotation.x = Math.PI / 2; propGroup.add(spinner);
            const blade1 = new THREE.Mesh(propGeo, matBlack); propGroup.add(blade1);
            const blade2 = new THREE.Mesh(propGeo, matBlack); blade2.rotation.z = Math.PI / 2; propGroup.add(blade2);
            group.add(propGroup); this.propellers.push(propGroup);
        });
        const light = new THREE.PointLight(0xff0000, 2, 20); light.position.set(0, 0, -10); group.add(light);
        group.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
        return group;
    }

    public startMatch() {
        this.state = 'DROPPING';
        this.phaseIndex = 0;
        this.phaseTimer = this.phases[0].hold;
        this.isShrinking = false;
        this.dropPhaseTime = 0;
        
        // --- START AUDIO (Resume preloaded sound) ---
        // Just call play, volume logic handles the fade
        SoundManager.getInstance().startPlaneSound();

        this.currentRadius = 600;
        this.targetRadius = this.phases[0].radius;
        this.currentCenter.set(0, 0, 0);
        this.targetCenter.set(0, 0, 0);
        
        this.zoneMesh.visible = true;
        this.lootContainer.visible = true;

        this.player.setArmed(false); 
        this.player.hasWeapon = true; 
        this.player.weapon.pickup(WeaponType.PISTOL, WeaponTier.COMMON); 
        
        this.player.stats.showDropPrompt = true;
        this.player.mesh.visible = false;
        this.player.body.mass = 0;
        this.player.body.updateMassProperties();
        this.player.body.velocity.set(0,0,0);
        
        this.botsOnBoard = [...this.enemyManager.enemies];
        this.enemyManager.enemies.forEach(e => {
            e.setArmed(true);
            e.setWeapon(WeaponType.PISTOL);
            e.mesh.visible = false;
            e.body.position.set(0, -1000, 0);
            e.body.velocity.set(0,0,0);
            e.body.sleep();
        });

        this.dropProgress = 0;
        this.dropshipGroup.visible = true;
        const angle = Math.random() * Math.PI;
        const dist = 800;
        this.dropPathStart.set(Math.cos(angle)*dist, 400, Math.sin(angle)*dist);
        this.dropPathEnd.set(Math.cos(angle + Math.PI)*dist, 400, Math.sin(angle + Math.PI)*dist);
        this.dropshipGroup.position.copy(this.dropPathStart);
        this.dropshipGroup.lookAt(this.dropPathEnd);
        
        const ac130 = AssetLoader.getInstance().weaponModels['AC130'];
        if (ac130) {
            while(this.dropshipGroup.children.length > 0){ this.dropshipGroup.remove(this.dropshipGroup.children[0]); }
            const model = ac130.clone();
            model.rotation.y = Math.PI;
            this.dropshipGroup.add(model);
            this.propellers = [];
        }
    }

    public spawnLootItem(type: WeaponType, tier: WeaponTier, pos: THREE.Vector3, enableEffects: boolean = true) {
        const mesh = this.player.weapon.generateMesh(type, tier);
        
        mesh.traverse(c => {
            if (c instanceof THREE.Mesh) {
                c.castShadow = false;
                c.receiveShadow = true;
            }
        });

        if (enableEffects) {
            let colorHex = TIER_COLORS.COMMON;
            if (tier === WeaponTier.UNCOMMON) colorHex = TIER_COLORS.UNCOMMON;
            if (tier === WeaponTier.RARE) colorHex = TIER_COLORS.RARE;
            if (tier === WeaponTier.LEGENDARY) colorHex = TIER_COLORS.LEGENDARY;

            const glowGeo = new THREE.CircleGeometry(0.5, 16);
            const glowMat = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.4, side: THREE.DoubleSide });
            const glow = new THREE.Mesh(glowGeo, glowMat);
            glow.rotation.x = Math.PI / 2;
            glow.position.y = -0.1;
            mesh.add(glow);

            if (tier >= WeaponTier.RARE) {
                const beamGeo = new THREE.CylinderGeometry(0.05, 0.05, 4, 8, 1, true);
                const beamMat = new THREE.MeshBasicMaterial({ 
                    color: colorHex, 
                    transparent: true, 
                    opacity: 0.2, 
                    blending: THREE.AdditiveBlending, 
                    side: THREE.DoubleSide,
                    depthWrite: false
                });
                const beam = new THREE.Mesh(beamGeo, beamMat);
                beam.position.y = 2.0;
                mesh.add(beam);
            }
        } else {
            mesh.rotation.y = Math.PI / 2; 
        }

        mesh.scale.set(1.5, 1.5, 1.5);
        mesh.position.copy(pos);
        
        this.lootContainer.add(mesh);
        
        this.lootItems.push({
            mesh,
            type,
            tier,
            active: true,
            basePos: pos.clone(),
            floatOffset: Math.random() * Math.PI * 2,
            staticItem: !enableEffects
        });
    }

    public update(dt: number, input: InputManager) {
        this.totalTime += dt;

        if (this.state === 'DROPPING') {
            this.updateDropship(dt, input);
            return;
        }

        if (this.player.stats.gameMode === 'TRAINING') {
            this.updateLoot(dt);
            this.checkPlayerInteractions(input);
            return; 
        }

        if (this.state !== 'PLAYING') return;

        if (this.enemyManager.enemies.length === 0 && this.player.stats.health > 0) {
            this.state = 'WIN';
            this.player.stats.isVictory = true;
            return;
        }

        this.updateZoneLogic(dt);
        this.zoneMesh.position.set(this.currentCenter.x, 50, this.currentCenter.z);
        this.zoneMesh.scale.set(this.currentRadius, 1, this.currentRadius);

        this.checkDamage(dt);
        this.updateLoot(dt);
        this.checkPlayerInteractions(input);
    }

    private updateDropship(dt: number, input: InputManager) {
        this.dropPhaseTime += dt;
        const speed = 80;
        const totalDist = this.dropPathStart.distanceTo(this.dropPathEnd);
        this.dropProgress += dt / (totalDist / speed);
        
        // --- AUDIO SPATIALIZATION ---
        // Se o jogador pulou, calcular distância e atenuar volume
        if (!this.player.stats.showDropPrompt) {
            const playerPos = this.player.mesh.position;
            const planePos = this.dropshipGroup.position;
            const dist = playerPos.distanceTo(planePos);
            
            // Volume começa a cair instantaneamente, some após 500m
            const maxHearingDist = 500;
            const volume = Math.max(0, 1.0 - (dist / maxHearingDist));
            SoundManager.getInstance().setPlaneVolume(volume * 0.6); // 0.6 Max volume
        } else {
            // Player is inside
            SoundManager.getInstance().setPlaneVolume(0.6);
        }

        if (this.dropProgress >= 1.0) {
            if (this.player.stats.showDropPrompt) this.ejectPlayer();
            while(this.botsOnBoard.length > 0) this.ejectBot(this.botsOnBoard[0]);
            this.endDropPhase();
            return;
        }

        const currentPos = new THREE.Vector3().lerpVectors(this.dropPathStart, this.dropPathEnd, this.dropProgress);
        this.dropshipGroup.position.copy(currentPos);
        this.dropshipGroup.lookAt(this.dropPathEnd);

        this.propellers.forEach(prop => prop.rotation.z += dt * 20);

        if (this.player.stats.showDropPrompt) {
            this.player.body.position.copy(currentPos as any);
            this.player.body.velocity.set(0,0,0);
            this.player.mesh.position.copy(currentPos);
            // Use 'F' to jump
            if (input.keys['KeyF']) this.ejectPlayer();
        }

        const canDrop = this.dropProgress > 0.25; 
        const forceDrop = this.dropProgress > 0.9;

        if (this.botsOnBoard.length > 0 && (canDrop || forceDrop)) {
            const groundHeight = this.world.mapGenerator.getHeightAt(currentPos.x, currentPos.z);
            const isOverWater = groundHeight < WATER_LEVEL + 2.0;

            let dropChance = 0.0;
            if (forceDrop) dropChance = 0.8; 
            else if (isOverWater) dropChance = 0.001; 
            else dropChance = 0.10; 

            if (Math.random() < dropChance) {
                const bot = this.botsOnBoard.pop();
                if (bot) this.ejectBot(bot);
            }
        }
    }

    private ejectPlayer() {
        this.player.stats.showDropPrompt = false;
        this.player.mesh.visible = true;
        this.player.body.mass = 70;
        this.player.body.updateMassProperties();
        this.player.body.wakeUp();

        const rampOffset = new THREE.Vector3(0, -3, -18).applyQuaternion(this.dropshipGroup.quaternion);
        const spawnPos = this.dropshipGroup.position.clone().add(rampOffset);
        
        this.player.body.position.copy(spawnPos as any);
        this.player.mesh.position.copy(spawnPos);
        
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.dropshipGroup.quaternion).normalize();
        this.player.body.velocity.set(forward.x * 25, -5, forward.z * 25);
    }

    private ejectBot(bot: Enemy) {
        this.botsOnBoard = this.botsOnBoard.filter(b => b !== bot);
        const rampOffset = new THREE.Vector3(0, -3, -18).applyQuaternion(this.dropshipGroup.quaternion);
        const spawnPos = this.dropshipGroup.position.clone().add(rampOffset);
        spawnPos.x += (Math.random() - 0.5) * 10;
        spawnPos.z += (Math.random() - 0.5) * 10;

        bot.mesh.visible = true;
        bot.setArmed(true);
        bot.body.wakeUp();
        bot.body.position.copy(spawnPos as any);
        
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.dropshipGroup.quaternion).normalize();
        bot.body.velocity.set(
            forward.x * 25 + (Math.random()-0.5)*15, 
            -15, 
            forward.z * 25 + (Math.random()-0.5)*15
        );
    }

    private endDropPhase() {
        this.state = 'PLAYING';
        this.dropshipGroup.visible = false;
        SoundManager.getInstance().stopPlaneSound(); // Stop Sound
        this.pickNextZone();
        this.player.stats.showDropPrompt = false;
        if (this.player.body.mass === 0) {
            this.player.body.mass = 70;
            this.player.body.updateMassProperties();
            this.player.body.wakeUp();
        }
    }

    private updateLoot(dt: number) {
        const playerPos = this.player.mesh.position;
        for (const item of this.lootItems) {
            if (!item.active) continue;
            
            // OTIMIZAÇÃO: Culling de distância. Se estiver longe (> 60m), nem desenha nem anima.
            const distSq = playerPos.distanceToSquared(item.basePos);
            if (distSq > 3600) { 
                if (item.mesh.visible) item.mesh.visible = false; 
                continue; 
            } else { 
                if (!item.mesh.visible) item.mesh.visible = true; 
            }

            if (!item.staticItem) {
                item.mesh.rotation.y += dt;
                const floatY = Math.sin(this.totalTime * 2 + item.floatOffset) * 0.1;
                item.mesh.position.y = item.basePos.y + floatY;
            }
        }
    }

    public getNearestActiveLoot(pos: THREE.Vector3): THREE.Vector3 | null {
        let minDistSq = Infinity;
        let target: THREE.Vector3 | null = null;
        for (const loot of this.lootItems) {
            if (!loot.active) continue;
            const distSq = pos.distanceToSquared(loot.basePos);
            if (distSq < 10000 && distSq < minDistSq) {
                if (this.isPointInZone(loot.basePos)) {
                    minDistSq = distSq;
                    target = loot.basePos;
                }
            }
        }
        return target;
    }

    public tryPickupLoot(pos: THREE.Vector3): boolean {
        for (const loot of this.lootItems) {
            if (loot.active && pos.distanceToSquared(loot.basePos) < 4.0) { 
                loot.active = false;
                loot.mesh.visible = false;
                return true;
            }
        }
        return false;
    }

    private checkPlayerInteractions(input: InputManager) {
        // Changed interaction key to 'F' to allow 'E' for Leaning
        if (!input.keys['KeyF']) return;
        input.keys['KeyF'] = false; // Consume click

        const pPos = this.player.mesh.position;

        // Check Weapons on Floor
        for (const loot of this.lootItems) {
            if (loot.active && pPos.distanceToSquared(loot.basePos) < 6.0) {
                if (this.player.weapon.pickup(loot.type, loot.tier)) {
                    loot.active = false;
                    loot.mesh.visible = false;
                    this.player.hasWeapon = true;
                    SoundManager.getInstance().playVoice("Weapon Acquired");
                    return;
                }
            }
        }
    }

    private updateZoneLogic(dt: number) {
        if (this.phaseIndex >= this.phases.length) {
             this.currentRadius = 0;
             return;
        }

        const phase = this.phases[this.phaseIndex];

        if (this.isShrinking) {
            this.phaseTimer -= dt;
            const t = 1.0 - Math.max(0, this.phaseTimer / phase.time);
            
            this.currentRadius = THREE.MathUtils.lerp(this.shrinkStartRadius, this.targetRadius, t);
            this.currentCenter.lerpVectors(this.shrinkStartCenter, this.targetCenter, t);

            if (this.phaseTimer <= 0) {
                this.isShrinking = false;
                this.phaseIndex++;
                
                if (this.phaseIndex < this.phases.length) {
                    this.pickNextZone();
                    this.phaseTimer = this.phases[this.phaseIndex].hold;
                }
            }
        } else {
            this.phaseTimer -= dt;
            if (this.phaseTimer <= 0) {
                this.isShrinking = true;
                this.phaseTimer = phase.time;
                this.shrinkStartRadius = this.currentRadius;
                this.shrinkStartCenter.copy(this.currentCenter);
            }
        }
    }

    private pickNextZone() {
        if (this.phaseIndex >= this.phases.length) return;
        const nextRadius = this.phases[this.phaseIndex].radius;
        const angle = Math.random() * Math.PI * 2;
        const maxDist = Math.max(0, this.currentRadius - nextRadius);
        const dist = Math.sqrt(Math.random()) * maxDist; 
        
        const offsetX = Math.cos(angle) * dist;
        const offsetZ = Math.sin(angle) * dist;

        this.targetCenter.set(this.currentCenter.x + offsetX, 0, this.currentCenter.z + offsetZ);
        this.targetRadius = nextRadius;
    }

    private checkDamage(dt: number) {
        this.damageTimer += dt;
        if (this.damageTimer > 1.0) {
            this.damageTimer = 0;
            const phase = this.phases[Math.min(this.phaseIndex, this.phases.length-1)];
            const damagePerTick = phase ? phase.damage : 1;

            const pPos = this.player.mesh.position;
            const distSq = new THREE.Vector2(pPos.x, pPos.z).distanceToSquared(new THREE.Vector2(this.currentCenter.x, this.currentCenter.z));
            const radSq = this.currentRadius * this.currentRadius;

            if (distSq > radSq) {
                this.player.takeDamage(damagePerTick);
                this.player.stats.isOutsideZone = true;
            } else {
                this.player.stats.isOutsideZone = false;
            }
            this.player.stats.zoneRadius = this.currentRadius;

            this.enemyManager.enemies.forEach(enemy => {
                const ePos = enemy.mesh.position;
                const eDistSq = new THREE.Vector2(ePos.x, ePos.z).distanceToSquared(new THREE.Vector2(this.currentCenter.x, this.currentCenter.z));
                if (eDistSq > radSq) {
                    enemy.takeDamage(damagePerTick);
                }
            });
        }
    }

    public isPointInZone(pos: THREE.Vector3): boolean {
        const distSq = new THREE.Vector2(pos.x, pos.z).distanceToSquared(new THREE.Vector2(this.currentCenter.x, this.currentCenter.z));
        return distSq < (this.currentRadius * this.currentRadius);
    }
}
