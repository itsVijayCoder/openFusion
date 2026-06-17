"use client";

import type { RunEvent } from "@fusion-harness/shared";
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
      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3 text-sm font-semibold">Panel</div>
          {trace.panels.length ? (
            <div className="divide-y divide-border">
              {trace.panels.map((panel) => (
                <div key={panel.jobId} className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{panel.modelId}</p>
                      <p className="text-xs text-muted-foreground">
                        {[panel.adapter, panel.role].filter(Boolean).join(" / ") || "panel"}
                      </p>
                    </div>
                    <StatusPill value={panel.status} />
                  </div>
                  {panel.text ? <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap text-sm leading-6 text-foreground">{panel.text}</pre> : null}
                  {panel.error ? <p className="mt-3 text-sm text-destructive">{panel.error}</p> : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">Waiting for panel jobs.</p>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3 text-sm font-semibold">Judge</div>
            {trace.judge ? (
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap p-4 text-sm leading-6 text-foreground">{trace.judge}</pre>
            ) : (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">No judge output yet.</p>
            )}
          </div>
          <div className="rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3 text-sm font-semibold">Final</div>
            {trace.final ? (
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap p-4 text-sm leading-6 text-foreground">{trace.final}</pre>
            ) : (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">No final output yet.</p>
            )}
          </div>
        </div>
      </div>
    </Section>
  );
}

function buildTrace(events: RunEvent[]) {
  const panels = new Map<string, PanelTrace>();
  let judge = "";
  let final = "";

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
    if (event.type === "judge.output.delta" || event.type === "judge.completed") {
      judge += eventText(event);
    }
    if (event.type === "final.delta" || event.type === "final.completed") {
      final += eventText(event);
    }
  }

  return {
    panels: [...panels.values()],
    judge,
    final,
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
  return stringData(event, "text") || stringData(event, "outputText");
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
