/* ============================================================
   MEMBERS PAGE — hierarchy renderer
   ------------------------------------------------------------
   Owns #members-hierarchy end to end. Reads window.SiteMembers
   and window.SiteMembers.sections (js/data/members.js) and is the
   single source of DOM for every member card — no card is ever
   hand-written in members.html.

   Why this file exists as its own script rather than living in
   main.js: main.js wasn't provided for this task, so rather than
   guess at its internals (or risk two renderers fighting over the
   same container), this script clears #members-hierarchy itself
   before building, and is loaded last in members.html. That makes
   it safe regardless of what main.js does or doesn't already do
   with that container — if it renders something first, this
   overwrites it cleanly; if it renders nothing, this is the only
   renderer. If your main.js DOES already populate
   #members-hierarchy, you can safely delete that code — this file
   fully replaces it for this page.

   Card geometry is guaranteed uniform here, not just in CSS:
   every card gets the exact same markup shape (photo, then
   absolutely-positioned info, then optional absolutely-positioned
   blurb), so the CSS rule "one grid, one card width, height set
   only by the photo's aspect-ratio" always has identical inputs
   to work with, regardless of role.
   ============================================================ */
(function () {
  'use strict';

  if (document.body.dataset.page !== 'members') return;

  var root = document.getElementById('members-hierarchy');
  if (!root || !window.SiteMembers || !Array.isArray(window.SiteMembers.sections)) return;

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(pointer: fine)').matches;
  var MAX_TILT = 6; // degrees, matches --mp-tilt in css/style.css

  // ---- start clean, regardless of anything already in the container ----
  root.innerHTML = '';
  root.classList.add('mp-hierarchy');

  // ---- neural backbone connector ----
  var backbone = document.createElement('div');
  backbone.className = 'mp-backbone';
  backbone.setAttribute('aria-hidden', 'true');
  if (!reduceMotion) {
    var pulse = document.createElement('span');
    pulse.className = 'mp-backbone-pulse';
    backbone.appendChild(pulse);
  }
  root.appendChild(backbone);

  // ---- hero meta line: a genuine, data-derived line, not filler copy ----
  var totalMembers = 0;
  window.SiteMembers.sections.forEach(function (s) {
    var list = window.SiteMembers[s.key];
    if (Array.isArray(list)) totalMembers += list.length;
  });
  var metaEl = document.getElementById('members-hero-meta');
  if (metaEl) {
    metaEl.textContent = totalMembers === 1
      ? 'One person currently leads the association.'
      : totalMembers + ' people currently lead the association, across ' +
        window.SiteMembers.sections.filter(function (s) {
          return Array.isArray(window.SiteMembers[s.key]) && window.SiteMembers[s.key].length;
        }).length + ' roles.';
  }

  // ---- build each section ----
  var globalIndex = 0;

  window.SiteMembers.sections.forEach(function (section, sIdx) {
    var members = window.SiteMembers[section.key];
    if (!Array.isArray(members) || members.length === 0) return;

    var sectionEl = document.createElement('section');
    sectionEl.className = 'mp-section';
    sectionEl.dataset.size = section.size || 'md'; // kept for compatibility + ambient hooks only
    sectionEl.setAttribute('aria-labelledby', 'mp-label-' + section.key);

    var inner = document.createElement('div');
    inner.className = 'container mp-section-inner';

    var head = document.createElement('header');
    head.className = 'mp-section-head';
    head.innerHTML =
      '<span class="mp-section-index">' + String(sIdx + 1).padStart(2, '0') + '</span>' +
      '<span class="mp-section-rule" aria-hidden="true"></span>' +
      '<h2 class="mp-section-label" id="mp-label-' + section.key + '">' + escapeHtml(section.label) + '</h2>' +
      '<span class="mp-section-rule" aria-hidden="true"></span>';
    inner.appendChild(head);

    var grid = document.createElement('div');
    grid.className = 'mp-grid';
    grid.dataset.size = section.size || 'md';

    members.forEach(function (member, mIdx) {
      globalIndex += 1;
      var num = String(globalIndex).padStart(2, '0');

      var card = document.createElement('article');
      card.className = 'mp-card';
      card.style.setProperty('--mp-i', String(mIdx % 6));
      card.tabIndex = 0;

      var cardInner = document.createElement('div');
      cardInner.className = 'mp-card-inner';

      // photo — the ONLY in-flow child; everything else is an overlay
      var photo = document.createElement('div');
      photo.className = 'mp-card-photo';

      var img = document.createElement('img');
      img.src = member.image;
      img.alt = member.name + ', ' + member.role;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.addEventListener('error', function onErr() {
        img.removeEventListener('error', onErr);
        img.remove();
        var fb = document.createElement('div');
        fb.className = 'mp-photo-fallback';
        fb.setAttribute('aria-hidden', 'true');
        fb.textContent = initials(member.name);
        photo.appendChild(fb);
      });
      photo.appendChild(img);

      var corners = document.createElement('div');
      corners.className = 'mp-card-corners';
      corners.setAttribute('aria-hidden', 'true');
      corners.innerHTML = '<span></span><span></span><span></span><span></span>';
      photo.appendChild(corners);

      cardInner.appendChild(photo);

      // info overlay
      var info = document.createElement('div');
      info.className = 'mp-card-info';
      info.innerHTML =
        '<span class="mp-card-num">/' + num + '</span>' +
        '<span class="mp-card-accent" aria-hidden="true"></span>' +
        '<h3 class="mp-card-name">' + escapeHtml(member.name) + '</h3>' +
        '<p class="mp-card-role">' + escapeHtml(member.role) + '</p>';
      cardInner.appendChild(info);

      // blurb overlay — only added when present, never affects card height
      if (member.blurb) {
        var blurb = document.createElement('p');
        blurb.className = 'mp-card-blurb';
        blurb.textContent = member.blurb;
        cardInner.appendChild(blurb);
      }

      card.appendChild(cardInner);
      grid.appendChild(card);

      if (finePointer && !reduceMotion) bindTilt(card);
    });

    inner.appendChild(grid);
    sectionEl.appendChild(inner);
    root.appendChild(sectionEl);
  });

  // ---- helpers ----
  function initials(name) {
    return (name || '').trim().split(/\s+/).slice(0, 2)
      .map(function (n) { return n.charAt(0); })
      .join('')
      .toUpperCase();
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function bindTilt(card) {
    function onMove(e) {
      var rect = card.getBoundingClientRect();
      var px = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      var py = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
      var rx = (0.5 - py) * MAX_TILT * 2;
      var ry = (px - 0.5) * MAX_TILT * 2;
      card.style.setProperty('--rotate-x', rx.toFixed(2) + 'deg');
      card.style.setProperty('--rotate-y', ry.toFixed(2) + 'deg');
      card.style.setProperty('--mouse-x', (px * 100).toFixed(1) + '%');
      card.style.setProperty('--mouse-y', (py * 100).toFixed(1) + '%');
    }
    function onLeave() {
      card.style.setProperty('--rotate-x', '0deg');
      card.style.setProperty('--rotate-y', '0deg');
    }
    card.addEventListener('pointermove', onMove);
    card.addEventListener('pointerleave', onLeave);
    card.addEventListener('blur', onLeave);
  }

  // ---- scroll-in reveal: a dedicated observer for these injected
  // nodes, independent of whatever main.js's sitewide `.reveal`
  // observer already scanned for at load time ----
  var targets = root.querySelectorAll('.mp-section-head, .mp-card');
  if ('IntersectionObserver' in window && !reduceMotion) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
    targets.forEach(function (t) { io.observe(t); });
  } else {
    targets.forEach(function (t) { t.classList.add('is-visible'); });
  }

  // ---- pause tilt/scan work when the tab is hidden ----
  document.addEventListener('visibilitychange', function () {
    root.classList.toggle('mp-paused', document.hidden);
  });
})();