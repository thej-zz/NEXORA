/* ==========================================================================
   core.js — AI Core: central glowing sphere, orbital rings, particle shell,
   energy arcs, and shockwave effects
   ========================================================================== */

import * as THREE from 'three';

/* ---------- GLSL — Core Sphere Shader ---------- */

const coreVertexShader = /* glsl */`
    varying vec3 vNormal;
    varying vec3 vViewDir;
    varying vec2 vUv;
    
    void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(-mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
    }
`;

const coreFragmentShader = /* glsl */`
    uniform float uTime;
    uniform float uIntensity;
    uniform vec3  uColorA;
    uniform vec3  uColorB;
    
    varying vec3 vNormal;
    varying vec3 vViewDir;
    varying vec2 vUv;
    
    void main() {
        // Fresnel effect — bright edges
        float fresnel = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 3.0);
        
        // Pulsing energy
        float pulse = 0.7 + 0.3 * sin(uTime * 0.002);
        
        // Animated noise-like pattern
        float pattern = sin(vUv.x * 12.0 + uTime * 0.001) *
                        cos(vUv.y * 10.0 - uTime * 0.0008) * 0.5 + 0.5;
        
        vec3 color = mix(uColorA, uColorB, pattern * 0.5 + fresnel * 0.3);
        float alpha = (fresnel * 0.8 + 0.15) * pulse * uIntensity;
        
        // Core brightness at center
        float coreGlow = smoothstep(0.6, 0.0, fresnel) * 0.3;
        color += vec3(coreGlow);
        
        gl_FragColor = vec4(color, alpha);
    }
`;

/* ---------- State ---------- */

let coreGroup;
let coreSphere, coreGlow;
let orbitalRings = [];
let shellParticles;
let shockwaveMesh;

let coreState = {
    visible: false,
    scale: 0,
    intensity: 0,
    rotationSpeed: 0.3,
    activated: false
};

/* ---------- Init ---------- */

export function initCore(scene) {
    coreGroup = new THREE.Group();
    coreGroup.visible = false;
    scene.add(coreGroup);

    // --- Central sphere with custom shader ---
    const sphereGeo = new THREE.SphereGeometry(3, 64, 64);
    const sphereMat = new THREE.ShaderMaterial({
        vertexShader:   coreVertexShader,
        fragmentShader: coreFragmentShader,
        uniforms: {
            uTime:      { value: 0 },
            uIntensity: { value: 0 },
            uColorA:    { value: new THREE.Color(0x6FD8FF) },
            uColorB:    { value: new THREE.Color(0x9682FF) }
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide
    });
    coreSphere = new THREE.Mesh(sphereGeo, sphereMat);
    coreGroup.add(coreSphere);

    // --- Inner glow sphere (additive, larger) ---
    const glowGeo = new THREE.SphereGeometry(4.5, 32, 32);
    const glowMat = new THREE.MeshBasicMaterial({
        color: 0x6FD8FF,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    coreGlow = new THREE.Mesh(glowGeo, glowMat);
    coreGroup.add(coreGlow);

    // --- Orbital rings ---
    const ringTilts = [
        { rx: 0.3, ry: 0,   rz: 0.1 },
        { rx: -0.5, ry: 0.8, rz: -0.2 },
        { rx: 0.1, ry: -0.4, rz: 0.7 }
    ];

    ringTilts.forEach((tilt, idx) => {
        const radius = 5.5 + idx * 1.8;
        const ringGeo = new THREE.RingGeometry(radius, radius + 0.08, 128);
        const ringMat = new THREE.MeshBasicMaterial({
            color: idx % 2 === 0 ? 0x6FD8FF : 0x9682FF,
            transparent: true,
            opacity: 0,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.set(tilt.rx, tilt.ry, tilt.rz);
        ring.userData = { baseRotation: { ...tilt }, speed: 0.2 + idx * 0.15 };
        orbitalRings.push(ring);
        coreGroup.add(ring);
    });

    // --- Particle shell (orbiting particles) ---
    const shellCount = 400;
    const shellPos = new Float32Array(shellCount * 3);
    const shellSizes = new Float32Array(shellCount);
    const shellOpacities = new Float32Array(shellCount);
    const shellPhases = new Float32Array(shellCount);

    for (let i = 0; i < shellCount; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi   = Math.acos(2 * Math.random() - 1);
        const r     = 4.5 + Math.random() * 3;
        shellPos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
        shellPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        shellPos[i * 3 + 2] = r * Math.cos(phi);
        shellSizes[i] = 0.5 + Math.random() * 1.5;
        shellOpacities[i] = 0.3 + Math.random() * 0.7;
        shellPhases[i] = Math.random();
    }

    const shellGeo = new THREE.BufferGeometry();
    shellGeo.setAttribute('position', new THREE.BufferAttribute(shellPos, 3));
    shellGeo.setAttribute('aSize',    new THREE.BufferAttribute(shellSizes, 1));
    shellGeo.setAttribute('aOpacity', new THREE.BufferAttribute(shellOpacities, 1));
    shellGeo.setAttribute('aPhase',   new THREE.BufferAttribute(shellPhases, 1));
    shellGeo.setAttribute('aColor',   new THREE.BufferAttribute(
        new Float32Array(shellCount * 3).fill(0).map((_, idx) => {
            const colors = [0.44, 0.85, 1.0, 0.59, 0.51, 1.0]; // blue, violet
            return colors[idx % 6];
        }), 3
    ));

    // Reuse the same particle shader (import inline)
    const shellMat = new THREE.ShaderMaterial({
        vertexShader: /* glsl */`
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
                float pulse = 0.7 + 0.3 * sin(uTime * 0.002 + aPhase * 6.28);
                vOpacity = aOpacity * pulse * uGlobalOpacity;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = max(aSize * uPixelRatio * (200.0 / -mvPosition.z), 0.5);
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: /* glsl */`
            varying float vOpacity;
            varying vec3  vColor;
            void main() {
                float dist = length(gl_PointCoord - vec2(0.5));
                if (dist > 0.5) discard;
                float glow = exp(-dist * 8.0);
                gl_FragColor = vec4(vColor * (1.0 + glow * 0.4), glow * vOpacity);
            }
        `,
        uniforms: {
            uTime:          { value: 0 },
            uPixelRatio:    { value: Math.min(window.devicePixelRatio, 2) },
            uGlobalOpacity: { value: 0 }
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    shellParticles = new THREE.Points(shellGeo, shellMat);
    coreGroup.add(shellParticles);

    // --- Shockwave ring (hidden until activation) ---
    const shockGeo = new THREE.RingGeometry(0.1, 1, 128);
    const shockMat = new THREE.MeshBasicMaterial({
        color: 0x6FD8FF,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    shockwaveMesh = new THREE.Mesh(shockGeo, shockMat);
    coreGroup.add(shockwaveMesh);
}

/* ---------- Update ---------- */

export function updateCore(time) {
    if (!coreGroup) return;

    // Show/hide based on state
    coreGroup.visible = coreState.visible;
    if (!coreState.visible) return;

    // Scale animation
    const targetScale = coreState.scale;
    coreGroup.scale.lerp(
        new THREE.Vector3(targetScale, targetScale, targetScale),
        0.04
    );

    // Core sphere shader
    coreSphere.material.uniforms.uTime.value = time;
    coreSphere.material.uniforms.uIntensity.value = coreState.intensity;

    // Inner glow
    coreGlow.material.opacity = coreState.intensity * 0.15;
    coreGlow.scale.setScalar(1 + Math.sin(time * 0.001) * 0.08);

    // Rotate orbital rings
    orbitalRings.forEach((ring, i) => {
        const speed = ring.userData.speed * coreState.rotationSpeed;
        ring.rotation.z += speed * 0.01;
        ring.rotation.x += speed * 0.005 * (i % 2 === 0 ? 1 : -1);
        ring.material.opacity = coreState.intensity * (0.3 + 0.1 * Math.sin(time * 0.002 + i));
    });

    // Particle shell rotation
    if (shellParticles) {
        shellParticles.rotation.y += 0.002 * coreState.rotationSpeed;
        shellParticles.rotation.x += 0.001 * coreState.rotationSpeed;
        shellParticles.material.uniforms.uTime.value = time;
        shellParticles.material.uniforms.uGlobalOpacity.value = coreState.intensity * 0.8;
    }

    // Subtle whole-group rotation
    coreGroup.rotation.y += 0.001;
}

/* ---------- Phase Controls ---------- */

/**
 * Begin forming the core (called during Scene 3)
 */
export function showCore() {
    coreState.visible = true;
    coreState.scale = 0.01;
    coreState.intensity = 0;
}

/**
 * Animate core scale and intensity
 */
export function setCoreIntensity(val) {
    coreState.intensity = val;
    coreState.scale = 0.5 + val * 0.5;
}

/**
 * Full activation — massive energy release
 */
export function activateCore() {
    coreState.activated = true;
    coreState.intensity = 1.5;
    coreState.rotationSpeed = 2.0;

    // Expand shockwave
    if (shockwaveMesh) {
        shockwaveMesh.material.opacity = 0.8;
        shockwaveMesh.scale.set(0.1, 0.1, 0.1);
    }
}

/**
 * Update shockwave expansion (called in animate loop after activation)
 */
export function updateShockwave(deltaTime) {
    if (!shockwaveMesh || !coreState.activated) return;
    
    if (shockwaveMesh.material.opacity > 0.01) {
        const currentScale = shockwaveMesh.scale.x;
        shockwaveMesh.scale.setScalar(currentScale + deltaTime * 40);
        shockwaveMesh.material.opacity *= 0.96;
    }
}

/**
 * Settle core for final state
 */
export function settleCore() {
    coreState.intensity = 0.3;
    coreState.rotationSpeed = 0.15;
    coreState.scale = 0.4;
}

/**
 * Hide core for final logo focus
 */
export function fadeOutCore() {
    coreState.intensity = 0;
    coreState.scale = 0.01;
    setTimeout(() => {
        coreState.visible = false;
    }, 2000);
}
