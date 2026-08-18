import { buildConfig } from "payload/config";
import { mongooseAdapter } from "@payloadcms/db-mongodb";
import { webpackBundler } from "@payloadcms/bundler-webpack";
import { slateEditor } from "@payloadcms/richtext-slate";

import Media from "./collections/Media";
import Projects from "./collections/Projects";
import ServiceCategories from "./collections/ServiceCategories";
import Equipment from "./collections/Equipment";
import Users from "./collections/Users";
import Homepage from "./globals/Homepage";
import Settings from "./globals/Settings";
import Services from "./globals/Services";

export default buildConfig({
  admin: {
    user: Users.slug,
    bundler: webpackBundler(),
    // In-editor pane showing the real project page (Projects only). It reflects
    // the last build; a save triggers the auto-rebuild, then refresh the pane.
    livePreview: {
      url: ({ data }: { data: any }) => `http://192.168.30.245/work/${data?.slug || ""}`,
      collections: ["projects"],
    },
  },
  collections: [Users, Media, Projects, ServiceCategories, Equipment],
  globals: [Homepage, Settings, Services],
  db: mongooseAdapter({
    url: process.env.DATABASE_URI || "mongodb://localhost:27017/payload",
  }),
  editor: slateEditor({}),
  serverURL: process.env.PAYLOAD_PUBLIC_SERVER_URL || "http://localhost",
  cors: "*",
});
