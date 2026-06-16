import type { ModelRef } from "@fusion-harness/shared";

export function groupModelsByAdapter(models: ModelRef[]) {
  const groups = new Map<ModelRef["adapter"], ModelRef[]>();

  for (const model of models) {
    groups.set(model.adapter, [...(groups.get(model.adapter) ?? []), model]);
  }

  return groups;
}
