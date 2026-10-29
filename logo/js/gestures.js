/* ==========================================================================
   gestures.js — MediaPipe Hands integration with holographic hand rendering
   Detects pinch gesture; renders futuristic hand visualization in Three.js
   ========================================================================== */

import * as THREE from 'three';

/* ---------- Configuration ---------- */
const PINCH_THRESHOLD   = 0.06;   // Normalized distance for pinch detection
const DEBOUNCE_FRAMES   = 10;     // Frames pinch must be held before triggering
const HAND_SCALE        = 15;     // Scale factor for mapping hand to 3D space
const HAND_Z_OFFSET     = 15;     // Z position of hand in 3D space

/* ---------- MediaPipe Hand Landmark Connections ---------- */
const HAND_CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,4],      // thumb
    [0,5],[5,6],[6,7],[7,8],      // index
    [0,9],[9,10],[10,11],[11,12], // middle
    [0,13],[13,14],[14,15],[15,16], // ring
    [0,17],[17,18],[18,19],[19,20], // pinky
    [5,9],[9,13],[13,17]           // palm
];
const FINGERTIP_INDICES = [4, 8, 12, 16, 20];

/* ---------- State ---------- */
let hands = null;
let mpCamera = null;
let isActive = false;
let handDetected = false;
let currentLandmarks = null;
let pinchFrames = 0;
let gestureDisabled = false;

// Callbacks
let onHandDetectedCb = null;
let onHandLostCb = null;
let onPinchCb = null;

// Three.js hand visualization
let handGroup;
let fingerPointsMesh;
let connectionLinesMesh;
let scanRingMesh;

/* ---------- Init ---------- */

/**
 * Initialize MediaPipe Hands with graceful failure handling.
 * @param {THREE.Scene} scene - Three.js scene for hand visualization
 * @param {Object} callbacks - { onHandDetected, onHandLost, onPinch }
 */
export async function initGestures(scene, callbacks = {}) {
    onHandDetectedCb = callbacks.onHandDetected || null;
    onHandLostCb     = callbacks.onHandLost || null;
    onPinchCb        = callbacks.onPinch || null;

    // Create Three.js hand visualization
    _createHandVisualization(scene);

    try {
        // Check if MediaPipe is available
        if (typeof window.Hands === 'undefined') {
            throw new Error('MediaPipe Hands not loaded');
        }

        hands = new window.Hands({
            locateFile: (file) =>
                `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`
        });

        hands.setOptions({
            maxNumHands: 1,
            modelComplexity: 1,
            minDetectionConfidence: 0.7,
            minTrackingConfidence: 0.5
        });

        hands.onResults(onResults);

        // Request webcam
        const videoEl = document.getElementById('webcam');
        if (!videoEl) throw new Error('No webcam element');

        if (typeof window.Camera === 'undefined') {
            throw new Error('MediaPipe Camera Utils not loaded');
        }

        mpCamera = new window.Camera(videoEl, {
            onFrame: async () => {
                if (hands && isActive) {
                    await hands.send({ image: videoEl });
                }
            },
            width: 640,
            height: 480
        });

        await mpCamera.start();
        isActive = true;
        return true;

    } catch (err) {
        console.warn('[Gestures] MediaPipe initialization failed:', err.message);
        isActive = false;
        return false;
    }
}

/* ---------- MediaPipe Results Callback ---------- */

function onResults(results) {
    if (gestureDisabled) return;

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];
        currentLandmarks = landmarks;

        if (!handDetected) {
            handDetected = true;
            if (onHandDetectedCb) onHandDetectedCb();
        }

        // Check pinch gesture (thumb tip #4 ↔ index tip #8)
        const thumb = landmarks[4];
        const index = landmarks[8];
        const dx = thumb.x - index.x;
        const dy = thumb.y - index.y;
        const dz = (thumb.z || 0) - (index.z || 0);
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist < PINCH_THRESHOLD) {
            pinchFrames++;
            if (pinchFrames >= DEBOUNCE_FRAMES && onPinchCb) {
                onPinchCb();
                pinchFrames = 0; // Reset after trigger
            }
        } else {
            pinchFrames = Math.max(0, pinchFrames - 2); // Gradual reset
        }

    } else {
        if (handDetected) {
            handDetected = false;
            currentLandmarks = null;
            pinchFrames = 0;
            if (onHandLostCb) onHandLostCb();
        }
    }
}

/* ---------- Three.js Hand Visualization ---------- */

function _createHandVisualization(scene) {
    handGroup = new THREE.Group();
    handGroup.visible = false;
    scene.add(handGroup);

    // Fingertip + landmark points
    const pointCount = 21;
    const pointPositions = new Float32Array(pointCount * 3);
    const pointSizes     = new Float32Array(pointCount);
    const pointColors    = new Float32Array(pointCount * 3);

    const blue = new THREE.Color(0x6FD8FF);
    const violet = new THREE.Color(0x9682FF);

    for (let i = 0; i < pointCount; i++) {
        pointSizes[i] = FINGERTIP_INDICES.includes(i) ? 4.0 : 2.0;
        const c = FINGERTIP_INDICES.includes(i) ? blue : violet;
        pointColors[i * 3]     = c.r;
        pointColors[i * 3 + 1] = c.g;
        pointColors[i * 3 + 2] = c.b;
    }

    const pointGeo = new THREE.BufferGeometry();
    pointGeo.setAttribute('position', new THREE.BufferAttribute(pointPositions, 3));

    const pointMat = new THREE.PointsMaterial({
        size: 0.4,
        color: 0x6FD8FF,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true
    });

    fingerPointsMesh = new THREE.Points(pointGeo, pointMat);
    handGroup.add(fingerPointsMesh);

    // Connection lines
    const lineCount = HAND_CONNECTIONS.length;
    const linePositions = new Float32Array(lineCount * 6);

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));

    const lineMat = new THREE.LineBasicMaterial({
        color: 0x6FD8FF,
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    connectionLinesMesh = new THREE.LineSegments(lineGeo, lineMat);
    handGroup.add(connectionLinesMesh);

    // Scan ring at index fingertip
    const ringGeo = new THREE.RingGeometry(0.6, 0.7, 32);
    const ringMat = new THREE.MeshBasicMaterial({
        color: 0x6FD8FF,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    scanRingMesh = new THREE.Mesh(ringGeo, ringMat);
    handGroup.add(scanRingMesh);
}

/**
 * Update hand visualization with current landmarks
 */
export function updateHandVisualization(time) {
    if (!handGroup) return;

    if (!currentLandmarks || !handDetected) {
        handGroup.visible = false;
        return;
    }

    handGroup.visible = true;

    // Update point positions from landmarks
    const pointPos = fingerPointsMesh.geometry.attributes.position.array;
    for (let i = 0; i < 21; i++) {
        const lm = currentLandmarks[i];
        const i3 = i * 3;
        // Map MediaPipe normalized coords (0-1) to 3D space
        // Mirror X so hand appears naturally
        pointPos[i3]     = -(lm.x - 0.5) * HAND_SCALE;
        pointPos[i3 + 1] = -(lm.y - 0.5) * HAND_SCALE;
        pointPos[i3 + 2] = -(lm.z || 0) * HAND_SCALE * 0.5 + HAND_Z_OFFSET;
    }
    fingerPointsMesh.geometry.attributes.position.needsUpdate = true;

    // Update connection lines
    const linePos = connectionLinesMesh.geometry.attributes.position.array;
    for (let c = 0; c < HAND_CONNECTIONS.length; c++) {
        const [a, b] = HAND_CONNECTIONS[c];
        const c6 = c * 6;
        linePos[c6]     = pointPos[a * 3];
        linePos[c6 + 1] = pointPos[a * 3 + 1];
        linePos[c6 + 2] = pointPos[a * 3 + 2];
        linePos[c6 + 3] = pointPos[b * 3];
        linePos[c6 + 4] = pointPos[b * 3 + 1];
        linePos[c6 + 5] = pointPos[b * 3 + 2];
    }
    connectionLinesMesh.geometry.attributes.position.needsUpdate = true;

    // Scan ring follows index fingertip (landmark 8)
    const idx = currentLandmarks[8];
    scanRingMesh.position.set(
        -(idx.x - 0.5) * HAND_SCALE,
        -(idx.y - 0.5) * HAND_SCALE,
        -(idx.z || 0) * HAND_SCALE * 0.5 + HAND_Z_OFFSET
    );
    scanRingMesh.rotation.z = time * 0.002;
    scanRingMesh.material.opacity = 0.3 + 0.2 * Math.sin(time * 0.005);
}

/* ---------- Controls ---------- */

/**
 * Disable gesture detection (after reveal starts)
 */
export function disableGestures() {
    gestureDisabled = true;
    if (handGroup) handGroup.visible = false;
}

/**
 * Check if hand is currently detected
 */
export function isHandCurrentlyDetected() {
    return handDetected;
}

/**
 * Check if gesture system is active
 */
export function isGestureSystemActive() {
    return isActive;
}

/**
 * Cleanup
 */
export function cleanupGestures() {
    gestureDisabled = true;
    isActive = false;
    if (mpCamera) {
        try { mpCamera.stop(); } catch {}
    }
    if (handGroup) handGroup.visible = false;
}
