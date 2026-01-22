import * as THREE from 'three';
import { TextureGenerator } from './TextureGenerator';
import { MaterialType } from './SoundManager';

interface Particle {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  scale: number;
  rotation: THREE.Euler;
}

export class ParticleManager {
  private static instance: ParticleManager;
  private scene!: THREE.Scene;

  // --- SPARKS (InstancedMesh) ---
  private sparkMesh!: THREE.InstancedMesh;
  private sparks: Particle[] = [];
  private sparkCount = 300;
  private sparkIdx = 0;
  private dummySpark = new THREE.Object3D();

  // --- BLOOD (Point Cloud Otimizado) ---
  private bloodGeo!: THREE.BufferGeometry;
  private bloodMat!: THREE.ShaderMaterial;
  private bloodSystem!: THREE.Points;
  private readonly MAX_BLOOD = 2000; // Reduzido levemente para 2000 (suficiente)
  private bloodIndex = 0;
  
  // Physics Data (Typed Arrays para velocidade máxima)
  private bloodPos: Float32Array; // x,y,z
  private bloodVel: Float32Array; // vx,vy,vz
  private bloodLife: Float32Array; // remaining life
  private bloodSize: Float32Array; // initial size

  // --- DUST / SMOKE ---
  private dustGeo!: THREE.BufferGeometry;
  private dustMat!: THREE.ShaderMaterial;
  private dustSystem!: THREE.Points;
  private dustParticles: Particle[] = [];
  private dustCount = 300; 
  private dustIdx = 0;
  private dustPositions: Float32Array;
  private dustSizes: Float32Array;
  private dustOpacities: Float32Array;

  // Texturas cacheadas
  private bloodTexture: THREE.Texture | null = null;
  private dustTexture: THREE.Texture | null = null;

  private constructor() {
      // Arrays pré-alocados para evitar Garbage Collection
      this.dustPositions = new Float32Array(this.dustCount * 3);
      this.dustSizes = new Float32Array(this.dustCount);
      this.dustOpacities = new Float32Array(this.dustCount);

      this.bloodPos = new Float32Array(this.MAX_BLOOD * 3);
      this.bloodVel = new Float32Array(this.MAX_BLOOD * 3);
      this.bloodLife = new Float32Array(this.MAX_BLOOD);
      this.bloodSize = new Float32Array(this.MAX_BLOOD);
  }

  public static getInstance(): ParticleManager {
    if (!ParticleManager.instance) {
      ParticleManager.instance = new ParticleManager();
    }
    return ParticleManager.instance;
  }

  public init(scene: THREE.Scene) {
    this.scene = scene;

    // Cache textures once
    if (!this.bloodTexture) this.bloodTexture = TextureGenerator.createBloodTexture();
    if (!this.dustTexture) this.dustTexture = TextureGenerator.createDust();

    // 1. SPARKS Setup
    const sparkGeo = new THREE.BoxGeometry(0.04, 0.04, 0.4); 
    const sparkMat = new THREE.MeshBasicMaterial({ 
        color: 0xffaa00, 
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false
    });
    this.sparkMesh = new THREE.InstancedMesh(sparkGeo, sparkMat, this.sparkCount);
    this.sparkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.sparkMesh);
    this.initPool(this.sparks, this.sparkCount);

    // 2. BLOOD Setup (Shader Otimizado)
    this.bloodGeo = new THREE.BufferGeometry();
    this.bloodGeo.setAttribute('position', new THREE.BufferAttribute(this.bloodPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.bloodGeo.setAttribute('life', new THREE.BufferAttribute(this.bloodLife, 1).setUsage(THREE.DynamicDrawUsage));
    this.bloodGeo.setAttribute('initSize', new THREE.BufferAttribute(this.bloodSize, 1).setUsage(THREE.DynamicDrawUsage));

    const bloodVertex = `
        attribute float life;
        attribute float initSize;
        varying float vLife;
        void main() {
            vLife = life;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            // Tamanho fixo otimizado
            float dist = -mvPosition.z;
            gl_PointSize = initSize * (600.0 / max(0.1, dist)); 
            gl_Position = projectionMatrix * mvPosition;
        }
    `;

    const bloodFragment = `
        uniform sampler2D map;
        varying float vLife;
        void main() {
            if (vLife <= 0.01) discard; // Early discard
            vec4 tex = texture2D(map, gl_PointCoord);
            vec3 bloodColor = vec3(0.55, 0.0, 0.0);
            gl_FragColor = vec4(bloodColor, tex.a * vLife);
        }
    `;

    this.bloodMat = new THREE.ShaderMaterial({
        uniforms: {
            map: { value: this.bloodTexture }
        },
        vertexShader: bloodVertex,
        fragmentShader: bloodFragment,
        transparent: true,
        depthWrite: false, // Performance boost crucial para partículas transparentes
        blending: THREE.NormalBlending
    });

    this.bloodSystem = new THREE.Points(this.bloodGeo, this.bloodMat);
    this.bloodSystem.frustumCulled = false; 
    this.scene.add(this.bloodSystem);

    // 3. DUST Setup
    this.dustGeo = new THREE.BufferGeometry();
    this.dustGeo.setAttribute('position', new THREE.BufferAttribute(this.dustPositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.dustGeo.setAttribute('size', new THREE.BufferAttribute(this.dustSizes, 1).setUsage(THREE.DynamicDrawUsage));
    this.dustGeo.setAttribute('opacity', new THREE.BufferAttribute(this.dustOpacities, 1).setUsage(THREE.DynamicDrawUsage));
    
    const dustVert = `
      attribute float size;
      attribute float opacity;
      varying float vOpacity;
      void main() {
        vOpacity = opacity;
        vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
        gl_PointSize = size * ( 500.0 / -mvPosition.z );
        gl_Position = projectionMatrix * mvPosition;
      }
    `;

    const dustFrag = `
      uniform vec3 color;
      uniform sampler2D pointTexture;
      varying float vOpacity;
      void main() {
        if (vOpacity <= 0.01) discard;
        vec4 texColor = texture2D( pointTexture, gl_PointCoord );
        gl_FragColor = vec4( color, vOpacity * texColor.a );
      }
    `;

    this.dustMat = new THREE.ShaderMaterial({
        uniforms: {
            color: { value: new THREE.Color(0xaaaaaa) },
            pointTexture: { value: this.dustTexture }
        },
        vertexShader: dustVert,
        fragmentShader: dustFrag,
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending
    });

    this.dustSystem = new THREE.Points(this.dustGeo, this.dustMat);
    this.dustSystem.frustumCulled = false;
    this.scene.add(this.dustSystem);
    this.initPool(this.dustParticles, this.dustCount);
  }

  private initPool(pool: Particle[], count: number) {
      for(let i=0; i<count; i++) {
          pool.push({
              active: false,
              pos: new THREE.Vector3(),
              vel: new THREE.Vector3(),
              life: 0,
              maxLife: 1,
              scale: 1,
              rotation: new THREE.Euler()
          });
      }
  }

  public emit(type: MaterialType, pos: THREE.Vector3, normal: THREE.Vector3) {
      if (type === 'METAL') {
          this.emitSparks(pos, normal, 8);
      } else if (type === 'FLESH') {
          // Menos partículas, mas visualmente eficazes
          this.emitBlood(pos, normal, 15); 
      } else if (type === 'CONCRETE' || type === 'DIRT') {
          this.emitDust(pos, normal, 3);
      }
  }

  // --- BLOOD LOGIC ---
  private emitBlood(pos: THREE.Vector3, normal: THREE.Vector3, count: number) {
      // Pre-calcula randoms para evitar chamadas excessivas dentro do loop
      for (let i = 0; i < count; i++) {
          const idx = this.bloodIndex;
          this.bloodIndex = (this.bloodIndex + 1) % this.MAX_BLOOD;

          this.bloodPos[idx * 3] = pos.x;
          this.bloodPos[idx * 3 + 1] = pos.y;
          this.bloodPos[idx * 3 + 2] = pos.z;

          // Velocidade Explosiva
          const spread = 0.8; 
          const speed = 2.0 + Math.random() * 5.0; 
          
          this.bloodVel[idx * 3] = (normal.x + (Math.random() - 0.5) * spread) * speed;
          this.bloodVel[idx * 3 + 1] = (normal.y + (Math.random() * 0.5)) * speed + 1.0; 
          this.bloodVel[idx * 3 + 2] = (normal.z + (Math.random() - 0.5) * spread) * speed;

          this.bloodLife[idx] = 0.4 + Math.random() * 0.4;
          this.bloodSize[idx] = 0.15 + Math.random() * 0.2;
      }
      
      // Marca o buffer como "sujo" para ser enviado para a GPU
      this.bloodGeo.attributes.position.needsUpdate = true;
      this.bloodGeo.attributes.life.needsUpdate = true;
      this.bloodGeo.attributes.initSize.needsUpdate = true;
  }

  private updateBlood(dt: number) {
      let activeParticles = 0;
      const gravity = 15.0 * dt;
      const drag = 0.92; // Mais resistência do ar para parecer spray

      for(let i=0; i<this.MAX_BLOOD; i++) {
          if (this.bloodLife[i] > 0) {
              activeParticles++;
              this.bloodLife[i] -= dt;
              
              if (this.bloodLife[i] <= 0) {
                  this.bloodLife[i] = 0; 
                  // Move para longe para não ser desenhado
                  this.bloodPos[i*3+1] = -500;
              } else {
                  // Physics Update
                  this.bloodVel[i*3+1] -= gravity;
                  this.bloodVel[i*3] *= drag;
                  this.bloodVel[i*3+1] *= drag;
                  this.bloodVel[i*3+2] *= drag;

                  this.bloodPos[i*3] += this.bloodVel[i*3] * dt;
                  this.bloodPos[i*3+1] += this.bloodVel[i*3+1] * dt;
                  this.bloodPos[i*3+2] += this.bloodVel[i*3+2] * dt;
                  
                  // Chão fake simples
                  if (this.bloodPos[i*3+1] < 0.05) {
                      this.bloodPos[i*3+1] = 0.05;
                      this.bloodVel[i*3] = 0;
                      this.bloodVel[i*3+1] = 0;
                      this.bloodVel[i*3+2] = 0;
                  }
              }
          }
      }

      // Só envia dados para a GPU se houver partículas vivas
      if (activeParticles > 0) {
          this.bloodGeo.attributes.position.needsUpdate = true;
          this.bloodGeo.attributes.life.needsUpdate = true;
      }
  }

  // --- OTHER PARTICLES ---

  public emitSmokePuff(pos: THREE.Vector3) {
      const p = this.dustParticles[this.dustIdx];
      this.dustIdx = (this.dustIdx + 1) % this.dustCount;

      p.active = true;
      p.pos.copy(pos);
      p.pos.add(new THREE.Vector3((Math.random()-0.5)*0.2, (Math.random()-0.5)*0.2, (Math.random()-0.5)*0.2));
      
      p.life = 0.4 + Math.random() * 0.4; 
      p.maxLife = p.life;
      p.scale = 0.3; 
      p.vel.set((Math.random()-0.5)*0.2, 0.5 + Math.random() * 0.3, (Math.random()-0.5)*0.2);
  }

  private emitSparks(pos: THREE.Vector3, normal: THREE.Vector3, count: number) {
      for(let i=0; i<count; i++) {
          const p = this.sparks[this.sparkIdx];
          this.sparkIdx = (this.sparkIdx + 1) % this.sparkCount;

          p.active = true;
          p.pos.copy(pos);
          p.life = 0.2 + Math.random() * 0.15; // Vida mais curta
          p.maxLife = p.life;
          p.scale = 1.0;

          const speed = 6 + Math.random() * 6;
          const spread = new THREE.Vector3(Math.random()-0.5, Math.random()-0.5, Math.random()-0.5).normalize();
          p.vel.copy(normal).add(spread).normalize().multiplyScalar(speed);
      }
  }

  private emitDust(pos: THREE.Vector3, normal: THREE.Vector3, count: number) {
      for(let i=0; i<count; i++) {
          const p = this.dustParticles[this.dustIdx];
          this.dustIdx = (this.dustIdx + 1) % this.dustCount;

          p.active = true;
          p.pos.copy(pos).add(new THREE.Vector3((Math.random()-0.5)*0.2, 0, (Math.random()-0.5)*0.2));
          
          p.life = 0.6 + Math.random() * 0.6;
          p.maxLife = p.life;
          p.scale = 0.5 + Math.random() * 0.5;
          const speed = 0.2 + Math.random() * 0.3; 
          p.vel.copy(normal).add(new THREE.Vector3(0, 0.2, 0)).normalize().multiplyScalar(speed);
      }
  }

  public update(dt: number) {
      if (!this.scene) return;

      this.updateSparks(dt);
      this.updateBlood(dt);
      this.updateDust(dt);
  }

  private updateSparks(dt: number) {
      let activeCount = 0;
      for(let i=0; i<this.sparkCount; i++) {
          const p = this.sparks[i];
          if (!p.active) {
              // Hack de performance: move para o infinito via matriz
              this.sparkMesh.setMatrixAt(i, new THREE.Matrix4().set(0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0)); 
              continue;
          }
          activeCount++;

          p.life -= dt;
          if (p.life <= 0) {
              p.active = false;
              continue;
          }

          p.vel.y -= 15.0 * dt; // Gravidade mais forte para faíscas
          p.pos.addScaledVector(p.vel, dt);

          this.dummySpark.position.copy(p.pos);
          // LookAt para alinhar a faísca com a direção do movimento (motion blur fake)
          this.dummySpark.lookAt(p.pos.clone().add(p.vel));
          const s = Math.min(1, p.life / 0.1); 
          this.dummySpark.scale.set(s, s, s * 2.0); // Estica no eixo Z
          this.dummySpark.updateMatrix();
          this.sparkMesh.setMatrixAt(i, this.dummySpark.matrix);
      }
      if (activeCount > 0) this.sparkMesh.instanceMatrix.needsUpdate = true;
  }

  private updateDust(dt: number) {
      let activeCount = 0;
      const positions = this.dustGeo.attributes.position.array as Float32Array;
      const sizes = this.dustGeo.attributes.size.array as Float32Array;
      const opacities = this.dustGeo.attributes.opacity.array as Float32Array;

      for(let i=0; i<this.dustCount; i++) {
          const p = this.dustParticles[i];
          
          if (!p.active) {
              if (positions[i*3+1] > -500) { // Só reseta se não estiver resetado
                  sizes[i] = 0;
                  opacities[i] = 0;
                  positions[i*3+1] = -1000;
              }
              continue;
          }
          activeCount++;

          p.life -= dt;
          if (p.life <= 0) {
              p.active = false;
              continue;
          }

          p.pos.addScaledVector(p.vel, dt);
          p.vel.multiplyScalar(0.95); 

          positions[i*3] = p.pos.x;
          positions[i*3+1] = p.pos.y;
          positions[i*3+2] = p.pos.z;

          const lifeRatio = p.life / p.maxLife; 
          // Cresce conforme morre (efeito de dissipação)
          const size = p.scale * (1.5 + (1.0 - lifeRatio) * 2.0); 
          sizes[i] = size * 6.0; 

          let opacity = 1.0;
          if (lifeRatio > 0.8) opacity = (1.0 - lifeRatio) * 5.0; // Fade in
          else opacity = lifeRatio; // Fade out

          opacities[i] = opacity * 0.15; 
      }
      
      if (activeCount > 0) {
          this.dustGeo.attributes.position.needsUpdate = true;
          this.dustGeo.attributes.size.needsUpdate = true;
          this.dustGeo.attributes.opacity.needsUpdate = true;
      }
  }
}