import { Hono } from "hono";
import type { AppBindings } from "../env";

export const approvalRoutes = new Hono<AppBindings>().post("/:id", (c) =>
  c.json({
    id: c.req.param("id"),
    status: "approval_recorded",
  }),
);
