import { Hono } from "hono";
import type { AppBindings } from "../env";

export const runnerRoutes = new Hono<AppBindings>()
  .get("/", (c) => c.json({ data: [], next: null }))
  .post("/register", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return c.json({ status: "registration_received", body }, 202);
  });
