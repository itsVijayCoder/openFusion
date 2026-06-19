import type { FusionRunRequest, ModelRef } from "@fusion-harness/shared";
import { buildJudgeSynthesisPrompt, buildPanelPrompt } from "./prompt-builder";
import { classifyFusionNeed } from "./planner";
import { selectFusionModels } from "../models/selection";

const defaultPanelRoles = ["architect", "critic", "implementer", "risk-reviewer", "test-planner", "maintainer"] as const;

export type FusionPlanStep =
  | {
      kind: "direct";
      model?: ModelRef;
      prompt: string;
    }
  | {
      kind: "panel";
      model: ModelRef;
      role: string;
      prompt: string;
    }
  | {
      kind: "judge";
      model?: ModelRef;
      prompt: string;
    };

export type FusionExecutionPlan = {
  useFusion: boolean;
  reason: string;
  preset: string;
  models: ReturnType<typeof selectFusionModels>;
  steps: FusionPlanStep[];
};

export function planFusionRun(request: FusionRunRequest, availableModels: ModelRef[]) {
  return selectFusionModels({
    availableModels,
    preset: request.preset ?? "same-provider-first",
    requestedModels: request.analysisModels,
    requestedJudgeModel: request.judgeModel,
    requestedFinalModel: request.finalModel,
    providerPolicy: request.providerPolicy ?? "same_provider_first",
    maxPanelModels: request.mode === "direct" ? 1 : 4,
  });
}

export function buildFusionExecutionPlan(request: FusionRunRequest, availableModels: ModelRef[]): FusionExecutionPlan {
  const fusionNeed = classifyFusionNeed(request);
  const models = planFusionRun(
    {
      ...request,
      mode: fusionNeed.useFusion ? request.mode : "direct",
    },
    availableModels,
  );
  const userPrompt = request.messages.map((message) => `${message.role}: ${message.content}`).join("\n\n");

  if (!fusionNeed.useFusion) {
    return {
      useFusion: false,
      reason: fusionNeed.reason,
      preset: request.preset ?? "same-provider-first",
      models,
      steps: [
        {
          kind: "direct",
          model: models.panel[0],
          prompt: userPrompt,
        },
      ],
    };
  }

  const panelSteps = models.panel.map((model, index) => ({
    kind: "panel" as const,
    model,
    role: defaultPanelRoles[index] ?? `panel-${index + 1}`,
    prompt: buildPanelPrompt(userPrompt, defaultPanelRoles[index] ?? `panel-${index + 1}`),
  }));

  return {
    useFusion: true,
    reason: fusionNeed.reason,
    preset: request.preset ?? "same-provider-first",
    models,
    steps: [
      ...panelSteps,
      {
        kind: "judge",
        model: models.judge,
        prompt: buildJudgeSynthesisPrompt(userPrompt),
      },
    ],
  };
}
