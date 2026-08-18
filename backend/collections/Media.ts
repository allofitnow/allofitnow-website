import { CollectionConfig } from "payload/types";

const Media: CollectionConfig = {
  slug: "media",
  upload: {
    staticURL: "/media",
    staticDir: "media",
    mimeTypes: ["image/*", "video/*"],
    // Auto-convert uploaded IMAGES to WebP via sharp (videos pass through untouched). A photographic
    // still drops ~80–90% vs PNG at no visible quality loss. Applies to NEW uploads only — existing
    // media keep their original files until re-uploaded. Requires a Payload restart to take effect.
    formatOptions: { format: "webp", options: { quality: 82 } },
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
