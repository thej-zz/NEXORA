/* ==========================================================================
   launch.js — Main orchestrator & state machine
   Coordinates all modules: scene, particles, neural network, core, logo,
   gestures, HUD, and audio into a cinematic reveal experience.
   ========================================================================== */

import * as THREE from 'three';

// --- Module imports ---
import {
    initScene, scene, camera, renderer, composer,
    updateScene, render, setCameraTarget, triggerCameraShake,
    setBloomStrength, setBloomThreshold, setChromaticAberration
} from './scene.js';

import {
    initParticles, updateParticles,
    fadeInStars, setNetworkPhase, setCorePhase,
    activationBurst, convergeEnergy, setFinalPhase
} from './particles.js';

import {
    initNeuralNetwork, updateNeuralNetwork,
    setNetworkActivation, setCollapseProgress,
    flashNetwork, dimNetwork
} from './neural-network.js';

import {
    initCore, updateCore, updateShockwave,
    showCore, setCoreIntensity, activateCore,
    settleCore, fadeOutCore
} from './core.js';

import {
    loadLogo, createLogoParticles, updateLogoParticles,
    setMorphProgress, setLogoParticleOpacity, fadeOutLogoParticles
} from './logo.js';

import {
    initGestures, updateHandVisualization,
    disableGestures, isGestureSystemActive, cleanupGestures
} from './gestures.js';

import {
    initHUD,
    setSystemStatus, setGestureStatus, setActivationStatus, disableButton,
    createDarknessTimeline, createNetworkTimeline,
    createCoreTimeline, createRevealTimeline,
    showGesturePanel
} from './hud.js';

import {
    initAudio, playActivationSound, playPulseSound, playRevealSound
} from './audio.js';

/* ==========================================================================
   STATE MACHINE
   ========================================================================== */

const state = {
    phase: 'init',         // init → darkness → network → core → waiting → activation → reveal → final
    revealStarted: false,
    revealCompleted: false,
    handDetected: false,
    gestureReady: false,
    mediaPipeActive: false,
    startTime: 0,
    initialized: false
};

// Animation state values (animated by Anime.js, read by Three.js)
const animState = {
    networkActivation: 0,
    collapseProgress: 0,
    coreIntensity: 0,
    logoMorphProgress: 0,
    logoOpacity: 0,
    bloomStrength: 0.5,
    chromaticAberration: 0.0008
};

/* ==========================================================================
   PHASE TIMELINES
   ========================================================================== */

let darknessTimeline, networkTimeline, coreTimeline, revealTimeline;

/* ==========================================================================
   PHASE TRANSITIONS
   ========================================================================== */

const PHASE_TIMING = {
    darkness: 0,
    network: 4,
    core: 10,
    waiting: 15
};

function setPhase(newPhase) {
    if (state.phase === newPhase) return;
    const prevPhase = state.phase;
    state.phase = newPhase;

    console.log(`[Phase] ${prevPhase} → ${newPhase}`);

    switch (newPhase) {
        case 'darkness':
            setCameraTarget('darkness');
            if (darknessTimeline) darknessTimeline.play();
            break;

        case 'network':
            setCameraTarget('network');
            setNetworkPhase();
            if (networkTimeline) networkTimeline.play();
            // Animate network activation
            anime({
                targets: animState,
                networkActivation: 1,
                duration: 5000,
                easing: 'easeInOutCubic'
            });
            break;

        case 'core':
            setCameraTarget('core');
            showCore();
            setCorePhase();
            if (coreTimeline) coreTimeline.play();
            // Animate core formation
            anime({
                targets: animState,
                coreIntensity: 1,
                collapseProgress: 0.5,
                duration: 4000,
                easing: 'easeInOutCubic'
            });
            // Start logo particles visible (scattered)
            anime({
                targets: animState,
                logoOpacity: 0.3,
                duration: 3000,
                easing: 'easeInOutQuad'
            });
            break;

        case 'waiting':
            setCameraTarget('waiting');
            setBloomStrength(0.4);
            // Start gesture detection
            startGestureDetection();
            break;
    }
}

/* ==========================================================================
   GESTURE DETECTION
   ========================================================================== */

async function startGestureDetection() {
    showGesturePanel();

    const success = await initGestures(scene, {
        onHandDetected: () => {
            state.handDetected = true;
            setGestureStatus('HAND DETECTED');
            setActivationStatus('GESTURE CONTROL ACTIVE');
            playPulseSound();
        },
        onHandLost: () => {
            state.handDetected = false;
            setGestureStatus('SCANNING...');
        },
        onPinch: () => {
            if (!state.revealStarted) {
                setGestureStatus('PINCH DETECTED');
                launchLogoReveal();
            }
        }
    });

    if (success) {
        state.mediaPipeActive = true;
        setGestureStatus('GESTURE SYSTEM READY');
        setActivationStatus('GESTURE CONTROL ACTIVE');
    } else {
        state.mediaPipeActive = false;
        setGestureStatus('MANUAL MODE');
        setActivationStatus('MANUAL ACTIVATION AVAILABLE');
        // Ensure the dot shows offline state
        const dot = document.querySelector('.hud-dot');
        if (dot) dot.classList.add('offline');
    }
}

/* ==========================================================================
   MASTER REVEAL FUNCTION
   ========================================================================== */

/**
 * The single entry point for the logo reveal sequence.
 * Called by: pinch gesture, manual button click, or space key.
 */
function launchLogoReveal() {
    // --- Guard: prevent duplicate launches ---
    if (state.revealStarted) return;
    state.revealStarted = true;
    state.phase = 'activation';

    console.log('[Reveal] LAUNCH INITIATED');

    // --- Initialize audio on user interaction ---
    initAudio();
    playActivationSound();

    // --- Disable inputs ---
    disableGestures();
    disableButton();

    // --- Phase 1: FREEZE (0.3s pause) ---
    // Briefly freeze all animation by not updating Three.js
    let frozen = true;
    setTimeout(() => {
        frozen = false;
        executeActivation();
    }, 300);

    // Store freeze state for animation loop
    state._frozen = true;
    setTimeout(() => { state._frozen = false; }, 300);
}

function executeActivation() {
    // --- Phase 2: ACTIVATION ---
    state.phase = 'activation';
    setCameraTarget('activation');

    // Massive activation effects
    activateCore();
    flashNetwork();
    activationBurst();
    triggerCameraShake(1.2);

    // Bloom burst
    setBloomStrength(1.5);
    setChromaticAberration(0.003);

    // Animate bloom back to normal
    anime({
        targets: animState,
        bloomStrength: 0.6,
        chromaticAberration: 0.001,
        duration: 2000,
        easing: 'easeOutExpo',
        update: () => {
            setBloomStrength(animState.bloomStrength);
            setChromaticAberration(animState.chromaticAberration);
        }
    });

    // --- Phase 3: REVEAL TIMELINE ---
    revealTimeline = createRevealTimeline(
        // onLogoFormStart
        () => {
            state.phase = 'reveal';
            setCameraTarget('reveal');
            playPulseSound();

            // Animate logo particle morph
            anime({
                targets: animState,
                logoMorphProgress: 1,
                logoOpacity: 1,
                duration: 3500,
                easing: 'easeInOutCubic',
                update: () => {
                    setMorphProgress(animState.logoMorphProgress);
                    setLogoParticleOpacity(animState.logoOpacity);
                }
            });

            // Converge energy particles
            anime({
                targets: animState,
                collapseProgress: 1,
                duration: 2000,
                easing: 'easeInOutQuad'
            });

            // Fade out and settle core
            setTimeout(() => {
                settleCore();
                dimNetwork();
            }, 1500);

            setTimeout(() => {
                fadeOutCore();
            }, 2500);
        },
        // onFlash
        () => {
            playRevealSound();
            setBloomStrength(2.0);
            anime({
                targets: animState,
                bloomStrength: 0.3,
                duration: 1500,
                easing: 'easeOutExpo',
                update: () => setBloomStrength(animState.bloomStrength)
            });
            // Fade out logo particles, show actual logo
            fadeOutLogoParticles();
        },
        // onComplete
        () => {
            state.phase = 'final';
            state.revealCompleted = true;
            setCameraTarget('final');
            setFinalPhase();
            setBloomStrength(0.25);
            setChromaticAberration(0.0005);
            console.log('[Reveal] COMPLETE');
        }
    );

    revealTimeline.play();
}

/* ==========================================================================
   ANIMATION LOOP
   ========================================================================== */

let lastTime = 0;

function animate(time) {
    requestAnimationFrame(animate);

    if (!state.initialized) return;

    const deltaTime = Math.min((time - lastTime) / 1000, 0.1);
    lastTime = time;

    // Freeze state during activation pause
    if (state._frozen) {
        render();
        return;
    }

    const elapsed = (time - state.startTime) / 1000;

    // --- Auto phase progression (before reveal) ---
    if (!state.revealStarted) {
        if (elapsed < PHASE_TIMING.network) {
            if (state.phase !== 'darkness') { /* already set */ }
            // Fade in stars progressively
            const progress = elapsed / PHASE_TIMING.network;
            fadeInStars(progress);
        } else if (elapsed < PHASE_TIMING.core) {
            if (state.phase === 'darkness') setPhase('network');
        } else if (elapsed < PHASE_TIMING.waiting) {
            if (state.phase === 'network') setPhase('core');
        } else {
            if (state.phase === 'core') setPhase('waiting');
        }
    }

    // --- Apply animated state values ---
    setNetworkActivation(animState.networkActivation);
    setCollapseProgress(animState.collapseProgress);
    setCoreIntensity(animState.coreIntensity);

    // --- Update all systems ---
    updateScene(time, deltaTime);
    updateParticles(time);
    updateNeuralNetwork(time);
    updateCore(time);
    updateShockwave(deltaTime);
    updateLogoParticles(time);
    updateHandVisualization(time);

    // --- Converge energy during activation ---
    if (state.phase === 'activation' || state.phase === 'reveal') {
        convergeEnergy(new THREE.Vector3(0, 0, 0));
    }

    // --- Render ---
    render();
}

/* ==========================================================================
   INITIALIZATION
   ========================================================================== */

async function init() {
    console.log('[NEXORA] Initializing cinematic launch experience...');

    // Check for reduced motion preference
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
        console.log('[NEXORA] Reduced motion detected — simplified mode');
    }

    // Init HUD
    initHUD();

    // Init Three.js scene
    initScene();

    // Init particle systems
    initParticles(scene);

    // Init neural network
    initNeuralNetwork(scene);

    // Init AI core
    initCore(scene);

    // Load logo and create logo particles
    try {
        const { targetPositions, particleColors } = await loadLogo('nexo.jpeg');
        createLogoParticles(scene, targetPositions, particleColors);
        console.log('[NEXORA] Logo loaded and sampled successfully');
    } catch (err) {
        console.warn('[NEXORA] Logo loading failed:', err.message);
        // Create fallback particles with default positions
    }

    // Build HUD timelines
    darknessTimeline = createDarknessTimeline();
    networkTimeline = createNetworkTimeline();
    coreTimeline = createCoreTimeline();

    // --- Event Listeners ---

    // Manual activation button
    const activateBtn = document.getElementById('activate-btn');
    if (activateBtn) {
        activateBtn.addEventListener('click', () => {
            initAudio(); // Ensure audio context from user gesture
            launchLogoReveal();
        });
    }

    // Keyboard backup (Space)
    window.addEventListener('keydown', (event) => {
        if (event.code === 'Space') {
            event.preventDefault();
            initAudio();
            launchLogoReveal();
        }
    });

    // Fullscreen toggle
    const fullscreenBtn = document.getElementById('fullscreen-btn');
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(() => { });
            } else {
                document.exitFullscreen().catch(() => { });
            }
        });
    }

    // --- Start ---
    state.initialized = true;
    state.startTime = performance.now();
    state.phase = 'darkness';

    // Kick off darkness timeline
    setPhase('darkness');

    // Start animation loop
    requestAnimationFrame(animate);

    console.log('[NEXORA] Launch experience ready');
    console.log('[NEXORA] Press SPACE or click ACTIVATE CORE to trigger reveal');
}

// --- Boot ---
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
