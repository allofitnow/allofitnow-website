import { CollectionConfig } from "payload/types";
import { notifyPublish } from "../hooks/publish";

// The equipment-rental fleet — one doc per server/item, rendered as the draggable
// marquee on /services. Consumed by the frontend via getEquipment() (data/equipment.ts →
// lib/payload.ts). Mirrors the `Equipment` interface on the frontend.
const Equipment: CollectionConfig = {
  slug: "equipment",
  admin: {
    useAsTitle: "label",
    defaultColumns: ["label", "order", "center", "placeholder"],
  },
  access: {
    read: () => true,
    create: ({ req: { user } }) => Boolean(user),
    update: ({ req: { user } }) => Boolean(user),
    delete: ({ req: { user } }) => Boolean(user),
  },
  hooks: {
    afterChange: [
      async ({ doc, operation }) =>
        notifyPublish(operation, { id: doc.id, slug: doc.slug, status: "published" }),
    ],
    afterDelete: [
      async ({ doc }) => notifyPublish("afterDelete", { id: doc.id, slug: doc.slug }),
    ],
  },
  fields: [
    { name: "label", type: "text", required: true, admin: { description: "Marquee display name, e.g. DISGUISE GX3." } },
    {
      name: "image",
      type: "upload",
      relationTo: "media",
      admin: { description: "Plate image shown when this item is centered. Leave empty for a placeholder item." },
    },
    { name: "tip", type: "textarea", admin: { description: "Body copy shown under the marquee when this item is centered." } },

    // ---- sidebar ----
    { name: "slug", type: "text", required: true, unique: true, admin: { position: "sidebar" } },
    { name: "order", type: "number", required: true, admin: { position: "sidebar", description: "Marquee order, left→right (ascending)." } },
    { name: "center", type: "checkbox", admin: { position: "sidebar", description: "Centered on the playhead when the section opens. Set on exactly ONE item." } },
    { name: "placeholder", type: "checkbox", admin: { position: "sidebar", description: "No plate asset yet — renders a labelled placeholder box instead of the image." } },
  ],
};

export default Equipment;
