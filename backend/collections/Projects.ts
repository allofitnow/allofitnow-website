import { CollectionConfig, BeforeChangeHook } from "payload/types";
import { slateEditor } from "@payloadcms/richtext-slate";

const STOPWORDS = new Set(["THE", "A", "AN", "OF", "AND"]);

// Assigns a short display code (initials + counter, e.g. "KL01") on create.
//
// `data` here is the incoming request body, which on an update does NOT carry
// an `id` — so the exclusion filter has to come from `originalDoc`, otherwise the
// document's own code counts as taken and every re-publish bumps the counter
// (the KL02-with-no-KL01 / MW03-with-no-MW01 gaps in the live CMS).
const assignCode: BeforeChangeHook = async ({ data, req, originalDoc }) => {
  if (!data?.title) return data;
  // Nothing to re-derive if the title is unchanged and a code already exists.
  if (originalDoc?.code && originalDoc.title === data.title) {
    return { ...data, code: originalDoc.code };
  }
  const existing = await req.payload.find({
    collection: "projects",
    limit: 100,
    depth: 0,
    where: originalDoc?.id ? { id: { not_equals: originalDoc.id } } : {},
  });
  const existingCodes = existing.docs.map((p: any) => p.code);
  const title = String(data.title);
  const ini =
    title
      .toUpperCase()
      .replace(/[^A-Z ]/g, "")
      .split(/\s+/)
      .filter((w: string) => w && !STOPWORDS.has(w))
      .map((w: string) => w[0])
      .join("")
      .slice(0, 3) || "XX";
  let counter = 1;
  let candidate = ini + String(counter).padStart(2, "0");
  while (existingCodes.includes(candidate)) {
    counter++;
    candidate = ini + String(counter).padStart(2, "0");
  }
  return { ...data, code: candidate };
};

const Projects: CollectionConfig = {
  slug: "projects",
  admin: {
    useAsTitle: "title",
    defaultColumns: ["title", "year", "order"],
    // "Preview" button → the real project page (rebuilt on save).
    preview: (doc: any) => (doc?.slug ? `http://192.168.30.245/work/${doc.slug}` : null),
  },
  access: {
    read: () => true,
    create: ({ req: { user } }) => Boolean(user),
    update: ({ req: { user } }) => Boolean(user),
    delete: ({ req: { user } }) => Boolean(user),
  },
  hooks: {
    beforeChange: [assignCode],
    afterChange: [
      async ({ doc, operation }) => {
        const res = await fetch('http://127.0.0.1:8788/hook', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Secret': process.env.MCP_WEBHOOK_SECRET || '',
          },
          body: JSON.stringify({
            operation,
            doc: { id: doc.id, slug: doc.slug, status: doc.status },
          }),
        });
        if (!res.ok) {
          const errBody = await res.text().catch(() => 'unknown error');
          throw new Error(`Publish failed: ${res.status} ${errBody}`);
        }
      },
    ],
    afterDelete: [
      async ({ doc }) => {
        const res = await fetch('http://127.0.0.1:8788/hook', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Secret': process.env.MCP_WEBHOOK_SECRET || '',
          },
          body: JSON.stringify({
            operation: 'afterDelete',
            doc: { id: doc.id, slug: doc.slug },
          }),
        });
        if (!res.ok) {
          const errBody = await res.text().catch(() => 'unknown error');
          throw new Error(`Publish failed: ${res.status} ${errBody}`);
        }
      },
    ],
  },
  // Fields are ordered to mirror the project page top-to-bottom, so the editor
  // reads in the same order the content lands on the site. Publishing/meta and
  // the two not-currently-rendered fields (client, body) sit in the sidebar.
  fields: [
    // ---- Main column: on-site order ----
    { name: "title", type: "text", required: true },
    { name: "tour", type: "text", admin: { description: "Secondary line under the title, e.g. WORLD TOUR" } },
    {
      name: "image",
      type: "upload",
      required: true,
      relationTo: "media",
      admin: { description: "Key image — used as both the work-list thumbnail and the project hero." },
    },
    { name: "year", type: "text", required: true },
    { name: "collaborator", type: "text", admin: { description: "Partner name only, e.g. PHNTM — the site adds the \"ALL OF IT NOW X\" prefix automatically. Leave empty for solo AOIN work." } },
    {
      name: "capabilities",
      type: "select",
      required: true,
      hasMany: true,
      admin: { description: "Indexing only — drives the work-grid filters, tile tags, and list chips. Not shown on the project page (see services)." },
      options: [
        { label: "Real-Time Content", value: "REAL-TIME CONTENT" },
        { label: "Screens Production", value: "SCREENS PRODUCTION" },
        { label: "Mixed Reality", value: "MIXED REALITY" },
        { label: "Equipment Rental", value: "EQUIPMENT RENTAL" },
      ],
    },
    {
      // Editable taxonomy (unlike `capabilities`, which stays a fixed select): a hasMany relationship
      // to the `service-categories` collection renders as a multi-select with a "Create new" option,
      // so editors can add services beyond the original four from the CMS. Existing string values are
      // converted to category records by the one-off migration (scripts/migrate-services.js).
      name: "services",
      type: "relationship",
      relationTo: "service-categories",
      hasMany: true,
      admin: { description: "Shown in the project-page meta block. Pick from the Services list; use \"Create new\" in the picker to add a category. (The capabilities field and the /services page stay fixed at the original four.)" },
    },
    { name: "summary", type: "textarea", admin: { description: "Short lede beside the meta block." } },
    {
      name: "gallery",
      type: "array",
      labels: { singular: "Gallery row", plural: "Gallery rows" },
      admin: { description: "Each row is an arrangement: pick a layout, then add the images that fill its slots." },
      fields: [
        {
          name: "layout",
          type: "select",
          required: true,
          defaultValue: "full",
          options: [
            // Full width comes in four heights. 16/7 was the only one for a long
            // time and it fits almost nothing: measured across the media library,
            // 122 of 125 assets are TALLER than it, so they lose their top and
            // bottom — median 22%. 16/9 fits 61 of them outright, and 3/1 is for
            // the handful of true panoramas that 16/7 was cutting at the sides.
            { label: "Full width, 16:9 — 1 image", value: "full-16-9" },
            { label: "Full width, 2:1 — 1 image", value: "full-2-1" },
            { label: "Full width, 16:7 — 1 image", value: "full" },
            { label: "Full width, 3:1 (panorama) — 1 image", value: "full-3-1" },
            // 19/5 is exactly 3.8:1, and 27/4 exactly 6.75:1 — written as whole
            // numbers because the value becomes a CSS class, where a dot would
            // need escaping. Nothing in the library today is this wide; these
            // are for LED-canvas exports, where the panorama IS the deliverable.
            { label: "Full width, 3.8:1 — 1 image", value: "full-19-5" },
            { label: "Full width, 27:4 (LED canvas) — 1 image", value: "full-27-4" },
            { label: "Two-up, equal — 2 images", value: "two-up" },
            { label: "Split, big left (8·4) — 2 images", value: "split-8-4" },
            { label: "Split, big right (5·7) — 2 images", value: "split-5-7" },
            { label: "Three-up — 3 images", value: "three-up" },
          ],
        },
        {
          name: "images",
          type: "array",
          labels: { singular: "Image", plural: "Images" },
          admin: { description: "Fill the layout's slots in order — each shows a thumbnail; drag to reorder. Extras beyond the slot count are ignored." },
          fields: [
            { name: "image", type: "upload", relationTo: "media" },
          ],
        },
      ],
    },
    {
      name: "stats",
      type: "array",
      fields: [
        { name: "label", type: "text" },
        { name: "value", type: "text" },
      ],
    },
    {
      name: "credits",
      type: "array",
      admin: { description: "Credit groups, e.g. ALL OF IT NOW / COLLABORATORS." },
      fields: [
        { name: "title", type: "text", admin: { description: "Group heading." } },
        {
          name: "entries",
          type: "array",
          admin: { description: "Each row displays TITLE | NAME; the name links to the social URL." },
          fields: [
            { name: "title", type: "text", admin: { description: 'Role, e.g. CREATIVE DIRECTION' } },
            { name: "name", type: "text", admin: { description: 'Display name, e.g. ALL OF IT NOW' } },
            { name: "url", type: "text", admin: { description: 'Social link the name points to (full URL).' } },
          ],
        },
      ],
    },
    {
      name: "writeup",
      type: "richText",
      // The default toolbar is bold/italic/underline and headings. This opens up
      // the rest of what Slate already ships — lists, quotes, alignment, indent —
      // and, the point of the exercise, the `upload` element: an editor can drop a
      // media doc INTO the prose. Media accepts video/* (and transcodes it to mp4
      // on the way in), so an inline clip is just an upload like any other.
      editor: slateEditor({
        admin: {
          elements: [
            "h2",
            "h3",
            "h4",
            "blockquote",
            "link",
            "ol",
            "ul",
            "indent",
            "textAlign",
            "upload",
          ],
          leaves: ["bold", "italic", "underline", "strikethrough", "code"],
          upload: {
            collections: {
              media: {
                // Shown when you click an inserted image/clip in the editor.
                fields: [
                  {
                    name: "span",
                    type: "select",
                    defaultValue: "full",
                    options: [
                      { label: "Full width of the panel", value: "full" },
                      { label: "One column", value: "half" },
                    ],
                    admin: {
                      description:
                        "In a two-column write-up: FULL breaks across both columns, ONE COLUMN sits inside the text flow. In a one-column write-up, ONE COLUMN just renders narrower.",
                    },
                  },
                  { name: "caption", type: "text", admin: { description: "Optional line under the media." } },
                ],
              },
            },
          },
        },
      }),
      admin: {
        description:
          "The expandable full write-up (PROJECT INFO panel). Headings, lists, quotes, alignment and inline images/video are all available from the toolbar. NB: publishing this project from the page composer REPLACES this field — add inline media after the last publish, or it will be overwritten.",
      },
    },
    {
      name: "writeupColumns",
      type: "select",
      defaultValue: "1",
      options: [
        { label: "One column", value: "1" },
        { label: "Two columns", value: "2" },
      ],
      admin: {
        description:
          "How the write-up flows in the panel on desktop. Two columns suits a long write-up; anything narrow than a tablet is always one column.",
      },
    },

    // ---- Sidebar: publishing + meta ----
    { name: "slug", type: "text", required: true, unique: true, admin: { position: "sidebar" } },
    { name: "code", type: "text", admin: { hidden: true } },
    {
      name: "status",
      type: "select",
      options: ["published", "archive"],
      defaultValue: "published",
      admin: {
        position: "sidebar",
        description: "published = shown on the site; archive = hidden, browsable in CMS only",
      },
      index: true,
    },
    {
      name: "order",
      type: "number",
      required: false,
      admin: {
        position: "sidebar",
        description: "Position on the Work page, lowest first — this is the running order, and it outranks the year. Easiest set visually in the page composer (WORK ORDER); year only breaks a tie between two projects sharing a number.",
      },
    },
    {
      name: "featured",
      type: "checkbox",
      defaultValue: false,
      admin: {
        position: "sidebar",
        description: "Show this project in the homepage bleed marquee.",
      },
    },
    {
      name: "featuredOrder",
      type: "number",
      admin: {
        position: "sidebar",
        description: "Order within the homepage marquee (lower = earlier). Only used when Featured is on.",
      },
    },
  ],
};

export default Projects;
