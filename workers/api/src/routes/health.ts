import { Hono } from "hono";
import type { AppBindings } from "../env";

export const healthRoutes = new Hono<AppBindings>().get("/", (c) =>
  c.json({
    ok: true,
    service: "fusion-api",
    environment: c.env.ENVIRONMENT,
  }),
);
