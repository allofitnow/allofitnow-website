import { CollectionConfig } from "payload/types";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { transcodeBuffer } = require("../lib/transcodeVideo");

const Media: CollectionConfig = {
  slug: "media",
  upload: {
    staticURL: "/media",
    staticDir: "media",
    mimeTypes: ["image/*", "video/*"],
    // Auto-convert uploaded IMAGES to WebP via sharp (videos handled by the hook below). A
    // photographic still drops ~80–90% vs PNG at no visible quality loss. Applies to NEW uploads
    // only — existing media keep their original files until re-uploaded. Requires a Payload restart.
    formatOptions: { format: "webp", options: { quality: 82 } },
  },
  hooks: {
    // VIDEO counterpart to the image→WebP line above: any non-mp4 video upload is transcoded to a
    // downscaled, hardware-decodable web mp4 (see lib/transcodeVideo.js) BEFORE Payload stores it —
    // so the CMS never serves a 30MB VP9/webm that iOS software-decodes. mp4 uploads pass through
    // (assumed already optimized). Fail-safe: if ffmpeg is missing or errors, the original file is
    // stored so an upload never hard-fails. Requires ffmpeg on the host + a Payload restart.
    beforeOperation: [
      async ({ req, operation }) => {
        const file = req && req.file;
        if (
          (operation === "create" || operation === "update") &&
          file &&
          typeof file.mimetype === "string" &&
          file.mimetype.startsWith("video/") &&
          file.mimetype !== "video/mp4"
        ) {
          const before = file.size;
          try {
            const ext = (file.name.match(/\.[^.]+$/) || [".webm"])[0];
            const mp4 = await transcodeBuffer(file.data, ext);
            file.data = mp4;
            file.name = file.name.replace(/\.[^.]+$/, "") + ".mp4";
            file.mimetype = "video/mp4";
            file.size = mp4.length;
            req.payload?.logger?.info(
              `[media] transcoded video → mp4: ${(before / 1048576).toFixed(1)}MB → ${(mp4.length / 1048576).toFixed(1)}MB`
            );
          } catch (e) {
            req.payload?.logger?.error(
              `[media] video transcode failed — storing original (${e && e.message ? e.message : e})`
            );
          }
        }
      },
    ],
  },
  access: {
    read: () => true,
    create: ({ req: { user } }) => Boolean(user),
    update: ({ req: { user } }) => Boolean(user),
    delete: ({ req: { user } }) => Boolean(user),
  },
  fields: [
    { name: "alt", type: "text" },
  ],
};

export default Media;
