"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { RiRefreshLine, RiAddLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { apiUrl } from "@/lib/api";

export function GitHubActions() {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);

  async function handleSync() {
    setSyncing(true);
    try {
      await fetch(apiUrl("/api/github/sync"), { method: "POST", credentials: "include" });
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
        credentials: "include",
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

export function UserLinkForm() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | undefined>();
  const [githubLogin, setGithubLogin] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(apiUrl("/api/auth/me"), { credentials: "include" })
      .then((response) => response.json())
      .then((body) => {
        const nextUserId = (body as { user?: { userId?: string } | null }).user?.userId;
        setUserId(nextUserId);
      })
      .catch(() => undefined);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!githubLogin.trim() || !userId) return;
    setSubmitting(true);
    try {
      await fetch(apiUrl("/api/github/user-links"), {
        method: "POST",
        credentials: "include",
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
      <Button type="submit" disabled={submitting || !githubLogin.trim() || !userId} variant="secondary" size="xs">
        <RiAddLine aria-hidden className="size-3" />
        Add
      </Button>
    </form>
  );
}
