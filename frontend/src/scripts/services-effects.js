// Services page motion — ONE continuous scrubbed narrative on a fixed stage.
// Vertical scroll (smoothed by Lenis) scrubs a master GSAP timeline: each section owns a
// stretch of scroll and its gallery IS the motion — Real-Time flows right→left, Screens
// bottom→top, with overlapping hand-offs (no crossfades, no snapping). A thin onUpdate drives
// the things that aren't plain tweens: the WebGL field dissolve, the orbit's scroll-driven
// spin speed, and edge-triggered chrome (bar scramble + baseline-rise reveals). Mixed Reality
// and Equipment reveal on entry. The on-load intro lives in the controller (playIntro()).
// @ts-nocheck
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { CustomEase } from 'gsap/CustomEase';

gsap.registerPlugin(ScrollTrigger, CustomEase);
CustomEase.create('aboutEase', 'M0,0 C0.05,0.89 0,0.99 1,1'); // homepage About easing

let mounted = false;
// True while a programmatic deep-link scroll (lenis.scrollTo) is in flight — the
// orbit ignores scroll velocity during it, so a jump's huge instantaneous
// velocity never spikes the ring's spin. Cleared when the jump settles.
let progScroll = false;
const SLUGS = ['real-time-content', 'screens-production', 'mixed-reality', 'equipment-rental'];
const ANCHOR = { 'real-time-content': 0.16, 'screens-production': 0.48, 'mixed-reality': 0.74, 'equipment-rental': 0.94 };
const ABOUT_EASE = 'cubic-bezier(0.05,0.89,0,0.99)';

// Timeline / section tuning (progress 0..1).
const RTC = { start: 0.06, travel: 0.16, stag: 0.016 };  // fly-across: fast + staggered
const SCR = { start: 0.36, travel: 0.17, stag: 0.012 };  // rise bottom→top (tighter vertical spacing)
const MIX = [0.60, 0.86];             // orbit section (scroll drives ring speed)
const B = [0.06, 0.34, 0.60, 0.86];   // section ENTER — bar scramble + rise + field dissolve
const R = [0.08, 0.36, 0.62, 0.88];   // text REVEAL — as soon as the first images enter view (just past B)
const HYST = 0.012;                   // tighter dead-band → crisper hand-offs
// depth layers for parallax (back → front): different reach (speed) + scale
const LAYERS = [
  { reach: 1.00, scale: 0.88, z: 1 },   // smallest — was 0.68 (+30%)
  { reach: 1.20, scale: 1.10, z: 2 },   // 2nd — was 0.90 (+22%)
  { reach: 1.42, scale: 1.12, z: 3 },   // largest — unchanged (keeps the depth hero on top)
];

const ORBIT_BASE = 0.05;              // deg/ms baseline spin
const ORBIT_MAX = 0.55;               // deg/ms cap when scrolling hard
const DEG2RAD = Math.PI / 180;
// Geometry follows the madewithgsap effect-061 tutorial (services.css): perspective 50vw, image
// translateZ(-50vw), transform-origin 50% 0 50vw — the camera sits at the ring's front edge, so an
// image rotating to the front reaches the camera plane and balloons to infinity → the hard clip/pop
// off the left/right edges. We keep that immersive camera but FADE each image out as it sweeps to the
// front, so it drifts away instead of clipping. All vw-based, so it behaves the same at any width.
// (Spin stays AOIN's scroll-velocity ticker below: baseline spin + faster while you scroll.)
const ORBIT_R_VW = 0.50;              // ring radius (matches translateZ -50vw)
const ORBIT_P_VW = 0.50;              // perspective (matches services.css perspective:50vw)
const ORBIT_FADE_NEAR = 0.14;         // image fully gone once within this (vw) of the camera (~mag 3.5x)
const ORBIT_FADE_SPAN = 0.16;         // fades over this vw span just before that

const reduce = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const inv = (p, a, b) => clamp01((p - a) / (b - a));
const seeded = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/* Clip reveal — text emerges from behind a line. Wrap the element's content in an inner span,
   clip the element (overflow:hidden), and slide the inner up from translateY(110%). Driven with
   gsap (predictable inline styles) since these reveal/hide repeatedly per section. */
function ensureClip(el) {
  if (el.__inner) return el.__inner;
  const cs = getComputedStyle(el);
  const inner = document.createElement('span');
  const isFlex = cs.display.indexOf('flex') !== -1;
  inner.style.display = isFlex ? 'inline-flex' : 'block';
  if (isFlex) { inner.style.alignItems = cs.alignItems; inner.style.gap = cs.gap; }
  inner.style.willChange = 'transform';
  while (el.firstChild) inner.appendChild(el.firstChild);
  el.appendChild(inner);
  el.style.overflow = 'hidden';
  el.__inner = inner;
  return inner;
}
function revealUp(el, delay = 0, dur = 0.82) {
  if (!el) return;
  const inner = ensureClip(el);
  gsap.killTweensOf(inner);
  gsap.set(el, { autoAlpha: 1 }); // show the box (its scrim bg) — hidden boxes would stack + cover
  if (reduce()) { gsap.set(inner, { yPercent: 0 }); return; }
  gsap.fromTo(inner, { yPercent: 110 }, { yPercent: 0, duration: dur, delay, ease: 'aboutEase', overwrite: true });
}
function hideEl(el) {
  if (!el) return;
  const inner = ensureClip(el);
  gsap.killTweensOf(inner);
  gsap.set(inner, { yPercent: 110 });
  gsap.set(el, { autoAlpha: 0 }); // fully hide the box so its background can't cover the active one
}
/* opacity fallback for elements that can't be clip-wrapped (the equipment copy swaps its own
   textContent on hover, which would destroy an inner wrapper) */
function showFade(el, delay = 0) {
  if (!el) return;
  gsap.killTweensOf(el);
  if (reduce()) { gsap.set(el, { autoAlpha: 1, y: 0 }); return; }
  gsap.fromTo(el, { autoAlpha: 0, y: 22 }, { autoAlpha: 1, y: 0, duration: 0.7, delay, ease: 'aboutEase', overwrite: true });
}
function hideFade(el) {
  if (!el) return;
  gsap.killTweensOf(el);
  gsap.set(el, { autoAlpha: 0 });
}

export function mountEffects(ctrl) {
  if (mounted || (typeof window !== 'undefined' && window.__aoinSvcEffects)) return;
  mounted = true;
  if (typeof window !== 'undefined') window.__aoinSvcEffects = true;
  if (typeof history !== 'undefined' && 'scrollRestoration' in history) history.scrollRestoration = 'manual';

  const root = document.querySelector('[data-root]');
  const track = document.querySelector('[data-track]');
  const scrollDist = document.querySelector('[data-scroll]');
  if (!root || !track || !scrollDist) return;

  const field = root.querySelector('[data-ascii]');
  const bar = root.querySelector('[data-bar]');
  const hint = root.querySelector('[data-hint]');
  const panels = [...root.querySelectorAll('[data-svc-panel]')]; // 4: RTC, Screens, Mixed, Equip (data-i 0..3)
  const navRows = [...root.querySelectorAll('[data-svc-jump]')];

  const lenis = new Lenis({ autoRaf: false });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);

  // Build the scrubbed galleries onto one master timeline; Mixed/Equip reveal on entry.
  const master = gsap.timeline({ paused: true });
  buildRealtime(root, master);
  buildScreens(root, master);
  const orbit = buildMixed(root); // { setBoost, assemble, show(v) }
  initEquipment(root);
  master.to({ v: 0 }, { v: 1, duration: 0.001 }, 0.999); // pin master duration to 1 (progress == time)

  // ---- chrome helpers --------------------------------------------------------------
  const titleRow = () => { const a = root.querySelector('[data-title-a]'); return a && a.parentElement; };
  const activeTop = () => {
    const tr = titleRow();
    if (!tr) return 200;
    return Math.round(tr.getBoundingClientRect().bottom - root.getBoundingClientRect().top + 20);
  };
  const descOf = (i) => panels[i] && panels[i].querySelector('[data-desc]');
  const equipEl = panels[3] && panels[3].querySelector('.equip');
  const revealDesc = (i) => { if (i === 3) showFade(descOf(i)); else revealUp(descOf(i)); };
  const hideDesc = (i) => { if (i === 3) hideFade(descOf(i)); else hideEl(descOf(i)); };

  let lastSection = -2;
  let lastReveal = -2;
  const dissState = { t: 0 };
  const sectionFor = (p) => {
    let s = -1;
    for (let i = 0; i < 4; i++) if (p >= B[i]) s = i;
    if (s !== lastSection && s >= 0 && lastSection >= 0) {
      if (s > lastSection && p < B[s] + HYST) s = lastSection;       // moving forward
      else if (s < lastSection && p > B[lastSection] - HYST) s = lastSection; // moving back
    }
    return s;
  };

  // Field dissolve rides the bar rise: same ~0.9s one-shot, gone in any section, back at the hero.
  const setDissolve = (v) => {
    gsap.killTweensOf(dissState);
    gsap.to(dissState, { t: v, duration: 0.9, ease: 'aboutEase', onUpdate: () => ctrl.dissolveField && ctrl.dissolveField(dissState.t) });
  };

  // Section ENTER: bar scramble + rise, scrim, pointer-events, orbit/equip visibility, dissolve.
  const driveSection = (p) => {
    const s = sectionFor(p);
    if (s === lastSection) return;
    const prev = lastSection;
    lastSection = s;
    panels.forEach((pan, i) => {
      pan.classList.toggle('is-lit', (i === s) && (i === 0 || i === 1));
      pan.style.pointerEvents = i === s ? 'auto' : 'none';
    });
    if (!(prev === -2 && s === -1)) ctrl.setActiveService && ctrl.setActiveService(s);
    if (bar) bar.style.top = s < 0 ? '52vh' : activeTop() + 'px'; // hero: mid-viewport; section: risen tight under the title
    navRows.forEach((r) => r.classList.toggle('is-active', +r.dataset.i === s));
    if (hint) hint.classList.toggle('is-hidden', s >= 0);
    orbit.show(s === 2 ? 1 : 0);
    if (s === 2 && prev !== 2) orbit.assemble();
    if (equipEl) gsap.to(equipEl, { autoAlpha: s === 3 ? 1 : 0, duration: 0.4, overwrite: 'auto' });
    const nowSec = s >= 0, wasSec = prev >= 0;
    if (nowSec !== wasSec) {
      setDissolve(nowSec ? 1 : 0);
      // Hero: the capability bar carries the animated shine + is clickable. In a section it goes
      // solid white + non-interactive (only the global nav and bottom-right nav stay clickable).
      if (ctrl.setBarInteractive) ctrl.setBarInteractive(!nowSec);
    }
  };

  // Text REVEAL (clip): held back until the section's images are in view (p past R[s]).
  const driveReveal = (p) => {
    const s = lastSection;
    const r = (s >= 0 && p >= R[s]) ? s : -1;
    if (r === lastReveal) return;
    const prev = lastReveal;
    lastReveal = r;
    if (prev >= 0) hideDesc(prev);
    if (r >= 0) {
      revealDesc(r);
      navRows.forEach((row, i) => revealUp(row, 0.12 + i * 0.07, 0.66)); // nav debut / re-reveal
    } else {
      navRows.forEach(hideEl);
    }
  };

  const hideAllReveals = () => { [0, 1, 2, 3].forEach(hideDesc); navRows.forEach(hideEl); };

  // ---- the single trigger ----------------------------------------------------------
  // We scrub the master timeline MANUALLY from self.progress (already smoothed by Lenis) so the
  // galleries, field dissolve, orbit speed, and chrome all share one synced source of truth.
  const st = ScrollTrigger.create({
    trigger: scrollDist,
    start: 'top top',
    end: 'bottom bottom',
    onUpdate: (self) => {
      const p = self.progress;
      master.progress(p);
      orbit.setBoost(p, progScroll ? 0 : self.getVelocity());
      driveSection(p);
      driveReveal(p);
    },
    onRefresh: (self) => {
      master.invalidate();
      master.progress(self.progress);
      if (ctrl.dissolveField) ctrl.dissolveField(dissState.t);
    },
  });

  // initial hero paint
  master.progress(0);
  if (equipEl) gsap.set(equipEl, { autoAlpha: 0 });
  hideAllReveals();
  driveSection(0);
  driveReveal(0);

  ScrollTrigger.refresh();
  initNav(lenis, st);

  // Lock scroll while the on-load intro plays (unless we're deep-linking straight in).
  const hasDeepLink = location.hash && SLUGS.includes(location.hash.replace(/^#/, ''));
  if (!hasDeepLink) {
    lenis.scrollTo(0, { immediate: true });
    lenis.stop();
    const start = () => lenis.start();
    window.addEventListener('services:introdone', start, { once: true });
    setTimeout(start, 2600); // fallback in case the intro never signals
  }

  let reFit = null;
  window.addEventListener('resize', () => {
    if (bar) bar.style.top = lastSection < 0 ? '52vh' : activeTop() + 'px';
    clearTimeout(reFit);
    reFit = setTimeout(() => { ScrollTrigger.refresh(); }, 220); // onRefresh re-applies the dissolve
  });
  window.addEventListener('pageshow', (e) => { if (e && e.persisted) ScrollTrigger.refresh(); });
}

/* ---- REAL-TIME CONTENT — mwg_083 fly-across (scrubbed R→L, parallax depth) ------- */
function buildRealtime(root, master) {
  const el = root.querySelector('.mwg_effect083');
  if (!el) return;
  const medias = [...el.querySelectorAll('.media')];
  const n = medias.length;
  const mob = window.innerWidth < 768;
  medias.forEach((m, i) => {
    const L = LAYERS[i % LAYERS.length];             // depth: reach (speed) + scale
    const lane = (i * 7) % n;                         // shuffle into evenly-spread vertical lanes
    // Keep the stream in a centred band so large stills don't hang off the top/bottom edges
    // (the top lane used to sit at 5% and get cropped). Phones stay in a tighter mid band.
    const top = (mob ? 36 : 22) + (lane / Math.max(1, n - 1)) * (mob ? 40 : 54);
    const scale = mob ? L.scale * 0.72 : L.scale;
    const fromX = () => window.innerWidth * L.reach + 140;
    const toX = () => -window.innerWidth * L.reach - 140;
    gsap.set(m, { top: top.toFixed(2) + '%', yPercent: -50, zIndex: L.z, scale, x: fromX });
    master.fromTo(m, { x: fromX }, { x: toX, ease: 'none', duration: RTC.travel }, RTC.start + i * RTC.stag);
  });
}

/* ---- SCREENS PRODUCTION — mwg_051 (scrubbed bottom→top, spread + parallax) ------- */
function buildScreens(root, master) {
  const el = root.querySelector('.mwg_effect051');
  if (!el) return;
  const medias = [...el.querySelectorAll('.media')];
  const n = medias.length;
  const mob = window.innerWidth < 768;
  // Columns are distributed CENTRED across the width so the composition never clusters to one side
  // (the old lane/(n-1) under-normalised → left-biased, empty right half on ultrawide). Use the unique
  // lane set as the columns and the MEASURED image width (it's clamped in px, so on ultrawide it's a
  // small % — centring must account for that) to keep equal gutters left and right.
  const uniq = [...new Set(medias.map((_, i) => (i * 3) % n))].sort((a, b) => a - b);
  const nc = uniq.length;
  const sampleW = medias[0] ? medias[0].getBoundingClientRect().width : window.innerWidth * 0.22;
  const imgPct = (sampleW / window.innerWidth) * 100;      // actual image width as % of viewport
  const MARGIN = mob ? 4 : 6;                               // % gutter from the viewport edge to the outer image
  const travel = Math.max(0, 100 - 2 * MARGIN - imgPct);   // left-edge range so images span MARGIN..(100-MARGIN)
  medias.forEach((m, i) => {
    const L = LAYERS[i % LAYERS.length];
    const col = uniq.indexOf((i * 3) % n);                  // 0..nc-1 (which centred column)
    const t = nc > 1 ? col / (nc - 1) : 0.5;
    const left = MARGIN + t * travel;
    const scale = mob ? L.scale * 0.78 : L.scale;
    const fromY = () => window.innerHeight * L.reach + 120;
    const toY = () => -window.innerHeight * L.reach - 120;
    gsap.set(m, { left: left.toFixed(2) + '%', zIndex: L.z, scale, y: fromY });
    master.fromTo(m, { y: fromY }, { y: toY, ease: 'none', duration: SCR.travel }, SCR.start + i * SCR.stag);
  });
}

/* ---- MIXED REALITY — mwg_061 orbit: assembles, self-runs, scroll drives speed --- */
function buildMixed(root) {
  const el = root.querySelector('.mwg_effect061');
  if (!el) return { setBoost() {}, assemble() {}, show() {} };
  const container = el.querySelector('.container');
  const medias = [...el.querySelectorAll('img')];
  const angle = 360 / medias.length;
  // Ring centred at the container origin (no push-back). The camera is inside the ring — see the
  // ORBIT_* constants. Each image sits at translateZ(-50vw) rotated to its slot.
  medias.forEach((m, i) => gsap.set(m, { z: '-50vw', rotationY: angle * i }));
  gsap.set(el, { autoAlpha: 0 });

  // one ticker writer integrates angular velocity into rotationY (baseline spin + scroll boost)
  let orbitRot = 0, angVel = ORBIT_BASE, targetVel = ORBIT_BASE;
  gsap.ticker.add((t, dt) => {
    // Always ease the boost target back toward baseline. Scroll bumps it UP
    // (setBoost); this pulls it DOWN every frame — so when scrolling stops
    // (including a programmatic jump that fires no further onUpdate) the ring
    // can never stay stuck at a peak velocity, it settles to its resting spin.
    targetVel += (ORBIT_BASE - targetVel) * 0.05;
    angVel += (targetVel - angVel) * 0.08;
    orbitRot += angVel * (dt || 16);
    gsap.set(container, { rotationY: orbitRot });
    // Drift fade: d = an image's distance in front of the camera (vw). As it sweeps to the front
    // (d → 0) it would balloon and clip off the edges, so fade it out over the last band first.
    for (let i = 0; i < medias.length; i++) {
      const d = ORBIT_P_VW + ORBIT_R_VW * Math.cos((angle * i + orbitRot) * DEG2RAD);
      medias[i].style.opacity = String(clamp01((d - ORBIT_FADE_NEAR) / ORBIT_FADE_SPAN));
    }
  });

  // mouse/touch tilt (rotationX — a different prop, no conflict with the spin)
  const clampX = gsap.utils.clamp(0, 1);
  const rotX = gsap.quickTo(container, 'rotationX', { duration: 1, ease: 'power2' });
  const tilt = (cx) => rotX((clampX(cx / window.innerWidth) * 2 - 1) * 10);
  el.addEventListener('mousemove', (e) => tilt(e.clientX));
  el.addEventListener('touchmove', (e) => { if (e.touches && e.touches[0]) tilt(e.touches[0].clientX); }, { passive: true });

  return {
    setBoost(p, vel) {
      // Only RAISE the target from scroll speed (inside the mixed section); the
      // ticker eases it back down. vel arrives as 0 during programmatic jumps,
      // so a deep-link never bumps the spin.
      if (p >= MIX[0] && p <= MIX[1]) {
        const v = Math.min(ORBIT_BASE + Math.abs(vel) * 0.00006, ORBIT_MAX);
        if (v > targetVel) targetVel = v;
      }
    },
    assemble() {
      // Scale-only — per-image opacity is owned by the ticker's drift fade; the section fades in via
      // show(). Animating autoAlpha here would fight that fade.
      gsap.fromTo(
        medias,
        { scale: 0 },
        { scale: 1, ease: 'power3.out', duration: 0.9, stagger: { each: 0.05, from: 'random' }, overwrite: true }
      );
    },
    show(v) { gsap.to(el, { autoAlpha: v, duration: 0.35, overwrite: 'auto' }); },
  };
}

/* ---- EQUIPMENT RENTAL — a draggable one-line fleet marquee -----------------------
   The list is a single horizontal strip that's static until dragged. Whichever name is
   nearest page-center is the "active" one; dragging it past center swaps the plate + body
   copy. Release snaps the active name to dead-center (a decisive swipe advances by one). */
function initEquipment(root) {
  const wrap = root.querySelector('.equip');
  if (!wrap) return;
  const scope = wrap.closest('[data-svc-panel]') || root;
  const marquee = scope.querySelector('[data-equip-marquee]');
  const track = scope.querySelector('[data-equip-track]');
  const rows = [...scope.querySelectorAll('[data-equip-row]')];
  const img = scope.querySelector('[data-equip-img]');
  const plate = scope.querySelector('[data-equip-plate]');
  const ph = scope.querySelector('[data-equip-ph]');
  const copy = scope.querySelector('[data-equip-copy]');
  if (!marquee || !track || !rows.length) return;

  // The item to sit on the playhead when the section opens (falls back to the first).
  const defaultIdx = Math.max(0, rows.findIndex((r) => r.dataset.center === 'true'));
  let trackX = 0, activeIdx = -1, imgT = null;
  const clampU = gsap.utils.clamp;
  const centerOf = (i) => rows[i].offsetLeft + rows[i].offsetWidth / 2;
  const xForIndex = (i) => marquee.clientWidth / 2 - centerOf(i);
  const bounds = () => ({ min: xForIndex(rows.length - 1), max: xForIndex(0) }); // items are in DOM order
  const setX = (x) => { trackX = x; gsap.set(track, { x }); };
  const nearest = () => {
    const cp = marquee.clientWidth / 2 - trackX; // page-center expressed in track space
    let best = 0, bd = Infinity;
    for (let i = 0; i < rows.length; i++) { const d = Math.abs(centerOf(i) - cp); if (d < bd) { bd = d; best = i; } }
    return best;
  };
  // Paint the plate for a row: real items show their image; placeholder items show a
  // labelled placeholder box (the data has no plate asset yet — pending the CMS).
  const setPlate = (r) => {
    const isPh = r.dataset.placeholder === 'true';
    if (plate) plate.classList.toggle('is-placeholder', isPh);
    if (ph) ph.textContent = isPh ? r.textContent : '';
    if (!img) return;
    if (isPh) { img.removeAttribute('src'); img.style.opacity = '0'; }
    else { img.src = r.dataset.img; img.style.opacity = '1'; }
  };
  const swap = (i, immediate) => {
    if (i === activeIdx) return;
    activeIdx = i;
    rows.forEach((r, k) => r.classList.toggle('is-active', k === i));
    if (copy) copy.textContent = rows[i].dataset.tip;
    if (immediate) { setPlate(rows[i]); return; }
    if (img) img.style.opacity = '0';
    clearTimeout(imgT);
    imgT = setTimeout(() => setPlate(rows[i]), 150);
  };
  const snapTo = (i, dur = 0.55) => {
    const b = bounds();
    const x = clampU(b.min, b.max, xForIndex(i));
    gsap.to(track, {
      x, duration: dur, ease: 'power3.out',
      onUpdate: () => { trackX = +gsap.getProperty(track, 'x'); const n = nearest(); if (n !== activeIdx) swap(n); },
      onComplete: () => { trackX = x; swap(i); },
    });
  };

  // Center the default item (CUSTOM RACK BUILDS) once fonts — and thus item widths — settle.
  const center = () => { const i = activeIdx < 0 ? defaultIdx : activeIdx; setX(xForIndex(i)); swap(i, true); };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(center); else center();
  window.addEventListener('resize', () => { const i = activeIdx < 0 ? defaultIdx : activeIdx; setX(clampU(bounds().min, bounds().max, xForIndex(i))); });

  // pointer drag (touch-action:pan-y in CSS lets vertical page scroll pass through)
  let dragging = false, downX = 0, startX = 0, lastX = 0, lastT = 0, vel = 0, moved = 0;
  const down = (e) => {
    dragging = true; downX = lastX = e.clientX; startX = trackX; vel = 0; moved = 0; lastT = performance.now();
    gsap.killTweensOf(track);
    marquee.classList.add('is-grabbing');
    if (marquee.setPointerCapture) try { marquee.setPointerCapture(e.pointerId); } catch (_) {}
  };
  const move = (e) => {
    if (!dragging) return;
    const b = bounds();
    let x = startX + (e.clientX - downX);
    if (x > b.max) x = b.max + (x - b.max) * 0.35;        // rubber-band past the ends
    else if (x < b.min) x = b.min + (x - b.min) * 0.35;
    setX(x);
    const now = performance.now(), dt = now - lastT;
    if (dt > 0) vel = (e.clientX - lastX) / dt;           // px/ms
    lastX = e.clientX; lastT = now; moved = Math.abs(e.clientX - downX);
    const n = nearest(); if (n !== activeIdx) swap(n);
  };
  // which name's center is nearest a given viewport x (for tap-to-select)
  const itemAtClientX = (x) => {
    let best = 0, bd = Infinity;
    rows.forEach((r, i) => { const b = r.getBoundingClientRect(); const d = Math.abs(b.left + b.width / 2 - x); if (d < bd) { bd = d; best = i; } });
    return best;
  };
  const up = (e) => {
    if (!dragging) return; dragging = false;
    marquee.classList.remove('is-grabbing');
    if (marquee.releasePointerCapture && e.pointerId != null) try { marquee.releasePointerCapture(e.pointerId); } catch (_) {}
    // A tap (no real movement) selects the name under the pointer; a drag snaps to center (a flick
    // advances one). Tap is handled here — not via a row 'click' listener — because pointer capture
    // routes the click to the marquee, so per-row click handlers never fire.
    let target;
    if (moved < 5) target = itemAtClientX(e.clientX);
    else { target = nearest(); if (Math.abs(vel) > 0.35) target += vel < 0 ? 1 : -1; }
    snapTo(clampU(0, rows.length - 1, target));
  };
  marquee.addEventListener('pointerdown', down);
  marquee.addEventListener('pointermove', move);
  marquee.addEventListener('pointerup', up);
  marquee.addEventListener('pointercancel', up);
}

/* ---- Service nav + deep links (homepage → a section; intro labels → scroll) ----- */
function initNav(lenis, st) {
  if (typeof window !== 'undefined') { window.__aoinLenis = lenis; window.__aoinST = st; }
  const targetFor = (slug) => st.start + (ANCHOR[slug] || 0) * (st.end - st.start);
  const jump = (slug, immediate) => {
    // Flag the jump so the orbit ignores its velocity spike, and clear the flag
    // once the scroll settles (onComplete for the eased jump; next frame for an
    // immediate one, which fires no onComplete).
    progScroll = true;
    const clear = () => { progScroll = false; };
    lenis.scrollTo(targetFor(slug), immediate ? { immediate: true, onComplete: clear } : { duration: 1.1, onComplete: clear });
    if (immediate) requestAnimationFrame(clear);
    clearTimeout(jump._t);
    jump._t = setTimeout(clear, 1400); // safety net
  };

  document.querySelectorAll('[data-svc-jump]').forEach((b) => {
    b.addEventListener('click', () => jump(SLUGS[+b.dataset.i]));
  });
  window.addEventListener('services:scrollto', (e) => {
    const slug = e && e.detail && e.detail.slug;
    if (SLUGS.includes(slug)) jump(slug);
  });

  const slug = location.hash ? location.hash.replace(/^#/, '') : '';
  if (SLUGS.includes(slug)) {
    const land = () => { ScrollTrigger.refresh(); jump(slug, true); };
    const settle = () => { land(); setTimeout(land, 260); setTimeout(land, 720); };
    if (document.readyState === 'complete') settle();
    else window.addEventListener('load', settle, { once: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => setTimeout(land, 120));
  }
}
