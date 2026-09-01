import { GlobalConfig } from "payload/types";

const Settings: GlobalConfig = {
  slug: "settings",
  access: {
    read: () => true,
    update: ({ req: { user } }) => Boolean(user),
  },
  fields: [
    {
      name: "nav",
      type: "array",
      required: true,
      fields: [
        { name: "label", type: "text", required: true },
        { name: "href", type: "text", required: true },
      ],
    },
    {
      name: "social",
      type: "array",
      required: true,
      fields: [
        { name: "label", type: "text", required: true },
        { name: "href", type: "text", required: true },
      ],
    },
    { name: "location", type: "text", required: true },
    { name: "tagline", type: "text", required: true },
    // NB: the reel does NOT live here. It moved to the `homepage` global, where
    // it gained a source radio, a media upload and a full Vimeo URL — see
    // getHomepageReel() in the frontend, which reads /api/globals/homepage and
    // has never read this global at all.
    //
    // What used to sit here was a group of `vimeoId` + `hash`: no upload field
    // and no URL field, only a bare id. Left in place it was the first `reel`
    // an editor found in the admin, and it offered nowhere to paste a link or
    // drop a file — so it read as the feature being missing. Removed rather
    // than kept as a duplicate. Payload stops exposing the stored values; it
    // does not delete them, so nothing is lost if this ever needs reviving.
  ],
};

export default Settings;
