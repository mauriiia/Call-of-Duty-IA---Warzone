
import { Vector2 } from 'three';

/**
 * FSR 1.0 Style Shader (CAS - Contrast Adaptive Sharpening)
 * Adaptado para WebGL/Three.js
 * 
 * Used to sharpen the image after FXAA blur and Upscaling.
 */
export const FSRShader = {
    uniforms: {
        "tDiffuse": { value: null },
        "resolution": { value: new Vector2() },
        "sharpness": { value: 0.5 } // 0.0 (Smooth) to 1.0 (Sharp)
    },

    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,

    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec2 resolution;
        uniform float sharpness;
        varying vec2 vUv;

        // Luma helper
        float getLuma(vec3 rgb) {
            return dot(rgb, vec3(0.299, 0.587, 0.114));
        }

        void main() {
            vec2 texel = 1.0 / resolution;
            vec3 color = texture2D(tDiffuse, vUv).rgb;

            // Sample direct neighbors (North, South, West, East)
            vec3 colorN = texture2D(tDiffuse, vUv + vec2(0.0, -texel.y)).rgb;
            vec3 colorS = texture2D(tDiffuse, vUv + vec2(0.0, texel.y)).rgb;
            vec3 colorW = texture2D(tDiffuse, vUv + vec2(-texel.x, 0.0)).rgb;
            vec3 colorE = texture2D(tDiffuse, vUv + vec2(texel.x, 0.0)).rgb;

            // Calculate Luma for contrast check
            float luma = getLuma(color);
            float lumaN = getLuma(colorN);
            float lumaS = getLuma(colorS);
            float lumaW = getLuma(colorW);
            float lumaE = getLuma(colorE);

            // Local Contrast
            float minLuma = min(luma, min(min(lumaN, lumaS), min(lumaW, lumaE)));
            float maxLuma = max(luma, max(max(lumaN, lumaS), max(lumaW, lumaE)));
            float contrast = maxLuma - minLuma;

            // Adaptive Sharpening Logic
            // High contrast areas (edges) get less sharpening to avoid artifacts.
            // Low/Medium contrast areas (textures) get more sharpening.
            float amount = 2.0 * sharpness * (1.0 - smoothstep(0.0, 0.3, contrast));
            
            // Apply sharpening kernel
            vec3 sharpened = color + (color - (colorN + colorS + colorW + colorE) * 0.25) * amount;

            gl_FragColor = vec4(sharpened, 1.0);
        }
    `
};
