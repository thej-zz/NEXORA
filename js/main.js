/* ============================================================
   main.js — wires everything together.
   Content and member data are read from window.SiteContent /
   window.SiteMembers (js/data/*.js) and rendered into the page,
   so editing those two files is the only thing most future
   updates require.

   PHASE 1 CHANGES — everything not listed here is unchanged:
   [1] Mobile menu: a single toggle; aria-label / aria-expanded stay in
       sync, Escape closes it and returns focus, and it closes if the
       window grows past the mobile breakpoint.
   [2] document.title is no longer overwritten on the contact page
       (it was replaced by "NEXORA" and lost its own title).
   [3] Footer social icons render from SiteContent.footer.social. Empty
       (as shipped) means no icons, instead of dead "#" links.
   [4] prefers-reduced-motion is read here directly (cine-utils.js is not
       loaded in Phase 1) and respected by the cursor, magnetic buttons,
       tilt and the legacy 3D mount.
   [5] Custom cursor: hidden until the first pointer move (it used to sit
       at the top-left corner), and the rAF loop idles once the ring has
       caught up instead of running forever.
   [6] Page transition: ignores modified / new-tab clicks and is cleared on
       "pageshow", so Back/Forward never leaves a stuck overlay.
   [7] Legacy 3D scenes only mount if their scripts are present. In
       Phase 1 those scripts are commented out in the HTML.
   [8] Sets window.__nxReady so the inline <head> failsafe knows this script
       ran; if it never does, the page drops the "js" class after 5s and no
       content can stay hidden.

   PHASE 2 CHANGES
   [9]  Motion (Anime.js 3.2.2): hero entrance timeline + the shared .reveal
       choreography (also used by members-render.js through
       window.NexoraMotion). Anime only animates DOM; the 3D scenes are driven
       by scroll progress inside SceneRegistry, so each animated property has
       exactly one authority. No Anime, or reduced motion -> the Phase 1 CSS
       reveals run unchanged.
   [10] mountScenes() starts the shared 3D engine (one WebGL context for the
       hero robot and the About processor). It runs after first paint, never
       blocks content, and on ANY failure (no WebGL, Three.js missing, build
       error) un-pins the hero and leaves the static SVG illustrations.
       Reduced motion renders each scene once in a useful static state.
   [11] The loader reports back so the hero entrance starts as it fades.
   ============================================================ */

(function () {
  'use strict';

  /* [4] read live so an OS-level change is honoured on the next call */
  const prefersReducedMotion = () =>
    !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function setText(selector, value) {
    const el = document.querySelector(selector);
    if (el && value != null) el.textContent = value;
  }

  function setLink(selector, linkObj) {
    const el = document.querySelector(selector);
    if (el && linkObj) {
      el.textContent = linkObj.label;
      el.setAttribute('href', linkObj.href);
    }
  }

  function setLines(selector, lines) {
    const el = document.querySelector(selector);
    if (el && lines) el.innerHTML = lines.map((l) => `<span>${l}</span>`).join('');
  }

  function initials(name) {
    return name.split(/[\s-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function renderMemberCard(m) {
    const photo = m.image
      ? `<img src="${m.image}" alt="${m.name}, ${m.role}" loading="lazy">`
      : `<div class="placeholder-initials" aria-hidden="true">${initials(m.name)}</div>`;
    return `
    <article class="member-card reveal" data-tilt>
      <div class="member-card-glow" aria-hidden="true"></div>
      <div class="member-card-inner">
        <div class="member-photo">${photo}</div>
        <div class="member-sheen" aria-hidden="true"></div>
        <div class="member-info">
          <div class="accent-line"></div>
          <h3>${m.name}</h3>
          <div class="role">${m.role}</div>
        </div>
      </div>
      <div class="member-card-edge" aria-hidden="true"></div>
    </article>`;
  }

  /* ---------- member card tilt (desktop only) ----------
     Sets --rx/--ry/--mx/--my on the card. css/style.css applies a very
     subtle rotation to .member-card-inner from them. */
  function setupMemberTilt() {
    if (!window.matchMedia || !window.matchMedia('(pointer: fine)').matches) return;
    if (prefersReducedMotion()) return;                       // [4]

    document.addEventListener('mousemove', (e) => {
      const card = e.target.closest && e.target.closest('[data-tilt]');
      if (!card) return;
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;   // 0..1
      const py = (e.clientY - r.top) / r.height;   // 0..1
      const rx = (0.5 - py) * 16;   // rotateX
      const ry = (px - 0.5) * 16;   // rotateY
      card.style.setProperty('--rx', rx.toFixed(2) + 'deg');
      card.style.setProperty('--ry', ry.toFixed(2) + 'deg');
      card.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
      card.style.setProperty('--my', (py * 100).toFixed(1) + '%');
    }, { passive: true });

    document.addEventListener('mouseleave', (e) => {
      const card = e.target.closest && e.target.closest('[data-tilt]');
      if (!card) return;
      card.style.setProperty('--rx', '0deg');
      card.style.setProperty('--ry', '0deg');
    }, true);
  }

  /* ---------- footer social links [3] ----------
     Add real URLs in js/data/content.js → footer.social, e.g.
       { label: 'Instagram', href: 'https://instagram.com/…' }
     Supported icon labels: Instagram, LinkedIn, GitHub (anything else
     renders its label as text). Entries whose href is empty or "#" are
     skipped so placeholders can never ship as dead links. */
  const SOCIAL_ICONS = {
    instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="3.5"/><circle cx="17.2" cy="6.8" r="0.9" fill="currentColor" stroke="none"/></svg>',
    linkedin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><line x1="7.5" y1="10" x2="7.5" y2="17"/><circle cx="7.5" cy="6.8" r="0.9" fill="currentColor" stroke="none"/><path d="M11.5 17v-4a2.3 2.3 0 0 1 4.6 0v4"/><line x1="11.5" y1="10" x2="11.5" y2="17"/></svg>',
    github: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 2a10 10 0 0 0-3.16 19.5c.5.1.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.9-1.3 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.86v2.76c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"/></svg>'
  };

  function renderFooterSocial(list) {
    const box = document.querySelector('#footer-social');
    if (!box) return;
    const items = Array.isArray(list)
      ? list.filter((s) => s && s.href && String(s.href).trim() !== '#')
      : [];
    if (!items.length) { box.innerHTML = ''; box.hidden = true; return; }
    box.innerHTML = items.map((s) => {
      const label = escapeHtml(s.label || 'Social link');
      const icon = SOCIAL_ICONS[String(s.label || '').toLowerCase()];
      return `<a href="${escapeHtml(s.href)}" aria-label="${label}" target="_blank" rel="noopener noreferrer">${icon || label}</a>`;
    }).join('');
    box.hidden = false;
  }

  /* ---------- content ---------- */
  function renderContent() {
    const c = window.SiteContent;
    if (!c) return;
    const page = document.body.dataset.page;

    /* [2] contacts.html keeps its own <title>; trim the stray space in content.js */
    if (c.meta && c.meta.title && page !== 'contact') {
      document.title = c.meta.title.trim() + (page === 'members' ? ' — Team' : '');
    }

    /* nav CTA differs by page but reads from one content file */
    const navCta = document.querySelector('#nav-cta');
    if (navCta) {
      if (page === 'members') { navCta.textContent = c.nav.ctaMembers; navCta.setAttribute('href', 'index.html'); }
      else { navCta.textContent = c.nav.ctaHome; navCta.setAttribute('href', 'members.html'); }
    }

    if (page === 'home') {
      setText('#hero-eyebrow', c.hero.eyebrow);
      setLines('#hero-heading', c.hero.headingLines);
      setText('#hero-body', c.hero.body);
      setLink('#hero-primary-cta', c.hero.primaryCta);
      setLink('#hero-secondary-cta', c.hero.secondaryCta);

      setText('#about-index', c.about.index);
      setText('#about-label', c.about.label);
      setLines('#about-heading', c.about.heading);
      const aboutBody = document.querySelector('#about-body');
      if (aboutBody) aboutBody.innerHTML = c.about.paragraphs.map((p) => `<p class="section-body">${p}</p>`).join('');

      setText('#pillars-index', c.pillars.index);
      setText('#pillars-label', c.pillars.label);
      setLines('#pillars-heading', c.pillars.heading);
      const pillarsGrid = document.querySelector('#pillars-grid');
      if (pillarsGrid) {
        pillarsGrid.innerHTML = c.pillars.items.map((p) => `
          <div class="pillar-card reveal">
            <span class="num">${p.num}</span>
            <h3>${p.title}</h3>
            <p>${p.desc}</p>
          </div>`).join('');
      }

      setText('#activities-index', c.activities.index);
      setText('#activities-label', c.activities.label);
      setLines('#activities-heading', c.activities.heading);
      const activitiesRow = document.querySelector('#activities-row');
      if (activitiesRow) {
        activitiesRow.innerHTML = c.activities.items.map((a, i) => `
          <div class="activity-card reveal" style="--i:${i}">
            <span class="activity-num">${String(i + 1).padStart(2, '0')}</span>
            <h3>${a.title}</h3>
            <p>${a.desc}</p>
          </div>`).join('');
      }
      setText('#activities-note', c.activities.note);

      setText('#preview-index', c.memberPreview.index);
      setText('#preview-label', c.memberPreview.label);
      setText('#preview-heading', c.memberPreview.heading);
      setLink('#preview-cta', c.memberPreview.cta);
    }

    if (page === 'members') {
      setText('#members-eyebrow', c.membersPage.eyebrow);
      setLines('#members-heading', c.membersPage.heading);
      setText('#members-body', c.membersPage.body);
    }

    setText('#footer-desc', c.footer.description);
    setText('#footer-copyright', c.footer.copyright);
    renderFooterSocial(c.footer.social);                         // [3]
  }

  /* ---------- members ---------- */
  function renderMembers() {
    const M = window.SiteMembers;
    if (!M) return;

    const previewGrid = document.querySelector('#member-preview-grid');
    if (previewGrid && M.preview) {
      previewGrid.setAttribute('data-size', 'md');
      previewGrid.innerHTML = M.preview.map(renderMemberCard).join('');
    }

    /* #members-hierarchy on members.html is rendered entirely by
       js/members-render.js (loaded after this file), which owns that
       container end to end — including the equal-size card system.
       (Do not render into it from here: this runs on DOMContentLoaded,
       i.e. AFTER members-render.js's synchronous run, and would
       silently overwrite it.) */
  }

  /* ---------- nav ---------- */
  function setupNav() {
    const nav = document.querySelector('.nav');
    if (!nav) return;
    const onScroll = () => nav.classList.toggle('is-scrolled', window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* [1] single toggle + keyboard / a11y behaviour */
  function setupMobileMenu() {
    const toggle = document.querySelector('.nav-toggle');
    const menu = document.querySelector('.mobile-menu');
    if (!toggle || !menu) return;
    const MOBILE_MAX = 980;                  // keep in sync with the 980px breakpoint in css/style.css

    const isOpen = () => toggle.classList.contains('is-open');
    const setOpen = (open, returnFocus) => {
      toggle.classList.toggle('is-open', open);
      menu.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      document.body.style.overflow = open ? 'hidden' : '';
      if (!open && returnFocus) toggle.focus();
    };

    toggle.addEventListener('click', () => setOpen(!isOpen()));
    menu.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setOpen(false)));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen()) setOpen(false, true);
    });
    window.addEventListener('resize', () => {
      if (isOpen() && window.innerWidth > MOBILE_MAX) setOpen(false);
    });
  }

  /* ---------- custom cursor (desktop only) ---------- */
  function setupCursor() {
    if (!window.matchMedia || !window.matchMedia('(pointer: fine)').matches) return;
    if (prefersReducedMotion()) return;                       // [4]
    const dot = document.querySelector('.cursor-dot');
    const ring = document.querySelector('.cursor-ring');
    if (!dot || !ring) return;
    document.body.classList.add('has-custom-cursor');

    let x = 0, y = 0, rx = 0, ry = 0, raf = 0, ready = false;

    /* [5] animate only until the ring has caught up with the pointer */
    const step = () => {
      rx += (x - rx) * 0.18; ry += (y - ry) * 0.18;
      ring.style.transform = `translate(${rx}px, ${ry}px) translate(-50%, -50%)`;
      raf = (Math.abs(x - rx) > 0.1 || Math.abs(y - ry) > 0.1) ? requestAnimationFrame(step) : 0;
    };

    window.addEventListener('mousemove', (e) => {
      x = e.clientX; y = e.clientY;
      if (!ready) {                                           // first move: appear in place
        rx = x; ry = y; ready = true;
        document.body.classList.add('cursor-ready');
      }
      dot.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      if (!raf) raf = requestAnimationFrame(step);
    }, { passive: true });

    document.addEventListener('mouseover', (e) => {
      if (e.target.closest && e.target.closest('a, button, .pillar-card, .member-card, .mp-card, .activity-card')) ring.classList.add('is-active');
    });
    document.addEventListener('mouseout', (e) => {
      if (e.target.closest && e.target.closest('a, button, .pillar-card, .member-card, .mp-card, .activity-card')) ring.classList.remove('is-active');
    });
  }

  /* ---------- magnetic buttons (desktop only) ---------- */
  function setupMagneticButtons() {
    if (!window.matchMedia || !window.matchMedia('(pointer: fine)').matches) return;
    if (prefersReducedMotion()) return;                       // [4]
    document.querySelectorAll('.btn').forEach((btn) => {
      btn.addEventListener('mousemove', (e) => {
        const r = btn.getBoundingClientRect();
        const relX = e.clientX - r.left - r.width / 2;
        const relY = e.clientY - r.top - r.height / 2;
        btn.style.transform = `translate(${relX * 0.12}px, ${relY * 0.3}px)`;
      });
      btn.addEventListener('mouseleave', () => { btn.style.transform = ''; });
    });
  }

  /* ---------- [9] interface motion (Anime.js 3.2.2, vendored) ----------
     One easing and one distance language for the whole site. Anything that
     could fail leaves the element in its normal, visible state. */
  const Motion = (function () {
    const EASE = 'cubicBezier(0.16, 0.84, 0.44, 1)';          // the --ease token in css/style.css
    const root = document.documentElement;
    let on = false;
    let held = [];                                             // hero pieces hidden until the entrance plays
    let guard = 0;
    let played = false;

    function init() {
      on = !!window.anime && !prefersReducedMotion();
      if (on) root.classList.add('nx-anime');
      return on;
    }

    function release() {
      held.forEach((el) => { el.style.opacity = ''; el.style.transform = ''; });
      held = [];
    }

    /* hide the hero copy just before the loader lifts, so it can then arrive in sequence */
    function prepareHero() {
      if (!on) return;
      const parts = [
        document.querySelector('#hero-eyebrow'),
        ...document.querySelectorAll('#hero-heading > span'),
        document.querySelector('#hero-body'),
        document.querySelector('.hero-actions')
      ].filter(Boolean);
      if (!parts.length) return;
      held = parts;
      held.forEach((el) => { el.style.opacity = '0'; });
      guard = setTimeout(release, 4500);                       // failsafe: the hero can never stay invisible
    }

    function playHero() {
      if (!on || played) return;
      played = true;
      clearTimeout(guard);
      if (!held.length) return;
      const lines = document.querySelectorAll('#hero-heading > span');
      try {
        window.anime.timeline({ easing: EASE, complete: release })
          .add({ targets: '#hero-eyebrow', opacity: [0, 1], translateY: [10, 0], duration: 600 }, 0)
          .add({ targets: lines, opacity: [0, 1], translateY: [26, 0], duration: 900, delay: window.anime.stagger(95) }, 80)
          .add({ targets: '#hero-body', opacity: [0, 1], translateY: [14, 0], duration: 700 }, 380)
          .add({ targets: '.hero-actions', opacity: [0, 1], translateY: [14, 0], duration: 700 }, 520);
      } catch (err) { release(); }
    }

    /* Scroll-triggered reveal for .reveal blocks and the members page cards.
       Inline transition:none while Anime drives opacity/transform (no tug-of-war with
       the CSS transition); it is cleared afterwards so hover transitions keep working. */
    function reveal(list) {
      const els = Array.prototype.slice.call(list).filter((el) => !el.classList.contains('is-visible'));
      if (!els.length) return;
      if (!on) { els.forEach((el) => el.classList.add('is-visible')); return; }
      els.forEach((el) => { el.style.transition = 'none'; });
      const settle = () => els.forEach((el) => {
        el.classList.add('is-visible');
        el.style.opacity = ''; el.style.transform = ''; el.style.transition = '';
      });
      try {
        window.anime({
          targets: els, opacity: [0, 1], translateY: [18, 0], duration: 760, easing: EASE,
          delay: (el, i) => Math.min(i, 6) * 70,
          complete: settle
        });
      } catch (err) { settle(); }
    }

    return { init, prepareHero, playHero, reveal, enabled: () => on };
  })();
  window.NexoraMotion = Motion;                                // used by js/members-render.js

  /* ---------- scroll reveal ---------- */
  function setupReveal() {
    const els = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window) || prefersReducedMotion()) {   // [4]
      els.forEach((el) => el.classList.add('is-visible'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      const batch = [];                                        // everything that entered together staggers together
      entries.forEach((entry) => {
        if (entry.isIntersecting) { batch.push(entry.target); io.unobserve(entry.target); }
      });
      if (batch.length) Motion.reveal(batch);
    }, { threshold: 0.15, rootMargin: '0px 0px -60px 0px' });
    els.forEach((el) => io.observe(el));
  }

  /* ---------- page transition between pages [6] ---------- */
  function setupPageTransition() {
    const overlay = document.querySelector('.page-transition');
    if (!overlay) return;

    /* Back/Forward can restore this page from the bfcache with the overlay still on */
    window.addEventListener('pageshow', (e) => {
      if (e.persisted) overlay.classList.remove('is-active');
    });

    document.querySelectorAll('a[href$=".html"]').forEach((a) => {
      a.addEventListener('click', (e) => {
        const href = a.getAttribute('href');
        if (!href) return;
        /* leave new-tab / modified clicks to the browser */
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (a.target && a.target !== '_self') return;
        if (prefersReducedMotion()) return;                   // navigate immediately
        e.preventDefault();
        overlay.classList.add('is-active');
        setTimeout(() => { window.location.href = href; }, 480);
      });
    });
  }

  /* ---------- loading screen ---------- */
  function setupLoader() {
    const loader = document.querySelector('.loader');
    if (!loader) { Motion.playHero(); return; }
    const bar = loader.querySelector('.loader-bar span');
    const start = performance.now();
    const minDisplay = 500;
    if (bar) requestAnimationFrame(() => { bar.style.width = '100%'; });
    const lift = () => { loader.classList.add('is-hidden'); Motion.playHero(); };   // [11]
    const hide = () => {
      const wait = Math.max(0, minDisplay - (performance.now() - start));
      setTimeout(lift, wait);
    };
    if (document.readyState === 'complete') hide();
    else window.addEventListener('load', hide);
    setTimeout(lift, 3000); // safety net (CSS has a second one at 6s)
  }

  /* ---------- [10] 3D chapters (one shared renderer: see js/scene-registry.js) ----------
     Reduced motion renders each scene ONCE in a useful static state (no scroll
     link, no parallax, no loop). Any failure restores the Phase 1 fallbacks. */
  const HERO_STATIC = 0.14;      // arm unfolded above the module, fingers open
  const ABOUT_STATIC = 0.56;     // processor open, tags visible

  function mountScenes() {
    const root = document.documentElement;
    const heroCanvas = document.querySelector('#hero-canvas');
    const aboutCanvas = document.querySelector('#about-canvas');
    if (!heroCanvas && !aboutCanvas) return;                   // not the home page

    const giveUp = (why) => {
      root.classList.remove('nx-pin', 'nx-hero-3d', 'nx-about-3d');   // un-pin; SVG fallbacks show
      console.info('[NEXORA] 3D not started (' + why + '); static illustrations stay in place.');
    };
    const SR = window.SceneRegistry;
    if (!window.THREE || !SR || !SR.supported()) return giveUp('engine unavailable');

    const reduced = prefersReducedMotion();
    if (reduced) root.classList.remove('nx-pin');

    /* the engine reports each scene's state; the page swaps fallback <-> canvas from it */
    const marker = { intelligenceField: 'nx-hero-3d', dataCore: 'nx-about-3d' };
    SR.onState((id, state) => {
      const cls = marker[id];
      if (!cls) return;
      if (state === 'ready') root.classList.add(cls);
      else if (state === 'lost' || state === 'disposed') root.classList.remove(cls);
    });

    let mounted = 0;
    try {
      if (heroCanvas) {
        const wrapper = document.querySelector('.hero-pin-wrapper');
        const h = SR.mount('intelligenceField', heroCanvas,
          reduced ? { staticProgress: HERO_STATIC } : { pinnedContainer: wrapper });
        if (h) mounted++;
      }
      if (aboutCanvas) {
        const target = aboutCanvas.closest('.about-visual') || aboutCanvas;
        const h = SR.mount('dataCore', aboutCanvas,
          reduced ? { staticProgress: ABOUT_STATIC } : { getProgress: SR.makeSectionProgress(target, { center: true }) });
        if (h) mounted++;
      }
    } catch (err) {
      console.warn('3D scenes failed to mount:', err);
      SR.disposeAll();
      return giveUp('error');
    }
    if (!mounted) giveUp('WebGL unavailable');
  }

  /* after first paint, so heavy scene construction never delays the content */
  function startScenes() {
    requestAnimationFrame(() => setTimeout(() => {
      try { mountScenes(); } catch (err) { console.warn('3D scenes failed to start:', err); }
    }, 0));
  }

  document.addEventListener('DOMContentLoaded', () => {
    window.__nxReady = true;      // lets the <head> failsafe know this script is running (see html.js note in css/style.css)
    Motion.init();                // [9] before any reveal can fire
    renderContent();
    Motion.prepareHero();         // after the copy exists, before the loader lifts
    renderMembers();
    setupNav();
    setupMobileMenu();
    setupCursor();
    setupMagneticButtons();
    setupMemberTilt();
    setupReveal();
    setupPageTransition();
    setupLoader();
    startScenes();                // [10]
  });
})();
