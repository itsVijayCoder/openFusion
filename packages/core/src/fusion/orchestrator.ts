import type { FusionRunRequest, ModelRef } from "@fusion-harness/shared";
import { selectFusionModels } from "../models/selection";

export function planFusionRun(request: FusionRunRequest, availableModels: ModelRef[]) {
  return selectFusionModels({
    availableModels,
    preset: request.preset ?? "same-provider-first",
    requestedModels: request.analysisModels,
    providerPolicy: request.providerPolicy ?? "same_provider_first",
    maxPanelModels: request.mode === "direct" ? 1 : 4,
  });
}
