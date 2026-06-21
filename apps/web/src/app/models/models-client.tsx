"use client";

import type { ModelRef } from "@fusion-harness/shared";
import { useEffect, useState } from "react";
import { DataNotice, EmptyState, PageHeader, Section, StatusPill } from "@/components/product-ui";
import { apiUrl } from "@/lib/api";

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

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader title="Models" description="Local CLI sessions, cloud gateway models, aliases, and verified availability." />
      <DataNotice source={state.source === "fallback" ? "fallback" : "api"} error={state.error} />
      {state.source === "loading" ? (
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          Loading signed-in model inventory...
        </div>
      ) : null}
      <Section title="Aliases">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {models.aliases.map((alias) => (
            <div key={alias.id} className="rounded-lg border border-border bg-card p-4">
              <p className="font-medium">{alias.id}</p>
              <p className="mt-1 text-xs text-muted-foreground">{alias.owned_by}</p>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Discovered Models">
        {models.data.length ? (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Model</th>
                  <th className="px-4 py-3 font-medium">Adapter</th>
                  <th className="px-4 py-3 font-medium">Auth</th>
                  <th className="px-4 py-3 font-medium">Availability</th>
                  <th className="px-4 py-3 font-medium">Capabilities</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {models.data.map((model) => (
                  <tr key={model.id}>
                    <td className="px-4 py-3 font-medium">{model.displayName ?? model.model}</td>
                    <td className="px-4 py-3 text-muted-foreground">{model.adapter}</td>
                    <td className="px-4 py-3 text-muted-foreground">{model.authMode}</td>
                    <td className="px-4 py-3">
                      <StatusPill value={model.availability} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {Object.entries(model.capabilities)
                        .filter(([, enabled]) => enabled)
                        .map(([name]) => name)
                        .join(", ") || "none"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No discovered models" description="Register a runner with local agent CLIs installed to populate CLI-backed models." />
        )}
      </Section>
    </div>
  );
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(apiUrl(path), {
    cache: "no-store",
    credentials: "include",
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `API returned ${response.status}`);
  }

  return (await response.json()) as T;
}
