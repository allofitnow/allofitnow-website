import "dotenv/config";
import express from "express";
import payload from "payload";

const app = express();

app.get("/", (_, res) => {
  res.redirect("/admin");
});

payload.init({
  secret: process.env.PAYLOAD_SECRET || "dev-secret",
  express: app,
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, "0.0.0.0", async () => {
  console.log(`Payload running on http://0.0.0.0:${PORT}`);
});
