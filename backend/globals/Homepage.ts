import { GlobalConfig } from "payload/types";
import { notifyPublish } from "../hooks/publish";

const Homepage: GlobalConfig = {
  slug: "homepage",
  access: {
    read: () => true,
    update: ({ req: { user } }) => Boolean(user),
  },
  hooks: {
    afterChange: [async () => notifyPublish("update", { slug: "homepage", status: "published" })],
  },
  fields: [
    {
      name: "hero",
      type: "group",
      fields: [
        {
          name: "words",
          type: "array",
          minRows: 4,
          maxRows: 4,
          fields: [{ name: "word", type: "text" }],
        },
        { name: "cue", type: "text" },
      ],
    },
    {
      name: "reel",
      type: "group",
      admin: {
        description:
          "The film behind the hero lockup. Upload a file for full control over the encode, or point at Vimeo to keep the bytes off this server.",
      },
      fields: [
        {
          name: "source",
          type: "radio",
          defaultValue: "vimeo",
          options: [
            { label: "Uploaded file", value: "upload" },
            { label: "Vimeo link", value: "vimeo" },
          ],
          admin: { description: "Which of the two below is live. The other is ignored." },
        },
        {
          name: "video",
          type: "upload",
          relationTo: "media",
          admin: {
            condition: (_data: any, siblings: any) => siblings?.source === "upload",
            description:
              "Drop an mp4 here. Anything that is not already mp4 is transcoded on upload. It plays muted and looping, so it needs no audio.",
          },
        },
        {
          name: "poster",
          type: "upload",
          relationTo: "media",
          admin: {
            condition: (_data: any, siblings: any) => siblings?.source === "upload",
            description: "Optional still held until the first frame can paint.",
          },
        },
        {
          name: "vimeoUrl",
          type: "text",
          admin: {
            condition: (_data: any, siblings: any) => siblings?.source === "vimeo",
            description:
              "Paste the Vimeo address straight from the browser — vimeo.com/ID, or vimeo.com/ID/HASH for an unlisted video. A bare id works too.",
          },
        },
      ],
    },
    {
      name: "about",
      type: "group",
      fields: [
        {
          name: "displayLine1",
          type: "array",
          minRows: 2,
          maxRows: 2,
          fields: [{ name: "line", type: "text" }],
        },
        {
          name: "displayLine2",
          type: "array",
          minRows: 2,
          maxRows: 2,
          fields: [{ name: "line", type: "text" }],
        },
        { name: "dropcap", type: "text" },
        { name: "statement", type: "textarea" },
        { name: "workCue", type: "text" },
      ],
    },
    {
      name: "bleed",
      type: "array",
      fields: [{ name: "image", type: "upload", relationTo: "media" }],
    },
    {
      name: "services",
      type: "group",
      fields: [
        { name: "leftLabel", type: "text" },
        { name: "rightLabel", type: "text" },
        {
          name: "items",
          type: "array",
          fields: [
            { name: "title1", type: "text" },
            { name: "title2", type: "text" },
            { name: "blurb", type: "textarea" },
            { name: "href", type: "text" },
          ],
        },
      ],
    },
    {
      name: "clients",
      type: "array",
      fields: [{ name: "name", type: "text" }],
    },
    {
      name: "footer",
      type: "group",
      fields: [
        {
          name: "info",
          type: "array",
          fields: [{ name: "line", type: "textarea" }],
        },
        {
          name: "legal",
          type: "array",
          fields: [{ name: "line", type: "text" }],
        },
        {
          name: "navPrimary",
          type: "array",
          fields: [
            { name: "label", type: "text" },
            { name: "href", type: "text" },
          ],
        },
        {
          name: "navSecondary",
          type: "array",
          fields: [
            { name: "label", type: "text" },
            { name: "href", type: "text" },
          ],
        },
        {
          name: "social",
          type: "array",
          fields: [
            { name: "label", type: "text" },
            { name: "href", type: "text" },
          ],
        },
        {
          name: "address",
          type: "array",
          fields: [{ name: "line", type: "text" }],
        },
      ],
    },
  ],
};

export default Homepage;
