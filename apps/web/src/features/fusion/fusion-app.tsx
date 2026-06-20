"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { FusionComposer } from "./fusion-composer";
import { ModelPicker } from "./model-picker";
import { Sidebar } from "./sidebar";
import { TopNav } from "./top-nav";
import type { FusionChat, FusionMode, ModelOption } from "./types";
import { apiDelete, apiPost, apiUrl } from "@/lib/api";

type FusionAppProps = {
  models: ModelOption[];
};

const modeToPreset: Record<FusionMode, string | undefined> = {
  quality: "mixed-coding",
  budget: "fast",
  custom: undefined,
};

export function FusionApp({ models }: FusionAppProps) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<FusionMode>("custom");
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const [fuseModelId, setFuseModelId] = useState<string | null>(null);
  const [chats, setChats] = useState<FusionChat[]>([]);
  const [chatsLoading, setChatsLoading] = useState(true);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [fusePickerOpen, setFusePickerOpen] = useState(false);

  const selectedModels = models.filter((m) => selectedModelIds.includes(m.id));
  const fuseModel = models.find((m) => m.id === fuseModelId) ?? null;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(apiUrl("/api/fusion/runs?limit=30"), {
          headers: {
            "x-fusion-dev-email": "developer@fusion.local",
            "x-fusion-dev-name": "Fusion Developer",
          },
        });
        if (!res.ok || cancelled) return;
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
        // ignore
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
    if (!prompt.trim() || selectedModelIds.length === 0 || sending) return;

    setSending(true);
    setError(null);
    try {
      const result = await apiPost<{ id: string }>("/api/fusion/runs", {
        mode: "auto",
        preset: modeToPreset[mode],
        permissionProfile: "readonly",
        providerPolicy: "manual",
        analysisModels: selectedModelIds,
        judgeModel: fuseModelId ?? undefined,
        messages: [{ role: "user", content: prompt }],
        stream: true,
      });
      router.push(`/runs/${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create run");
      setSending(false);
    }
  }, [prompt, selectedModelIds, sending, mode, fuseModelId, router]);

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
          onNewFusion={handleNewFusion}
          onSelectChat={handleSelectChat}
          onDeleteChat={handleDeleteChat}
          onRenameChat={handleRenameChat}
        />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[680px] px-6 pb-12">
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
              error={error}
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
