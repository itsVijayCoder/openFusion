"use client";

import {
  RiAddLine,
  RiArrowUpLine,
  RiAttachment2,
  RiCheckLine,
  RiCloseLine,
  RiCodeSSlashLine,
  RiEqualizerLine,
  RiGlobalLine,
  RiLoader4Line,
  RiMoreLine,
  RiRobot2Line,
  RiSearchLine,
  RiSparklingLine,
  RiStackLine,
} from "@remixicon/react";
import { sanitizeCustomModelId, type AdapterId, type FusionRunSummary, type ModelRef, type PermissionProfile, type RunnerRef } from "@fusion-harness/shared";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { apiPost } from "@/lib/api";
import { cn } from "@/lib/utils";

const presets = ["same-provider-first", "mixed-coding", "opencode-quality", "codex-quality", "fast", "budget"] as const;
const modes = ["auto", "required", "direct"] as const;
const permissions: PermissionProfile[] = ["readonly", "workspace_write", "trusted_internal"];
const adapters: AdapterId[] = [
  "opencode",
  "claude",
  "codex",
  "cursor-agent",
  "gemini",
  "qwen",
  "qoder",
  "copilot",
  "deepseek",
  "kimi",
  "hermes",
  "pi",
  "aider",
  "devin",
  "grok-build",
  "amp",
  "kiro",
  "kilo",
  "vibe",
  "trae-cli",
  "codebuddy",
  "reasonix",
  "antigravity",
  "api-key",
  "cloudflare-ai-gateway",
];
const modelSelectionStorageKey = "fusion-harness:model-selection";

type PickerTarget = "analysis" | "judge" | "final";
type OptionSource = "detected" | "suggested" | "custom";
type ModelOption = ModelRef & { optionSource: OptionSource };
type StoredModelSelection = {
  analysisModelIds?: string[];
  judgeModelId?: string;
  finalModelId?: string;
  preset?: (typeof presets)[number];
  mode?: (typeof modes)[number];
  permissionProfile?: PermissionProfile;
  customModels?: Array<{ adapter: AdapterId; model: string }>;
};

type TaskConsoleProps = {
  models: ModelRef[];
  runners: RunnerRef[];
};

const suggestedModels: ModelOption[] = [
  suggestedModel("opencode", "minimax/minimax-m1", "Minimax M1", "minimax"),
  suggestedModel("opencode", "deepseek/deepseek-chat", "DeepSeek Chat", "deepseek"),
  suggestedModel("opencode", "moonshotai/kimi-k2", "Kimi K2", "moonshotai"),
  suggestedModel("opencode", "openai/gpt-5.5", "OpenAI GPT 5.5", "openai"),
  suggestedModel("codex", "gpt-5-codex", "GPT-5 Codex", "openai"),
  suggestedModel("codex", "gpt-5.5", "GPT 5.5", "openai"),
];

export function TaskConsole({ models, runners }: TaskConsoleProps) {
  const router = useRouter();
  const initialOptions = useMemo(() => buildModelOptions(models, []), [models]);
  const [prompt, setPrompt] = useState("");
  const [preset, setPreset] = useState<(typeof presets)[number]>("mixed-coding");
  const [mode, setMode] = useState<(typeof modes)[number]>("required");
  const [permissionProfile, setPermissionProfile] = useState<PermissionProfile>("readonly");
  const [customOptions, setCustomOptions] = useState<ModelOption[]>([]);
  const allOptions = useMemo(() => buildModelOptions(models, customOptions), [models, customOptions]);
  const optionById = useMemo(() => new Map(allOptions.map((option) => [option.id, option])), [allOptions]);
  const [analysisModelIds, setAnalysisModelIds] = useState(() => defaultAnalysisIds(initialOptions));
  const [judgeModelId, setJudgeModelId] = useState(() => defaultJudgeId(initialOptions));
  const [finalModelId, setFinalModelId] = useState(() => defaultFinalId(initialOptions));
  const [pickerTarget, setPickerTarget] = useState<PickerTarget>("analysis");
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [hasLoadedStoredSelection, setHasLoadedStoredSelection] = useState(false);
  const [isPending, startTransition] = useTransition();

  const selectedAnalysis = analysisModelIds.map((id) => optionById.get(id)).filter(Boolean) as ModelOption[];
  const judgeModel = optionById.get(judgeModelId) ?? selectedAnalysis[0];
  const finalModel = optionById.get(finalModelId) ?? selectedAnalysis[selectedAnalysis.length - 1] ?? selectedAnalysis[0];
  const pickerSelectedIds =
    pickerTarget === "analysis"
      ? analysisModelIds
      : [pickerTarget === "judge" ? judgeModel?.id : finalModel?.id].filter((id): id is string => Boolean(id));
  const detectedAgentCount = runners.reduce((count, runner) => count + runner.tools.filter((tool) => tool.status !== "unavailable").length, 0);
  const disabled = isPending || !prompt.trim() || selectedAnalysis.length === 0;

  useEffect(() => {
    const storedSelection = readStoredModelSelection();
    const timeoutId = window.setTimeout(() => {
      if (storedSelection) {
        const storedCustomOptions = customOptionsFromStored(storedSelection);
        const storedOptions = buildModelOptions(models, storedCustomOptions);
        setCustomOptions(storedCustomOptions);
        setPreset(storedSelection.preset ?? "mixed-coding");
        setMode(storedSelection.mode ?? "required");
        setPermissionProfile(storedSelection.permissionProfile ?? "readonly");
        setAnalysisModelIds(storedModelIds(storedSelection.analysisModelIds, storedOptions, 6) ?? defaultAnalysisIds(storedOptions));
        setJudgeModelId(storedModelId(storedSelection.judgeModelId, storedOptions) ?? defaultJudgeId(storedOptions));
        setFinalModelId(storedModelId(storedSelection.finalModelId, storedOptions) ?? defaultFinalId(storedOptions));
      }
      setHasLoadedStoredSelection(true);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [models]);

  useEffect(() => {
    if (!hasLoadedStoredSelection) return;
    writeStoredModelSelection({
      analysisModelIds,
      judgeModelId,
      finalModelId,
      preset,
      mode,
      permissionProfile,
      customModels: customOptions.filter((option) => option.optionSource === "custom").map((option) => ({ adapter: option.adapter, model: option.model })),
    });
  }, [analysisModelIds, customOptions, finalModelId, hasLoadedStoredSelection, judgeModelId, mode, permissionProfile, preset]);

  function openPicker(target: PickerTarget) {
    setPickerTarget(target);
    setIsPickerOpen(true);
  }

  function addCustomOption(adapter: AdapterId, model: string) {
    const sanitizedModel = sanitizeCustomModelId(model);
    if (!sanitizedModel) {
      setError("Model ID can only use letters, numbers, '.', '_', '/', ':', '@', or '-'");
      return false;
    }

    const option = customModel(adapter, sanitizedModel);
    setCustomOptions((current) => (current.some((item) => item.id === option.id) ? current : [...current, option]));
    selectModel(option.id, pickerTarget);
    setError(undefined);
    return true;
  }

  function selectModel(modelId: string, target: PickerTarget) {
    if (target === "analysis") {
      setAnalysisModelIds((current) => {
        if (current.includes(modelId)) {
          return current.length > 1 ? current.filter((id) => id !== modelId) : current;
        }
        return [...current, modelId].slice(0, 6);
      });
      return;
    }

    if (target === "judge") {
      setJudgeModelId(modelId);
    } else {
      setFinalModelId(modelId);
    }
    setIsPickerOpen(false);
  }

  function submit() {
    setError(undefined);
    startTransition(async () => {
      try {
        const run = await apiPost<FusionRunSummary>("/api/fusion/runs", {
          mode,
          preset,
          permissionProfile,
          providerPolicy: selectedAnalysis.length ? "manual" : preset === "mixed-coding" ? "mixed_quality" : "same_provider_first",
          analysisModels: selectedAnalysis.map((model) => model.id),
          judgeModel: judgeModel?.id,
          finalModel: finalModel?.id,
          messages: [{ role: "user", content: prompt }],
          stream: true,
        });
        router.push(`/runs/${run.id}`);
      } catch (submitError) {
        setError(submitError instanceof Error ? submitError.message : "Failed to create run");
      }
    });
  }

  return (
    <div className="grid min-h-screen grid-cols-1 bg-[#050607] text-zinc-100 xl:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="hidden border-r border-white/10 bg-[#08090b] xl:flex xl:flex-col">
        <div className="flex h-14 items-center gap-2 border-b border-white/10 px-5 text-sm font-semibold text-zinc-200">
          <RiGlobalLine aria-hidden className="size-4 text-zinc-500" />
          Open Fusion
        </div>
        <div className="p-4">
          <button className="flex h-9 w-full items-center gap-2 rounded-md bg-white/[0.06] px-3 text-left text-sm font-medium text-zinc-200 hover:bg-white/[0.09]">
            <RiAddLine aria-hidden className="size-4" />
            New Fusion
          </button>
        </div>
        <div className="flex flex-1 items-start justify-center px-5 pt-8 text-sm font-medium text-zinc-600">No runs yet.</div>
        <div className="border-t border-white/10 p-4 text-xs text-zinc-500">
          {runners.length} runners · {detectedAgentCount} tools detected
        </div>
      </aside>

      <section className="flex min-h-screen flex-col">
        <header className="flex h-14 items-center justify-end border-b border-white/10 px-5">
          <nav className="flex items-center gap-5 text-sm font-semibold text-zinc-500">
            <a href="/models" className="hover:text-zinc-200">
              Models
            </a>
            <a href="/chat" className="text-zinc-100">
              Fusion
            </a>
            <a href="/runners" className="hover:text-zinc-200">
              Agents
            </a>
            <a href="/dashboard" className="hover:text-zinc-200">
              Runs
            </a>
          </nav>
        </header>

        <main className="flex flex-1 items-center justify-center px-4 py-16">
          <div className="w-full max-w-[720px]">
            <div className="mb-7 text-center">
              <div className="flex items-center justify-center gap-2">
                <h1 className="text-3xl font-semibold tracking-normal text-white">Model Fusion</h1>
                <span className="rounded-md border border-indigo-400/30 bg-indigo-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-300">beta</span>
              </div>
              <p className="mt-3 text-sm font-medium text-zinc-500">Run local agent models side-by-side, judge the result, then write the final answer.</p>
            </div>

            <div className="overflow-hidden rounded-lg border border-white/15 bg-[#111214] shadow-2xl shadow-black/30">
              <div className="flex flex-col gap-4 p-4">
                <div className="flex flex-wrap gap-2">
                  {modes.map((item) => (
                    <button key={item} type="button" onClick={() => setMode(item)} className={mode === item ? darkPillActive : darkPillInactive}>
                      {item}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {selectedAnalysis.map((model) => (
                    <ModelChip key={model.id} model={model} onRemove={() => setAnalysisModelIds((current) => current.filter((id) => id !== model.id))} />
                  ))}
                  <button type="button" onClick={() => openPicker("analysis")} className="inline-flex h-8 items-center gap-1 rounded-md border border-dashed border-white/20 px-3 text-xs font-semibold text-zinc-400 hover:border-white/40 hover:text-zinc-100">
                    <RiAddLine aria-hidden className="size-3.5" />
                    Add Model
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-zinc-500">
                  <span>Judge</span>
                  <ModelSelectorButton label="Select judge model" model={judgeModel} onClick={() => openPicker("judge")} />
                  <span className="ml-2">Final</span>
                  <ModelSelectorButton label="Select final model" model={finalModel} onClick={() => openPicker("final")} />
                </div>
              </div>

              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                className="min-h-[170px] w-full resize-y border-y border-white/10 bg-[#151618] px-6 py-6 text-sm leading-6 text-zinc-100 outline-none placeholder:text-zinc-600"
                placeholder="Ask anything..."
              />

              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex items-center gap-2 text-zinc-500">
                  <IconButton label="Browse">
                    <RiGlobalLine aria-hidden className="size-4" />
                  </IconButton>
                  <IconButton label="Attach">
                    <RiAttachment2 aria-hidden className="size-4" />
                  </IconButton>
                  <IconButton label="Tools">
                    <RiSparklingLine aria-hidden className="size-4" />
                  </IconButton>
                  <IconButton label="More">
                    <RiMoreLine aria-hidden className="size-4" />
                  </IconButton>
                </div>
                <div className="flex items-center gap-3">
                  {error ? <span className="max-w-[320px] truncate text-xs font-medium text-red-300">{error}</span> : null}
                  <Button onClick={submit} disabled={disabled} size="icon" aria-label="Create run" title="Create run" className="rounded-md bg-indigo-500 text-white hover:bg-indigo-400">
                    {isPending ? <RiLoader4Line aria-hidden className="animate-spin" /> : <RiArrowUpLine aria-hidden />}
                  </Button>
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-2 text-xs text-zinc-500 sm:grid-cols-3">
              <SelectControl label="Preset" value={preset} onChange={(value) => setPreset(value as (typeof presets)[number])} options={presets} />
              <SelectControl label="Permission" value={permissionProfile} onChange={(value) => setPermissionProfile(value as PermissionProfile)} options={permissions} />
              <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
                <span className="block font-semibold text-zinc-400">Selected</span>
                <span>{selectedAnalysis.length} analysis · {judgeModel ? shortModelName(judgeModel) : "auto"} judge</span>
              </div>
            </div>
          </div>
        </main>
      </section>

      {isPickerOpen ? (
        <ModelPicker
          options={allOptions}
          selectedIds={pickerSelectedIds}
          target={pickerTarget}
          onClose={() => setIsPickerOpen(false)}
          onAddCustom={addCustomOption}
          onSelect={(modelId) => selectModel(modelId, pickerTarget)}
        />
      ) : null}
    </div>
  );
}

function ModelPicker({
  options,
  selectedIds,
  target,
  onClose,
  onSelect,
  onAddCustom,
}: {
  options: ModelOption[];
  selectedIds: string[];
  target: PickerTarget;
  onClose: () => void;
  onSelect: (modelId: string) => void;
  onAddCustom: (adapter: AdapterId, model: string) => boolean;
}) {
  const [query, setQuery] = useState("");
  const [adapterFilter, setAdapterFilter] = useState<AdapterId | "all">("all");
  const [customAdapter, setCustomAdapter] = useState<AdapterId>("opencode");
  const [customModel, setCustomModel] = useState("");
  const [customError, setCustomError] = useState<string>();
  const filteredOptions = options.filter((option) => {
    const matchesAdapter = adapterFilter === "all" || option.adapter === adapterFilter;
    const haystack = `${option.displayName ?? ""} ${option.model} ${option.provider ?? ""} ${option.adapter}`.toLowerCase();
    return matchesAdapter && haystack.includes(query.toLowerCase());
  });
  const activeOption = filteredOptions.find((option) => selectedIds.includes(option.id)) ?? filteredOptions[0];

  function submitCustom() {
    const sanitizedModel = sanitizeCustomModelId(customModel);
    if (!sanitizedModel) {
      setCustomError("Use letters, numbers, '.', '_', '/', ':', '@', or '-'");
      return;
    }
    if (onAddCustom(customAdapter, sanitizedModel)) {
      setCustomModel("");
      setCustomError(undefined);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="grid h-[min(560px,calc(100vh-40px))] w-[min(900px,calc(100vw-32px))] grid-cols-1 overflow-hidden rounded-lg border border-white/15 bg-[#0b0c0e] text-zinc-100 shadow-2xl shadow-black/60 md:grid-cols-[1fr_270px]">
        <div className="flex min-h-0 min-w-0 flex-col">
          <div className="flex items-center gap-3 border-b border-white/10 p-3">
            <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border border-white/15 bg-black/20 px-3">
              <RiSearchLine aria-hidden className="size-4 text-zinc-500" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-600"
                placeholder="Search models"
                autoFocus
              />
              <span className="text-xs font-semibold text-zinc-500">{options.length} models</span>
            </div>
            <button type="button" onClick={onClose} className="flex size-9 items-center justify-center rounded-md text-zinc-500 hover:bg-white/10 hover:text-zinc-100" aria-label="Close model picker">
              <RiCloseLine aria-hidden className="size-4" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
            <RiEqualizerLine aria-hidden className="size-4 text-zinc-500" />
            {(["all", ...adapters] as const).map((adapter) => (
              <button key={adapter} type="button" onClick={() => setAdapterFilter(adapter)} className={adapterFilter === adapter ? darkPillActive : darkPillInactive}>
                {adapter === "all" ? "All" : adapterLabel(adapter)}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {filteredOptions.map((option) => {
              const selected = selectedIds.includes(option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onSelect(option.id)}
                  className={cn(
                    "flex w-full items-center gap-3 border-b border-white/10 px-4 py-3 text-left hover:bg-white/[0.06]",
                    selected ? "bg-white/[0.08]" : "bg-transparent",
                  )}
                >
                  <ModelMark model={option} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-zinc-200">{option.displayName ?? option.model}</span>
                    <span className="block truncate text-xs text-zinc-500">
                      {adapterLabel(option.adapter)} · {option.provider ?? "local"} · {option.availability.replace(/_/g, " ")}
                    </span>
                  </span>
                  {selected ? <RiCheckLine aria-hidden className="size-4 text-indigo-300" /> : null}
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-2 border-t border-white/10 p-3 sm:flex-row">
            <select value={customAdapter} onChange={(event) => setCustomAdapter(event.target.value as AdapterId)} className="h-9 rounded-md border border-white/15 bg-[#111214] px-3 text-xs font-semibold text-zinc-300 outline-none">
              {adapters.map((adapter) => (
                <option key={adapter} value={adapter}>
                  {adapterLabel(adapter)}
                </option>
              ))}
            </select>
            <input
              value={customModel}
              onChange={(event) => {
                setCustomModel(event.target.value);
                setCustomError(undefined);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitCustom();
              }}
              className={cn(
                "h-9 min-w-0 flex-1 rounded-md border bg-[#111214] px-3 text-sm outline-none placeholder:text-zinc-600",
                customError ? "border-red-400/70" : "border-white/15",
              )}
              placeholder="provider/model or model-id"
              aria-invalid={Boolean(customError)}
            />
            <button type="button" onClick={submitCustom} className="inline-flex h-9 items-center justify-center gap-1 rounded-md border border-white/20 px-3 text-xs font-semibold text-zinc-300 hover:bg-white/10">
              <RiAddLine aria-hidden className="size-3.5" />
              Add
            </button>
            {customError ? <span className="basis-full text-xs font-medium text-red-300">{customError}</span> : null}
          </div>
        </div>

        <aside className="hidden min-h-0 border-l border-white/10 bg-[#111214] p-4 md:block">
          {activeOption ? (
            <div className="flex h-full flex-col gap-4">
              <div className="flex items-center gap-3">
                <ModelMark model={activeOption} large />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-zinc-100">{activeOption.displayName ?? activeOption.model}</p>
                  <p className="truncate text-xs text-zinc-500">{activeOption.id}</p>
                </div>
              </div>
              <p className="text-sm leading-6 text-zinc-400">
                {target === "analysis" ? "Panel model" : target === "judge" ? "Judge model" : "Final writer"} through {adapterLabel(activeOption.adapter)}.
              </p>
              <div className="mt-auto divide-y divide-white/10 rounded-md border border-white/10 text-xs">
                <DetailRow label="Adapter" value={adapterLabel(activeOption.adapter)} />
                <DetailRow label="Auth" value={activeOption.authMode.replace(/_/g, " ")} />
                <DetailRow label="Provider" value={activeOption.provider ?? "local"} />
                <DetailRow label="Status" value={activeOption.availability.replace(/_/g, " ")} />
              </div>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function ModelChip({ model, onRemove }: { model: ModelOption; onRemove: () => void }) {
  return (
    <span className="inline-flex h-8 items-center gap-2 rounded-md border border-white/15 bg-white/[0.06] px-3 text-xs font-semibold text-zinc-300">
      {shortModelName(model)}
      <button type="button" onClick={onRemove} className="text-zinc-500 hover:text-zinc-100" aria-label={`Remove ${shortModelName(model)}`}>
        <RiCloseLine aria-hidden className="size-3.5" />
      </button>
    </span>
  );
}

function ModelSelectorButton({ label, model, onClick }: { label: string; model?: ModelOption; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex h-8 items-center gap-2 rounded-md border border-dashed border-white/20 px-3 text-xs font-semibold text-zinc-300 hover:border-white/40 hover:text-white"
    >
      {model ? shortModelName(model) : "Auto"}
    </button>
  );
}

function SelectControl<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly T[]; onChange: (value: T) => void }) {
  return (
    <label className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
      <span className="block font-semibold text-zinc-400">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as T)} className="mt-1 w-full bg-transparent text-xs text-zinc-500 outline-none">
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function IconButton({ label, children }: { label: string; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} className="flex size-8 items-center justify-center rounded-md hover:bg-white/10 hover:text-zinc-200">
      {children}
    </button>
  );
}

function ModelMark({ model, large = false }: { model: ModelOption; large?: boolean }) {
  const Icon = model.adapter === "codex" ? RiCodeSSlashLine : model.adapter === "opencode" ? RiRobot2Line : RiStackLine;
  return (
    <span className={cn("flex shrink-0 items-center justify-center rounded-md bg-white text-black", large ? "size-10" : "size-7")}>
      <Icon aria-hidden className={large ? "size-5" : "size-4"} />
    </span>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <span className="text-zinc-500">{label}</span>
      <span className="truncate text-zinc-300">{value}</span>
    </div>
  );
}

function buildModelOptions(models: ModelRef[], customOptions: ModelOption[]) {
  const options = new Map<string, ModelOption>();
  for (const model of models) {
    options.set(model.id, { ...model, optionSource: "detected" });
  }
  for (const model of suggestedModels) {
    if (!options.has(model.id)) options.set(model.id, model);
  }
  for (const model of customOptions) {
    options.set(model.id, model);
  }

  return [...options.values()].sort((a, b) => sourceScore(a.optionSource) - sourceScore(b.optionSource) || a.adapter.localeCompare(b.adapter) || a.model.localeCompare(b.model));
}

function defaultAnalysisIds(options: ModelOption[]) {
  const detected = options.filter((option) => option.optionSource === "detected" && option.availability !== "unavailable").slice(0, 4);
  if (detected.length >= 2) return detected.map((option) => option.id);

  const preferred = ["opencode/minimax/minimax-m1", "opencode/deepseek/deepseek-chat", "opencode/moonshotai/kimi-k2"];
  return preferred.filter((id) => options.some((option) => option.id === id));
}

function defaultJudgeId(options: ModelOption[]) {
  return options.find((option) => option.id === "codex/gpt-5.5")?.id ?? options.find((option) => option.adapter === "codex")?.id ?? options[0]?.id ?? "";
}

function defaultFinalId(options: ModelOption[]) {
  return options.find((option) => option.id === "codex/gpt-5-codex")?.id ?? options.find((option) => option.adapter === "codex")?.id ?? options[0]?.id ?? "";
}

function suggestedModel(adapter: AdapterId, model: string, displayName: string, provider: string): ModelOption {
  return {
    id: `${adapter}/${model}`,
    adapter,
    provider,
    model,
    displayName,
    authMode: adapter === "cloudflare-ai-gateway" ? "cloud_gateway" : adapter === "api-key" ? "api_key" : "cli_session",
    availability: "configured_unverified",
    source: "suggested",
    optionSource: "suggested",
    capabilities: {
      streaming: true,
      tools: adapter !== "api-key",
      fileEdits: adapter === "opencode" || adapter === "codex",
      shell: adapter === "opencode" || adapter === "codex",
      jsonOutput: true,
      modelListing: false,
    },
  };
}

function customModel(adapter: AdapterId, model: string): ModelOption {
  const provider = adapter === "codex" ? "openai" : model.includes("/") ? model.split("/")[0] : adapter;
  return {
    ...suggestedModel(adapter, model, model, provider),
    source: "custom",
    optionSource: "custom",
  };
}

function adapterLabel(adapter: AdapterId) {
  const labels: Record<AdapterId, string> = {
    opencode: "OpenCode",
    claude: "Claude Code",
    codex: "Codex",
    "cursor-agent": "Cursor Agent",
    gemini: "Gemini",
    qwen: "Qwen",
    qoder: "Qoder",
    copilot: "Copilot",
    deepseek: "DeepSeek",
    kimi: "Kimi",
    hermes: "Hermes",
    pi: "Pi",
    aider: "Aider",
    devin: "Devin",
    "grok-build": "Grok Build",
    amp: "Amp",
    kiro: "Kiro",
    kilo: "Kilo",
    vibe: "Vibe",
    "trae-cli": "Trae CLI",
    codebuddy: "Codebuddy",
    reasonix: "Reasonix",
    antigravity: "Antigravity",
    "api-key": "API key",
    "cloudflare-ai-gateway": "AI Gateway",
  };
  return labels[adapter];
}

function shortModelName(model: Pick<ModelRef, "displayName" | "model">) {
  return model.displayName ?? model.model.split("/").at(-1) ?? model.model;
}

function sourceScore(source: OptionSource) {
  return source === "detected" ? 0 : source === "suggested" ? 1 : 2;
}

function readStoredModelSelection(): StoredModelSelection | undefined {
  if (typeof window === "undefined") return undefined;

  const rawValue = window.localStorage.getItem(modelSelectionStorageKey);
  if (!rawValue) return undefined;

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    return sanitizeStoredModelSelection(parsed);
  } catch {
    return undefined;
  }
}

function writeStoredModelSelection(selection: StoredModelSelection) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(modelSelectionStorageKey, JSON.stringify(selection));
}

function sanitizeStoredModelSelection(value: Partial<StoredModelSelection>): StoredModelSelection {
  const customModels = Array.isArray(value.customModels)
    ? value.customModels.flatMap((item) => {
        if (!item || typeof item !== "object" || !isOneOf(adapters, item.adapter)) return [];
        const model = sanitizeCustomModelId(item.model);
        return model ? [{ adapter: item.adapter, model }] : [];
      })
    : undefined;

  return {
    analysisModelIds: Array.isArray(value.analysisModelIds)
      ? value.analysisModelIds
          .flatMap((id) => {
            const modelId = sanitizeStoredModelId(id);
            return modelId ? [modelId] : [];
          })
          .slice(0, 6)
      : undefined,
    judgeModelId: sanitizeStoredModelId(value.judgeModelId) ?? undefined,
    finalModelId: sanitizeStoredModelId(value.finalModelId) ?? undefined,
    preset: isOneOf(presets, value.preset) ? value.preset : undefined,
    mode: isOneOf(modes, value.mode) ? value.mode : undefined,
    permissionProfile: isOneOf(permissions, value.permissionProfile) ? value.permissionProfile : undefined,
    customModels,
  };
}

function customOptionsFromStored(selection?: StoredModelSelection) {
  return (selection?.customModels ?? []).map((item) => customModel(item.adapter, item.model));
}

function storedModelIds(ids: string[] | undefined, options: ModelOption[], limit: number) {
  const optionIds = new Set(options.map((option) => option.id));
  const validIds = (ids ?? []).filter((id) => optionIds.has(id)).slice(0, limit);
  return validIds.length ? validIds : undefined;
}

function storedModelId(id: string | undefined, options: ModelOption[]) {
  if (!id) return undefined;
  return options.some((option) => option.id === id) ? id : undefined;
}

function sanitizeStoredModelId(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 200 || /[\x00-\x1F\x7F]/.test(trimmed)) return null;
  return trimmed;
}

function isOneOf<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

const darkPillActive = "h-8 rounded-full bg-zinc-100 px-3 text-xs font-semibold text-zinc-950";
const darkPillInactive = "h-8 rounded-full bg-white/[0.04] px-3 text-xs font-semibold text-zinc-500 hover:bg-white/[0.08] hover:text-zinc-200";
