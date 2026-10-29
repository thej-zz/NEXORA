/* ============================================================
   BRAND COLORS — the one place the 3D scenes read the association's
   palette from. Every scene module (hero robot, About processor) reads
   from here, so re-branding the 3D work means editing this file once.

   PHASE 2: values now match the shipped logo and the CSS tokens in
   css/style.css (--nx-blue, --nx-blue-hi, --nx-blue-deep, --nx-silver-*).
   The old cyan #6FD8FF / violet #9682FF pair (placeholder favicon) is gone.

   Data contract kept: coreRGBA / accentRGBA still exist (accent-2 in the CSS
   is silver now, so accentRGBA is silver). New hex fields are for THREE.Color.
   ============================================================ */

window.BrandColors = {
  coreRGBA: 'rgba(76,145,240,0.95)',     // --nx-blue   — controlled accent (emissive details only)
  accentRGBA: 'rgba(205,214,228,0.9)',   // --accent-2 / --nx-silver-300

  blue: '#4C91F0',        // --nx-blue
  blueHi: '#8DB8F6',      // --nx-blue-hi
  blueDeep: '#204CA6',    // --nx-blue-deep
  silver100: '#E1EBF6',   // --nx-silver-100
  silver300: '#CDD6E4',   // --nx-silver-300
  graphite: '#1A1F26',    // between --nx-ink-800 and --nx-ink-700
  obsidian: '#0A0C0F'     // --nx-ink-900 (page)
};
