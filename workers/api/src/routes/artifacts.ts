import { Hono } from "hono";
import type { AppBindings } from "../env";

export const artifactRoutes = new Hono<AppBindings>().get("/:id", (c) =>
  c.json({
    id: c.req.param("id"),
    status: "not_uploaded",
  }),
);
