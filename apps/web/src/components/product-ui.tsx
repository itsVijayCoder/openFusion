import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type PageHeaderProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
};

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-4 border-b border-border px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="truncate text-2xl font-semibold tracking-normal text-foreground">{title}</h1>
        {description ? <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Section({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      {title || action ? (
        <div className="flex items-center justify-between gap-3">
          {title ? <h2 className="text-sm font-semibold text-foreground">{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Metric({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
      {detail ? <p className="mt-1 text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

const positiveValues = new Set([
  "online",
  "completed",
  "verified",
  "connected",
  "enabled",
  "reviewed",
  "active",
  "approved",
  "success",
  "passed",
]);

const negativeValues = new Set([
  "failed",
  "error",
  "unavailable",
  "not_connected",
  "disabled",
  "rejected",
  "cancelled",
  "timeout",
  "outdated",
  "stale",
]);

const warningValues = new Set([
  "pending",
  "assigned",
  "queued",
  "running",
  "leased",
  "paused",
  "waiting_approval",
  "edited",
  "request_changes",
  "action_required",
]);

export function StatusPill({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  const tone = positiveValues.has(normalized)
    ? "border-primary/20 bg-primary/10 text-primary"
    : negativeValues.has(normalized)
      ? "border-destructive/20 bg-destructive/10 text-destructive"
      : warningValues.has(normalized)
        ? "border-yellow-500/20 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
        : "border-border bg-muted text-muted-foreground";

  return (
    <span className={cn("inline-flex h-6 items-center rounded-md border px-2 text-xs font-medium", tone)}>
      {value.replace(/_/g, " ")}
    </span>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/30 p-8 text-center">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}

export function DataNotice({ source, error }: { source?: "api" | "fallback"; error?: string }) {
  if (source !== "fallback") return null;
  return (
    <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
      Showing local fallback data{error ? `: ${error}` : "."}
    </div>
  );
}