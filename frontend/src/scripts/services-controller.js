// Services page runtime — ported verbatim from Services 0813.dc.html.
// Plain JavaScript on purpose: this is the design's logic class with four mechanical edits
// (see port/00-PORT-PLAN.md section 4). Do not refactor, retype, or reformat it.
// @ts-nocheck

// Baked from the design's final tweak values — do not re-expose as props.
const FIELD_OPACITY = 60;          // ascii field alpha, % (dimmed so the flashlight pools + nav text read clearer)
const FIELD_TOP_BRIGHTNESS = 66;   // ascii field brightness at the top of the ramp, %
const NAV_BRIGHTNESS = 91;         // capability-label base fill, %
const SWEEP_SPEED = 50;            // gradient sweep speed, % of the 2500ms base pass

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/-';
const GL_ATLAS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-/';
const HOVER_PEAK = 1.5;
const HOVER_FALL_REACH = 22;
const HOVER_RING_MAX = 0.42;
// Field luminance (services hero): the original field is left exactly as-is (its bottom-bright /
// top-sparse gradient), and pools of extra light are ADDED on top — one per middle-nav word plus
// a cursor "flashlight". Light value L in [0,1] = max over all pools of a radial falloff; a cell's
// brightness is scaled by (1 + LUM_BOOST * L) and shifts toward white. L = 0 ⇒ base field unchanged
// (never dimmed). All knobs below are safe to dial after a visual test.
const LUM_BOOST = 1.0;       // additive brightness at a light's centre (alpha ×(1 + this))
const LUM_CURSOR = 1.0;      // cursor-pool strength
const LUM_NAV = 1.0;         // per-word middle-nav pool strength
const LUM_NAV_REACH = 30;    // nav-word pool radius, in cells (wider = the nav flashlight spreads further)
// Deterministic per-cell noise. The field's grid is rebuilt whenever its box
// changes size, and seeding it from Math.random() meant every rebuild was a
// brand new field: at one rebuild per drag that read as a snap, and at one per
// frame it was television static. Keyed on the cell's (column, row) instead,
// a rebuilt grid keeps the exact character it already had everywhere the old
// and new grids overlap -- so the field reads as being extended or trimmed
// rather than replaced, and it can be rebuilt as fast as the window moves.
//
// Column/row are counted from the top-left, which is the corner the field is
// anchored to: it hangs from under the title and grows right and down, so
// existing cells keep their indices and only new ones appear.
//
// `salt` separates the independent draws a cell needs (is it lit, which glyph,
// which dissolve run) so they don't correlate. Math.imul keeps the multiplies
// in 32-bit; plain `*` would drift into float territory and ruin the avalanche.
//
// The finalizer is murmur3's fmix32, and it is not decoration. A single-round
// mix passed every spatial test but left the salt streams correlated at -0.26
// -- which is a cell's "am I lit" draw predicting its dissolve draw, i.e. a
// visible pattern waiting to happen. Measured over 48,000 cells, fmix32 holds
// the worst salt-pair correlation to 0.005 and every neighbour correlation
// (right, down, both diagonals, knight, and further out) under 0.011.
const hash2 = (x, y, salt) => {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

const COPY_GLYPHS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
// Service taxonomy (name + subcategories) for the capability bar + field scramble. Read from the
// #svc-taxonomy JSON island emitted by services.astro (CMS-editable via the `services` global); the
// inline FALLBACK below stands in when the island is absent or malformed (e.g. dev with no CMS).
const SERVICES = (() => {
  const FALLBACK = [
    { name: 'REAL-TIME CONTENT', subs: ['INTERACTIVE ENVIRONMENTS', 'LIVE GRAPHICS', 'VISUAL EFFECTS'] },
    { name: 'SCREENS PRODUCTION', subs: ['SCREENS PRODUCING', 'TECHNICAL DIRECTION', 'MEDIA SERVER PROGRAMMING'] },
    { name: 'MIXED REALITY', subs: ['AUGMENTED REALITY', 'VIRTUAL REALITY', 'PROJECTION MAPPING'] },
    { name: 'EQUIPMENT RENTAL', subs: ['DISGUISE SERVERS', 'RENDER NODES', 'CUSTOM RACK BUILDS'] }
  ];
  try {
    const el = typeof document !== 'undefined' && document.getElementById('svc-taxonomy');
    if (!el || !el.textContent) return FALLBACK;
    const parsed = JSON.parse(el.textContent);
    if (!Array.isArray(parsed) || parsed.length !== FALLBACK.length) return FALLBACK;
    // Merge per index so a blank CMS section never wipes a label: CMS value when present, else fallback.
    return FALLBACK.map((f, i) => {
      const p = parsed[i] || {};
      const subs = Array.isArray(p.subs) && p.subs.length ? p.subs : f.subs;
      return { name: (typeof p.name === 'string' && p.name.trim()) || f.name, subs };
    });
  } catch (e) {
    return FALLBACK;
  }
})();

// Flat word pool for the field's hover-scramble reveal: the 4 service names PLUS their sub-services,
// so hovering the ASCII field can spell any capability, not just the top-level names. Derived from the
// same CMS-fed SERVICES above (12 subs + 4 names = 16 words; subs naturally surface more often).
const SVC_WORDS = SERVICES.flatMap((s) => [s.name, ...(Array.isArray(s.subs) ? s.subs : [])]);

class ServicesController {
  active = -1;
  acc = 0;
  busy = false;

  componentDidMount() {
    const root = this.el();
    if (!root) return;
    const ascHov = root.querySelector('[data-ascii]');
    if (ascHov) {
      ascHov.addEventListener('pointerenter', () => { this._bgHov = true; });
      ascHov.addEventListener('pointerleave', () => { this._bgHov = false; });
    }
    root.querySelectorAll('[data-slot]').forEach((b) => {
      b.addEventListener('click', () => {
        if (this._introOnly) { this.scrollToSection(+b.dataset.i); return; }
        if (this.active < 0) this.go(+b.dataset.i);
      });
      // The hover gesture is the wiping bar (CapabilityBar.astro) plus black text,
      // matching the Work page filters. The tracking no longer widens: it changed
      // the button's width mid-wipe, so the bar grew sideways while it rose.
      //
      // The colour is written HERE and not left to sweep(). sweep only runs on the
      // hero of the scrolling build; in the intro build it never runs at all and the
      // labels are painted with a plain colour, so a sweep-only hover state left
      // cool-white text on the cool-white bar -- invisible. Setting it directly
      // works in every mode, and sweep's __sw === 3 branch still covers the case
      // where it IS running and would otherwise repaint over this next frame.
      //
      // webkitTextFillColor as well as color: in gradient mode the fill is
      // transparent so the clipped background shows through, and colour alone would
      // have nothing to act on.
      b.addEventListener('mouseenter', () => {
        if (this.active >= 0) return;
        b.__hov = true;
        // Snapshot rather than assume a resting value: colour here is owned by
        // setActiveService or sweep depending on mode, and leaving must hand it back
        // exactly as found rather than making this a third writer.
        b.__preHov = {
          color: b.style.color,
          fill: b.style.webkitTextFillColor,
          filter: b.style.filter,
          shadow: b.style.textShadow,
        };
        b.style.color = '#000';
        b.style.webkitTextFillColor = '#000';
        b.style.filter = 'none';   // the halo separates the label from the field; on white it muddies
        b.style.textShadow = 'none';
      });
      b.addEventListener('mouseleave', () => {
        b.__hov = false;
        const pre = b.__preHov;
        if (pre) {
          b.style.color = pre.color;
          b.style.webkitTextFillColor = pre.fill;
          b.style.filter = pre.filter;
          b.style.textShadow = pre.shadow;
          b.__preHov = null;
        }
        // Force sweep, if it is running, to re-run its gradient branch rather than
        // trusting the snapshot to match what it would have painted.
        if (b.__sw === 3) b.__sw = 0;
      });
    });
    // Panel-navigation handlers (clicks into subcategories, inventory rows, drag,
    // wheel, keys). Skipped in intro-only mode — on the scrollable page the intro
    // is just the field + labels, and wheel/drag belong to the page scroll.
    if (!this._introOnly) {
    root.querySelectorAll('[data-other]').forEach((b) => {
      b.addEventListener('click', () => {
        const t = +b.dataset.target;
        this.go(t, this.active >= 0 && t < this.active ? -1 : 1);
      });
      b.addEventListener('mouseenter', () => { b.style.color = 'rgb(217,225,234)'; });
      b.addEventListener('mouseleave', () => {
        b.style.color = +b.dataset.target === this.active ? 'rgb(217,225,234)' : 'rgba(217,225,234,0.45)';
      });
    });
    const invRows = Array.from(root.querySelectorAll('[data-inv-row]'));
    const invImg = root.querySelector('[data-inv-img]');
    const invCopy = root.querySelector('[data-panel][data-i="3"] [data-copy]');
    invRows.forEach((r) => {
      r.addEventListener('click', () => { r.dispatchEvent(new MouseEvent('mouseenter')); });
      r.addEventListener('mouseenter', () => {
        invRows.forEach((x) => { x.style.color = x === r ? 'rgb(217,225,234)' : 'rgba(217,225,234,0.45)'; });
        if (invImg) {
          invImg.style.opacity = '0';
          setTimeout(() => {
            invImg.src = 'https://allofitnow.com/wp-content/uploads/' + r.dataset.img;
            invImg.style.opacity = '1';
          }, 160);
        }
        if (invCopy) {
          if (invCopy.__txt === undefined) invCopy.__txt = invCopy.textContent;
          if (invCopy.__raf) { cancelAnimationFrame(invCopy.__raf); invCopy.__raf = null; }
          invCopy.textContent = r.dataset.tip;
          invCopy.__to = r.dataset.tip;
        }
      });
    });
    const invWrap = root.querySelector('[data-inv]');
    if (invWrap) invWrap.addEventListener('mouseleave', () => {
      if (invCopy && invCopy.__txt !== undefined) {
        if (invCopy.__raf) { cancelAnimationFrame(invCopy.__raf); invCopy.__raf = null; }
        invCopy.textContent = invCopy.__txt;
        invCopy.__to = invCopy.__txt;
      }
    });
    let tx = 0, ty = 0, tid = null;
    const dragEls = () => {
      const pan = root.querySelector('[data-panel][data-i="' + this.active + '"]');
      return pan ? [pan.querySelector('[data-imgs]'), pan.querySelector('[data-copy]')] : [null, null];
    };
    root.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary || e.button > 0) return;
      tid = e.pointerId;
      tx = e.clientX;
      ty = e.clientY;
      this._dragging = false;
      this._dragStrip = !!(e.target && e.target.closest && e.target.closest('[data-inv],[data-navstrip]'));
    });
    root.addEventListener('pointermove', (e) => {
      if (tid !== e.pointerId || this.busy || this.active < 0 || this._dragStrip) return;
      const dx = e.clientX - tx;
      const dy = e.clientY - ty;
      if (!this._dragging && (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy))) return;
      this._dragging = true;
      const [imgs, cp] = dragEls();
      const edge = (dx > 0 && this.active === 0) || (dx < 0 && this.active === 3);
      const d = edge ? dx * 0.32 : dx;
      [imgs, cp].forEach((el) => {
        if (!el) return;
        el.getAnimations().forEach((a) => a.cancel());
        el.style.transition = 'none';
        el.style.transform = 'translateX(' + d + 'px)';
      });
      if (imgs) this.pars(imgs).forEach((p) => {
        p.getAnimations().forEach((a) => a.cancel());
        const cap = this.parCap(p);
        p.style.transition = 'none';
        p.style.transform = 'translateX(' + Math.max(-cap, Math.min(cap, -d * 0.32)) + 'px)';
      });
    });
    const finish = (e) => {
      if (tid !== e.pointerId) return;
      tid = null;
      const wasDrag = this._dragging;
      this._dragging = false;
      if (this._dragStrip) return;
      const dx = e.clientX - tx;
      const dy = e.clientY - ty;
      const thresh = Math.max(56, root.clientWidth * 0.2);
      if (this.active < 0) {
        if (Math.abs(dx) > thresh && Math.abs(dx) > Math.abs(dy)) this.go(0, 1);
        return;
      }
      if (!wasDrag) return;
      const dir = dx < 0 ? 1 : -1;
      const n2 = this.active + dir;
      if (Math.abs(dx) >= thresh) {
        if (dir < 0 && this.active === 0) { this.home(); return; }
        if (n2 >= 0 && n2 <= 3) { this.go(n2, dir); return; }
      }
      const [imgs, cp] = dragEls();
      if (cp) {
        cp.style.transition = 'transform 420ms cubic-bezier(.16,1,.3,1)';
        cp.style.transform = 'translateX(0)';
      }
      if (imgs) {
        imgs.style.transition = 'transform 420ms cubic-bezier(.16,1,.3,1)';
        imgs.style.transform = 'translateX(0)';
      }
      if (imgs) this.pars(imgs).forEach((p) => {
        p.style.transition = 'transform 420ms cubic-bezier(.16,1,.3,1)';
        p.style.transform = 'translateX(0)';
      });
    };
    let sEl = null, sX = 0, sL = 0, sMoved = 0, sId = null;
    root.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary || e.button > 0) return;
      const st = e.target && e.target.closest ? e.target.closest('[data-navstrip],[data-inv]') : null;
      if (!st || st.scrollWidth <= st.clientWidth + 2) return;
      sEl = st;
      sId = e.pointerId;
      sX = e.clientX;
      sL = st.scrollLeft;
      sMoved = 0;
      st.style.cursor = 'grab';
    });
    root.addEventListener('pointermove', (e) => {
      if (!sEl || e.pointerId !== sId) return;
      const dx = e.clientX - sX;
      if (Math.abs(dx) > sMoved) sMoved = Math.abs(dx);
      if (sMoved > 4) {
        sEl.style.cursor = 'grabbing';
        sEl.style.scrollSnapType = 'none';
        sEl.scrollLeft = sL - dx;
        e.preventDefault();
      }
    });
    const endStrip = (e) => {
      if (!sEl || (e && e.pointerId !== sId)) return;
      const st = sEl;
      const moved = sMoved;
      sEl = null;
      sId = null;
      st.style.cursor = '';
      st.style.scrollSnapType = 'x proximity';
      if (moved > 6) {
        const kill = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
        st.addEventListener('click', kill, { capture: true, once: true });
        setTimeout(() => st.removeEventListener('click', kill, { capture: true }), 60);
        if (st.hasAttribute('data-navstrip')) {
          const mid = st.scrollLeft + st.clientWidth / 2;
          let best = null;
          let bd = Infinity;
          Array.from(st.querySelectorAll('[data-other]')).forEach((b) => {
            const c = b.offsetLeft + b.offsetWidth / 2;
            const d = Math.abs(c - mid);
            if (d < bd) { bd = d; best = b; }
          });
          if (best) {
            const t = +best.dataset.target;
            if (t !== this.active) this.go(t, t > this.active ? 1 : -1);
          }
        } else {
          const mid2 = st.scrollLeft + st.clientWidth / 2;
          let best2 = null;
          let bd2 = Infinity;
          Array.from(st.querySelectorAll('[data-inv-row]')).forEach((r) => {
            const c = r.offsetLeft + r.offsetWidth / 2;
            const d = Math.abs(c - mid2);
            if (d < bd2) { bd2 = d; best2 = r; }
          });
          if (best2) best2.dispatchEvent(new MouseEvent('mouseenter'));
        }
      }
    };
    root.addEventListener('pointerup', endStrip);
    root.addEventListener('pointercancel', endStrip);
    root.addEventListener('pointerup', finish);
    root.addEventListener('pointercancel', finish);
    this._wheel = (e) => {
      if (this.active < 0) {
        e.preventDefault();
        if (this.busy) return;
        const dh = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
        this._homeAcc = Math.max(0, (this._homeAcc || 0) + dh);
        if (this._homeAcc > 220) { this._homeAcc = 0; this.go(0, 1); }
        return;
      }
      const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      const invEl = e.target && e.target.closest ? e.target.closest('[data-inv]') : null;
      if (invEl && invEl.scrollHeight - invEl.clientHeight > 2) {
        const atTop = invEl.scrollTop <= 0;
        const atEnd = invEl.scrollTop >= invEl.scrollHeight - invEl.clientHeight - 1;
        if ((d > 0 && !atEnd) || (d < 0 && !atTop)) return;
      }
      e.preventDefault();
      if (this.busy) return;
      clearTimeout(this._snapT);
      this._snapT = setTimeout(() => this.snapImgs(), 220);
      const thresh = 1400;
      const hold = thresh * 0.1;
      this.accT = Math.min(thresh, Math.max(-thresh, (this.accT || 0) + d));
    };
    root.addEventListener('wheel', this._wheel, { passive: false });
    this._key = (e) => {
      if (this.active < 0) return;
      if ((e.key === 'ArrowRight' || e.key === 'ArrowDown') && this.active < 3) this.go(this.active + 1, 1);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { if (this.active === 0) this.home(); else this.go(this.active - 1, -1); }
    };
    window.addEventListener('keydown', this._key);
    } // end !introOnly panel-navigation handlers
    const bar0 = root.querySelector('[data-bar]');
    this._barHome = bar0 ? (bar0.style.top || '52vh') : '52vh';
    const loop = () => {
      if (!this._bsig) { this._bsig = 1; this.layout(); }
      if (this.active === 3 && !this.busy) {
        const p3 = document.querySelector('[data-panel][data-i="3"] [data-bd]');
        if (p3 && p3.style.backgroundColor !== 'rgb(0, 0, 0)') { p3.style.transition = 'none'; p3.style.backgroundColor = 'rgb(0, 0, 0)'; }
      }
      
      if (this.active < 0) { if (!this._fieldAsleep) this.tickAscii(performance.now()); if (this._heroSweep !== false) this.sweep(performance.now()); }
      const thresh = 1400;
      const hold = 0;
      const ease = 0.062;
      const t0 = this.accT || 0;
      if (Math.abs(t0 - this.acc) > 0.4) {
        this.acc += (t0 - this.acc) * ease;
        if (this.active >= 0 && !this.busy) {
          if (this.active === 3) {
            if (this.accT > 0) { this.accT = 0; this.acc = 0; }
            if (this.acc <= -thresh * 0.5) { this.acc = 0; this.accT = 0; this.go(2, -1); }
            this._raf = requestAnimationFrame(loop);
            return;
          }
          if (this.acc >= thresh * 0.92) { this.acc = 0; this.accT = 0; this.go(this.active + 1, 1); }
          else if (this.acc <= -thresh * 0.92) {
            this.acc = 0;
    this.accT = 0; this.accT = 0;
            if (this.active === 0) this.home(); else this.go((this.active + 3) % 4, -1);
          }
          else this.drift(Math.max(-1, Math.min(1, this.acc / thresh)));
        }
      }
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
    this._resize = () => {
      this.layout();
      this.queueAscii();
      this.repaintFieldAfterSettle();
    };
    window.addEventListener('resize', this._resize);
    requestAnimationFrame(() => this.layout());
    setTimeout(() => this.layout(), 600);
    const boot = () => { this.layout(); this.buildAscii(); if (this._introOnly) this.playIntro(); };
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => setTimeout(boot, 60));
    else setTimeout(boot, 400);
    this._tick = setInterval(() => this.clock(), 1000);
    this.clock();
    // Deep-link (panel-switch mode only): /services#<slug> opens that panel.
    // In the scrollable/intro build the effects module handles hash → scroll.
    if (!this._introOnly) {
      const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const hash = (typeof location !== 'undefined' ? location.hash : '').replace(/^#/, '').toLowerCase();
      const autoIdx = hash ? SERVICES.findIndex((s) => slugify(s.name) === hash) : -1;
      if (autoIdx >= 0) setTimeout(() => this.go(autoIdx), 300);
    }
  }

  componentWillUnmount() {
    const root = this.el();
    if (root && this._wheel) root.removeEventListener('wheel', this._wheel);
    window.removeEventListener('keydown', this._key);
    window.removeEventListener('resize', this._resize);
    clearInterval(this._tick);
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._asciiRaf) { cancelAnimationFrame(this._asciiRaf); this._asciiRaf = 0; }
    if (this._settleRaf) { cancelAnimationFrame(this._settleRaf); this._settleRaf = 0; }
  }

  componentDidUpdate() {
    this.layout();
    const sig = String(85) + '|' + String(1.75) + '|' + String(125) + '|' + String(140) + '|' + String(215) + '|' + String(12.5) + '|' + String(FIELD_TOP_BRIGHTNESS);
    if (sig !== this._nsig) { this._nsig = sig; this.buildAscii(); }
  }

  el() { return document.querySelector('[data-root]'); }

  // Intro-only: a capability label click smooth-scrolls to that service's section.
  // The effects module owns Lenis and listens for this event.
  scrollToSection(i) {
    const svc = SERVICES[i];
    if (!svc) return;
    const slug = svc.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    window.dispatchEvent(new CustomEvent('services:scrollto', { detail: { slug } }));
  }

  // Horizontal scroller: scramble the persistent capability bar to reflect the
  // active service. i < 0 = hero (the four service names); i in 0..3 = that
  // service (slot 0 = name, slots 1-3 = its subcategories). Reuses the same
  // slot-target + scramble() path as go()/home(); guarded so scroll updates
  // don't re-scramble unchanged text every frame.
  setActiveService(i) {
    const root = this.el();
    if (!root) return;

    // Title morphs with the section: hero = STUDIO / CAPABILITIES; in a section it
    // scrambles to that category's two words. That lifts the category name OUT of
    // the bar, freeing slot 0 — so the bar now shows FOUR subcategories, not the
    // old name + three.
    const ta = root.querySelector('[data-title-a]');
    const tb = root.querySelector('[data-title-b]');
    let wa = 'STUDIO', wb = 'CAPABILITIES';
    if (i >= 0 && SERVICES[i]) {
      const parts = String(SERVICES[i].name || '').split(' ');
      wa = parts[0] || '';
      wb = parts.slice(1).join(' ');
    }
    this._setTitle(ta, wa);
    this._setTitle(tb, wb);

    const slots = root.querySelectorAll('[data-slot]');
    slots.forEach((s, k) => {
      let target, bright;
      if (i < 0 || i == null) {
        target = SERVICES[k] ? SERVICES[k].name : ''; // hero: the four service names (the picker)
        bright = false;
      } else {
        // In a section every slot is a subcategory (the name now lives in the title).
        target = (SERVICES[i].subs && SERVICES[i].subs[k]) || '';
        bright = true;
      }
      s.style.color = bright ? 'rgb(217,225,234)' : 'rgba(217,225,234,0.45)';
      if (s.__svcTarget === target) return;
      s.__svcTarget = target;
      s.__target = target;
      this.scramble(s, target);
    });

    this._setSubMarquee(i);
  }

  // Mobile: inside a section (i>=0) collapse the four stacked slots into one auto-scrolling
  // marquee line of that service's subs (frees ~70px for the galleries). On the hero (i<0) or
  // desktop it clears the mode so the real slots render. The marquee track holds TWO identical
  // copies so the CSS translateX(-50%) loop is seamless.
  _setSubMarquee(i) {
    const root = this.el();
    if (!root) return;
    const bar = root.querySelector('[data-bar]');
    const mq = root.querySelector('[data-sub-marquee]');
    const track = root.querySelector('[data-sub-track]');
    if (!bar || !mq || !track) return;
    this._lastSvcI = i;
    const subs = i >= 0 && SERVICES[i] && SERVICES[i].subs ? SERVICES[i].subs.filter(Boolean) : [];
    const on = !!this._narrow && subs.length > 0;
    if (bar.hasAttribute('data-mq') !== on) bar.toggleAttribute('data-mq', on);
    if (!on) return;
    const SEP = ' · '; // em-space · em-space
    const line = subs.join(SEP) + SEP;
    if (track.__line === line) return; // guard against per-frame churn
    track.__line = line;
    track.textContent = '';
    for (let c = 0; c < 2; c++) {
      const span = document.createElement('span');
      span.textContent = line;
      track.appendChild(span);
    }
  }

  // Scramble a title half to `to` (STUDIO/CAPABILITIES <-> a category word), guarded
  // so scroll updates don't re-scramble unchanged text. Releases the intro clip —
  // playIntro wraps the title in an inner span but only unwraps the slots.
  _setTitle(el, to) {
    if (!el || el.__svcTarget === to) return;
    el.__svcTarget = to;
    el.__target = to;
    el.style.overflow = 'visible';
    // A touch longer than the bar's 620ms — the big title reads smoother morphing
    // over ~820ms, and it's usually triggered early (on a nav click) so it has room.
    this.scramble(el, to, { dur: 820 });
  }

  // Scroll-driven field dissolve: t=0 (full field) → 1 (fully gone), reversible. Whole
  // horizontal "strings" vanish together (shared per-run thresholds seeded in buildAscii).
  // The alpha write runs in tickAscii (after flicker/hover) so it wins the frame.
  dissolveField(t) {
    const prev = this._dissolveT || 0;
    this._dissolveT = t;
    if (t <= 0.001 && prev > 0.001) this._restoreField();
    this._glDirty = true;
  }
  _applyDissolve() {
    if (!(this._dissolveT > 0.001) || !this._dyn || !this._dissolveThresh) return;
    const th = this._dissolveThresh, dyn = this._dyn, ba = this._baseA, n = this._n, t = this._dissolveT;
    for (let i = 0; i < n; i++) dyn[i * 5 + 1] = th[i] < t ? 0 : ba[i];
  }
  _restoreField() {
    if (!this._dyn) return;
    const dyn = this._dyn, ba = this._baseA, n = this._n;
    for (let i = 0; i < n; i++) dyn[i * 5 + 1] = ba[i];
    this._glDirty = true;
  }

  // On-load intro: STUDIO/CAPABILITIES → the four capability links → the field, overlapping
  // (mirrors the homepage About motion). The text emerges from behind a line — each element is
  // clipped (overflow:hidden) and its inner slides up from translateY(110%). No scramble. Skips
  // (shows everything instantly) on a deep-link hash or reduced-motion, then signals the effects
  // module via `services:introdone` so it can release the scroll lock.
  playIntro() {
    if (this._introPlayed) return;
    this._introPlayed = true;
    const root = this.el();
    if (!root) return;
    const a = root.querySelector('[data-title-a]');
    const b = root.querySelector('[data-title-b]');
    const slots = Array.from(root.querySelectorAll('[data-slot]'));
    const field = root.querySelector('[data-ascii]');
    const EASE = 'cubic-bezier(0.05,0.89,0,0.99)';
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const hash = (typeof location !== 'undefined' ? location.hash : '').replace(/^#/, '').toLowerCase();
    const skip = !!hash && SERVICES.some((s) => slugify(s.name) === hash);
    const done = () => { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('services:introdone')); };
    const show = (el) => { if (el) { el.style.opacity = '1'; el.style.transform = 'none'; el.style.overflow = 'visible'; } };

    if (skip || reduce) { [a, b, ...slots, field].forEach(show); done(); return; }

    // wrap the element's content in an inner span; clip the element; park the inner below the line
    const clip = (el) => {
      const inner = document.createElement('span');
      inner.style.display = 'block';
      inner.style.willChange = 'transform';
      inner.style.transform = 'translateY(110%)';
      while (el.firstChild) inner.appendChild(el.firstChild);
      el.appendChild(inner);
      el.style.overflow = 'hidden';
      el.style.opacity = '1'; // element visible; inner clipped so nothing shows until it rises
      return inner;
    };
    const rise = (el, delay, dur) => {
      if (!el) return;
      const inner = clip(el);
      inner.animate(
        [{ transform: 'translateY(110%)', easing: EASE }, { transform: 'translateY(0)' }],
        { duration: dur, delay, fill: 'both' }
      );
    };
    const lead = 260, stag = 90;
    const SLOT_DUR = 820;
    // Rise at the brightness the sweep is going to hand them, not the 0.45 the
    // markup carries for the section state. sweep() refuses to touch a slot while
    // the clip span is still wrapping its text (background-clip:text cannot map
    // onto a descendant, it renders black), so a slot shows its plain colour
    // until the span goes. Leaving that at 0.45 meant every slot jumped to 0.91
    // the instant it was unwrapped: the labels arrived, sat flat for a moment,
    // and then snapped on.
    const navFill = 'rgba(217,225,234,' + Math.min(1, NAV_BRIGHTNESS / 100) + ')';
    slots.forEach((s) => { s.style.color = navFill; });

    rise(a, lead, 900);
    rise(b, lead + stag, 900);
    slots.forEach((s, i) => rise(s, lead + 2 * stag + i * stag, SLOT_DUR));
    const fieldDelay = lead + 3 * stag + slots.length * stag;
    if (field) field.animate([{ opacity: 0, easing: EASE }, { opacity: 1 }], { duration: 900, delay: fieldDelay, fill: 'both' });

    // Unwrap each slot as ITS OWN rise lands, not all four on one timer 170ms
    // after the last of them. The clip has to go for two reasons -- the sweep
    // needs the text to be a direct child, and hover letter-spacing would be cut
    // off by the overflow -- but doing it in one go handed the shine to all four
    // simultaneously, which is a single hard edge in the middle of an otherwise
    // staggered entrance. Per slot, it inherits the same 90ms rhythm as the rise.
    slots.forEach((s, i) => {
      setTimeout(() => {
        const inner = s.querySelector('span');
        if (inner) s.textContent = inner.textContent;
        s.style.overflow = 'visible';
      }, lead + 2 * stag + i * stag + SLOT_DUR + 40);
    });
    setTimeout(done, fieldDelay + 940);
  }

  clock() {
    const root = this.el();
    const n = root && root.querySelector('[data-clock]');
    if (!n) return;
    const la = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    const p = (v) => String(v).padStart(2, '0');
    n.textContent = p(la.getHours()) + ':' + p(la.getMinutes()) + ':' + p(la.getSeconds()) + ' GMT-7';
  }

  mobileStyles() {
    const root = this.el();
    if (!root) return;
    const narrow = root.clientWidth < 640;
    const compact = narrow || root.clientHeight < 520;
    const mob = narrow;
    this._narrow = narrow;
    this._mob = compact;
    this._compact = compact;
    const M = compact ? 20 : 48;
    const nav = root.querySelector('nav');
    const a = root.querySelector('[data-title-a]');
    const b2 = root.querySelector('[data-title-b]');
    const titleRow = a && a.parentElement;
    const bar = root.querySelector('[data-bar]');
    const stage = root.querySelector('[data-stage]');
    const hint = root.querySelector('[data-hint]');
    [nav, titleRow, bar, stage].forEach((el) => { if (el) { el.style.left = M + 'px'; el.style.right = M + 'px'; } });
    if (hint) { hint.style.left = M + 'px'; hint.style.display = compact ? 'none' : 'block'; }
    if (nav) nav.style.fontSize = compact ? '9px' : '11px';
    if (titleRow) {
      titleRow.style.flexDirection = narrow ? 'column' : 'row';
      titleRow.style.alignItems = narrow ? 'center' : 'baseline';
      titleRow.style.gap = narrow ? '2px' : '0px';
      // Tighten the top padding on phones (desktop keeps the 112px inline default). This also
      // lifts the sub marquee, which sits just under the title (activeTop tracks the title's bottom).
      titleRow.style.top = narrow ? '80px' : '112px';
    }
    if (bar) {
      bar.style.flexDirection = narrow ? 'column' : 'row';
      bar.style.alignItems = narrow ? 'center' : 'center';
      bar.style.gap = narrow ? '7px' : '0px';
    }
    if (a && b2) {
      if (mob) {
        if (!this._t100) {
          const pb = document.createElement('span');
          pb.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font-weight:500;font-size:100px;letter-spacing:-0.01em;font-family:' + getComputedStyle(b2).fontFamily;
          pb.textContent = 'CAPABILITIES';
          root.appendChild(pb);
          this._t100 = pb.getBoundingClientRect().width || 700;
          pb.remove();
        }
        const fs = Math.max(26, Math.min(96, ((root.clientWidth - 2 * M) / this._t100) * 100));
        a.style.fontSize = fs.toFixed(1) + 'px';
        b2.style.fontSize = fs.toFixed(1) + 'px';
      } else {
        const cl = compact ? 'clamp(26px,min(6vw,11vh),132px)' : 'clamp(40px,min(7.6vw,15vh),132px)';
        a.style.fontSize = cl;
        b2.style.fontSize = cl;
      }
    }
    root.querySelectorAll('[data-panel]').forEach((pan) => {
      const bottom = pan.children[1];
      if (bottom) {
        bottom.style.gridTemplateColumns = narrow ? '1fr' : '1fr auto';
        bottom.style.gap = compact ? '14px' : '64px';
        bottom.style.alignItems = narrow ? 'stretch' : 'end';
        const navWrap = bottom.children[1];
        if (navWrap) {
          navWrap.style.width = narrow ? '100%' : 'max-content';
          navWrap.setAttribute('data-navstrip', compact ? '1' : '');
          navWrap.style.position = compact ? 'absolute' : 'static';
          navWrap.style.left = compact ? '0' : 'auto';
          navWrap.style.right = compact ? '0' : 'auto';
          navWrap.style.bottom = compact ? '0' : 'auto';
          navWrap.style.background = compact ? '#000' : 'transparent';
          navWrap.style.flexDirection = compact ? 'row' : 'column';
          navWrap.style.overflowX = compact ? 'auto' : 'visible';
          navWrap.style.gap = compact ? '22px' : '0px';
          navWrap.style.scrollSnapType = compact ? 'x proximity' : 'none';
          navWrap.style.scrollbarWidth = 'none';
          navWrap.style.borderTop = compact ? '1px solid rgba(217,225,234,0.28)' : '0';
          if (compact) navWrap.style.width = '100%';
        }
      }
      const cp = pan.querySelector('[data-copy]');
      if (cp) { cp.style.columns = narrow ? '1' : '2'; cp.style.fontSize = compact ? '13px' : 'clamp(12px,1.6vh,19px)'; }
      pan.style.flexDirection = 'column';
      pan.style.columnGap = '0px';
      pan.style.justifyContent = narrow ? 'center' : 'flex-start';
      pan.style.rowGap = compact ? '20px' : '34px';
      if (compact) {
        const nw = pan.children[1] ? pan.children[1].children[1] : null;
        pan.style.paddingBottom = (nw ? nw.offsetHeight + 18 : 0) + 'px';
      } else {
        pan.style.paddingBottom = '0px';
      }
      pan.querySelectorAll('[data-other]').forEach((r) => {
        r.style.padding = compact ? (narrow ? '15px 0' : '10px 0') : '9px 100px 9px 0';
        r.style.fontSize = narrow ? '17px' : (compact ? '13px' : '15px');
        r.style.textAlign = 'left';
        r.style.textAlignLast = 'auto';
        r.style.width = 'auto';
        r.style.flex = compact ? '0 0 auto' : '';
        r.style.whiteSpace = compact ? 'nowrap' : 'normal';
        r.style.borderTop = compact ? '0' : '1px solid rgba(217,225,234,0.28)';
        r.style.borderBottom = compact ? '0' : r.style.borderBottom;
        r.style.scrollSnapAlign = compact ? 'center' : 'none';
      });
      const imgs = pan.querySelector('[data-imgs]');
      const inv = pan.querySelector('[data-inv]');
      if (imgs && inv) {
        imgs.style.flexDirection = narrow ? 'column' : 'row';
        imgs.style.gap = compact ? '14px' : '20px';
        inv.style.flex = narrow ? '0 0 auto' : '0 0 32%';
        inv.style.width = narrow ? '100%' : '';
      }
    });
    // Re-evaluate the in-section sub marquee for the new width (desktop <-> mobile resize).
    this._setSubMarquee(this._lastSvcI != null ? this._lastSvcI : -1);
  }

  fitSlots() {
    const root = this.el();
    const bar = root && root.querySelector('[data-bar]');
    if (!bar) return;
    const slots = Array.from(bar.querySelectorAll('[data-slot]'));
    if (!slots.length) return;
    if (this._narrow) {
      const availM = bar.clientWidth;
      const probeM = document.createElement('span');
      probeM.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font-weight:300;font-family:' + getComputedStyle(slots[0]).fontFamily;
      bar.appendChild(probeM);
      let fsM = 17;
      let lsM = 0.14;
      const all = [];
      SERVICES.forEach((x) => { all.push(x.name); x.subs.forEach((y) => all.push(y)); });
      // Same one-shot measurement as the desktop path below: this loop ran 80
      // rounds over all 16 labels, which is 1280 layout reads on a phone that
      // has just been rotated.
      const REF_M = 100;
      probeM.style.fontSize = REF_M + 'px';
      probeM.style.letterSpacing = '0em';
      const metricsM = all.map((t) => ({
        w0: (probeM.textContent = t, probeM.getBoundingClientRect().width),
        n: t.length,
      }));
      probeM.remove();
      const widestM = () => {
        let w = 0;
        metricsM.forEach((m) => { w = Math.max(w, (m.w0 * fsM) / REF_M + m.n * lsM * fsM); });
        return w;
      };
      for (let k = 0; k < 80 && widestM() > availM && fsM > 11; k++) {
        if (lsM > 0.04) lsM = Math.max(0.04, lsM - 0.02); else fsM -= 0.5;
      }
      this._fittedFs = fsM;
      bar.style.fontSize = fsM + 'px';
      slots.forEach((sl) => {
        sl.__lsWide = lsM;
        sl.__lsTight = 0;
        sl.style.transformOrigin = 'center center';
        sl.style.transition = 'letter-spacing 340ms cubic-bezier(.16,1,.3,1), background-color 260ms ease';
        sl.style.letterSpacing = (sl.__hov ? lsM : 0) + 'em';
        sl.style.fontSize = 'inherit';
        sl.style.display = 'block';
        sl.style.width = '100%';
        sl.style.textAlign = 'center';
      });
      return;
    }
    // Each slot must fit its hero label (service k's name) AND every in-section
    // label it can show (subcategory k across all services), so the bar never
    // reflows between the hero picker and a section's four subs.
    const cands = slots.map((s, k) => {
      const list = [];
      if (SERVICES[k] && SERVICES[k].name) list.push(SERVICES[k].name);
      SERVICES.forEach((x) => { const v = x.subs && x.subs[k]; if (v) list.push(v); });
      return list.length ? list : [''];
    });
    let fs = 22.5;
    let ls = (22) / 100;
    const lsFloor = 0.08;
    const fit = true;
    const avail = bar.clientWidth - 3 * 18;
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font-family:' + getComputedStyle(slots[0]).fontFamily + ';font-weight:300';
    bar.appendChild(probe);
    // Measure every candidate ONCE, at a reference size with no tracking, and
    // model the rest. Width is exactly linear in both: glyph advances scale
    // with font-size, and letter-spacing adds ls*fs per character (CSS puts it
    // after the last one too, which is what the -1em margin downstream undoes).
    // Checked against live measurement over three sizes and two trackings --
    // largest error 0.008px.
    //
    // Worth doing because the search below runs up to 160 rounds and each one
    // used to read layout for every candidate. layout() calls this on every
    // resize event, so dragging a window edge was spending ~5ms per event here
    // -- a third of a frame before the browser does any work of its own.
    const REF = 100;
    probe.style.fontSize = REF + 'px';
    probe.style.letterSpacing = '0em';
    const metrics = cands.map((list) => list.map((t) => ({
      w0: (probe.textContent = t, probe.getBoundingClientRect().width),
      n: t.length,
    })));
    probe.remove();
    const widest = () => metrics.map((list) => {
      let w = 0;
      list.forEach((m) => { w = Math.max(w, (m.w0 * fs) / REF + m.n * ls * fs); });
      return w;
    });
    let ws = widest();
    let sum = ws.reduce((a, b) => a + b, 0);
    if (sum > avail) {
      // Shrink against `cands` — the widest label each slot can EVER show — not
      // against the labels it happens to be showing right now. Fitting the
      // current text is what made the bar overlap itself: the widths below are
      // written as fixed px, the labels are nowrap, and scrolling into the next
      // section scrambles in a longer sub than the one that was measured, which
      // then runs straight into its neighbour. Which viewports it happened on
      // depended on which pair of services you crossed between, which is why it
      // read as intermittent. `cands` is already built for exactly this, and the
      // comment above it already claimed this guarantee.
      for (let k = 0; k < 160 && sum > avail && (ls > lsFloor || fs > 8); k++) {
        if (ls > lsFloor) ls = Math.max(lsFloor, ls - 0.02);
        else fs -= 0.5;
        ws = widest();
        sum = ws.reduce((a, b) => a + b, 0);
      }
      if (sum > avail) {
        const k2 = avail / sum;
        ws = ws.map((w) => w * k2);
      }
    }
    this._fittedFs = fs;
    const barEl = bar;
    barEl.style.fontSize = fs + 'px';
    slots.forEach((s, i) => {
      s.style.fontSize = 'inherit';
      s.__lsWide = ls;
      s.__lsTight = 0;
      s.style.transformOrigin = 'center center';
      s.style.transition = 'letter-spacing 340ms cubic-bezier(.16,1,.3,1), transform 340ms cubic-bezier(.16,1,.3,1), background-color 260ms ease';
      s.style.letterSpacing = (s.__hov ? ls : s.__lsTight) + 'em';
      s.style.display = 'inline-block';
      s.style.textAlign = i === 0 ? 'left' : (i === slots.length - 1 ? 'right' : 'center');
      s.style.width = Math.ceil(ws[i] + 2) + 'px';
    });
  }

  layout() {
    const root = this.el();
    const stage = root && root.querySelector('[data-stage]');
    if (!stage) return;
    const bar = root.querySelector('[data-bar]');
    const titleA = root.querySelector('[data-title-a]');
    const titleRow = titleA && titleA.parentElement;
    this.mobileStyles();
    if (bar && titleRow) {
      const rb = root.getBoundingClientRect().top;
      const tb = titleRow.getBoundingClientRect().bottom - rb;
      this.fitSlots();
      const asciiBox = root.querySelector('[data-ascii]');
      if (asciiBox) {
        const t = Math.round(tb + (this._compact ? 14 : 24));
        if (asciiBox.style.top !== t + 'px') asciiBox.style.top = t + 'px';
        // queueAscii compares the box's measured size, so this covers a width
        // change too. The old trigger fired only when `top` moved, which a
        // width-only drag never does -- so the grid stayed as it was and the
        // canvas's width:100% stretched it across the new width.
        this.queueAscii();
      }
      const gapV = this._compact ? 16 : 44;
      const activeTop = Math.round(tb + gapV);
      // In intro-only mode the horizontal-scroll engine owns the bar's vertical position
      // (52vh on the hero, risen under the title on a service) — don't clobber it here.
      if (!this._introOnly) bar.style.top = this.active >= 0 ? activeTop + 'px' : '52vh';
      stage.style.top = Math.round(activeTop + bar.offsetHeight + gapV) + 'px';
    }
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    const byWidth = this._mob ? sw * 9 / 16 : ((sw - 20) / 2) * 9 / 16;
    root.querySelectorAll('[data-panel]').forEach((pan) => {
      const imgs = pan.querySelector('[data-imgs]');
      const bottom = pan.children[1];
      if (!imgs) return;
      const gap = parseFloat(getComputedStyle(pan).rowGap) || 20;
      if (bottom) bottom.style.flex = '0 0 auto';
      imgs.style.height = '0px';
      const cp0 = pan.querySelector('[data-copy]');
      if (cp0) { cp0.style.height = 'auto'; cp0.style.columnFill = 'balance'; }
      const bh = bottom ? bottom.offsetHeight : 0;
      const shift = this._mob ? 0 : Math.max(0, 100);
      const avail = Math.max(0, sh - bh - gap - shift);
      let h = Math.max(90, Math.min(avail, byWidth));
      const inv = pan.querySelector('[data-inv]');
      if (inv && this._mob) {
        const navW2 = bottom ? bottom.children[1] : null;
        const rowsN2 = navW2 ? Array.from(navW2.querySelectorAll('[data-other]')) : [];
        rowsN2.forEach((r) => { r.style.padding = this._narrow ? '15px 0' : '10px 0'; r.style.fontSize = this._narrow ? '17px' : '13px'; });
        const navH2 = navW2 ? navW2.offsetHeight : 0;
        const plate = Array.from(imgs.children).find((c) => !c.hasAttribute('data-inv'));
        if (plate) {
          plate.style.display = 'flex';
          plate.style.flex = '1 1 0%';
          plate.style.minHeight = '0';
          plate.style.height = '100%';
          plate.style.alignItems = 'center';
          Array.from(plate.querySelectorAll('img')).forEach((im) => { im.style.maxHeight = '100%'; im.style.height = 'auto'; });
        }
        const rowsI = Array.from(inv.querySelectorAll('[data-inv-row]'));
        rowsI.forEach((r) => { r.style.fontSize = '12.5px'; r.style.lineHeight = '16px'; r.style.padding = '4px 0'; });
        const inner2 = parseFloat(getComputedStyle(bottom).rowGap) || 18;
        const cpM = pan.querySelector('[data-copy]');
        let cpH = 0;
        if (cpM) {
          cpM.style.columnFill = 'balance';
          cpM.style.height = 'auto';
          cpM.style.overflow = 'hidden';
          let fsc2 = 12.5;
          cpM.style.fontSize = fsc2 + 'px';
          const budget2 = Math.max(48, sh * 0.3);
          while (fsc2 > 10.5 && cpM.scrollHeight > budget2) { fsc2 -= 0.5; cpM.style.fontSize = fsc2 + 'px'; }
          cpH = Math.floor(Math.min(budget2, cpM.scrollHeight));
          cpM.style.height = cpH + 'px';
        }
        if (this._compact) {
          plate.style.display = 'flex';
          plate.style.order = '0';
          plate.style.flex = '1 1 auto';
          plate.style.minHeight = '0';
          plate.style.height = 'auto';
          plate.style.alignItems = 'center';
          plate.style.justifyContent = 'center';
          Array.from(plate.querySelectorAll('img')).forEach((im) => { im.style.maxHeight = '100%'; im.style.maxWidth = '100%'; im.style.height = 'auto'; });
          if (inv.parentElement !== pan) { inv.__home = imgs; pan.appendChild(inv); }
          inv.style.order = '1';
          inv.style.flex = '0 0 auto';
          inv.style.flexDirection = 'row';
          inv.style.overflowX = 'auto';
          inv.style.overflowY = 'hidden';
          inv.style.gap = '20px';
          inv.style.height = 'auto';
          inv.style.justifyContent = 'flex-start';
          inv.style.scrollSnapType = 'x proximity';
          inv.style.borderTop = '1px solid rgba(217,225,234,0.28)';
          inv.style.position = 'absolute';
          inv.style.left = '0';
          inv.style.right = '0';
          inv.style.bottom = (navH2 + 16) + 'px';
          inv.style.background = '#000';
          rowsI.forEach((r) => {
            r.style.fontSize = '13px';
            r.style.lineHeight = '17px';
            r.style.padding = '11px 0';
            r.style.flex = '0 0 auto';
            r.style.whiteSpace = 'nowrap';
            r.style.borderTop = '0';
            r.style.scrollSnapAlign = 'center';
          });
          const invH = inv.offsetHeight;
          const padR = navH2 + 18 + invH + 16;
          pan.style.paddingBottom = padR + 'px';
          const shcR = sh - padR;
          let budgetR;
          if (this._narrow) {
            pan.style.flexDirection = 'column';
            imgs.style.width = '';
            imgs.style.minWidth = '';
            bottom.style.flex = '';
            bottom.style.minWidth = '';
            budgetR = Math.max(40, shcR - cpH - gap);
          } else {
            pan.style.flexDirection = 'row';
            pan.style.alignItems = 'stretch';
            pan.style.columnGap = '24px';
            bottom.style.order = '0';
            bottom.style.flex = '1 1 54%';
            bottom.style.minWidth = '0';
            imgs.style.minWidth = '0';
            bottom.style.alignSelf = 'stretch';
            imgs.style.order = '1';
            Array.from(plate.querySelectorAll('img')).forEach((im) => { im.style.maxWidth = '100%'; });
            imgs.style.flexDirection = 'column';
            budgetR = Math.max(40, shcR);
          }
          imgs.style.marginTop = '0px';
          imgs.style.marginBottom = '0px';
          imgs.style.minHeight = '0';
          imgs.style.height = Math.floor(budgetR) + 'px';
          if (this._narrow) {
            imgs.style.flex = '0 0 auto';
          } else {
            imgs.style.flex = '1 1 46%';
            imgs.style.width = 'auto';
            plate.style.height = '100%';
          }
          if (+pan.dataset.i !== this.active && +pan.dataset.i !== this._prev) this.rest(imgs);
          return;
        }
        const listRoom = Math.max(80, sh - cpH - navH2 - gap - inner2);
        const rowH2 = rowsI[0] ? rowsI[0].getBoundingClientRect().height : 24;
        const fitRows = Math.max(2, Math.floor(listRoom / rowH2));
        inv.style.justifyContent = 'flex-start';
        inv.style.overflowY = fitRows < rowsI.length ? 'auto' : 'hidden';
        inv.style.height = Math.floor(Math.min(listRoom, fitRows * rowH2)) + 'px';
        imgs.style.marginTop = '0px';
        imgs.style.marginBottom = '0px';
        imgs.style.flex = '0 0 auto';
        imgs.style.minHeight = '0';
        imgs.style.height = Math.floor(parseFloat(inv.style.height) || inv.offsetHeight) + 'px';
        if (+pan.dataset.i !== this.active && +pan.dataset.i !== this._prev) this.rest(imgs);
        return;
      }
      if (inv) {
        if (inv.__home && inv.parentElement !== inv.__home) { inv.__home.insertBefore(inv, inv.__home.firstChild); inv.style.position = 'static'; }
        inv.style.overflow = 'hidden';
        inv.style.justifyContent = 'flex-start';
        const rows = Array.from(inv.querySelectorAll('[data-inv-row]'));
        const room = Math.max(0, sh - bh - gap);
        const minRow = 20;
        const idealRow = 36;
        const minNeed = rows.length * minRow;
        h = Math.min(room, rows.length * idealRow);
        if (h < minNeed) h = Math.min(room, minNeed);
        const tight = h < minNeed - 0.5;
        const rowH = tight ? minRow : h / rows.length;
        const fsr = Math.max(11, Math.min(15, (rowH - 19) / 1.2));
        const line = Math.max(12, Math.round(fsr * 1.2));
        const pv = Math.max(1, (rowH - line - 1) / 2);
        const drop = Math.max(0, (room - h) / 2);
        inv.style.overflowY = tight ? 'auto' : 'hidden';
        inv.style.scrollbarWidth = 'none';
        inv.style.msOverflowStyle = 'none';
        if (tight) h = Math.max(rowH, Math.floor(h / rowH) * rowH);
        inv.style.marginTop = '0px';
        inv.style.height = Math.floor(h) + 'px';
        inv.style.flex = '0 0 32%';
        rows.forEach((r) => {
          r.style.fontSize = fsr.toFixed(1) + 'px';
          r.style.lineHeight = line + 'px';
          r.style.padding = pv.toFixed(1) + 'px 0';
        });
        const realRow = rows[0] ? rows[0].getBoundingClientRect().height : rowH;
        if (realRow > 0) {
          const cap = Math.min(h, room);
          const fits = Math.max(1, Math.floor((cap + 0.5) / realRow));
          h = Math.min(cap, fits * realRow);
          inv.style.height = h.toFixed(2) + 'px';
          inv.style.overflowY = inv.scrollHeight > inv.clientHeight + 1 ? 'auto' : 'hidden';
        }
        imgs.style.marginTop = Math.floor(drop) + 'px';
        imgs.style.marginBottom = Math.max(0, Math.floor(drop - gap)) + 'px';
        imgs.style.flex = '0 0 auto';
        imgs.style.minHeight = '0';
        imgs.style.height = Math.floor(h) + 'px';
        if (+pan.dataset.i !== this.active && +pan.dataset.i !== this._prev) this.rest(imgs);
        const cpR = pan.querySelector('[data-copy]');
        if (cpR) { cpR.style.columnFill = 'auto'; cpR.style.height = Math.ceil(bh) + 'px'; }
        return;
      }
      const cp = pan.querySelector('[data-copy]');
      if (this._mob) {
        const navW = bottom ? bottom.children[1] : null;
        const rowsN = navW ? Array.from(navW.querySelectorAll('[data-other]')) : [];
        rowsN.forEach((r) => { r.style.padding = this._narrow ? '15px 0' : '10px 0'; r.style.fontSize = this._narrow ? '17px' : '13px'; });
        const navH = navW ? navW.offsetHeight : 0;
        const inner = parseFloat(getComputedStyle(bottom).rowGap) || 14;
        const shc = sh - (parseFloat(getComputedStyle(pan).paddingBottom) || 0);
        let cpH = 0;
        if (cp) {
          cp.style.columnFill = 'balance';
          cp.style.overflow = 'hidden';
          cp.style.height = 'auto';
          let fsc = 13;
          cp.style.fontSize = fsc + 'px';
          const roomC = Math.max(36, shc - gap - 70);
          while (fsc > 10.5 && cp.scrollHeight > roomC) { fsc -= 0.5; cp.style.fontSize = fsc + 'px'; }
          cpH = Math.min(cp.scrollHeight, roomC);
          cp.style.height = Math.ceil(cpH) + 'px';
        }
        h = Math.max(40, Math.min(byWidth, shc - cpH - gap));
        const sqsM = Array.from(imgs.querySelectorAll('[data-sq]'));
        if (sqsM.length) {
          if (!imgs.__base) imgs.__base = sqsM.map((q) => q.outerHTML);
          const sizeM = Math.floor(Math.min(sw, h * 16 / 9));
          const wantM = Math.max(imgs.__base.length, Math.ceil((window.innerWidth + 2 * sizeM + 40) / (sizeM + 20)));
          if (imgs.__count !== wantM) {
            imgs.__count = wantM;
            let html = '';
            for (let k = 0; k < wantM; k++) html += imgs.__base[k % imgs.__base.length];
            imgs.innerHTML = html;
          }
          Array.from(imgs.querySelectorAll('[data-sq]')).forEach((q) => { q.style.flex = '0 0 ' + sizeM + 'px'; });
        }
        imgs.style.marginTop = '0px';
        imgs.style.marginBottom = '0px';
        imgs.style.flex = '0 0 auto';
        imgs.style.minHeight = '0';
        imgs.style.height = Math.floor(h) + 'px';
        if (+pan.dataset.i !== this.active && +pan.dataset.i !== this._prev) this.rest(imgs);
        else this.boxes(imgs).forEach((x) => { x.style.transformOrigin = 'center center'; x.style.willChange = 'transform'; });
        return;
      }
      if (cp) { cp.style.columnFill = 'auto'; cp.style.height = Math.ceil(bh) + 'px'; }
      const sqs = Array.from(imgs.querySelectorAll('[data-sq]'));
      if (sqs.length) {
        if (!imgs.__base) imgs.__base = sqs.map((q) => q.outerHTML);
        const size = Math.floor(this._mob ? Math.min(sw, h * 16 / 9) : Math.min((sw - 20) / 2, h * 16 / 9));
        const vw2 = window.innerWidth;
        const want = Math.max(imgs.__base.length, Math.ceil((vw2 + 2 * size + 40) / (size + 20)));
        if (imgs.__count !== want) {
          imgs.__count = want;
          let html = '';
          for (let k = 0; k < want; k++) html += imgs.__base[k % imgs.__base.length];
          imgs.innerHTML = html;
        }
        Array.from(imgs.querySelectorAll('[data-sq]')).forEach((q) => { q.style.flex = '0 0 ' + size + 'px'; });
      }
      imgs.style.marginBottom = '0px';
      imgs.style.marginTop = Math.max(-40, Math.min(shift, Math.max(0, sh - bh - gap - h))) + 'px';
      imgs.style.flex = '0 0 auto';
      imgs.style.minHeight = '0';
      imgs.style.height = Math.floor(h) + 'px';
      if (+pan.dataset.i !== this.active && +pan.dataset.i !== this._prev) this.rest(imgs);
      else this.boxes(imgs).forEach((x) => { x.style.transformOrigin = 'center center'; x.style.willChange = 'transform'; });
    });
  }

  live() { return document.timeline.currentTime > 0; }

  anim(el, frames, opts) {
    if (!el) return null;
    if (!this.live()) {
      const last = frames[frames.length - 1];
      Object.keys(last).forEach((k) => { if (k !== 'offset' && k !== 'easing') el.style[k] = last[k]; });
      return null;
    }
    return el.animate(frames, opts);
  }

  boxes(imgs) { return imgs ? Array.from(imgs.children) : []; }

  pars(imgs) { return imgs ? Array.from(imgs.querySelectorAll('[data-par]')) : []; }

  parCap(p) {
    const sq = p.parentElement;
    if (!sq) return 0;
    return Math.max(0, ((p.offsetWidth - sq.clientWidth) / 2) * 0.8);
  }

  rest(imgs) {
    if (!imgs) return;
    imgs.getAnimations().forEach((a) => a.cancel());
    imgs.style.transition = 'none';
    imgs.style.transform = 'translateX(0)';
    this.boxes(imgs).forEach((x) => { x.getAnimations().forEach((a) => a.cancel()); x.style.transition = 'none'; x.style.transform = 'none'; });
    this.pars(imgs).forEach((p) => { p.getAnimations().forEach((a) => a.cancel()); p.style.transition = 'none'; p.style.transform = 'translateX(0)'; });
  }

  snapImgs() {
    const imgs = this.el() && this.el().querySelector('[data-panel][data-i="' + this.active + '"] [data-imgs]');
    if (!imgs || this.busy) return;
    const b = this.boxes(imgs)[0];
    if (!b) return;
    const pitch = b.offsetWidth + (parseFloat(getComputedStyle(imgs).columnGap) || 20);
    if (pitch < 20) return;
    const cur = new DOMMatrixReadOnly(getComputedStyle(imgs).transform).e;
    const target = Math.round(cur / pitch) * pitch;
    if (Math.abs(target - cur) < 0.5) return;
    this.accT = 0;
    this.acc = 0;
    const frames = [{ transform: 'translateX(' + cur + 'px)' }, { transform: 'translateX(' + target + 'px)' }];
    imgs.getAnimations().forEach((a) => a.cancel());
    if (this.live()) {
      imgs.animate(frames, { duration: 420, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards' });
    } else {
      imgs.style.transform = 'translateX(' + target + 'px)';
    }
    this.pars(imgs).forEach((p) => {
      const cap = this.parCap(p);
      const want = Math.max(-cap, Math.min(cap, -target * 0.32));
      p.getAnimations().forEach((a) => a.cancel());
      if (this.live()) p.animate([{ transform: getComputedStyle(p).transform }, { transform: 'translateX(' + want + 'px)' }], { duration: 420, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards' });
      else p.style.transform = 'translateX(' + want + 'px)';
    });
  }

  drift(t) {
    if (this.busy) return;
    const imgs = this.el() && this.el().querySelector('[data-panel][data-i="' + this.active + '"] [data-imgs]');
    if (!imgs) return;
    const b = this.boxes(imgs);
    if (!b[0]) return;
    imgs.getAnimations().forEach((a) => a.cancel());
    const slot = (b[0].offsetWidth + 20) * ((75) / 100);
    const shift = -slot * t;
    imgs.style.transition = 'none';
    imgs.style.transform = 'translateX(' + shift + 'px)';
    this.pars(imgs).forEach((p) => {
      p.getAnimations().forEach((a) => a.cancel());
      p.style.transition = 'none';
      const cap = this.parCap(p);
      p.style.transform = 'translateX(' + Math.max(-cap, Math.min(cap, -shift * 0.32)) + 'px)';
    });
  }

  scramble(el, to, opt) {
    if (!el) return;
    const o = opt || {};
    const pool = o.glyphs || GLYPHS;
    const dur = o.dur || (620);
    const from = el.__to !== undefined ? el.__to : el.textContent;
    el.__to = to;
    const len = Math.max(from.length, to.length);
    if (el.__raf) cancelAnimationFrame(el.__raf);
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / dur);
      let out = '';
      for (let i = 0; i < len; i++) {
        const reveal = (i / Math.max(1, len)) * 0.68;
        const ch = to[i];
        if (p >= 1 || p > reveal + 0.32) out += ch === undefined ? '' : ch;
        else if (ch === ' ' || (ch === undefined && from[i] === ' ')) out += ' ';
        else out += pool[(Math.random() * pool.length) | 0];
      }
      el.textContent = out;
      if (p < 1) el.__raf = requestAnimationFrame(step);
      else { el.textContent = to; el.__raf = null; }
    };
    el.__raf = requestAnimationFrame(step);
  }

  sweep(now) {
    const root = this.el();
    if (!root) return;
    const slots = root.querySelectorAll('[data-slot]');
    const vw = window.innerWidth;
    const band = Math.round(vw * 1.1);
    const period = Math.max(200, 2500 / ((SWEEP_SPEED) / 100));
    const x = ((now % period) / period) * band;
    const nb = (NAV_BRIGHTNESS) / 100;
    const base = Math.min(1, this._bgHov ? nb + 0.18 : nb);
    slots.forEach((b) => {
      // While the intro clip still wraps a slot's text in an inner <span>, background-clip:text
      // can't map onto the descendant glyphs — the text renders black. Leave those alone; they
      // keep their plain inline color until playIntro() unwraps them, then the shine takes over.
      if (b.firstElementChild) return;
      const r = b.getBoundingClientRect();
      // Hovered label: drop the shine entirely and burn it in at full strength.
      // The sweep is a DARKENING mask (see below), so a label caught under the
      // band was being read through a hole in itself — the one moment you most
      // want it legible is the moment you are pointing at it.
      if (b.__hov) {
        if (b.__sw !== 2) {
          b.__sw = 2;
          b.__bg = null;
          b.style.backgroundImage = 'none';
          b.style.backgroundColor = 'transparent';
          b.style.backgroundClip = '';
          b.style.webkitBackgroundClip = '';
          b.style.webkitTextFillColor = '';
          b.style.color = 'rgb(217,225,234)';
          b.style.textShadow = '0 0 18px rgba(217,225,234,0.45)';
        }
        return;
      }
      // Hovered: drop the gradient so a plain colour can take effect. In gradient
      // mode the glyph colour IS background-color clipped to the text, so setting
      // `color` alone does nothing and sweep would repaint it next frame anyway.
      // The drop-shadow halo goes too -- it exists to separate the label from the
      // field, and over the white bar it just muddies black type.
      if (b.__hov) {
        if (b.__sw !== 3) {
          b.__sw = 3;
          b.__bg = null;
          b.style.backgroundImage = 'none';
          b.style.backgroundColor = 'transparent';
          b.style.backgroundClip = '';
          b.style.webkitBackgroundClip = '';
          b.style.webkitTextFillColor = '';
          b.style.textShadow = 'none';
          b.style.filter = 'none';
          b.style.color = '#000';
        }
        return;
      }
      if (b.__sw !== 1) {
        b.__sw = 1;
        b.style.textShadow = 'none';
        b.style.filter = 'drop-shadow(var(--cap-sep))'; // restored after a hover
        // The shine is a black gradient clipped to the glyphs, so every stop is
        // subtracting light. At 0.88 the leading band took the label down to
        // 0.03 effective alpha — it read as a word blinking out rather than as
        // a sheen crossing it, and on the four hero labels that is most of the
        // time. Halved peaks, and the bands narrowed from ~24% of the sweep to
        // ~14%, so the dark passes over a label instead of sitting on it.
        b.style.backgroundImage = 'linear-gradient(90deg,' +
          ' rgba(0,0,0,0) 0%,' +
          ' rgba(0,0,0,0.40) 12%,' +
          ' rgba(0,0,0,0) 26%,' +
          ' rgba(0,0,0,0.22) 58%,' +
          ' rgba(0,0,0,0) 72%,' +
          ' rgba(0,0,0,0) 100%)';
        b.style.backgroundRepeat = 'repeat-x';
        b.style.backgroundClip = 'text';
        b.style.webkitBackgroundClip = 'text';
        b.style.color = 'transparent';
        b.style.webkitTextFillColor = 'transparent';
      }
      const want = 'rgba(217,225,234,' + base + ')';
      if (b.__bg !== want) { b.__bg = want; b.style.backgroundColor = want; }
      b.style.backgroundSize = band + 'px 100%';
      b.style.backgroundPosition = Math.round(x - r.left) + 'px 0';
    });
  }

  sweepOff() {
    const root = this.el();
    if (!root) return;
    root.querySelectorAll('[data-slot]').forEach((b) => {
      b.__sw = 0;
      b.__hov = false;
      b.__bg = null;
      b.style.backgroundImage = 'none';
      b.style.backgroundColor = 'transparent';
      // NOT `color` — leave it exactly as it was found. setActiveService() sets
      // the resting colours and THEN the hero->section boundary calls
      // setBarInteractive(false), which lands here: clearing colour at this
      // point deletes the inline declaration that was just written, and the
      // slots fall back to an inherited black. Returning to the hero repaints
      // via sweep() (which owns colour in gradient mode), and the hover burn-in
      // is overwritten by setActiveService on the way into a section, so there
      // is nothing here that needs resetting.
      b.style.textShadow = 'none';
      b.style.backgroundClip = '';
      b.style.webkitBackgroundClip = '';
      b.style.webkitTextFillColor = '';
    });
  }

  // Capability bar mode. Hero (on=true): the animated shine runs and the links are clickable
  // (jump into a section). Section (on=false): the shine stops and the text renders solid — no
  // gradient — and the bar is pointer-events:none so only the global nav + bottom-right nav
  // remain interactive. The effects module flips this at the hero↔section boundary.
  setBarInteractive(on) {
    const root = this.el();
    if (!root) return;
    const bar = root.querySelector('[data-bar]');
    if (on) {
      this._heroSweep = true;
      if (bar) bar.style.pointerEvents = '';
    } else {
      this._heroSweep = false;
      this.sweepOff(); // drop the gradient fill so the slots show their solid color
      if (bar) bar.style.pointerEvents = 'none';
    }
  }

  // Sleep/wake the WebGL field. Once a section fully covers it (dissolve complete) the effects module
  // sleeps it, so tickAscii/drawAscii stop — no ~18/s GPU upload+draw while it's invisible. Waking
  // re-arms the dirty flag so it repaints immediately. Sleep/wake are bracketed around the 0.9s dissolve
  // (setDissolve in services-effects.js), so the dissolve itself always runs at full framerate.
  setFieldAsleep(v) {
    this._fieldAsleep = !!v;
    if (!v) this._glDirty = true;
  }

  // Rebuild the field when its box changes size, and only then. The grid
  // (columns, rows, the per-cell arrays, the holes cut for the capability
  // labels) is derived from the box, so it cannot follow the box without one.
  //
  // One rebuild per frame, so the field follows the window instead of catching
  // up after it. That is only safe because of the two things above: the cells
  // are keyed on a hash of their position, so a rebuilt grid keeps the content
  // it already had and consecutive rebuilds are not independent fields; and
  // buildAscii draws before it returns, so it never leaves the buffer it just
  // cleared empty for a frame. Without either, per-frame rebuilding is static
  // and a blackout respectively -- it was both, in that order.
  //
  // Cancel-and-reschedule, NOT "skip if one is pending". Treating the handle as
  // a boolean means a single frame callback that never runs -- a cancel on
  // teardown, or a frame dropped while the tab is hidden -- leaves it non-zero
  // forever and every later call returns early, so the field stops rebuilding
  // for the life of the page. Rescheduling cannot wedge: a stale handle is just
  // cancelled. Resize events do not outpace frames, so this still coalesces to
  // one rebuild per frame.
  queueAscii() {
    if (this._asciiRaf) cancelAnimationFrame(this._asciiRaf);
    this._asciiRaf = requestAnimationFrame(() => {
      this._asciiRaf = 0;
      const root = this.el();
      const box = root && root.querySelector('[data-ascii]');
      if (!box) return;
      const w = box.clientWidth;
      const h = box.clientHeight;
      if (w === this._asciiW && h === this._asciiH) return;
      this._asciiW = w;
      this._asciiH = h;
      this.buildAscii();
    });
  }

  /*
   * Redraw the field across a resize's settle.
   *
   * drawAscii() places the four per-word luminance pools from the labels' LIVE
   * rects, so it already has everything it needs -- but it only runs when
   * tickAscii sees _glDirty, and a resize never sets that. The one draw a resize
   * does get is buildAscii's, on the next frame, which lands in the middle of the
   * move: fitSlots transitions letter-spacing for 340ms and the bar is still
   * redistributing. So the pools were placed where the labels had just been and
   * then nothing redrew them, leaving the four names sitting on unlit field until
   * something else dirtied the buffer -- moving the cursor over it, or a reload.
   * That is why a refresh always looked right and a resize never did.
   *
   * Redrawing across the whole settle rather than betting on one frame is the same
   * approach the project page takes for its title fit, and for the same reason: the
   * cascade is longer than any single measurement.
   */
  repaintFieldAfterSettle(ms) {
    if (this._settleRaf) { cancelAnimationFrame(this._settleRaf); this._settleRaf = 0; }
    const end = performance.now() + (ms || 520); // 340ms letter-spacing + the bar's own reflow
    const step = () => {
      // Mark the buffer dirty and let tickAscii do the drawing. Calling drawAscii
      // straight from here skips _applyDissolve(), which tickAscii deliberately runs
      // FIRST -- so the field gets painted at full strength even when it should be
      // dissolved or asleep. That is mostly invisible on a desktop, where a resize
      // only happens when you drag the window and you are usually still on the hero;
      // on a phone the address bar showing and hiding fires resize all through a
      // scroll, so it repainted an undissolved field over and over.
      //
      // Going through the tick also gets the sleep gate for free: it only runs on the
      // hero and only while the field is awake, so a resize inside a section costs
      // nothing and the flag is simply consumed by the next tick that does run.
      this._glDirty = true;
      this._settleRaf = performance.now() < end ? requestAnimationFrame(step) : 0;
    };
    this._settleRaf = requestAnimationFrame(step);
  }

  buildAscii() {
    const root = this.el();
    const box = root && root.querySelector('[data-ascii]');
    if (!box) return;
    const w = box.clientWidth;
    const h = box.clientHeight;
    if (w < 40 || h < 40) return;
    let cvs = box.querySelector('canvas');
    if (!cvs) {
      cvs = document.createElement('canvas');
      cvs.style.cssText = 'display:block;width:100%;height:100%';
      box.textContent = '';
      box.appendChild(cvs);
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cvs.width = Math.floor(w * dpr);
    cvs.height = Math.floor(h * dpr);
    // Pin the element to the size this grid was built for rather than leaving it
    // at width/height:100%. Between the box changing and the rebuild landing,
    // 100% stretches the old backing store across the new width -- the smear.
    // At a fixed size it simply stops short (black, over a black page) or is
    // clipped by the box's overflow:hidden, neither of which reads as a fault.
    cvs.style.width = w + 'px';
    cvs.style.height = h + 'px';
    const gl = this._gl || cvs.getContext('webgl2', { alpha: true, antialias: false, premultipliedAlpha: false });
    if (!gl) return;
    this._gl = gl;
    const fs = 12.5 ?? (parseFloat(getComputedStyle(box).fontSize) || 13);
    const fam = "'SN Ja Mono', ui-monospace, Menlo, monospace";
    const m2 = document.createElement('canvas').getContext('2d');
    m2.font = '300 ' + fs + 'px ' + fam;
    const adv = m2.measureText('M').width || fs * 0.6;
    const cw = adv * ((140) / 100);
    const ch = fs * ((215) / 100);
    const cols = Math.max(20, Math.floor(w / cw));
    const rows = Math.max(6, Math.floor(h / ch));
    const n = cols * rows;
    this._cw = cw; this._ch = ch; this._cols = cols; this._rows = rows; this._n = n;
    this._asciiW = w; this._asciiH = h; // keep queueAscii's guard honest after a direct build

    const AT = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-/';
    this._atIdx = {};
    for (let i = 0; i < AT.length; i++) this._atIdx[AT[i]] = i;
    const acols = 8;
    const arows = Math.ceil(AT.length / acols);
    const gsz = Math.ceil(fs * 1.5 * dpr);
    const ac = document.createElement('canvas');
    ac.width = acols * gsz;
    ac.height = arows * gsz;
    const a2 = ac.getContext('2d');
    a2.font = '300 ' + Math.round(fs * dpr) + 'px ' + fam;
    a2.fillStyle = '#fff';
    a2.textAlign = 'center';
    a2.textBaseline = 'middle';
    for (let i = 1; i < AT.length; i++) {
      a2.fillText(AT[i], (i % acols) * gsz + gsz / 2, Math.floor(i / acols) * gsz + gsz / 2);
    }

    const dens = (85) / 100;
    const gamma = 1.75;
    const cell = new Float32Array(n * 2);
    const dyn = new Float32Array(n * 5);
    const tScale = new Float32Array(n).fill(1);
    const baseA = new Float32Array(n);
    const live = [];
    const glyphN = AT.length - 1;
    const boxRc0 = box.getBoundingClientRect();
    const inkRect = (sl) => {
      const rg = document.createRange();
      const tn = Array.from(sl.childNodes).find((x) => x.nodeType === 3);
      if (!tn) return sl.getBoundingClientRect();
      rg.selectNodeContents(sl);
      const rr = rg.getBoundingClientRect();
      rg.detach && rg.detach();
      return rr.width ? rr : sl.getBoundingClientRect();
    };
    const holes = Array.from(root.querySelectorAll('[data-slot]')).map((sl) => {
      const raw = inkRect(sl);
      const fsz = parseFloat(getComputedStyle(sl).fontSize) || 16;
      const r0 = {
        left: raw.left,
        right: raw.right,
        top: raw.top + (raw.height - fsz * 0.72) * 0.72,
        bottom: raw.bottom - (raw.height - fsz * 0.72) * 0.28
      };
      return {
        x0: (r0.left - boxRc0.left) / cw,
        x1: (r0.right - boxRc0.left) / cw,
        y0: (r0.top - boxRc0.top) / ch,
        y1: (r0.bottom - boxRc0.top) / ch
      };
    });
    const pad = -0.1;
    const feather = 0.9;
    const clearAt = (r, c) => {
      let v = 1;
      const px = c + 0.5;
      const py = r + 0.5;
      for (let k = 0; k < holes.length; k++) {
        const hh = holes[k];
        const dx = Math.max(0, Math.max(hh.x0 - pad - px, px - (hh.x1 + pad)));
        const dy = Math.max(0, Math.max(hh.y0 - pad - py, py - (hh.y1 + pad)));
        const d = Math.sqrt(dx * dx + dy * dy) / feather;
        if (d < 1) {
          const q = d;
          v = Math.min(v, 0.05 + 0.95 * (q * q * (3 - 2 * q)));
        }
      }
      return v;
    };
    for (let r = 0; r < rows; r++) {
      const t = (r + 1) / rows;

      const p0 = (0.34 + 0.66 * Math.pow(t, gamma)) * dens;
      const a0 = ((FIELD_TOP_BRIGHTNESS) / 100 + 0.5 * Math.pow(t, 1.1)) * ((125) / 100);
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const clear = clearAt(r, c);
        const p = p0 * (0.25 + 0.75 * clear);
        const a = a0 * clear;
        cell[i * 2] = c;
        cell[i * 2 + 1] = r;
        const on = hash2(c, r, 1) < p;
        baseA[i] = on ? a : 0;
        dyn[i * 5] = on ? 1 + ((hash2(c, r, 2) * glyphN) | 0) : 0;
        dyn[i * 5 + 1] = baseA[i];
        dyn[i * 5 + 4] = 1;
        if (on) live.push(i);
      }
    }
    this._cellArr = cell;
    this._dyn = dyn;
    this._baseA = baseA;
    this._liveIdx = live;
    this._word = new Map();
    this._moving = new Set();
    this._tOff = new Float32Array(n * 2);
    this._tScale = tScale;

    // Per-run random dissolve thresholds: contiguous horizontal runs (i = r*cols+c) share a
    // value so whole "strings" vanish together as dissolveField(t) ramps 0→1. Regenerated
    // with the grid on every resize/rebuild.
    const diss = new Float32Array(n);
    for (let r = 0; r < rows; r++) {
      let c = 0;
      let run = 0;
      while (c < cols) {
        // Keyed on the run's index within the row, not on Math.random(), for the
        // same reason as the cells: every row is walked from column 0, so a
        // wider grid reproduces the same runs and simply continues past where
        // the old one stopped, instead of re-cutting the whole row.
        const runLen = 2 + ((hash2(run, r, 3) * 7) | 0);
        const rv = hash2(run, r, 4);
        for (let k = 0; k < runLen && c < cols; k++, c++) diss[r * cols + c] = rv;
        run++;
      }
    }
    this._dissolveThresh = diss;
    if (this._dissolveT > 0.001) this._applyDissolve(); // survive a rebuild mid-dissolve

    if (!this._prog) {
      const vs = '#version 300 es\n' +
        'in vec2 aCorner; in vec2 aCell; in float aGlyph; in float aAlpha; in vec2 aOff; in float aScale;\n' +
        'uniform vec2 uRes; uniform vec2 uCellPx; uniform vec2 uGlyphPx; uniform vec2 uGrid;\n' +
        'uniform vec2 uCursor; uniform float uCurRadius; uniform float uCurAmt;\n' +
        'uniform vec2 uNav[4]; uniform float uNavRadius; uniform float uNavAmt; uniform float uTime;\n' +
        'out vec2 vUV; out float vA; out float vS; out float vL; out float vN;\n' +
        // Large, slow fractal noise (fBm) drifting over the field — computed in the vertex shader so
        // the math runs highp (no mediump drift over long sessions). One value per cell (from its centre).
        'float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }\n' +
        'float vn(vec2 p){ vec2 i=floor(p),f=fract(p),u=f*f*(3.0-2.0*f);\n' +
        ' return mix(mix(h21(i),h21(i+vec2(1.0,0.0)),u.x),mix(h21(i+vec2(0.0,1.0)),h21(i+vec2(1.0,1.0)),u.x),u.y); }\n' +
        'float fbm(vec2 p){ float s=0.0,a=0.5; for(int k=0;k<3;k++){ s+=a*vn(p); p*=2.03; a*=0.5; } return s/0.875; }\n' +
        'void main(){\n' +
        ' vec2 ctr = aCell * uCellPx + uCellPx * 0.5 + aOff;\n' +
        ' vN = fbm(ctr * 0.0022 + vec2(uTime * 0.03, uTime * 0.018));\n' +
        ' vec2 pos = ctr + (aCorner - 0.5) * uGlyphPx * aScale;\n' +
        ' gl_Position = vec4(pos.x / uRes.x * 2.0 - 1.0, 1.0 - pos.y / uRes.y * 2.0, 0.0, 1.0);\n' +
        ' vec2 g = vec2(mod(aGlyph, uGrid.x), floor(aGlyph / uGrid.x));\n' +
        ' vUV = (g + vec2(aCorner.x, aCorner.y)) / uGrid;\n' +
        ' vA = aAlpha;\n' +
        ' vS = aScale;\n' +
        ' float L = 0.0;\n' +
        ' if (uCurAmt > 0.0) { float t = clamp(1.0 - distance(ctr, uCursor) / max(1.0, uCurRadius), 0.0, 1.0); L = max(L, uCurAmt * t * t); }\n' +
        ' if (uNavAmt > 0.0) { for (int j = 0; j < 4; j++) { float t = clamp(1.0 - distance(ctr, uNav[j]) / max(1.0, uNavRadius), 0.0, 1.0); L = max(L, uNavAmt * t * t); } }\n' +
        ' vL = L;\n' +
        '}';
      const fsrc = '#version 300 es\n' +
        'precision mediump float;\n' +
        'in vec2 vUV; in float vA; in float vS; in float vL; in float vN; out vec4 o; uniform sampler2D uTex; uniform float uOpacity; uniform float uPeak; uniform float uBoost;\n' +
        'void main(){ float a = texture(uTex, vUV).a * vA; if(a < 0.01) discard;' +
        ' float w = pow(clamp((vS - 1.0) / max(0.001, uPeak - 1.0), 0.0, 1.0), 1.6);' +
        ' float lit = clamp(w + vL * 0.6, 0.0, 1.0);' +
        ' vec3 c = mix(vec3(0.851, 0.882, 0.918), vec3(1.0), lit);' +
        // Field breathes: dark cells (vL≈0) get the ±20% slow-noise swing; lit cells (flashlight/nav) stay steady.
        ' float nf = mix(mix(0.80, 1.20, vN), 1.0, clamp(vL, 0.0, 1.0));' +
        ' o = vec4(c, min(1.0, a * uOpacity * (1.0 + w * 0.4) * (1.0 + uBoost * vL) * nf)); }';
      const mk = (type, src) => {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) console.warn(gl.getShaderInfoLog(sh));
        return sh;
      };
      const pr = gl.createProgram();
      gl.attachShader(pr, mk(gl.VERTEX_SHADER, vs));
      gl.attachShader(pr, mk(gl.FRAGMENT_SHADER, fsrc));
      gl.linkProgram(pr);
      this._prog = pr;
      this._loc = {
        corner: gl.getAttribLocation(pr, 'aCorner'),
        cell: gl.getAttribLocation(pr, 'aCell'),
        glyph: gl.getAttribLocation(pr, 'aGlyph'),
        alpha: gl.getAttribLocation(pr, 'aAlpha'),
        off: gl.getAttribLocation(pr, 'aOff'),
        scale: gl.getAttribLocation(pr, 'aScale'),
        res: gl.getUniformLocation(pr, 'uRes'),
        cellPx: gl.getUniformLocation(pr, 'uCellPx'),
        glyphPx: gl.getUniformLocation(pr, 'uGlyphPx'),
        grid: gl.getUniformLocation(pr, 'uGrid'),
        tex: gl.getUniformLocation(pr, 'uTex'),
        opacity: gl.getUniformLocation(pr, 'uOpacity'),
        peak: gl.getUniformLocation(pr, 'uPeak'),
        cursor: gl.getUniformLocation(pr, 'uCursor'),
        curRadius: gl.getUniformLocation(pr, 'uCurRadius'),
        curAmt: gl.getUniformLocation(pr, 'uCurAmt'),
        nav: gl.getUniformLocation(pr, 'uNav'),
        navRadius: gl.getUniformLocation(pr, 'uNavRadius'),
        navAmt: gl.getUniformLocation(pr, 'uNavAmt'),
        lumBoost: gl.getUniformLocation(pr, 'uBoost'),
        time: gl.getUniformLocation(pr, 'uTime')
      };
      this._bCorner = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this._bCorner);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
      this._bCell = gl.createBuffer();
      this._bDyn = gl.createBuffer();
      this._tex = gl.createTexture();
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this._bCell);
    gl.bufferData(gl.ARRAY_BUFFER, cell, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._bDyn);
    gl.bufferData(gl.ARRAY_BUFFER, dyn, gl.DYNAMIC_DRAW);
    gl.bindTexture(gl.TEXTURE_2D, this._tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ac);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this._glyphPx = gsz / dpr;
    this._atGrid = [acols, arows];
    this._glDirty = true;
    // Draw NOW rather than leaving it to the next tick. Setting cvs.width above
    // cleared the drawing buffer, and the tick's draw is gated on _glDirty --
    // so between the two there is a frame of empty canvas. One rebuild a frame
    // means one empty frame per frame, which is the field going black for the
    // length of a drag.
    this.drawAscii();

    if (!this._asciiBound) {
      this._asciiBound = true;
      box.addEventListener('mousemove', (e) => {
        const rect = box.getBoundingClientRect();
        this._mc = Math.floor((e.clientX - rect.left) / this._cw);
        this._mr = Math.floor((e.clientY - rect.top) / this._ch);
        const bar = this.el() && this.el().querySelector('[data-bar]');
        let near = false;
        if (bar) {
          const br = bar.getBoundingClientRect();
          const pad = (this._ch || 20) * 1.5; // mute hover only within ~1–2 rows of the middle nav bar
          near = e.clientY > br.top - pad && e.clientY < br.bottom + pad;
        }
        if (near) {
          if (this._mIn) { this._mIn = false; this.asciiClear(true); }
        } else this._mIn = true;
      });
      box.addEventListener('mouseleave', () => { this._mIn = false; this.asciiClear(true); });
    }
  }

  asciiClear(soft) {
    if (!this._dyn) return;
    if (soft) {
      const t0 = performance.now();
      this._fade = this._fade || new Map();
      this._word.forEach((v, i) => {
        this._fade.set(i, { g: this._dyn[i * 5], a0: this._dyn[i * 5 + 1], s0: this._dyn[i * 5 + 4], t0: t0, dur: 340 });
        this._tScale[i] = 1;
        this._tOff[i * 2] = 0;
        this._tOff[i * 2 + 1] = 0;
        this._moving.add(i);
      });
      this._word.clear();
      this._tHide = new Set();
      this._pullSet = new Set();
      return;
    }
    this._word.forEach((v, i) => {
      this._dyn[i * 5] = this._baseA[i] > 0 ? 1 + ((Math.random() * 38) | 0) : 0;
      this._dyn[i * 5 + 1] = this._baseA[i];
      this._tScale[i] = 1;
      this._moving.add(i);
    });
    if (this._tHide) {
      this._tHide.forEach((i) => {
        this._dyn[i * 5] = this._baseA[i] > 0 ? 1 + ((Math.random() * 38) | 0) : 0;
        this._dyn[i * 5 + 1] = this._baseA[i];
        this._moving.add(i);
      });
      this._tHide = new Set();
    }
    this._word.clear();
    for (let i = 0; i < this._n; i++) { this._tOff[i * 2] = 0; this._tOff[i * 2 + 1] = 0; this._moving.add(i); }
    this._glDirty = true;
  }

  asciiHover() {
    if (!this._dyn || !this._mIn) return;
    const c = this._mc;
    const r = this._mr;
    const cols = this._cols;
    const rows = this._rows;
    const dyn = this._dyn;
    const baseA = this._baseA;
    const span = 0;
    const band = Math.min(3, Math.max(0, Math.floor((r / rows) * 4)));
    const next = new Map();
    const hidePrev = this._tHide || new Set();
    this._tHide = new Set();
    const rowsWord = [];
    void baseA;
    for (let dr = -span; dr <= span; dr++) {
      const rr = r + dr;
      if (rr < 0 || rr >= rows) continue;
      let hs = Math.imul(rr + 1, 374761393) ^ Math.imul(Math.floor(c / 6) + 1, 668265263) ^ Math.imul(band + 1, 2246822519);
      hs = (hs ^ (hs >>> 13)) >>> 0;
      const word = SVC_WORDS[hs % SVC_WORDS.length];
      void 0;
      const st = Math.max(0, Math.min(cols - word.length, c - Math.floor(word.length / 2)));
      const fade = 1 - (Math.abs(dr) / (span + 1)) * 0.22;
      rowsWord.push({ row: rr, start: st, len: word.length });
      for (let k = 0; k < word.length; k++) {
        const i = rr * cols + st + k;
        next.set(i, { g: this._atIdx[word[k]] || 0, a: 1 });
      }
    }
    this._word.forEach((v, i) => {
      if (next.has(i)) return;
      dyn[i * 5] = baseA[i] > 0 ? 1 + ((Math.random() * 38) | 0) : 0;
      dyn[i * 5 + 1] = baseA[i];
      this._tScale[i] = 1;
      this._moving.add(i);
    });
    next.forEach((v, i) => {
      if (this._fade) this._fade.delete(i);
      if (this._fade) this._fade.delete(i);
      dyn[i * 5] = v.g;
      dyn[i * 5 + 1] = v.a;
    });
    this._word = next;

    const cwv = this._cw;
    const tighten = (18) / 100;
    const reach = 8;
    const strength = (45) / 100;
    const prev = this._pullSet || new Set();
    const now2 = new Set();
    rowsWord.forEach((w) => {
      const len = w.len;
      const spreadPer = cwv * Math.max(0, ((1.25) - 1) - tighten);
      for (let k = 0; k < len; k++) {
        const i = w.row * cols + w.start + k;
        this._tOff[i * 2] = (k - (len - 1) / 2) * spreadPer;
        this._tOff[i * 2 + 1] = 0;
        this._tScale[i] = HOVER_PEAK;
        now2.add(i);
        this._moving.add(i);
      }
      const GAP_CELLS = 2;
      for (let d = 1; d <= HOVER_FALL_REACH; d++) {
        const push = spreadPer * (len / 2) + strength * cwv * 1.2;
        const fall = d <= reach ? Math.pow(1 - d / (reach + 1), 1.6) : 0;
        const amt = -fall * push;
        const u = d / (HOVER_FALL_REACH + 1);
        const sc = 1 + (HOVER_PEAK - 1) * HOVER_RING_MAX * Math.pow(Math.max(0, 1 - u * u), 1.9);
        const blank = d <= GAP_CELLS;
        const lc = w.start - d;
        if (lc >= 0) {
          const i = w.row * cols + lc;
          this._tOff[i * 2] = amt;
          this._tOff[i * 2 + 1] = 0;
          this._tScale[i] = sc;
          if (blank) this._tHide.add(i);
          now2.add(i);
          this._moving.add(i);
        }
        const rc = w.start + len - 1 + d;
        if (rc < cols) {
          const i = w.row * cols + rc;
          this._tOff[i * 2] = -amt;
          this._tOff[i * 2 + 1] = 0;
          this._tScale[i] = sc;
          if (blank) this._tHide.add(i);
          now2.add(i);
          this._moving.add(i);
        }
      }
      this._tHide.forEach((i) => {
        if (next.has(i)) return;
        dyn[i * 5] = 0;
        dyn[i * 5 + 1] = 0;
      });
      hidePrev.forEach((i) => {
        if (this._tHide.has(i) || next.has(i)) return;
        dyn[i * 5] = baseA[i] > 0 ? 1 + ((Math.random() * 38) | 0) : 0;
        dyn[i * 5 + 1] = baseA[i];
        this._moving.add(i);
      });
    });
    const chv = this._ch || cwv * 2;
    const Rpx = HOVER_FALL_REACH * cwv;
    const rowSpan = Math.max(1, Math.ceil(Rpx / chv));
    for (let dr = -rowSpan; dr <= rowSpan; dr++) {
      const rr = r + dr;
      if (rr < 0 || rr >= rows) continue;
      const dy = dr * chv;
      const halfW = Math.sqrt(Math.max(0, Rpx * Rpx - dy * dy));
      const colSpan = Math.floor(halfW / cwv);
      for (let dc = -colSpan; dc <= colSpan; dc++) {
        const cc = c + dc;
        if (cc < 0 || cc >= cols) continue;
        const i = rr * cols + cc;
        if (now2.has(i) || this._word.has(i)) continue;
        const dx = dc * cwv;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const u = dist / Rpx;
        if (u >= 1) continue;
        const g = HOVER_RING_MAX * Math.pow(1 - u * u, 1.9);
        const bow = u * (1 - u) * 4;
        const disp = bow * cwv * 0.6;
        const ux = dist > 0.001 ? dx / dist : 0;
        const uy = dist > 0.001 ? dy / dist : 0;
        this._tOff[i * 2] = ux * disp;
        this._tOff[i * 2 + 1] = uy * disp;
        this._tScale[i] = 1 + (HOVER_PEAK - 1) * g;
        now2.add(i);
        this._moving.add(i);
      }
    }
    prev.forEach((i) => {
      if (now2.has(i)) return;
      this._tOff[i * 2] = 0;
      this._tOff[i * 2 + 1] = 0;
      this._tScale[i] = 1;
      this._moving.add(i);
    });
    this._pullSet = now2;
    this._glDirty = true;
  }

  wipeAscii(out) {
    const box = this.el() && this.el().querySelector('[data-ascii]');
    if (!box) return;
    if (this._wipe) cancelAnimationFrame(this._wipe);
    const dur = 620;
    const t0 = performance.now();
    box.style.transition = 'none';
    const e0 = out ? 0 : 1;
    const edge0 = -20 + e0 * 140;
    const grad0 = 'linear-gradient(180deg, rgba(0,0,0,0) ' + edge0.toFixed(1) + '%, rgba(0,0,0,1) ' + (edge0 + 22).toFixed(1) + '%)';
    box.style.webkitMaskImage = grad0;
    box.style.maskImage = grad0;
    box.style.opacity = '1';
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const e = out ? p : 1 - p;
      const edge = -20 + e * 140;
      const grad = 'linear-gradient(180deg, rgba(0,0,0,0) ' + edge.toFixed(1) + '%, rgba(0,0,0,1) ' + (edge + 22).toFixed(1) + '%)';
      box.style.webkitMaskImage = grad;
      box.style.maskImage = grad;
      if (p < 1) this._wipe = requestAnimationFrame(step);
      else {
        this._wipe = null;
        if (out) {
          box.style.transition = 'none';
          box.style.opacity = '0';
          requestAnimationFrame(() => { box.style.maskImage = ''; box.style.webkitMaskImage = ''; });
        }
        else { box.style.maskImage = ''; box.style.webkitMaskImage = ''; }
      }
    };
    this._wipe = requestAnimationFrame(step);
  }

  tickAscii(now) {
    if (!this._gl || !this._dyn) return;
    const dyn = this._dyn;
    if (this._mIn) this.asciiHover();
    // Cursor-pool presence eases toward 1 while the mouse is over the field, 0 when it leaves or
    // mutes near the bar — so the luminance halo fades rather than snapping (drawAscii reads _lumCurA).
    {
      const lt = this._mIn ? 1 : 0;
      const l0 = this._lumCurA || 0;
      if (Math.abs(lt - l0) > 0.001) { this._lumCurA = l0 + (lt - l0) * 0.16; this._glDirty = true; }
      else if (this._lumCurA !== lt) { this._lumCurA = lt; this._glDirty = true; }
    }
    if (!this._lastFlick || now - this._lastFlick > 55) {
      this._lastFlick = now;
      const live = this._liveIdx;
      const k = Math.max(8, (live.length * 0.05) | 0);
      for (let j = 0; j < k; j++) {
        const i = live[(Math.random() * live.length) | 0];
        if (this._word.has(i) || (this._fade && this._fade.has(i))) continue;
        dyn[i * 5] = 1 + ((Math.random() * 38) | 0);
      }
      this._glDirty = true;
    }
    if (this._fade && this._fade.size) {
      const gone = [];
      this._fade.forEach((f, i) => {
        const p = Math.min(1, (now - f.t0) / f.dur);
        dyn[i * 5] = f.g;
        dyn[i * 5 + 1] = f.a0 + (this._baseA[i] - f.a0) * p;
        if (p >= 1) {
          dyn[i * 5] = this._baseA[i] > 0 ? 1 + ((Math.random() * 38) | 0) : 0;
          dyn[i * 5 + 1] = this._baseA[i];
          gone.push(i);
        }
      });
      gone.forEach((i) => this._fade.delete(i));
      this._glDirty = true;
    }
    if (this._moving.size) {
      const done = [];
      this._moving.forEach((i) => {
        const tx = this._tOff[i * 2];
        const ty = this._tOff[i * 2 + 1];
        const ox = dyn[i * 5 + 2] + (tx - dyn[i * 5 + 2]) * 0.1;
        const oy = dyn[i * 5 + 3] + (ty - dyn[i * 5 + 3]) * 0.1;
        dyn[i * 5 + 2] = ox;
        dyn[i * 5 + 3] = oy;
        const ts = this._tScale[i];
        const cs = dyn[i * 5 + 4] + (ts - dyn[i * 5 + 4]) * 0.16;
        dyn[i * 5 + 4] = cs;
        if (Math.abs(tx - ox) < 0.05 && Math.abs(ty - oy) < 0.05 && Math.abs(ts - cs) < 0.005) {
          dyn[i * 5 + 2] = tx;
          dyn[i * 5 + 3] = ty;
          dyn[i * 5 + 4] = ts;
          if (tx === 0 && ty === 0 && ts === 1) done.push(i);
        }
      });
      done.forEach((i) => this._moving.delete(i));
      this._glDirty = true;
    }
    this._applyDissolve(); // wins the frame — after flicker/fade/hover, before the draw
    if (!this._glDirty) return;
    this._glDirty = false;
    this.drawAscii();
  }

  drawAscii() {
    const gl = this._gl;
    const L = this._loc;
    const box = this.el() && this.el().querySelector('[data-ascii]');
    const cvs = box && box.querySelector('canvas');
    if (!gl || !cvs) return;
    gl.viewport(0, 0, cvs.width, cvs.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this._prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._bCorner);
    gl.enableVertexAttribArray(L.corner);
    gl.vertexAttribPointer(L.corner, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(L.corner, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._bCell);
    gl.enableVertexAttribArray(L.cell);
    gl.vertexAttribPointer(L.cell, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(L.cell, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._bDyn);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this._dyn);
    gl.enableVertexAttribArray(L.glyph);
    gl.vertexAttribPointer(L.glyph, 1, gl.FLOAT, false, 20, 0);
    gl.vertexAttribDivisor(L.glyph, 1);
    gl.enableVertexAttribArray(L.alpha);
    gl.vertexAttribPointer(L.alpha, 1, gl.FLOAT, false, 20, 4);
    gl.vertexAttribDivisor(L.alpha, 1);
    gl.enableVertexAttribArray(L.off);
    gl.vertexAttribPointer(L.off, 2, gl.FLOAT, false, 20, 8);
    gl.enableVertexAttribArray(L.scale);
    gl.vertexAttribPointer(L.scale, 1, gl.FLOAT, false, 20, 16);
    gl.vertexAttribDivisor(L.scale, 1);
    gl.vertexAttribDivisor(L.off, 1);
    gl.uniform2f(L.res, cvs.clientWidth, cvs.clientHeight);
    gl.uniform2f(L.cellPx, this._cw, this._ch);
    gl.uniform2f(L.glyphPx, this._glyphPx, this._glyphPx);
    gl.uniform2f(L.grid, this._atGrid[0], this._atGrid[1]);
    gl.uniform1f(L.opacity, (FIELD_OPACITY) / 100);
    gl.uniform1f(L.time, performance.now() / 1000); // drives the slow fractal-noise drift over the field
    gl.uniform1f(L.peak, HOVER_PEAK);
    // --- Field luminance: additive pools over the untouched field ---
    // (#2) Cursor "flashlight" centred on the highlighted word, radius = the magnify disc (matches asciiHover).
    gl.uniform2f(L.cursor, (this._mc + 0.5) * this._cw, (this._mr + 0.5) * this._ch);
    gl.uniform1f(L.curRadius, HOVER_FALL_REACH * this._cw);
    gl.uniform1f(L.curAmt, (this._lumCurA || 0) * LUM_CURSOR);
    // (#3) One pool per middle-nav word ([data-slot]), centred on its ink, in the field box's local
    // px space (same space the vertex uses for ctr). Empty/hidden slots are parked off-canvas.
    const nav = this._navBuf || (this._navBuf = new Float32Array(8));
    const root = this.el();
    const slots = root ? root.querySelectorAll('[data-slot]') : [];
    const fr = box.getBoundingClientRect();
    for (let j = 0; j < 4; j++) {
      const sl = slots[j];
      let px = -99999, py = -99999;
      if (sl) {
        const rc = sl.getBoundingClientRect();
        if (rc.width > 0 && rc.height > 0) {
          px = (rc.left + rc.right) / 2 - fr.left;
          py = (rc.top + rc.bottom) / 2 - fr.top;
        }
      }
      nav[j * 2] = px;
      nav[j * 2 + 1] = py;
    }
    gl.uniform2fv(L.nav, nav);
    gl.uniform1f(L.navRadius, LUM_NAV_REACH * this._cw);
    gl.uniform1f(L.navAmt, LUM_NAV);
    gl.uniform1f(L.lumBoost, LUM_BOOST);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._tex);
    gl.uniform1i(L.tex, 0);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this._n);
  }

  home() {
    const root = this.el();
    if (!root || this.active < 0) return;
    const gen = (this._gen || 0) + 1;
    this._gen = gen;
    this.busy = true;
    setTimeout(() => { this.busy = false; }, 1000);
    const pan = root.querySelector('[data-panel][data-i="' + this.active + '"]');
    const bar = root.querySelector('[data-bar]');
    const stage = root.querySelector('[data-stage]');
    const hint = root.querySelector('[data-hint]');
    const W = window.innerWidth;
    if (pan) {
      const imgs = pan.querySelector('[data-imgs]');
      const bo = this.boxes(imgs);
      const bot = pan.children[1];
      if (bot) { bot.style.transition = 'none'; bot.style.opacity = '0'; }
      bo.forEach((x) => {
        const cur = getComputedStyle(x).transform;
        const sc = cur && cur !== 'none' ? (new DOMMatrixReadOnly(cur)).a : 1;
        x.animate([
          { transform: cur === 'none' ? 'translateX(0) scale(' + sc + ')' : cur },
          { transform: 'translateX(' + (W * 1.35) + 'px) scale(' + (sc * 0.8) + ')' }
        ], { duration: 700, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'forwards' });
      });
      const cl = this.active;
      setTimeout(() => { if (this._gen === gen) { pan.style.opacity = '0'; this.rest(pan.querySelector('[data-imgs]')); if (bot) bot.style.opacity = '1'; } }, 720);
      void cl;
    }
    this.active = -1;
    this._prev = -1;
    if (stage) { stage.style.opacity = '0'; stage.style.pointerEvents = 'none'; stage.style.top = ''; }
    if (hint) hint.style.opacity = '0';
    const asc = root.querySelector('[data-ascii]');
    if (bar) bar.style.top = '52vh';
    if (asc) { asc.style.pointerEvents = 'auto'; this._wiped = false; this._homeAcc = 0; this.asciiClear(); this.wipeAscii(false); }
    root.querySelectorAll('[data-slot]').forEach((s, i) => {
      s.style.color = 'rgba(217,225,234,0.45)';
      s.style.cursor = 'pointer';
      this.scramble(s, SERVICES[i].name);
    });
  }

  go(n, dir) {
    const root = this.el();
    if (!root || n === this.active) return;
    const way = dir === -1 ? -1 : 1;
    const first = this.active < 0;
    if (first && !this._wiped) {
      this._wiped = true;
      const ascW = root.querySelector('[data-ascii]');
      if (ascW) {
        ascW.style.pointerEvents = 'none';
        this._mIn = false;
        this.asciiClear();
        if (this._wipe) { cancelAnimationFrame(this._wipe); this._wipe = null; }
        ascW.style.transition = 'none';
        ascW.style.opacity = '0';
        ascW.style.maskImage = '';
        ascW.style.webkitMaskImage = '';
      }
      const barW = root.querySelector('[data-bar]');
      const titleW = root.querySelector('[data-title-a]');
      const trowW = titleW && titleW.parentElement;
      if (barW && trowW) barW.style.top = Math.round(trowW.getBoundingClientRect().bottom - root.getBoundingClientRect().top + 44) + 'px';
      setTimeout(() => this.go(n, dir), 40);
      return;
    }
    const prev = this.active;
    this._prev = prev;
    this.active = n;
    this.acc = 0;
    this.accT = 0;
    this.accT = 0;
    this.busy = true;
    const gen = (this._gen || 0) + 1;
    this._gen = gen;
    setTimeout(() => { this.busy = false; }, 1000);

    const bar = root.querySelector('[data-bar]');
    const stage = root.querySelector('[data-stage]');
    const hint = root.querySelector('[data-hint]');
    const asc = root.querySelector('[data-ascii]');
    if (asc) {
      asc.style.pointerEvents = 'none';
      this._mIn = false;
      if (!this._wipe) { asc.style.transition = 'none'; asc.style.opacity = '0'; }
    }
    if (first) {
      const titleA0 = root.querySelector('[data-title-a]');
      const trow = titleA0 && titleA0.parentElement;
      if (trow) bar.style.top = Math.round(trow.getBoundingClientRect().bottom - root.getBoundingClientRect().top + 44) + 'px';
      if (!this.live()) { stage.style.transition = 'none'; bar.style.transition = 'none'; hint.style.transition = 'none'; }
      stage.style.opacity = '1';
      stage.style.pointerEvents = 'auto';
      hint.style.opacity = '1';
    }

    const svc = SERVICES[n];
    this.sweepOff();
    const slots = root.querySelectorAll('[data-slot]');
    slots.forEach((s, i) => {
      s.style.color = i === 0 ? 'rgb(217,225,234)' : 'rgba(217,225,234,0.45)';
      s.style.cursor = 'default';
      s.__target = i === 0 ? svc.name : svc.subs[i - 1];
      this.scramble(s, s.__target);
    });

    this.layout();
    const panels = root.querySelectorAll('[data-panel]');
    const anims = [];
    let travelShared = window.innerWidth + 40;
    [n, prev].forEach((k) => {
      if (k < 0) return;
      const t2 = root.querySelector('[data-panel][data-i="' + k + '"] [data-imgs]');
      if (t2) travelShared = Math.max(travelShared, t2.getBoundingClientRect().width + window.innerWidth * 0.6 + 200);
    });
    panels.forEach((pan, i) => {
      const imgs = pan.querySelector('[data-imgs]');
      if (i === n) {
        pan.style.zIndex = '2';
        pan.style.transition = 'none';
        pan.style.opacity = '1';
        if (i === 3) {
          const bd = pan.querySelector('[data-bd]');
          if (bd) {
            if (!this.live()) {
              bd.style.transition = 'none';
              bd.style.background = 'rgba(0,0,0,1)';
            } else {
              bd.style.transition = 'none';
              bd.style.background = 'rgba(0,0,0,0)';
              void bd.offsetWidth;
              bd.style.transition = 'background-color 240ms linear 760ms';
              bd.style.background = 'rgba(0,0,0,1)';
            }
          }
        }
        const botI = pan.children[1];
        if (botI) { botI.style.transition = 'none'; botI.style.opacity = '1'; }
        const listI = botI && botI.children[1];
        if (listI) { listI.style.transition = 'none'; listI.style.opacity = '1'; }
        imgs.style.transition = 'none';
        imgs.style.transform = 'none';
        const W = window.innerWidth;
        const back = 0.72;
        void back;
        this.boxes(imgs).forEach((x) => { x.getAnimations().forEach((a) => a.cancel()); x.style.transition = 'none'; x.style.transform = 'none'; });
        const dly = 0;
        const travel = travelShared;
        imgs.getAnimations().forEach((a) => a.cancel());
        const over = Math.round(travel * 0.035);
        const aIn = anims[anims.push(this.anim(imgs, [
          { transform: 'translateX(' + (way * travel) + 'px)', easing: 'cubic-bezier(.28,.78,.24,1)' },
          { transform: 'translateX(' + (-way * over) + 'px)', offset: 0.76, easing: 'cubic-bezier(.42,0,.32,1)' },
          { transform: 'translateX(0)' }
        ], { duration: 980, delay: dly, fill: 'both' })) - 1];
        this.pars(imgs).forEach((p) => {
          p.getAnimations().forEach((a) => a.cancel());
          anims.push(this.anim(p, [
            { transform: 'translateX(' + (-way * this.parCap(p)) + 'px)' },
            { transform: 'translateX(0)' }
          ], { duration: 980, delay: dly, easing: 'cubic-bezier(.33,.72,.28,1)', fill: 'both' }));
        });
        if (aIn) aIn.onfinish = () => { if (this._gen === gen && this.active === i) this.rest(imgs); };
        setTimeout(() => {
          if (this._gen !== gen || this.active !== i) return;
          pan.style.transition = 'none';
          pan.style.opacity = '1';
          const cpF = pan.querySelector('[data-copy]');
          [imgs, cpF].forEach((el) => {
            if (!el) return;
            el.getAnimations().forEach((a) => a.cancel());
            el.style.transition = 'none';
            el.style.transform = 'translateX(0)';
          });
          this.pars(imgs).forEach((p) => { p.getAnimations().forEach((a) => a.cancel()); p.style.transition = 'none'; p.style.transform = 'translateX(0)'; });
          const bdF = pan.querySelector('[data-bd]');
          if (bdF) { bdF.style.transition = 'none'; bdF.style.background = 'rgba(0,0,0,1)'; }
        }, 1120);
        pan.querySelectorAll('[data-other]').forEach((b, k) => {
          b.textContent = SERVICES[k].name;
          b.style.color = k === n ? 'rgb(217,225,234)' : 'rgba(217,225,234,0.45)';
          if (this._compact && k === n) {
            const strip = b.parentElement;
            if (strip) {
              const target = Math.max(0, b.offsetLeft - (strip.clientWidth - b.offsetWidth) / 2);
              strip.scrollLeft = target;
              if (this.live()) strip.scrollTo({ left: target, behavior: 'smooth' });
            }
          }
          b.style.cursor = k === n ? 'default' : 'pointer';
        });
        const copy = pan.querySelector('[data-copy]');
        if (copy) {
          if (copy.__txt === undefined) copy.__txt = copy.textContent;
          copy.style.transition = 'none';
          copy.style.opacity = '1';
          copy.textContent = copy.__txt;
          copy.__to = copy.__txt;
          copy.getAnimations().forEach((a) => a.cancel());
          anims.push(this.anim(copy, [
            { transform: 'translateX(' + (way * travel) + 'px)', easing: 'cubic-bezier(.28,.78,.24,1)' },
            { transform: 'translateX(' + (-way * over) + 'px)', offset: 0.76, easing: 'cubic-bezier(.42,0,.32,1)' },
            { transform: 'translateX(0)' }
          ], { duration: 980, delay: dly, fill: 'both' }));
        }
      } else if (i === prev) {
        pan.style.zIndex = '1';
        if (i === 3) { const bd0 = pan.querySelector('[data-bd]'); if (bd0) { bd0.style.transition = 'none'; bd0.style.backgroundColor = 'rgba(0,0,0,0)'; } }
        const Wo = window.innerWidth;
        const curT = getComputedStyle(imgs).transform;
        const x0 = curT === 'none' ? 0 : (new DOMMatrixReadOnly(curT)).e;
        const travelO = travelShared;
        imgs.getAnimations().forEach((a) => a.cancel());
        const overO = Math.round(travelO * 0.035);
        anims.push(this.anim(imgs, [
          { transform: 'translateX(' + x0 + 'px)', easing: 'cubic-bezier(.28,.78,.24,1)' },
          { transform: 'translateX(' + (x0 - way * (travelO + overO)) + 'px)', offset: 0.76, easing: 'cubic-bezier(.42,0,.32,1)' },
          { transform: 'translateX(' + (x0 - way * travelO) + 'px)' }
        ], { duration: 980, fill: 'forwards' }));
        this.pars(imgs).forEach((p) => {
          const cp2 = getComputedStyle(p).transform;
          const px0 = cp2 === 'none' ? 0 : (new DOMMatrixReadOnly(cp2)).e;
          p.getAnimations().forEach((a) => a.cancel());
          anims.push(this.anim(p, [
            { transform: 'translateX(' + px0 + 'px)' },
            { transform: 'translateX(' + (px0 + way * this.parCap(p)) + 'px)' }
          ], { duration: 980, easing: 'cubic-bezier(.33,.72,.28,1)', fill: 'forwards' }));
        });
        const copyO = pan.querySelector('[data-copy]');
        if (copyO) {
          const curC = getComputedStyle(copyO).transform;
          copyO.getAnimations().forEach((a) => a.cancel());
          anims.push(this.anim(copyO, [
            { transform: curC === 'none' ? 'translateX(0)' : curC, easing: 'cubic-bezier(.28,.78,.24,1)' },
            { transform: 'translateX(' + (-way * (travelO + overO)) + 'px)', offset: 0.76, easing: 'cubic-bezier(.42,0,.32,1)' },
            { transform: 'translateX(' + (-way * travelO) + 'px)' }
          ], { duration: 980, fill: 'forwards' }));
        }
        const botO = pan.children[1];
        if (botO) { botO.style.transition = 'none'; botO.style.opacity = '1'; void botO.offsetWidth; }
        const listO = botO && botO.children[1];
        if (listO) { listO.style.transition = 'none'; listO.style.opacity = '0'; }
        pan.style.transition = 'opacity 120ms linear 940ms';
        pan.style.opacity = '0';
        setTimeout(() => { if (this._gen === gen && this.active !== i) { pan.style.transition = 'none'; pan.style.opacity = '0'; } }, 1080);

        setTimeout(() => {
          if (this.active !== i) {
            if (this._gen === gen) this._prev = -1;
            pan.style.transition = 'none';
            pan.style.opacity = '0';
            this.rest(imgs);
          }
        }, 1100);
      } else {
        pan.style.transition = 'none';
        pan.style.opacity = '0';
        pan.getAnimations().forEach((a) => a.cancel());
        if (imgs) { imgs.getAnimations().forEach((a) => a.cancel()); this.rest(imgs); }
      }
    });
    if (this.live()) {
      const t0s = document.timeline.currentTime;
      anims.forEach((a) => { if (a) { try { a.startTime = t0s; } catch (e) { void e; } } });
    }
  }
}

let instance = null;

export function mountServices(opts) {
  // Reuse an existing controller across a hot-reload / accidental re-run so we never
  // build a second WebGL field + clock on the same page.
  if (instance) return instance;
  if (typeof window !== 'undefined' && window.__aoinSvcCtrl) return (instance = window.__aoinSvcCtrl);
  instance = new ServicesController();
  instance._introOnly = !!(opts && opts.introOnly);
  instance.componentDidMount();
  if (typeof window !== 'undefined') window.__aoinSvcCtrl = instance;
  return instance;
}

export function unmountServices() {
  if (!instance) return;
  instance.componentWillUnmount();
  instance = null;
}
