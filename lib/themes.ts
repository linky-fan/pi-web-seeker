export type ThemeId =
  | "mist"
  | "ink"
  | "sage"
  | "rose"
  | "midnight"
  | "solarized"
  | "gruvbox"
  | "catppuccin"
  | "lavender"
  | "cobalt";

export interface ThemeVars {
  bg: string;
  bgPanel: string;
  bgHover: string;
  bgSelected: string;
  border: string;
  text: string;
  textMuted: string;
  textDim: string;
  accent: string;
  accentHover: string;
  userBg: string;
  assistantBg: string;
  toolBg: string;
  bgSubtle: string;
}

export interface ThemeOption {
  id: ThemeId;
  label: string;
  accent: string;
  surface: string;
  isDark: boolean;
  vars: ThemeVars;
}

export const THEME_OPTIONS: ThemeOption[] = [
  { id: "mist", label: "Mist", accent: "#2563eb", surface: "#f5f5f5", isDark: false, vars: { bg: "#ffffff", bgPanel: "#f5f5f5", bgHover: "#eeeeee", bgSelected: "#e8e8e8", border: "#e0e0e0", text: "#1a1a1a", textMuted: "#6b7280", textDim: "#9ca3af", accent: "#2563eb", accentHover: "#1d4ed8", userBg: "#eff6ff", assistantBg: "#ffffff", toolBg: "#f9fafb", bgSubtle: "rgba(0,0,0,0.03)" } },
  { id: "sage", label: "Sage", accent: "#0f766e", surface: "#eaf2df", isDark: false, vars: { bg: "#f8fcf1", bgPanel: "#eaf2df", bgHover: "#dceacb", bgSelected: "#d0e1bf", border: "#c5d6b8", text: "#18231d", textMuted: "#607065", textDim: "#8b9a90", accent: "#0f766e", accentHover: "#0d5f59", userBg: "#e8f6f3", assistantBg: "#fbfdf9", toolBg: "#f5f8f2", bgSubtle: "rgba(15,118,110,0.06)" } },
  { id: "rose", label: "Rose", accent: "#be123c", surface: "#fff1f2", isDark: false, vars: { bg: "#fff8fb", bgPanel: "#ffeaf1", bgHover: "#ffd9e5", bgSelected: "#ffc8da", border: "#efb8c8", text: "#26191d", textMuted: "#745f66", textDim: "#a68c94", accent: "#be123c", accentHover: "#9f1239", userBg: "#fff0f3", assistantBg: "#fffafa", toolBg: "#fff6f0", bgSubtle: "rgba(190,18,60,0.05)" } },
  { id: "solarized", label: "Solarized", accent: "#006cb4", surface: "#eee8d5", isDark: false, vars: { bg: "#fdf6e3", bgPanel: "#eee8d5", bgHover: "#e4dac0", bgSelected: "#d8cfb5", border: "#c8bea6", text: "#073642", textMuted: "#586e75", textDim: "#839496", accent: "#006cb4", accentHover: "#005a96", userBg: "#e5f2f2", assistantBg: "#fdf6e3", toolBg: "#f7efd9", bgSubtle: "rgba(0,108,180,0.07)" } },
  { id: "lavender", label: "Lavender", accent: "#7c3aed", surface: "#f3eefa", isDark: false, vars: { bg: "#fcfaff", bgPanel: "#f3eefa", bgHover: "#eae2f5", bgSelected: "#ded2ed", border: "#d7cbe3", text: "#241b2e", textMuted: "#6e617a", textDim: "#a395af", accent: "#7c3aed", accentHover: "#6d28d9", userBg: "#f0e7ff", assistantBg: "#fcfaff", toolBg: "#f7f2fb", bgSubtle: "rgba(124,58,237,0.055)" } },
  { id: "ink", label: "Ink", accent: "#60a5fa", surface: "#242424", isDark: true, vars: { bg: "#1a1a1a", bgPanel: "#242424", bgHover: "#2e2e2e", bgSelected: "#383838", border: "#3a3a3a", text: "#e8e8e8", textMuted: "#9ca3af", textDim: "#6b7280", accent: "#60a5fa", accentHover: "#93c5fd", userBg: "#1e293b", assistantBg: "#1a1a1a", toolBg: "#1f2937", bgSubtle: "rgba(255,255,255,0.04)" } },
  { id: "midnight", label: "Midnight", accent: "#34d399", surface: "#161b18", isDark: true, vars: { bg: "#101312", bgPanel: "#161b18", bgHover: "#1d2823", bgSelected: "#24362f", border: "#2b3933", text: "#e8eee9", textMuted: "#a6b3ab", textDim: "#6f7c74", accent: "#34d399", accentHover: "#6ee7b7", userBg: "#10251f", assistantBg: "#101312", toolBg: "#151f1b", bgSubtle: "rgba(52,211,153,0.08)" } },
  { id: "gruvbox", label: "Gruvbox", accent: "#fabd2f", surface: "#282828", isDark: true, vars: { bg: "#1d2021", bgPanel: "#282828", bgHover: "#32302f", bgSelected: "#3c3836", border: "#504945", text: "#ebdbb2", textMuted: "#c7b99a", textDim: "#928374", accent: "#fabd2f", accentHover: "#fecc5c", userBg: "#332b1d", assistantBg: "#1d2021", toolBg: "#262421", bgSubtle: "rgba(250,189,47,0.08)" } },
  { id: "catppuccin", label: "Catppuccin", accent: "#cba6f7", surface: "#1e1e2e", isDark: true, vars: { bg: "#181825", bgPanel: "#1e1e2e", bgHover: "#272739", bgSelected: "#313244", border: "#45475a", text: "#cdd6f4", textMuted: "#a6adc8", textDim: "#6c7086", accent: "#cba6f7", accentHover: "#ddb6ff", userBg: "#2b223b", assistantBg: "#181825", toolBg: "#1d1d2b", bgSubtle: "rgba(203,166,247,0.08)" } },
  { id: "cobalt", label: "Cobalt", accent: "#ff9f6e", surface: "#0d2855", isDark: true, vars: { bg: "#081a3a", bgPanel: "#0d2855", bgHover: "#15366e", bgSelected: "#204581", border: "#2d5590", text: "#f3f7ff", textMuted: "#a9bde0", textDim: "#6f89b5", accent: "#ff9f6e", accentHover: "#ffb48e", userBg: "#173664", assistantBg: "#081a3a", toolBg: "#0b2249", bgSubtle: "rgba(255,159,110,0.09)" } },
];

export const DEFAULT_THEME: ThemeId = "mist";

export const LEGACY_THEME_MAP: Readonly<Record<string, ThemeId>> = {
  light: "mist",
  dark: "ink",
  papermod: "solarized",
  ananke: "sage",
  terminal: "gruvbox",
  dracula: "catppuccin",
  nord: "ink",
  tokyo: "ink",
};

export const THEME_IDS = THEME_OPTIONS.map((theme) => theme.id);
export const DARK_THEME_IDS = THEME_OPTIONS.filter((theme) => theme.isDark).map((theme) => theme.id);

export function normalizeTheme(value: string | null | undefined): ThemeId {
  const normalized = value ? LEGACY_THEME_MAP[value] ?? value : DEFAULT_THEME;
  return THEME_OPTIONS.some((theme) => theme.id === normalized) ? normalized as ThemeId : DEFAULT_THEME;
}

export function getThemeOption(id: ThemeId): ThemeOption {
  return THEME_OPTIONS.find((theme) => theme.id === id) ?? THEME_OPTIONS[0];
}

export function getNextTheme(id: ThemeId): ThemeId {
  const index = THEME_OPTIONS.findIndex((theme) => theme.id === id);
  return THEME_OPTIONS[(index + 1) % THEME_OPTIONS.length].id;
}
