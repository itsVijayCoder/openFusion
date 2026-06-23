"use client";

import { RiClipboardLine, RiRefreshLine } from "@remixicon/react";
import { useMemo, useState, useSyncExternalStore } from "react";
import { ProviderLogo } from "@/components/provider-logo";
import { Button } from "@/components/ui/button";
import { apiPost, apiUrl } from "@/lib/api";

type RunnerBootstrapProps = {
  hasRunner: boolean;
};

type CommandKind = "macos" | "windows";

const productionAppUrl = "https://fusion-harness.asthrix.workers.dev";
const productionApiUrl = "https://fusion-api.asthrix.workers.dev";

export function RunnerBootstrap({ hasRunner }: RunnerBootstrapProps) {
  const [copied, setCopied] = useState<CommandKind | undefined>();
  const [copyError, setCopyError] = useState<string | undefined>();
  const preferredInstall = useMemo<"macos" | "windows">(() => {
    if (typeof navigator === "undefined") return "macos";
    return /windows|win32|win64/i.test(`${navigator.userAgent} ${navigator.platform}`) ? "windows" : "macos";
  }, []);
  const [appUrl, cloudUrl] = useRuntimeUrls().split("|");
  const macosInstallerUrl = `${appUrl}/install/macos.sh`;
  const macosInstallCommand = installCommand("macos", "<generated-runner-token>");
  const windowsInstallerUrl = `${appUrl}/install/windows.ps1`;
  const windowsInstallCommand = installCommand("windows", "<generated-runner-token>");

  async function copyCommand(kind: CommandKind) {
    try {
      setCopyError(undefined);
      const command = installCommand(kind, await createRunnerToken());
      await navigator.clipboard.writeText(command);
      setCopied(kind);
      window.setTimeout(() => setCopied(undefined), 1800);
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : "Unable to create runner token");
    }
  }

  function installCommand(kind: "macos" | "windows", token: string) {
    if (kind === "macos") {
      return `curl -fsSL '${macosInstallerUrl}' | bash -s -- --cloud-url '${cloudUrl}' --binary-base-url '${appUrl}/downloads' --token '${token}'`;
    }
    return `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create((irm '${windowsInstallerUrl}'))) --cloud-url '${cloudUrl}' --token '${token}'"`;
  }

  function refresh() {
    window.location.reload();
  }

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-xs">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2">
            <ProviderLogo id="fusion-runner" size="lg" />
            <div>
              <h2 className="text-sm font-semibold text-foreground">Local Runner</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {hasRunner ? "Runner detected. The local service keeps it available in the background." : "Install once on the machine that has your agent CLIs."}
              </p>
            </div>
          </div>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-muted-foreground">
            The copy action creates a scoped runner token for your user, writes the cloud URL, and registers a background login task so the runner starts automatically.
          </p>
          {copyError ? <p className="mt-3 text-sm font-medium text-destructive">{copyError}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" className="rounded-md" onClick={() => copyCommand(preferredInstall)}>
            <RiClipboardLine aria-hidden data-icon="inline-start" />
            {copied === preferredInstall ? "Copied" : "Copy Install"}
          </Button>
          <Button type="button" variant="outline" size="sm" className="rounded-md" onClick={refresh}>
            <RiRefreshLine aria-hidden data-icon="inline-start" />
            Refresh
          </Button>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <CommandBlock label="macOS LaunchAgent" command={macosInstallCommand} onCopy={() => copyCommand("macos")} copied={copied === "macos"} />
        <CommandBlock
          label="Windows scheduled task"
          command={windowsInstallCommand}
          onCopy={() => copyCommand("windows")}
          copied={copied === "windows"}
        />
      </div>
    </section>
  );
}

function useRuntimeUrls() {
  return useSyncExternalStore(subscribeRuntimeUrls, runtimeUrlsSnapshot, runtimeUrlsServerSnapshot);
}

function subscribeRuntimeUrls() {
  return () => {};
}

function runtimeUrlsSnapshot() {
  if (typeof window === "undefined") return runtimeUrlsServerSnapshot();
  return `${window.location.origin}|${apiUrl("").replace(/\/$/, "")}`;
}

function runtimeUrlsServerSnapshot() {
  return `${productionAppUrl}|${productionApiUrl}`;
}

async function createRunnerToken() {
  const response = await apiPost<{ token: string }>("/api/auth/runner-token", {
    name: `Runner install ${new Date().toISOString()}`,
  });
  return response.token;
}

function CommandBlock({ label, command, onCopy, copied }: { label: string; command: string; onCopy: () => void; copied: boolean }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-xs">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2">
        <span className="text-xs font-semibold text-muted-foreground">{label}</span>
        <button type="button" className="text-xs font-semibold text-foreground hover:text-primary" onClick={onCopy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-3 text-xs leading-5 text-foreground">{command}</pre>
    </div>
  );
}
