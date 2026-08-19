import { GlobalConfig } from "payload/types";
import { notifyPublish } from "../hooks/publish";
import ProjectThumbPicker from "../components/ProjectThumbPicker";

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
          name: "subs",
          type: "array",
          labels: { singular: "Sub-service", plural: "Sub-services" },
          admin: {
            description:
              "Sub-service names for this section (e.g. INTERACTIVE ENVIRONMENTS, LIVE GRAPHICS, VISUAL EFFECTS, GENERATIVE SYSTEMS). The scrambling capability bar under the title shows the first FOUR (the title itself scrambles to the category name); they also feed the top nav. ALL CAPS. Leave empty to fall back to the built-in defaults.",
          },
          fields: [{ name: "label", type: "text", required: true, admin: { description: "One sub-service, all caps." } }],
        },
        {
          // Each gallery item is a still that can optionally LINK to a project (click → /work/<slug>).
          // Nested single *relationships* are fine in an array (unlike a nested hasMany *upload*, which
          // crashes ts-node on boot — that's why the old flat `images` used a media relationship).
          name: "gallery",
          type: "array",
          labels: { singular: "Gallery item", plural: "Gallery items" },
          admin: {
            description:
              "Gallery stills for the composition. While storyboarding, the page shows NUMBERED placeholder cards (Real-Time 01–16, Screens 01–12); a gallery item REPLACES the card at its Slot number, so the page doubles as a fill-in checklist of what's left. Each still can link to a Project — clicking it opens /work/<project>. For a linked still, either leave Image empty to use the project's key image, or set Image to show a different still that still links to the project. A row with only an Image (no Project) is a static, non-clickable storytelling still. Leave empty for Equipment (its gallery is the fleet marquee); Mixed Reality ignores Slot and simply orbits every still.",
          },
          fields: [
            {
              name: "slot",
              type: "number",
              min: 1,
              admin: {
                description:
                  "Composition position — the numbered card this still replaces (e.g. 3 fills card 03). Leave empty to drop into the first open position in list order.",
              },
            },
            {
              name: "image",
              type: "upload",
              relationTo: "media",
              admin: { description: "The still shown — drag in or pick, shows a thumbnail. Optional when a Project is set (then the project's key image is used)." },
            },
            {
              name: "wide",
              type: "checkbox",
              label: "Full width (skip 16:9 crop)",
              admin: { description: "On: show the whole image at its natural shape instead of cropping to 16:9. Use for panoramas / stills you want to see in full." },
            },
            {
              name: "project",
              type: "relationship",
              relationTo: "projects",
              admin: {
                description: "Link this still to a project — click its thumbnail (again to clear). Leave empty for a static still.",
                components: { Field: ProjectThumbPicker },
              },
            },
          ],
        },
      ],
    },
  ],
};

export default Services;
