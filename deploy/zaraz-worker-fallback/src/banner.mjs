// Consent UI v1 (#77): ONE worker-injected component, TWO behaviors split by
// visitor geography (owner ruling 2026-08-31). Source of truth: project wiki
// "cookie-compliance" sections 5-6 (frozen 2026-08-31).
//
// - Opt-in jurisdictions (EU/EEA/UK/CH, unknown fails closed): centered
//   BLOCKING modal, first visit. Focus trap per WCAG: initial focus on the
//   REJECT action, Tab cycles the three controls, Escape does nothing, no
//   focus escape. Three EQUAL buttons: DO NOT TRACK (initial focus, focus
//   order only - never visual emphasis), Accept all, Customize.
// - Everywhere else (incl. US): notice regime - analytics live from first
//   visit, NO modal. Slim non-blocking notice line + persistent footer
//   "Cookie settings" control with one-click opt-out (exactly as easy as
//   tracking was on).
//
// Both kinds include the footer "Cookie settings" control (the re-open path;
// neither plane re-presents after an explicit choice).
//
// The worker injects this BEFORE the closing </body> tag; inline <style> keeps
// the injection self-contained (R2 markup untouched - decision C).

import { isOptIn } from "./gate.mjs";
// same-source rule (#77): handlers compose the shared snippet module
import { acceptBodyJs, optOutBodyJs } from "./inject-snippet.mjs";

const BANNER_VERSION = 1; // bump when banner text/controls change materially (#79 tracks v2)

const STYLE = [
  '<style id="aoin-cs">',
  '.aoin-cs-overlay{position:fixed;inset:0;background:rgba(10,10,12,.72);z-index:2147483000;display:flex;align-items:center;justify-content:center;}',
  '.aoin-cs-dialog{background:#141419;color:#f2f2f4;font-family:inherit;max-width:520px;width:calc(100% - 32px);padding:28px;border-radius:12px;margin:16px;}',
  '.aoin-cs-dialog h2{font-size:1.15rem;margin:0 0 10px;color:#fff;font-weight:600;}',
  '.aoin-cs-dialog p{font-size:.92rem;line-height:1.5;margin:0 0 18px;color:#d4d4d9;}',
  '.aoin-cs-dialog a{color:#9db8ff;}',
  '.aoin-cs-btns{display:flex;gap:10px;flex-wrap:wrap;}',
  '.aoin-cs-btn{flex:1 1 140px;min-height:48px;border:1px solid #4a4a55;border-radius:8px;background:#1e1e26;color:#f2f2f4;font-size:.95rem;font-weight:500;cursor:pointer;padding:0 14px;}',
  '.aoin-cs-btn:focus-visible{outline:3px solid #9db8ff;outline-offset:2px;}',
  '.aoin-cs-panel{margin-top:14px;display:none;}',
  '.aoin-cs-panel.open{display:block;}',
  '.aoin-cs-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid #2a2a33;font-size:.92rem;}',
  '.aoin-cs-notice{position:fixed;left:0;right:0;bottom:0;z-index:2147482999;background:#141419;color:#d4d4d9;font-size:.85rem;padding:10px 16px;text-align:center;border-top:1px solid #2a2a33;}',
  '.aoin-cs-notice a{color:#9db8ff;}',
  '.aoin-cs-settings-btn{background:none;border:none;color:#9db8ff;font-size:.85rem;cursor:pointer;padding:4px 8px;text-decoration:underline;}',
  '.aoin-cs-settings-btn:focus-visible{outline:3px solid #9db8ff;outline-offset:2px;}',
  '.aoin-cs-fab{position:fixed;right:20px;bottom:20px;z-index:2147482998;width:52px;height:52px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(20,20,25,.92);border:1px solid #4a4a55;box-shadow:0 6px 20px rgba(0,0,0,.45),0 0 0 8px rgba(20,20,25,.28);cursor:pointer;transition:transform .15s ease,box-shadow .15s ease;backdrop-filter:blur(6px);padding:0;}',
  '.aoin-cs-fab:hover{transform:translateY(-2px);box-shadow:0 8px 26px rgba(0,0,0,.55),0 0 0 10px rgba(20,20,25,.32);}',
  '.aoin-cs-fab:focus-visible{outline:3px solid #9db8ff;outline-offset:2px;}',
  '.aoin-cs-fab svg{width:26px;height:26px;display:block;}',
  '@media (prefers-reduced-motion: reduce){.aoin-cs-overlay,.aoin-cs-notice{transition:none;}}',
  '</style>',
].join("");

// Shared runtime: cookie write (decision-A format), handlers, settings re-open.
// Parameterized by measurement id; embedded once per page by the worker.
function runtimeJs(id) {
  const ID_STRING = JSON.stringify(id); // e.g. "G-1TVWRSCCLN"
  return [
    '<script id="aoin-cs-run">(function(){',
    'var ID=' + ID_STRING + ';',
    'function writeConsent(on){',
    ' var r={v:1,ts:Math.floor(Date.now()/1000),categories:{analytics:on===true}};',
    ' document.cookie="aoin_consent="+encodeURIComponent(JSON.stringify(r))+";Max-Age=31536000;Path=/;SameSite=Lax";',
    '}',
    'function purgeGa(){',
    ' var parts=location.hostname.split(".");',
    ' for(var i=0;i<parts.length;i++){var d=parts.slice(i).join(".");',
    '  document.cookie.split(";").forEach(function(c){var n=c.split("=")[0].trim();',
    '   if(/^_ga/.test(n)){document.cookie=n+"=;Expires=Thu, 01 Jan 1970 00:00:00 GMT;Path=/;Domain="+d;document.cookie=n+"=;Expires=Thu, 01 Jan 1970 00:00:00 GMT;Path=/";}});}}',
    'function gtagOn(){' + acceptBodyJs(id) + '}',
    'function gtagOff(){' + optOutBodyJs() + '}',
    'function closeBanner(){',
    ' var o=document.getElementById("aoin-cs-overlay");if(o){o.remove();}',
    ' var n=document.getElementById("aoin-cs-notice");if(n){n.remove();}}',
    'function applyChoice(on){writeConsent(on);if(on){gtagOn();}else{gtagOff();}closeBanner();}',
    // focus trap (modal): Tab cycles the 3 controls + panel toggle; Escape does nothing
    'window.__aoinCsTrap=function(root){',
    ' var btns=root.querySelectorAll(".aoin-cs-btn");',
    ' btns[0].focus();',
    ' root.addEventListener("keydown",function(e){',
    '  if(e.key!=="Tab"){if(e.key==="Escape"){e.preventDefault();}return;}',
    '  e.preventDefault();',
    '  var i=Array.prototype.indexOf.call(btns,document.activeElement);',
    '  if(i===-1){btns[0].focus();return;}',
    '  var n=e.shiftKey?i-1+btns.length:i+1;btns[n%btns.length].focus();});};',
    // banner wiring: runs after DOM insertion
    'window.__aoinCsWire=function(){',
    ' var overlay=document.getElementById("aoin-cs-overlay");',
    ' var notice=document.getElementById("aoin-cs-notice");',
    ' if(overlay){window.__aoinCsTrap(overlay);',
    '  var g=function(id){return document.getElementById(id);};',
    '  g("aoin-cs-reject").addEventListener("click",function(){applyChoice(false);});',
    '  g("aoin-cs-accept").addEventListener("click",function(){applyChoice(true);});',
    '  g("aoin-cs-customize").addEventListener("click",function(){g("aoin-cs-panel").classList.toggle("open");g("aoin-cs-panel").setAttribute("aria-hidden","false");});',
    '  g("aoin-cs-save").addEventListener("click",function(){applyChoice(g("aoin-cs-analytics").checked===true);});',
    ' }',
    ' if(notice){',
    '  var b=document.getElementById("aoin-cs-out");',
    '  if(b&&!b.dataset.wired){b.dataset.wired=1;b.addEventListener("click",function(){applyChoice(false);});}',
    '  var r=document.getElementById("aoin-cs-reopen");',
    '  if(r&&!r.dataset.wired){r.dataset.wired=1;r.addEventListener("click",function(){var o=document.getElementById("aoin-cs-overlay");if(o){o.remove();}',
    '   document.body.insertAdjacentHTML("beforeend",window.__aoinCsModalHtml);window.__aoinCsWire();});}',
    ' }};',
    ' var fab=document.getElementById("aoin-cs-fab");',
    ' if(fab){',
    '  if(notice){fab.style.bottom="64px";}',
    '  if(!fab.dataset.wired){fab.dataset.wired=1;fab.addEventListener("click",function(){',
    '   var o=document.getElementById("aoin-cs-overlay");',
    '   if(o){o.remove();return;}',
    '   document.body.insertAdjacentHTML("beforeend",window.__aoinCsModalHtml);window.__aoinCsWire();});}',
    ' }',
    'window.__aoinCsRunReady=1;})();</script>',
  ].join("");
}

const MODAL_HTML = [
  '<div id="aoin-cs-overlay" class="aoin-cs-overlay" role="dialog" aria-modal="true" aria-labelledby="aoin-cs-title">',
  '<div class="aoin-cs-dialog">',
  '<h2 id="aoin-cs-title">Cookies &amp; tracking</h2>',
  '<p>We use analytics cookies (Google Analytics) to understand how the site is used. ',
  'Data goes to Google. Nothing non-essential runs until you choose. ',
  'See our <a href="/privacy">privacy policy</a> for details, retention, and your rights.</p>',
  '<div class="aoin-cs-btns">',
  '<button id="aoin-cs-reject" class="aoin-cs-btn" type="button">Do not track</button>',
  '<button id="aoin-cs-accept" class="aoin-cs-btn" type="button">Accept all</button>',
  '<button id="aoin-cs-customize" class="aoin-cs-btn" type="button">Customize</button>',
  '</div>',
  '<div id="aoin-cs-panel" class="aoin-cs-panel" aria-hidden="true">',
  '<div class="aoin-cs-row"><label for="aoin-cs-analytics">Analytics (Google Analytics)</label>',
  '<input id="aoin-cs-analytics" type="checkbox"></div>',
  '<div class="aoin-cs-btns" style="margin-top:10px;">',
  '<button id="aoin-cs-save" class="aoin-cs-btn" type="button">Save my choice</button>',
  '</div></div></div></div>',
].join("");

const NOTICE_HTML = [
  '<div id="aoin-cs-notice" class="aoin-cs-notice">',
  'We use analytics cookies to improve this site. ',
  '<a href="/privacy">Privacy policy</a> &middot; ',
  '<button id="aoin-cs-out" class="aoin-cs-settings-btn" type="button">Turn off analytics</button>',
  '</div>',
].join("");

const FAB_HTML = [
  '<button id="aoin-cs-fab" class="aoin-cs-fab" type="button" aria-label="Cookie settings (design preview)" title="Cookie settings">',
  '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="#f2f2f4" stroke-width="1.8"/><circle cx="9" cy="9.5" r="1.3" fill="#f2f2f4"/><circle cx="14" cy="8.5" r="1.1" fill="#f2f2f4"/><circle cx="15.5" cy="13.5" r="1.4" fill="#f2f2f4"/><circle cx="10" cy="15" r="1.1" fill="#f2f2f4"/></svg>',
  '</button>',
].join("");

const SETTINGS_BTN_HTML = '<button id="aoin-cs-reopen" class="aoin-cs-settings-btn" type="button">Cookie settings</button>';

// Suppress banner if the visitor already chose (consent cookie present in the
// request). Neither plane re-presents after an explicit choice; the footer
// "Cookie settings" control is the re-open path in both regimes.
// preview=true on any host except allofitnow.com/www: floating design-preview
// button (owner ruling 2026-09-01). Never on production hosts.
export function bannerFor(country, ga4id, cookieHeader, preview) {
  const fab = preview ? FAB_HTML : "";
  const optIn = isOptIn(country);
  const chose = parseConsentPresent(cookieHeader);
  if (chose) {
    // choice already recorded: no banner, footer control only (both planes)
    return {
      kind: "settled",
      html: STYLE + runtimeJs(ga4id) + fab + '<div id="aoin-cs-footer">' + SETTINGS_BTN_HTML + "</div>" + wireFooterOnly(),
    };
  }
  if (optIn) {
    return {
      kind: "modal",
      html: STYLE + runtimeJs(ga4id) + fab + MODAL_HTML.replace("<div ", '<div data-bv="' + BANNER_VERSION + '" ') + footWireModal(),
    };
  }
  return {
    kind: "notice",
    html: STYLE + runtimeJs(ga4id) + NOTICE_HTML + fab + '<div id="aoin-cs-footer">' + SETTINGS_BTN_HTML + "</div>" + wireFooterOnly(),
    notice: true,
  };
}

function parseConsentPresent(cookieHeader) {
  if (!cookieHeader) return false;
  return /(?:^|;\s*)aoin_consent=/.test(cookieHeader);
}

function wireFooterOnly() {
  return [
    '<script>window.__aoinCsModalHtml=' + JSON.stringify(MODAL_HTML) + ";",
    'window.addEventListener("DOMContentLoaded",function(){if(window.__aoinCsWire){window.__aoinCsWire();}});',
    'if(document.readyState!=="loading"){window.__aoinCsWire&&window.__aoinCsWire();}</script>',
  ].join("");
}

function footWireModal() {
  return [
    '<script>window.__aoinCsModalHtml=' + JSON.stringify(MODAL_HTML) + ";",
    'window.addEventListener("DOMContentLoaded",function(){if(window.__aoinCsWire){window.__aoinCsWire();}});',
    'if(document.readyState!=="loading"){window.__aoinCsWire&&window.__aoinCsWire();}</script>',
  ].join("");
}
