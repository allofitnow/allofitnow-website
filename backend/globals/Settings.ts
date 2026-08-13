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
    {
      name: "reel",
      type: "group",
      fields: [
        { name: "vimeoId", type: "text", required: true },
        { name: "hash", type: "text" },
      ],
    },
  ],
};

export default Settings;
