"use client";

import { extractReadableOutput, type RunEvent } from "@fusion-harness/shared";
import { useEffect, useMemo, useState } from "react";
import { Section, StatusPill } from "@/components/product-ui";
import { apiUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

type RunEventStreamProps = {
  runId: string;
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

export function RunEventStream({ runId }: RunEventStreamProps) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [connection, setConnection] = useState<"connecting" | "live" | "reconnecting" | "closed">("connecting");

  useEffect(() => {
    let socket: WebSocket | undefined;
    let isActive = true;

    async function loadSnapshot() {
      const response = await fetch(apiUrl(`/api/fusion/runs/${runId}/events`), { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json().catch(() => ({}))) as { data?: RunEvent[] };
      if (isActive && Array.isArray(body.data)) {
        setEvents((current) => mergeEvents(current, body.data ?? []));
      }
    }

    function connect() {
      setConnection((current) => (current === "closed" ? "reconnecting" : current));
      socket = new WebSocket(toWebSocketUrl(apiUrl(`/api/fusion/runs/${runId}/events`)));
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
  }, [runId]);

  const trace = useMemo(() => buildTrace(events), [events]);

  return (
    <Section
      title="Live Trace"
      action={
        <span
          className={cn(
            "inline-flex h-6 items-center rounded-md border px-2 text-xs font-medium",
            connection === "live" ? "border-primary/20 bg-primary/10 text-primary" : "border-border bg-muted text-muted-foreground",
          )}
        >
          {connection}
        </span>
      }
    >
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.42fr)]">
        <div className="min-w-0 rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold">Panel</h3>
              <p className="mt-1 text-xs text-muted-foreground">Independent model runs complete before judge starts.</p>
            </div>
            <StatusPill value={panelSummaryStatus(trace.panels)} />
          </div>
          {trace.panels.length ? (
            <div className="divide-y divide-border">
              {trace.panels.map((panel) => (
                <article key={panel.jobId} className="min-w-0 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{panel.modelId}</p>
                      <p className="text-xs text-muted-foreground">
                        {[panel.adapter, panel.role].filter(Boolean).join(" / ") || "panel"}
                      </p>
                    </div>
                    <StatusPill value={panel.status} />
                  </div>
                  <TraceBody text={panel.text} error={panel.error} empty="Waiting for model output." />
                </article>
              ))}
            </div>
          ) : (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">Waiting for panel jobs.</p>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          <PhaseCard
            title="Judge"
            description="Compares successful panel answers and flags consensus, gaps, and risks."
            phase={trace.judge}
            empty="Judge starts after panel jobs finish."
            structured
          />
          <PhaseCard
            title="Final"
            description="Uses panel evidence and judge analysis to write the response."
            phase={trace.final}
            empty="Final starts after judge completes or degrades."
          />
        </div>
      </div>
    </Section>
  );
}

function buildTrace(events: RunEvent[]) {
  const panels = new Map<string, PanelTrace>();
  const judge: PhaseTrace = { status: "queued", text: "" };
  const final: PhaseTrace = { status: "queued", text: "" };

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
      judge.status = "running";
    }
    if (event.type === "judge.output.delta") {
      judge.status = "running";
      judge.text = appendText(judge.text, eventText(event));
    }
    if (event.type === "judge.completed") {
      judge.status = "completed";
      judge.text = judge.text || eventText(event);
    }
    if (event.type === "judge.failed") {
      judge.status = "failed";
      judge.error = stringData(event, "error");
      judge.text = judge.text || eventText(event);
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
    if (event.type === "run.failed") {
      final.status = final.text ? final.status : "failed";
      final.error = stringData(event, "error") || final.error;
    }
  }

  return {
    panels: [...panels.values()],
    judge,
    final,
  };
}

function PhaseCard({
  title,
  description,
  phase,
  empty,
  structured,
}: {
  title: string;
  description: string;
  phase: PhaseTrace;
  empty: string;
  structured?: boolean;
}) {
  return (
    <section className="min-w-0 rounded-lg border border-border bg-card">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
        <StatusPill value={phase.status} />
      </div>
      {structured ? (
        <JudgeBody text={phase.text} error={phase.error} empty={empty} />
      ) : (
        <TraceBody text={phase.text} error={phase.error} empty={empty} large />
      )}
    </section>
  );
}

function JudgeBody({ text, error, empty }: { text: string; error?: string; empty: string }) {
  const judge = parseJudge(text);
  if (judge) {
    return (
      <div className="space-y-4 p-4">
        <JudgeList title="Consensus" items={judge.consensus} />
        <JudgeList
          title="Contradictions"
          items={judge.contradictions.map((item) => `${item.topic}: ${item.details}${item.recommended_resolution ? ` Resolution: ${item.recommended_resolution}` : ""}`)}
        />
        <JudgeList title="Missing Coverage" items={judge.missing_coverage} />
        <JudgeList title="Unique Insights" items={judge.unique_insights.map((item) => `${item.model}: ${item.insight}`)} />
        <JudgeList title="Risks" items={judge.risks.map((risk) => `${risk.severity}: ${risk.risk} - ${risk.mitigation}`)} />
        {judge.recommended_final_strategy ? (
          <div>
            <p className="text-xs font-semibold uppercase text-muted-foreground">Final Strategy</p>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{judge.recommended_final_strategy}</p>
          </div>
        ) : null}
      </div>
    );
  }
  return <TraceBody text={text} error={error} empty={empty} />;
}

function JudgeList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-muted-foreground">{title}</p>
      <ul className="mt-2 space-y-2 text-sm leading-6 text-foreground">
        {items.map((item, index) => (
          <li key={`${title}-${index}`} className="break-words">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TraceBody({ text, error, empty, large }: { text: string; error?: string; empty: string; large?: boolean }) {
  if (text) {
    return (
      <div
        className={cn(
          "overflow-auto p-4 text-sm leading-6 text-foreground",
          large ? "max-h-[32rem]" : "max-h-80",
        )}
      >
        <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{text}</div>
      </div>
    );
  }

  if (error) {
    return <p className="break-words px-4 py-6 text-sm leading-6 text-destructive [overflow-wrap:anywhere]">{error}</p>;
  }

  return <p className="px-4 py-8 text-center text-sm text-muted-foreground">{empty}</p>;
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

function panelSummaryStatus(panels: PanelTrace[]) {
  if (!panels.length) return "queued";
  if (panels.some((panel) => panel.status === "running")) return "running";
  if (panels.every((panel) => panel.status === "completed")) return "completed";
  if (panels.every((panel) => panel.status === "failed")) return "failed";
  return "completed";
}

function parseJudge(text: string):
  | {
      consensus: string[];
      contradictions: Array<{ topic: string; details: string; recommended_resolution: string }>;
      missing_coverage: string[];
      unique_insights: Array<{ model: string; insight: string }>;
      risks: Array<{ risk: string; severity: string; mitigation: string }>;
      recommended_final_strategy: string;
    }
  | undefined {
  if (!text.trim()) return undefined;
  try {
    const parsed = JSON.parse(text) as {
      consensus?: unknown;
      contradictions?: unknown;
      missing_coverage?: unknown;
      unique_insights?: unknown;
      risks?: unknown;
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
