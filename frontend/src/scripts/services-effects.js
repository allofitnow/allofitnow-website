// Services page motion — the per-section gallery effects, ported from the Codrops
// "mwg" demos and re-driven by page scroll (Lenis + GSAP/ScrollTrigger) so they
// coexist on one scrollable page instead of each owning the wheel.
// @ts-nocheck
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

let mounted = false;

export function mountEffects() {
  if (mounted) return;
  mounted = true;

  const lenis = new Lenis({ autoRaf: false });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);

  initRealtime();   // mwg_083 — scroll-scrubbed fly-across
  initScreens();    // mwg_051 — vertical wrap gallery, scrubbed by scroll
  initMixed();      // mwg_061 — self-running 3D orbit
  initEquipment();  // disguise list + plate

  ScrollTrigger.refresh();
  initDeepLinks(lenis);
}

/* ---- REAL-TIME CONTENT — mwg_083 ------------------------------------------------ */
function initRealtime() {
  const root = document.querySelector('.mwg_effect083');
  if (!root) return;
  const pinHeight = root.querySelector('.pin-height');
  const container = root.querySelector('.container');
  const medias = root.querySelectorAll('.media');
  const easings = ['ease-1', 'ease-2', 'ease-3', 'ease-4'];

  medias.forEach((media, index) => {
    const easingClass = easings[index % easings.length];
    media.classList.add(easingClass);
    const zIndex = parseInt(easingClass.split('-')[1]);
    const randomY = Math.random();
    gsap.set(media, { y: randomY * window.innerHeight, yPercent: -randomY * 100, zIndex });
  });

  const groups = [
    ['ease-1', 'power1.inOut'],
    ['ease-2', 'power2.inOut'],
    ['ease-3', 'power3.inOut'],
    ['ease-4', 'power4.inOut'],
  ];
  groups.forEach(([cls, ease], gi) => {
    gsap.fromTo(
      root.querySelectorAll('.' + cls),
      { x: window.innerWidth, xPercent: 10 },
      {
        x: 0,
        xPercent: -110,
        stagger: 0.04,
        ease,
        scrollTrigger: {
          trigger: pinHeight,
          start: 'top top',
          end: 'bottom bottom',
          scrub: true,
          pin: gi === 0 ? container : false,
          pinSpacing: false,
        },
      }
    );
  });
}

/* ---- SCREENS PRODUCTION — mwg_051 (Observer → scroll-scrub) --------------------- */
function initScreens() {
  const root = document.querySelector('.mwg_effect051');
  if (!root) return;

  const mediasSrc = [];
  root.querySelectorAll('.listMedia').forEach((m) => mediasSrc.push(m.getAttribute('src')));
  const mediasLength = mediasSrc.length;
  let mediaIndex = 0;

  const media1 = root.querySelector('.media1');
  const media2 = root.querySelector('.media2');
  const media3 = root.querySelector('.media3');
  const rangeX = window.innerWidth - media1.clientWidth;

  const updateMedia = (media) => {
    media.setAttribute('src', mediasSrc[mediaIndex]);
    gsap.set(media, { x: Math.random() * rangeX + 'px' });
    mediaIndex = (mediaIndex + 1) % mediasLength;
  };
  updateMedia(media1);
  updateMedia(media2);
  updateMedia(media3);

  const makeYTo = (media, dur, extra) => {
    const max = -(window.innerHeight + media.clientHeight) - extra;
    const wrap = gsap.utils.wrap(0, max);
    const round = gsap.utils.snap(max);
    let iteration = max;
    return gsap.quickTo(media, 'y', {
      duration: dur,
      ease: 'power4',
      modifiers: {
        y: (value) => {
          const y = parseFloat(value);
          const newIteration = round(y + max / 2);
          if (newIteration !== iteration) {
            iteration = newIteration;
            updateMedia(media);
          }
          return wrap(y) + 'px';
        },
      },
    });
  };
  const yTo1 = makeYTo(media1, 1, 0);
  const yTo2 = makeYTo(media2, 2, 200);
  const yTo3 = makeYTo(media3, 3, 400);

  // Scroll drives `incr` (was wheel/Observer). Pin the section and scrub through a
  // few screens of vertical travel so the three columns wrap and swap images.
  const TRAVEL = window.innerHeight * 8;
  ScrollTrigger.create({
    trigger: root,
    start: 'top top',
    end: '+=280%',
    pin: true,
    scrub: true,
    onUpdate: (self) => {
      const incr = -self.progress * TRAVEL;
      yTo1(incr);
      yTo2(incr);
      yTo3(incr);
    },
  });
}

/* ---- MIXED REALITY — mwg_061 (self-running 3D orbit) --------------------------- */
function initMixed() {
  const root = document.querySelector('.mwg_effect061');
  if (!root) return;
  const container = root.querySelector('.container');
  const medias = root.querySelectorAll('.container img');
  const angle = 360 / medias.length;

  medias.forEach((media, index) => {
    gsap.set(media, { z: '-50vw', rotationY: angle * index });
  });
  gsap.to(container, { rotationY: 360, repeat: -1, ease: 'none', duration: 40 });

  const W = window.innerWidth;
  const clampX = gsap.utils.clamp(0, W);
  const rotTo = gsap.quickTo(container, 'rotationX', { duration: 1, ease: 'power2' });
  const applyMove = (clientX) => rotTo(((clampX(clientX) / W) * 2 - 1) * 10);
  root.addEventListener('mousemove', (e) => applyMove(e.clientX));
  root.addEventListener('touchmove', (e) => { if (e.touches && e.touches[0]) applyMove(e.touches[0].clientX); }, { passive: true });
}

/* ---- EQUIPMENT RENTAL — disguise list swaps the plate + copy ------------------- */
function initEquipment() {
  const root = document.querySelector('.equip');
  if (!root) return;
  const rows = [...root.querySelectorAll('[data-equip-row]')];
  const img = root.querySelector('[data-equip-img]');
  const copy = root.querySelector('[data-equip-copy]');
  const orig = copy ? copy.textContent : '';
  const WP = 'https://allofitnow.com/wp-content/uploads/';
  let t = null;
  const activate = (r) => {
    rows.forEach((x) => x.classList.toggle('is-active', x === r));
    if (img) {
      img.style.opacity = '0';
      clearTimeout(t);
      t = setTimeout(() => { img.src = WP + r.dataset.img; img.style.opacity = '1'; }, 160);
    }
    if (copy) copy.textContent = r.dataset.tip;
  };
  rows.forEach((r) => {
    r.addEventListener('mouseenter', () => activate(r));
    r.addEventListener('click', () => activate(r));
  });
  root.addEventListener('mouseleave', () => { if (copy) copy.textContent = orig; rows.forEach((x) => x.classList.remove('is-active')); });
  if (rows[0]) rows[0].classList.add('is-active');
}

/* ---- Deep links (homepage → a service section; intro labels → scroll) ---------- */
function initDeepLinks(lenis) {
  const scrollToSlug = (slug) => {
    const el = document.getElementById(slug);
    if (el) lenis.scrollTo(el, { offset: 0, duration: 1.1 });
  };
  window.addEventListener('services:scrollto', (e) => scrollToSlug(e && e.detail && e.detail.slug));
  if (location.hash) {
    const slug = location.hash.replace(/^#/, '');
    // Wait for ScrollTrigger pins to settle so the target's offset is final.
    setTimeout(() => { ScrollTrigger.refresh(); scrollToSlug(slug); }, 400);
  }
}
