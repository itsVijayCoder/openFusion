"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RiRefreshLine, RiAddLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { apiUrl } from "@/lib/api";

export function GitHubActions() {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);

  async function handleSync() {
    setSyncing(true);
    try {
      await fetch(apiUrl("/api/github/sync"), { method: "POST" });
      router.refresh();
    } catch {
      // ignore
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Button onClick={handleSync} disabled={syncing} variant="default" size="sm">
      <RiRefreshLine aria-hidden className={`size-4 ${syncing ? "animate-spin" : ""}`} />
      {syncing ? "Syncing..." : "Sync"}
    </Button>
  );
}

export function RepoLinkButton({ repoId, workspaceId }: { repoId: string; workspaceId: string }) {
  const router = useRouter();
  const [linking, setLinking] = useState(false);

  async function handleLink() {
    setLinking(true);
    try {
      await fetch(apiUrl(`/api/github/repositories/${repoId}/link-workspace`), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      router.refresh();
    } catch {
      // ignore
    } finally {
      setLinking(false);
    }
  }

  return (
    <Button onClick={handleLink} disabled={linking} variant="outline" size="xs">
      {linking ? "Linking..." : "Link"}
    </Button>
  );
}

export function UserLinkForm({ userId }: { userId: string }) {
  const router = useRouter();
  const [githubLogin, setGithubLogin] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!githubLogin.trim()) return;
    setSubmitting(true);
    try {
      await fetch(apiUrl("/api/github/user-links"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, githubLogin: githubLogin.trim() }),
      });
      setGithubLogin("");
      router.refresh();
    } catch {
      // ignore
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <input
        type="text"
        value={githubLogin}
        onChange={(e) => setGithubLogin(e.target.value)}
        placeholder="GitHub login"
        className="h-7 rounded-md border border-border bg-background px-2 text-sm"
      />
      <Button type="submit" disabled={submitting || !githubLogin.trim()} variant="secondary" size="xs">
        <RiAddLine aria-hidden className="size-3" />
        Add
      </Button>
    </form>
  );
}