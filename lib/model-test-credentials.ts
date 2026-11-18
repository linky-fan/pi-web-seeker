export type LiteralCredentialRejection = "empty" | "command" | "env-reference";

const ENV_REFERENCE = /\$(?:\$|!|[A-Za-z_]|\{[A-Za-z_][A-Za-z0-9_]*\})/;

/**
 * Connection tests must send exactly what the form contains. Values starting with "!"
 * run a shell command and "$NAME"/"${NAME}"/"$$"/"$!" templates are resolved by pi, so
 * neither may pass through.
 */
export function literalCredentialRejection(value: string): LiteralCredentialRejection | null {
  if (!value.trim()) return "empty";
  if (value.startsWith("!")) return "command";
  if (ENV_REFERENCE.test(value)) return "env-reference";
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function headerRejection(headers: unknown): string | null {
  if (!isRecord(headers)) return null;
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === "string" && literalCredentialRejection(value)) return name;
  }
  return null;
}

/** Returns the first provider/model header whose value is not a literal. */
export function nonLiteralHeaderName(provider: unknown, model: unknown): string | null {
  const providerHeader = isRecord(provider) ? headerRejection(provider.headers) : null;
  if (providerHeader) return providerHeader;

  const modelHeader = isRecord(model) ? headerRejection(model.headers) : null;
  if (modelHeader) return modelHeader;

  if (isRecord(provider) && isRecord(provider.modelOverrides)) {
    for (const override of Object.values(provider.modelOverrides)) {
      if (!isRecord(override)) continue;
      const name = headerRejection(override.headers);
      if (name) return name;
    }
  }
  return null;
}