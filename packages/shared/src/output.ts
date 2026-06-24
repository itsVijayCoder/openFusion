const textEventTypes = new Set([
  "text",
  "message",
  "agent_message",
  "assistant_message",
  "response.output_text.delta",
  "response.output_text.done",
]);

export function extractReadableOutput(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) return "";

  const fragments: string[] = [];
  for (const line of value.split(/\r?\n/)) {
    const parsed = parseJson(line.trim());
    if (parsed !== undefined) collectTextFragments(parsed, fragments, 0);
  }

  const text = fragments.join("");
  return text.trim() ? text.trim() : value;
}

function collectTextFragments(value: unknown, fragments: string[], depth: number) {
  if (!value || typeof value !== "object" || depth > 8) return;
  if (Array.isArray(value)) {
    for (const item of value) collectTextFragments(item, fragments, depth + 1);
    return;
  }

  const record = value as Record<string, unknown>;

  const type = stringValue(record.type);
  const text = stringValue(record.text);
  const delta = stringValue(record.delta);
  const content = stringValue(record.content);

  if (type && textEventTypes.has(type) && text) {
    fragments.push(text);
    return;
  }
  if (type && textEventTypes.has(type) && delta) {
    fragments.push(delta);
    return;
  }
  if (type && textEventTypes.has(type) && content) {
    fragments.push(content);
    return;
  }

  const part = record.part;
  if (isRecord(part)) {
    const partType = stringValue(part.type);
    const partText = stringValue(part.text);
    if (partType === "text" && partText) {
      fragments.push(partText);
      return;
    }
  }

  for (const key of Object.keys(record)) {
    const child = record[key];
    if (child && typeof child === "object") {
      collectTextFragments(child, fragments, depth + 1);
    }
  }
}

function parseJson(value: string) {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}
