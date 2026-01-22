
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { FSRShader } from './shaders/FSRShader';
import { FSRMode } from '../types';

export class FSRSystem {
    private renderer: THREE.WebGLRenderer;
    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;
    public composer: EffectComposer;
    
    // Passes
    private renderPass: RenderPass;
    private ssaoPass: SSAOPass;
    private bloomPass: UnrealBloomPass;
    private fsrPass: ShaderPass;
    private fxaaPass: ShaderPass;
    private outputPass: OutputPass;

    public currentMode: FSRMode = 'OFF';

    constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        
        const width = window.innerWidth;
        const height = window.innerHeight;

        // --- CRITICAL: DEPTH TEXTURE SETUP ---
        // SSAO requires a DepthTexture. Standard Composer doesn't always provide it reliably.
        // We manually create a RenderTarget with depth buffer enabled.
        const pixelRatio = renderer.getPixelRatio();
        const renderTarget = new THREE.WebGLRenderTarget(width * pixelRatio, height * pixelRatio, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            type: THREE.HalfFloatType, // High precision for HDR Bloom
            depthTexture: new THREE.DepthTexture(width * pixelRatio, height * pixelRatio), // REQUIRED for SSAO
            depthBuffer: true
        });

        this.composer = new EffectComposer(renderer, renderTarget);

        // 1. Render Pass (Base Scene)
        this.renderPass = new RenderPass(scene, camera);
        this.composer.addPass(this.renderPass);

        // 2. SSAO (Ambient Occlusion) - Adds contact shadows
        this.ssaoPass = new SSAOPass(scene, camera, width, height);
        this.ssaoPass.kernelRadius = 16;
        this.ssaoPass.minDistance = 0.005;
        this.ssaoPass.maxDistance = 0.1;
        // Adjust visual style
        this.ssaoPass.output = 0; // Default (SSAO + Scene)
        this.ssaoPass.lumInfluence = 0.7; // How much lighting affects AO
        this.composer.addPass(this.ssaoPass);

        // 3. Bloom (Glow effects)
        // Resolution, Strength, Radius, Threshold
        this.bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.6, 0.4, 0.8);
        this.composer.addPass(this.bloomPass);

        // 4. FSR Pass (Upscaling & Sharpening - CAS)
        this.fsrPass = new ShaderPass(FSRShader);
        this.fsrPass.enabled = false;
        this.composer.addPass(this.fsrPass);

        // 5. FXAA (Final Anti-Aliasing)
        // Placed after FSR to smooth out any over-sharpening artifacts
        this.fxaaPass = new ShaderPass(FXAAShader);
        
        // FIX: Ensure valid initial resolution to avoid X4000 warning
        const safeW = Math.max(1, width * pixelRatio);
        const safeH = Math.max(1, height * pixelRatio);
        this.fxaaPass.uniforms['resolution'].value.x = 1 / safeW;
        this.fxaaPass.uniforms['resolution'].value.y = 1 / safeH;
        
        this.composer.addPass(this.fxaaPass);

        // 6. Output (Tone Mapping & sRGB Conversion)
        this.outputPass = new OutputPass();
        this.composer.addPass(this.outputPass);

        // Initialize with default window size
        this.resize(width, height);
    }

    public setMode(mode: FSRMode) {
        this.currentMode = mode;
        const width = window.innerWidth;
        const height = window.innerHeight;
        
        // Base Pixel Ratio (Capped for performance)
        const basePixelRatio = Math.min(window.devicePixelRatio, 1.5);

        let scale = 1.0;
        let sharpness = 0.0;

        // FSR 1.0 Scaling Table
        switch (mode) {
            case 'OFF': scale = 1.0; break;
            case 'ULTRA_QUALITY': scale = 0.77; sharpness = 0.2; break;
            case 'QUALITY': scale = 0.67; sharpness = 0.4; break;
            case 'BALANCED': scale = 0.59; sharpness = 0.6; break;
            case 'PERFORMANCE': scale = 0.50; sharpness = 0.8; break;
        }

        // Calculate internal resolution
        const effectiveRatio = basePixelRatio * scale;
        const effectiveWidth = Math.floor(width * effectiveRatio);
        const effectiveHeight = Math.floor(height * effectiveRatio);
        
        // 1. Adjust Renderer Resolution (Internal Buffer Size)
        this.renderer.setPixelRatio(effectiveRatio);
        
        // 2. Resize Composer (Crucial for FSR upscaling to work)
        this.composer.setSize(effectiveWidth, effectiveHeight);
        
        // 3. Resize SSAO (Must match buffer size to calculate depth correctly)
        if (this.ssaoPass) {
            this.ssaoPass.setSize(effectiveWidth, effectiveHeight);
        }

        // 4. Configure FXAA
        // FXAA needs the size of a texel (1 / resolution)
        const safeW = Math.max(1, effectiveWidth);
        const safeH = Math.max(1, effectiveHeight);
        this.fxaaPass.uniforms['resolution'].value.x = 1 / safeW;
        this.fxaaPass.uniforms['resolution'].value.y = 1 / safeH;

        // 5. Configure FSR Pass
        if (mode !== 'OFF') {
            this.fsrPass.enabled = true;
            this.fsrPass.uniforms['sharpness'].value = sharpness;
            this.fsrPass.uniforms['resolution'].value.set(effectiveWidth, effectiveHeight);
        } else {
            this.fsrPass.enabled = false;
        }

        console.log(`[FSRSystem] Mode: ${mode} | Scale: ${scale.toFixed(2)} | Internal Res: ${effectiveWidth}x${effectiveHeight}`);
    }

    public setRayTracing(enabled: boolean) {
        // Toggle SSAO logic based on "Ray Tracing" setting (simulated)
        if (enabled) {
            this.ssaoPass.enabled = true;
            this.ssaoPass.kernelRadius = 12;
            this.ssaoPass.minDistance = 0.0001;
            this.ssaoPass.maxDistance = 0.08;
        } else {
            // Keep SSAO enabled but lighter/cheaper settings, or disable if performance is critical
            // For now, we assume RT off means Standard Quality, so we keep SSAO but less precise
            this.ssaoPass.enabled = true;
            this.ssaoPass.kernelRadius = 16;
            this.ssaoPass.minDistance = 0.005;
            this.ssaoPass.maxDistance = 0.1;
        }
    }

    public render(dt: number) {
        this.composer.render(dt);
    }

    public resize(width: number, height: number) {
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        
        this.renderer.setSize(width, height);
        
        // Re-apply mode to handle composer resizing and uniforms recalculation
        this.setMode(this.currentMode);
    }

    public dispose() {
        this.composer.dispose();
    }
}
