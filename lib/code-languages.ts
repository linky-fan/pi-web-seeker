/** Language names the app registers with Prism. Kept dependency-free so tests can import it. */
export const HIGHLIGHT_LANGUAGES = [
  "bash", "c", "cpp", "csharp", "css", "diff", "docker", "go", "graphql", "hcl",
  "ini", "java", "javascript", "json", "jsx", "kotlin", "makefile", "markdown",
  "markup", "objectivec", "perl", "php", "powershell", "properties", "python",
  "r", "ruby", "rust", "scala", "sql", "swift", "toml", "tsx", "typescript", "yaml",
] as const;

export type HighlightLanguage = typeof HIGHLIGHT_LANGUAGES[number];

export const REGISTERED_LANGUAGES: readonly string[] = HIGHLIGHT_LANGUAGES;

// Bare "text"/"txt" has no grammar; highlighting is skipped and the code renders plain.
export function normalizeLanguage(language: string): string {
  const normalized = language.trim().toLowerCase();
  if (!normalized || normalized === "text" || normalized === "txt" || normalized === "plaintext") return "text";
  return normalized;
}