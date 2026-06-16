export function buildPanelPrompt(userPrompt: string, role: string) {
  return [
    "You are one member of a multi-model analysis panel.",
    "",
    "Original task:",
    userPrompt,
    "",
    "Your role:",
    role,
  ].join("\n");
}
