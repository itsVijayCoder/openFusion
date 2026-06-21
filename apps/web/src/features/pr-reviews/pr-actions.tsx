"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  RiCheckLine,
  RiCloseLine,
  RiPlayLine,
  RiRefreshLine,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { apiUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

export function PrActions({ prId, status }: { prId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function action(name: string, path: string, method = "POST") {
    setBusy(name);
    try {
      await fetch(apiUrl(`/api/pr-reviews/${prId}/${path}`), { method });
      router.refresh();
    } catch {
      // ignore
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "assigned" || status === "stale" || status === "failed" ? (
        <Button
          onClick={() => action("start", "start", "POST")}
          disabled={busy !== null}
          variant="default"
          size="sm"
        >
          <RiPlayLine aria-hidden className="size-4" />
          {busy === "start" ? "Starting..." : "Start Review"}
        </Button>
      ) : null}
      <Button
        onClick={() => action("sync", "sync", "POST")}
        disabled={busy !== null}
        variant="outline"
        size="sm"
      >
        <RiRefreshLine aria-hidden className={cn("size-4", busy === "sync" && "animate-spin")} />
        {busy === "sync" ? "Syncing..." : "Sync"}
      </Button>
      {status !== "reviewed" && status !== "ignored" ? (
        <Button
          onClick={() => action("reviewed", "mark-reviewed", "POST")}
          disabled={busy !== null}
          variant="ghost"
          size="sm"
        >
          <RiCheckLine aria-hidden className="size-4" />
          Mark Reviewed
        </Button>
      ) : null}
      {status !== "ignored" ? (
        <Button
          onClick={() => action("ignore", "ignore", "POST")}
          disabled={busy !== null}
          variant="ghost"
          size="sm"
        >
          <RiCloseLine aria-hidden className="size-4" />
          Ignore
        </Button>
      ) : null}
    </div>
  );
}

export function PublishButton({ prId }: { prId: string }) {
  const router = useRouter();
  const [publishing, setPublishing] = useState(false);
  const [decision, setDecision] = useState<"COMMENT" | "REQUEST_CHANGES" | "APPROVE">("COMMENT");

  async function handlePublish() {
    setPublishing(true);
    try {
      await fetch(apiUrl(`/api/pr-reviews/${prId}/publish`), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event: decision }),
      });
      router.refresh();
    } catch {
      // ignore
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={decision}
        onChange={(e) => setDecision(e.target.value as typeof decision)}
        className="h-7 rounded-md border border-border bg-background px-2 text-sm"
      >
        <option value="COMMENT">Comment</option>
        <option value="REQUEST_CHANGES">Request Changes</option>
        <option value="APPROVE">Approve</option>
      </select>
      <Button onClick={handlePublish} disabled={publishing} variant="default" size="sm">
        {publishing ? "Publishing..." : "Publish"}
      </Button>
    </div>
  );
}

export function CommentEditor({
  commentId,
  initialBody,
  prId,
}: {
  commentId: string;
  initialBody: string;
  prId: string;
}) {
  const router = useRouter();
  const [body, setBody] = useState(initialBody);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await fetch(apiUrl(`/api/pr-reviews/${prId}/comments/${commentId}`), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      });
      setEditing(false);
      router.refresh();
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }

  async function handleResolve() {
    setSaving(true);
    try {
      await fetch(apiUrl(`/api/pr-reviews/${prId}/comments/${commentId}/resolve`), {
        method: "POST",
      });
      router.refresh();
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-start justify-between gap-2">
        <p className="flex-1 text-sm text-muted-foreground">{body}</p>
        <div className="flex shrink-0 gap-1">
          <Button onClick={() => setEditing(true)} variant="ghost" size="xs">
            Edit
          </Button>
          <Button onClick={handleResolve} disabled={saving} variant="ghost" size="xs">
            Reject
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        className="w-full rounded-md border border-border bg-background p-2 text-sm"
      />
      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={saving} variant="default" size="xs">
          {saving ? "Saving..." : "Save"}
        </Button>
        <Button onClick={() => { setBody(initialBody); setEditing(false); }} variant="ghost" size="xs">
          Cancel
        </Button>
      </div>
    </div>
  );
}