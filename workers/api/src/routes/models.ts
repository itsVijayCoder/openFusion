import { Hono } from "hono";
import type { AppBindings } from "../env";

export const modelRoutes = new Hono<AppBindings>()
  .get("/", (c) => c.json({ data: [] }))
  .post("/discover", (c) => c.json({ status: "queued" }, 202));
