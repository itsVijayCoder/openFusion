import {
  createAuditEvent,
  getGitHubPullRequest,
  getGitHubRepository,
  getPrReviewDetail,
  getPrReviewQueue,
  listGitHubPullRequests,
  listPrReviewComments,
  listPrReviewCommentsByRun,
  updateGitHubPullRequestStatus,
  updatePrReviewComment,
} from "@fusion-harness/db";
import {
  formatEntityId,
  gitHubPrStatusSchema,
  prReviewCommentUpdateSchema,
  prReviewPublishSchema,
  prReviewQueueQuerySchema,
  prReviewStartSchema,
  type PrReviewSide,
} from "@fusion-harness/shared";
import { Hono } from "hono";
import type { AppBindings } from "../env";
import { requireAccessIdentity } from "../services/auth";
import { fetchAndStorePrDiff, fetchFileContent, getStoredPrDiff } from "../services/github-diff";
import { PrReviewError, startPrReview } from "../services/pr-review-execution";
import { PublishError, publishPrReview } from "../services/pr-review-publish";
import { syncPullRequestsForRepository } from "../services/github-sync";

export const prReviewRoutes = new Hono<AppBindings>()
  .get("/", async (c) => {
    const principal = await requireAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    const query = prReviewQueueQuerySchema.parse({
      ...c.req.query(),
      limit: c.req.query("limit") ?? 50,
    });

    const items = await getPrReviewQueue(c.env.DB, principal.orgId, {
      status: query.status,
      repoId: query.repoId,
      limit: query.limit,
    });

    return c.json({ data: items });
  })
  .get("/:prId", async (c) => {
    const principal = await requireAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    const detail = await getPrReviewDetail(c.env.DB, principal.orgId, c.req.param("prId"));

    if (!detail) {
      return c.json({ error: "Pull request not found" }, 404);
    }

    return c.json(detail);
  })
  .post("/:prId/sync", async (c) => {
    const principal = await requireAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    const prId = c.req.param("prId");

    const pr = await getGitHubPullRequest(c.env.DB, principal.orgId, prId);
    if (!pr) {
      return c.json({ error: "Pull request not found" }, 404);
    }

    const repo = await getGitHubRepository(c.env.DB, principal.orgId, pr.repoId);
    if (!repo) {
      return c.json({ error: "Repository not found" }, 404);
    }

    const count = await syncPullRequestsForRepository(c.env, principal.orgId, repo);

    await createAuditEvent(c.env.DB, {
      id: formatEntityId("audit", crypto.randomUUID()),
      orgId: principal.orgId,
      userId: principal.userId,
      eventType: "github.pr_synced",
      metadata: { prId, repoFullName: repo.fullName, prNumber: pr.number, syncedCount: count },
      createdAt: new Date().toISOString(),
    });

    return c.json({ status: "synced", pullRequests: count }, 202);
  })
  .post("/:prId/mark-reviewed", async (c) => {
    const principal = await requireAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    const prId = c.req.param("prId");
    const now = new Date().toISOString();

    const pr = await getGitHubPullRequest(c.env.DB, principal.orgId, prId);
    if (!pr) {
      return c.json({ error: "Pull request not found" }, 404);
    }

    const updated = await updateGitHubPullRequestStatus(c.env.DB, principal.orgId, prId, "reviewed", now);

    await createAuditEvent(c.env.DB, {
      id: formatEntityId("audit", crypto.randomUUID()),
      orgId: principal.orgId,
      userId: principal.userId,
      eventType: "github.pr_marked_reviewed",
      metadata: { prId, prNumber: pr.number, headSha: pr.headSha },
      createdAt: now,
    });

    return c.json(updated);
  })
  .post("/:prId/ignore", async (c) => {
    const principal = await requireAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    const prId = c.req.param("prId");
    const now = new Date().toISOString();

    const pr = await getGitHubPullRequest(c.env.DB, principal.orgId, prId);
    if (!pr) {
      return c.json({ error: "Pull request not found" }, 404);
    }

    const updated = await updateGitHubPullRequestStatus(c.env.DB, principal.orgId, prId, "ignored", now);

    await createAuditEvent(c.env.DB, {
      id: formatEntityId("audit", crypto.randomUUID()),
      orgId: principal.orgId,
      userId: principal.userId,
      eventType: "github.pr_ignored",
      metadata: { prId, prNumber: pr.number },
      createdAt: now,
    });

    return c.json(updated);
  })
  .post("/:prId/start", async (c) => {
    const principal = await requireAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    const body = prReviewStartSchema.parse(await c.req.json().catch(() => ({})));
    try {
      const reviewRun = await startPrReview(c.env, principal, c.req.param("prId"), {
        reviewMode: body.reviewMode,
        runnerId: body.runnerId,
        adapter: body.adapter,
        model: body.model,
      });
      return c.json(reviewRun, 202);
    } catch (error) {
      if (error instanceof PrReviewError) {
        return c.json({ error: error.message }, error.statusCode);
      }
      throw error;
    }
  })
  .get("/:prId/diff", async (c) => {
    const principal = await requireAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    const prId = c.req.param("prId");
    const refresh = c.req.query("refresh") === "1";

    if (!refresh) {
      const stored = await getStoredPrDiff(c.env, principal.orgId, prId);
      if (stored) {
        return c.json(stored);
      }
    }

    const snapshot = await fetchAndStorePrDiff(c.env, principal.orgId, prId);
    return c.json(snapshot);
  })
  .get("/:prId/diff/files/content", async (c) => {
    const principal = await requireAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    const prId = c.req.param("prId");
    const filename = c.req.query("filename");
    const side = c.req.query("side") as PrReviewSide;

    if (!filename || (side !== "LEFT" && side !== "RIGHT")) {
      return c.json({ error: "filename and side (LEFT or RIGHT) query params are required" }, 400);
    }

    const content = await fetchFileContent(c.env, principal.orgId, prId, filename, side);
    return c.json(content);
  })
  .get("/:prId/comments", async (c) => {
    const principal = await requireAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    return c.json({ data: await listPrReviewComments(c.env.DB, principal.orgId, c.req.param("prId")) });
  })
  .patch("/:prId/comments/:commentId", async (c) => {
    const principal = await requireAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    const commentId = c.req.param("commentId");
    const body = prReviewCommentUpdateSchema.parse(await c.req.json());
    const now = new Date().toISOString();

    const comment = await updatePrReviewComment(c.env.DB, {
      orgId: principal.orgId,
      commentId,
      body: body.body,
      suggestedChange: body.suggestedChange ?? undefined,
      severity: body.severity,
      category: body.category,
      startLine: body.startLine ?? undefined,
      line: body.line ?? undefined,
      side: body.side,
      status: body.status,
      editedByUserId: principal.userId,
      now,
    });

    if (!comment) {
      return c.json({ error: "Comment not found" }, 404);
    }

    await createAuditEvent(c.env.DB, {
      id: formatEntityId("audit", crypto.randomUUID()),
      orgId: principal.orgId,
      userId: principal.userId,
      eventType: "pr_review.comment_updated",
      metadata: { commentId, prId: c.req.param("prId"), changes: body },
      createdAt: now,
    });

    return c.json(comment);
  })
  .post("/:prId/comments/:commentId/resolve", async (c) => {
    const principal = await requireAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    const commentId = c.req.param("commentId");
    const now = new Date().toISOString();

    const comment = await updatePrReviewComment(c.env.DB, {
      orgId: principal.orgId,
      commentId,
      status: "rejected",
      editedByUserId: principal.userId,
      now,
    });

    if (!comment) {
      return c.json({ error: "Comment not found" }, 404);
    }

    return c.json(comment);
  })
  .get("/:prId/runs/:runId/comments", async (c) => {
    const principal = await requireAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    return c.json({
      data: await listPrReviewCommentsByRun(c.env.DB, principal.orgId, c.req.param("runId")),
    });
  })
  .post("/:prId/publish", async (c) => {
    const principal = await requireAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    const body = prReviewPublishSchema.parse(await c.req.json().catch(() => ({})));
    const result = await publishPrReview(c.env, principal, {
      prId: c.req.param("prId"),
      commentIds: body.commentIds,
      decision: body.decision,
      event: body.event,
      body: body.body,
    });
    return c.json(result, 200);
  })
  .get("/statuses/values", async (c) => {
    return c.json({
      data: gitHubPrStatusSchema.options,
    });
  });

prReviewRoutes.onError((error, c) => {
  if (error instanceof PrReviewError) {
    return c.json({ error: error.message }, error.statusCode);
  }
  if (error instanceof PublishError) {
    return c.json({ error: error.message }, error.statusCode);
  }
  throw error;
});
