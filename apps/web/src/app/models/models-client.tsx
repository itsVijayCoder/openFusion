"use client";

import type { ModelRef } from "@fusion-harness/shared";
import { RiArrowLeftLine } from "@remixicon/react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { ProviderLogo, providerLabel } from "@/components/provider-logo";
import { Button } from "@/components/ui/button";
import { apiUrl, devHeaders } from "@/lib/api";
import { cn } from "@/lib/utils";

type ModelResponse = {
  aliases: Array<{ id: string; owned_by: string }>;
  data: ModelRef[];
};

type LoadState = {
  models: ModelResponse;
  source: "api" | "fallback" | "loading";
  error?: string;
};

const emptyModels: ModelResponse = { aliases: [], data: [] };

export function ModelsClient() {
  const [state, setState] = useState<LoadState>({
    models: emptyModels,
    source: "loading",
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const models = await fetchJson<ModelResponse>("/api/models");
        if (!cancelled) {
          setState({ models, source: "api" });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
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

  const { models } = state;
  const providerCount = new Set(models.data.map((model) => model.provider ?? model.adapter)).size;
  const verifiedCount = models.data.filter((model) => model.availability === "verified").length;
  const cliSessionCount = models.data.filter((model) => model.authMode === "cli_session").length;

  return (
    <div className="min-h-full overflow-x-clip bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-8 sm:px-6 lg:px-8">
        <header className="border-b border-border pb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="inline-flex min-h-10 w-fit items-center border-b-2 border-primary pr-12 text-sm font-semibold text-foreground">
              Model Inventory
            </div>
            <Button asChild variant="outline" size="sm" className="w-fit rounded-md">
              <Link href="/chat">
                <RiArrowLeftLine aria-hidden data-icon="inline-start" />
              Back to Chat
              </Link>
            </Button>
          </div>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
            Local CLI sessions, cloud gateway models, aliases, and verified availability are listed with their provider marks.
          </p>
        </header>

      {state.source === "fallback" ? (
        <Notice>Showing local fallback data{state.error ? `: ${state.error}` : "."}</Notice>
      ) : null}
      {state.source === "loading" ? (
        <Notice>Loading signed-in model inventory...</Notice>
      ) : null}

        <section className="flex flex-col gap-3">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Discovered" value={models.data.length} detail="models available to Fusion" />
            <MetricCard label="Providers" value={providerCount} detail="unique provider identities" />
            <MetricCard label="Verified" value={verifiedCount} detail="known-good model entries" />
            <MetricCard label="CLI Sessions" value={cliSessionCount} detail="local authenticated agents" />
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <SectionHeader title="Aliases" meta={`${models.aliases.length} routes`} />
          {models.aliases.length ? (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {models.aliases.map((alias) => (
                <article key={alias.id} className="rounded-lg border border-border bg-card p-3 shadow-xs">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <ProviderLogo id={alias.owned_by} size="lg" />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-foreground">{alias.id}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{alias.owned_by}</div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyPanel
              title="No aliases configured"
              description="Add a fusion route when you want a stable OpenAI-compatible model alias."
            />
          )}
        </section>

        <section className="flex flex-col gap-3">
          <SectionHeader title="Discovered Models" meta={`${models.data.length} entries`} />
        {models.data.length ? (
          <div className="overflow-hidden rounded-lg border border-border bg-card shadow-xs">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-left text-sm">
              <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className={tableHeadCellClass}>Model</th>
                  <th className={tableHeadCellClass}>Provider</th>
                  <th className={tableHeadCellClass}>Adapter</th>
                  <th className={tableHeadCellClass}>Auth</th>
                  <th className={tableHeadCellClass}>Availability</th>
                  <th className={tableHeadCellClass}>Capabilities</th>
                </tr>
              </thead>
              <tbody>
                {models.data.map((model) => (
                  <tr key={model.id} className="hover:bg-muted/30">
                    <td className={tableCellClass}>
                      <div className="flex min-w-0 items-center gap-2.5">
                        <ProviderLogo id={model.provider ?? model.adapter} size="lg" />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-foreground">{model.displayName ?? model.model}</div>
                          <div className="mt-0.5 truncate text-xs text-muted-foreground">{model.model}</div>
                        </div>
                      </div>
                    </td>
                    <td className={tableCellClass}>
                      <LogoText id={model.provider ?? model.adapter} />
                    </td>
                    <td className={tableCellClass}>
                      <LogoText id={model.adapter} />
                    </td>
                    <td className={tableCellClass}>
                      <InventoryPill>{formatValue(model.authMode)}</InventoryPill>
                    </td>
                    <td className={tableCellClass}>
                      <InventoryPill tone={availabilityTone(model.availability)}>{formatValue(model.availability)}</InventoryPill>
                    </td>
                    <td className={tableCellClass}>
                      <div className="flex max-w-[340px] flex-wrap gap-1.5">
                        {capabilitiesFor(model).length ? (
                          capabilitiesFor(model).map((capability) => (
                            <InventoryPill key={capability}>
                              {formatCapability(capability)}
                            </InventoryPill>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">none</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        ) : (
          <EmptyPanel
            title="No discovered models"
            description="Register a runner with local agent CLIs installed to populate CLI-backed models."
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

function LogoText({ id }: { id: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <ProviderLogo id={id} size="sm" />
      <span className="truncate text-xs text-muted-foreground">{providerLabel(id)}</span>
    </div>
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

function capabilitiesFor(model: ModelRef) {
  return Object.entries(model.capabilities)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
}

function availabilityTone(value: string) {
  if (value === "unavailable") return "negative";
  if (value === "configured_unverified" || value === "suggested") return "warning";
  if (value === "verified" || value === "detected" || value === "listed") return "positive";
  return "neutral";
}

function formatValue(value: string) {
  return value.replace(/_/g, " ");
}

function formatCapability(value: string) {
  return value.replace(/[A-Z]/g, (match) => ` ${match.toLowerCase()}`);
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
