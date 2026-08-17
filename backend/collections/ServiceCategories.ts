import { CollectionConfig } from "payload/types";
import { notifyPublish } from "../hooks/publish";

// Editable list of SERVICES shown in the project-page meta block. Projects' `services` field is a
// hasMany relationship to this collection, so it renders as a multi-select with a "Create new"
// option — editors can add categories beyond the original 4 straight from the CMS. (The `capabilities`
// field on Projects and the /services page's four crafted sections are intentionally left fixed.)
// Labelled "Services" in the admin; slug is `service-categories` to avoid colliding with the
// `services` global. Consumed by the frontend via mapPayloadProject (relationship → label string).
const ServiceCategories: CollectionConfig = {
  slug: "service-categories",
  labels: { singular: "Service", plural: "Services" },
  admin: {
    useAsTitle: "label",
    defaultColumns: ["label", "order"],
    description: "The services a project can be tagged with (project-page meta block). Add new ones here; they then appear in every project's Services picker.",
  },
  access: {
    read: () => true,
    create: ({ req: { user } }) => Boolean(user),
    update: ({ req: { user } }) => Boolean(user),
    delete: ({ req: { user } }) => Boolean(user),
  },
  hooks: {
    afterChange: [
      async ({ doc, operation }) => notifyPublish(operation, { id: doc.id, status: "published" }),
    ],
    afterDelete: [
      async ({ doc }) => notifyPublish("afterDelete", { id: doc.id }),
    ],
  },
  fields: [
    {
      name: "label",
      type: "text",
      required: true,
      unique: true,
      admin: { description: "Display name shown on the project page, e.g. REAL-TIME CONTENT." },
    },
    {
      name: "order",
      type: "number",
      admin: { position: "sidebar", description: "Optional sort nudge for the picker list (ascending). Ties fall back to creation order." },
    },
  ],
};

export default ServiceCategories;
