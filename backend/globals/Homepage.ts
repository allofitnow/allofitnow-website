import { GlobalConfig } from "payload/types";

const Homepage: GlobalConfig = {
  slug: "homepage",
  access: { read: () => true },
  fields: [
    {
      name: "hero",
      type: "group",
      fields: [
        {
          name: "words",
          type: "array",
          required: true,
          minRows: 4,
          maxRows: 4,
          fields: [{ name: "word", type: "text", required: true }],
        },
        { name: "cue", type: "text", required: true },
      ],
    },
    {
      name: "about",
      type: "group",
      fields: [
        {
          name: "displayLine1",
          type: "array",
          required: true,
          minRows: 2,
          maxRows: 2,
          fields: [{ name: "line", type: "text", required: true }],
        },
        {
          name: "displayLine2",
          type: "array",
          required: true,
          minRows: 2,
          maxRows: 2,
          fields: [{ name: "line", type: "text", required: true }],
        },
        { name: "dropcap", type: "text", required: true },
        { name: "statement", type: "textarea", required: true },
        { name: "workCue", type: "text", required: true },
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
        { name: "leftLabel", type: "text", required: true },
        { name: "rightLabel", type: "text", required: true },
        {
          name: "items",
          type: "array",
          required: true,
          fields: [
            { name: "title1", type: "text", required: true },
            { name: "title2", type: "text", required: true },
            { name: "blurb", type: "textarea", required: true },
            { name: "href", type: "text", required: true },
          ],
        },
      ],
    },
    {
      name: "clients",
      type: "array",
      fields: [{ name: "name", type: "text", required: true }],
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
