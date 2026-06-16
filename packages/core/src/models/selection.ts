import { sanitizeCustomModelId, type AdapterId, type FusionProviderPolicy, type ModelRef } from "@fusion-harness/shared";

export type ModelSelectionInput = {
  availableModels: ModelRef[];
  preset: string;
  requestedModels?: string[];
  requestedJudgeModel?: string;
  requestedFinalModel?: string;
  providerPolicy?: FusionProviderPolicy;
  maxPanelModels: number;
};

export type SelectedFusionModels = {
  panel: ModelRef[];
  judge?: ModelRef;
  final?: ModelRef;
};

const localCodingAdapters: AdapterId[] = [
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
];

export function selectFusionModels(input: ModelSelectionInput): SelectedFusionModels {
  const preset = resolvePreset(input.preset);
  const maxPanelModels = Math.max(1, Math.min(input.maxPanelModels || preset.maxPanelModels, preset.maxPanelModels));
  const availableModels = filterByPreset(input.availableModels, preset.adapters);
  const fallbackAdapter = preset.adapters?.[0];
  const buildSelectionWithOverrides = (panelModels: ModelRef[]) =>
    buildSelection(panelModels, maxPanelModels, {
      availableModels: input.availableModels,
      requestedJudgeModel: input.requestedJudgeModel,
      requestedFinalModel: input.requestedFinalModel,
      fallbackAdapter,
    });

  if (input.requestedModels?.length) {
    return buildSelectionWithOverrides(selectManual(availableModels, input.requestedModels, fallbackAdapter));
  }

  const usableModels = availableModels.filter(isUsable);
  const providerPolicy = input.providerPolicy ?? preset.providerPolicy;

  if (providerPolicy === "same_provider_first") {
    const sameProvider = pickBestProviderGroup(usableModels, maxPanelModels);
    if (sameProvider.length >= 2) {
      return buildSelectionWithOverrides(sameProvider);
    }
  }

  return buildSelectionWithOverrides(selectMixedQuality(usableModels, maxPanelModels));
}

function isUsable(model: ModelRef) {
  return model.availability !== "unavailable" && model.authMode !== "unknown";
}

function selectManual(models: ModelRef[], requestedModels: string[], fallbackAdapter?: AdapterId) {
  return dedupeModels(
    requestedModels.flatMap((requestedModel) => {
      const match = resolveRequestedModel(models, requestedModel, fallbackAdapter);
      return match && isUsable(match) ? [match] : [];
    }),
  );
}

function pickBestProviderGroup(models: ModelRef[], limit: number) {
  const groups = new Map<string, ModelRef[]>();

  for (const model of models) {
    const providerKey = model.provider ?? model.adapter;
    groups.set(providerKey, [...(groups.get(providerKey) ?? []), model]);
  }

  return [...groups.values()]
    .map((group) => selectMixedQuality(group, limit))
    .sort((a, b) => groupScore(b) - groupScore(a))[0] ?? [];
}

function selectMixedQuality(models: ModelRef[], limit: number) {
  return [...models].sort((a, b) => scoreModel(b) - scoreModel(a)).slice(0, limit);
}

function buildSelection(
  models: ModelRef[],
  limit: number,
  overrides: {
    availableModels: ModelRef[];
    requestedJudgeModel?: string;
    requestedFinalModel?: string;
    fallbackAdapter?: AdapterId;
  },
): SelectedFusionModels {
  const panel = models.slice(0, Math.max(1, limit));
  const fallbackAdapter = overrides.fallbackAdapter ?? panel[0]?.adapter;
  const requestedJudge = overrides.requestedJudgeModel
    ? resolveRequestedModel(overrides.availableModels, overrides.requestedJudgeModel, fallbackAdapter)
    : undefined;
  const requestedFinal = overrides.requestedFinalModel
    ? resolveRequestedModel(overrides.availableModels, overrides.requestedFinalModel, fallbackAdapter)
    : undefined;
  const judge = requestedJudge && isUsable(requestedJudge) ? requestedJudge : pickJudge(panel);
  const final = requestedFinal && isUsable(requestedFinal) ? requestedFinal : pickFinal(panel);

  return {
    panel,
    judge,
    final,
  };
}

function scoreModel(model: ModelRef) {
  const availabilityBonus = model.availability === "verified" ? 4 : model.availability === "listed" ? 2 : 1;
  const authBonus = model.authMode === "cli_session" || model.authMode === "cloud_gateway" ? 2 : model.authMode === "api_key" ? 1 : 0;
  const toolCapabilityBonus = (model.capabilities.tools ? 1 : 0) + (model.capabilities.fileEdits ? 1 : 0) + (model.capabilities.shell ? 1 : 0);
  const structuredOutputBonus = model.capabilities.jsonOutput ? 0.75 : 0;
  const streamingBonus = model.capabilities.streaming ? 0.25 : 0;

  return availabilityBonus + authBonus + toolCapabilityBonus + structuredOutputBonus + streamingBonus;
}

function groupScore(models: ModelRef[]) {
  return models.reduce((score, model) => score + scoreModel(model), 0) + Math.min(models.length, 4);
}

function pickJudge(panel: ModelRef[]) {
  return [...panel].sort((a, b) => Number(b.capabilities.jsonOutput) - Number(a.capabilities.jsonOutput) || scoreModel(b) - scoreModel(a))[0];
}

function pickFinal(panel: ModelRef[]) {
  return [...panel].sort(
    (a, b) =>
      Number(b.capabilities.fileEdits || b.capabilities.tools) - Number(a.capabilities.fileEdits || a.capabilities.tools) ||
      scoreModel(b) - scoreModel(a),
  )[0];
}

function filterByPreset(models: ModelRef[], adapters?: AdapterId[]) {
  if (!adapters?.length) return models;
  const allowed = new Set(adapters);
  return models.filter((model) => allowed.has(model.adapter));
}

function resolveRequestedModel(models: ModelRef[], requestedModel: string, fallbackAdapter?: AdapterId): ModelRef | undefined {
  const normalized = requestedModel.trim();
  if (!normalized) return undefined;

  const match = models.find(
    (model) =>
      model.id === normalized ||
      model.model === normalized ||
      `${model.adapter}/${model.model}` === normalized ||
      (model.provider ? `${model.provider}/${model.model}` === normalized : false),
  );

  if (match) return match;
  const customModel = sanitizeCustomModelId(normalized);
  if (!customModel) return undefined;
  return synthesizeModel(customModel, fallbackAdapter);
}

function synthesizeModel(requestedModel: string, fallbackAdapter?: AdapterId): ModelRef {
  const [firstSegment, ...rest] = requestedModel.split("/");
  const knownAdapter = isAdapterId(firstSegment) ? firstSegment : undefined;
  const adapter = knownAdapter ?? fallbackAdapter ?? (requestedModel.includes("/") ? "opencode" : "codex");
  const model = knownAdapter ? rest.join("/") : requestedModel;

  return {
    id: `${adapter}/${model}`,
    adapter,
    provider: inferProvider(adapter, model),
    model,
    displayName: model,
    authMode: adapter === "cloudflare-ai-gateway" ? "cloud_gateway" : adapter === "api-key" ? "api_key" : "cli_session",
    availability: "configured_unverified",
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

function inferProvider(adapter: AdapterId, model: string) {
  const adapterProvider: Partial<Record<AdapterId, string>> = {
    claude: "anthropic",
    codex: "openai",
    gemini: "google",
    qwen: "qwen",
    deepseek: "deepseek",
    kimi: "moonshotai",
    "grok-build": "xai",
    reasonix: "deepseek",
  };
  if (adapterProvider[adapter]) return adapterProvider[adapter];
  const [provider] = model.split("/");
  return provider && provider !== model ? provider : adapter;
}

function isAdapterId(value: string): value is AdapterId {
  return (
    value === "opencode" ||
    value === "claude" ||
    value === "codex" ||
    value === "cursor-agent" ||
    value === "gemini" ||
    value === "qwen" ||
    value === "qoder" ||
    value === "copilot" ||
    value === "deepseek" ||
    value === "kimi" ||
    value === "hermes" ||
    value === "pi" ||
    value === "aider" ||
    value === "devin" ||
    value === "grok-build" ||
    value === "amp" ||
    value === "kiro" ||
    value === "kilo" ||
    value === "vibe" ||
    value === "trae-cli" ||
    value === "codebuddy" ||
    value === "reasonix" ||
    value === "antigravity" ||
    value === "api-key" ||
    value === "cloudflare-ai-gateway"
  );
}

function dedupeModels(models: ModelRef[]) {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
}

function resolvePreset(preset: string): { maxPanelModels: number; providerPolicy: FusionProviderPolicy; adapters?: AdapterId[] } {
  switch (preset) {
    case "opencode-quality":
      return { maxPanelModels: 4, providerPolicy: "same_provider_first", adapters: ["opencode"] };
    case "codex-quality":
      return { maxPanelModels: 4, providerPolicy: "same_provider_first", adapters: ["codex"] };
    case "mixed-coding":
      return { maxPanelModels: 6, providerPolicy: "mixed_quality", adapters: localCodingAdapters };
    case "fast":
    case "budget":
      return { maxPanelModels: 2, providerPolicy: "mixed_quality" };
    case "same-provider-first":
    default:
      return { maxPanelModels: 5, providerPolicy: "same_provider_first" };
  }
}
