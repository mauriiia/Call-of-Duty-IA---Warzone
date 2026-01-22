
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { COLORS } from '../constants';
import { TextureGenerator } from './TextureGenerator';

export class AssetLoader {
  private static instance: AssetLoader;
  public materials: Record<string, THREE.Material> = {};
  
  // Registry for loaded 3D Models
  public weaponModels: Record<string, THREE.Group> = {};

  private constructor() {
    this.generateMaterials();
    
    // --- LOAD USER ASSETS ---
    // External assets removed to prevent 404 errors.
    // The engine will automatically use procedural models for weapons, enemies, and dropship.
  }

  public static getInstance(): AssetLoader {
    if (!AssetLoader.instance) {
      AssetLoader.instance = new AssetLoader();
    }
    return AssetLoader.instance;
  }

  // Generic GLB Loader function
  public loadGLB(url: string, key: string, scale: number = 1.0, positionOffset: THREE.Vector3 = new THREE.Vector3(), rotationOffset: THREE.Euler = new THREE.Euler()) {
      if (!url) return; // Guard against empty URLs
      
      const loader = new GLTFLoader();
      
      loader.load(url, (gltf) => {
          console.log(`[AssetLoader] Success: ${key} loaded from ${url}`);
          const model = gltf.scene;
          
          // Apply Transforms to normalize the model
          model.scale.set(scale, scale, scale);
          model.position.copy(positionOffset);
          model.rotation.copy(rotationOffset);

          // Enable Shadows for all meshes inside
          model.traverse((c) => {
              if (c instanceof THREE.Mesh) {
                  c.castShadow = true;
                  c.receiveShadow = true;
                  
                  // Ensure materials react to light properly
                  if (c.material) {
                      c.material.needsUpdate = true;
                  }
              }
          });
          
          this.weaponModels[key] = model;
      }, 
      undefined, // Progress callback
      (error) => {
          console.error(`[AssetLoader] FAILED to load ${key} from ${url}.`, error);
      });
  }

  private generateMaterials() {
    // --- GROUND (Asphalt) ---
    const asphaltTex = TextureGenerator.createAsphalt(1024);
    asphaltTex.repeat.set(20, 20); // Repeat across the huge floor
    asphaltTex.anisotropy = 16;

    this.materials['floor'] = new THREE.MeshStandardMaterial({
      map: asphaltTex,
      roughness: 0.9,
      metalness: 0.1,
      color: 0xffffff // Texture provides color
    });

    // --- WALLS ---

    // 1. Brick Wall (High Building)
    const brickTex = TextureGenerator.createBricks(512);
    brickTex.anisotropy = 8;
    
    this.materials['wall_brick'] = new THREE.MeshStandardMaterial({
        map: brickTex,
        roughness: 0.95,
        metalness: 0.05
    });

    // 2. Concrete Wall (Industrial)
    const concreteTex = TextureGenerator.createConcrete(512);
    this.materials['wall_concrete'] = new THREE.MeshStandardMaterial({
        map: concreteTex,
        roughness: 0.9,
        metalness: 0.1,
        color: 0xaaaaaa
    });

    // 3. Caution Barrier (Low Wall)
    const cautionTex = TextureGenerator.createCaution(256);
    this.materials['wall_caution'] = new THREE.MeshStandardMaterial({
        map: cautionTex,
        roughness: 0.6,
        metalness: 0.1
    });

    // Wall Trim (Coping Stone)
    this.materials['wall_trim'] = new THREE.MeshStandardMaterial({
        map: concreteTex, // Reuse concrete
        color: 0x666666,
        roughness: 0.8
    });

    // -------------------------

    // Container Panel (Corrugated) - Kept generic logic
    this.materials['container_panel'] = new THREE.MeshStandardMaterial({
      map: this.createCorrugatedTexture(),
      roughness: 0.6,
      metalness: 0.3,
      bumpMap: this.createCorrugatedTexture(),
      bumpScale: 0.05
    });

    // Misc Materials
    this.materials['container_frame'] = new THREE.MeshStandardMaterial({
      color: 0x222222,
      roughness: 0.7,
      metalness: 0.5
    });

    this.materials['grenade'] = new THREE.MeshStandardMaterial({
      color: 0x335533,
      roughness: 0.5,
      metalness: 0.7
    });

    this.materials['explosion'] = new THREE.MeshBasicMaterial({
      color: 0xff5500,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending
    });

    this.materials['muzzle'] = new THREE.MeshBasicMaterial({
      color: 0xffffaa,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending
    });

    // Decal (Bullet Hole)
    this.materials['decal'] = new THREE.MeshStandardMaterial({
      map: this.createBulletHoleTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      roughness: 1,
      metalness: 0
    });

    // Target Dummy
    this.materials['dummy_body'] = new THREE.MeshStandardMaterial({
        color: 0xff0000, 
        roughness: 0.4,
        metalness: 0.1,
        emissive: 0x220000,
        emissiveIntensity: 0.2
    });

    this.materials['dummy_dark'] = new THREE.MeshStandardMaterial({
        color: 0x111111,
        roughness: 0.8,
        metalness: 0.5
    });
    
    this.materials['dummy_metal'] = new THREE.MeshStandardMaterial({
        color: 0x888888,
        roughness: 0.3,
        metalness: 0.8
    });

    // --- ENEMY MATERIALS ---
    this.materials['enemy_armor_red'] = new THREE.MeshStandardMaterial({
        color: 0x331111, // Dark Red
        roughness: 0.7,
        metalness: 0.4
    });

    this.materials['enemy_armor_blue'] = new THREE.MeshStandardMaterial({
        color: 0x111133, // Dark Blue
        roughness: 0.7,
        metalness: 0.4
    });

    this.materials['enemy_eye'] = new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: 0xff0000,
        emissiveIntensity: 2.0,
        roughness: 0.2,
        metalness: 0.8
    });

    // --- HOLOGRAPHIC SIGHT RETICLE ---
    this.materials['holo_reticle'] = new THREE.MeshBasicMaterial({
        map: this.createHoloReticleTexture(),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
    });

    // --- VEGETATION (Grass) ---
    this.materials['grass'] = new THREE.MeshStandardMaterial({
        map: TextureGenerator.createGrass(),
        color: 0xbbffbb, // Tint slightly
        roughness: 1.0,
        side: THREE.DoubleSide,
        alphaTest: 0.5, // Important to cut out the transparent parts
        transparent: false // Use alphaTest for performance instead of full transparency sorting
    });
  }

  // --- PROCEDURAL TEXTURES ---

  private createHoloReticleTexture(): THREE.CanvasTexture {
      const size = 512; // Higher res for crisp lines
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("Context");

      const cx = size / 2;
      const cy = size / 2;

      // 1. Clear
      ctx.clearRect(0, 0, size, size);

      // 2. Setup Red Glow
      ctx.shadowColor = '#ff0000';
      ctx.shadowBlur = 15;
      ctx.strokeStyle = '#ff0000';
      ctx.fillStyle = '#ff0000';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // 3. Central Dot
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fill();

      // 4. Stylized Brackets [  ]
      const bracketH = 80;
      const bracketW = 60;
      const gap = 120; // Gap between brackets

      // Left Bracket [
      ctx.beginPath();
      ctx.moveTo(cx - gap, cy - bracketH);
      ctx.lineTo(cx - gap - bracketW, cy - bracketH); // Top leg
      ctx.lineTo(cx - gap - bracketW - 10, cy);       // Angle in
      ctx.lineTo(cx - gap - bracketW, cy + bracketH); // Bottom leg
      ctx.lineTo(cx - gap, cy + bracketH);
      ctx.stroke();

      // Right Bracket ]
      ctx.beginPath();
      ctx.moveTo(cx + gap, cy - bracketH);
      ctx.lineTo(cx + gap + bracketW, cy - bracketH);
      ctx.lineTo(cx + gap + bracketW + 10, cy);
      ctx.lineTo(cx + gap + bracketW + 10, cy);
      ctx.lineTo(cx + gap, cy + bracketH);
      ctx.stroke();

      // 5. Yellow Arrows > <
      ctx.shadowColor = '#ffff00';
      ctx.shadowBlur = 10;
      ctx.strokeStyle = '#ffff00'; // Yellow
      ctx.lineWidth = 3;

      const arrowGap = 200;
      // Left Arrow > (Pointing in)
      ctx.beginPath();
      ctx.moveTo(cx - arrowGap - 20, cy - 20);
      ctx.lineTo(cx - arrowGap, cy);
      ctx.lineTo(cx - arrowGap - 20, cy + 20);
      ctx.stroke();

      // Right Arrow < (Pointing in)
      ctx.beginPath();
      ctx.moveTo(cx + arrowGap + 20, cy - 20);
      ctx.lineTo(cx + arrowGap, cy);
      ctx.lineTo(cx + arrowGap + 20, cy + 20);
      ctx.stroke();

      const tex = new THREE.CanvasTexture(canvas);
      tex.needsUpdate = true;
      return tex;
  }

  private createCorrugatedTexture(): THREE.CanvasTexture {
      const size = 512;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if(!ctx) throw new Error("Context");

      ctx.fillStyle = '#888888';
      ctx.fillRect(0,0,size,size);
      const stripes = 16;
      const w = size / stripes;

      for(let i=0; i<stripes; i++) {
          const x = i * w;
          const grad = ctx.createLinearGradient(x, 0, x+w, 0);
          grad.addColorStop(0, '#555555'); 
          grad.addColorStop(0.5, '#aaaaaa'); 
          grad.addColorStop(1, '#555555'); 
          ctx.fillStyle = grad;
          ctx.fillRect(x, 0, w, size);
      }
      return new THREE.CanvasTexture(canvas);
  }

  private createBulletHoleTexture(): THREE.CanvasTexture {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Context");
    ctx.clearRect(0,0,size,size);
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(32,32,10,0,Math.PI*2);
    ctx.fill();
    return new THREE.CanvasTexture(canvas);
  }
}
