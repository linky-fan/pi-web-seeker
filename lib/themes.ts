export type ThemeId =
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

// Palette notes: backgrounds sit within a few percent of each other so panels read as
// layers rather than blocks, accents stay muted, and text avoids pure black or white.
// Rose and Sage are the tonal reference the rest were re-tuned against.
export const THEME_OPTIONS: ThemeOption[] = [
  // Cool, near-neutral light theme. A hint of blue in the greys keeps it from feeling flat.
  { id: "sage", label: "Sage", accent: "#0f766e", surface: "#eaf2df", isDark: false, vars: { bg: "#f8fcf1", bgPanel: "#eaf2df", bgHover: "#dceacb", bgSelected: "#d0e1bf", border: "#c5d6b8", text: "#18231d", textMuted: "#607065", textDim: "#7b8a80", accent: "#0f766e", accentHover: "#0d5f59", userBg: "#e8f6f3", assistantBg: "#fbfdf9", toolBg: "#f5f8f2", bgSubtle: "rgba(15,118,110,0.06)" } },
  { id: "rose", label: "Rose", accent: "#be123c", surface: "#fff1f2", isDark: false, vars: { bg: "#fff8fb", bgPanel: "#ffeaf1", bgHover: "#ffd9e5", bgSelected: "#ffc8da", border: "#efb8c8", text: "#26191d", textMuted: "#745f66", textDim: "#977d85", accent: "#be123c", accentHover: "#9f1239", userBg: "#fff0f3", assistantBg: "#fffafa", toolBg: "#fff6f0", bgSubtle: "rgba(190,18,60,0.05)" } },
  // Warm sand: replaces the old Solarized yellow without the aged-paper cast.
  { id: "solarized", label: "Sand", accent: "#8a6a3f", surface: "#f6f1e8", isDark: false, vars: { bg: "#faf7f1", bgPanel: "#f3ede3", bgHover: "#ebe3d6", bgSelected: "#e0d6c6", border: "#dbd0be", text: "#2a241c", textMuted: "#6d6355", textDim: "#8b8070", accent: "#8a6a3f", accentHover: "#725634", userBg: "#f6efe4", assistantBg: "#faf7f1", toolBg: "#f7f2ea", bgSubtle: "rgba(42,36,28,0.035)" } },
  // Soft lilac: cooler than Rose, still washed out enough to stay quiet.
  { id: "lavender", label: "Lilac", accent: "#7a6a9b", surface: "#f5f3f9", isDark: false, vars: { bg: "#faf9fc", bgPanel: "#f2f0f7", bgHover: "#eae7f1", bgSelected: "#dfdae9", border: "#d9d4e3", text: "#26222e", textMuted: "#665f76", textDim: "#948da3", accent: "#7a6a9b", accentHover: "#655689", userBg: "#f1eef8", assistantBg: "#faf9fc", toolBg: "#f7f5fa", bgSubtle: "rgba(122,106,155,0.05)" } },
  // Graphite rather than flat black, with a cool accent that stays legible on grey.
  { id: "ink", label: "Graphite", accent: "#8ab4f8", surface: "#20262f", isDark: true, vars: { bg: "#191e26", bgPanel: "#20262f", bgHover: "#28303b", bgSelected: "#313a47", border: "#333c49", text: "#e6eaf0", textMuted: "#9dabbd", textDim: "#6e7d90", accent: "#8ab4f8", accentHover: "#a8c8fb", userBg: "#212b38", assistantBg: "#191e26", toolBg: "#1d232b", bgSubtle: "rgba(138,180,248,0.05)" } },
  // Deep pine: the accent is a muted teal, not a bright mint.
  { id: "midnight", label: "Pine", accent: "#7fc9a8", surface: "#1b2822", isDark: true, vars: { bg: "#15201b", bgPanel: "#1b2822", bgHover: "#22332b", bgSelected: "#2a3f35", border: "#2c4036", text: "#e2ece6", textMuted: "#9db3a8", textDim: "#6b8578", accent: "#7fc9a8", accentHover: "#9ad9bd", userBg: "#1a2c24", assistantBg: "#15201b", toolBg: "#182420", bgSubtle: "rgba(127,201,168,0.06)" } },
  // Warm amber on charcoal: dialled back from the original saturated yellow.
  { id: "gruvbox", label: "Amber", accent: "#e0a84e", surface: "#2b2419", isDark: true, vars: { bg: "#211b13", bgPanel: "#2b2419", bgHover: "#352c1f", bgSelected: "#403526", border: "#42372a", text: "#ece0cc", textMuted: "#c0ae94", textDim: "#8d7d65", accent: "#e0a84e", accentHover: "#eec06b", userBg: "#2f2718", assistantBg: "#211b13", toolBg: "#272015", bgSubtle: "rgba(224,168,78,0.06)" } },
  // Muted mauve: keeps the Catppuccin family feel without the high-contrast violet.
  { id: "catppuccin", label: "Mauve", accent: "#c3a6f0", surface: "#231f2e", isDark: true, vars: { bg: "#1b1823", bgPanel: "#231f2e", bgHover: "#2c2739", bgSelected: "#362f46", border: "#39324a", text: "#e4dff0", textMuted: "#aaa2c0", textDim: "#7a7192", accent: "#c3a6f0", accentHover: "#d6c1f7", userBg: "#292340", assistantBg: "#1b1823", toolBg: "#1f1b29", bgSubtle: "rgba(195,166,240,0.06)" } },
  // Slate blue with a softened coral accent; less electric than the old Cobalt.
  { id: "cobalt", label: "Slate", accent: "#7dd3c0", surface: "#1a2a3a", isDark: true, vars: { bg: "#132030", bgPanel: "#1a2a3a", bgHover: "#203347", bgSelected: "#283e53", border: "#2a4055", text: "#dce9f5", textMuted: "#94aec7", textDim: "#647e99", accent: "#7dd3c0", accentHover: "#9de3d3", userBg: "#182b3d", assistantBg: "#132030", toolBg: "#162434", bgSubtle: "rgba(125,211,192,0.06)" } },
];

export const DEFAULT_THEME: ThemeId = "solarized";

export const LEGACY_THEME_MAP: Readonly<Record<string, ThemeId>> = {
  light: "solarized",
  mist: "solarized",
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