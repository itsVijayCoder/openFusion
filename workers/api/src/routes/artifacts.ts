import { createArtifact, getArtifact, listArtifactsByRun } from "@fusion-harness/db";
import { artifactCreateRequestSchema, formatEntityId } from "@fusion-harness/shared";
import { Hono } from "hono";
import type { AppBindings } from "../env";
import { requireAccessIdentity } from "../services/auth";

export const artifactRoutes = new Hono<AppBindings>()
  .get("/runs/:runId", async (c) => {
    const principal = requireAccessIdentity(c.req.raw.headers);
    return c.json({ data: await listArtifactsByRun(c.env.DB, principal.orgId, c.req.param("runId")) });
  })
  .post("/", async (c) => {
    const principal = requireAccessIdentity(c.req.raw.headers);
    const payload = artifactCreateRequestSchema.parse(await c.req.json());

    const artifact = await createArtifact(c.env.DB, {
      id: formatEntityId("artifact", crypto.randomUUID()),
      orgId: principal.orgId,
      runId: payload.runId,
      kind: payload.kind,
      objectKey: payload.objectKey,
      contentType: payload.contentType,
      sizeBytes: payload.sizeBytes,
      sha256: payload.sha256,
      createdAt: new Date().toISOString(),
    });

    return c.json(artifact, 201);
  })
  .get("/:id", async (c) => {
    const principal = requireAccessIdentity(c.req.raw.headers);
    const artifact = await getArtifact(c.env.DB, principal.orgId, c.req.param("id"));

    if (!artifact) {
      return c.json({ error: "Artifact not found" }, 404);
    }

    if (c.req.query("download") !== "1") {
      return c.json(artifact);
    }

    if (!c.env.ARTIFACTS) {
      return c.json({ error: "Artifact storage not configured" }, 503);
    }

    const object = await c.env.ARTIFACTS.get(artifact.objectKey);
    if (!object) {
      return c.json({ error: "Artifact object not found" }, 404);
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("content-type", artifact.contentType ?? headers.get("content-type") ?? "application/octet-stream");

    return new Response(object.body, { headers });
  });
