"use client";

import { extractReadableOutput, type FusionRunDetail, type RunEvent, type RunStatus } from "@fusion-harness/shared";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  RiArrowLeftLine,
  RiArrowUpLine,
  RiCloseLine,
  RiErrorWarningLine,
  RiFileList3Line,
  RiHistoryLine,
  RiLayoutGridLine,
  RiRobot2Line,
  RiUserLine,
} from "@remixicon/react";
import { StatusPill } from "@/components/product-ui";
import { apiPost, apiUrl } from "@/lib/api";
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

export function RunChat({ run }: RunChatProps) {
  const router = useRouter();
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [connection, setConnection] = useState<"connecting" | "live" | "reconnecting" | "closed">("connecting");
  const [showDetails, setShowDetails] = useState(false);
  const [continueMessage, setContinueMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const initialStatus = run.status;
  const messages = useMemo(() => run.messages ?? [], [run.messages]);

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

  const trace = useMemo(() => buildTrace(events, initialStatus), [events, initialStatus]);
  const finalText = trace.final.text || extractFinalOutput(trace.synthesis.text);
  const judgeText = extractJudgeAnalysisText(trace.synthesis.text);
  const currentStatus = trace.runStatus;
  const isRunActive = currentStatus === "queued" || currentStatus === "running" || currentStatus === "waiting_approval";
  const showLiveOutput = finalText.trim().length > 0 || trace.final.status === "running";
  const showThinking = isRunActive && !showLiveOutput;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, finalText, showThinking, trace.panels.length]);

  async function handleContinue() {
    const message = continueMessage.trim();
    if (!message || isSending || isRunActive) return;

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

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleContinue();
    }
  }

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col bg-background lg:h-[100dvh]">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <RiArrowLeftLine aria-hidden className="size-4" />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="truncate font-mono text-sm text-foreground">{run.id}</span>
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

          {showThinking ? (
            <ThinkingIndicator trace={trace} />
          ) : null}

          {showLiveOutput ? (
            <MessageBubble
              role="assistant"
              content={finalText}
              error={trace.final.error || trace.synthesis.error}
              isStreaming={trace.final.status === "running"}
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
          {sendError ? (
            <p className="mb-2 text-sm text-destructive">{sendError}</p>
          ) : null}
          <div className="flex items-end gap-2 rounded-xl border border-border bg-card p-2">
            <textarea
              ref={textareaRef}
              value={continueMessage}
              onChange={(event) => setContinueMessage(event.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isRunActive || isSending}
              placeholder={isRunActive ? "Waiting for run to complete..." : "Continue the conversation..."}
              rows={1}
              className="max-h-32 min-h-[2.5rem] flex-1 resize-none bg-transparent px-2 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => void handleContinue()}
              disabled={isRunActive || isSending || !continueMessage.trim()}
              className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <RiArrowUpLine aria-hidden className="size-4" />
            </button>
          </div>
          <p className="mt-1.5 px-2 text-xs text-muted-foreground">
            {isRunActive
              ? "Continue will be available once the run completes."
              : "Press Enter to send, Shift+Enter for new line."}
          </p>
        </div>
      </div>

      {showDetails ? (
        <DetailsPanel
          run={run}
          trace={trace}
          finalText={finalText}
          judgeText={judgeText}
          onClose={() => setShowDetails(false)}
        />
      ) : null}
    </div>
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
          <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {content}
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

function DetailsPanel({
  run,
  trace,
  finalText,
  judgeText,
  onClose,
}: {
  run: FusionRunDetail;
  trace: Trace;
  finalText: string;
  judgeText: string;
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
            <RiCloseLine aria-hidden className="size-4" />
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

            <DetailSection title="Panel Outputs" icon={RiLayoutGridLine}>
              {trace.panels.length ? (
                <div className="flex flex-col gap-3">
                  {trace.panels.map((panel) => (
                    <div key={panel.jobId} className="rounded-lg border border-border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{panel.modelId}</p>
                          <p className="text-xs text-muted-foreground">
                            {[panel.adapter, panel.role].filter(Boolean).join(" · ") || "panel"}
                          </p>
                        </div>
                        <StatusPill value={panel.status} />
                      </div>
                      {panel.text ? (
                        <div className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 text-xs text-foreground [overflow-wrap:anywhere]">
                          {panel.text}
                        </div>
                      ) : panel.error ? (
                        <p className="mt-2 break-words text-xs text-destructive">{panel.error}</p>
                      ) : (
                        <p className="mt-2 text-xs text-muted-foreground">Waiting for model output.</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyDetail text="No panel jobs yet." />
              )}
            </DetailSection>

            <DetailSection title="Judge / Synthesis" icon={RiRobot2Line}>
              <JudgeContent text={judgeText} error={trace.synthesis.error} />
            </DetailSection>

            <DetailSection title="Final Output" icon={RiFileList3Line}>
              {finalText ? (
                <div className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3 text-xs text-foreground [overflow-wrap:anywhere]">
                  {finalText}
                </div>
              ) : (
                <EmptyDetail text="Final output appears after judge/synthesis completes." />
              )}
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

function JudgeContent({ text, error }: { text: string; error?: string }) {
  const judge = parseJudge(text);
  if (judge) {
    return (
      <div className="flex flex-col gap-3">
        <JudgeList title="Consensus" items={judge.consensus} />
        <JudgeList
          title="Contradictions"
          items={judge.contradictions.map(
            (item) =>
              `${item.topic}: ${item.details}${item.recommended_resolution ? ` Resolution: ${item.recommended_resolution}` : ""}`,
          )}
        />
        <JudgeList title="Missing Coverage" items={judge.missing_coverage} />
        <JudgeList
          title="Unique Insights"
          items={judge.unique_insights.map((item) => `${item.model}: ${item.insight}`)}
        />
        <JudgeList
          title="Risks"
          items={judge.risks.map((risk) => `${risk.severity}: ${risk.risk} - ${risk.mitigation}`)}
        />
        {judge.synthesis_strategy || judge.recommended_final_strategy ? (
          <div>
            <p className="text-xs font-semibold uppercase text-muted-foreground">Synthesis Strategy</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">
              {judge.synthesis_strategy || judge.recommended_final_strategy}
            </p>
          </div>
        ) : null}
      </div>
    );
  }
  if (error) return <p className="break-words text-sm text-destructive">{error}</p>;
  if (text) {
    return (
      <div className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 text-xs text-foreground [overflow-wrap:anywhere]">
        {text}
      </div>
    );
  }
  return <EmptyDetail text="Judge/synthesis starts after panel jobs finish." />;
}

function JudgeList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-muted-foreground">{title}</p>
      <ul className="mt-1 flex flex-col gap-1 text-sm text-foreground">
        {items.map((item, index) => (
          <li key={`${title}-${index}`} className="break-words">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
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

function parseJudge(text: string):
  | {
      consensus: string[];
      contradictions: Array<{ topic: string; details: string; recommended_resolution: string }>;
      missing_coverage: string[];
      unique_insights: Array<{ model: string; insight: string }>;
      risks: Array<{ risk: string; severity: string; mitigation: string }>;
      synthesis_strategy: string;
      recommended_final_strategy: string;
    }
  | undefined {
  if (!text.trim()) return undefined;
  try {
    const parsed = JSON.parse(extractJudgeAnalysisText(text)) as {
      consensus?: unknown;
      contradictions?: unknown;
      missing_coverage?: unknown;
      unique_insights?: unknown;
      risks?: unknown;
      synthesis_strategy?: unknown;
      recommended_final_strategy?: unknown;
    };
    return {
      consensus: toStringArray(parsed.consensus),
      contradictions: Array.isArray(parsed.contradictions)
        ? parsed.contradictions.map((item) => ({
            topic: stringFromRecord(item, "topic"),
            details: stringFromRecord(item, "details"),
            recommended_resolution: stringFromRecord(item, "recommended_resolution"),
          }))
        : [],
      missing_coverage: toStringArray(parsed.missing_coverage),
      unique_insights: Array.isArray(parsed.unique_insights)
        ? parsed.unique_insights.map((item) => ({
            model: stringFromRecord(item, "model"),
            insight: stringFromRecord(item, "insight"),
          }))
        : [],
      risks: Array.isArray(parsed.risks)
        ? parsed.risks.map((risk) => ({
            risk: stringFromRecord(risk, "risk"),
            severity: stringFromRecord(risk, "severity") || "medium",
            mitigation: stringFromRecord(risk, "mitigation"),
          }))
        : [],
      synthesis_strategy: typeof parsed.synthesis_strategy === "string" ? parsed.synthesis_strategy : "",
      recommended_final_strategy:
        typeof parsed.recommended_final_strategy === "string" ? parsed.recommended_final_strategy : "",
    };
  } catch {
    return undefined;
  }
}

function toStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function stringFromRecord(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate : "";
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