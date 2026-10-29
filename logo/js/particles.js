/* ==========================================================================
   particles.js — Background particle systems (stars, dust, energy, atmosphere)
   Uses BufferGeometry + custom ShaderMaterial for performance
   ========================================================================== */

import * as THREE from 'three';

/* ---------- GLSL Shaders ---------- */

const vertexShader = /* glsl */`
    attribute float aSize;
    attribute float aOpacity;
    attribute float aPhase;
    attribute vec3  aColor;
    
    uniform float uTime;
    uniform float uPixelRatio;
    uniform float uGlobalOpacity;
    
    varying float vOpacity;
    varying vec3  vColor;
    
    void main() {
        vColor = aColor;
        
        // Pulsing based on individual phase offset
        float pulse = 0.8 + 0.2 * sin(uTime * 0.001 + aPhase * 6.28);
        vOpacity = aOpacity * pulse * uGlobalOpacity;
        
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        float sizeAtten = uPixelRatio * (200.0 / -mvPosition.z);
        gl_PointSize = max(aSize * sizeAtten, 0.5);
        gl_Position = projectionMatrix * mvPosition;
    }
`;

const fragmentShader = /* glsl */`
    varying float vOpacity;
    varying vec3  vColor;
    
    void main() {
        float dist = length(gl_PointCoord - vec2(0.5));
        if (dist > 0.5) discard;
        
        // Soft glow falloff
        float glow = exp(-dist * 8.0);
        float alpha = glow * vOpacity;
        
        // Slight color brightening at center
        vec3 col = vColor * (1.0 + glow * 0.4);
        
        gl_FragColor = vec4(col, alpha);
    }
`;

/* ---------- Particle System Class ---------- */

class ParticleSystem {
    constructor(scene, count, config = {}) {
        this.count = count;
        this.config = config;
        this.scene = scene;

        // Typed arrays
        this.positions  = new Float32Array(count * 3);
        this.velocities = new Float32Array(count * 3);
        this.sizes      = new Float32Array(count);
        this.opacities  = new Float32Array(count);
        this.phases     = new Float32Array(count);
        this.colors     = new Float32Array(count * 3);

        // Target positions (for logo morph)
        this.targetPositions = null;
        this.morphProgress = 0;

        this._initParticles();
        this._createMesh();
    }

    _initParticles() {
        const { spread = 100, sizeRange = [0.5, 2], colorPalette } = this.config;
        const blue   = new THREE.Color(0x6FD8FF);
        const violet = new THREE.Color(0x9682FF);
        const white  = new THREE.Color(0xCCDDFF);

        for (let i = 0; i < this.count; i++) {
            const i3 = i * 3;

            // Random position in sphere
            const theta = Math.random() * Math.PI * 2;
            const phi   = Math.acos(2 * Math.random() - 1);
            const r     = Math.random() * spread;
            this.positions[i3]     = r * Math.sin(phi) * Math.cos(theta);
            this.positions[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            this.positions[i3 + 2] = r * Math.cos(phi);

            // Random velocity (very slow drift)
            this.velocities[i3]     = (Math.random() - 0.5) * 0.02;
            this.velocities[i3 + 1] = (Math.random() - 0.5) * 0.02;
            this.velocities[i3 + 2] = (Math.random() - 0.5) * 0.02;

            // Size
            this.sizes[i] = sizeRange[0] + Math.random() * (sizeRange[1] - sizeRange[0]);

            // Opacity
            this.opacities[i] = 0.1 + Math.random() * 0.6;

            // Phase offset for pulsing
            this.phases[i] = Math.random();

            // Color from palette
            let c;
            if (colorPalette === 'blue') {
                c = blue.clone().lerp(white, Math.random() * 0.3);
            } else if (colorPalette === 'violet') {
                c = violet.clone().lerp(blue, Math.random() * 0.5);
            } else {
                // Default: mix
                const mix = Math.random();
                c = mix < 0.5
                    ? blue.clone().lerp(white, Math.random() * 0.4)
                    : violet.clone().lerp(blue, Math.random() * 0.4);
            }
            this.colors[i3]     = c.r;
            this.colors[i3 + 1] = c.g;
            this.colors[i3 + 2] = c.b;
        }
    }

    _createMesh() {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
        geo.setAttribute('aSize',    new THREE.BufferAttribute(this.sizes, 1));
        geo.setAttribute('aOpacity', new THREE.BufferAttribute(this.opacities, 1));
        geo.setAttribute('aPhase',   new THREE.BufferAttribute(this.phases, 1));
        geo.setAttribute('aColor',   new THREE.BufferAttribute(this.colors, 3));

        const mat = new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader,
            uniforms: {
                uTime:          { value: 0 },
                uPixelRatio:    { value: Math.min(window.devicePixelRatio, 2) },
                uGlobalOpacity: { value: 0 }
            },
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });

        this.mesh = new THREE.Points(geo, mat);
        this.geometry = geo;
        this.material = mat;
        this.scene.add(this.mesh);
    }

    setGlobalOpacity(val) {
        this.material.uniforms.uGlobalOpacity.value = val;
    }

    /**
     * Standard drift update — particles float around slowly
     */
    update(time) {
        this.material.uniforms.uTime.value = time;

        const pos = this.geometry.attributes.position.array;
        const vel = this.velocities;

        for (let i = 0; i < this.count; i++) {
            const i3 = i * 3;

            if (this.targetPositions && this.morphProgress > 0) {
                // Lerp toward target
                const t = this.morphProgress;
                pos[i3]     += (this.targetPositions[i3]     - pos[i3])     * t * 0.03;
                pos[i3 + 1] += (this.targetPositions[i3 + 1] - pos[i3 + 1]) * t * 0.03;
                pos[i3 + 2] += (this.targetPositions[i3 + 2] - pos[i3 + 2]) * t * 0.03;
            } else {
                // Free drift
                pos[i3]     += vel[i3];
                pos[i3 + 1] += vel[i3 + 1];
                pos[i3 + 2] += vel[i3 + 2];
            }
        }
        this.geometry.attributes.position.needsUpdate = true;
    }

    /**
     * Converge all particles toward a single point
     */
    convergeToCenter(center, strength = 0.01) {
        const pos = this.geometry.attributes.position.array;
        for (let i = 0; i < this.count; i++) {
            const i3 = i * 3;
            pos[i3]     += (center.x - pos[i3])     * strength;
            pos[i3 + 1] += (center.y - pos[i3 + 1]) * strength;
            pos[i3 + 2] += (center.z - pos[i3 + 2]) * strength;
        }
        this.geometry.attributes.position.needsUpdate = true;
    }

    dispose() {
        this.scene.remove(this.mesh);
        this.geometry.dispose();
        this.material.dispose();
    }
}

/* ---------- Exported Systems ---------- */

let stars, dust, energy, atmosphere;

export function initParticles(scene) {
    stars = new ParticleSystem(scene, 3000, {
        spread: 200,
        sizeRange: [0.3, 1.5],
        colorPalette: 'blue'
    });

    dust = new ParticleSystem(scene, 2000, {
        spread: 80,
        sizeRange: [0.2, 1.0],
        colorPalette: 'violet'
    });

    energy = new ParticleSystem(scene, 1500, {
        spread: 60,
        sizeRange: [0.8, 2.5],
        colorPalette: 'blue'
    });

    atmosphere = new ParticleSystem(scene, 800, {
        spread: 40,
        sizeRange: [0.5, 1.8],
        colorPalette: 'violet'
    });

    // Initially all hidden
    stars.setGlobalOpacity(0);
    dust.setGlobalOpacity(0);
    energy.setGlobalOpacity(0);
    atmosphere.setGlobalOpacity(0);
}

export function updateParticles(time) {
    if (stars)      stars.update(time);
    if (dust)       dust.update(time);
    if (energy)     energy.update(time);
    if (atmosphere) atmosphere.update(time);
}

/* ---------- Phase Controls ---------- */

/**
 * Scene 1 — Darkness: gradually reveal stars and faint dust
 */
export function fadeInStars(progress) {
    // progress: 0 → 1 over ~4 seconds
    if (stars) stars.setGlobalOpacity(progress * 0.6);
    if (dust)  dust.setGlobalOpacity(progress * 0.2);
    if (atmosphere) atmosphere.setGlobalOpacity(progress * 0.1);
}

/**
 * Scene 2 — Network: more particles visible
 */
export function setNetworkPhase() {
    if (stars) stars.setGlobalOpacity(0.5);
    if (dust)  dust.setGlobalOpacity(0.4);
    if (atmosphere) atmosphere.setGlobalOpacity(0.3);
}

/**
 * Scene 3 — Core forming: energy particles converge
 */
export function setCorePhase() {
    if (energy) energy.setGlobalOpacity(0.5);
}

/**
 * Activation: energy burst
 */
export function activationBurst() {
    if (energy) energy.setGlobalOpacity(1.0);
    if (stars)  stars.setGlobalOpacity(0.8);
    if (dust)   dust.setGlobalOpacity(0.6);
    if (atmosphere) atmosphere.setGlobalOpacity(0.5);
}

/**
 * Converge energy particles toward center during activation
 */
export function convergeEnergy(center) {
    if (energy) energy.convergeToCenter(center, 0.015);
}

/**
 * Settle to idle state for final reveal
 */
export function setFinalPhase() {
    if (stars) stars.setGlobalOpacity(0.35);
    if (dust)  dust.setGlobalOpacity(0.2);
    if (energy) energy.setGlobalOpacity(0.15);
    if (atmosphere) atmosphere.setGlobalOpacity(0.2);
}

export { stars, dust, energy, atmosphere };
