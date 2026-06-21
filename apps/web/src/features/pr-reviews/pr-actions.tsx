"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  RiCheckLine,
  RiCloseLine,
  RiPlayLine,
  RiRefreshLine,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { apiUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

type AdapterId =
  | "opencode"
  | "claude"
  | "codex"
  | "cursor-agent"
  | "gemini"
  | "qwen"
  | "qoder"
  | "copilot"
  | "deepseek"
  | "kimi"
  | "hermes"
  | "pi"
  | "aider"
  | "devin"
  | "grok-build"
  | "amp"
  | "kiro"
  | "kilo"
  | "vibe";

const ADAPTER_LABELS: Record<AdapterId, string> = {
  opencode: "OpenCode",
  claude: "Claude Code",
  codex: "Codex",
  "cursor-agent": "Cursor Agent",
  gemini: "Gemini CLI",
  qwen: "Qwen",
  qoder: "Qoder",
  copilot: "GitHub Copilot",
  deepseek: "DeepSeek",
  kimi: "Kimi",
  hermes: "Hermes",
  pi: "Pi Agent",
  aider: "Aider",
  devin: "Devin",
  "grok-build": "Grok Build",
  amp: "Amp",
  kiro: "Kiro",
  kilo: "Kilo",
  vibe: "Mistral Vibe",
};

type ModelOption = {
  id: string;
  label: string;
  provider: string;
  adapter: string;
};

type ModelsResponse = {
  aliases: Array<{ id: string; owned_by: string }>;
  data: Array<{
    id: string;
    adapter: string;
    provider: string;
    model: string;
    displayName: string;
    runnerId?: string;
  }>;
};

type RunnersResponse = {
  data: Array<{
    id: string;
    name: string;
    status: string;
    capabilities: { adapters: AdapterId[] };
  }>;
};

const REVIEW_MODES = [
  { value: "quick", label: "Quick" },
  { value: "standard", label: "Standard" },
  { value: "deep", label: "Deep" },
  { value: "security", label: "Security" },
] as const;

export function PrActions({ prId, status }: { prId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [adapter, setAdapter] = useState<AdapterId>("codex");
  const [model, setModel] = useState("default");
  const [reviewMode, setReviewMode] = useState<"quick" | "standard" | "deep" | "security">("standard");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [availableAdapters, setAvailableAdapters] = useState<AdapterId[]>([]);

  useEffect(() => {
    Promise.all([
      fetch(apiUrl("/api/models"), { credentials: "include" }).then((r) => r.json() as Promise<ModelsResponse>),
      fetch(apiUrl("/api/runners"), { credentials: "include" }).then((r) => r.json() as Promise<RunnersResponse>),
    ])
      .then(([modelData, runnerData]) => {
        const onlineRunners = (runnerData.data ?? []).filter((r) => r.status === "online");
        const adapterSet = new Set<AdapterId>();
        for (const r of onlineRunners) {
          for (const a of r.capabilities?.adapters ?? []) {
            adapterSet.add(a);
          }
        }
        const adapters = Array.from(adapterSet);
        setAvailableAdapters(adapters);

        const dbModels: ModelOption[] = (modelData.data ?? []).map((m) => ({
          id: m.model,
          label: m.displayName || m.model,
          provider: m.provider,
          adapter: m.adapter,
        }));
        setModels(dbModels);

        if (adapters.length > 0 && !adapters.includes(adapter)) {
          setAdapter(adapters[0]);
        }
      })
      .catch(() => {});
  }, [adapter]);

  const filteredModels = useMemo(() => {
    const matching = models.filter((m) => m.adapter === adapter);
    if (matching.length > 0) {
      return matching;
    }
    return [{ id: "default", label: "Default (CLI config)", provider: "", adapter }];
  }, [models, adapter]);
  const selectedModel = filteredModels.some((m) => m.id === model) ? model : (filteredModels[0]?.id ?? "default");

  const adapterOptions = useMemo(() => {
    if (availableAdapters.length > 0) {
      return availableAdapters.map((id) => [id, ADAPTER_LABELS[id]] as [AdapterId, string]);
    }
    return Object.entries(ADAPTER_LABELS) as [AdapterId, string][];
  }, [availableAdapters]);

  async function action(name: string, path: string, method = "POST") {
    setBusy(name);
    try {
      await fetch(apiUrl(`/api/pr-reviews/${prId}/${path}`), { method, credentials: "include" });
      router.refresh();
    } catch {
      // ignore
    } finally {
      setBusy(null);
    }
  }

  async function handleStart() {
    setBusy("start");
    try {
      const res = await fetch(apiUrl(`/api/pr-reviews/${prId}/start`), {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ adapter, model: selectedModel, reviewMode }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error("Start review failed:", body);
      }
      router.refresh();
    } catch {
      // ignore
    } finally {
      setBusy(null);
    }
  }

  const canStart =
    status === "not_assigned" ||
    status === "assigned" ||
    status === "stale" ||
    status === "failed";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canStart ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-0.5">
            <select
              value={adapter}
              onChange={(e) => {
                const newAdapter = e.target.value as AdapterId;
                setAdapter(newAdapter);
                const first = models.find((m) => m.adapter === newAdapter);
                setModel(first?.id ?? "default");
              }}
              className="h-6 cursor-pointer bg-transparent px-2 text-xs font-medium outline-none"
              title="Provider (agent CLI)"
            >
              {adapterOptions.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            <div className="h-4 w-px bg-border" />
            <select
              value={selectedModel}
              onChange={(e) => setModel(e.target.value)}
              className="h-6 max-w-[160px] cursor-pointer bg-transparent px-2 text-xs outline-none"
              title="Model"
            >
              {filteredModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <div className="h-4 w-px bg-border" />
            <select
              value={reviewMode}
              onChange={(e) => setReviewMode(e.target.value as typeof reviewMode)}
              className="h-6 cursor-pointer bg-transparent px-2 text-xs outline-none"
              title="Review depth"
            >
              {REVIEW_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <Button onClick={handleStart} disabled={busy !== null} variant="default" size="sm">
            <RiPlayLine aria-hidden className="size-4" />
            {busy === "start" ? "Starting..." : "Start Review"}
          </Button>
        </div>
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
        credentials: "include",
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
        credentials: "include",
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
        credentials: "include",
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
