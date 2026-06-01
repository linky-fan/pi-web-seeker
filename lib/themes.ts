export type ThemeId =
  | "mist"
  | "ink"
  | "sage"
  | "rose"
  | "midnight"
  | "papermod"
  | "ananke"
  | "terminal"
  | "solarized"
  | "dracula"
  | "nord"
  | "gruvbox"
  | "tokyo"
  | "catppuccin";

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
  { id: "ink", label: "Ink", accent: "#60a5fa", surface: "#242424", isDark: true, vars: { bg: "#1a1a1a", bgPanel: "#242424", bgHover: "#2e2e2e", bgSelected: "#383838", border: "#3a3a3a", text: "#e8e8e8", textMuted: "#9ca3af", textDim: "#6b7280", accent: "#60a5fa", accentHover: "#93c5fd", userBg: "#1e293b", assistantBg: "#1a1a1a", toolBg: "#1f2937", bgSubtle: "rgba(255,255,255,0.04)" } },
  { id: "sage", label: "Sage", accent: "#0f766e", surface: "#eaf2df", isDark: false, vars: { bg: "#f8fcf1", bgPanel: "#eaf2df", bgHover: "#dceacb", bgSelected: "#d0e1bf", border: "#c5d6b8", text: "#18231d", textMuted: "#607065", textDim: "#8b9a90", accent: "#0f766e", accentHover: "#0d5f59", userBg: "#e8f6f3", assistantBg: "#fbfdf9", toolBg: "#f5f8f2", bgSubtle: "rgba(15,118,110,0.06)" } },
  { id: "rose", label: "Rose", accent: "#be123c", surface: "#fff1f2", isDark: false, vars: { bg: "#fff8fb", bgPanel: "#ffeaf1", bgHover: "#ffd9e5", bgSelected: "#ffc8da", border: "#efb8c8", text: "#26191d", textMuted: "#745f66", textDim: "#a68c94", accent: "#be123c", accentHover: "#9f1239", userBg: "#fff0f3", assistantBg: "#fffafa", toolBg: "#fff6f0", bgSubtle: "rgba(190,18,60,0.05)" } },
  { id: "midnight", label: "Midnight", accent: "#34d399", surface: "#161b18", isDark: true, vars: { bg: "#101312", bgPanel: "#161b18", bgHover: "#1d2823", bgSelected: "#24362f", border: "#2b3933", text: "#e8eee9", textMuted: "#a6b3ab", textDim: "#6f7c74", accent: "#34d399", accentHover: "#6ee7b7", userBg: "#10251f", assistantBg: "#101312", toolBg: "#151f1b", bgSubtle: "rgba(52,211,153,0.08)" } },
  { id: "papermod", label: "PaperMod", accent: "#b45309", surface: "#f3ead7", isDark: false, vars: { bg: "#fffaf0", bgPanel: "#f3ead7", bgHover: "#ead9b8", bgSelected: "#dec89c", border: "#d2be98", text: "#2f281f", textMuted: "#76664f", textDim: "#a79271", accent: "#b45309", accentHover: "#92400e", userBg: "#fff4d6", assistantBg: "#fffaf0", toolBg: "#f7efd9", bgSubtle: "rgba(180,83,9,0.07)" } },
  { id: "ananke", label: "Ananke", accent: "#007c89", surface: "#e7f3f4", isDark: false, vars: { bg: "#f7fcfd", bgPanel: "#e7f3f4", bgHover: "#d2e9eb", bgSelected: "#bfdee1", border: "#aacfd3", text: "#102629", textMuted: "#4f6970", textDim: "#7f999f", accent: "#007c89", accentHover: "#00656f", userBg: "#e4f7f8", assistantBg: "#f7fcfd", toolBg: "#edf7f0", bgSubtle: "rgba(0,124,137,0.07)" } },
  { id: "terminal", label: "Terminal", accent: "#ffb454", surface: "#15191d", isDark: true, vars: { bg: "#0f1317", bgPanel: "#15191d", bgHover: "#222831", bgSelected: "#313944", border: "#374151", text: "#f3f4f6", textMuted: "#b8c0cc", textDim: "#7f8997", accent: "#ffb454", accentHover: "#ffd18a", userBg: "#2a2116", assistantBg: "#0f1317", toolBg: "#171d23", bgSubtle: "rgba(255,180,84,0.08)" } },
  { id: "solarized", label: "Solarized", accent: "#268bd2", surface: "#eee8d5", isDark: false, vars: { bg: "#fdf6e3", bgPanel: "#eee8d5", bgHover: "#e4dac0", bgSelected: "#d8cfb5", border: "#c8bea6", text: "#073642", textMuted: "#657b83", textDim: "#93a1a1", accent: "#268bd2", accentHover: "#006cb4", userBg: "#e5f2f2", assistantBg: "#fdf6e3", toolBg: "#f7efd9", bgSubtle: "rgba(38,139,210,0.07)" } },
  { id: "dracula", label: "Dracula", accent: "#bd93f9", surface: "#282a36", isDark: true, vars: { bg: "#1e1f29", bgPanel: "#282a36", bgHover: "#343746", bgSelected: "#44475a", border: "#4b4f63", text: "#f8f8f2", textMuted: "#b8b8c8", textDim: "#777a8f", accent: "#bd93f9", accentHover: "#d6b6ff", userBg: "#302547", assistantBg: "#1e1f29", toolBg: "#242631", bgSubtle: "rgba(189,147,249,0.08)" } },
  { id: "nord", label: "Nord", accent: "#88c0d0", surface: "#2e3440", isDark: true, vars: { bg: "#242933", bgPanel: "#2e3440", bgHover: "#3b4252", bgSelected: "#434c5e", border: "#4c566a", text: "#eceff4", textMuted: "#d8dee9", textDim: "#8792a3", accent: "#88c0d0", accentHover: "#9fceda", userBg: "#263947", assistantBg: "#242933", toolBg: "#2a303b", bgSubtle: "rgba(136,192,208,0.08)" } },
  { id: "gruvbox", label: "Gruvbox", accent: "#fabd2f", surface: "#282828", isDark: true, vars: { bg: "#1d2021", bgPanel: "#282828", bgHover: "#32302f", bgSelected: "#3c3836", border: "#504945", text: "#ebdbb2", textMuted: "#c7b99a", textDim: "#928374", accent: "#fabd2f", accentHover: "#fecc5c", userBg: "#332b1d", assistantBg: "#1d2021", toolBg: "#262421", bgSubtle: "rgba(250,189,47,0.08)" } },
  { id: "tokyo", label: "Tokyo Night", accent: "#7aa2f7", surface: "#1a1b26", isDark: true, vars: { bg: "#14151f", bgPanel: "#1a1b26", bgHover: "#24283b", bgSelected: "#2f354d", border: "#3b4261", text: "#c0caf5", textMuted: "#9aa5ce", textDim: "#565f89", accent: "#7aa2f7", accentHover: "#9ab8ff", userBg: "#1c2743", assistantBg: "#14151f", toolBg: "#191c2a", bgSubtle: "rgba(122,162,247,0.08)" } },
  { id: "catppuccin", label: "Catppuccin", accent: "#cba6f7", surface: "#1e1e2e", isDark: true, vars: { bg: "#181825", bgPanel: "#1e1e2e", bgHover: "#272739", bgSelected: "#313244", border: "#45475a", text: "#cdd6f4", textMuted: "#a6adc8", textDim: "#6c7086", accent: "#cba6f7", accentHover: "#ddb6ff", userBg: "#2b223b", assistantBg: "#181825", toolBg: "#1d1d2b", bgSubtle: "rgba(203,166,247,0.08)" } },
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
