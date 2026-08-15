import { GlobalConfig } from "payload/types";
import { notifyPublish } from "../hooks/publish";

// The /services page content — the four sections' bottom-left copy and gallery images.
// A singleton (global): the page structure is fixed; only the copy/images are editable.
// Consumed by the frontend via getServiceSections() (data/services.ts → lib/payload.ts).
// The equipment fleet is its own collection (see collections/Equipment.ts).
const Services: GlobalConfig = {
  slug: "services",
  access: {
    read: () => true,
    update: ({ req: { user } }) => Boolean(user),
  },
  hooks: {
    afterChange: [async () => notifyPublish("update", { slug: "services", status: "published" })],
  },
  fields: [
    {
      name: "sections",
      type: "array",
      labels: { singular: "Section", plural: "Sections" },
      admin: {
        description:
          "The four service sections, in page order. `slug` must match the section id (real-time-content, screens-production, mixed-reality, equipment-rental). Equipment's gallery is the fleet marquee, so leave its images empty.",
      },
      fields: [
        { name: "slug", type: "text", required: true, admin: { description: "Section id / anchor (e.g. real-time-content)." } },
        { name: "desc", type: "textarea", admin: { description: "Bottom-left body copy shown when the section is active." } },
        {
          // Payload 2 rejects a hasMany *upload* nested in an array field — ts-node exits on boot.
          // Use a hasMany *relationship* to media instead (same shape the Projects gallery uses).
          name: "images",
          type: "relationship",
          relationTo: "media",
          hasMany: true,
          admin: { description: "Gallery stills, in scrub order. Drag to reorder. (Leave empty for Equipment.)" },
        },
      ],
    },
  ],
};

export default Services;
