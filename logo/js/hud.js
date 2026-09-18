/* ==========================================================================
   hud.js — HUD text overlays & Anime.js timeline management
   Controls all DOM-based text animations for the cinematic sequence
   ========================================================================== */

// DOM element references (resolved on init)
let els = {};

export function initHUD() {
    els = {
        topLeft:         document.getElementById('hud-top-left'),
        systemStatus:    document.getElementById('system-status'),
        phaseLabel:      document.getElementById('phase-label'),
        phaseSublabel:   document.getElementById('phase-sublabel'),
        syncCounter:     document.getElementById('sync-counter'),
        bottomRight:     document.getElementById('hud-bottom-right'),
        gestureStatus:   document.getElementById('gesture-status'),
        activationPanel: document.getElementById('activation-panel'),
        activateBtn:     document.getElementById('activate-btn'),
        activationStatus:document.getElementById('activation-status'),
        logoReveal:      document.getElementById('logo-reveal'),
        logoGlow:        document.getElementById('logo-glow'),
        logoImg:         document.getElementById('logo-img'),
        logoText:        document.getElementById('logo-text'),
        logoTitle:       document.getElementById('logo-title'),
        logoDivider:     document.getElementById('logo-divider'),
        logoTagline:     document.getElementById('logo-tagline'),
        screenFlash:     document.getElementById('screen-flash'),
        filmGrain:       document.getElementById('film-grain')
    };
}

/* ---------- Text update helpers ---------- */

export function setPhaseLabel(text) {
    if (els.phaseLabel) els.phaseLabel.textContent = text;
}

export function setPhaseSublabel(text) {
    if (els.phaseSublabel) els.phaseSublabel.textContent = text;
}

export function setSyncCounter(text) {
    if (els.syncCounter) els.syncCounter.textContent = text;
}

export function setSystemStatus(text) {
    if (els.systemStatus) els.systemStatus.textContent = text;
}

export function setGestureStatus(text) {
    if (els.gestureStatus) els.gestureStatus.textContent = text;
}

export function setActivationStatus(text) {
    if (els.activationStatus) els.activationStatus.textContent = text;
}

export function disableButton() {
    if (els.activateBtn) els.activateBtn.disabled = true;
}

/* ---------- Anime.js Timeline Builders ---------- */

/**
 * Scene 1 — Darkness intro HUD
 * "INITIALIZING" → "AI CORE // OFFLINE"
 */
export function createDarknessTimeline() {
    const tl = anime.timeline({ autoplay: false });

    // Show film grain
    tl.add({
        targets: els.filmGrain,
        opacity: [0, 0.04],
        duration: 2000,
        easing: 'easeInOutQuad'
    }, 0);

    // Fade in top-left panel
    tl.add({
        targets: els.topLeft,
        opacity: [0, 1],
        duration: 1200,
        easing: 'easeOutCubic',
        begin: () => setSystemStatus('INITIALIZING')
    }, 800);

    // Update status text
    tl.add({
        targets: els.topLeft,
        opacity: [1, 0.7],
        duration: 400,
        easing: 'easeInOutQuad',
        begin: () => setSystemStatus('AI CORE // OFFLINE'),
        complete: () => {
            anime({
                targets: els.topLeft,
                opacity: [0.7, 1],
                duration: 400,
                easing: 'easeInOutQuad'
            });
        }
    }, 2800);

    return tl;
}

/**
 * Scene 2 — Neural Network HUD
 * "NEURAL NETWORK" → "ONLINE" → sync counter 12% → 47% → 83% → 100%
 */
export function createNetworkTimeline() {
    const tl = anime.timeline({ autoplay: false });
    const syncObj = { value: 0 };

    // Phase label: NEURAL NETWORK
    tl.add({
        targets: els.phaseLabel,
        opacity: [0, 1],
        letterSpacing: ['20px', '12px'],
        duration: 1000,
        easing: 'easeOutCubic',
        begin: () => setPhaseLabel('NEURAL NETWORK')
    }, 0);

    // Sublabel: ONLINE
    tl.add({
        targets: els.phaseSublabel,
        opacity: [0, 0.8],
        letterSpacing: ['14px', '6px'],
        duration: 800,
        easing: 'easeOutCubic',
        begin: () => setPhaseSublabel('ONLINE')
    }, 600);

    // System status update
    tl.add({
        targets: {},
        duration: 100,
        begin: () => setSystemStatus('NETWORK ACTIVE')
    }, 800);

    // Sync counter animation
    tl.add({
        targets: els.syncCounter,
        opacity: [0, 1],
        duration: 400,
        easing: 'easeOutCubic',
        begin: () => setSyncCounter('SYNCHRONIZATION: 0%')
    }, 1200);

    // Animate sync 0 → 12
    tl.add({
        targets: syncObj,
        value: 12,
        duration: 600,
        easing: 'easeInOutQuad',
        round: 1,
        update: () => setSyncCounter(`SYNCHRONIZATION: ${syncObj.value}%`)
    }, 1600);

    // 12 → 47
    tl.add({
        targets: syncObj,
        value: 47,
        duration: 700,
        easing: 'easeInOutCubic',
        round: 1,
        update: () => setSyncCounter(`SYNCHRONIZATION: ${syncObj.value}%`)
    }, 2400);

    // 47 → 83
    tl.add({
        targets: syncObj,
        value: 83,
        duration: 500,
        easing: 'easeInOutQuart',
        round: 1,
        update: () => setSyncCounter(`SYNCHRONIZATION: ${syncObj.value}%`)
    }, 3300);

    // 83 → 100
    tl.add({
        targets: syncObj,
        value: 100,
        duration: 400,
        easing: 'easeOutExpo',
        round: 1,
        update: () => setSyncCounter(`SYNCHRONIZATION: ${syncObj.value}%`)
    }, 4000);

    // Flash sync complete
    tl.add({
        targets: els.syncCounter,
        color: ['#9682FF', '#6FD8FF'],
        duration: 300,
        easing: 'easeOutCubic',
        complete: () => setSyncCounter('SYNCHRONIZED')
    }, 4500);

    return tl;
}

/**
 * Scene 3 — AI Core HUD
 * "AI CORE" → "READY" → "AWAITING HUMAN INPUT"
 */
export function createCoreTimeline() {
    const tl = anime.timeline({ autoplay: false });

    // Fade out network text
    tl.add({
        targets: [els.phaseLabel, els.phaseSublabel, els.syncCounter],
        opacity: 0,
        duration: 600,
        easing: 'easeInOutQuad'
    }, 0);

    // AI CORE label
    tl.add({
        targets: els.phaseLabel,
        opacity: [0, 1],
        letterSpacing: ['20px', '12px'],
        duration: 1000,
        easing: 'easeOutCubic',
        begin: () => setPhaseLabel('AI CORE')
    }, 800);

    // READY sublabel
    tl.add({
        targets: els.phaseSublabel,
        opacity: [0, 0.8],
        letterSpacing: ['14px', '6px'],
        duration: 800,
        easing: 'easeOutCubic',
        begin: () => setPhaseSublabel('READY')
    }, 1600);

    // System status
    tl.add({
        targets: {},
        duration: 100,
        begin: () => setSystemStatus('AI CORE // STANDBY')
    }, 2000);

    // AWAITING HUMAN INPUT
    tl.add({
        targets: els.syncCounter,
        opacity: [0, 0.7],
        duration: 1200,
        easing: 'easeInOutCubic',
        begin: () => setSyncCounter('AWAITING HUMAN INPUT')
    }, 2800);

    // Show activation button
    tl.add({
        targets: els.activationPanel,
        opacity: [0, 1],
        translateY: [20, 0],
        duration: 800,
        easing: 'easeOutCubic'
    }, 3400);

    return tl;
}

/**
 * Activation + Reveal HUD timeline
 * Called by launchLogoReveal()
 */
export function createRevealTimeline(onLogoFormStart, onFlash, onComplete) {
    const tl = anime.timeline({ autoplay: false });

    // Hide waiting text
    tl.add({
        targets: [els.phaseLabel, els.phaseSublabel, els.syncCounter],
        opacity: 0,
        duration: 200,
        easing: 'easeInQuad'
    }, 0);

    // Hide activation panel
    tl.add({
        targets: els.activationPanel,
        opacity: 0,
        duration: 200,
        easing: 'easeInQuad'
    }, 0);

    // HUMAN INPUT ACCEPTED
    tl.add({
        targets: els.phaseLabel,
        opacity: [0, 1],
        letterSpacing: ['24px', '12px'],
        duration: 600,
        easing: 'easeOutExpo',
        begin: () => {
            setPhaseLabel('HUMAN INPUT ACCEPTED');
            setSystemStatus('PROCESSING');
        }
    }, 400);

    // AI CORE // ACTIVE
    tl.add({
        targets: els.phaseSublabel,
        opacity: [0, 1],
        duration: 500,
        easing: 'easeOutCubic',
        begin: () => setPhaseSublabel('AI CORE // ACTIVE')
    }, 800);

    // Screen flash for activation
    tl.add({
        targets: els.screenFlash,
        opacity: [0, 0.6, 0],
        duration: 600,
        easing: 'easeOutExpo'
    }, 600);

    // Fade out activation HUD
    tl.add({
        targets: [els.phaseLabel, els.phaseSublabel],
        opacity: 0,
        duration: 800,
        easing: 'easeInOutQuad'
    }, 2000);

    // System status update
    tl.add({
        targets: {},
        duration: 100,
        begin: () => {
            setSystemStatus('RECONSTRUCTING');
            if (onLogoFormStart) onLogoFormStart();
        }
    }, 2800);

    // LOGO FORMATION text
    tl.add({
        targets: els.syncCounter,
        opacity: [0, 0.6],
        duration: 400,
        easing: 'easeOutCubic',
        begin: () => setSyncCounter('RECONSTRUCTING IDENTITY')
    }, 2900);

    // Fade out reconstruction text
    tl.add({
        targets: els.syncCounter,
        opacity: 0,
        duration: 600,
        easing: 'easeInOutQuad'
    }, 5500);

    // Fade out top-left and bottom-right panels
    tl.add({
        targets: [els.topLeft, els.bottomRight],
        opacity: 0,
        duration: 800,
        easing: 'easeInOutQuad'
    }, 6000);

    // Final cinematic flash
    tl.add({
        targets: els.screenFlash,
        opacity: [0, 0.8, 0],
        duration: 800,
        easing: 'easeOutExpo',
        begin: () => { if (onFlash) onFlash(); }
    }, 6800);

    // Show logo reveal container
    tl.add({
        targets: els.logoReveal,
        opacity: [0, 1],
        duration: 100,
        easing: 'linear'
    }, 7000);

    // Logo glow
    tl.add({
        targets: els.logoGlow,
        opacity: [0, 1],
        scale: [0.5, 1],
        duration: 1500,
        easing: 'easeOutCubic'
    }, 7000);

    // Logo image fade in
    tl.add({
        targets: els.logoImg,
        opacity: [0, 1],
        scale: [0.85, 1],
        duration: 1800,
        easing: 'easeOutCubic'
    }, 7200);

    // Logo text
    tl.add({
        targets: els.logoText,
        opacity: [0, 1],
        translateY: [15, 0],
        duration: 1200,
        easing: 'easeOutCubic'
    }, 7800);

    // Divider line
    tl.add({
        targets: els.logoDivider,
        opacity: [0, 0.6],
        width: ['0px', '100%'],
        duration: 1000,
        easing: 'easeInOutCubic'
    }, 8000);

    // System status final
    tl.add({
        targets: {},
        duration: 100,
        begin: () => {
            setSystemStatus('NEXORA // ONLINE');
            if (onComplete) onComplete();
        }
    }, 9000);

    return tl;
}

/**
 * Show gesture status panel
 */
export function showGesturePanel() {
    if (els.bottomRight) {
        anime({
            targets: els.bottomRight,
            opacity: [0, 1],
            duration: 600,
            easing: 'easeOutCubic'
        });
    }
}

/**
 * Utility: quick flash on an element
 */
export function flashElement(el) {
    anime({
        targets: el,
        opacity: [1, 0.3, 1],
        duration: 300,
        easing: 'easeInOutQuad'
    });
}
