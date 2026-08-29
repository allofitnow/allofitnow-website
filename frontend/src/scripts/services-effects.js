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
// Deep-link / center-button jump targets — land a little INTO each section (past its B[] enter
// threshold, first images already partly in view) — between top-of-section and the old mid feel.
const ANCHOR = { 'real-time-content': 0.11, 'screens-production': 0.36, 'mixed-reality': 0.55, 'equipment-rental': 0.90 };
const ABOUT_EASE = 'cubic-bezier(0.05,0.89,0,0.99)';

// Timeline / section tuning (progress 0..1).
const RTC = { start: 0.06, travel: 0.16, stag: 0.013 };  // fly-across: fast + staggered (slightly grouped)
const SCR = { start: 0.31, travel: 0.17, stag: 0.010 };  // rise bottom→top — starts earlier so it OVERLAPS RTC's tail (no dead zone)
const MIX = [0.50, 0.86];             // orbit section (pulled 0.55→0.50 — assembles while Screens' tail still clears, no dead gap)
const B = [0.06, 0.31, 0.50, 0.86];   // section ENTER — bar scramble + rise + field dissolve (Mixed pulled earlier to overlap Screens' exit)
const R = [0.08, 0.36, 0.52, 0.88];   // text REVEAL — as soon as the first images enter view (just past B; Mixed follows its earlier B[2])
const HYST = 0.012;                   // tighter dead-band → crisper hand-offs
// depth layers for parallax (back → front): different reach (speed) + scale
const LAYERS = [
  { reach: 1.00, scale: 1.00, z: 1 },   // smallest — floor raised 0.88 → 1.00 (never below base size now)
  { reach: 1.20, scale: 1.16, z: 2 },   // 2nd — raised 1.10 → 1.16
  { reach: 1.42, scale: 1.22, z: 3 },   // largest — 1.12 → 1.22 to stay the depth hero above the raised 2nd
];

const ORBIT_BASE = 0.015;             // deg/ms baseline spin (slower idle rotation)
const ORBIT_MAX = 0.16;               // deg/ms cap when scrolling hard (lowered — scroll no longer whips the ring)
const DEG2RAD = Math.PI / 180;
// Geometry follows the madewithgsap effect-061 tutorial (services.css): perspective 50vw, image
// translateZ(-50vw), transform-origin 50% 0 50vw — the camera sits at the ring's front edge, so an
// image rotating to the front reaches the camera plane and balloons to infinity → the hard clip/pop
// off the left/right edges. We keep that immersive camera but FADE each image out as it sweeps to the
// front, so it drifts away instead of clipping. All vw-based, so it behaves the same at any width.
// (Spin stays AOIN's scroll-velocity ticker below: baseline spin + faster while you scroll.)
const ORBIT_R_VW = 0.50;              // ring radius (matches translateZ -50vw)
const ORBIT_P_VW = 0.50;              // perspective (matches services.css perspective:50vw)
// Fade a front-sweeping image out EARLIER (larger d) so it never composites at the huge
// magnification that tanks the GPU to 30fps — at scale 2.2 a d=0.14 balloon hit ~170 MPx of
// video overdraw. Gone by d=0.24 (~mag 2.1×) instead of 0.14 (~3.6×) caps the worst overdraw.
const ORBIT_FADE_NEAR = 0.24;         // image fully gone once within this (vw) of the camera
const ORBIT_FADE_SPAN = 0.22;         // fades over this vw span just before that
// Cap simultaneous orbit video playback. Each PLAYING clip re-composites its texture through the
// 3D perspective every frame; the profiler showed even one extra pins the section to 30fps, so
// phones (weaker GPU + limited H.264 streams) get 1 — only the front-most clip animates, the rest
// hold their last frame (reads like a still) until they rotate forward. Desktop stays generous.
const orbitMaxPlaying = () => (typeof window !== 'undefined' && window.innerWidth < 768 ? 1 : 8);

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
  // Off-stage parking positions are derived from the viewport, and the value a
  // still sits at BEFORE its tween starts is written by a gsap.set() at build
  // time -- which is not on the timeline, so master.invalidate() cannot reach
  // it. Each gallery registers how to re-park itself; onRefresh replays them.
  const reparks = [];
  buildRealtime(root, master, reparks);
  buildScreens(root, master, reparks);
  const orbit = buildMixed(root); // { setBoost, assemble, show(v) }
  const equip = initEquipment(root);
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

  // --- Deferred media: gallery stills carry their URL in data-lazysrc (not src), so
  // nothing loads until its section is reached. Without this all 4 sections' videos
  // autoplay at page load (~276MB). We stream the ACTIVE section, PRELOAD the next one
  // (so it's buffered on arrival), and PAUSE the rest — never unloading, so a fetched
  // clip is reused instead of re-downloaded.
  const sectionMedia = panels.map((pan) => [...pan.querySelectorAll('[data-lazymedia]')]);
  const loadMedia = (el) => {
    if (el && !el.getAttribute('src') && el.dataset.lazysrc) {
      el.setAttribute('src', el.dataset.lazysrc);
      if (el.tagName === 'VIDEO') { try { el.load(); } catch (_) {} }
    }
  };
  const playMedia = (el) => { loadMedia(el); if (el.tagName === 'VIDEO') { try { const p = el.play(); if (p) p.catch(() => {}); } catch (_) {} } };
  const pauseMedia = (el) => { if (el.tagName === 'VIDEO') { try { el.pause(); } catch (_) {} } };

  // Mobile decode governor. The profiler showed a hard hardware limit: >3 concurrent 2D video
  // decodes (RTC/Screens) OR >1 through the 3D orbit drop the section from 60→30fps. Phones are
  // worse. So on mobile we load every still but only PLAY the most-visible few; the rest hold
  // their last frame (they still fly/rise via transform — the motion is the layout, not the clip).
  const MOB = () => typeof window !== 'undefined' && window.innerWidth < 768;
  const visArea = (el) => {
    const b = el.getBoundingClientRect();
    const iw = Math.max(0, Math.min(b.right, window.innerWidth) - Math.max(b.left, 0));
    const ih = Math.max(0, Math.min(b.bottom, window.innerHeight) - Math.max(b.top, 0));
    return iw * ih;
  };
  // Load all `els`; keep only the `n` most on-screen videos playing, pause the rest (idempotent).
  const capPlayVideos = (els, n) => {
    const vids = [];
    els.forEach((el) => { loadMedia(el); if (el.tagName === 'VIDEO') vids.push(el); });
    vids.sort((a, b) => visArea(b) - visArea(a));
    for (let i = 0; i < vids.length; i++) {
      const want = i < n && visArea(vids[i]) > 0;
      if (want && vids[i].paused) { const p = vids[i].play(); if (p) p.catch(() => {}); }
      else if (!want && !vids[i].paused) vids[i].pause();
    }
  };
  const MOB_2D_CAP = 1; // RTC/Screens; the orbit (2) self-caps to 1 in its ticker; equip self-manages

  const setSectionMedia = (s) => {
    sectionMedia.forEach((els, i) => {
      if (i === s) {
        if (MOB() && (i === 0 || i === 1)) capPlayVideos(els, MOB_2D_CAP); // active 2D section: cap decodes
        else els.forEach(playMedia);                    // desktop, or orbit/equip (self-capped)
      } else if (i === s + 1 && s >= 0) els.forEach(loadMedia); // next: preload once we're actually in a section
      else els.forEach(pauseMedia);                     // others: pause (stay loaded once fetched)
    });
  };
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
    if (v < 1 && ctrl.setFieldAsleep) ctrl.setFieldAsleep(false); // wake BEFORE fading the field back in
    gsap.to(dissState, {
      t: v, duration: 0.9, ease: 'aboutEase',
      onUpdate: () => ctrl.dissolveField && ctrl.dissolveField(dissState.t),
      // Sleep only once fully dissolved (invisible) — the 0.9s fade itself always draws every frame.
      onComplete: () => { if (v >= 1 && ctrl.setFieldAsleep) ctrl.setFieldAsleep(true); },
    });
  };

  // Section ENTER: bar scramble + rise, scrim, pointer-events, orbit/equip visibility, dissolve.
  const driveSection = (p) => {
    const s = sectionFor(p);
    if (s === lastSection) return;
    const prev = lastSection;
    lastSection = s;
    setSectionMedia(s); // stream the active section's stills, preload the next, pause the rest
    panels.forEach((pan, i) => {
      pan.classList.toggle('is-lit', (i === s) && (i === 0 || i === 1));
      pan.style.pointerEvents = i === s ? 'auto' : 'none';
    });
    // A bottom-right nav jump locks the title/bar to the destination so they don't
    // flip through the sections the scroll passes on the way (cleared when it settles).
    if (!(prev === -2 && s === -1)) {
      const svcIdx = (ctrl && ctrl._svcLock != null) ? ctrl._svcLock : s;
      ctrl.setActiveService && ctrl.setActiveService(svcIdx);
    }
    if (bar) bar.style.top = s < 0 ? '52vh' : activeTop() + 'px'; // hero: mid-viewport; section: risen tight under the title
    navRows.forEach((r) => r.classList.toggle('is-active', +r.dataset.i === s));
    if (hint) hint.classList.toggle('is-hidden', s >= 0);
    // Bottom-centre CTA (ServicesBar): -1 hero hides it; 0..3 rises it in and
    // scrambles to that section's line. Edge-triggered (driveSection only runs
    // on a section change), so no per-frame churn.
    document.dispatchEvent(new CustomEvent('aoin:service-change', { detail: { index: s } }));
    orbit.show(s === 2 ? 1 : 0);
    if (s === 2 && prev !== 2) orbit.assemble();
    if (equipEl) gsap.to(equipEl, { autoAlpha: s === 3 ? 1 : 0, duration: 0.4, overwrite: 'auto' });
    if (equip && equip.setActive) equip.setActive(s === 3); // plate video plays only in-section, from 0
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
  // Put every still back at the distance the CURRENT viewport makes off-stage,
  // then let anything mid-flight overwrite that with its own re-read values.
  // Called from onRefresh, and directly on each resize event -- see there.
  const resync = (p) => {
    reparks.forEach((repark) => repark());
    master.invalidate();
    // progress() does not render when handed the value it already holds, which
    // after a resize is the common case, so the invalidated tweens would never
    // re-read anything. The hair's-breadth nudge forces it; both writes land in
    // the same frame so nothing is painted at the nudged value, and
    // suppressEvents stops the trip past it firing callbacks.
    master.progress(p > 0 ? Math.max(0, p - 1e-4) : 1e-4, true);
    master.progress(p, true);
  };

  let govRaf = 0;
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
      // Re-cap which 2D videos decode as clips scroll through view (rAF-coalesced, mobile only).
      if (MOB() && (lastSection === 0 || lastSection === 1) && !govRaf) {
        govRaf = requestAnimationFrame(() => { govRaf = 0; capPlayVideos(sectionMedia[lastSection], MOB_2D_CAP); });
      }
    },
    onRefresh: (self) => {
      resync(self.progress);
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
  initNav(ctrl, lenis, st);

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
    // Re-park on EVERY resize event, not only when the debounced refresh lands.
    // A still's off-stage distance is a function of the viewport, so leaving it
    // until the drag stops means the whole drag is spent with the stills at the
    // distance that was off-screen for the old size -- which is them sitting
    // visibly in frame the entire time you are dragging. This is a handful of
    // gsap.set calls and one timeline render; the expensive part, ScrollTrigger
    // re-measuring the scroll distances, stays debounced below.
    resync(st.progress);
    clearTimeout(reFit);
    reFit = setTimeout(() => { ScrollTrigger.refresh(); }, 220); // onRefresh re-applies the dissolve
  });
  window.addEventListener('pageshow', (e) => { if (e && e.persisted) ScrollTrigger.refresh(); });
}

/* ---- REAL-TIME CONTENT — mwg_083 fly-across (scrubbed R→L, parallax depth) ------- */
function buildRealtime(root, master, reparks) {
  const el = root.querySelector('.mwg_effect083');
  if (!el) return;
  const medias = [...el.querySelectorAll('.media')];
  const n = medias.length;
  const mob = window.innerWidth < 768;
  medias.forEach((m, i) => {
    const L = LAYERS[i % LAYERS.length];             // depth: reach (speed) + scale
    const lane = (i * 7) % n;                         // shuffle into evenly-spread vertical lanes
    // Keep the stream in a centred band so large stills don't hang off the top/bottom edges
    // (the top lane used to sit at 5% and get cropped). Phones: a LOWER, wider band so the now
    // ~2× stills clear the title + stacked capability bar (chrome bottom ≈ 40%) and don't crop.
    // Phones: the single-line sub marquee frees the top, so the stream starts higher (36%)
    // and spreads wider — bigger presence without the overlapping pile (scale kept modest).
    const top = (mob ? 36 : 22) + (lane / Math.max(1, n - 1)) * (mob ? 52 : 54);
    const scale = mob ? L.scale * 0.78 : L.scale;
    const fromX = () => window.innerWidth * L.reach + 140;
    const toX = () => -window.innerWidth * L.reach - 140;
    gsap.set(m, { top: top.toFixed(2) + '%', yPercent: -50, zIndex: L.z, scale, x: fromX });
    if (reparks) reparks.push(() => gsap.set(m, { x: fromX }));
    master.fromTo(m, { x: fromX }, { x: toX, ease: 'none', duration: RTC.travel }, RTC.start + i * RTC.stag);
  });
}

/* ---- SCREENS PRODUCTION — mwg_051 (scrubbed bottom→top, parallax spread, stills may bleed off-edge) --- */
function buildScreens(root, master, reparks) {
  const el = root.querySelector('.mwg_effect051');
  if (!el) return;
  const medias = [...el.querySelectorAll('.media')];
  const n = medias.length;
  if (!n) return;
  const mob = window.innerWidth < 768;
  // Organic parallax spread kept: stills tile into `nc` lanes (the (i*3)%n shuffle), each lane a depth
  // layer (reach + scale). On desktop the lanes sit at a FIXED centre-to-centre PITCH that clears the
  // widest layer + a gap, so nothing overlaps horizontally even as the stills grow — the trade (per the
  // brief) is that the outer lanes BLEED off the viewport edges instead of packing in, so the horizontal
  // distance is preserved. Phones keep the old on-screen packing (mobile is a deferred pass).
  const uniq = [...new Set(medias.map((_, i) => (i * 3) % n))].sort((a, b) => a - b);
  const nc = uniq.length;
  const sampleW = medias[0] ? medias[0].getBoundingClientRect().width : window.innerWidth * 0.22;
  const imgPct = (sampleW / window.innerWidth) * 100;       // image width as % of viewport
  const maxScale = Math.max(...LAYERS.map((l) => l.scale)); // widest depth layer
  const GAP = mob ? 1 : 1.5;                                // gap between adjacent lane footprints (%)
  const pitch = imgPct * maxScale + GAP;                    // lane centre-to-centre spacing ⇒ no h-overlap
  const mid = (nc - 1) / 2;                                 // centre the lane group; wider-than-100% ⇒ bleed
  const MARGIN = 4;
  const packTravel = Math.max(0, 100 - 2 * MARGIN - imgPct);
  medias.forEach((m, i) => {
    const L = LAYERS[i % LAYERS.length];
    const col = uniq.indexOf((i * 3) % n);
    const left = mob
      ? MARGIN + (nc > 1 ? col / (nc - 1) : 0.5) * packTravel   // phones: keep everything on-screen
      : 50 + (col - mid) * pitch - imgPct / 2;                  // desktop: fixed pitch, outer lanes bleed off-edge
    const scale = mob ? L.scale * 1.0 : L.scale;
    const fromY = () => window.innerHeight * L.reach + 120;
    const toY = () => -window.innerHeight * L.reach - 120;
    gsap.set(m, { left: left.toFixed(2) + '%', zIndex: L.z, scale, y: fromY });
    if (reparks) reparks.push(() => gsap.set(m, { y: fromY }));
    master.fromTo(m, { y: fromY }, { y: toY, ease: 'none', duration: SCR.travel }, SCR.start + i * SCR.stag);
  });
}

/* ---- MIXED REALITY — mwg_061 orbit: assembles, self-runs, scroll drives speed --- */
function buildMixed(root) {
  const el = root.querySelector('.mwg_effect061');
  if (!el) return { setBoost() {}, assemble() {}, show() {} };
  const container = el.querySelector('.container');
  const medias = [...el.querySelectorAll('img, video')];  // orbit slots can be video (webm) too
  const angle = 360 / medias.length;
  // Ring centred at the container origin (no push-back). The camera is inside the ring — see the
  // ORBIT_* constants. Each image sits at translateZ(-50vw) rotated to its slot.
  medias.forEach((m, i) => gsap.set(m, { z: '-50vw', rotationY: angle * i }));
  gsap.set(el, { autoAlpha: 0 });

  // Reused per-frame scratch: opacities + the video-slot indices (for the decode cap).
  const _orbitOps = new Array(medias.length).fill(0);
  const _orbitVidIdx = medias.map((m, i) => (m.tagName === 'VIDEO' ? i : -1)).filter((i) => i >= 0);

  // one ticker writer integrates angular velocity into rotationY (baseline spin + scroll boost)
  let orbitRot = 0, angVel = ORBIT_BASE, targetVel = ORBIT_BASE, visible = false;
  gsap.ticker.add((t, dt) => {
    // Always ease the boost target back toward baseline. Scroll bumps it UP
    // (setBoost); this pulls it DOWN every frame — so when scrolling stops
    // (including a programmatic jump that fires no further onUpdate) the ring
    // can never stay stuck at a peak velocity, it settles to its resting spin.
    targetVel += (ORBIT_BASE - targetVel) * 0.05;
    angVel += (targetVel - angVel) * 0.08;
    orbitRot += angVel * (dt || 16);
    // Gate the DOM writes (1 transform + N image opacities) to when the ring is on screen. The cheap
    // scalar integration above keeps running so the ring resumes exactly where it "would have been";
    // `visible` flips off only AFTER the 0.35s fade-out completes (see show()), so the fade never freezes.
    if (!visible) return;
    gsap.set(container, { rotationY: orbitRot });
    // Drift fade: d = an image's distance in front of the camera (vw). As it sweeps to the front
    // (d → 0) it would balloon and clip off the edges, so fade it out over the last band first.
    const ops = _orbitOps;
    for (let i = 0; i < medias.length; i++) {
      const d = ORBIT_P_VW + ORBIT_R_VW * Math.cos((angle * i + orbitRot) * DEG2RAD);
      const o = clamp01((d - ORBIT_FADE_NEAR) / ORBIT_FADE_SPAN);
      ops[i] = o;
      medias[i].style.opacity = String(o);
    }
    // Cap concurrent video DECODE to the ORBIT_MAX_PLAYING most-visible clips — the profiler
    // showed 6-9 simultaneous H.264 streams (not composite area) pin the section to 30fps; a
    // paused clip just holds its last frame (reads like a still) until it rotates back to the
    // front. Hysteresis via __orbitPlaying so we only toggle on rank/threshold crossings.
    _orbitVidIdx.sort((a, b) => ops[b] - ops[a]);
    const cap = orbitMaxPlaying();
    for (let r = 0; r < _orbitVidIdx.length; r++) {
      const m = medias[_orbitVidIdx[r]];
      const wantPlay = r < cap && ops[_orbitVidIdx[r]] > 0.02;
      if (wantPlay && m.__orbitPlaying === false) { m.__orbitPlaying = true; const p = m.play(); if (p) p.catch(() => {}); }
      else if (!wantPlay && m.__orbitPlaying !== false) { m.__orbitPlaying = false; m.pause(); }
    }
  });

  // mouse/touch tilt (rotationX — a different prop, no conflict with the spin)
  const clampX = gsap.utils.clamp(0, 1);
  const rotX = gsap.quickTo(container, 'rotationX', { duration: 1, ease: 'power2' });
  const tilt = (cx) => rotX((clampX(cx / window.innerWidth) * 2 - 1) * 4);  // ±4° (was ±10°) — less vertigo
  el.addEventListener('mousemove', (e) => tilt(e.clientX));
  el.addEventListener('touchmove', (e) => { if (e.touches && e.touches[0]) tilt(e.touches[0].clientX); }, { passive: true });

  return {
    setBoost(p, vel) {
      // Only RAISE the target from scroll speed (inside the mixed section); the
      // ticker eases it back down. vel arrives as 0 during programmatic jumps,
      // so a deep-link never bumps the spin.
      if (p >= MIX[0] && p <= MIX[1]) {
        const v = Math.min(ORBIT_BASE + Math.abs(vel) * 0.00003, ORBIT_MAX);
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
    show(v) {
      if (v > 0) visible = true; // wake before the fade-in so the ring animates in live
      // Sleep only once fully faded out — the ring keeps spinning + fading through the whole 0.35s.
      gsap.to(el, { autoAlpha: v, duration: 0.35, overwrite: 'auto', onComplete: () => { if (v <= 0) visible = false; } });
    },
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
  const vid = scope.querySelector('[data-equip-vid]');   // plate can be a video (e.g. GX3 render)
  const plate = scope.querySelector('[data-equip-plate]');
  const ph = scope.querySelector('[data-equip-ph]');
  const copy = scope.querySelector('[data-equip-copy]');
  if (!marquee || !track || !rows.length) return;

  // The item to sit on the playhead when the section opens (falls back to the first).
  const defaultIdx = Math.max(0, rows.findIndex((r) => r.dataset.center === 'true'));
  let trackX = 0, activeIdx = -1, imgT = null, active = false, plateIsVideo = false;
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
  // ---- plate scale -----------------------------------------------------------------
  // The plate is a square box between the sub-service marquee above it and the fleet marquee below,
  // and --plate-scale (services.css) sizes it against the cell. The renders carry black margin in
  // the frame, so the box is grown past the cell and the surplus clipped, which reads as a bigger
  // render. How much margin there is to take varies per clip, though, and one of the seven has
  // none to give: renderstream is framed tight to its subject — measured, it spans .031-.979 of
  // its frame across, so anything above ~1.05x eats the hardware — and it stays at 1.
  //
  // So it is per clip, and each is the largest that keeps that whole subject inside the cell.
  // Derived from the subject's measured box — the union of every sampled frame, x..r across the
  // frame and y..b down it — plus a NUDGE that slides the render sideways first so the subject,
  // not the frame, is on the cell's centre line. That nudge is what the sizes are worth: scaled
  // about the cell's middle, an off-centre subject runs its near side into the edge while the far
  // side still has margin going spare, and the rack is 3.6% off — which was costing it a tenth of
  // its size. Recentred, the limits are:
  //
  //   across  1/(r-x)      down  min(1/(1-2y), 1/(2b-1)) / f      f = picture height / box side
  //
  // and the scale is the smaller, less ~2.5% for measurement error. Down is left un-nudged: it
  // only ever binds renderstream, and centring the others vertically would move the render off
  // where the frame puts it for a percent or two. Taking both axes is what makes one number per
  // clip safe in a cell of ANY shape — a tall cell only relaxes the vertical limit and a wide one
  // only the horizontal, so the smaller of the pair is under both, on any phone and on desktop.
  //
  //     clip                          box across   box down    nudge    max     used
  //     gx3 / x-series / silverdraft  .083-.927    .344-.875   -0.005   1.185   1.15
  //     laptop                        .104-.864    .156-.864   +0.016   1.316   1.28
  //     vfc                           .083-.959    .333-.656   -0.021   1.142   1.11
  //     rack (16:9, f=0.5625)         .042-.886    .037-.889   +0.036   1.185   1.15
  //     renderstream                  .031-.979    .208-1.00        0   1.000   1.00
  //
  // renderstream stays at 1: its subject runs to the very bottom EDGE of its frame (b = 1.0), so
  // there is nothing to give and no nudge helps — that is a vertical limit, not a horizontal one.
  //
  // Keyed by slug because that is the only thing that separates them: six of the seven are
  // 1000x1000, so the frame's shape says nothing about how tightly the render sits in it. Which
  // makes this a list to revisit whenever the fleet changes — anything not in it stays at 1, whole
  // and uncropped, until someone measures it. And these numbers are the ceiling, not a preference:
  // every one is bounded by how much black the clip carries. Re-exporting the loose renders as
  // tight as renderstream retires the table AND beats anything in it — gx3's subject is 53% of its
  // frame's height, so a tight re-frame is worth ~1.9x down the long axis where a crop-free zoom
  // tops out at 1.19x.
  const PLATE = {
    'disguise-gx3':            { scale: 1.15, nudge: -0.005 },
    'x-series-servers':        { scale: 1.15, nudge: -0.005 },
    'silverdraft-a6000-nodes': { scale: 1.15, nudge: -0.005 },
    'laptop-flypacks':         { scale: 1.28, nudge: 0.016 },
    'vfc-cards':               { scale: 1.11, nudge: -0.021 },
    'custom-rack-builds':      { scale: 1.15, nudge: 0.036 },
    'renderstream-hardware':   { scale: 1, nudge: 0 },
  };
  const setScale = (r) => {
    if (!plate) return;
    const p = (r && PLATE[r.dataset.slug]) || { scale: 1, nudge: 0 };
    plate.style.setProperty('--plate-scale', String(p.scale));
    plate.style.setProperty('--plate-nudge', String(p.nudge));
  };

  // Paint the plate for a row: real items show their image; placeholder items show a
  // labelled placeholder box (the data has no plate asset yet — pending the CMS).
  const isVideoSrc = (s) => /\.(webm|mp4|m4v|mov)(\?|$)/i.test(s || '');
  const setPlate = (r) => {
    const isPh = r.dataset.placeholder === 'true';
    if (plate) plate.classList.toggle('is-placeholder', isPh);
    if (ph) ph.textContent = isPh ? r.textContent : '';
    const src = r.dataset.img || '';
    const isVid = !isPh && isVideoSrc(src);
    plateIsVideo = isVid;
    setScale(r);
    if (isPh) {
      if (img) { img.removeAttribute('src'); img.style.opacity = '0'; }
      if (vid) { vid.pause && vid.pause(); vid.style.opacity = '0'; }
    } else if (isVid) {
      if (img) img.style.opacity = '0';
      if (vid) {
        if (vid.getAttribute('src') !== src) vid.src = src;
        vid.style.opacity = '1';
        // Only autoplay while the equipment section is active — otherwise the plate
        // holds frame 0 so its intro plays from the start when you scroll in.
        if (active) { try { vid.currentTime = 0; } catch (_) {} vid.play && vid.play().catch(() => {}); }
      }
    } else {
      if (vid) { vid.pause && vid.pause(); vid.style.opacity = '0'; }
      if (img) { img.src = src; img.style.opacity = '1'; }
    }
  };
  const swap = (i, immediate) => {
    if (i === activeIdx) return;
    activeIdx = i;
    rows.forEach((r, k) => r.classList.toggle('is-active', k === i));
    if (copy) copy.textContent = rows[i].dataset.tip;
    if (immediate) { setPlate(rows[i]); return; }
    if (img) img.style.opacity = '0';
    if (vid) vid.style.opacity = '0';
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
  window.addEventListener('resize', () => {
    const i = activeIdx < 0 ? defaultIdx : activeIdx;
    setX(clampU(bounds().min, bounds().max, xForIndex(i)));
  });

  // pointer drag (touch-action:pan-y in CSS lets vertical page scroll pass through)
  // Bound to the plate as well as the marquee, so the render is draggable too — on a phone the
  // plate is most of the section and swiping it is the obvious gesture. `surface` is whichever of
  // the two started this drag: the capture has to go on that element or the move/up events stop
  // arriving mid-swipe, and it is also what tells `up` whether a tap means anything (see there).
  let dragging = false, downX = 0, startX = 0, lastX = 0, lastT = 0, vel = 0, moved = 0, surface = null;
  const down = (e) => {
    dragging = true; downX = lastX = e.clientX; startX = trackX; vel = 0; moved = 0; lastT = performance.now();
    surface = e.currentTarget;
    gsap.killTweensOf(track);
    marquee.classList.add('is-grabbing');
    if (surface.setPointerCapture) try { surface.setPointerCapture(e.pointerId); } catch (_) {}
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
    const from = surface; surface = null;
    marquee.classList.remove('is-grabbing');
    if (from && from.releasePointerCapture && e.pointerId != null) try { from.releasePointerCapture(e.pointerId); } catch (_) {}
    // A tap (no real movement) selects the name under the pointer; a drag snaps to center (a flick
    // advances one). Tap is handled here — not via a row 'click' listener — because pointer capture
    // routes the click to the marquee, so per-row click handlers never fire.
    // Only the marquee reads a tap that way: an x on the plate points at whichever name happens to
    // sit above it, so tapping the render would jump the fleet somewhere arbitrary. A tap there
    // settles back onto the current item instead.
    let target;
    if (moved < 5) target = from === marquee ? itemAtClientX(e.clientX) : (activeIdx < 0 ? defaultIdx : activeIdx);
    else { target = nearest(); if (Math.abs(vel) > 0.35) target += vel < 0 ? 1 : -1; }
    snapTo(clampU(0, rows.length - 1, target));
  };
  [marquee, plate].forEach((el) => {
    if (!el) return;
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });

  // Section-gated playback: the plate video plays ONLY while Equipment is active,
  // and restarts from 0 each time you scroll in — so its intro is never missed.
  const setActive = (v) => {
    const on = !!v;
    if (on === active) return;
    active = on;
    if (!vid) return;
    if (on && plateIsVideo) { try { vid.currentTime = 0; } catch (_) {} vid.play && vid.play().catch(() => {}); }
    else if (!on) { vid.pause && vid.pause(); }
  };
  return { setActive };
}

/* ---- Service nav + deep links (homepage → a section; intro labels → scroll) ----- */
function initNav(ctrl, lenis, st) {
  if (typeof window !== 'undefined') { window.__aoinLenis = lenis; window.__aoinST = st; }
  const targetFor = (slug) => st.start + (ANCHOR[slug] || 0) * (st.end - st.start);
  const jump = (slug, immediate, eager) => {
    // Flag the jump so the orbit ignores its velocity spike, and clear the flag
    // once the scroll settles (onComplete for the eased jump; next frame for an
    // immediate one, which fires no onComplete).
    progScroll = true;
    // Eager (bottom-right nav click): scramble the title + bar to the destination
    // NOW and hold them there (ctrl._svcLock) while the scroll travels — so the
    // morph reads as a response to the click, not a late flip at the boundary.
    const idx = SLUGS.indexOf(slug);
    if (eager && idx >= 0 && ctrl && ctrl.setActiveService) { ctrl._svcLock = idx; ctrl.setActiveService(idx); }
    const clear = () => { progScroll = false; if (ctrl) ctrl._svcLock = null; };
    lenis.scrollTo(targetFor(slug), immediate ? { immediate: true, onComplete: clear } : { duration: 1.1, onComplete: clear });
    if (immediate) requestAnimationFrame(clear);
    clearTimeout(jump._t);
    jump._t = setTimeout(clear, 1400); // safety net
  };

  document.querySelectorAll('[data-svc-jump]').forEach((b) => {
    b.addEventListener('click', () => jump(SLUGS[+b.dataset.i], false, true));
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
