import "dotenv/config";
import payload from "payload";
import config from "./payload.config";

(async () => {
  await payload.init({
    secret: process.env.PAYLOAD_SECRET || "dev-secret",
    config: config as any,
    local: true,
  });

  try {
    const user = await payload.create({
      collection: "users",
      data: {
        name: "Stella Kinoshita",
        email: "stella.kinoshita@allofitnow.com",
        password: "Someofitlater12",
      },
    });
    console.log("Created user:", user.email, "id:", user.id);
  } catch (e) {
    console.error("ERROR:", e.message);
  }
  process.exit(0);
})();
