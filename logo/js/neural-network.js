/* ==========================================================================
   neural-network.js — 3D neural network with nodes, connections, and energy pulses
   ========================================================================== */

import * as THREE from 'three';

/* ---------- Configuration ---------- */
const NODE_COUNT        = 180;
const SPREAD_RADIUS     = 70;
const CONNECTION_DIST   = 22;
const MAX_CONNECTIONS   = 600;
const PULSE_SPEED       = 0.003;

/* ---------- GLSL for Nodes ---------- */
const nodeVertexShader = /* glsl */`
    attribute float aSize;
    attribute float aActivation;
    
    uniform float uTime;
    uniform float uPixelRatio;
    uniform float uGlobalActivation;
    
    varying float vActivation;
    varying float vGlow;
    
    void main() {
        float activation = aActivation * uGlobalActivation;
        vActivation = activation;
        
        // Pulsing glow
        float pulse = 0.6 + 0.4 * sin(uTime * 0.002 + aActivation * 20.0);
        vGlow = pulse * activation;
        
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        float sizeAtten = uPixelRatio * (250.0 / -mvPosition.z);
        gl_PointSize = max(aSize * sizeAtten * (0.5 + activation * 0.5), 1.0);
        gl_Position = projectionMatrix * mvPosition;
    }
`;

const nodeFragmentShader = /* glsl */`
    uniform vec3 uColorActive;
    uniform vec3 uColorInactive;
    
    varying float vActivation;
    varying float vGlow;
    
    void main() {
        float dist = length(gl_PointCoord - vec2(0.5));
        if (dist > 0.5) discard;
        
        // Core + glow
        float core = smoothstep(0.15, 0.0, dist);
        float glow = exp(-dist * 6.0);
        
        vec3 color = mix(uColorInactive, uColorActive, vActivation);
        float alpha = (core * 0.9 + glow * 0.6) * (0.2 + vActivation * 0.8);
        
        gl_FragColor = vec4(color * (1.0 + vGlow * 0.5), alpha);
    }
`;

/* ---------- State ---------- */
let nodesMesh, connectionsMesh;
let nodePositions, nodeActivations, nodeSizes;
let connectionPositions, connectionColors;
let connections = []; // pairs of indices
let nodeGeometry, connectionGeometry;
let nodeMaterial, connectionMaterial;
let globalActivation = 0;
let collapseProgress = 0;
let originalPositions;

/* ---------- Init ---------- */

export function initNeuralNetwork(scene) {
    // Generate nodes in 3D space (layered spherical distribution)
    nodePositions   = new Float32Array(NODE_COUNT * 3);
    nodeActivations = new Float32Array(NODE_COUNT);
    nodeSizes       = new Float32Array(NODE_COUNT);
    originalPositions = new Float32Array(NODE_COUNT * 3);

    for (let i = 0; i < NODE_COUNT; i++) {
        const i3 = i * 3;
        
        // Distribute in layered shells for genuine 3D depth
        const layer = Math.floor(Math.random() * 4);
        const rMin = layer * 15 + 10;
        const rMax = rMin + 20;
        const r = rMin + Math.random() * (rMax - rMin);
        
        const theta = Math.random() * Math.PI * 2;
        const phi   = Math.acos(2 * Math.random() - 1);
        
        nodePositions[i3]     = r * Math.sin(phi) * Math.cos(theta);
        nodePositions[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        nodePositions[i3 + 2] = r * Math.cos(phi);
        
        // Store original positions for collapse animation
        originalPositions[i3]     = nodePositions[i3];
        originalPositions[i3 + 1] = nodePositions[i3 + 1];
        originalPositions[i3 + 2] = nodePositions[i3 + 2];

        nodeActivations[i] = 0;
        nodeSizes[i] = 2.0 + Math.random() * 3.0;
    }

    // Find connections (nearby nodes)
    connections = [];
    for (let i = 0; i < NODE_COUNT && connections.length < MAX_CONNECTIONS; i++) {
        for (let j = i + 1; j < NODE_COUNT && connections.length < MAX_CONNECTIONS; j++) {
            const dx = nodePositions[i * 3]     - nodePositions[j * 3];
            const dy = nodePositions[i * 3 + 1] - nodePositions[j * 3 + 1];
            const dz = nodePositions[i * 3 + 2] - nodePositions[j * 3 + 2];
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dist < CONNECTION_DIST) {
                connections.push([i, j]);
            }
        }
    }

    // Nodes mesh
    nodeGeometry = new THREE.BufferGeometry();
    nodeGeometry.setAttribute('position',    new THREE.BufferAttribute(nodePositions, 3));
    nodeGeometry.setAttribute('aSize',       new THREE.BufferAttribute(nodeSizes, 1));
    nodeGeometry.setAttribute('aActivation', new THREE.BufferAttribute(nodeActivations, 1));

    nodeMaterial = new THREE.ShaderMaterial({
        vertexShader:   nodeVertexShader,
        fragmentShader: nodeFragmentShader,
        uniforms: {
            uTime:             { value: 0 },
            uPixelRatio:       { value: Math.min(window.devicePixelRatio, 2) },
            uGlobalActivation: { value: 0 },
            uColorActive:      { value: new THREE.Color(0x6FD8FF) },
            uColorInactive:    { value: new THREE.Color(0x1a2a4a) }
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    nodesMesh = new THREE.Points(nodeGeometry, nodeMaterial);
    scene.add(nodesMesh);

    // Connections mesh (LineSegments)
    const connCount = connections.length;
    connectionPositions = new Float32Array(connCount * 6);
    connectionColors    = new Float32Array(connCount * 6);

    _updateConnectionPositions();

    // Set initial colors (dim)
    for (let c = 0; c < connCount; c++) {
        const c6 = c * 6;
        connectionColors[c6]     = 0.04;
        connectionColors[c6 + 1] = 0.08;
        connectionColors[c6 + 2] = 0.15;
        connectionColors[c6 + 3] = 0.04;
        connectionColors[c6 + 4] = 0.08;
        connectionColors[c6 + 5] = 0.15;
    }

    connectionGeometry = new THREE.BufferGeometry();
    connectionGeometry.setAttribute('position', new THREE.BufferAttribute(connectionPositions, 3));
    connectionGeometry.setAttribute('color',    new THREE.BufferAttribute(connectionColors, 3));

    connectionMaterial = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    connectionsMesh = new THREE.LineSegments(connectionGeometry, connectionMaterial);
    scene.add(connectionsMesh);
}

function _updateConnectionPositions() {
    for (let c = 0; c < connections.length; c++) {
        const [i, j] = connections[c];
        const c6 = c * 6;
        connectionPositions[c6]     = nodePositions[i * 3];
        connectionPositions[c6 + 1] = nodePositions[i * 3 + 1];
        connectionPositions[c6 + 2] = nodePositions[i * 3 + 2];
        connectionPositions[c6 + 3] = nodePositions[j * 3];
        connectionPositions[c6 + 4] = nodePositions[j * 3 + 1];
        connectionPositions[c6 + 5] = nodePositions[j * 3 + 2];
    }
}

/* ---------- Update ---------- */

export function updateNeuralNetwork(time) {
    if (!nodesMesh) return;

    nodeMaterial.uniforms.uTime.value = time;
    nodeMaterial.uniforms.uGlobalActivation.value = globalActivation;

    // Sequential activation wave: activate nodes outward from center over time
    if (globalActivation > 0) {
        const waveRadius = globalActivation * SPREAD_RADIUS * 1.2;
        for (let i = 0; i < NODE_COUNT; i++) {
            const i3 = i * 3;
            const dist = Math.sqrt(
                originalPositions[i3] ** 2 +
                originalPositions[i3 + 1] ** 2 +
                originalPositions[i3 + 2] ** 2
            );
            nodeActivations[i] = Math.min(1, Math.max(0, (waveRadius - dist) / 20));
        }
        nodeGeometry.attributes.aActivation.needsUpdate = true;
    }

    // Subtle node jitter (alive feel)
    for (let i = 0; i < NODE_COUNT; i++) {
        const i3 = i * 3;
        const jitter = 0.02 * nodeActivations[i];
        nodePositions[i3]     += (Math.random() - 0.5) * jitter;
        nodePositions[i3 + 1] += (Math.random() - 0.5) * jitter;
        nodePositions[i3 + 2] += (Math.random() - 0.5) * jitter;
    }

    // Collapse toward center if active
    if (collapseProgress > 0) {
        for (let i = 0; i < NODE_COUNT; i++) {
            const i3 = i * 3;
            nodePositions[i3]     *= (1 - collapseProgress * 0.02);
            nodePositions[i3 + 1] *= (1 - collapseProgress * 0.02);
            nodePositions[i3 + 2] *= (1 - collapseProgress * 0.02);
        }
    }

    nodeGeometry.attributes.position.needsUpdate = true;

    // Update connection positions to follow nodes
    _updateConnectionPositions();
    connectionGeometry.attributes.position.needsUpdate = true;

    // Animate connection colors — energy pulse traveling along connections
    if (globalActivation > 0) {
        const pulseT = (time * PULSE_SPEED) % 1.0;
        const blue   = new THREE.Color(0x6FD8FF);
        const violet = new THREE.Color(0x9682FF);
        const dim    = new THREE.Color(0x0a1530);

        for (let c = 0; c < connections.length; c++) {
            const [i, j] = connections[c];
            const c6 = c * 6;
            
            // Each connection has a different phase
            const phase = (c / connections.length);
            const activeFactor = Math.max(nodeActivations[i], nodeActivations[j]);
            const pulse = Math.sin((pulseT + phase) * Math.PI * 2) * 0.5 + 0.5;
            
            const color = dim.clone().lerp(
                pulse > 0.5 ? blue : violet,
                pulse * activeFactor * globalActivation
            );
            
            connectionColors[c6]     = color.r;
            connectionColors[c6 + 1] = color.g;
            connectionColors[c6 + 2] = color.b;
            connectionColors[c6 + 3] = color.r;
            connectionColors[c6 + 4] = color.g;
            connectionColors[c6 + 5] = color.b;
        }
        connectionGeometry.attributes.color.needsUpdate = true;
    }
}

/* ---------- Phase Controls ---------- */

/**
 * Begin network awakening — nodes start activating
 * @param {number} activation - 0 to 1
 */
export function setNetworkActivation(val) {
    globalActivation = Math.min(1, Math.max(0, val));
    if (connectionMaterial) {
        connectionMaterial.opacity = globalActivation * 0.6;
    }
}

/**
 * Begin collapsing network toward center (for AI Core formation)
 * @param {number} progress - 0 to 1
 */
export function setCollapseProgress(val) {
    collapseProgress = val;
}

/**
 * Flash all connections brightly (activation moment)
 */
export function flashNetwork() {
    if (!connectionMaterial) return;
    
    // Temporarily max brightness
    const bright = new THREE.Color(0x6FD8FF);
    for (let c = 0; c < connections.length; c++) {
        const c6 = c * 6;
        connectionColors[c6]     = bright.r;
        connectionColors[c6 + 1] = bright.g;
        connectionColors[c6 + 2] = bright.b;
        connectionColors[c6 + 3] = bright.r;
        connectionColors[c6 + 4] = bright.g;
        connectionColors[c6 + 5] = bright.b;
    }
    connectionGeometry.attributes.color.needsUpdate = true;
    connectionMaterial.opacity = 1.0;
    
    // All nodes fully active
    for (let i = 0; i < NODE_COUNT; i++) {
        nodeActivations[i] = 1;
    }
    nodeGeometry.attributes.aActivation.needsUpdate = true;
}

/**
 * Dim the network for final reveal (logo should be the focus)
 */
export function dimNetwork() {
    globalActivation = 0.15;
    if (connectionMaterial) connectionMaterial.opacity = 0.08;
}
