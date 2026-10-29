/* ==========================================================================
   logo.js — Logo pixel sampling and particle reconstruction system
   Samples nexo.jpeg to create target positions for particles
   ========================================================================== */

import * as THREE from 'three';

/* ---------- Configuration ---------- */
const LOGO_PARTICLE_COUNT = 5000;
const LOGO_SCALE = 18;   // World-space scale of reconstructed logo
const SAMPLE_THRESHOLD = 100;  // Alpha threshold for pixel sampling

/* ---------- GLSL for Logo Particles ---------- */

const logoVertexShader = /* glsl */`
    attribute float aSize;
    attribute float aOpacity;
    attribute float aPhase;
    attribute vec3  aColor;
    attribute vec3  aTargetPosition;
    
    uniform float uTime;
    uniform float uPixelRatio;
    uniform float uMorphProgress;
    uniform float uGlobalOpacity;
    
    varying float vOpacity;
    varying vec3  vColor;
    
    void main() {
        vColor = aColor;
        
        // Interpolate between scattered position and target logo position
        vec3 pos = mix(position, aTargetPosition, uMorphProgress);
        
        // Add noise that decreases as morph progresses
        float noise = (1.0 - uMorphProgress) * 2.0;
        pos.x += sin(uTime * 0.001 + aPhase * 10.0) * noise;
        pos.y += cos(uTime * 0.0012 + aPhase * 8.0) * noise;
        pos.z += sin(uTime * 0.0008 + aPhase * 12.0) * noise * 0.5;
        
        float pulse = 0.8 + 0.2 * sin(uTime * 0.003 + aPhase * 6.28);
        vOpacity = aOpacity * pulse * uGlobalOpacity;
        
        // Size increases as particles converge
        float sizeBoost = 1.0 + uMorphProgress * 0.5;
        
        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_PointSize = max(aSize * sizeBoost * uPixelRatio * (200.0 / -mvPosition.z), 0.5);
        gl_Position = projectionMatrix * mvPosition;
    }
`;

const logoFragmentShader = /* glsl */`
    varying float vOpacity;
    varying vec3  vColor;
    
    void main() {
        float dist = length(gl_PointCoord - vec2(0.5));
        if (dist > 0.5) discard;
        
        float glow = exp(-dist * 7.0);
        float alpha = glow * vOpacity;
        vec3 col = vColor * (1.0 + glow * 0.3);
        
        gl_FragColor = vec4(col, alpha);
    }
`;

/* ---------- State ---------- */

let logoMesh, logoGeometry, logoMaterial;
let targetPositions;
let isLoaded = false;

/* ---------- Load Logo & Sample Pixels ---------- */

/**
 * Load the logo PNG and sample non-transparent pixels as target positions.
 * Returns a promise that resolves when sampling is complete.
 */
export function loadLogo(logoPath = 'nexo.jpeg') {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            // Scale down for sampling efficiency
            const sampleW = Math.min(img.width, 256);
            const sampleH = Math.round(sampleW * (img.height / img.width));
            canvas.width = sampleW;
            canvas.height = sampleH;
            ctx.drawImage(img, 0, 0, sampleW, sampleH);

            const imageData = ctx.getImageData(0, 0, sampleW, sampleH);
            const pixels = imageData.data;

            // Collect valid pixel positions (where alpha > threshold)
            const validPixels = [];
            for (let y = 0; y < sampleH; y++) {
                for (let x = 0; x < sampleW; x++) {
                    const idx = (y * sampleW + x) * 4;
                    if (pixels[idx + 3] > SAMPLE_THRESHOLD) {
                        // Get color from pixel
                        const r = pixels[idx] / 255;
                        const g = pixels[idx + 1] / 255;
                        const b = pixels[idx + 2] / 255;
                        validPixels.push({ x, y, r, g, b });
                    }
                }
            }

            if (validPixels.length === 0) {
                reject(new Error('No valid pixels found in logo'));
                return;
            }

            // Sample LOGO_PARTICLE_COUNT positions from valid pixels
            targetPositions = new Float32Array(LOGO_PARTICLE_COUNT * 3);
            const particleColors = new Float32Array(LOGO_PARTICLE_COUNT * 3);

            for (let i = 0; i < LOGO_PARTICLE_COUNT; i++) {
                const pixel = validPixels[Math.floor(Math.random() * validPixels.length)];
                const i3 = i * 3;

                // Map pixel coordinates to 3D world space, centered
                const aspect = sampleW / sampleH;
                targetPositions[i3] = ((pixel.x / sampleW) - 0.5) * LOGO_SCALE * aspect;
                targetPositions[i3 + 1] = -((pixel.y / sampleH) - 0.5) * LOGO_SCALE; // flip Y
                targetPositions[i3 + 2] = (Math.random() - 0.5) * 0.5; // slight Z depth

                // Use actual pixel colors, boosted with blue tint
                particleColors[i3] = pixel.r * 0.6 + 0.4 * 0.44;
                particleColors[i3 + 1] = pixel.g * 0.6 + 0.4 * 0.85;
                particleColors[i3 + 2] = pixel.b * 0.6 + 0.4 * 1.0;
            }

            isLoaded = true;
            resolve({ targetPositions, particleColors });
        };
        img.onerror = () => reject(new Error('Failed to load logo image'));
        img.src = logoPath;
    });
}

/* ---------- Create Logo Particle System ---------- */

/**
 * Create the logo particle mesh (called after loadLogo resolves)
 */
export function createLogoParticles(scene, targetPos, particleColors) {
    const count = LOGO_PARTICLE_COUNT;

    // Initial scattered positions (sphere distribution)
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const opacities = new Float32Array(count);
    const phases = new Float32Array(count);

    for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = 15 + Math.random() * 40;
        positions[i3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        positions[i3 + 2] = r * Math.cos(phi);

        sizes[i] = 0.6 + Math.random() * 1.5;
        opacities[i] = 0.4 + Math.random() * 0.6;
        phases[i] = Math.random();
    }

    logoGeometry = new THREE.BufferGeometry();
    logoGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    logoGeometry.setAttribute('aTargetPosition', new THREE.BufferAttribute(targetPos, 3));
    logoGeometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    logoGeometry.setAttribute('aOpacity', new THREE.BufferAttribute(opacities, 1));
    logoGeometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    logoGeometry.setAttribute('aColor', new THREE.BufferAttribute(particleColors, 3));

    logoMaterial = new THREE.ShaderMaterial({
        vertexShader: logoVertexShader,
        fragmentShader: logoFragmentShader,
        uniforms: {
            uTime: { value: 0 },
            uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
            uMorphProgress: { value: 0 },
            uGlobalOpacity: { value: 0 }
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    logoMesh = new THREE.Points(logoGeometry, logoMaterial);
    scene.add(logoMesh);
}

/* ---------- Update ---------- */

export function updateLogoParticles(time) {
    if (!logoMaterial) return;
    logoMaterial.uniforms.uTime.value = time;
}

/* ---------- Controls ---------- */

/**
 * Set morph progress (0 = scattered, 1 = logo shape)
 */
export function setMorphProgress(val) {
    if (logoMaterial) {
        logoMaterial.uniforms.uMorphProgress.value = Math.min(1, Math.max(0, val));
    }
}

/**
 * Set visibility of logo particles
 */
export function setLogoParticleOpacity(val) {
    if (logoMaterial) {
        logoMaterial.uniforms.uGlobalOpacity.value = val;
    }
}

/**
 * Fade out logo particles (after actual logo image is shown)
 */
export function fadeOutLogoParticles() {
    if (logoMaterial) {
        logoMaterial.uniforms.uGlobalOpacity.value = 0;
    }
}

export function isLogoLoaded() {
    return isLoaded;
}
