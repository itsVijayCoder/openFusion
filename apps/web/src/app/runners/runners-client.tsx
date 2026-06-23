"use client";

import { RiArrowLeftLine } from "@remixicon/react";
import type { ModelRef, RunnerRef, ToolKind, ToolRef } from "@fusion-harness/shared";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { ProviderLogo, providerLabel } from "@/components/provider-logo";
import { Button } from "@/components/ui/button";
import { apiUrl, devHeaders } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { RunnerBootstrap } from "./runner-bootstrap";

type RunnerResponse = { data: RunnerRef[] };
type ModelResponse = {
  aliases: Array<{ id: string; owned_by: string }>;
  data: ModelRef[];
};
type LoadState = {
  runners: RunnerResponse;
  models: ModelResponse;
  source: "api" | "fallback" | "loading";
  error?: string;
};

const emptyRunners: RunnerResponse = { data: [] };
const emptyModels: ModelResponse = { aliases: [], data: [] };

const localAgents: Array<{
  id: string;
  name: string;
  tool?: ToolKind;
  adapter?: ModelRef["adapter"];
  description: string;
}> = [
  {
    id: "fusion-runner",
    name: "Fusion Runner",
    description: "Built-in local execution bridge",
  },
  {
    id: "opencode",
    name: "OpenCode",
    tool: "opencode",
    adapter: "opencode",
    description: "Provider/model IDs from OpenCode",
  },
  {
    id: "claude",
    name: "Claude Code",
    adapter: "claude",
    description: "Claude Code or OpenClaude local CLI",
  },
  {
    id: "codex",
    name: "Codex CLI",
    tool: "codex",
    adapter: "codex",
    description: "Codex model IDs passed to codex exec",
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    adapter: "gemini",
    description: "Google Gemini local coding agent",
  },
  {
    id: "cursor-agent",
    name: "Cursor Agent",
    adapter: "cursor-agent",
    description: "Cursor's terminal coding agent",
  },
  {
    id: "qwen",
    name: "Qwen Code",
    adapter: "qwen",
    description: "Qwen local coding agent",
  },
  {
    id: "qoder",
    name: "Qoder CLI",
    adapter: "qoder",
    description: "Qoder's local CLI agent",
  },
  {
    id: "copilot",
    name: "Copilot CLI",
    adapter: "copilot",
    description: "GitHub Copilot terminal agent",
  },
  {
    id: "deepseek",
    name: "DeepSeek TUI",
    adapter: "deepseek",
    description: "DeepSeek local terminal agent",
  },
  {
    id: "kimi",
    name: "Kimi CLI",
    adapter: "kimi",
    description: "Moonshot Kimi local agent",
  },
  {
    id: "hermes",
    name: "Hermes",
    adapter: "hermes",
    description: "Hermes ACP local agent",
  },
  {
    id: "pi",
    name: "Pi",
    adapter: "pi",
    description: "Pi local agent runtime",
  },
  {
    id: "aider",
    name: "Aider",
    adapter: "aider",
    description: "Aider local coding CLI",
  },
  {
    id: "devin",
    name: "Devin",
    adapter: "devin",
    description: "Devin for Terminal",
  },
  {
    id: "grok-build",
    name: "Grok Build",
    adapter: "grok-build",
    description: "xAI Grok Build CLI",
  },
  {
    id: "amp",
    name: "Amp",
    adapter: "amp",
    description: "Amp local coding agent",
  },
  {
    id: "kiro",
    name: "Kiro",
    adapter: "kiro",
    description: "Kiro local coding agent",
  },
  {
    id: "kilo",
    name: "Kilo",
    adapter: "kilo",
    description: "Kilo local coding agent",
  },
  {
    id: "vibe",
    name: "Mistral Vibe",
    adapter: "vibe",
    description: "Mistral Vibe local agent",
  },
  {
    id: "trae-cli",
    name: "Trae CLI",
    adapter: "trae-cli",
    description: "Trae terminal coding agent",
  },
  {
    id: "codebuddy",
    name: "CodeBuddy",
    adapter: "codebuddy",
    description: "CodeBuddy terminal agent",
  },
  {
    id: "reasonix",
    name: "Reasonix",
    adapter: "reasonix",
    description: "Reasonix local coding agent",
  },
  {
    id: "antigravity",
    name: "Antigravity",
    adapter: "antigravity",
    description: "Google Antigravity local agent",
  },
  {
    id: "git",
    name: "Git",
    tool: "git",
    description: "Repository context and patch workflows",
  },
  {
    id: "docker",
    name: "Docker",
    tool: "docker",
    description: "Container executor capability",
  },
];

export function RunnersClient() {
  const [state, setState] = useState<LoadState>({
    runners: emptyRunners,
    models: emptyModels,
    source: "loading",
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [runners, models] = await Promise.all([
          fetchJson<RunnerResponse>("/api/runners"),
          fetchJson<ModelResponse>("/api/models"),
        ]);
        if (!cancelled) {
          setState({ runners, models, source: "api" });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            runners: emptyRunners,
            models: emptyModels,
            source: "fallback",
            error: error instanceof Error ? error.message : "API unavailable",
          });
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const { runners, models } = state;
  const detectedCount = localAgents.filter((agent) => isAgentDetected(runners.data, models.data, agent)).length;
  const onlineRunners = runners.data.filter((runner) => runner.status === "online").length;
  const modelCount = models.data.length;

  return (
    <div className="min-h-full overflow-x-clip bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-8 sm:px-6 lg:px-8">
        <header className="border-b border-border pb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="inline-flex min-h-10 w-fit items-center border-b-2 border-primary pr-12 text-sm font-semibold text-foreground">
              Local Agents
            </div>
            <Button asChild variant="outline" size="sm" className="w-fit rounded-md">
              <Link href="/chat">
                <RiArrowLeftLine aria-hidden data-icon="inline-start" />
              Back to Chat
              </Link>
            </Button>
          </div>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
            Fusion Runner ships with the app. Local agents are detected when their CLI is installed on the host and the runner registers its discovery report.
          </p>
        </header>

        {state.source === "fallback" ? (
          <Notice>Showing local fallback data{state.error ? `: ${state.error}` : "."}</Notice>
        ) : null}
        {state.source === "loading" ? (
          <Notice>Loading signed-in runner inventory...</Notice>
        ) : null}

        <section className="flex flex-col gap-3">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Detected Agents" value={detectedCount} detail={`${localAgents.length} known surfaces`} />
            <MetricCard label="Online Runners" value={onlineRunners} detail={`${runners.data.length} registered runners`} />
            <MetricCard label="Models" value={modelCount} detail="discovered across adapters" />
            <MetricCard label="Aliases" value={models.aliases.length} detail="OpenAI-compatible routes" />
          </div>
        </section>

        <RunnerBootstrap hasRunner={runners.data.length > 0} />

        <section className="flex flex-col gap-3">
          <SectionHeader title="Detected" meta={`${detectedCount} available`} />
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {localAgents.map((agent) => {
              const tool = findAgentTool(runners.data, agent);
              const detected = isAgentDetected(runners.data, models.data, agent);
              const modelCount = agent.adapter ? models.data.filter((model) => model.adapter === agent.adapter).length : 0;
              const toolStatus = tool?.status ?? (detected ? "detected" : "not detected");

              return (
                <article
                  key={agent.id}
                  className={cn(
                    "relative grid min-h-22 grid-cols-1 gap-3 rounded-lg border bg-card p-3 shadow-xs transition-colors hover:border-input sm:grid-cols-[minmax(0,1fr)_auto]",
                    detected && "border-primary/30 shadow-sm before:absolute before:inset-y-3 before:left-0 before:w-0.5 before:rounded-r-full before:bg-primary",
                    !detected && "border-border",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <ProviderLogo id={agent.id} size="lg" />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-foreground">{agent.name}</div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">{agent.description}</div>
                      <div className="mt-1 text-xs tabular-nums text-muted-foreground">
                        {providerLabel(agent.adapter ?? agent.id)}
                        {modelCount ? ` · ${modelCount} models` : ""}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-start sm:justify-end">
                    <InventoryPill tone={detected ? "positive" : "negative"}>{formatValue(toolStatus)}</InventoryPill>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <SectionHeader title="Runner Diagnostics" meta={`${runners.data.length} registered`} />
          {runners.data.length ? (
            <div className="overflow-hidden rounded-lg border border-border bg-card shadow-xs">
              <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-left text-sm">
                <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className={tableHeadCellClass}>Runner</th>
                    <th className={tableHeadCellClass}>Host</th>
                    <th className={tableHeadCellClass}>Tools</th>
                    <th className={tableHeadCellClass}>Executors</th>
                    <th className={tableHeadCellClass}>Last Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {runners.data.map((runner) => (
                    <tr key={runner.id} className="hover:bg-muted/30">
                      <td className={tableCellClass}>
                        <div className="flex min-w-0 items-center gap-2.5">
                          <ProviderLogo id="fusion-runner" size="sm" />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-foreground">{runner.name}</div>
                            <InventoryPill tone={runner.status === "online" ? "positive" : "negative"}>{runner.status}</InventoryPill>
                          </div>
                        </div>
                      </td>
                      <td className={cn(tableCellClass, "text-xs text-muted-foreground")}>
                        {runner.os} / {runner.arch}
                      </td>
                      <td className={tableCellClass}>
                        <div className="flex max-w-[340px] flex-wrap gap-1.5">
                          {runner.tools.map((tool) => (
                            <InventoryPill
                              key={tool.id ?? `${tool.tool}:${tool.path ?? ""}`}
                              tone={tool.status === "unavailable" || tool.status === "error" ? "negative" : "positive"}
                            >
                              {toolName(tool)}: {formatValue(tool.status)}
                            </InventoryPill>
                          ))}
                        </div>
                      </td>
                      <td className={cn(tableCellClass, "text-xs text-muted-foreground")}>{runner.capabilities.executors.join(", ") || "host"}</td>
                      <td className={cn(tableCellClass, "text-xs text-muted-foreground")}>{formatDateTime(runner.lastSeenAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          ) : (
            <EmptyPanel
              title="No runners registered"
              description="Use the one-time installer above, then refresh this page after the service starts."
            />
          )}
        </section>
      </div>
    </div>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <article className="rounded-lg border border-border bg-card p-3 shadow-xs">
      <div className="text-xs font-semibold uppercase text-muted-foreground">{label}</div>
      <div className="mt-1.5 text-2xl font-semibold leading-none text-foreground">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
    </article>
  );
}

const tableHeadCellClass = "border-b border-border px-3 py-2.5 font-semibold";
const tableCellClass = "border-b border-border/60 px-3 py-2.5 align-middle";

type PillTone = "neutral" | "positive" | "negative" | "warning";

function InventoryPill({ children, tone = "neutral" }: { children: ReactNode; tone?: PillTone }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-5 items-center rounded-full border px-2 py-0.5 text-xs font-medium leading-none",
        tone === "positive" && "border-primary/20 bg-primary/10 text-primary",
        tone === "negative" && "border-destructive/20 bg-destructive/10 text-destructive",
        tone === "warning" && "border-accent bg-accent text-accent-foreground",
        tone === "neutral" && "border-border bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function EmptyPanel({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/30 p-8 text-center">
      <strong className="block text-sm font-semibold text-foreground">{title}</strong>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}

function SectionHeader({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <span className="text-xs tabular-nums text-muted-foreground">{meta}</span>
    </div>
  );
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(apiUrl(path), {
    cache: "no-store",
    credentials: "include",
    headers: devHeaders(),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `API returned ${response.status}`);
  }

  return (await response.json()) as T;
}

function findAgentTool(runners: RunnerRef[], agent: { id: string; tool?: ToolKind }): ToolRef | undefined {
  return runners
    .flatMap((runner) => runner.tools)
    .find((tool) => {
      if (agent.tool) return tool.tool === agent.tool && tool.status !== "unavailable";
      return tool.tool === "custom" && tool.metadata?.agentId === agent.id && tool.status !== "unavailable";
    });
}

function isAgentDetected(
  runners: RunnerRef[],
  models: ModelRef[],
  agent: { id: string; tool?: ToolKind; adapter?: ModelRef["adapter"] },
) {
  if (agent.id === "fusion-runner") return runners.length > 0;
  if (agent.adapter && models.some((model) => model.adapter === agent.adapter)) return true;
  const tool = findAgentTool(runners, agent);
  return Boolean(tool && tool.status !== "unavailable");
}

function toolName(tool: ToolRef) {
  if (tool.tool !== "custom") return tool.tool;
  return typeof tool.metadata?.displayName === "string" ? tool.metadata.displayName : "custom";
}

function formatValue(value: string) {
  return value.replace(/_/g, " ");
}
