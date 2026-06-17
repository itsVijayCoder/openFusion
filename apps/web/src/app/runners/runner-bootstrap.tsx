"use client";

import { RiClipboardLine, RiRefreshLine, RiTerminalBoxLine } from "@remixicon/react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { apiUrl } from "@/lib/api";

type RunnerBootstrapProps = {
  hasRunner: boolean;
};

export function RunnerBootstrap({ hasRunner }: RunnerBootstrapProps) {
  const [copied, setCopied] = useState<"install" | "manual" | "dev" | undefined>();
  const cloudUrl = useMemo(() => apiUrl("").replace(/\/$/, ""), []);
  const installCommand = `npm run runner:install:macos -- --cloud-url ${cloudUrl}`;
  const manualCommand = `fusion-runner serve --cloud-url ${cloudUrl}`;
  const devCommand = `cd apps/runner-go && go run ./cmd/fusion-runner serve --cloud-url ${cloudUrl}`;

  async function copyCommand(kind: "install" | "manual" | "dev") {
    const command = kind === "install" ? installCommand : kind === "manual" ? manualCommand : devCommand;
    await navigator.clipboard.writeText(command);
    setCopied(kind);
    window.setTimeout(() => setCopied(undefined), 1800);
  }

  function refresh() {
    window.location.reload();
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm shadow-zinc-200/40">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-md bg-zinc-950 text-white">
              <RiTerminalBoxLine aria-hidden className="size-5" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-zinc-900">Local Runner</h2>
              <p className="text-xs font-medium text-zinc-500">{hasRunner ? "Runner detected. macOS keeps it available in the background." : "Install once on the machine that has your agent CLIs."}</p>
            </div>
          </div>
          <p className="mt-4 text-sm leading-6 text-zinc-600">
            The one-time macOS installer builds the runner, writes its cloud URL, and registers a LaunchAgent so the runner starts on login and restarts automatically.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" className="gap-2 rounded-md" onClick={() => copyCommand("install")}>
            <RiClipboardLine aria-hidden className="size-4" />
            {copied === "install" ? "Copied" : "Copy Install"}
          </Button>
          <Button type="button" size="sm" variant="ghost" className="gap-2 rounded-md" onClick={refresh}>
            <RiRefreshLine aria-hidden className="size-4" />
            Refresh
          </Button>
        </div>
      </div>
      <div className="mt-4 grid gap-3 xl:grid-cols-3">
        <CommandBlock label="One-time macOS service" command={installCommand} onCopy={() => copyCommand("install")} copied={copied === "install"} />
        <CommandBlock label="Manual foreground fallback" command={manualCommand} onCopy={() => copyCommand("manual")} copied={copied === "manual"} />
        <CommandBlock label="Repo development" command={devCommand} onCopy={() => copyCommand("dev")} copied={copied === "dev"} />
      </div>
    </section>
  );
}

function CommandBlock({ label, command, onCopy, copied }: { label: string; command: string; onCopy: () => void; copied: boolean }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-3 py-2">
        <span className="text-xs font-semibold text-zinc-500">{label}</span>
        <button type="button" className="text-xs font-semibold text-zinc-700 hover:text-zinc-950" onClick={onCopy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-3 text-xs leading-5 text-zinc-700">{command}</pre>
    </div>
  );
}
