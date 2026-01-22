import * as THREE from 'three';
import { COLORS } from '../constants';
import { TextureGenerator } from './TextureGenerator';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';

export class EnvironmentManager {
    private scene: THREE.Scene;
    
    // Iluminação
    private dirLight!: THREE.DirectionalLight;
    private hemiLight!: THREE.HemisphereLight;

    // Sky System
    private skyMesh!: THREE.Mesh;
    private skyUniforms: { [uniform: string]: THREE.IUniform };
    
    // Flare System
    private flareAnchor!: THREE.Mesh; 
    private sunDirection = new THREE.Vector3(); 

    // Shadow Config (OTIMIZAÇÃO: Começar com 1024 para garantir FPS em PCs fracos)
    private shadowMapSize: number = 1024; 
    private shadowCamSize: number = 150; // Área coberta pela sombra

    // Cores do Dia
    private readonly SKY_TOP_COLOR = new THREE.Color(0x0055aa); 
    private readonly SKY_HORIZON_COLOR = new THREE.Color(0x44bbff); 
    private readonly CLOUD_COLOR = new THREE.Color(0xffffff);
    private readonly GROUND_LIGHT = 0x2a3344; 

    constructor(scene: THREE.Scene) {
        this.scene = scene;
        this.skyUniforms = {
            uTime: { value: 0 },
            tNoise: { value: null },
            uSunPos: { value: new THREE.Vector3() }
        };

        this.initLights();
        this.initSky();
        this.initLensFlare();
    }

    private initLights() {
        this.hemiLight = new THREE.HemisphereLight(0xddeeff, this.GROUND_LIGHT, 0.8); // Intensidade 0.8 é mais natural
        this.scene.add(this.hemiLight);

        this.dirLight = new THREE.DirectionalLight(0xfffaed, 2.5); 
        this.dirLight.position.set(80, 250, 120); 
        this.dirLight.castShadow = true;
        
        // --- SHADOW SETUP OTIMIZADO ---
        this.dirLight.shadow.mapSize.width = this.shadowMapSize; 
        this.dirLight.shadow.mapSize.height = this.shadowMapSize;
        this.dirLight.shadow.camera.near = 0.5;
        this.dirLight.shadow.camera.far = 800; // Reduzi de 1000 para 800 (menos profundidade = mais precisão)
        
        const d = this.shadowCamSize; 
        this.dirLight.shadow.camera.left = -d;
        this.dirLight.shadow.camera.right = d;
        this.dirLight.shadow.camera.top = d;
        this.dirLight.shadow.camera.bottom = -d;
        
        // Bias ajustado para evitar "Peter Panning" (sombra voando) e "Acne" (sombra listrada)
        this.dirLight.shadow.bias = -0.0005; 
        this.dirLight.shadow.normalBias = 0.05; 
        this.dirLight.shadow.radius = 2; // Radius menor é mais barato
        
        this.scene.add(this.dirLight);
        this.scene.add(this.dirLight.target); // Importante: Adicionar o target à cena ajuda o Three.js a calcular a matriz

        this.sunDirection.copy(this.dirLight.position).normalize();
        this.skyUniforms.uSunPos.value.copy(this.sunDirection);
    }

    public setShadowQuality(isHigh: boolean) {
        // Método chamado pelo Engine.ts ao mudar gráficos
        const size = isHigh ? 2048 : 1024;
        
        if (this.dirLight.shadow.mapSize.width !== size) {
            this.dirLight.shadow.mapSize.width = size;
            this.dirLight.shadow.mapSize.height = size;
            this.dirLight.shadow.map?.dispose(); // Limpa a textura velha da GPU
            this.dirLight.shadow.map = null as any; 
        }
    }

    private initLensFlare() {
        // Cache textures para não recriar
        const texGlow = TextureGenerator.createLensGlow(256);
        const texHex = TextureGenerator.createLensHex(256);
        const texRing = TextureGenerator.createLensRing(256);

        const lensflare = new Lensflare();

        lensflare.addElement(new LensflareElement(texGlow, 500, 0, new THREE.Color(0xffffee)));
        lensflare.addElement(new LensflareElement(texGlow, 1000, 0, new THREE.Color(0xffaa00), 0.1)); 

        lensflare.addElement(new LensflareElement(texHex, 60, 0.6, new THREE.Color(0xffaaee).multiplyScalar(0.5))); 
        lensflare.addElement(new LensflareElement(texRing, 400, 0.7, new THREE.Color(0x88ccff).multiplyScalar(0.2))); 

        lensflare.addElement(new LensflareElement(texHex, 80, 0.8, new THREE.Color(0x44ff88).multiplyScalar(0.3))); 
        lensflare.addElement(new LensflareElement(texHex, 120, 0.9, new THREE.Color(0x8844ff).multiplyScalar(0.3))); 
        lensflare.addElement(new LensflareElement(texHex, 70, 1.0, new THREE.Color(0x00ccff).multiplyScalar(0.4))); 

        this.flareAnchor = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshBasicMaterial({ visible: false }));
        // OTIMIZAÇÃO: Desligar auto update já que movemos manualmente no update()
        this.flareAnchor.matrixAutoUpdate = false; 
        this.flareAnchor.frustumCulled = false; // Nunca deixa o sol sumir se virar a câmera rápido

        this.flareAnchor.position.copy(this.sunDirection).multiplyScalar(4000); 
        this.flareAnchor.updateMatrix(); // Update inicial manual
        this.flareAnchor.add(lensflare);
        
        this.scene.add(this.flareAnchor);
    }

    private initSky() {
        this.scene.fog = new THREE.FogExp2(this.SKY_HORIZON_COLOR.getHex(), 0.0006); 
        this.scene.background = this.SKY_HORIZON_COLOR;

        const cloudTex = TextureGenerator.createCloudNoise(512); 
        this.skyUniforms.tNoise.value = cloudTex;

        const geo = new THREE.SphereGeometry(2000, 32, 16); // Reduzi segmentos (64->32), esfera gigante não precisa de tanto
        
        const vertShader = `
            varying vec2 vUv;
            varying vec3 vWorldPosition;
            void main() {
                vUv = uv;
                vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                vWorldPosition = worldPosition.xyz;
                gl_Position = projectionMatrix * viewMatrix * worldPosition;
            }
        `;

        const fragShader = `
            uniform float uTime;
            uniform sampler2D tNoise;
            uniform vec3 uSunPos;
            
            varying vec2 vUv;
            varying vec3 vWorldPosition;
            
            vec3 topColor = vec3(${this.SKY_TOP_COLOR.r}, ${this.SKY_TOP_COLOR.g}, ${this.SKY_TOP_COLOR.b});
            vec3 horizonColor = vec3(${this.SKY_HORIZON_COLOR.r}, ${this.SKY_HORIZON_COLOR.g}, ${this.SKY_HORIZON_COLOR.b});
            vec3 cloudColor = vec3(${this.CLOUD_COLOR.r}, ${this.CLOUD_COLOR.g}, ${this.CLOUD_COLOR.b});

            void main() {
                vec3 dir = normalize(vWorldPosition);
                float h = max(0.001, dir.y);
                
                float horizonBlend = pow(1.0 - h, 2.5); 
                vec3 sky = mix(topColor, horizonColor, horizonBlend);

                vec2 uv = dir.xz / (h + 0.1) * 0.4; 
                vec2 uv1 = uv + vec2(uTime * 0.003, uTime * 0.001);
                vec2 uv2 = uv * 1.3 + vec2(uTime * 0.004, -uTime * 0.002);

                float n1 = texture2D(tNoise, uv1).r;
                float n2 = texture2D(tNoise, uv2).r;
                float noise = n1 * 0.5 + n2 * 0.5;
                
                float density = smoothstep(0.3, 0.8, noise);
                
                float mask = smoothstep(0.05, 0.25, h); 
                density *= mask;

                float sunDot = max(0.0, dot(dir, normalize(uSunPos)));
                sunDot = min(sunDot, 0.999);

                float sunHalo = pow(sunDot, 12.0) * 0.6; 
                sky += vec3(1.0, 0.95, 0.8) * sunHalo; 

                float cloudSun = pow(sunDot, 16.0);
                vec3 litCloudColor = mix(cloudColor, vec3(1.0, 0.98, 0.9), cloudSun * 0.4);
                vec3 finalColor = mix(sky, litCloudColor, density * 0.95);

                gl_FragColor = vec4(finalColor, 1.0);
            }
        `;

        const mat = new THREE.ShaderMaterial({
            uniforms: this.skyUniforms,
            vertexShader: vertShader,
            fragmentShader: fragShader,
            side: THREE.BackSide, 
            depthWrite: false,    
            fog: false            
        });

        this.skyMesh = new THREE.Mesh(geo, mat);
        // OTIMIZAÇÃO: Matriz manual também
        this.skyMesh.matrixAutoUpdate = false;
        this.scene.add(this.skyMesh);
    }

    public update(dt: number, playerPos: THREE.Vector3) {
        // --- SHADOW STABILIZATION (CSM FAKE) ---
        if (this.dirLight) {
            const offsetDist = 150; // Distância da luz em relação ao player
            const targetX = playerPos.x + 80;
            const targetZ = playerPos.z + 120;
            
            // Otimização: Texel Size constante (já que o mapa é quadrado)
            // 2 * d / mapSize
            const frustumSize = this.shadowCamSize * 2;
            const texelSize = frustumSize / this.dirLight.shadow.mapSize.width;

            // Snapping para evitar "Shadow Swimming" (cintilação)
            const snappedX = Math.floor(targetX / texelSize) * texelSize;
            const snappedZ = Math.floor(targetZ / texelSize) * texelSize;

            this.dirLight.position.x = snappedX;
            this.dirLight.position.z = snappedZ;
            
            // Move o target da luz também
            this.dirLight.target.position.set(snappedX - 80, playerPos.y, snappedZ - 120);
            this.dirLight.target.updateMatrixWorld();
        }

        // Move o céu junto com o jogador para criar ilusão de infinito
        if (this.skyMesh) {
            this.skyMesh.position.copy(playerPos);
            this.skyMesh.updateMatrix(); // Update manual
        }

        // O Flare Anchor deve seguir o player, mas manter a distância relativa ao sol
        if (this.flareAnchor) {
            const anchorPos = playerPos.clone().add(this.sunDirection.clone().multiplyScalar(4000));
            this.flareAnchor.position.copy(anchorPos);
            this.flareAnchor.updateMatrix(); // Update manual
        }

        this.skyUniforms.uTime.value += dt;
    }
}