import { CollectionConfig } from "payload/types";

const Media: CollectionConfig = {
  slug: "media",
  upload: {
    staticURL: "/media",
    staticDir: "media",
    mimeTypes: ["image/*", "video/*"],
  },
  fields: [
    { name: "alt", type: "text" },
  ],
};

export default Media;
