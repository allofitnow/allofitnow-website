// AOIN home - motion controller.
//
// Direct port of the prototype's `DCLogic` class to plain DOM. Faithful on
// purpose: the structural data-* hooks are kept verbatim, `ref="{{x}}"` became
// `data-ref="x"` (see `ref()`), and the tuned `props.X ?? default` values are
// frozen in CFG below. Values are dialed - changing one changes the feel.
//
// Slice 1: preloader, intro lockup, scroll-scrubbed hero reel, nav reveal,
// scroll cue, film grain, LA clock, foot bar. About - Footer land next.

import Lenis from 'lenis';

const CFG = {
  pinViewports: 2, // hero scroll length = 2 - 100vh
  showPreloader: true,
  preloadDuration: 1900,
  navStagger: 110,
  navDuration: 900,
  navRevealOffset: -70,
  navTextNudge: 0,
  cueTracking: 0.34,
  cueSize: 11,
  blinkTick: 130,
  blinkCount: 5,
  burstTicks: 7,
  burstGap: 3400,
  blinkDensity: 0.75,
  cueIntroDelay: 2150,
  cueIntroStagger: 42,
  blinkStartDelay: 0,
  bracketHoverShift: 42,
  reelStartWidth: 45, // % of viewport width for the seed reel
  reelHold: 0.3,
} as const;

// Uniform vertical gap between the About blocks — headline / copy / marquee /
// view-work — so the section reads with one even rhythm (matches .stmt-row and
// .work-cue margins in About.astro). Dialed down from the prototype's 140.
const STILL_GAP = 44;

// Services sticky-label lead-in / settle, as % of viewport height.
const SVC_LEAD_IN = 4;
const SVC_SETTLE = 18;

declare global {
  interface Window {
    __aoinLenis?: Lenis;
    // Handle for the Lenis rAF loop so destroy() can actually stop it — the loop
    // is self-perpetuating and would otherwise keep driving Lenis (hijacking
    // scroll) after the home page is torn down on a soft nav to a project.
    __aoinLenisRaf?: number;
  }
}

const reducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export class HomeController {
  private root: HTMLElement;
  private cfg = CFG;

  // timers / raf / observers to tear down
  private raf = 0;
  private preRaf = 0;
  private blinkId = 0;
  private blinkTimer = 0;
  private atmoTimer = 0;
  private atmoOn = false;
  private cueReady = false;
  private cueShown = false;
  private reelRetry?: () => void;
  private onScroll!: () => void;
  private onResize!: () => void;
  private footScroll?: () => void;

  // About
  private aboutShown = false;
  private aboutPlayed = false;
  private aboutAnimating = false;
  private aboutTimers: number[] = [];
  private aboutDoneId = 0;
  private refitQueued = false;
  private stmtHealed = false;
  private aboutIo?: IntersectionObserver;
  private stmtRO?: ResizeObserver;
  private stmtW = 0;
  private roRaf = 0;
  private stmtHTML = '';

  // Bleed slider
  private sliderOn = false;
  private x = 0;
  private target = 0;
  private half = 0;
  private sw = 0;
  private last = 0;
  private dragging = false;
  private px = 0;
  private slideRaf = 0;
  private onMove?: (e: PointerEvent) => void;
  private onUp?: () => void;
  private noDrag?: (e: Event) => void;
  // Marquee drag-vs-click: a press that moves past a small threshold is a drag,
  // and its trailing click is suppressed so it doesn't navigate to a project.
  private sdownX = 0;
  private sdownY = 0;
  private smoved = 0;
  private onSliderClick?: (e: Event) => void;
  private onResizeSlider?: () => void;

  // Services
  private svcShown = false;
  private svcPlayed = false;
  private svcTimers: number[] = [];
  private svcIo?: IntersectionObserver;

  // Footer
  private footerScroll?: () => void;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  private ref<T extends HTMLElement = HTMLElement>(name: string): T | null {
    return this.root.querySelector<T>(`[data-ref="${name}"]`);
  }
  private refs<T extends HTMLElement = HTMLElement>(sel: string): T[] {
    return Array.prototype.slice.call(this.root.querySelectorAll<T>(sel));
  }

  init() {
    const heroWrap = this.ref('heroWrap');
    if (heroWrap) heroWrap.style.height = this.cfg.pinViewports * 100 + 'svh';

    this.onScroll = () => {
      if (this.raf) return;
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.updateHero();
        this.healStatement();
      });
    };
    window.addEventListener('scroll', this.onScroll, { passive: true });

    if (!window.__aoinLenis) {
      window.__aoinLenis = new Lenis({ lerp: 0.09, wheelMultiplier: 1 });
      const raf = (time: number) => {
        if (!window.__aoinLenis) return; // stop once destroyed
        window.__aoinLenis.raf(time);
        window.__aoinLenisRaf = requestAnimationFrame(raf);
      };
      window.__aoinLenisRaf = requestAnimationFrame(raf);
    }
    window.__aoinLenis.on('scroll', this.onScroll);

    this.onResize = () => {
      this.updateHero();
      this.applyResponsive();
      this.fitDisplay();
      // NB: fitAndBuild owns the statement font size — do NOT call applyAboutType
      // after it here, or its clamp() clobbers the fit and the blurb balloons to
      // 8 lines on large screens (matches the prototype's onResize).
      this.fitAndBuild();
      this.applyServicesType();
      this.setNavReveal();
      this.layoutSlider();
      this.applySliderStyle();
      this.sizeReel();
    };
    window.addEventListener('resize', this.onResize);

    this.wireCue();
    this.wireWorkCue();
    this.wireReel();
    this.updateHero();
    this.setNavReveal();
    this.startAtmosphere();
    this.watchFootBar();
    this.layoutSlider();
    this.watchAbout();
    this.wireServices();
    this.watchServices();
    this.watchFooter();
    this.applyResponsive();
    this.applyAboutType();
    this.applyServicesType();

    const sw = this.ref('stmtWrap');
    if (window.ResizeObserver && sw) {
      this.stmtRO = new ResizeObserver(() => {
        const w = sw.clientWidth;
        if (w && w !== this.stmtW) {
          this.stmtW = w;
          cancelAnimationFrame(this.roRaf);
          this.roRaf = requestAnimationFrame(() => this.fitAndBuild());
        }
      });
      this.stmtRO.observe(sw);
    }

    document.fonts.ready.then(() => {
      this.runPreload();
      this.fitDropcap();
      this.applyAboutType();
      this.applyServicesType();
      this.layoutSlider();
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          this.applyResponsive();
          this.fitAndBuild();
          this.applyServicesType();
        })
      );
      // Safety net for a page that loads already scrolled to About (bfcache /
      // restored position), where no scroll event fires to drive healStatement.
      window.setTimeout(() => this.healStatement(), 600);
      window.setTimeout(() => this.healStatement(), 1600);
    });
  }

  // - Preloader -
  private runPreload() {
    const wrap = this.ref('preloader');
    const num = this.ref('preCount');
    const label = this.ref('preLabel');
    if (!wrap) return;
    const go = () => {
      this.runIntro();
      this.runCue();
    };
    // Arriving via an interior page's "home" affordance (/#about): skip the hero
    // intro entirely and land on the About section. runIntro still runs so the
    // hero is at rest if the visitor scrolls back up.
    if (location.hash === '#about') {
      wrap.style.display = 'none';
      go();
      // Land already-fitted: applyResponsive fixes the About padding (so the
      // scroll target is right) and fitAndBuild sizes the statement to its final
      // size before it's ever revealed, so there's no size "pop" a beat later.
      this.applyResponsive();
      this.applyAboutType();
      this.fitAndBuild();
      const about = this.ref('about');
      if (about) {
        const y = about.offsetTop;
        window.scrollTo(0, y);
        window.__aoinLenis?.scrollTo(y, { immediate: true });
      }
      return;
    }
    if (reducedMotion() || window.scrollY > 50 || !this.cfg.showPreloader) {
      wrap.style.display = 'none';
      go();
      return;
    }

    const dur = this.cfg.preloadDuration;
    const t0 = performance.now();
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      if (num) num.textContent = String(Math.round(ease(t) * 100));
      if (t < 1) {
        this.preRaf = requestAnimationFrame(step);
        return;
      }
      const out = [label, num].filter(Boolean) as HTMLElement[];
      out.forEach((el, i) => {
        el.animate(
          [
            { transform: 'translateY(0%)', offset: 0, easing: 'cubic-bezier(.05,.89,0,.99)' },
            { transform: 'translateY(-115%)', offset: 1 },
          ],
          { duration: 440, delay: 20 + i * 60, fill: 'both' }
        );
      });
      setTimeout(() => {
        wrap.style.background = 'transparent';
        go();
      }, 200);
      setTimeout(() => {
        wrap.style.display = 'none';
      }, 560);
    };
    this.preRaf = requestAnimationFrame(step);
  }

  // - Intro lockup assembly -
  private runIntro() {
    const words = [this.ref('wAll'), this.ref('wOf'), this.ref('wIt'), this.ref('wNow')];
    const introIcon = this.ref('introIcon');
    const done = () => {
      words.forEach((el) => {
        if (el) el.style.opacity = '1';
      });
      if (introIcon) introIcon.style.transform = 'none';
    };
    if (reducedMotion() || window.scrollY > 50 || words.some((el) => !el) || !introIcon) {
      done();
      return;
    }
    const vw = window.innerWidth,
      vh = window.innerHeight;
    const D = 2000;
    const stack = 222.853 * (vh / 1117);
    const rise = 'cubic-bezier(1,0,0,1)';
    const fling = 'cubic-bezier(0.987,-0.006,0,1.006)';
    const bloom = 'cubic-bezier(0,0.707,0,0.994)';
    const rects = (words as HTMLElement[]).map((el) => el.getBoundingClientRect());
    const h = rects[0].height;
    const L = rects[2].width + rects[3].width + h * 0.55;
    const lockL = (vw - L) / 2,
      lockR = lockL + L;
    const gap = Math.max(10, h * 0.14);
    const row1 = vh / 2 - h - gap / 2,
      row2 = vh / 2 + gap / 2;
    const dx = [
      lockL - rects[0].left,
      lockR - rects[1].right,
      lockL - rects[2].left,
      lockR - rects[3].right,
    ];
    const dy = [row1 - rects[0].top, row1 - rects[1].top, row2 - rects[2].top, row2 - rects[3].top];
    const T = [
      [84, 84.2, 562.8, 943.6, 1653],
      [111.4, 44.8, 699.4, 943.6, 1634.2],
      [84, 111.6, 822.4, 943.6, 1675.2],
      [144.6, 308.4, 753, 943.6, 1732.6],
    ];
    (words as HTMLElement[]).forEach((el, i) => {
      const [on, rs, re, fs, fe] = T[i];
      const atLock = 'translate(' + dx[i] + 'px,' + dy[i] + 'px)';
      const atStack = 'translate(' + dx[i] + 'px,' + (dy[i] + stack) + 'px)';
      el.animate(
        [
          { opacity: 0, offset: 0 },
          { opacity: 0, offset: on / D },
          { opacity: 1, offset: Math.min(1, (on + 1) / D) },
          { opacity: 1, offset: 1 },
        ],
        { duration: D, fill: 'forwards' }
      );
      const move = el.animate(
        [
          { transform: atStack, offset: 0, easing: 'linear' },
          { transform: atStack, offset: rs / D, easing: rise },
          { transform: atLock, offset: re / D, easing: 'linear' },
          { transform: atLock, offset: fs / D, easing: fling },
          { transform: 'translate(0px,0px)', offset: fe / D, easing: 'linear' },
          { transform: 'translate(0px,0px)', offset: 1 },
        ],
        { duration: D, fill: 'forwards' }
      );
      if (i === 3) move.onfinish = done;
    });
    introIcon.animate(
      [
        { transform: 'scale(0)', offset: 0, easing: 'linear' },
        { transform: 'scale(0)', offset: 1286 / D, easing: bloom },
        { transform: 'scale(1)', offset: 1955 / D, easing: 'linear' },
        { transform: 'scale(1)', offset: 1 },
      ],
      { duration: D, fill: 'forwards' }
    );
  }

  // - Scroll cue (SCROLL DOWN + bracket blink) -
  private wireCue() {
    const cue = this.ref('cue');
    if (!cue) return;
    this.cueShown = true;
    cue.addEventListener('mouseenter', () => this.setBrackets(this.cfg.bracketHoverShift));
    cue.addEventListener('mouseleave', () => this.setBrackets(0));
    cue.addEventListener('click', () => this.scrollToY(this.aboutTop()));
  }
  private aboutTop() {
    const about = this.ref('about');
    return about ? about.offsetTop : window.innerHeight * this.cfg.pinViewports;
  }
  private runCue() {
    const cue = this.ref('cue');
    if (!cue) return;
    // Both layers, or the twin sits in its final position while the real cue
    // slides up and the two are visibly out of register for the whole intro.
    const inners = this.refs('[data-ref="cue"] [data-gi], [data-ref="cueSat"] [data-gi]');
    // Blink is the ONE thing that stays on the real cue only. The twin is there
    // to remove saturation, and it has none to begin with — blackening its
    // letters would change nothing and only risk the two falling out of step.
    const glyphs = this.refs('[data-ref="cue"] [data-l]');
    const track = this.cfg.cueTracking;
    // Metrics go on BOTH containers. The twin is drawn directly on top of the
    // cue, so a font-size or tracking set on only one puts the two out of
    // register — and a saturation layer that does not line up with the type it
    // is desaturating is worse than none at all.
    const satRoot = this.ref('cueSat');
    for (const root of [cue, satRoot]) {
      if (!root) continue;
      root.style.fontSize = this.cfg.cueSize + 'px';
      root.style.letterSpacing = 'normal';
    }
    inners.forEach((el) => {
      el.style.letterSpacing = track + 'em';
      el.style.marginRight = -track + 'em';
    });
    const blinkers = glyphs.filter((g) => !g.hasAttribute('data-b'));
    const startBlink = () => {
      const tick = this.cfg.blinkTick;
      let prev: HTMLElement[] = [],
        left = 0,
        rest = 0;
      this.blinkId = window.setInterval(() => {
        const count = this.cfg.blinkCount;
        prev.forEach((el) => (el.style.color = ''));
        prev = [];
        if (rest > 0) {
          rest--;
          return;
        }
        if (left <= 0) left = Math.max(1, this.cfg.burstTicks);
        left--;
        if (left <= 0) rest = Math.max(0, Math.round(this.cfg.burstGap / tick));
        if (Math.random() > this.cfg.blinkDensity) return;
        for (let k = 0; k < count; k++) {
          const el = blinkers[Math.floor(Math.random() * blinkers.length)];
          el.style.color = '#000';
          prev.push(el);
        }
      }, tick);
    };
    this.cueReady = true;
    // Reveal is per-layer: the twin has to come up with the cue or the type
    // shows its inverted colour for as long as the twin is still transparent.
    const sat = this.ref('cueSat');
    const show = () => {
      cue.style.opacity = '1';
      if (sat) sat.style.opacity = '1';
    };
    if (reducedMotion()) {
      show();
      return;
    }
    const delay = this.cfg.cueIntroDelay;
    const stagger = this.cfg.cueIntroStagger;
    const dur = 520;
    show();
    inners.forEach((g, i) => {
      const t0 = delay + i * stagger;
      g.animate(
        [
          {
            transform: 'translateY(110%)',
            letterSpacing: track * 0.18 + 'em',
            offset: 0,
            easing: 'cubic-bezier(1,0,0,1)',
          },
          { transform: 'translateY(0%)', letterSpacing: track + 'em', offset: 1 },
        ],
        { duration: dur, delay: t0, fill: 'both' }
      );
      setTimeout(() => {
        g.getAnimations().forEach((a) => a.cancel());
        g.style.transform = 'none';
      }, t0 + dur + 20);
    });
    this.blinkTimer = window.setTimeout(
      startBlink,
      delay + inners.length * stagger + dur + this.cfg.blinkStartDelay
    );
  }
  private setBrackets(px: number) {
    const cue = this.ref('cue');
    if (!cue || !this.cueReady) return;
    const sat = this.ref('cueSat');
    for (const root of [cue, sat]) {
      if (!root) continue;
      root.querySelectorAll<HTMLElement>('[data-br]').forEach((el) => {
        el.style.transform = 'translateX(' + px * Number(el.getAttribute('data-br')) + 'px)';
      });
    }
  }

  // - Nav reveal handoff -
  // The site-wide nav (Base) reveals itself once scroll passes data-reveal-at.
  // Home sets that threshold to the hero-clear point so the nav stays hidden
  // through the cinematic hero, then slides in as About arrives. Everything
  // else (stagger, hide-on-scroll, clock, mobile menu) lives in Nav.astro.
  private setNavReveal() {
    const nav = document.querySelector<HTMLElement>('[data-aoin-nav]');
    const heroWrap = this.ref('heroWrap');
    if (!nav || !heroWrap) return;
    const at = Math.max(40, heroWrap.offsetTop + heroWrap.offsetHeight + this.cfg.navRevealOffset);
    nav.dataset.revealAt = String(Math.round(at));
  }

  // - Film grain -
  private startAtmosphere() {
    if (this.atmoOn) return;
    this.atmoOn = true;
    const gs = 160,
      FRAMES = 10;
    const grainFrames: string[] = [];
    for (let f = 0; f < FRAMES; f++) {
      const gc = document.createElement('canvas');
      gc.width = gs;
      gc.height = gs;
      const gx = gc.getContext('2d')!;
      const gi = gx.createImageData(gs, gs);
      for (let i = 0; i < gs * gs; i++) {
        const v = Math.random() < 0.5 ? 0 : 255;
        const o = i * 4;
        gi.data[o] = gi.data[o + 1] = gi.data[o + 2] = v;
        gi.data[o + 3] = Math.random() * 255;
      }
      gx.putImageData(gi, 0, 0);
      grainFrames.push('url(' + gc.toDataURL() + ')');
    }
    let gf = 0;
    this.atmoTimer = window.setInterval(() => {
      const tile = this.ref('grainTile');
      if (!tile) return;
      gf = (gf + 1 + Math.floor(Math.random() * (FRAMES - 1))) % FRAMES;
      tile.style.backgroundImage = grainFrames[gf];
      tile.style.backgroundSize = gs + 'px ' + gs + 'px';
      tile.style.backgroundPosition =
        Math.round(Math.random() * gs) + 'px ' + Math.round(Math.random() * gs) + 'px';
      tile.style.opacity = '0.04';
    }, 42);
  }

  // - Reel playback -
  // `autoplay muted playsinline` is supposed to be enough, and usually is. It is
  // not enough in Low Power Mode, under Chrome's "never autoplay" site setting,
  // or when the tab is restored in the background — and when the browser refuses,
  // it draws its OWN play badge over the film. That badge was unreachable: the
  // video is `pointer-events: none` so the pinned hero stays a scroll surface,
  // which left the reel stopped with a button that could not be pressed.
  //
  // So: ask again at each point the answer can change, and if the answer is still
  // no, hand the pointer back to the video so the badge the browser drew is
  // actually clickable. `data-reel-blocked` is the whole of that state.
  private wireReel() {
    const v = this.ref<HTMLVideoElement>('reelVideo');
    if (!v) return; // Vimeo embed — the iframe player owns its own playback

    const frame = this.ref('reelFrame');
    const blocked = (on: boolean) => frame?.toggleAttribute('data-reel-blocked', on);

    const attempt = () => {
      if (!v.paused) return blocked(false);
      const p = v.play();
      if (!p) return;
      p.then(() => blocked(false)).catch(() => blocked(true));
    };

    // The retry points, in the order they tend to fire.
    this.reelRetry = attempt;
    v.addEventListener('loadeddata', attempt);
    v.addEventListener('canplay', attempt);
    v.addEventListener('play', () => blocked(false));
    // A blocked video only needs one real gesture anywhere on the page to be
    // allowed to start — including the cue click, which is the gesture someone
    // who wants past the reel makes anyway.
    document.addEventListener('pointerdown', attempt, { passive: true });
    document.addEventListener('keydown', attempt);
    document.addEventListener('visibilitychange', this.reelRetry);
    attempt();
  }

  // - Reel sizing (cover-crop a 16:9 player) -
  private sizeReel() {
    const box = this.ref('reelFrame');
    const ifr = this.ref('reelIframe');
    if (!box || !ifr) return;
    const r = box.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const scale = Math.max(r.width / 16, r.height / 9);
    ifr.style.width = Math.ceil(16 * scale) + 'px';
    ifr.style.height = Math.ceil(9 * scale) + 'px';
  }

  // - Foot bar -
  private footerActive() {
    const sec = this.ref('footer');
    if (!sec) return false;
    return sec.getBoundingClientRect().top < window.innerHeight * 0.6;
  }
  private watchFootBar() {
    // FootBar is site-wide chrome (rendered by Base, OUTSIDE the home root), so query it globally.
    const bar = document.querySelector<HTMLElement>('[data-ref="footBar"]');
    if (!bar) return;
    const inners = Array.prototype.slice.call(
      document.querySelectorAll<HTMLElement>('[data-ref="footBar"] [data-fbi]'),
    ) as HTMLElement[];
    this.footScroll = () => {
      const hw = this.ref('heroWrap');
      const heroEnd = hw ? hw.getBoundingClientRect().bottom : 0;
      const show = heroEnd <= window.innerHeight * 0.4 && !this.footerActive();
      bar.style.opacity = show ? '1' : '0';
      inners.forEach((el, i) => {
        el.style.transitionDelay = (show ? i * 70 : 0) + 'ms';
        el.style.transform = show ? 'none' : 'translateY(110%)';
      });
    };
    this.footScroll();
    window.addEventListener('scroll', this.footScroll, { passive: true });
    window.__aoinLenis?.on('scroll', this.footScroll);
  }

  // - Responsive (chrome subset for this slice) -
  private applyResponsive() {
    const m = window.innerWidth <= 720;
    const pad = m ? 20 : 48;
    // Content is capped + centred on wide screens (--content-max); frameGutter is
    // the empty space outside that frame on one side. Chrome that aligns to the
    // frame ADDS it to its inset; the marquee SUBTRACTS it to bleed full-width.
    const clientW = document.documentElement.clientWidth;
    const cmax =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--content-max')) || 1920;
    const frameGutter = Math.max(0, (clientW - cmax) / 2);
    // BOTH cue layers, for the same reason runCue() writes metrics to both: the
    // twin is drawn directly on top of the cue to take the colour out of it, so
    // a font-size or offset set on only one separates them. Setting it here on
    // `cue` alone put the twin 8px high and a pixel large at <=720 — which is
    // half-screen on a laptop, not a phone — and the offset desaturation read
    // as a grey box beside the opening bracket.
    for (const root of [this.ref('cue'), this.ref('cueSat')]) {
      if (!root) continue;
      root.style.fontSize = (m ? 10 : 11) + 'px';
      root.style.bottom = (m ? 30 : 38) + 'px';
    }
    const about = this.ref('about');
    if (about) {
      about.style.padding = m ? '104px 20px 80px' : '120px 48px 120px';
      about.style.minHeight = m ? 'auto' : '100svh';
    }
    const portrait = this.ref('portrait');
    if (portrait) {
      // Bleed the marquee to the full viewport, past the capped About frame.
      const bleed = frameGutter + pad;
      portrait.style.marginLeft = '-' + bleed + 'px';
      portrait.style.marginRight = '-' + bleed + 'px';
      portrait.style.minHeight = m ? '28svh' : '40svh';
      portrait.style.marginTop = STILL_GAP + 'px';
      portrait.style.flex = m ? '0 0 auto' : '1 1 auto';
    }
    const stmtWrap = this.ref('stmtWrap');
    if (stmtWrap && stmtWrap.parentElement) {
      // Narrower column => the 4-line fit lands ~1.5x smaller on big screens.
      stmtWrap.parentElement.style.flex = m ? '0 1 100%' : '0 1 min(62%,510px)';
    }

    const svc = this.ref('services');
    if (svc) {
      const svcLabels = svc.children[0] as HTMLElement;
      svcLabels.style.position = m ? 'static' : 'sticky';
      svcLabels.style.transform = m ? 'none' : 'translateY(-50%)';
      svcLabels.style.fontSize = (m ? 11 : 18) + 'px';
      this.refs('[data-ref="services"] [data-panel] > div').forEach((row) => {
        row.style.flexDirection = m ? 'column' : 'row';
        row.style.gap = m ? '14px' : 'clamp(32px,6vw,120px)';
        const blurb = row.firstElementChild as HTMLElement;
        if (blurb) blurb.style.flex = m ? '0 1 auto' : '0 1 min(52ch,52%)';
      });
      svc.style.padding = m ? '100px 20px 0' : '120px 48px 0';
    }

    const foot = this.ref('footer');
    if (foot) {
      // Phones: the nav hides over the footer (data-nav-hide), so [INFO] can sit
      // near the top — 96px of pad left a hole where the nav wasn't. And the
      // footer should be exactly the screen once it is scrolled fully into
      // view, which on a phone is a moving target: the browser chrome retracts
      // as you reach the bottom. dvh follows the chrome in and out; svh (the
      // chrome-in height) is the floor for browsers without it, since setting
      // an unsupported value is a no-op and the earlier assignment stands.
      foot.style.padding = m ? '64px 20px 0' : '110px 48px 0';
      foot.style.height = m ? 'auto' : '100svh';
      foot.style.minHeight = m ? '100svh' : '560px';
      if (m) foot.style.minHeight = '100dvh';
      const grid = foot.firstElementChild as HTMLElement;
      grid.style.gridTemplateColumns = m ? '1fr 1fr' : '1.6fr 1fr 1fr .9fr';
      grid.style.rowGap = m ? '40px' : '';
      grid.style.fontSize = (m ? 10 : 12) + 'px';
      const cols = Array.prototype.slice.call(grid.children) as HTMLElement[];
      cols.forEach((c, i) => {
        c.style.justifySelf = m ? 'start' : i === 3 ? 'end' : 'start';
        c.style.textAlign = m ? 'left' : i === 3 ? 'right' : 'left';
      });
      const mark = foot.lastElementChild as HTMLElement;
      mark.style.paddingBottom = m ? 'clamp(20px,3svh,40px)' : 'clamp(28px,4svh,56px)';
      mark.style.marginTop = m ? '64px' : '0';
    }

    const fbar = document.querySelector<HTMLElement>('[data-ref="footBar"]'); // site-wide chrome (Base), query globally
    if (fbar) {
      // Fixed + full-width, so align it to the capped frame like the nav: pad on
      // normal screens, pad + the ultrawide gutter beyond it.
      const edge = pad + frameGutter;
      fbar.style.left = edge + 'px';
      fbar.style.right = edge + 'px';
      fbar.style.fontSize = (m ? 9 : 11) + 'px';
      fbar.style.bottom = (m ? 16 : 24) + 'px';
    }
  }

  // - Hero scroll scrub -
  private updateHero() {
    const wrap = this.ref('heroWrap');
    const box = this.ref('box');
    const mask = this.ref('mask');
    if (!wrap || !box || !mask) return;
    const vh = window.innerHeight,
      vw = window.innerWidth;
    const total = wrap.offsetHeight - vh;
    const rect = wrap.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, -rect.top / Math.max(1, total)));
    const startW = this.cfg.reelStartWidth / 100;
    const w0 = vw * startW,
      h0 = (w0 * 9) / 16;
    const icon = this.ref('icon');
    const iconW = Math.min(vw * 0.36, 620, ((h0 * 0.92 * 500) / 425));
    const iconH = (iconW * 425) / 500;
    if (icon) icon.style.width = Math.round(iconW) + 'px';
    const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    let w: number, h: number, reelY: number, iconY: number;
    if (p < 0.5) {
      const t = ease(p / 0.5);
      w = w0;
      h = h0;
      reelY = (1 - t) * 101;
      iconY = t * (h0 / 2 + iconH / 2 + 12);
    } else {
      const hold = Math.min(0.6, Math.max(0, this.cfg.reelHold));
      const span = Math.max(0.05, 0.5 - hold);
      const t = ease(Math.min(1, (p - 0.5) / span));
      w = w0 + (vw - w0) * t;
      h = h0 + (vh - h0) * t;
      reelY = 0;
      iconY = h0 / 2 + iconH / 2 + 12;
    }
    mask.style.width = w + 'px';
    mask.style.height = h + 'px';
    mask.style.left = (vw - w) / 2 + 'px';
    mask.style.top = (vh - h) / 2 + 'px';
    box.style.transform = 'translateY(' + reelY + '%)';
    if (icon) icon.style.transform = 'translate(-50%, calc(-50% - ' + Math.round(iconY) + 'px))';
    const cue = this.ref('cue');
    // The cue used to fade over the FIRST 6% of the pin, so it was gone after a
    // nudge of the wheel — while the reel was still pinned and filling the
    // screen, which is exactly when a reader needs telling there is a way past
    // it. It now holds for the whole hero and goes only as the pin releases.
    //
    // Opacity is safe to fade even though `.cue` blends: opacity groups the
    // element and the group is what gets blended, so the difference still
    // reaches the film all the way down. It is a blend on a DESCENDANT that an
    // opacity would have isolated.
    const f = Math.max(0, Math.min(1, (1 - p) / 0.15));
    if (cue && this.cueShown) cue.style.opacity = String(f);
    // The twin fades with it. Left up on its own it would keep desaturating a
    // patch of film with nothing written in it.
    const cueSat = this.ref('cueSat');
    if (cueSat && this.cueShown) cueSat.style.opacity = String(f);
    this.sizeReel();
  }

  private scrollToY(y: number) {
    if (window.__aoinLenis) window.__aoinLenis.scrollTo(y, { duration: 1.4 });
    else window.scrollTo({ top: y, behavior: 'smooth' });
  }

  // - About: display type fitting -
  private fitDisplay() {
    const wrap = this.ref('display');
    if (!wrap) return;
    const lines = this.refs('[data-ref="display"] [data-dline]');
    if (!lines.length) return;
    const W = wrap.clientWidth;
    if (!W) return;
    const base = 200;
    wrap.style.fontSize = base + 'px';
    let widest = 0;
    lines.forEach((line) => {
      const words = Array.prototype.slice.call(line.children) as HTMLElement[];
      const sum =
        words.reduce((a, s) => a + s.getBoundingClientRect().width, 0) +
        (words.length - 1) * base * 0.28;
      if (sum > widest) widest = sum;
    });
    const fitted = widest > 0 ? (W / widest) * base : base;
    const floor = Math.min(46, fitted);
    // Cap ~1.5x smaller than fill so the display doesn't get huge on big screens.
    const size = Math.max(floor, Math.min(100, fitted));
    wrap.style.fontSize = size + 'px';
    // displayAlign default 'centered'
    lines.forEach((line) => {
      line.style.gap = '.26em';
      line.style.justifyContent = 'center';
    });
  }

  private applyAboutType() {
    const el = this.ref('stmtWrap');
    if (el) {
      // fitAndBuild owns the statement font size. Setting a clamp() here too made
      // the blurb briefly balloon to its rough fallback size and then "pop" to the
      // fitted size — most visible when deep-linking to #about. Only the box
      // styling fitAndBuild reads is set here now.
      el.style.lineHeight = '1.5';
      el.style.textAlign = 'justify';
      el.style.textAlignLast = 'justify';
    }
    const display = this.ref('display');
    if (display) {
      display.style.lineHeight = '0.96';
      this.fitDisplay();
    }
    const portrait = this.ref('portrait');
    if (portrait) portrait.style.marginTop = STILL_GAP + 'px';
    this.applySliderStyle();
    const about = this.ref('about');
    if (about) {
      about.querySelectorAll<HTMLElement>('[data-dropcap]').forEach((c) => {
        c.style.marginRight = '1em';
      });
      about.style.marginTop = '0px';
      const kids = Array.prototype.slice.call(about.children) as HTMLElement[];
      kids.forEach((c) => (c.style.transform = 'none'));
    }
  }

  private fitDropcap() {
    const about = this.ref('about');
    const box = about && about.querySelector<HTMLElement>('[data-dropcap]');
    if (!box) return;
    const cap = (family: string, weight: number) => {
      const p = document.createElement('span');
      p.textContent = 'H';
      p.style.cssText =
        'position:absolute;visibility:hidden;left:-9999px;top:0;font-size:400px;line-height:1;text-box:trim-both cap alphabetic;font-family:' +
        family +
        ';font-weight:' +
        weight;
      document.body.appendChild(p);
      const h = p.getBoundingClientRect().height;
      p.remove();
      return h;
    };
    const denim = cap("'Denim INK WD',sans-serif", 500);
    const theran = cap("'SN Ja Mono',monospace", 300);
    if (denim > 0 && theran > 0) box.style.fontSize = (denim / theran).toFixed(3) + 'em';
  }

  // - About: statement line solver -
  private stmtOverflow() {
    const wrap = this.ref('stmtWrap');
    const out = this.ref('stmtOut');
    if (!wrap || !out) return false;
    const lh = parseFloat(getComputedStyle(wrap).lineHeight) || 0;
    if (!lh) return false;
    return (Array.prototype.slice.call(out.children) as HTMLElement[]).some((c) => {
      const inner = (c.firstElementChild as HTMLElement) || c;
      return inner.getBoundingClientRect().height > lh * 1.35;
    });
  }

  private buildStatementLines(): number[] | undefined {
    const el = this.ref('stmtOut');
    const src = this.ref('statement');
    if (!el || !src) return;
    this.stmtHTML = src.innerHTML;
    el.innerHTML = this.stmtHTML;
    const tokens: Node[] = [];
    Array.prototype.slice.call(el.childNodes).forEach((n: Node) => {
      if (n.nodeType === 1) {
        tokens.push(n);
        return;
      }
      (n.textContent || '').split(/(\s+)/).forEach((t) => {
        if (!t) return;
        if (/^\s+$/.test(t)) tokens.push(document.createTextNode(' '));
        else {
          const s = document.createElement('span');
          s.textContent = t;
          tokens.push(s);
        }
      });
    });
    el.innerHTML = '';
    tokens.forEach((t) => el.appendChild(t));
    const lines: { key: number; items: Node[] }[] = [];
    let cur: { key: number; items: Node[] } | null = null;
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 24;
    tokens.forEach((t) => {
      if (t.nodeType !== 1) {
        if (cur) cur.items.push(t);
        return;
      }
      const e = t as HTMLElement;
      const bottom = e.offsetTop + e.offsetHeight;
      if (!cur) {
        cur = { key: bottom, items: [t] };
        lines.push(cur);
        return;
      }
      if (Math.abs(bottom - cur.key) > lh * 0.5) {
        cur = { key: bottom, items: [t] };
        lines.push(cur);
      } else cur.items.push(t);
    });
    el.innerHTML = '';
    lines.forEach((line, idx) => {
      const mask = document.createElement('div');
      mask.style.overflow = 'hidden';
      const inner = document.createElement('div');
      inner.setAttribute('data-ai', '1');
      inner.style.transform = this.aboutShown ? 'none' : 'translateY(110%)';
      const isLast = idx === lines.length - 1;
      const words = line.items.filter((n) => n.nodeType === 1).length;
      inner.style.textAlign = 'justify';
      inner.style.textAlignLast = isLast && words < 3 ? 'left' : 'justify';
      line.items.forEach((n) => inner.appendChild(n));
      mask.appendChild(inner);
      el.appendChild(mask);
    });
    const cap = el.querySelector<HTMLElement>('[data-dropcap]');
    if (cap) cap.style.marginRight = '0.52em';
    if (
      el.textContent!.replace(/\s+/g, '').length <
      src.textContent!.replace(/\s+/g, '').length - 2
    ) {
      el.innerHTML = this.stmtHTML;
    }
    return lines.map((l) => l.items.filter((n) => n.nodeType === 1).length);
  }

  // Self-heal for the statement blurb. On the tighter production timing the
  // one-shot About IntersectionObserver can fire (marking aboutShown + playing
  // the reveal) BEFORE fitAndBuild has produced any lines, and its guard then
  // blocks a rebuild — leaving stmtOut permanently empty (dev's looser timing
  // dodges this). So on every scroll frame, once About is on screen, guarantee
  // the statement is built; if the reveal already ran, snap the lines visible.
  // Self-guarded by stmtHealed so it costs one boolean check per frame at rest.
  private healStatement() {
    if (this.stmtHealed) return;
    const sec = this.ref('about');
    const out = this.ref('stmtOut');
    if (!sec || !out) return;
    const r = sec.getBoundingClientRect();
    if (r.top >= window.innerHeight || r.bottom <= 0) return; // wait until About is on screen
    if (out.childElementCount > 0) {
      // Already built — the normal (animated) reveal owns it; don't interfere.
      this.stmtHealed = true;
      return;
    }
    this.fitAndBuild();
    if (out.childElementCount > 0) {
      // Snap visible if the reveal already fired (stranded), or under reduced
      // motion (no observer runs at all, so nothing would ever un-mask it).
      if (this.aboutShown || reducedMotion()) this.snapAbout(true);
      this.stmtHealed = true;
    }
  }

  private fitAndBuild() {
    const wrap = this.ref('stmtWrap');
    const out = this.ref('stmtOut');
    const src = this.ref('statement');
    const about = this.ref('about');
    if (!wrap || !out || !src) return;
    if (this.aboutAnimating) {
      this.refitQueued = true;
      return;
    }
    const narrow = (about ? about.getBoundingClientRect().width : window.innerWidth) <= 700;
    const target = narrow ? 8 : 4;
    const min = narrow ? 14 : 10;
    const capMax = narrow ? 20 : null;
    const max = capMax || 58;
    const at = (size: number) => {
      wrap.style.fontSize = size + 'px';
      const counts = this.buildStatementLines() || [];
      const last = counts[counts.length - 1] || 0;
      return { n: counts.length, last, over: this.stmtOverflow() };
    };
    let lo = min,
      hi = max;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      const r = at(mid);
      if (r.n <= target && !r.over) lo = mid;
      else hi = mid;
    }
    let size = lo;
    for (let i = 0; i < 30; i++) {
      const r = at(size);
      if (r.n <= target && !r.over && r.last >= 2) break;
      if (size - 0.5 < min) break;
      size -= 0.5;
    }
    at(size);
  }

  // - About: reveal -
  private aboutEase() {
    return 'cubic-bezier(0.05,0.89,0,0.99)';
  }

  private playAbout(show = true) {
    const sec = this.ref('about');
    if (!sec) return;
    this.aboutAnimating = true;
    clearTimeout(this.aboutDoneId);
    const inners = this.refs('[data-ref="about"] [data-ai]');
    // 90ms (was 180) — pulls the bleed marquee in closer behind the text
    const stagger = 90 * (show ? 1 : 0.35);
    const dur = 820 * (show ? 1 : 0.55);
    const ease = this.aboutEase();
    this.aboutTimers.forEach(clearTimeout);
    this.aboutTimers = [];
    const n = inners.length;
    const lead = show ? 260 : 0;
    inners.forEach((el, i) => {
      const order = show ? i : n - 1 - i;
      const from = show ? 'translateY(110%)' : 'translateY(0%)';
      const to = show ? 'translateY(0%)' : 'translateY(110%)';
      el.getAnimations().forEach((a) => a.cancel());
      el.style.transform = from;
      el.animate(
        [
          { transform: from, offset: 0, easing: ease },
          { transform: to, offset: 1 },
        ],
        { duration: dur, delay: lead + order * stagger, fill: 'both' }
      );
      this.aboutTimers.push(
        window.setTimeout(
          () => {
            el.getAnimations().forEach((a) => a.cancel());
            el.style.transform = show ? 'none' : 'translateY(110%)';
          },
          lead + order * stagger + dur + 20
        )
      );
    });
    this.aboutDoneId = window.setTimeout(
      () => {
        this.aboutAnimating = false;
        if (this.refitQueued) {
          this.refitQueued = false;
          this.fitAndBuild();
        }
      },
      lead + n * stagger + dur + 80
    );
    // display words travel outward from centre into rest
    const lines = this.refs('[data-ref="about"] [data-dline]');
    const collapse = 0.55;
    const wordStagger = 70;
    lines.forEach((line, li) => {
      const words = Array.prototype.slice.call(line.children) as HTMLElement[];
      const lr = line.getBoundingClientRect();
      const cx = lr.left + lr.width / 2;
      words.forEach((w, wi) => {
        const r = w.getBoundingClientRect();
        const dx = (cx - (r.left + r.width / 2)) * collapse;
        const delay = show ? li * stagger + wi * wordStagger : (n - 1 - li) * stagger;
        const from = show ? 'translateX(' + dx + 'px)' : 'translateX(0px)';
        const to = show ? 'translateX(0px)' : 'translateX(' + dx + 'px)';
        w.getAnimations().forEach((a) => a.cancel());
        w.style.transform = from;
        w.animate(
          [
            { transform: from, offset: 0, easing: ease },
            { transform: to, offset: 1 },
          ],
          { duration: dur * 1.15, delay: lead + delay, fill: 'both' }
        );
        this.aboutTimers.push(
          window.setTimeout(
            () => {
              w.getAnimations().forEach((a) => a.cancel());
              w.style.transform = show ? 'none' : 'translateX(' + dx + 'px)';
            },
            lead + delay + dur * 1.15 + 20
          )
        );
      });
    });
  }

  private snapAbout(show: boolean) {
    const sec = this.ref('about');
    if (!sec) return;
    this.aboutTimers.forEach(clearTimeout);
    clearTimeout(this.aboutDoneId);
    this.aboutAnimating = false;
    this.refs('[data-ref="about"] [data-ai]').forEach((el) => {
      el.getAnimations().forEach((a) => a.cancel());
      el.style.transform = show ? 'none' : 'translateY(110%)';
    });
    this.refs('[data-ref="about"] [data-dline]').forEach((line) => {
      (Array.prototype.slice.call(line.children) as HTMLElement[]).forEach((w) => {
        w.getAnimations().forEach((a) => a.cancel());
        w.style.transform = 'none';
      });
    });
  }

  private watchAbout() {
    const sec = this.ref('about');
    if (!sec) return;
    if (reducedMotion()) {
      this.refs('[data-ref="about"] [data-ai]').forEach((el) => (el.style.transform = 'none'));
      return;
    }
    this.aboutIo = new IntersectionObserver(
      (es) => {
        es.forEach((e) => {
          if (e.isIntersecting === this.aboutShown) return;
          this.aboutShown = e.isIntersecting;
          const below = e.boundingClientRect.top > 0;
          if (e.isIntersecting) {
            this.fitAndBuild();
            if (below || !this.aboutPlayed) {
              this.aboutPlayed = true;
              this.playAbout(true);
            } else this.snapAbout(true);
          } else if (below) {
            this.playAbout(false);
          }
        });
      },
      { threshold: 0.2 }
    );
    this.aboutIo.observe(sec);
  }

  // - Bleed slider -
  // Fresh marquee order on each load. Shuffle the real slides, then rebuild the
  // mirror to match so the seamless loop stays in step.
  private shuffleMarquee() {
    const track = this.ref('track');
    const mirror = this.ref('mirror');
    if (!track || !mirror) return;
    const originals = (Array.prototype.slice.call(track.children) as HTMLElement[]).filter(
      (c) => c !== mirror,
    );
    for (let i = originals.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [originals[i], originals[j]] = [originals[j], originals[i]];
    }
    originals.forEach((o) => track.insertBefore(o, mirror));
    mirror.innerHTML = '';
    originals.forEach((o) => {
      const c = o.cloneNode(true) as HTMLElement;
      c.setAttribute('aria-hidden', 'true');
      c.setAttribute('tabindex', '-1');
      mirror.appendChild(c);
    });
  }

  private startSlider() {
    const track = this.ref('track');
    if (!track || this.sliderOn) return;
    this.sliderOn = true;
    this.shuffleMarquee(); // fresh order each load (marquee is still masked here)
    this.x = 0;
    this.target = 0;
    const mirror = this.ref('mirror');
    const tiles = () =>
      (Array.prototype.slice.call(track.children) as HTMLElement[]).filter((c) => c !== mirror);
    this.half = 0;
    const measure = () => {
      const t = tiles();
      if (!t.length) return 0;
      const r = t[0].getBoundingClientRect();
      this.sw = r.width + 12;
      this.half = this.sw * t.length;
      return this.half;
    };
    measure();
    const wrap = (v: number) => {
      const h = this.half || measure() || 1;
      return (((v % h) + h) % h) - h;
    };
    const tick = (now: number) => {
      const dt = Math.min(64, now - (this.last || now));
      this.last = now;
      if (!this.dragging) this.target -= (26 * dt) / 1000;
      this.x += (this.target - this.x) * 0.12;
      track.style.transform = 'translateX(' + wrap(this.x) + 'px)';
      this.slideRaf = requestAnimationFrame(tick);
    };
    this.slideRaf = requestAnimationFrame(tick);
    this.onMove = (e: PointerEvent) => {
      if (this.dragging) {
        const dx = e.clientX - this.px;
        this.px = e.clientX;
        this.target += dx;
        this.smoved = Math.max(this.smoved, Math.hypot(e.clientX - this.sdownX, e.clientY - this.sdownY));
      }
    };
    this.onUp = () => {
      if (!this.dragging) return;
      this.dragging = false;
      track.style.cursor = 'grab';
      (window as unknown as { aoinCursor?: { hold(on: boolean): void } }).aoinCursor?.hold(false);
    };
    track.style.cursor =
      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Cpath d='M12 3v18M3 12h18' stroke='%23DDE7F4' stroke-width='1.25'/%3E%3C/svg%3E\") 12 12, crosshair";
    track.style.userSelect = 'none';
    (track.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect = 'none';
    track.style.touchAction = 'pan-y';
    this.noDrag = (e: Event) => e.preventDefault();
    track.querySelectorAll('img, video').forEach((i) => ((i as HTMLElement).draggable = false));
    track.addEventListener('dragstart', this.noDrag);
    track.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.dragging = true;
      this.px = (e as PointerEvent).clientX;
      this.sdownX = (e as PointerEvent).clientX;
      this.sdownY = (e as PointerEvent).clientY;
      this.smoved = 0;
      (window as unknown as { aoinCursor?: { hold(on: boolean): void } }).aoinCursor?.hold(true);
    });
    // Slides are project links; suppress the trailing click after a real drag so
    // it doesn't navigate. A tap (barely moved) falls through and the flight runs.
    this.onSliderClick = (e: Event) => {
      if (this.smoved > 6) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    track.addEventListener('click', this.onSliderClick, true);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    this.onResizeSlider = () => measure();
    window.addEventListener('resize', this.onResizeSlider);
  }

  private layoutSlider() {
    this.startSlider();
  }

  private applySliderStyle() {
    const track = this.ref('track');
    if (!track) return;
    const m = window.innerWidth <= 720;
    const w = m ? 72 : 39;
    const r = 12;
    (Array.prototype.slice.call(track.querySelectorAll('[data-slide]')) as HTMLElement[]).forEach(
      (t) => {
        t.style.width = w + 'vw';
        t.style.borderRadius = r + 'px';
      }
    );
    if (this.sw) {
      const first = track.querySelector<HTMLElement>('[data-slide]');
      const n = track.querySelectorAll('[data-slide]').length / 2 || 1;
      if (first) {
        this.sw = first.getBoundingClientRect().width + 12;
        this.half = this.sw * n;
      }
    }
  }

  // - Work cue -
  private wireWorkCue() {
    const cue = this.ref('workCue');
    if (!cue) return;
    cue.addEventListener('mouseenter', () => this.setWorkBrackets(10));
    cue.addEventListener('mouseleave', () => this.setWorkBrackets(0));
    // Navigation is the anchor's own href="/work" (intercepted by the flight
    // engine when present); the controller only owns the bracket hover.
  }
  private setWorkBrackets(px: number) {
    const cue = this.ref('workCue');
    if (!cue) return;
    cue.querySelectorAll<HTMLElement>('[data-wb]').forEach((b) => {
      const dir = Number(b.getAttribute('data-wb')) || 1;
      b.style.transform = px ? 'translateX(' + dir * px + 'px)' : 'none';
    });
  }

  // - Services -
  private wireServices() {
    // Hover opens a panel on a pointer device. A touch screen has no hover to leave: the tap fires
    // an emulated mouseenter that opens the panel and nothing ever fires to close it again, so the
    // title becomes a toggle there instead. One or the other, never both — bound together, the tap
    // would open on the emulated mouseenter and the click would immediately toggle it shut.
    // The handler goes on the title, not the row: the row includes the panel, and a tap on the
    // LEARN MORE link inside it should follow the link, not fold the panel away under the finger.
    const canHover = matchMedia('(hover: hover)').matches;
    this.refs('[data-ref="services"] [data-svc]').forEach((row) => {
      if (canHover) {
        row.addEventListener('mouseenter', () => this.openService(row));
        row.addEventListener('mouseleave', () => this.closeService(row));
        return;
      }
      const title = row.querySelector<HTMLElement>('[data-sr]');
      if (!title) return;
      title.addEventListener('click', () => {
        if (this.isServiceOpen(row)) this.closeService(row);
        else this.openService(row);
      });
    });
  }
  /** Open === the panel has been given a height. Untouched panels have no inline height at all
   *  (the stylesheet keeps them at 0), and parseFloat('') is NaN, which reads as closed. */
  private isServiceOpen(row: HTMLElement) {
    const p = row && row.querySelector<HTMLElement>('[data-panel]');
    return !!p && parseFloat(p.style.height) > 0;
  }
  private openService(row: HTMLElement) {
    const list = this.ref('servicesList');
    if (!row || !list) return;
    this.refs('[data-ref="servicesList"] [data-svc]').forEach((r) => {
      const p = r.querySelector<HTMLElement>('[data-panel]');
      if (!p) return;
      if (r === row) p.style.height = (p.firstElementChild as HTMLElement).getBoundingClientRect().height + 'px';
      else p.style.height = '0px';
    });
  }
  private closeService(row: HTMLElement) {
    const p = row && row.querySelector<HTMLElement>('[data-panel]');
    if (p) p.style.height = '0px';
  }
  private applyServicesType() {
    const el = this.ref('servicesList');
    if (!el) return;
    el.style.fontSize = 'clamp(46px,8vw,150px)';
    el.style.lineHeight = '1.02';
    const col = this.ref('servicesCol');
    const lines = this.refs('[data-ref="servicesList"] [data-sline]');
    const svc = this.ref('services');
    const labels = svc ? this.refs('[data-ref="services"] [data-sr] > [data-si]') : [];
    const labelW = labels.slice(0, 2).reduce((m, l) => Math.max(m, l.getBoundingClientRect().width), 0);
    const narrow = (svc ? svc.getBoundingClientRect().width : window.innerWidth) <= 700;
    const gutter = narrow ? 0 : labelW ? labelW + 40 : 0;
    const avail = Math.max(200, el.clientWidth - gutter * 2);
    if (col && lines.length && avail) {
      col.style.width = '100%';
      const natural = () =>
        lines.reduce((m, l) => {
          const kids = Array.prototype.slice.call(l.children) as HTMLElement[];
          const gap = parseFloat(getComputedStyle(l).columnGap) || 0;
          const w =
            kids.reduce((a, k) => a + k.getBoundingClientRect().width, 0) +
            gap * Math.max(0, kids.length - 1);
          return Math.max(m, w);
        }, 0);
      let size = parseFloat(getComputedStyle(el).fontSize) || 80;
      let w = natural();
      if (w > avail) {
        size = Math.floor(size * (avail / w) * 100) / 100;
        el.style.fontSize = size + 'px';
        for (let i = 0; i < 12 && natural() > avail && size > 24; i++) {
          size -= 0.5;
          el.style.fontSize = size + 'px';
        }
        w = natural();
      }
      col.style.width = Math.ceil(w) + 'px';
    }
    el.style.paddingTop = '0px';
    const vh = window.innerHeight;
    el.style.paddingTop = Math.round(vh * (SVC_LEAD_IN / 100)) + 'px';
    el.style.paddingBottom = Math.round(vh * (SVC_SETTLE / 100)) + 'px';
  }
  private playServices(show: boolean) {
    const sec = this.ref('services');
    if (!sec) return;
    const inners = this.refs('[data-ref="services"] [data-si]');
    const stagger = 180 * (show ? 1 : 0.35);
    const dur = 820 * (show ? 1 : 0.55);
    const ease = this.aboutEase();
    this.svcTimers.forEach(clearTimeout);
    this.svcTimers = [];
    const n = inners.length;
    inners.forEach((el, i) => {
      const order = show ? i : n - 1 - i;
      const from = show ? 'translateY(110%)' : 'translateY(0%)';
      const to = show ? 'translateY(0%)' : 'translateY(110%)';
      el.getAnimations().forEach((a) => a.cancel());
      el.style.transform = from;
      el.animate(
        [
          { transform: from, offset: 0, easing: ease },
          { transform: to, offset: 1 },
        ],
        { duration: dur, delay: order * stagger, fill: 'both' }
      );
      this.svcTimers.push(
        window.setTimeout(
          () => {
            el.getAnimations().forEach((a) => a.cancel());
            el.style.transform = show ? 'none' : 'translateY(110%)';
          },
          order * stagger + dur + 20
        )
      );
    });
  }
  private watchServices() {
    const sec = this.ref('services');
    if (!sec) return;
    const inners = this.refs('[data-ref="services"] [data-si]');
    if (reducedMotion()) {
      inners.forEach((el) => (el.style.transform = 'none'));
      return;
    }
    this.svcIo = new IntersectionObserver(
      (es) => {
        es.forEach((e) => {
          if (e.isIntersecting === this.svcShown) return;
          this.svcShown = e.isIntersecting;
          const below = e.boundingClientRect.top > 0;
          if (e.isIntersecting) {
            if (below || !this.svcPlayed) {
              this.svcPlayed = true;
              this.playServices(true);
            } else
              this.refs('[data-ref="services"] [data-si]').forEach((el) => {
                el.getAnimations().forEach((a) => a.cancel());
                el.style.transform = 'none';
              });
          } else if (below) {
            this.playServices(false);
          }
        });
      },
      { threshold: 0.25 }
    );
    this.svcIo.observe(sec);
  }

  // - Footer reveal -
  private watchFooter() {
    const sec = this.ref('footer');
    if (!sec) return;
    const inners = this.refs('[data-ref="footer"] [data-fi]');
    inners.forEach((el) => (el.style.transition = 'transform .7s cubic-bezier(.05,.89,0,.99)'));
    this.footerScroll = () => {
      const r = sec.getBoundingClientRect();
      const show = r.top < window.innerHeight * 0.82;
      inners.forEach((el, i) => {
        el.style.transitionDelay = (show ? i * 60 : 0) + 'ms';
        el.style.transform = show
          ? 'none'
          : el.parentElement!.getAttribute('data-fr') && el.querySelector('img')
            ? 'translateY(30%)'
            : 'translateY(110%)';
      });
    };
    this.footerScroll();
    window.addEventListener('scroll', this.footerScroll, { passive: true });
    window.__aoinLenis?.on('scroll', this.footerScroll);
  }

  destroy() {
    window.removeEventListener('scroll', this.onScroll);
    window.removeEventListener('resize', this.onResize);
    if (this.reelRetry) {
      document.removeEventListener('pointerdown', this.reelRetry);
      document.removeEventListener('keydown', this.reelRetry);
      document.removeEventListener('visibilitychange', this.reelRetry);
    }
    if (this.footScroll) window.removeEventListener('scroll', this.footScroll);
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.preRaf);
    clearInterval(this.blinkId);
    clearInterval(this.atmoTimer);
    clearTimeout(this.blinkTimer);
    this.atmoOn = false;

    if (this.aboutIo) this.aboutIo.disconnect();
    if (this.stmtRO) this.stmtRO.disconnect();
    cancelAnimationFrame(this.roRaf);
    cancelAnimationFrame(this.slideRaf);
    this.aboutTimers.forEach(clearTimeout);
    clearTimeout(this.aboutDoneId);
    if (this.onMove) window.removeEventListener('pointermove', this.onMove);
    if (this.onUp) window.removeEventListener('pointerup', this.onUp);
    if (this.onResizeSlider) window.removeEventListener('resize', this.onResizeSlider);
    if (this.onSliderClick)
      this.ref('track')?.removeEventListener('click', this.onSliderClick, true);

    if (this.svcIo) this.svcIo.disconnect();
    this.svcTimers.forEach(clearTimeout);
    if (this.footerScroll) window.removeEventListener('scroll', this.footerScroll);

    // Fully stop Lenis (the rAF loop is self-perpetuating) so it doesn't keep
    // hijacking scroll on the destination after a soft nav off the home page.
    if (window.__aoinLenisRaf) cancelAnimationFrame(window.__aoinLenisRaf);
    window.__aoinLenis?.destroy();
    window.__aoinLenis = undefined;
    window.__aoinLenisRaf = undefined;
  }
}

export function mountHome(root: HTMLElement) {
  const c = new HomeController(root);
  c.init();
  return c;
}
