export type ThemeId = "mist" | "ink" | "sage" | "rose" | "midnight";

export interface ThemeOption {
  id: ThemeId;
  label: string;
  accent: string;
  surface: string;
  isDark: boolean;
}

export const THEME_OPTIONS: ThemeOption[] = [
  { id: "mist", label: "Mist", accent: "#2563eb", surface: "#f5f5f5", isDark: false },
  { id: "ink", label: "Ink", accent: "#60a5fa", surface: "#242424", isDark: true },
  { id: "sage", label: "Sage", accent: "#0f766e", surface: "#f1f5ef", isDark: false },
  { id: "rose", label: "Rose", accent: "#be123c", surface: "#fff1f2", isDark: false },
  { id: "midnight", label: "Midnight", accent: "#34d399", surface: "#161b18", isDark: true },
];

export const DEFAULT_THEME: ThemeId = "mist";

export function normalizeTheme(value: string | null | undefined): ThemeId {
  if (value === "light") return "mist";
  if (value === "dark") return "ink";
  return THEME_OPTIONS.some((theme) => theme.id === value) ? value as ThemeId : DEFAULT_THEME;
}

export function getThemeOption(id: ThemeId): ThemeOption {
  return THEME_OPTIONS.find((theme) => theme.id === id) ?? THEME_OPTIONS[0];
}

export function getNextTheme(id: ThemeId): ThemeId {
  const index = THEME_OPTIONS.findIndex((theme) => theme.id === id);
  return THEME_OPTIONS[(index + 1) % THEME_OPTIONS.length].id;
}
