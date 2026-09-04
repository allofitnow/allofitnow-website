/*
 * Site-wide silence for CMS media.
 *
 * Every render site already writes `muted` into the markup, but that attribute
 * only seeds `defaultMuted` when the element is PARSED. A <video> built in
 * script, cloned, or swapped in after load carries sound unless the muted
 * PROPERTY is set — so relying on the attribute alone means a future render site
 * (or a clip an editor uploads with an audio track) can leak audio, and the
 * failure is silent until someone hears it.
 *
 * This closes it from the other end: whatever the CMS holds and whoever renders
 * it, media on this site never plays sound. Event-driven rather than a
 * MutationObserver, so it costs nothing until media actually loads or plays —
 * this site animates heavily and a subtree observer would run constantly.
 */

type Media = HTMLMediaElement;

function silence(node: EventTarget | Node | null): void {
  const el = node as Media | null;
  if (!el || !(el instanceof HTMLMediaElement)) return;
  // defaultMuted keeps it muted across a reload of the same element's source;
  // muted is what actually silences the current playback.
  el.defaultMuted = true;
  el.muted = true;
}

function silenceAll(root: ParentNode = document): void {
  root.querySelectorAll<Media>('video, audio').forEach(silence);
}

export function initMuteMedia(): void {
  silenceAll();

  // Capture phase on the document catches these for elements that did not exist
  // when this ran — media events do not bubble, so capture is what reaches them.
  // `play` is the backstop: it fires before the first frame is presented, so a
  // clip that somehow arrived unmuted is silenced before it is audible.
  const onMediaEvent = (e: Event) => silence(e.target);
  document.addEventListener('loadedmetadata', onMediaEvent, true);
  document.addEventListener('loadeddata', onMediaEvent, true);
  document.addEventListener('play', onMediaEvent, true);

  // Soft-navs swap the document body, so re-sweep what arrived.
  document.addEventListener('astro:page-load', () => silenceAll());
}
