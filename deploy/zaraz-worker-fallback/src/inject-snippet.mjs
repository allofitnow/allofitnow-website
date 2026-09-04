// Shared tracking-injection snippet module (#77 same-source rule, wiki
// section 6 step 5). SINGLE SOURCE for every copy of the gtag activation
// code: the worker's HTML injection AND the banner's client-side handlers
// both compose THESE primitives - no duplicated copies that can drift.
//
// Region-aware Consent Mode v2 BASIC signals (wiki section 6, choice ->
// system connection step 3): analytics_storage denied in opt-in
// jurisdictions until choice; granted elsewhere until opt-out. No ads
// signals, no URL passthrough, no certification claimed.

import { isOptIn } from "./gate.mjs";

// --- primitives (bare statements; callers wrap them) ---

export function dataLayerJs() {
  return "window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}";
}

export function consentDefaultJs(country) {
  const state = isOptIn(country) ? "denied" : "granted";
  return dataLayerJs() + "gtag('consent','default',{analytics_storage:'" + state + "'});";
}

export function consentUpdateJs(state) {
  return dataLayerJs() + "gtag('consent','update',{analytics_storage:'" + state + "'});";
}

export function gtagConfigJs(id) {
  return "gtag('js',new Date());gtag('config','" + id + "');";
}

// Worker-side: the <script async> tag for head injection.
export function loaderScriptTag(id) {
  return '<script async src="https://www.googletagmanager.com/gtag/js?id=' + id + '"></script>';
}

// Client-side: same loader URL, appended to a live DOM (same-page activation).
export function loaderInjectJs(id) {
  return 'var s=document.createElement("script");s.async=true;'
    + 's.src="https://www.googletagmanager.com/gtag/js?id=' + id + '";'
    + "document.head.appendChild(s);";
}

export function purgeGaJs() {
  return [
    "var parts=location.hostname.split('.');",
    "for(var i=0;i<parts.length;i++){var d=parts.slice(i).join('.');",
    ' document.cookie.split(";").forEach(function(c){var n=c.split("=")[0].trim();',
    "  if(/^_ga/.test(n)){",
    '   document.cookie=n+"=;Expires=Thu, 01 Jan 1970 00:00:00 GMT;Path=/;Domain="+d;',
    '   document.cookie=n+"=;Expires=Thu, 01 Jan 1970 00:00:00 GMT;Path=/";',
    "  }});}",
  ].join("");
}

export function stripGtagJs() {
  return 'document.querySelectorAll("script[src*=\'googletagmanager.com\']").forEach(function(s){s.remove();});';
}

// --- composed bodies (shared by worker string-building and banner runtime) ---

// Full init for worker HTML injection: consent default (region-aware) + config.
export function gtagInitJs(id, country) {
  return consentDefaultJs(country) + gtagConfigJs(id);
}

// Body of "turn tracking on now, same page": idempotent guard + grant + config + loader.
export function acceptBodyJs(id) {
  return "if(window.__aoinGtagOn){return;}window.__aoinGtagOn=1;"
    + consentUpdateJs("granted") + gtagConfigJs(id) + loaderInjectJs(id);
}

// Body of "turn tracking off now, same page": deny + purge + strip.
export function optOutBodyJs() {
  return "window.__aoinGtagOn=0;" + consentUpdateJs("denied") + purgeGaJs() + stripGtagJs();
}

// --- standalone IIFEs (used where a self-executing snippet is needed) ---

export function acceptHandlerJs(id) {
  return "(function(){" + acceptBodyJs(id) + "})();";
}

export function optOutHandlerJs() {
  return "(function(){" + optOutBodyJs() + "})();";
}
