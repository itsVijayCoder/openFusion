import type { JudgeResult } from "./judge";

export function summarizeFinalStrategy(judge: JudgeResult) {
  return judge.recommended_final_strategy;
}
