/* ==========================================================================
   audio.js — Optional sound hooks for cinematic moments
   Graceful failure if audio files don't exist
   ========================================================================== */

let audioCtx = null;
const buffers = {};
let initialized = false;

const SOUND_PATHS = {
    activation: 'assets/sounds/activation.mp3',
    pulse:      'assets/sounds/pulse.mp3',
    reveal:     'assets/sounds/reveal.mp3'
};

/**
 * Initialize AudioContext on first user interaction.
 * Must be called from a user gesture (click, keypress) to satisfy autoplay policy.
 */
export function initAudio() {
    if (initialized) return;
    initialized = true;

    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        // Preload sounds (non-blocking, silent fail)
        Object.entries(SOUND_PATHS).forEach(([key, path]) => {
            fetch(path)
                .then(res => {
                    if (!res.ok) throw new Error(`${res.status}`);
                    return res.arrayBuffer();
                })
                .then(data => audioCtx.decodeAudioData(data))
                .then(buffer => { buffers[key] = buffer; })
                .catch(() => { /* Sound file not available — that's fine */ });
        });
    } catch {
        // Web Audio not supported
        audioCtx = null;
    }
}

/**
 * Play a named sound buffer. Returns silently if unavailable.
 */
function playSound(name, volume = 0.6) {
    if (!audioCtx || !buffers[name]) return;
    try {
        const source = audioCtx.createBufferSource();
        const gain = audioCtx.createGain();
        source.buffer = buffers[name];
        gain.gain.value = volume;
        source.connect(gain);
        gain.connect(audioCtx.destination);
        source.start(0);
    } catch {
        // Playback failed — silent
    }
}

export function playActivationSound() { playSound('activation', 0.7); }
export function playPulseSound()      { playSound('pulse', 0.5); }
export function playRevealSound()     { playSound('reveal', 0.8); }
