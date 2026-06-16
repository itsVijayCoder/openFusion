import type { FusionRunRequest } from "@fusion-harness/shared";

export function shouldUseFusion(request: FusionRunRequest) {
  if (request.mode === "required") return true;
  if (request.mode === "direct") return false;

  const prompt = request.messages.map((message) => message.content).join("\n").toLowerCase();
  return ["architecture", "security", "migration", "high risk", "ambiguous"].some((trigger) => prompt.includes(trigger));
}
