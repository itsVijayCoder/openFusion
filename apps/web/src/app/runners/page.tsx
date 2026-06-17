import {
  RiCodeSSlashLine,
  RiGitBranchLine,
  RiRobot2Line,
  RiStackLine,
  RiTerminalBoxLine,
} from "@remixicon/react";
import type { ModelRef, RunnerRef, ToolKind, ToolRef } from "@fusion-harness/shared";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DataNotice, EmptyState, Section, StatusPill } from "@/components/product-ui";
import { apiGet } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { RunnerBootstrap } from "./runner-bootstrap";

export const dynamic = "force-dynamic";

type RunnerResponse = { data: RunnerRef[] };
type ModelResponse = {
  aliases: Array<{ id: string; owned_by: string }>;
  data: ModelRef[];
};

const localAgents: Array<{
  id: string;
  name: string;
  tool?: ToolKind;
  adapter?: ModelRef["adapter"];
  description: string;
  icon: typeof RiRobot2Line;
}> = [
  {
    id: "fusion-runner",
    name: "Fusion Runner",
    description: "Built-in local execution bridge",
    icon: RiRobot2Line,
  },
  {
    id: "opencode",
    name: "OpenCode",
    tool: "opencode",
    adapter: "opencode",
    description: "Provider/model IDs from OpenCode",
    icon: RiTerminalBoxLine,
  },
  {
    id: "claude",
    name: "Claude Code",
    adapter: "claude",
    description: "Claude Code or OpenClaude local CLI",
    icon: RiTerminalBoxLine,
  },
  {
    id: "codex",
    name: "Codex CLI",
    tool: "codex",
    adapter: "codex",
    description: "Codex model IDs passed to codex exec",
    icon: RiCodeSSlashLine,
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    adapter: "gemini",
    description: "Google Gemini local coding agent",
    icon: RiTerminalBoxLine,
  },
  {
    id: "cursor-agent",
    name: "Cursor Agent",
    adapter: "cursor-agent",
    description: "Cursor's terminal coding agent",
    icon: RiTerminalBoxLine,
  },
  {
    id: "qwen",
    name: "Qwen Code",
    adapter: "qwen",
    description: "Qwen local coding agent",
    icon: RiTerminalBoxLine,
  },
  {
    id: "qoder",
    name: "Qoder CLI",
    adapter: "qoder",
    description: "Qoder's local CLI agent",
    icon: RiTerminalBoxLine,
  },
  {
    id: "copilot",
    name: "Copilot CLI",
    adapter: "copilot",
    description: "GitHub Copilot terminal agent",
    icon: RiTerminalBoxLine,
  },
  {
    id: "deepseek",
    name: "DeepSeek TUI",
    adapter: "deepseek",
    description: "DeepSeek local terminal agent",
    icon: RiTerminalBoxLine,
  },
  {
    id: "kimi",
    name: "Kimi CLI",
    adapter: "kimi",
    description: "Moonshot Kimi local agent",
    icon: RiTerminalBoxLine,
  },
  {
    id: "hermes",
    name: "Hermes",
    adapter: "hermes",
    description: "Hermes ACP local agent",
    icon: RiTerminalBoxLine,
  },
  {
    id: "pi",
    name: "Pi",
    adapter: "pi",
    description: "Pi local agent runtime",
    icon: RiTerminalBoxLine,
  },
  {
    id: "aider",
    name: "Aider",
    adapter: "aider",
    description: "Aider local coding CLI",
    icon: RiTerminalBoxLine,
  },
  {
    id: "devin",
    name: "Devin",
    adapter: "devin",
    description: "Devin for Terminal",
    icon: RiTerminalBoxLine,
  },
  {
    id: "grok-build",
    name: "Grok Build",
    adapter: "grok-build",
    description: "xAI Grok Build CLI",
    icon: RiTerminalBoxLine,
  },
  {
    id: "git",
    name: "Git",
    tool: "git",
    description: "Repository context and patch workflows",
    icon: RiGitBranchLine,
  },
  {
    id: "docker",
    name: "Docker",
    tool: "docker",
    description: "Container executor capability",
    icon: RiStackLine,
  },
];

export default async function RunnersPage() {
  const [runners, models] = await Promise.all([
    apiGet<RunnerResponse>("/api/runners", { data: [] }),
    apiGet<ModelResponse>("/api/models", { aliases: [], data: [] }),
  ]);

  return (
    <div className="min-h-screen bg-[#f7f8fa] px-6 py-10 text-zinc-950">
      <div className="mx-auto flex max-w-7xl flex-col gap-7">
        <header className="max-w-5xl">
          <div className="flex items-end justify-between gap-4 border-b border-zinc-200">
            <div className="flex h-10 items-center border-b-2 border-zinc-950 pr-16 text-sm font-semibold text-zinc-700">Local Agents</div>
            <Button asChild variant="ghost" size="sm" className="mb-1 text-zinc-500">
              <Link href="/chat">Back to Chat</Link>
            </Button>
          </div>
          <p className="mt-5 text-sm leading-6 text-zinc-500">
            Fusion Runner ships with the app. Local agents are detected when their CLI is installed on the host and the runner registers its discovery report.
          </p>
        </header>

        <DataNotice source={runners.source === "fallback" || models.source === "fallback" ? "fallback" : "api"} error={runners.error ?? models.error} />

        <RunnerBootstrap hasRunner={runners.data.data.length > 0} />

        <Section title="Detected">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {localAgents.map((agent) => {
              const tool = findAgentTool(runners.data.data, agent);
              const detected = agent.id === "fusion-runner" ? runners.data.data.length > 0 : Boolean(tool && tool.status !== "unavailable");
              const modelCount = agent.adapter ? models.data.data.filter((model) => model.adapter === agent.adapter).length : 0;
              const Icon = agent.icon;

              return (
                <article key={agent.id} className="flex min-h-[168px] flex-col items-center justify-between rounded-lg border border-zinc-200 bg-white p-4 text-center shadow-sm shadow-zinc-200/40">
                  <div className="flex flex-col items-center gap-3">
                    <span className={cn("flex size-12 items-center justify-center rounded-full", detected ? "bg-zinc-950 text-white" : "bg-zinc-100 text-zinc-500")}>
                      <Icon aria-hidden className="size-6" />
                    </span>
                    <div>
                      <h2 className="text-sm font-semibold text-zinc-800">{agent.name}</h2>
                      <p className={cn("mt-1 text-xs font-medium", detected ? "text-zinc-500" : "text-zinc-400")}>
                        {detected ? "Detected" : "Not detected"}
                        {modelCount ? ` · ${modelCount} models` : ""}
                      </p>
                    </div>
                  </div>
                  <Button asChild={detected} disabled={!detected} variant="secondary" size="sm" className="w-full rounded-md bg-zinc-100 text-zinc-600 hover:bg-zinc-200">
                    {detected ? <Link href="/chat">Start Chat</Link> : <span>Start Chat</span>}
                  </Button>
                </article>
              );
            })}
          </div>
        </Section>

        <Section title="Runner Diagnostics">
          {runners.data.data.length ? (
            <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-zinc-50 text-xs text-zinc-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Runner</th>
                    <th className="px-4 py-3 font-medium">Host</th>
                    <th className="px-4 py-3 font-medium">Tools</th>
                    <th className="px-4 py-3 font-medium">Executors</th>
                    <th className="px-4 py-3 font-medium">Last Seen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {runners.data.data.map((runner) => (
                    <tr key={runner.id}>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <span className="font-medium text-zinc-800">{runner.name}</span>
                          <StatusPill value={runner.status} />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-zinc-500">
                        {runner.os} / {runner.arch}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {runner.tools.map((tool) => (
                            <StatusPill key={tool.id ?? `${tool.tool}:${tool.path ?? ""}`} value={`${toolName(tool)}:${tool.status}`} />
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-zinc-500">{runner.capabilities.executors.join(", ") || "host"}</td>
                      <td className="px-4 py-3 text-zinc-500">{formatDateTime(runner.lastSeenAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No runners registered" description="Use the one-time macOS installer above, then refresh this page after the service starts." />
          )}
        </Section>
      </div>
    </div>
  );
}

function findAgentTool(runners: RunnerRef[], agent: { id: string; tool?: ToolKind }): ToolRef | undefined {
  return runners
    .flatMap((runner) => runner.tools)
    .find((tool) => {
      if (agent.tool) return tool.tool === agent.tool && tool.status !== "unavailable";
      return tool.tool === "custom" && tool.metadata?.agentId === agent.id && tool.status !== "unavailable";
    });
}

function toolName(tool: ToolRef) {
  if (tool.tool !== "custom") return tool.tool;
  return typeof tool.metadata?.displayName === "string" ? tool.metadata.displayName : "custom";
}
