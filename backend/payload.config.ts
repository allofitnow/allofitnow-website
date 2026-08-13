import { buildConfig } from "payload/config";
import { mongooseAdapter } from "@payloadcms/db-mongodb";
import { webpackBundler } from "@payloadcms/bundler-webpack";
import { slateEditor } from "@payloadcms/richtext-slate";

import Media from "./collections/Media";
import Projects from "./collections/Projects";
import Users from "./collections/Users";
import Homepage from "./globals/Homepage";
import Settings from "./globals/Settings";

export default buildConfig({
  admin: {
    user: Users.slug,
    bundler: webpackBundler(),
  },
  collections: [Users, Media, Projects],
  globals: [Homepage, Settings],
  db: mongooseAdapter({
    url: process.env.DATABASE_URI || "mongodb://localhost:27017/payload",
  }),
  editor: slateEditor({}),
  serverURL: process.env.PAYLOAD_PUBLIC_SERVER_URL || "http://localhost",
  cors: "*",
});
