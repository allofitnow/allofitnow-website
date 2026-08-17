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
          // Each gallery item is a still that can optionally LINK to a project (click → /work/<slug>).
          // Nested single *relationships* are fine in an array (unlike a nested hasMany *upload*, which
          // crashes ts-node on boot — that's why the old flat `images` used a media relationship).
          name: "gallery",
          type: "array",
          labels: { singular: "Gallery item", plural: "Gallery items" },
          admin: {
            description:
              "Gallery stills, in scrub order (drag to reorder). Each still can link to a Project — clicking it opens /work/<project>. For a linked still, either leave Image empty to use the project's key image, or set Image to show a different still that still links to the project. A row with only an Image (no Project) is a static, non-clickable storytelling still. Leave empty for Equipment (its gallery is the fleet marquee).",
          },
          fields: [
            {
              name: "image",
              type: "relationship",
              relationTo: "media",
              admin: { description: "The still shown. Optional when a Project is set — then the project's key image is used." },
            },
            {
              name: "project",
              type: "relationship",
              relationTo: "projects",
              admin: { description: "Link this still to a project (click → its project page). Leave empty for a static still." },
            },
          ],
        },
      ],
    },
  ],
};

export default Services;
