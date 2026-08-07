// AOIN home — motion controller.
//
// Direct port of the prototype's `DCLogic` class to plain DOM. Faithful on
// purpose: the structural data-* hooks are kept verbatim, `ref="{{x}}"` became
// `data-ref="x"` (see `ref()`), and the tuned `props.X ?? default` values are
// frozen in CFG below. Values are dialed — changing one changes the feel.
//
// Slice 1: preloader, intro lockup, scroll-scrubbed hero reel, nav reveal,
// scroll cue, film grain, LA clock, foot bar. About → Footer land next.

import Lenis from 'lenis';

const CFG = {
  pinViewports: 2, // hero scroll length = 2 × 100vh
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

declare global {
  interface Window {
    __aoinLenis?: Lenis;
  }
}

const reducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export class HomeController {
  private root: HTMLElement;
  private cfg = CFG;

  // timers / raf / observers to tear down
  private navTimers: number[] = [];
  private navShown = false;
  private raf = 0;
  private preRaf = 0;
  private blinkId = 0;
  private blinkTimer = 0;
  private clockId = 0;
  private atmoTimer = 0;
  private atmoOn = false;
  private cueReady = false;
  private cueShown = false;
  private onScroll!: () => void;
  private onResize!: () => void;
  private footScroll?: () => void;

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
    if (heroWrap) heroWrap.style.height = this.cfg.pinViewports * 100 + 'vh';

    this.onScroll = () => {
      if (this.raf) return;
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.updateHero();
      });
    };
    window.addEventListener('scroll', this.onScroll, { passive: true });

    if (!window.__aoinLenis) {
      window.__aoinLenis = new Lenis({ lerp: 0.09, wheelMultiplier: 1 });
      const raf = (time: number) => {
        window.__aoinLenis!.raf(time);
        requestAnimationFrame(raf);
      };
      requestAnimationFrame(raf);
    }
    window.__aoinLenis.on('scroll', this.onScroll);

    this.onResize = () => {
      this.updateHero();
      this.applyResponsive();
      this.alignNav();
      this.sizeReel();
    };
    window.addEventListener('resize', this.onResize);

    this.wireCue();
    this.updateHero();
    this.startClock();
    this.startAtmosphere();
    this.watchFootBar();
    this.applyResponsive();

    document.fonts.ready.then(() => {
      this.runPreload();
      this.alignNav();
    });
  }

  // ── Preloader ──────────────────────────────────────────────────────────
  private runPreload() {
    const wrap = this.ref('preloader');
    const num = this.ref('preCount');
    const label = this.ref('preLabel');
    if (!wrap) return;
    const go = () => {
      this.runIntro();
      this.runCue();
    };
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

  // ── Intro lockup assembly ──────────────────────────────────────────────
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

  // ── Scroll cue (SCROLL DOWN + bracket blink) ───────────────────────────
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
    const inners = this.refs('[data-ref="cue"] [data-gi]');
    const glyphs = this.refs('[data-ref="cue"] [data-l]');
    const track = this.cfg.cueTracking;
    cue.style.fontSize = this.cfg.cueSize + 'px';
    cue.style.letterSpacing = 'normal';
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
    if (reducedMotion()) {
      cue.style.opacity = '1';
      return;
    }
    const delay = this.cfg.cueIntroDelay;
    const stagger = this.cfg.cueIntroStagger;
    const dur = 520;
    cue.style.opacity = '1';
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
    cue.querySelectorAll<HTMLElement>('[data-br]').forEach((el) => {
      el.style.transform = 'translateX(' + px * Number(el.getAttribute('data-br')) + 'px)';
    });
  }

  // ── Nav reveal ─────────────────────────────────────────────────────────
  private setNav(show: boolean) {
    const nav = this.ref('nav');
    if (!nav || this.navShown === show) return;
    this.navShown = show;
    this.navTimers.forEach(clearTimeout);
    this.navTimers = [];
    nav.style.opacity = '1';
    const inners = this.refs('[data-ref="nav"] [data-ni]');
    const stagger = this.cfg.navStagger * (show ? 1 : 0.35);
    const dur = this.cfg.navDuration * (show ? 1 : 0.55);
    if (reducedMotion()) {
      inners.forEach((el) => (el.style.transform = show ? 'none' : 'translateY(-110%)'));
      return;
    }
    const n = inners.length;
    inners.forEach((el, i) => {
      const order = show ? i : n - 1 - i;
      const from = show ? 'translateY(-110%)' : 'translateY(0%)';
      const to = show ? 'translateY(0%)' : 'translateY(-110%)';
      el.getAnimations().forEach((a) => a.cancel());
      el.animate(
        [
          { transform: from, offset: 0, easing: 'cubic-bezier(1,0,0,1)' },
          { transform: to, offset: 1 },
        ],
        { duration: dur, delay: order * stagger, fill: 'both' }
      );
      el.style.transform = show ? 'none' : 'translateY(-110%)';
    });
  }
  private alignNav() {
    const nav = this.ref('nav');
    if (!nav) return;
    const img = nav.querySelector('img');
    const cols = Array.prototype.slice.call(nav.children).slice(1) as HTMLElement[];
    if (!img || !cols.length) return;
    const h = (img as HTMLImageElement).offsetHeight || 44;
    const capTop = h * (69.7969 / 422);
    const probe = document.createElement('span');
    probe.textContent = 'H';
    probe.style.cssText =
      "position:absolute;visibility:hidden;left:-9999px;font-family:'SN Ja Mono',monospace;font-weight:300;font-size:11px;line-height:1.25;text-box:trim-both cap alphabetic";
    document.body.appendChild(probe);
    const capH = probe.getBoundingClientRect().height;
    probe.remove();
    const lineBox = 11 * 1.25;
    const inset = capH > 0 ? (lineBox - capH) / 2 : 2;
    const pad = Math.max(0, capTop - inset + this.cfg.navTextNudge);
    cols.forEach((c) => (c.style.paddingTop = pad + 'px'));
  }

  // ── Clock ──────────────────────────────────────────────────────────────
  private startClock() {
    const tz = 'America/Los_Angeles';
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const zone = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName');
    const label = (zone ? zone.value : 'GMT-7').replace(':00', '');
    const clock = this.ref('clock');
    const menuClock = this.ref('menuClock');
    const tick = () => {
      const t = fmt.format(new Date()) + ' ' + label;
      if (clock) clock.textContent = t;
      if (menuClock) menuClock.textContent = t;
    };
    tick();
    this.clockId = window.setInterval(tick, 1000);
  }

  // ── Film grain ─────────────────────────────────────────────────────────
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

  // ── Reel sizing (cover-crop a 16:9 player) ─────────────────────────────
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

  // ── Foot bar ───────────────────────────────────────────────────────────
  private footerActive() {
    const sec = this.ref('footer');
    if (!sec) return false;
    return sec.getBoundingClientRect().top < window.innerHeight * 0.6;
  }
  private watchFootBar() {
    const bar = this.ref('footBar');
    if (!bar) return;
    const inners = this.refs('[data-ref="footBar"] [data-fbi]');
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

  // ── Responsive (chrome subset for this slice) ──────────────────────────
  private applyResponsive() {
    const m = window.innerWidth <= 720;
    const pad = m ? 20 : 48;
    const nav = this.ref('nav');
    if (nav) {
      nav.style.left = pad + 'px';
      nav.style.right = pad + 'px';
      nav.style.top = (m ? 16 : 30) + 'px';
      nav.style.gridTemplateColumns = m ? '1fr auto' : '1fr 1fr 1fr 1fr';
      const cells = Array.prototype.slice.call(nav.children) as HTMLElement[];
      [1, 2, 3].forEach((i) => {
        if (cells[i]) cells[i].style.display = m ? 'none' : 'flex';
      });
      if (cells[4]) cells[4].style.display = m ? 'block' : 'none';
      const logo = nav.querySelector('img') as HTMLImageElement | null;
      if (logo) logo.style.height = (m ? 32 : 44) + 'px';
    }
    const cue = this.ref('cue');
    if (cue) {
      cue.style.fontSize = (m ? 10 : 11) + 'px';
      cue.style.bottom = (m ? 30 : 38) + 'px';
    }
    const fbar = this.ref('footBar');
    if (fbar) {
      fbar.style.left = pad + 'px';
      fbar.style.right = pad + 'px';
      fbar.style.fontSize = (m ? 9 : 11) + 'px';
      fbar.style.bottom = (m ? 16 : 24) + 'px';
    }
  }

  // ── Hero scroll scrub ──────────────────────────────────────────────────
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
    if (cue && this.cueShown) cue.style.opacity = String(Math.max(0, 1 - p / 0.06));
    const clear = rect.bottom + this.cfg.navRevealOffset;
    if (this.footerActive()) this.setNav(false);
    else if (clear <= 0) this.setNav(true);
    else if (clear > 40) this.setNav(false);
    this.sizeReel();
  }

  private scrollToY(y: number) {
    if (window.__aoinLenis) window.__aoinLenis.scrollTo(y, { duration: 1.4 });
    else window.scrollTo({ top: y, behavior: 'smooth' });
  }

  destroy() {
    window.removeEventListener('scroll', this.onScroll);
    window.removeEventListener('resize', this.onResize);
    if (this.footScroll) window.removeEventListener('scroll', this.footScroll);
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.preRaf);
    clearInterval(this.blinkId);
    clearInterval(this.clockId);
    clearInterval(this.atmoTimer);
    clearTimeout(this.blinkTimer);
    this.navTimers.forEach(clearTimeout);
    this.atmoOn = false;
  }
}

export function mountHome(root: HTMLElement) {
  const c = new HomeController(root);
  c.init();
  return c;
}
