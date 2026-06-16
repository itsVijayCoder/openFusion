import type { ModelRef } from "@fusion-harness/shared";

export type ModelSelectionInput = {
  availableModels: ModelRef[];
  preset: string;
  requestedModels?: string[];
  providerPolicy?: "same_provider_first" | "mixed_quality" | "manual";
  maxPanelModels: number;
};

export type SelectedFusionModels = {
  panel: ModelRef[];
  judge?: ModelRef;
  final?: ModelRef;
};

export function selectFusionModels(input: ModelSelectionInput): SelectedFusionModels {
  if (input.requestedModels?.length) {
    return buildSelection(selectManual(input.availableModels, input.requestedModels), input.maxPanelModels);
  }

  const usableModels = input.availableModels.filter(isUsable);

  if (input.providerPolicy === "same_provider_first") {
    const sameProvider = pickBestProviderGroup(usableModels, input.maxPanelModels);
    if (sameProvider.length >= 2) {
      return buildSelection(sameProvider, input.maxPanelModels);
    }
  }

  return buildSelection(selectMixedQuality(usableModels, input.maxPanelModels), input.maxPanelModels);
}

function isUsable(model: ModelRef) {
  return model.availability !== "unavailable";
}

function selectManual(models: ModelRef[], requestedModels: string[]) {
  const requested = new Set(requestedModels);
  return models.filter((model) => requested.has(model.id) || requested.has(model.model));
}

function pickBestProviderGroup(models: ModelRef[], limit: number) {
  const groups = new Map<string, ModelRef[]>();

  for (const model of models) {
    const providerKey = model.provider ?? model.adapter;
    groups.set(providerKey, [...(groups.get(providerKey) ?? []), model]);
  }

  return [...groups.values()].sort((a, b) => b.length - a.length)[0]?.slice(0, limit) ?? [];
}

function selectMixedQuality(models: ModelRef[], limit: number) {
  return [...models].sort((a, b) => scoreModel(b) - scoreModel(a)).slice(0, limit);
}

function buildSelection(models: ModelRef[], limit: number): SelectedFusionModels {
  const panel = models.slice(0, Math.max(1, limit));
  return {
    panel,
    judge: panel[0],
    final: panel[panel.length - 1],
  };
}

function scoreModel(model: ModelRef) {
  const availabilityBonus = model.availability === "verified" ? 2 : model.availability === "listed" ? 1 : 0;
  const capabilityBonus = Object.values(model.capabilities).filter(Boolean).length / 10;
  return availabilityBonus + capabilityBonus;
}
