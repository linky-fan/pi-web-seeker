import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const chromeCandidates = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
];

const themes = [
  {
    id: "rose",
    label: "Rose",
    note: "柔和、明亮，适合长时间阅读。",
    vars: { bg: "#fff8fb", bgPanel: "#ffeaf1", bgHover: "#ffd9e5", bgSelected: "#ffc8da", border: "#efb8c8", text: "#26191d", textMuted: "#745f66", textDim: "#a68c94", accent: "#be123c", userBg: "#fff0f3", assistantBg: "#fffafa", toolBg: "#fff6f0" },
  },
  {
    id: "solarized",
    label: "Solarized",
    note: "低对比暖色，代码和文档都清爽。",
    vars: { bg: "#fdf6e3", bgPanel: "#eee8d5", bgHover: "#e4dac0", bgSelected: "#d8cfb5", border: "#c8bea6", text: "#073642", textMuted: "#657b83", textDim: "#93a1a1", accent: "#268bd2", userBg: "#e5f2f2", assistantBg: "#fdf6e3", toolBg: "#f7efd9" },
  },
  {
    id: "tokyo",
    label: "Tokyo Night",
    note: "深色蓝紫，适合夜间编码。",
    vars: { bg: "#14151f", bgPanel: "#1a1b26", bgHover: "#24283b", bgSelected: "#2f354d", border: "#3b4261", text: "#c0caf5", textMuted: "#9aa5ce", textDim: "#565f89", accent: "#7aa2f7", userBg: "#1c2743", assistantBg: "#14151f", toolBg: "#191c2a" },
  },
  {
    id: "gruvbox",
    label: "Gruvbox",
    note: "复古暖色终端风，辨识度高。",
    vars: { bg: "#1d2021", bgPanel: "#282828", bgHover: "#32302f", bgSelected: "#3c3836", border: "#504945", text: "#ebdbb2", textMuted: "#c7b99a", textDim: "#928374", accent: "#fabd2f", userBg: "#332b1d", assistantBg: "#1d2021", toolBg: "#262421" },
  },
];

function findChrome() {
  for (const candidate of chromeCandidates) {
    try {
      execFileSync(candidate, ["--version"], { stdio: "ignore" });
      return candidate;
    } catch {
      // try next
    }
  }
  throw new Error("Could not find Chrome/Chromium for screenshot generation.");
}

function cssVars(vars) {
  return Object.entries(vars)
    .map(([key, value]) => `--${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${value};`)
    .join("");
}

function html(theme) {
  const v = theme.vars;
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    :root{${cssVars(v)}--font-mono:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace}
    *{box-sizing:border-box}
    body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    .frame{width:1280px;height:780px;display:grid;grid-template-columns:260px 1fr 380px;background:var(--bg);overflow:hidden}
    .sidebar{background:var(--bg-panel);border-right:1px solid var(--border);display:flex;flex-direction:column}
    .brand{height:52px;display:flex;align-items:center;gap:10px;padding:0 14px;border-bottom:1px solid var(--border);font-weight:800}
    .pi{width:30px;height:30px;border-radius:8px;display:grid;place-items:center;border:1px solid color-mix(in srgb,var(--accent) 34%,var(--border));background:color-mix(in srgb,var(--accent) 14%,var(--bg));color:var(--accent);font-size:20px}
    .new{margin-left:auto;border:1px solid var(--border);background:var(--bg-hover);color:var(--text);height:30px;padding:0 12px;border-radius:8px;font-size:13px}
    .cwd{margin:12px;border:1px solid var(--border);background:var(--bg);border-radius:7px;padding:9px 10px;color:var(--text-muted);font-size:12px;font-family:var(--font-mono)}
    .session{margin:2px 8px;padding:12px;border-radius:8px;background:var(--bg-selected);border:1px solid color-mix(in srgb,var(--accent) 18%,var(--border))}
    .session strong{display:block;font-size:14px;margin-bottom:5px}.session span{color:var(--text-muted);font-size:12px}
    .explorer{margin-top:auto;border-top:1px solid var(--border);padding:14px 12px 18px}
    .label{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--text-muted);font-weight:700;margin-bottom:10px}
    .file{display:flex;align-items:center;gap:8px;height:30px;color:var(--text-muted);font-size:12px}.dot{width:7px;height:7px;border-radius:50%;background:var(--accent)}
    .center{display:flex;flex-direction:column;min-width:0}
    .topbar{height:36px;background:var(--bg-panel);border-bottom:1px solid var(--border);display:flex;align-items:center;font-family:var(--font-mono);font-size:11px;color:var(--text-muted)}
    .topbar span{padding:0 12px;border-right:1px solid var(--border);height:100%;display:flex;align-items:center}.topbar .status{border-right:0;gap:8px;color:var(--text);font-weight:650}.status i{width:6px;height:6px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 14%,transparent)}
    .chat{flex:1;padding:28px 40px;overflow:hidden}
    .bubble{max-width:720px;margin-bottom:18px;border-radius:12px;padding:14px 16px;border:1px solid var(--border);font-size:14px;line-height:1.65}
    .user{margin-left:auto;background:var(--user-bg);border-color:color-mix(in srgb,var(--accent) 22%,var(--border));max-width:420px}
    .assistant{background:var(--assistant-bg)}
    .meta{font-size:11px;color:var(--text-dim);margin-bottom:6px;font-family:var(--font-mono)}
    code{font-family:var(--font-mono);background:var(--tool-bg);border:1px solid var(--border);border-radius:5px;padding:2px 5px}
    .input{height:108px;margin:0 40px 28px;border:1px solid var(--border);background:var(--bg-panel);border-radius:14px;display:flex;align-items:flex-end;padding:14px;color:var(--text-muted);box-shadow:0 16px 44px rgba(0,0,0,.08)}
    .send{margin-left:auto;border:0;background:var(--accent);color:${theme.id === "solarized" || theme.id === "rose" ? "#fff" : "#111"};border-radius:9px;padding:9px 14px;font-weight:700}
    .files{background:var(--bg);border-left:1px solid var(--border);display:flex;flex-direction:column}
    .filetop{height:36px;background:var(--bg-panel);border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 12px;color:var(--text-muted);font-size:12px;font-family:var(--font-mono)}
    .code{margin:0;flex:1;padding:18px 20px;background:var(--bg);color:var(--text-muted);font:13px/1.8 var(--font-mono);white-space:pre}
    .ln{color:var(--text-dim);display:inline-block;width:28px;text-align:right;margin-right:16px}.kw{color:var(--accent);font-weight:700}.str{color:var(--text)}
  </style>
</head>
<body>
  <main class="frame">
    <aside class="sidebar">
      <div class="brand"><div class="pi">π</div><div>Pi Web Seeker</div><button class="new">+ New</button></div>
      <div class="cwd">/workspace/pi-web-seeker</div>
      <div class="session"><strong>Theme preview</strong><span>${theme.label} · 12 msgs</span></div>
      <div class="explorer"><div class="label">Explorer</div><div class="file"><span class="dot"></span>components</div><div class="file"><span class="dot"></span>lib/themes.ts</div><div class="file"><span class="dot"></span>README.md</div></div>
    </aside>
    <section class="center">
      <div class="topbar"><span>Theme: ${theme.label}</span><span>Branches</span><span>System</span><span class="status"><i></i>Pi Web Seeker · ${theme.note}</span></div>
      <div class="chat">
        <div class="bubble user">Show me the current theme and open <code>lib/themes.ts</code>.</div>
        <div class="meta">Pi Web Seeker · DeepSeek V4 Pro</div>
        <div class="bubble assistant">The <strong>${theme.label}</strong> palette is active. It keeps the sidebar, chat, file viewer, and controls coordinated through shared CSS variables.</div>
        <div class="bubble assistant">Explorer downloads, Markdown math, branch navigation, and model settings all stay in the same compact workspace.</div>
      </div>
      <div class="input">Message Pi Web Seeker…<button class="send">Send</button></div>
    </section>
    <section class="files">
      <div class="filetop">lib/themes.ts</div>
      <pre class="code"><span class="ln">1</span><span class="kw">export</span> const theme = "${theme.id}";
<span class="ln">2</span>
<span class="ln">3</span>accent: <span class="str">"${v.accent}"</span>
<span class="ln">4</span>surface: <span class="str">"${v.bgPanel}"</span>
<span class="ln">5</span>text: <span class="str">"${v.text}"</span>
<span class="ln">6</span>
<span class="ln">7</span><span class="kw">function</span> applyTheme() {
<span class="ln">8</span>  document.documentElement
<span class="ln">9</span>    .dataset.theme = theme
<span class="ln">10</span>}</pre>
    </section>
  </main>
</body>
</html>`;
}

const chrome = findChrome();
const outputDir = resolve("docs/screenshots");
mkdirSync(outputDir, { recursive: true });
const tempDir = mkdtempSync(join(tmpdir(), "pi-web-theme-shots-"));

for (const theme of themes) {
  const htmlPath = join(tempDir, `${theme.id}.html`);
  const screenshotPath = join(outputDir, `theme-${theme.id}.png`);
  writeFileSync(htmlPath, html(theme), "utf8");
  const args = [
    "--headless",
    "--disable-gpu",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--disable-extensions",
    "--disable-crash-reporter",
    "--disable-breakpad",
    "--disable-default-apps",
    "--metrics-recording-only",
    "--no-service-autorun",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--password-store=basic",
    "--use-mock-keychain",
    "--disable-features=OptimizationGuideModelDownloading,OptimizationHintsFetching,Translate,MediaRouter",
    `--user-data-dir=${join(tempDir, `profile-${theme.id}`)}`,
    "--window-size=1280,780",
    `--screenshot=${screenshotPath}`,
    pathToFileURL(htmlPath).href,
  ];
  const result = spawnSync(chrome, args, { stdio: "inherit", timeout: 15_000 });
  if (result.error && !existsSync(screenshotPath)) throw result.error;
  if (result.status !== 0 && !existsSync(screenshotPath)) {
    throw new Error(`Chrome screenshot failed for ${theme.id} with status ${result.status ?? "unknown"}`);
  }
  console.log(`wrote ${screenshotPath}`);
}
