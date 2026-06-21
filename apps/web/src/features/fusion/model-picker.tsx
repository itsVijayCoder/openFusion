"use client";

import { Check, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { ModelOption } from "./types";
import { cn } from "@/lib/utils";

type ModelPickerProps = {
  models: ModelOption[];
  selectedIds: string[];
  onToggle: (modelId: string) => void;
  onClose: () => void;
  title?: string;
  single?: boolean;
  selectedSingleId?: string | null;
  onPickSingle?: (modelId: string) => void;
};

export function ModelPicker({
  models,
  selectedIds,
  onToggle,
  onClose,
  title = "Select Models",
  single = false,
  selectedSingleId,
  onPickSingle,
}: ModelPickerProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query.trim()) return models;
    const q = query.toLowerCase();
    return models.filter(
      (m) => m.name.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q),
    );
  }, [models, query]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-50 flex h-[min(560px,80vh)] w-[min(560px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <button
            onClick={onClose}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
        <div className="border-b border-border px-4 py-2.5">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-1.5">
            <Search aria-hidden className="size-4 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search models..."
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">No models found.</p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {filtered.map((model) => {
                const isSelected = single
                  ? selectedSingleId === model.id
                  : selectedIds.includes(model.id);
                return (
                  <button
                    key={model.id}
                    disabled={!model.available}
                    onClick={() => {
                      if (!model.available) return;
                      if (single) {
                        onPickSingle?.(model.id);
                        onClose();
                      } else {
                        onToggle(model.id);
                      }
                    }}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                      isSelected ? "bg-muted" : "hover:bg-muted/50",
                      !model.available ? "cursor-not-allowed opacity-60 hover:bg-transparent" : "",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-md border",
                        isSelected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border",
                      )}
                    >
                      {isSelected ? <Check aria-hidden className="size-3" /> : null}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{model.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {model.provider} · {model.adapter}
                      </p>
                    </div>
                    {!model.available ? (
                      <span className="text-xs text-muted-foreground">unavailable</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
