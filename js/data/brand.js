/* ============================================================
   BRAND COLORS — the only place the association's two accent
   colors are defined for the 3D scenes. Every scene module
   (hero, about, members) reads from here, so re-branding the
   whole site's 3D work means editing these two lines once
   you've pulled real colors from the logo.

   Keep these in sync with --accent / --accent-2 in css/style.css
   so the UI and the 3D scenes read as one identity.
   ============================================================ */

window.BrandColors = {
  coreRGBA: 'rgba(111,216,255,0.95)',   // primary — electric intelligence blue
  accentRGBA: 'rgba(150,130,255,0.9)'   // secondary — violet
};
