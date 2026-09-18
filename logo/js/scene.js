/* ==========================================================================
   scene.js — Three.js scene, camera, renderer, and post-processing
   ========================================================================== */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }     from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass }     from 'three/addons/postprocessing/ShaderPass.js';

/* ---------- Exports ---------- */
export let scene, camera, renderer, composer, bloomPass;
export const cameraState = {
    position: new THREE.Vector3(0, 0, 100),
    lookAt:   new THREE.Vector3(0, 0, 0),
    shakeIntensity: 0,
    shakeDecay: 0.92
};

/* ---------- Camera Targets per Phase ---------- */
const CAMERA_TARGETS = {
    darkness:   { pos: new THREE.Vector3(0, 0, 100),  look: new THREE.Vector3(0, 0, 0) },
    network:    { pos: new THREE.Vector3(8, 6, 55),    look: new THREE.Vector3(0, 0, -5) },
    core:       { pos: new THREE.Vector3(0, 2, 35),    look: new THREE.Vector3(0, 0, 0) },
    waiting:    { pos: new THREE.Vector3(0, 0, 30),    look: new THREE.Vector3(0, 0, 0) },
    activation: { pos: new THREE.Vector3(0, 0, 28),    look: new THREE.Vector3(0, 0, 0) },
    reveal:     { pos: new THREE.Vector3(0, 0, 22),    look: new THREE.Vector3(0, 0, 0) },
    final:      { pos: new THREE.Vector3(0, 0, 20),    look: new THREE.Vector3(0, 0, 0) }
};

/* ---------- Custom Vignette + Chromatic Aberration Shader ---------- */
const CinematicShader = {
    uniforms: {
        tDiffuse:   { value: null },
        uVignette:  { value: 0.45 },
        uChromatic: { value: 0.0008 },
        uTime:      { value: 0 }
    },
    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform float uVignette;
        uniform float uChromatic;
        uniform float uTime;
        varying vec2 vUv;

        void main() {
            vec2 uv = vUv;
            vec2 center = uv - 0.5;

            // Subtle chromatic aberration
            float r = texture2D(tDiffuse, uv + center * uChromatic).r;
            float g = texture2D(tDiffuse, uv).g;
            float b = texture2D(tDiffuse, uv - center * uChromatic).b;
            vec3 color = vec3(r, g, b);

            // Vignette
            float dist = length(center);
            float vig = smoothstep(0.7, 0.3, dist * uVignette * 2.0);
            color *= mix(0.4, 1.0, vig);

            gl_FragColor = vec4(color, 1.0);
        }
    `
};

let cinematicPass;

/* ---------- Init ---------- */
export function initScene() {
    const container = document.getElementById('canvas-container');

    // Scene
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x020210, 0.008);

    // Camera
    camera = new THREE.PerspectiveCamera(
        60,
        window.innerWidth / window.innerHeight,
        0.1,
        2000
    );
    camera.position.copy(CAMERA_TARGETS.darkness.pos);

    // Renderer
    renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance'
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x030308, 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);

    // Lights
    const ambientLight = new THREE.AmbientLight(0x101030, 0.3);
    scene.add(ambientLight);

    const pointLight1 = new THREE.PointLight(0x6FD8FF, 1.5, 100);
    pointLight1.position.set(0, 0, 20);
    scene.add(pointLight1);

    const pointLight2 = new THREE.PointLight(0x9682FF, 0.8, 80);
    pointLight2.position.set(-15, 10, 10);
    scene.add(pointLight2);

    // Post-processing
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));

    bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.5,   // strength
        0.4,   // radius
        0.85   // threshold
    );
    composer.addPass(bloomPass);

    cinematicPass = new ShaderPass(CinematicShader);
    composer.addPass(cinematicPass);

    // Resize handler
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(handleResize, 100);
    });
}

function handleResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
    bloomPass.resolution.set(w, h);
}

/* ---------- Camera Update ---------- */

let currentCameraTarget = 'darkness';

export function setCameraTarget(phaseName) {
    if (CAMERA_TARGETS[phaseName]) {
        currentCameraTarget = phaseName;
    }
}

export function triggerCameraShake(intensity = 0.8) {
    cameraState.shakeIntensity = intensity;
}

export function updateScene(time, deltaTime) {
    const target = CAMERA_TARGETS[currentCameraTarget];
    if (!target) return;

    // Smooth camera position interpolation
    const lerpSpeed = 0.015;
    cameraState.position.lerp(target.pos, lerpSpeed);
    cameraState.lookAt.lerp(target.look, lerpSpeed);

    // Subtle camera float (cinematic breathing)
    const floatX = Math.sin(time * 0.0003) * 0.3;
    const floatY = Math.cos(time * 0.00025) * 0.2;

    camera.position.set(
        cameraState.position.x + floatX,
        cameraState.position.y + floatY,
        cameraState.position.z
    );

    // Camera shake
    if (cameraState.shakeIntensity > 0.01) {
        camera.position.x += (Math.random() - 0.5) * cameraState.shakeIntensity;
        camera.position.y += (Math.random() - 0.5) * cameraState.shakeIntensity;
        cameraState.shakeIntensity *= cameraState.shakeDecay;
    }

    camera.lookAt(cameraState.lookAt);

    // Update cinematic shader time
    if (cinematicPass) {
        cinematicPass.uniforms.uTime.value = time * 0.001;
    }
}

/* ---------- Bloom Control ---------- */

export function setBloomStrength(val) {
    if (bloomPass) bloomPass.strength = val;
}

export function setBloomThreshold(val) {
    if (bloomPass) bloomPass.threshold = val;
}

export function setChromaticAberration(val) {
    if (cinematicPass) cinematicPass.uniforms.uChromatic.value = val;
}

/* ---------- Render ---------- */

export function render() {
    composer.render();
}
