/* Client-bundle stub for lib/transcodeVideo.js.
 *
 * The real module uses Node-only APIs (child_process/fs/os) for the Media upload hook,
 * which runs SERVER-side only. Payload's webpack bundler would otherwise try to pull the
 * real module (via collections/Media.ts's require) into the browser admin bundle and fail
 * on the Node core modules. payload.config.ts's admin.webpack aliases the real module to
 * this stub for the client build; the server (ts-node) still requires the real file. The
 * admin UI never calls these, so they just throw if somehow invoked in the browser. */
const serverOnly = () => {
  throw new Error("transcodeVideo is server-only (see lib/transcodeVideo.js)");
};
module.exports = { transcodeFile: serverOnly, transcodeBuffer: serverOnly, FF_ARGS: () => [] };
