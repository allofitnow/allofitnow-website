import payload from "payload";
import config from "./payload.config";

(async () => {
  await payload.init({
    secret: process.env.PAYLOAD_SECRET || "dev-secret",
    config: config as any,
    local: true,
  });

  const existing = await payload.find({ collection: "users", limit: 1 });
  if (existing.totalDocs > 0) {
    console.log("User already exists:", existing.docs[0].email);
    process.exit(0);
  }

  const user = await payload.create({
    collection: "users",
    data: {
      name: "Howard",
      email: "howard.wong@anufutur.com",
      password: "Aoin2026!",
    },
  });
  console.log("Created user:", user.email, "id:", user.id);
  process.exit(0);
})().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
