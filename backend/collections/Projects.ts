import { CollectionConfig, BeforeChangeHook } from "payload/types";

const STOPWORDS = new Set(["THE", "A", "AN", "OF", "AND"]);

const assignCode: BeforeChangeHook = async ({ data, req }) => {
  if (!data?.title) return data;
  const existing = await req.payload.find({
    collection: "projects",
    limit: 100,
    where: data.id ? { id: { not_equals: data.id } } : {},
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
    defaultColumns: ["title", "code", "year", "order"],
  },
  access: {
    read: () => true,
    create: ({ req: { user } }) => Boolean(user),
    update: ({ req: { user } }) => Boolean(user),
    delete: ({ req: { user } }) => Boolean(user),
  },
  hooks: {
    beforeChange: [assignCode],
  },
  fields: [
    { name: "title", type: "text", required: true },
    { name: "slug", type: "text", required: true, unique: true, admin: { position: "sidebar" } },
    { name: "code", type: "text", required: true, admin: { readOnly: true, position: "sidebar" } },
    { name: "client", type: "text", required: true },
    { name: "year", type: "text", required: true },
    {
      name: "role",
      type: "select",
      required: true,
      options: [
        { label: "Real-Time Content", value: "REAL-TIME CONTENT" },
        { label: "Screens Production", value: "SCREENS PRODUCTION" },
        { label: "Mixed Reality", value: "MIXED REALITY" },
        { label: "Equipment Rental", value: "EQUIPMENT RENTAL" },
      ],
    },
    { name: "scope", type: "text", required: true },
    { name: "order", type: "number", required: true, admin: { position: "sidebar" } },
    { name: "thumb", type: "upload", required: true, relationTo: "media" },
    { name: "hero", type: "upload", required: true, relationTo: "media" },
    { name: "body", type: "textarea", required: true },
    {
      name: "capabilities",
      type: "select",
      required: true,
      hasMany: true,
      options: [
        { label: "Real-Time Content", value: "REAL-TIME CONTENT" },
        { label: "Screens Production", value: "SCREENS PRODUCTION" },
        { label: "Mixed Reality", value: "MIXED REALITY" },
        { label: "Equipment Rental", value: "EQUIPMENT RENTAL" },
      ],
    },
    { name: "tour", type: "text" },
    { name: "collaborator", type: "text" },
    { name: "summary", type: "textarea" },
    {
      name: "gallery",
      type: "array",
      fields: [
        { name: "image", type: "upload", relationTo: "media" },
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
      fields: [
        { name: "title", type: "text" },
        {
          name: "entries",
          type: "array",
          fields: [
            { name: "role", type: "text" },
            { name: "handle", type: "text" },
          ],
        },
      ],
    },
    {
      name: "writeup",
      type: "group",
      fields: [
        { name: "lead", type: "textarea" },
        {
          name: "body",
          type: "array",
          fields: [
            { name: "paragraph", type: "textarea" },
          ],
        },
      ],
    },
  ],
};

export default Projects;
