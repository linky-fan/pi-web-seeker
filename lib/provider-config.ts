export interface HeaderEdit {
  index?: number;
  key?: string;
  value?: string;
  remove?: number;
}

/**
 * Applies one edit to a header map. Rows are addressed by index because a key can
 * be mid-typing; blank keys are dropped and an empty result clears the field.
 */
export function applyHeaderEdit(
  headers: Record<string, string> | undefined,
  edit: HeaderEdit,
): Record<string, string> | undefined {
  const rows = Object.entries(headers ?? {});

  if (edit.remove !== undefined) {
    rows.splice(edit.remove, 1);
  } else if (edit.index !== undefined) {
    const current = rows[edit.index] ?? ["", ""];
    rows[edit.index] = [edit.key ?? current[0], edit.value ?? current[1]];
  } else {
    rows.push(["", ""]);
  }

  const record: Record<string, string> = {};
  for (const [key, value] of rows) {
    const trimmed = key.trim();
    if (trimmed) record[trimmed] = value;
  }
  return Object.keys(record).length ? record : undefined;
}

export const KNOWN_API_PROTOCOLS = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
  "mistral-conversations",
  "azure-openai-responses",
  "openai-codex-responses",
  "bedrock-converse-stream",
  "google-vertex",
  "pi-messages",
] as const;

/** True when the stored protocol is not one of the known options. */
export function isCustomApiProtocol(api: string | undefined): boolean {
  if (!api) return false;
  return !(KNOWN_API_PROTOCOLS as readonly string[]).includes(api);
}