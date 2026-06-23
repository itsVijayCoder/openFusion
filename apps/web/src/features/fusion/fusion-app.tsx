"use client";

import type { ModelRef } from "@fusion-harness/shared";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { FusionComposer } from "./fusion-composer";
import { ModelPicker } from "./model-picker";
import { Sidebar } from "./sidebar";
import { TopNav } from "./top-nav";
import type { FusionChat, FusionMode, ModelOption } from "./types";
import { toModelOption } from "./types";
import { apiDelete, apiPost, apiUrl, devHeaders } from "@/lib/api";

type FusionAppProps = {
  models?: ModelOption[];
};

type ModelInventoryResponse = {
  data: ModelRef[];
};

const modeToPreset: Record<FusionMode, string | undefined> = {
  quality: "mixed-coding",
  budget: "fast",
  custom: undefined,
};

export function FusionApp({ models: initialModels = [] }: FusionAppProps) {
  const router = useRouter();
  const [models, setModels] = useState<ModelOption[]>(initialModels);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<FusionMode>("custom");
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const [fuseModelId, setFuseModelId] = useState<string | null>(null);
  const [chats, setChats] = useState<FusionChat[]>([]);
  const [chatsLoading, setChatsLoading] = useState(true);
  const [chatsError, setChatsError] = useState<string | null>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [fusePickerOpen, setFusePickerOpen] = useState(false);

  const selectedModels = models.filter((m) => selectedModelIds.includes(m.id) && m.available);
  const fuseModel = models.find((m) => m.id === fuseModelId && m.available) ?? null;

  useEffect(() => {
    let cancelled = false;

    async function loadModels() {
      try {
        const res = await fetch(apiUrl("/api/models"), {
          cache: "no-store",
          credentials: "include",
          headers: devHeaders(),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `API returned ${res.status}`);
        }
        const body = (await res.json()) as ModelInventoryResponse;
        if (!cancelled) {
          setModels(body.data.map(toModelOption));
          setModelsError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setModelsError(err instanceof Error ? err.message : "Unable to load models");
        }
      } finally {
        if (!cancelled) setModelsLoading(false);
      }
    }

    void loadModels();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(apiUrl("/api/fusion/runs?limit=30"), {
          cache: "no-store",
          credentials: "include",
          headers: devHeaders(),
        });
        if (cancelled) return;
        if (!res.ok) {
          if (!cancelled) setChatsError(res.status === 401 ? "Sign in to load previous fusions" : `Failed to load (${res.status})`);
          return;
        }
        const body = (await res.json()) as { data?: Array<{ id: string; title?: string; status: string; createdAt: string }> };
        if (cancelled || !Array.isArray(body.data)) return;
        setChats(
          body.data.map((run) => ({
            id: run.id,
            title: run.title ?? run.id,
            status: run.status,
            createdAt: run.createdAt,
          })),
        );
      } catch {
        if (!cancelled) setChatsError("Unable to reach API");
      } finally {
        if (!cancelled) setChatsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggleModel = useCallback((modelId: string) => {
    setSelectedModelIds((current) =>
      current.includes(modelId)
        ? current.filter((id) => id !== modelId)
        : [...current, modelId],
    );
  }, []);

  const handleRemoveModel = useCallback((modelId: string) => {
    setSelectedModelIds((current) => current.filter((id) => id !== modelId));
  }, []);

  const handleSend = useCallback(async () => {
    const runnableModels = models.filter((model) => selectedModelIds.includes(model.id) && model.available);
    const runnableFuseModel = models.find((model) => model.id === fuseModelId && model.available);
    if (!prompt.trim() || runnableModels.length === 0 || sending) return;

    setSending(true);
    setError(null);
    try {
      const result = await apiPost<{ id: string }>("/api/fusion/runs", {
        mode: "auto",
        preset: modeToPreset[mode],
        permissionProfile: "readonly",
        providerPolicy: "manual",
        analysisModels: runnableModels.map((model) => model.id),
        judgeModel: runnableFuseModel?.id,
        messages: [{ role: "user", content: prompt }],
        stream: true,
      });
      router.push(`/runs/${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create run");
      setSending(false);
    }
  }, [prompt, models, selectedModelIds, sending, mode, fuseModelId, router]);

  const handleNewFusion = useCallback(() => {
    setPrompt("");
    setActiveChatId(null);
    setError(null);
  }, []);

  const handleSelectChat = useCallback(
    (chatId: string) => {
      setActiveChatId(chatId);
      router.push(`/runs/${chatId}`);
    },
    [router],
  );

  const handleDeleteChat = useCallback(
    async (chatId: string) => {
      if (!window.confirm("Delete this run history and artifacts? Running work will be stopped first.")) return;
      try {
        await apiDelete<{ status: string }>(`/api/fusion/runs/${chatId}`);
        setChats((current) => current.filter((chat) => chat.id !== chatId));
        if (activeChatId === chatId) {
          setActiveChatId(null);
          router.push("/chat");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete run");
      }
    },
    [activeChatId, router],
  );

  const handleRenameChat = useCallback(async (chatId: string, title: string) => {
    try {
      const run = await apiPost<{ id: string; title?: string }>(`/api/fusion/runs/${chatId}/rename`, { title });
      const nextTitle = run.title ?? title;
      setChats((current) =>
        current.map((chat) => (chat.id === chatId ? { ...chat, title: nextTitle } : chat)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename run");
      throw err;
    }
  }, []);

  return (
    <div className="flex h-[100dvh] flex-col bg-background text-foreground">
      <TopNav />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          chats={chats}
          activeChatId={activeChatId}
          loading={chatsLoading}
          error={chatsError}
          onNewFusion={handleNewFusion}
          onSelectChat={handleSelectChat}
          onDeleteChat={handleDeleteChat}
          onRenameChat={handleRenameChat}
        />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[680px] px-6 pb-12">
            {modelsLoading ? (
              <div className="mt-6 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                Loading signed-in local models...
              </div>
            ) : null}
            <FusionComposer
              prompt={prompt}
              mode={mode}
              selectedModels={selectedModels}
              fuseModel={fuseModel}
              onPromptChange={setPrompt}
              onModeChange={setMode}
              onRemoveModel={handleRemoveModel}
              onAddModel={() => setPickerOpen(true)}
              onPickFuseModel={() => setFusePickerOpen(true)}
              onSend={handleSend}
              sending={sending}
              error={error ?? modelsError}
            />
          </div>
        </main>
      </div>
      {pickerOpen ? (
        <ModelPicker
          models={models}
          selectedIds={selectedModelIds}
          onToggle={handleToggleModel}
          onClose={() => setPickerOpen(false)}
          title="Select Panel Models"
        />
      ) : null}
      {fusePickerOpen ? (
        <ModelPicker
          models={models}
          selectedIds={[]}
          onToggle={() => {}}
          onClose={() => setFusePickerOpen(false)}
          title="Select Fuse Model"
          single
          selectedSingleId={fuseModelId}
          onPickSingle={(id) => {
            setFuseModelId(id);
            setFusePickerOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
