/* ============================================================
   main.js — wires everything together.
   Content and member data are read from window.SiteContent /
   window.SiteMembers (js/data/*.js) and rendered into the page,
   so editing those two files is the only thing most future
   updates require.
   ============================================================ */

(function () {
  'use strict';

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

  function renderMemberCard(m) {
    const photo = m.image
      ? `<img src="${m.image}" alt="${m.name}, ${m.role}" loading="lazy">`
      : `<div class="placeholder-initials" aria-hidden="true">${initials(m.name)}</div>`;
    return `
      <article class="member-card reveal">
        <div class="member-photo">${photo}</div>
        <div class="member-info">
          <div class="accent-line"></div>
          <h3>${m.name}</h3>
          <div class="role">${m.role}</div>
        </div>
      </article>`;
  }

  /* ---------- content ---------- */
  function renderContent() {
    const c = window.SiteContent;
    if (!c) return;
    const page = document.body.dataset.page;

    if (c.meta && c.meta.title) document.title = c.meta.title + (page === 'members' ? ' — Team' : '');

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
        activitiesRow.innerHTML = c.activities.items.map((a) => `
          <div class="activity-card reveal">
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

    const hierarchyRoot = document.querySelector('#members-hierarchy');
    if (hierarchyRoot && M.sections) {
      hierarchyRoot.innerHTML = M.sections.map((sec) => {
        const list = M[sec.key] || [];
        return `
          <div class="members-section">
            <div class="container">
              <div class="members-section-label reveal">${sec.label}</div>
              <div class="member-grid" data-size="${sec.size}">
                ${list.map(renderMemberCard).join('')}
              </div>
            </div>
          </div>`;
      }).join('');
    }
  }

  /* ---------- nav ---------- */
  function setupNav() {
    const nav = document.querySelector('.nav');
    if (!nav) return;
    const onScroll = () => nav.classList.toggle('is-scrolled', window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  function setupMobileMenu() {
    const toggle = document.querySelector('.nav-toggle');
    const menu = document.querySelector('.mobile-menu');
    if (!toggle || !menu) return;
    const close = () => {
      toggle.classList.remove('is-open'); menu.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false'); document.body.style.overflow = '';
    };
    toggle.addEventListener('click', () => {
      const open = !toggle.classList.contains('is-open');
      toggle.classList.toggle('is-open', open); menu.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      document.body.style.overflow = open ? 'hidden' : '';
    });
    menu.querySelectorAll('a').forEach((a) => a.addEventListener('click', close));
  }

  /* ---------- custom cursor (desktop only) ---------- */
  function setupCursor() {
    if (!window.matchMedia || !window.matchMedia('(pointer: fine)').matches) return;
    const dot = document.querySelector('.cursor-dot');
    const ring = document.querySelector('.cursor-ring');
    if (!dot || !ring) return;
    document.body.classList.add('has-custom-cursor');

    let x = 0, y = 0, rx = 0, ry = 0;
    window.addEventListener('mousemove', (e) => {
      x = e.clientX; y = e.clientY;
      dot.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    }, { passive: true });

    (function loop() {
      rx += (x - rx) * 0.18; ry += (y - ry) * 0.18;
      ring.style.transform = `translate(${rx}px, ${ry}px) translate(-50%, -50%)`;
      requestAnimationFrame(loop);
    })();

    document.addEventListener('mouseover', (e) => {
      if (e.target.closest && e.target.closest('a, button, .pillar-card, .member-card, .activity-card')) ring.classList.add('is-active');
    });
    document.addEventListener('mouseout', (e) => {
      if (e.target.closest && e.target.closest('a, button, .pillar-card, .member-card, .activity-card')) ring.classList.remove('is-active');
    });
  }

  /* ---------- magnetic buttons (desktop only) ---------- */
  function setupMagneticButtons() {
    if (!window.matchMedia || !window.matchMedia('(pointer: fine)').matches) return;
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

  /* ---------- scroll reveal ---------- */
  function setupReveal() {
    const els = document.querySelectorAll('.reveal');
    const reduced = window.CineUtils && window.CineUtils.Q.reducedMotion;
    if (!('IntersectionObserver' in window) || reduced) {
      els.forEach((el) => el.classList.add('is-visible'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) { entry.target.classList.add('is-visible'); io.unobserve(entry.target); }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -60px 0px' });
    els.forEach((el) => io.observe(el));
  }

  /* ---------- page transition between index.html / members.html ---------- */
  function setupPageTransition() {
    const overlay = document.querySelector('.page-transition');
    if (!overlay) return;
    document.querySelectorAll('a[href$=".html"]').forEach((a) => {
      a.addEventListener('click', (e) => {
        const href = a.getAttribute('href');
        if (!href) return;
        e.preventDefault();
        overlay.classList.add('is-active');
        setTimeout(() => { window.location.href = href; }, 480);
      });
    });
  }

  /* ---------- loading screen ---------- */
  function setupLoader() {
    const loader = document.querySelector('.loader');
    if (!loader) return;
    const bar = loader.querySelector('.loader-bar span');
    const start = performance.now();
    const minDisplay = 500;
    if (bar) requestAnimationFrame(() => { bar.style.width = '100%'; });
    const hide = () => {
      const wait = Math.max(0, minDisplay - (performance.now() - start));
      setTimeout(() => loader.classList.add('is-hidden'), wait);
    };
    if (document.readyState === 'complete') hide();
    else window.addEventListener('load', hide);
    setTimeout(() => loader.classList.add('is-hidden'), 3000); // safety net
  }

  /* ---------- Three.js scenes ---------- */
  function mountScenes() {
    if (!window.THREE || !window.SceneRegistry) return;

    const heroCanvas = document.querySelector('#hero-canvas');
    if (heroCanvas) {
      const wrapper = document.querySelector('.hero-pin-wrapper');
      window.SceneRegistry.mount('intelligenceField', heroCanvas, { pinnedContainer: wrapper });
    }

    const aboutCanvas = document.querySelector('#about-canvas');
    if (aboutCanvas) {
      const target = aboutCanvas.closest('.about-visual') || aboutCanvas;
      window.SceneRegistry.mount('dataCore', aboutCanvas, { getProgress: window.SceneRegistry.makeRevealProgress(target) });
    }

    const constellationCanvas = document.querySelector('#constellation-canvas');
    if (constellationCanvas) {
      window.SceneRegistry.mount('constellation', constellationCanvas, { parallax: true });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    renderContent();
    renderMembers();
    setupNav();
    setupMobileMenu();
    setupCursor();
    setupMagneticButtons();
    setupReveal();
    setupPageTransition();
    setupLoader();
    try { mountScenes(); } catch (err) { console.warn('3D scenes failed to mount:', err); }
  });
})();
