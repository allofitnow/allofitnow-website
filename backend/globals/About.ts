import { GlobalConfig } from "payload/types";
import { notifyPublish } from "../hooks/publish";

// The /studio (About) page's editable content. A singleton (global): the page structure is
// fixed — currently only the TEAM roster is CMS-editable (the statement, profile prose and
// band images still ship from the frontend seed in data/studio.ts). Drag a row to reorder;
// the array's order IS the render order, so there are no manual position numbers to keep in
// sync. Consumed by the frontend via getRoster() (data/studio.ts → lib/payload.ts
// getAboutTeam()). Empty here → the frontend falls back to its local seed, so the page never
// blanks while this is unpopulated.
const About: GlobalConfig = {
  slug: "about",
  access: {
    read: () => true,
    update: ({ req: { user } }) => Boolean(user),
  },
  hooks: {
    afterChange: [async () => notifyPublish("update", { slug: "about", status: "published" })],
  },
  fields: [
    {
      name: "team",
      type: "array",
      labels: { singular: "Team member", plural: "Team" },
      admin: {
        description:
          "The studio roster on the About page, shown in the order listed here — drag a row to reorder. Names and titles render in ALL CAPS on the site, so type them however reads best here.",
      },
      fields: [
        {
          name: "name",
          type: "text",
          required: true,
          admin: { description: "Full name, e.g. Danny Firpo." },
        },
        {
          name: "title",
          type: "text",
          required: true,
          admin: { description: "Role / title, e.g. Co-Founder and CEO. Use TITLE TBD as a placeholder until confirmed." },
        },
      ],
    },
  ],
};

export default About;
