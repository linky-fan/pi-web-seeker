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
  /**
   * Optional CSS background layers (gradients) painted over `bg` / `bgPanel`.
   * Empty string means the flat color is used as-is. Kept separate from bg/bgPanel
   * so swatches and any `background-color` consumer still get a valid solid color.
   */
  bgGradient?: string;
  bgPanelGradient?: string;
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
  { id: "ink", label: "Graphite", accent: "#8ab4f8", surface: "#1b2129", isDark: true, vars: { bg: "#171c23", bgPanel: "#1f242c", bgGradient: "radial-gradient(1400px 1000px at 6% -24%, rgba(138,180,248,0.42), transparent 62%), radial-gradient(900px 700px at 96% 104%, rgba(138,180,248,0.14), transparent 62%), linear-gradient(165deg, #262c34 0%, #1a2028 42%, #0c1117 100%)", bgPanelGradient: "linear-gradient(180deg, #2d333c 0%, #1a1f27 100%)", bgHover: "#2b3139", bgSelected: "#333a44", border: "#333c49", text: "#e6eaf0", textMuted: "#9dabbd", textDim: "#6e7d90", accent: "#8ab4f8", accentHover: "#a8c8fb", userBg: "#212b38", assistantBg: "#171c23", toolBg: "#1d232b", bgSubtle: "rgba(138,180,248,0.05)" } },
  // Deep pine: the accent is a muted teal, not a bright mint.
  { id: "midnight", label: "Pine", accent: "#7fc9a8", surface: "#18211b", isDark: true, vars: { bg: "#131a15", bgPanel: "#1b231d", bgGradient: "radial-gradient(1400px 1000px at 6% -24%, rgba(127,201,168,0.44), transparent 62%), radial-gradient(900px 700px at 96% 104%, rgba(127,201,168,0.15), transparent 62%), linear-gradient(165deg, #232c26 0%, #172019 42%, #070f09 100%)", bgPanelGradient: "linear-gradient(180deg, #29332c 0%, #161f19 100%)", bgHover: "#26302a", bgSelected: "#2e3a32", border: "#2c3a31", text: "#e3ece5", textMuted: "#9cb2a6", textDim: "#6e897b", accent: "#7fc9a8", accentHover: "#9ad9bd", userBg: "#1e2b23", assistantBg: "#131a15", toolBg: "#182019", bgSubtle: "rgba(127,201,168,0.06)" } },
  // Warm amber on charcoal: dialled back from the original saturated yellow.
  { id: "gruvbox", label: "Amber", accent: "#e0a84e", surface: "#1e1914", isDark: true, vars: { bg: "#1b1712", bgPanel: "#241f18", bgGradient: "radial-gradient(1400px 1000px at 6% -24%, rgba(224,168,78,0.42), transparent 62%), radial-gradient(900px 700px at 96% 104%, rgba(224,168,78,0.15), transparent 62%), linear-gradient(165deg, #2a2520 0%, #1e1913 42%, #0f0b06 100%)", bgPanelGradient: "linear-gradient(180deg, #332d25 0%, #1f1a13 100%)", bgHover: "#2f2820", bgSelected: "#393026", border: "#3e3428", text: "#ece0cc", textMuted: "#bfad94", textDim: "#8d7d65", accent: "#e0a84e", accentHover: "#eec06b", userBg: "#2a2218", assistantBg: "#1b1712", toolBg: "#211b15", bgSubtle: "rgba(224,168,78,0.06)" } },
  // Muted mauve: keeps the Catppuccin family feel without the high-contrast violet.
  { id: "catppuccin", label: "Mauve", accent: "#c3a6f0", surface: "#1c1922", isDark: true, vars: { bg: "#17141d", bgPanel: "#201c28", bgGradient: "radial-gradient(1400px 1000px at 6% -24%, rgba(195,166,240,0.44), transparent 62%), radial-gradient(900px 700px at 96% 104%, rgba(195,166,240,0.16), transparent 62%), linear-gradient(165deg, #26222c 0%, #1a1720 42%, #0b0810 100%)", bgPanelGradient: "linear-gradient(180deg, #2f2a38 0%, #1b1723 100%)", bgHover: "#2b2733", bgSelected: "#342f3e", border: "#39324a", text: "#e4dff0", textMuted: "#a89fc0", textDim: "#7a7192", accent: "#c3a6f0", accentHover: "#d6c1f7", userBg: "#292340", assistantBg: "#17141d", toolBg: "#1d1a25", bgSubtle: "rgba(195,166,240,0.06)" } },
  // Slate blue with a softened coral accent; less electric than the old Cobalt.
  { id: "cobalt", label: "Slate", accent: "#7dd3c0", surface: "#17202e", isDark: true, vars: { bg: "#111926", bgPanel: "#182333", bgGradient: "radial-gradient(1400px 1000px at 6% -24%, rgba(125,211,192,0.44), transparent 62%), radial-gradient(900px 700px at 96% 104%, rgba(125,211,192,0.15), transparent 62%), linear-gradient(165deg, #1f2837 0%, #141d2a 42%, #050b14 100%)", bgPanelGradient: "linear-gradient(180deg, #273349 0%, #121c2b 100%)", bgHover: "#223046", bgSelected: "#293a52", border: "#2a3d54", text: "#dce9f5", textMuted: "#93adc6", textDim: "#647e99", accent: "#7dd3c0", accentHover: "#9de3d3", userBg: "#1a2a3d", assistantBg: "#111926", toolBg: "#151f2c", bgSubtle: "rgba(125,211,192,0.06)" } },
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