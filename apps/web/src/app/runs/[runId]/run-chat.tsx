"use client";

import { extractReadableOutput, type FusionRunDetail, type RunEvent, type RunStatus } from "@fusion-harness/shared";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  RiArrowDownSLine,
  RiArrowRightLine,
  RiArrowUpLine,
  RiCheckLine,
  RiCloseLine,
  RiErrorWarningLine,
  RiFileList3Line,
  RiHistoryLine,
  RiLayoutGridLine,
  RiDeleteBinLine,
  RiPauseLine,
  RiPencilLine,
  RiPlayLine,
  RiRobot2Line,
  RiStopLine,
  RiUserLine,
} from "@remixicon/react";
import { FinalOutputModal } from "@/components/final-output-modal";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { ModelBadge } from "@/components/model-badge";
import { OutputDrawer } from "@/components/output-drawer";
import { StatusPill } from "@/components/product-ui";
import { Sidebar } from "@/features/fusion/sidebar";
import { TopNav } from "@/features/fusion/top-nav";
import type { FusionChat } from "@/features/fusion/types";
import { apiDelete, apiPost, apiUrl } from "@/lib/api";
import { formatBytes, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import Link from "next/link";

type RunChatProps = {
  run: FusionRunDetail;
};

type PanelTrace = {
  jobId: string;
  modelId: string;
  adapter?: string;
  role?: string;
  status: "queued" | "running" | "completed" | "failed";
  text: string;
  error?: string;
};

type PhaseTrace = {
  status: "queued" | "running" | "completed" | "failed";
  text: string;
  error?: string;
};

type Trace = {
  panels: PanelTrace[];
  synthesis: PhaseTrace;
  final: PhaseTrace;
  runStatus: RunStatus;
};

type DrawerState = {
  title: string;
  subtitle?: string;
  status?: string;
  content: string;
  error?: string;
} | null;

type LifecycleAction = "pause" | "resume" | "cancel" | "delete";

export function RunChat({ run }: RunChatProps) {
  const router = useRouter();
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [connection, setConnection] = useState<"connecting" | "live" | "reconnecting" | "closed">("connecting");
  const [showDetails, setShowDetails] = useState(false);
  const [continueMessage, setContinueMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | undefined>(undefined);
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [showFinalModal, setShowFinalModal] = useState(false);
  const [judgeExpanded, setJudgeExpanded] = useState(false);
  const [lifecycleAction, setLifecycleAction] = useState<LifecycleAction | null>(null);
  const [chats, setChats] = useState<FusionChat[]>([]);
  const [chatsLoading, setChatsLoading] = useState(true);
  const [renamedTitle, setRenamedTitle] = useState<{ runId: string; title: string } | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleSaving, setTitleSaving] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const initialStatus = run.status;
  const messages = useMemo(() => run.messages ?? [], [run.messages]);
  const title = renamedTitle?.runId === run.id ? renamedTitle.title : (run.title ?? run.id);

  useEffect(() => {
    let socket: WebSocket | undefined;
    let isActive = true;

    async function loadSnapshot() {
      const response = await fetch(apiUrl(`/api/fusion/runs/${run.id}/events`), { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json().catch(() => ({}))) as { data?: RunEvent[] };
      if (isActive && Array.isArray(body.data)) {
        setEvents((current) => mergeEvents(current, body.data ?? []));
      }
    }

    function connect() {
      setConnection((current) => (current === "closed" ? "reconnecting" : current));
      socket = new WebSocket(toWebSocketUrl(apiUrl(`/api/fusion/runs/${run.id}/events`)));
      socket.addEventListener("open", () => {
        if (isActive) setConnection("live");
      });
      socket.addEventListener("message", (message) => {
        const parsed = parseSocketMessage(message.data);
        if (!parsed) return;
        setEvents((current) => mergeEvents(current, parsed));
      });
      socket.addEventListener("close", () => {
        if (!isActive) return;
        setConnection("closed");
        window.setTimeout(() => {
          if (isActive) connect();
        }, 2000);
      });
      socket.addEventListener("error", () => {
        if (isActive) setConnection("reconnecting");
      });
    }

    void loadSnapshot();
    connect();

    return () => {
      isActive = false;
      socket?.close();
    };
  }, [run.id]);

  useEffect(() => {
    let cancelled = false;
    async function loadChats() {
      try {
        const response = await fetch(apiUrl("/api/fusion/runs?limit=30"), {
          cache: "no-store",
          headers: {
            "x-fusion-dev-email": "developer@fusion.local",
            "x-fusion-dev-name": "Fusion Developer",
          },
        });
        if (!response.ok || cancelled) return;
        const body = (await response.json().catch(() => ({}))) as { data?: Array<{ id: string; title?: string; status: string; createdAt: string }> };
        if (cancelled || !Array.isArray(body.data)) return;
        setChats(
          body.data.map((item) => ({
            id: item.id,
            title: item.title ?? item.id,
            status: item.status,
            createdAt: item.createdAt,
          })),
        );
      } catch {
        // Keep the run detail usable even if the history request fails.
      } finally {
        if (!cancelled) setChatsLoading(false);
      }
    }
    void loadChats();
    return () => {
      cancelled = true;
    };
  }, []);

  const trace = useMemo(() => buildTrace(events, initialStatus), [events, initialStatus]);
  const finalText = trace.final.text || extractFinalOutput(trace.synthesis.text);
  const judgeText = extractJudgeAnalysisText(trace.synthesis.text);
  const currentStatus = trace.runStatus;
  const isRunActive = currentStatus === "queued" || currentStatus === "running" || currentStatus === "waiting_approval";
  const isRunInProgress = isRunActive || currentStatus === "paused";
  const showLiveOutput = finalText.trim().length > 0 || trace.final.status === "running";
  const showThinking = isRunActive && !showLiveOutput;
  const hasPanelOutputs = trace.panels.some((p) => p.text.trim().length > 0 || p.status === "running");
  const hasJudgeOutput = judgeText.trim().length > 0 || trace.synthesis.status !== "queued";
  const hasFinalOutput = finalText.trim().length > 0 || trace.final.status !== "queued";

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, finalText, showThinking, trace.panels.length, judgeExpanded]);

  async function handleContinue() {
    const message = continueMessage.trim();
    if (!message || isSending || isRunInProgress) return;

    setIsSending(true);
    setSendError(undefined);
    try {
      const result = await apiPost<{ id: string }>(`/api/fusion/runs/${run.id}/continue`, { message });
      router.push(`/runs/${result.id}`);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Failed to continue conversation");
      setIsSending(false);
    }
  }

  async function handleLifecycleAction(action: LifecycleAction) {
    if (lifecycleAction) return;
    if (action === "cancel" && !window.confirm("Stop this run and cancel the local agent process?")) return;
    if (action === "delete" && !window.confirm("Delete this run history and artifacts? Running work will be stopped first.")) return;

    setLifecycleAction(action);
    setSendError(undefined);
    try {
      if (action === "delete") {
        await apiDelete<{ status: string }>(`/api/fusion/runs/${run.id}`);
        router.push("/chat");
        return;
      }
      const endpoint = action === "cancel" ? "cancel" : action;
      await apiPost(`/api/fusion/runs/${run.id}/${endpoint}`, {});
    } catch (error) {
      setSendError(error instanceof Error ? error.message : `Failed to ${action} run`);
    } finally {
      setLifecycleAction(null);
    }
  }

  function handleNewFusion() {
    router.push("/chat");
  }

  function handleSelectChat(chatId: string) {
    setTitleEditing(false);
    setTitleDraft("");
    router.push(`/runs/${chatId}`);
  }

  async function handleDeleteChat(chatId: string) {
    if (!window.confirm("Delete this run history and artifacts? Running work will be stopped first.")) return;
    try {
      await apiDelete<{ status: string }>(`/api/fusion/runs/${chatId}`);
      setChats((current) => current.filter((chat) => chat.id !== chatId));
      if (chatId === run.id) {
        router.push("/chat");
      }
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Failed to delete run");
    }
  }

  async function renameChat(chatId: string, nextTitle: string) {
    const renamed = await apiPost<{ id: string; title?: string }>(`/api/fusion/runs/${chatId}/rename`, {
      title: nextTitle,
    });
    const resolvedTitle = renamed.title ?? nextTitle;
    setChats((current) =>
      current.map((chat) => (chat.id === chatId ? { ...chat, title: resolvedTitle } : chat)),
    );
    if (chatId === run.id) {
      setRenamedTitle({ runId: chatId, title: resolvedTitle });
      setTitleDraft(resolvedTitle);
    }
  }

  async function submitTitleRename() {
    const nextTitle = titleDraft.trim();
    if (!nextTitle || titleSaving) return;
    if (nextTitle === title) {
      setTitleEditing(false);
      return;
    }

    setTitleSaving(true);
    setSendError(undefined);
    try {
      await renameChat(run.id, nextTitle);
      setTitleEditing(false);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Failed to rename run");
    } finally {
      setTitleSaving(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleContinue();
    }
  }

  function openPanelDrawer(panel: PanelTrace) {
    setDrawer({
      title: panel.modelId,
      subtitle: [panel.adapter, panel.role].filter(Boolean).join(" · ") || "panel",
      status: panel.status,
      content: panel.text,
      error: panel.error,
    });
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-background text-foreground">
      <TopNav />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          chats={chats}
          activeChatId={run.id}
          loading={chatsLoading}
          onNewFusion={handleNewFusion}
          onSelectChat={handleSelectChat}
          onDeleteChat={(chatId) => void handleDeleteChat(chatId)}
          onRenameChat={renameChat}
        />
        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              {titleEditing ? (
                <form
                  className="flex min-w-0 flex-1 items-center gap-1.5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitTitleRename();
                  }}
                >
                  <input
                    value={titleDraft}
                    onChange={(event) => setTitleDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        setTitleDraft(title);
                        setTitleEditing(false);
                      }
                    }}
                    disabled={titleSaving}
                    autoFocus
                    maxLength={120}
                    className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm font-medium text-foreground outline-none focus:border-primary"
                  />
                  <button
                    type="submit"
                    aria-label="Save title"
                    title="Save title"
                    disabled={!titleDraft.trim() || titleSaving}
                    className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <RiCheckLine aria-hidden className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Cancel rename"
                    title="Cancel rename"
                    onClick={() => {
                      setTitleDraft(title);
                      setTitleEditing(false);
                    }}
                    className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <RiCloseLine aria-hidden className="size-4" />
                  </button>
                </form>
              ) : (
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-foreground">{title}</span>
                  <button
                    type="button"
                    aria-label="Rename chat"
                    title="Rename chat"
                    onClick={() => {
                      setTitleDraft(title);
                      setTitleEditing(true);
                    }}
                    className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <RiPencilLine aria-hidden className="size-3.5" />
                  </button>
                </div>
              )}
              <StatusPill value={currentStatus} />
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {run.mode} · {formatDateTime(run.createdAt)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "hidden h-6 items-center rounded-md border px-2 text-xs font-medium sm:inline-flex",
                  connection === "live"
                    ? "border-primary/20 bg-primary/10 text-primary"
                    : "border-border bg-muted text-muted-foreground",
                )}
              >
                {connection}
              </span>
              <RunLifecycleControls
                status={currentStatus}
                pendingAction={lifecycleAction}
                onAction={(action) => void handleLifecycleAction(action)}
              />
              <button
                type="button"
                onClick={() => setShowDetails(true)}
                className="flex h-8 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <RiLayoutGridLine aria-hidden className="size-4" />
                <span className="hidden sm:inline">Details</span>
              </button>
            </div>
          </header>

          <div ref={scrollRef} className="flex-1 overflow-y-auto">
            <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
              {messages.length > 0 ? (
                messages.map((message, index) => (
                  <MessageBubble key={index} role={message.role} content={message.content} />
                ))
              ) : (
                <div className="rounded-lg border border-dashed border-border bg-muted/30 p-8 text-center">
                  <p className="text-sm text-muted-foreground">Initial prompt not available for this run.</p>
                </div>
              )}

              {showThinking ? <ThinkingIndicator trace={trace} /> : null}

              {(hasPanelOutputs || hasJudgeOutput || hasFinalOutput || !isRunActive) && !showThinking ? (
                <SourcesSection
                  trace={trace}
                  finalText={finalText}
                  judgeText={judgeText}
                  judgeExpanded={judgeExpanded}
                  onToggleJudge={() => setJudgeExpanded((v) => !v)}
                  onOpenPanel={openPanelDrawer}
                  onOpenFinal={() => setShowFinalModal(true)}
                />
              ) : null}

              {!isRunActive && !showLiveOutput && currentStatus === "failed" ? (
                <MessageBubble
                  role="assistant"
                  content=""
                  error={run.error || "Run failed without producing output."}
                />
              ) : null}
            </div>
          </div>

          <div className="shrink-0 border-t border-border bg-background">
            <div className="mx-auto max-w-3xl px-4 py-3">
              {sendError ? <p className="mb-2 text-sm text-destructive">{sendError}</p> : null}
              <div className="flex items-end gap-2 rounded-xl border border-border bg-card p-2">
                <textarea
                  value={continueMessage}
                  onChange={(event) => setContinueMessage(event.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isRunInProgress || isSending}
                  placeholder={isRunInProgress ? (currentStatus === "paused" ? "Run is paused..." : "Waiting for run to complete...") : "Continue the conversation..."}
                  rows={1}
                  className="max-h-32 min-h-[2.5rem] flex-1 resize-none bg-transparent px-2 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => void handleContinue()}
                  disabled={isRunInProgress || isSending || !continueMessage.trim()}
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <RiArrowUpLine aria-hidden className="size-4" />
                </button>
              </div>
              <p className="mt-1.5 px-2 text-xs text-muted-foreground">
                {isRunInProgress
                  ? "Continue will be available once the run completes."
                  : "Press Enter to send, Shift+Enter for new line."}
              </p>
            </div>
          </div>
        </main>
      </div>

      {showFinalModal ? (
        <FinalOutputModal
          title="Final Output"
          subtitle="Fused result"
          status={trace.final.status}
          content={finalText}
          error={trace.final.error || trace.synthesis.error}
          onClose={() => setShowFinalModal(false)}
        />
      ) : null}

      {drawer ? (
        <OutputDrawer
          title={drawer.title}
          subtitle={drawer.subtitle}
          status={drawer.status}
          content={drawer.content}
          error={drawer.error}
          onClose={() => setDrawer(null)}
        />
      ) : null}

      {showDetails ? (
        <DetailsPanel run={run} onClose={() => setShowDetails(false)} />
      ) : null}
    </div>
  );
}

function RunLifecycleControls({
  status,
  pendingAction,
  onAction,
}: {
  status: RunStatus;
  pendingAction: LifecycleAction | null;
  onAction: (action: LifecycleAction) => void;
}) {
  const canPause = status === "queued" || status === "running" || status === "waiting_approval";
  const canResume = status === "paused";
  const canStop = canPause || canResume;
  const disabled = Boolean(pendingAction);

  return (
    <div className="flex items-center gap-1">
      {canResume ? (
        <LifecycleButton
          label={pendingAction === "resume" ? "Resuming" : "Resume"}
          icon={RiPlayLine}
          disabled={disabled}
          onClick={() => onAction("resume")}
        />
      ) : (
        <LifecycleButton
          label={pendingAction === "pause" ? "Pausing" : "Pause"}
          icon={RiPauseLine}
          disabled={!canPause || disabled}
          onClick={() => onAction("pause")}
        />
      )}
      <LifecycleButton
        label={pendingAction === "cancel" ? "Stopping" : "Stop"}
        icon={RiStopLine}
        disabled={!canStop || disabled}
        destructive
        onClick={() => onAction("cancel")}
      />
      <LifecycleButton
        label={pendingAction === "delete" ? "Deleting" : "Delete"}
        icon={RiDeleteBinLine}
        disabled={disabled}
        destructive
        onClick={() => onAction("delete")}
      />
    </div>
  );
}

function LifecycleButton({
  label,
  icon: Icon,
  disabled,
  destructive,
  onClick,
}: {
  label: string;
  icon: React.ElementType;
  disabled?: boolean;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40",
        destructive
          ? "border-destructive/30 text-destructive hover:bg-destructive/10"
          : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon aria-hidden className="size-4" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function MessageBubble({
  role,
  content,
  error,
  isStreaming,
}: {
  role: "user" | "assistant" | "system";
  content: string;
  error?: string;
  isStreaming?: boolean;
}) {
  const isUser = role === "user";
  const isSystem = role === "system";

  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      <div
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        {isUser ? <RiUserLine aria-hidden className="size-4" /> : <RiRobot2Line aria-hidden className="size-4" />}
      </div>
      <div
        className={cn(
          "min-w-0 max-w-[calc(100%-3rem)] rounded-2xl px-4 py-3 text-sm leading-6",
          isUser
            ? "rounded-tr-md bg-primary text-primary-foreground"
            : isSystem
              ? "rounded-tl-md bg-muted/50 text-muted-foreground italic"
              : "rounded-tl-md bg-muted text-foreground",
        )}
      >
        {error ? (
          <p className="break-words text-destructive [overflow-wrap:anywhere]">{error}</p>
        ) : content ? (
          <div className="break-words [overflow-wrap:anywhere]">
            {isUser ? (
              <div className="whitespace-pre-wrap">{content}</div>
            ) : (
              <MarkdownRenderer content={content} />
            )}
            {isStreaming ? (
              <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-foreground/60 align-middle" />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ThinkingIndicator({ trace }: { trace: Trace }) {
  const phase = currentPhaseLabel(trace);
  return (
    <div className="flex gap-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <RiRobot2Line aria-hidden className="size-4" />
      </div>
      <div className="flex items-center gap-2 rounded-2xl rounded-tl-md bg-muted px-4 py-3">
        <div className="flex gap-1">
          <span className="size-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms]" />
          <span className="size-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms]" />
          <span className="size-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms]" />
        </div>
        <span className="text-sm text-muted-foreground">{phase}</span>
      </div>
    </div>
  );
}

function currentPhaseLabel(trace: Trace): string {
  if (trace.panels.some((panel) => panel.status === "running")) {
    const completed = trace.panels.filter((panel) => panel.status === "completed").length;
    return `Panel phase (${completed}/${trace.panels.length} complete)`;
  }
  if (trace.synthesis.status === "running") return "Analyzing panel outputs";
  if (trace.final.status === "running") return "Generating response";
  return "Thinking";
}

type SourcesSectionProps = {
  trace: Trace;
  finalText: string;
  judgeText: string;
  judgeExpanded: boolean;
  onToggleJudge: () => void;
  onOpenPanel: (panel: PanelTrace) => void;
  onOpenFinal: () => void;
};

function SourcesSection({
  trace,
  finalText,
  judgeText,
  judgeExpanded,
  onToggleJudge,
  onOpenPanel,
  onOpenFinal,
}: SourcesSectionProps) {
  const hasPanels = trace.panels.length > 0;
  const hasJudge = judgeText.trim().length > 0 || trace.synthesis.status !== "queued";
  const hasFinal = finalText.trim().length > 0 || trace.final.status !== "queued";

  let stepCount = 0;
  if (hasPanels) stepCount++;
  if (hasJudge) stepCount++;
  if (hasFinal) stepCount++;

  let currentStep = 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <span className="rounded-md border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          SOURCES
        </span>
        <span className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
          {stepCount > 0 ? `Step 1/${stepCount}` : "Processing"}
        </span>
      </div>

      {hasPanels ? (
        <>
          {trace.panels.map((panel) => {
            currentStep++;
            return (
              <SourceRow
                key={panel.jobId}
                step={currentStep}
                title={panel.modelId}
                subtitle={[panel.adapter, panel.role].filter(Boolean).join(" · ") || "panel"}
                status={panel.status}
                adapter={panel.adapter}
                onClick={() => onOpenPanel(panel)}
              />
            );
          })}
        </>
      ) : null}

      {hasJudge ? (
        (() => {
          currentStep++;
          return (
            <JudgeAccordion
              step={currentStep}
              status={trace.synthesis.status}
              expanded={judgeExpanded}
              onToggle={onToggleJudge}
              text={judgeText}
              error={trace.synthesis.error}
            />
          );
        })()
      ) : null}

      {hasFinal ? (
        (() => {
          currentStep++;
          return (
            <SourceRow
              step={currentStep}
              title="Final Output"
              subtitle="Fused result"
              status={trace.final.status}
              onClick={onOpenFinal}
              isFinal
            />
          );
        })()
      ) : null}
    </div>
  );
}

function SourceRow({
  step,
  title,
  subtitle,
  status,
  adapter,
  isFinal,
  onClick,
}: {
  step: number;
  title: string;
  subtitle: string;
  status: string;
  adapter?: string;
  isFinal?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-colors duration-150 hover:border-foreground/10 hover:bg-muted/30"
    >
      <span className="flex size-5 shrink-0 items-center justify-center rounded-md border border-border text-[10px] font-semibold text-muted-foreground">
        {step}
      </span>
      {isFinal ? (
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
          <RiFileList3Line aria-hidden className="size-3.5" />
        </span>
      ) : (
        <ModelBadge adapter={adapter} modelId={title} size="sm" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-foreground">{title}</p>
        <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p>
      </div>
      <StatusPill value={status} />
      <RiArrowRightLine aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function JudgeAccordion({
  step,
  status,
  expanded,
  onToggle,
  text,
  error,
}: {
  step: number;
  status: string;
  expanded: boolean;
  onToggle: () => void;
  text: string;
  error?: string;
}) {
  const { jsonReport, markdownReport } = useMemo(() => splitJudgeContent(text), [text]);

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card transition-colors",
        expanded && "border-foreground/10",
      )}
    >
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
      >
        <span className="flex size-5 shrink-0 items-center justify-center rounded-md border border-border text-[10px] font-semibold text-muted-foreground">
          {step}
        </span>
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
          <RiRobot2Line aria-hidden className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-foreground">Judge / Synthesis</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {expanded ? "Tap to collapse" : "Detailed comparison report"}
          </p>
        </div>
        <StatusPill value={status} />
        <RiArrowDownSLine
          aria-hidden
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-150", expanded && "rotate-180")}
        />
      </button>
      {expanded ? (
        <div className="border-t border-border">
          <div className="max-h-[400px] overflow-y-auto px-4 py-3">
            {error ? (
              <p className="break-words text-sm text-destructive">{error}</p>
            ) : text.trim() ? (
              <div className="flex flex-col gap-4">
                {jsonReport ? (
                  <JudgeStructuredReport report={jsonReport} />
                ) : null}
                {markdownReport ? (
                  <MarkdownRenderer content={markdownReport} />
                ) : null}
                {!jsonReport && !markdownReport ? (
                  <MarkdownRenderer content={text} />
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Waiting for judge output.</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type JudgeReport = {
  consensus: string[];
  contradictions: Array<{ topic: string; details: string; recommended_resolution: string }>;
  missing_coverage: string[];
  unique_insights: Array<{ model: string; insight: string }>;
  risks: Array<{ risk: string; severity: string; mitigation: string }>;
  confidence: number;
  synthesis_strategy: string;
};

function splitJudgeContent(rawText: string): { jsonReport: JudgeReport | null; markdownReport: string } {
  const trimmed = rawText.trim();
  if (!trimmed) return { jsonReport: null, markdownReport: "" };

  const jsonStart = trimmed.indexOf("{");
  if (jsonStart < 0) return { jsonReport: null, markdownReport: trimmed };

  let braceDepth = 0;
  let jsonEnd = -1;
  for (let i = jsonStart; i < trimmed.length; i++) {
    if (trimmed[i] === "{") braceDepth++;
    else if (trimmed[i] === "}") {
      braceDepth--;
      if (braceDepth === 0) {
        jsonEnd = i;
        break;
      }
    }
  }

  if (jsonEnd < 0) return { jsonReport: null, markdownReport: trimmed };

  const jsonStr = trimmed.slice(jsonStart, jsonEnd + 1);
  const markdownStr = trimmed.slice(jsonEnd + 1).trim();

  let parsed: JudgeReport | null = null;
  try {
    parsed = JSON.parse(jsonStr) as JudgeReport;
  } catch {
    // If JSON parsing fails, treat the whole thing as markdown
    return { jsonReport: null, markdownReport: trimmed };
  }

  return { jsonReport: parsed, markdownReport: markdownStr };
}

function JudgeStructuredReport({ report }: { report: JudgeReport }) {
  return (
    <div className="flex flex-col gap-3">
      {report.confidence !== undefined ? (
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase text-muted-foreground">Confidence</span>
          <span className="text-sm font-medium text-primary">{(report.confidence * 100).toFixed(0)}%</span>
        </div>
      ) : null}

      {report.consensus?.length ? (
        <JudgeSection title="Consensus">
          <ul className="flex flex-col gap-1">
            {report.consensus.map((item, i) => (
              <li key={i} className="flex gap-2 text-sm text-foreground">
                <span className="text-primary">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </JudgeSection>
      ) : null}

      {report.contradictions?.length ? (
        <JudgeSection title="Contradictions">
          <div className="flex flex-col gap-2">
            {report.contradictions.map((item, i) => (
              <div key={i} className="rounded-lg border border-border bg-muted/30 p-2.5">
                <p className="text-sm font-medium text-foreground">{item.topic}</p>
                <p className="mt-1 text-sm text-muted-foreground">{item.details}</p>
                {item.recommended_resolution ? (
                  <p className="mt-1 text-sm text-primary">→ {item.recommended_resolution}</p>
                ) : null}
              </div>
            ))}
          </div>
        </JudgeSection>
      ) : null}

      {report.unique_insights?.length ? (
        <JudgeSection title="Unique Insights">
          <div className="flex flex-col gap-1.5">
            {report.unique_insights.map((item, i) => (
              <div key={i} className="flex gap-2 text-sm">
                <ModelBadge modelId={item.model} size="sm" />
                <div className="min-w-0">
                  <span className="font-medium text-foreground">{item.model}</span>
                  <span className="text-muted-foreground"> — {item.insight}</span>
                </div>
              </div>
            ))}
          </div>
        </JudgeSection>
      ) : null}

      {report.risks?.length ? (
        <JudgeSection title="Risks">
          <div className="flex flex-col gap-1.5">
            {report.risks.map((risk, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg border border-border p-2">
                <SeverityBadge severity={risk.severity} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">{risk.risk}</p>
                  {risk.mitigation ? (
                    <p className="mt-0.5 text-sm text-muted-foreground">Mitigation: {risk.mitigation}</p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </JudgeSection>
      ) : null}

      {report.missing_coverage?.length ? (
        <JudgeSection title="Missing Coverage">
          <ul className="flex flex-col gap-1">
            {report.missing_coverage.map((item, i) => (
              <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                <span className="text-muted-foreground">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </JudgeSection>
      ) : null}
    </div>
  );
}

function JudgeSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const normalized = severity.toLowerCase();
  const color =
    normalized === "high"
      ? "bg-red-500/15 text-red-400 border-red-500/30"
      : normalized === "medium"
        ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
        : "bg-green-500/15 text-green-400 border-green-500/30";
  return (
    <span className={cn("shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase", color)}>
      {normalized}
    </span>
  );
}

function DetailsPanel({
  run,
  onClose,
}: {
  run: FusionRunDetail;
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-border bg-card">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
          <h2 className="text-sm font-semibold text-foreground">Run Details</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <RiErrorWarningLine aria-hidden className="size-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex flex-col gap-6">
            <DetailSection title="Run Info">
              <DetailGrid
                items={[
                  { label: "Status", value: run.status },
                  { label: "Mode", value: run.mode },
                  { label: "Permission", value: run.permissionProfile },
                  { label: "Preset", value: run.preset ?? "None" },
                  { label: "Created", value: formatDateTime(run.createdAt) },
                  { label: "Started", value: formatDateTime(run.startedAt) },
                  { label: "Completed", value: formatDateTime(run.completedAt) },
                  ...(run.parentRunId ? [{ label: "Parent Run", value: run.parentRunId }] : []),
                  ...(run.conversationId ? [{ label: "Conversation", value: run.conversationId }] : []),
                ]}
              />
              {run.error ? (
                <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                  <RiErrorWarningLine aria-hidden className="mt-0.5 size-4 shrink-0" />
                  <span className="break-words">{run.error}</span>
                </div>
              ) : null}
            </DetailSection>

            <DetailSection title="Artifacts" icon={RiFileList3Line}>
              {run.artifacts.length ? (
                <div className="flex flex-col gap-2">
                  {run.artifacts.map((artifact) => (
                    <Link
                      key={artifact.id}
                      href={`/artifacts/${artifact.id}`}
                      className="flex items-center justify-between gap-2 rounded-md border border-border p-2 hover:bg-muted/50"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{artifact.kind}</p>
                        <p className="truncate text-xs text-muted-foreground">{artifact.objectKey}</p>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(artifact.sizeBytes)}</span>
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyDetail text="No artifacts yet." />
              )}
            </DetailSection>

            <DetailSection title="Audit History" icon={RiHistoryLine}>
              {run.auditEvents.length ? (
                <div className="flex flex-col gap-2">
                  {run.auditEvents.map((event) => (
                    <div key={event.id} className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-xs">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{event.eventType}</p>
                        <p className="text-muted-foreground">{formatDateTime(event.createdAt)}</p>
                      </div>
                      <StatusPill value={event.severity} />
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyDetail text="No audit events." />
              )}
            </DetailSection>
          </div>
        </div>
      </div>
    </>
  );
}

function DetailSection({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon?: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
        {Icon ? <Icon aria-hidden className="size-3.5" /> : null}
        {title}
      </h3>
      {children}
    </section>
  );
}

function DetailGrid({ items }: { items: Array<{ label: string; value: string }> }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map((item) => (
        <div key={item.label} className="rounded-md border border-border p-2">
          <p className="text-xs text-muted-foreground">{item.label}</p>
          <p className="mt-0.5 truncate text-sm font-medium text-foreground" title={item.value}>
            {item.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function EmptyDetail({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground">{text}</p>;
}

function buildTrace(events: RunEvent[], initialStatus: RunStatus): Trace {
  const panels = new Map<string, PanelTrace>();
  const synthesis: PhaseTrace = { status: "queued", text: "" };
  const final: PhaseTrace = { status: "queued", text: "" };
  let runStatus: RunStatus | null = null;

  for (const event of events) {
    const jobId = event.jobId ?? "";
    if (event.type === "panel.job.queued" && jobId) {
      panels.set(jobId, {
        jobId,
        modelId: stringData(event, "modelId") || jobId,
        adapter: stringData(event, "adapter"),
        role: stringData(event, "role"),
        status: "queued",
        text: "",
      });
    }
    if (event.type === "panel.job.started" && jobId) {
      const existing = panels.get(jobId);
      panels.set(jobId, { ...fallbackPanel(event), ...existing, status: "running" });
    }
    if (event.type === "panel.output.delta" && jobId) {
      const existing = panels.get(jobId) ?? fallbackPanel(event);
      panels.set(jobId, { ...existing, text: existing.text + eventText(event) });
    }
    if (event.type === "panel.job.completed" && jobId) {
      const existing = panels.get(jobId) ?? fallbackPanel(event);
      panels.set(jobId, { ...existing, status: "completed", text: existing.text || eventText(event) });
    }
    if (event.type === "panel.job.failed" && jobId) {
      const existing = panels.get(jobId) ?? fallbackPanel(event);
      panels.set(jobId, { ...existing, status: "failed", error: stringData(event, "error") });
    }
    if (event.type === "judge.started") {
      synthesis.status = "running";
    }
    if (event.type === "judge.output.delta") {
      synthesis.status = "running";
      synthesis.text = appendText(synthesis.text, eventText(event));
    }
    if (event.type === "judge.completed") {
      synthesis.status = "completed";
      synthesis.text = synthesis.text || eventText(event);
    }
    if (event.type === "judge.failed") {
      synthesis.status = "failed";
      synthesis.error = stringData(event, "error");
      synthesis.text = synthesis.text || eventText(event);
    }
    if (event.type === "final.started") {
      final.status = "running";
    }
    if (event.type === "final.delta") {
      final.status = "running";
      final.text = appendText(final.text, eventText(event));
    }
    if (event.type === "final.completed") {
      final.status = "completed";
      final.text = final.text || eventText(event);
    }
    if (event.type === "run.started") {
      runStatus = "running";
    }
    if (event.type === "run.paused") {
      runStatus = "paused";
    }
    if (event.type === "run.resumed") {
      runStatus = "running";
    }
    if (event.type === "run.completed") {
      runStatus = "completed";
    }
    if (event.type === "run.failed") {
      runStatus = "failed";
      final.status = final.text ? final.status : "failed";
      final.error = stringData(event, "error") || final.error;
    }
    if (event.type === "run.cancelled") {
      runStatus = "cancelled";
    }
  }

  return {
    panels: [...panels.values()],
    synthesis,
    final,
    runStatus: runStatus ?? initialStatus,
  };
}

function fallbackPanel(event: RunEvent): PanelTrace {
  return {
    jobId: event.jobId ?? "panel",
    modelId: stringData(event, "modelId") || event.jobId || "panel",
    adapter: stringData(event, "adapter"),
    role: stringData(event, "role"),
    status: "queued",
    text: "",
  };
}

function eventText(event: RunEvent) {
  return extractReadableOutput(stringData(event, "text") || stringData(event, "outputText"));
}

function stringData(event: RunEvent, key: string) {
  const value = event.data[key];
  return typeof value === "string" ? value : "";
}

function mergeEvents(current: RunEvent[], incoming: RunEvent[]) {
  const eventsBySeq = new Map<number, RunEvent>();
  for (const event of current) eventsBySeq.set(event.seq, event);
  for (const event of incoming) eventsBySeq.set(event.seq, event);
  return [...eventsBySeq.values()].sort((a, b) => a.seq - b.seq);
}

function appendText(current: string, next: string) {
  if (!next) return current;
  return current ? `${current}${next}` : next;
}

function extractFinalOutput(text: string) {
  const marker = "FINAL_OUTPUT:";
  const trimmed = text.trim();
  const markerIndex = trimmed.lastIndexOf(marker);
  if (markerIndex < 0) return trimmed;
  return trimmed.slice(markerIndex + marker.length).trim();
}

function extractJudgeAnalysisText(text: string) {
  const analysisMarker = "JUDGE_ANALYSIS_JSON:";
  const finalMarker = "FINAL_OUTPUT:";
  const trimmed = text.trim();
  const withAnalysis = trimmed.includes(analysisMarker)
    ? trimmed.slice(trimmed.indexOf(analysisMarker) + analysisMarker.length)
    : trimmed;
  const withoutFinal = withAnalysis.includes(finalMarker)
    ? withAnalysis.slice(0, withAnalysis.indexOf(finalMarker))
    : withAnalysis;
  return withoutFinal.trim();
}

function parseSocketMessage(data: string) {
  try {
    const parsed = JSON.parse(data) as RunEvent | { type?: string; data?: RunEvent[] };
    if ("type" in parsed && parsed.type === "snapshot" && Array.isArray(parsed.data)) {
      return parsed.data;
    }
    if ("seq" in parsed && typeof parsed.seq === "number") {
      return [parsed as RunEvent];
    }
  } catch {
    return null;
  }
  return null;
}

function toWebSocketUrl(url: string) {
  const parsed = new URL(url);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  return parsed.toString();
}
