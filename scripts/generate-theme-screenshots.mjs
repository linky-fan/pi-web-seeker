import { copyFileSync, existsSync, mkdirSync, mkdtempSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const chromeCandidates = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
];

const imageConverterCandidates = [
  ["magick"],
  ["convert"],
  ["sips", "-s", "format", "jpeg"],
];

const themes = [
  {
    id: "rose",
    label: "Rose",
    note: "Soft reading workspace",
    vars: { bg: "#fff8fb", bgPanel: "#ffeaf1", bgHover: "#ffd9e5", bgSelected: "#ffc8da", border: "#efb8c8", text: "#26191d", textMuted: "#745f66", textDim: "#a68c94", accent: "#be123c", userBg: "#fff0f3", assistantBg: "#fffafa", toolBg: "#fff6f0" },
  },
  {
    id: "solarized",
    label: "Solarized",
    note: "Low-contrast warm code",
    vars: { bg: "#fdf6e3", bgPanel: "#eee8d5", bgHover: "#e4dac0", bgSelected: "#d8cfb5", border: "#c8bea6", text: "#073642", textMuted: "#586e75", textDim: "#839496", accent: "#006cb4", userBg: "#e5f2f2", assistantBg: "#fdf6e3", toolBg: "#f7efd9" },
  },
  {
    id: "lavender",
    label: "Lavender",
    note: "Soft violet reading workspace",
    vars: { bg: "#fcfaff", bgPanel: "#f3eefa", bgHover: "#eae2f5", bgSelected: "#ded2ed", border: "#d7cbe3", text: "#241b2e", textMuted: "#6e617a", textDim: "#a395af", accent: "#7c3aed", userBg: "#f0e7ff", assistantBg: "#fcfaff", toolBg: "#f7f2fb" },
  },
  {
    id: "gruvbox",
    label: "Gruvbox",
    note: "Warm terminal palette",
    vars: { bg: "#1d2021", bgPanel: "#282828", bgHover: "#32302f", bgSelected: "#3c3836", border: "#504945", text: "#ebdbb2", textMuted: "#c7b99a", textDim: "#928374", accent: "#fabd2f", userBg: "#332b1d", assistantBg: "#1d2021", toolBg: "#262421" },
  },
  {
    id: "cobalt",
    label: "Cobalt",
    note: "High-contrast cobalt workspace",
    vars: { bg: "#081a3a", bgPanel: "#0d2855", bgHover: "#15366e", bgSelected: "#204581", border: "#2d5590", text: "#f3f7ff", textMuted: "#a9bde0", textDim: "#6f89b5", accent: "#ff9f6e", userBg: "#173664", assistantBg: "#081a3a", toolBg: "#0b2249" },
  },
];

function findCommand(candidates, versionArgs = ["--version"]) {
  for (const candidate of candidates) {
    const [command] = candidate;
    try {
      execFileSync(command, versionArgs, { stdio: "ignore" });
      return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

function findChrome() {
  const command = findCommand(chromeCandidates.map((candidate) => [candidate]));
  if (!command) throw new Error("Could not find Chrome/Chromium for screenshot generation.");
  return command[0];
}

function cssVars(vars) {
  return Object.entries(vars)
    .map(([key, value]) => `--${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${value};`)
    .join("");
}

function baseCss(vars) {
  return `
    :root{${cssVars(vars)}--font-mono:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace;--fluid-rail:44px}
    *{box-sizing:border-box}
    body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    .app{width:100vw;height:100vh;display:grid;grid-template-columns:var(--fluid-rail) minmax(0,1fr) 380px;background:var(--bg);overflow:hidden}
    .rail{background:color-mix(in srgb,var(--bg-panel) 72%,transparent);border-right:1px solid color-mix(in srgb,var(--border) 72%,transparent);display:flex;flex-direction:column;align-items:center;gap:8px;padding:8px 4px}
    .brand,.rail-btn{width:31px;height:31px;border-radius:7px;display:grid;place-items:center;border:1px solid color-mix(in srgb,var(--border) 72%,transparent);color:var(--text-muted)}
    .brand{width:27px;height:27px;margin-bottom:5px;background:color-mix(in srgb,var(--accent) 13%,var(--bg));color:var(--accent);font-size:16px;font-weight:800}
    .rail-btn.active{background:color-mix(in srgb,var(--accent) 13%,transparent);border-color:color-mix(in srgb,var(--accent) 34%,var(--border));color:var(--accent)}
    .rail-spacer{flex:1}
    .workspace{min-width:0;display:flex;flex-direction:column;background:linear-gradient(180deg,color-mix(in srgb,var(--bg) 94%,transparent),var(--bg))}
    .header{height:38px;border-bottom:1px solid color-mix(in srgb,var(--border) 68%,transparent);display:grid;grid-template-columns:minmax(140px,220px) minmax(0,1fr) auto;align-items:center;gap:12px;padding:0 24px;color:var(--text-muted)}
    .status{display:flex;align-items:center;gap:8px;min-width:0}
    .dot{width:7px;height:7px;border-radius:50%;background:#34d399;box-shadow:0 0 0 4px color-mix(in srgb,#34d399 14%,transparent)}
    .project{max-width:180px;height:22px;border:1px solid color-mix(in srgb,var(--border) 58%,transparent);border-radius:999px;background:color-mix(in srgb,var(--bg-panel) 38%,transparent);padding:4px 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10.5px;font-weight:700}
    .title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text);font-size:12.5px;font-weight:650;text-align:center}
    .metrics{display:flex;justify-content:flex-end;align-items:center;gap:5px;min-width:0;white-space:nowrap}
    .metric{min-width:58px;height:24px;display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:0 7px;border:1px solid color-mix(in srgb,var(--border) 62%,transparent);border-radius:7px;background:color-mix(in srgb,var(--bg-panel) 36%,transparent);font-variant-numeric:tabular-nums}
    .metric.cache{min-width:76px;border-color:color-mix(in srgb,var(--accent) 24%,var(--border));background:color-mix(in srgb,var(--accent) 7%,transparent)}
    .metric label{font-size:8.5px;font-weight:800;color:color-mix(in srgb,var(--text-muted) 78%,transparent)}
    .metric.cache label{color:color-mix(in srgb,var(--accent) 76%,var(--text-muted))}
    .metric b{font-size:11.5px;color:var(--text);font-weight:680}
    .chat{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:flex-end;padding:42px 68px 34px;overflow:hidden}
    .stack{max-width:760px;margin:0 auto 24px;display:grid;gap:14px;width:100%}
    .bubble{border:1px solid color-mix(in srgb,var(--border) 80%,transparent);border-radius:13px;padding:15px 17px;background:color-mix(in srgb,var(--assistant-bg) 88%,transparent);box-shadow:0 14px 38px color-mix(in srgb,#000 5%,transparent);font-size:14px;line-height:1.68}
    .bubble.user{justify-self:end;max-width:520px;background:var(--user-bg);border-color:color-mix(in srgb,var(--accent) 24%,var(--border))}
    .meta{font:11px var(--font-mono);color:var(--text-dim);margin-bottom:-5px}
    code{font-family:var(--font-mono);background:var(--tool-bg);border:1px solid var(--border);border-radius:5px;padding:2px 5px}
    .composer{max-width:780px;width:100%;height:118px;margin:0 auto;border:1px solid color-mix(in srgb,var(--border) 76%,transparent);border-radius:13px;background:color-mix(in srgb,var(--bg-panel) 44%,transparent);box-shadow:0 18px 52px color-mix(in srgb,#000 14%,transparent);display:flex;flex-direction:column;overflow:hidden}
    .composer-input{flex:1;padding:17px;color:var(--text-dim);font-size:14px}
    .composer-bar{height:34px;border-top:1px solid color-mix(in srgb,var(--border) 58%,transparent);display:flex;align-items:center;gap:12px;padding:0 12px;color:var(--text-muted);font-size:11px}
    .composer-bar .send{margin-left:auto;width:28px;height:28px;border:0;border-radius:8px;background:color-mix(in srgb,var(--accent) 13%,transparent);color:var(--accent);font-weight:800}
    .panel{background:color-mix(in srgb,var(--bg) 92%,transparent);border-left:1px solid color-mix(in srgb,var(--border) 72%,transparent);display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--text-muted);text-align:center}
    .file-icon{width:46px;height:46px;border-radius:13px;border:1px solid color-mix(in srgb,var(--accent) 22%,var(--border));display:grid;place-items:center;color:var(--accent);background:color-mix(in srgb,var(--accent) 9%,transparent);font-weight:800}
    .panel h3{margin:14px 0 6px;color:var(--text);font-size:14px}
    .panel p{margin:0;font-size:12px}
  `;
}

function themeHtml(theme) {
  const v = theme.vars;
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>${baseCss(v)}</style>
</head>
<body>
  <main class="app">
    <aside class="rail">
      <div class="brand">π</div>
      <div class="rail-btn">□</div>
      <div class="rail-btn active">↥</div>
      <div class="rail-btn">▱</div>
      <div class="rail-btn">⚙</div>
      <div class="rail-btn">◇</div>
      <div class="rail-spacer"></div>
      <div class="rail-btn">◌</div>
      <div class="rail-btn">中</div>
    </aside>
    <section class="workspace">
      <div class="header">
        <div class="status"><span class="dot"></span><span class="project">pi-web-seeker</span></div>
        <div class="title">Theme preview · ${theme.label}</div>
        <div class="metrics">
          <span class="metric"><label>IN</label><b>42k</b></span>
          <span class="metric"><label>OUT</label><b>8k</b></span>
          <span class="metric cache"><label>CACHE</label><b>96k</b></span>
        </div>
      </div>
      <div class="chat">
        <div class="stack">
          <div class="bubble user">Show the current theme and open <code>lib/themes.ts</code>.</div>
          <div class="meta">Pi Web Seeker · Step 3.7 Flash</div>
          <div class="bubble">The <strong>${theme.label}</strong> palette is active. The fluid rail, workspace header, composer, and file panel all inherit the same theme tokens.</div>
          <div class="bubble">This preview uses safe mock data: no private paths, session names, API keys, or local files are captured.</div>
        </div>
        <div class="composer">
          <div class="composer-input">Message Pi Web Seeker...</div>
          <div class="composer-bar"><span>图片</span><span>提示词</span><span>Step 3.7 Flash</span><span>推理: high</span><button class="send">→</button></div>
        </div>
      </div>
    </section>
    <section class="panel">
      <div class="file-icon">ts</div>
      <h3>lib/themes.ts</h3>
      <p>${theme.note}<br/>accent ${v.accent}</p>
    </section>
  </main>
</body>
</html>`;
}

function agentsHtml(kind) {
  const vars = { bg: "#f8fcf1", bgPanel: "#eaf2df", bgHover: "#dceacb", bgSelected: "#d0e1bf", border: "#c5d6b8", text: "#18231d", textMuted: "#607065", textDim: "#8b9a90", accent: "#0f766e", userBg: "#e8f6f3", assistantBg: "#fbfdf9", toolBg: "#f5f8f2" };
  const isDraft = kind === "draft";
  const badge = isDraft ? "standard 草稿" : "ready";
  const action = isDraft ? "生成草稿" : "检查通过";
  const cardTitle = isDraft ? "识别到的项目画像" : "AGENTS.md 已就绪";
  const cardSubtitle = isDraft ? "example-empty · 空项目" : "pi-web-seeker · 已有规范";
  const body = isDraft
    ? `<div class="question">待确认问题</div>
       <p>- What kind of project is this, and who will work on it?</p>
       <p>- Which commands should agents use for development, tests, and release?</p>
       <p>- Confirm the canonical dev/test/lint commands before relying on this AGENTS.md.</p>
       <div class="draftbox"><strong># example-empty - Development Notes</strong><br/><br/>Generated by the AGENTS architect from repository evidence.<br/><br/>&gt; TODO: Confirm product goal, stack, commands, and safety rules.</div>`
    : `<div class="readygrid"><span>Commands</span><b>4 verified</b><span>Architecture</span><b>linked notes</b><span>Secrets</span><b>no findings</b></div>
       <div class="draftbox"><strong># Pi Web Seeker - Development Notes</strong><br/><br/>Repository: linky-fan/pi-web-seeker<br/><br/>- Dev: npm run dev on port 30141.<br/>- Typecheck: node_modules/.bin/tsc --noEmit.<br/>- Lint: npm run lint.</div>`;
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    ${baseCss(vars)}
    .app{width:1020px;height:720px;grid-template-columns:44px minmax(0,1fr);background:var(--bg)}
    .workspace{position:relative}
    .header{grid-template-columns:minmax(120px,180px) minmax(0,1fr) auto;padding:0 28px}
    .agents-card{width:560px;margin:58px auto 18px;border:1px solid color-mix(in srgb,var(--border) 70%,transparent);border-radius:13px;background:color-mix(in srgb,var(--assistant-bg) 94%,transparent);box-shadow:0 18px 48px color-mix(in srgb,#000 10%,transparent);padding:14px}
    .agents-toolbar{height:30px;display:flex;align-items:center;gap:8px;justify-content:center;color:var(--text-muted);font-size:12px;margin-bottom:12px}
    .pill{height:24px;border:1px solid color-mix(in srgb,var(--accent) 25%,var(--border));border-radius:999px;padding:4px 9px;background:color-mix(in srgb,var(--accent) 8%,transparent);color:var(--accent);font-weight:700}
    .card-title{font-weight:720;color:var(--text);font-size:14px}.card-sub{color:var(--text-muted);font-size:12px;margin:4px 0 14px}
    .question{font-size:12px;font-weight:720;color:var(--text);margin:10px 0 5px}.agents-card p{margin:3px 0;color:var(--text-muted);font-size:12px;line-height:1.45}
    .draftbox{margin-top:12px;height:190px;overflow:hidden;border:1px solid var(--border);border-radius:8px;background:var(--bg);padding:14px;color:var(--text-muted);font:12px/1.55 var(--font-mono)}
    .readygrid{display:grid;grid-template-columns:1fr auto;gap:8px 14px;margin:8px 0 12px;color:var(--text-muted);font-size:12px}.readygrid b{color:var(--accent)}
    .composer{height:92px;margin-top:auto;margin-bottom:24px}
  </style>
</head>
<body>
  <main class="app">
    <aside class="rail">
      <div class="brand">π</div><div class="rail-btn">□</div><div class="rail-btn active">▱</div><div class="rail-btn">⚙</div><div class="rail-spacer"></div><div class="rail-btn">中</div>
    </aside>
    <section class="workspace">
      <div class="header">
        <div class="status"><span class="dot"></span><span class="project">demo-workspace</span></div>
        <div class="title">AGENTS.md assistant</div>
        <div class="metrics"><span class="metric cache"><label>AGENTS</label><b>${badge}</b></span></div>
      </div>
      <div class="agents-card">
        <div class="agents-toolbar"><span class="pill">AGENTS.md</span><span>392 tokens</span><span class="pill">${action}</span></div>
        <div class="card-title">${cardTitle}</div>
        <div class="card-sub">${cardSubtitle}</div>
        ${body}
      </div>
      <div class="composer">
        <div class="composer-input">输入消息...</div>
        <div class="composer-bar"><span>图片</span><span>提示词</span><span>Step 3.7 Flash</span><button class="send">→</button></div>
      </div>
    </section>
  </main>
</body>
</html>`;
}

function convertPngToJpeg(pngPath, jpegPath) {
  const converter = findCommand(imageConverterCandidates);
  if (!converter) throw new Error("Could not find ImageMagick, convert, or sips for JPEG conversion.");
  const [command, ...prefixArgs] = converter;
  const args = command === "sips"
    ? [...prefixArgs, pngPath, "--out", jpegPath]
    : command === "magick"
      ? [pngPath, "-quality", "92", jpegPath]
      : [pngPath, "-quality", "92", jpegPath];
  const result = spawnSync(command, args, { stdio: "inherit", timeout: 15_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Image conversion failed with status ${result.status ?? "unknown"}`);
}

function capture(chrome, tempDir, { html, outputPath, width, height, jpeg = false, id }) {
  const htmlPath = join(tempDir, `${id}.html`);
  const pngPath = jpeg ? outputPath.replace(/\.[^.]+$/, ".tmp.png") : outputPath;
  writeFileSync(htmlPath, html, "utf8");
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
    `--user-data-dir=${join(tempDir, `profile-${id}`)}`,
    `--window-size=${width},${height}`,
    `--screenshot=${pngPath}`,
    pathToFileURL(htmlPath).href,
  ];
  const result = spawnSync(chrome, args, { stdio: "inherit", timeout: 15_000 });
  if (result.error && !existsSync(pngPath)) throw result.error;
  if (result.status !== 0 && !existsSync(pngPath)) {
    throw new Error(`Chrome screenshot failed for ${id} with status ${result.status ?? "unknown"}`);
  }
  if (jpeg) {
    convertPngToJpeg(pngPath, outputPath);
    unlinkSync(pngPath);
  } else if (pngPath !== outputPath) {
    copyFileSync(pngPath, outputPath);
  }
  console.log(`wrote ${outputPath}`);
}

const chrome = findChrome();
const outputDir = resolve("docs/screenshots");
mkdirSync(outputDir, { recursive: true });
const tempDir = mkdtempSync(join(tmpdir(), "pi-web-readme-shots-"));
const requested = new Set(process.argv.slice(2));
const selectedThemes = requested.size > 0
  ? themes.filter((theme) => requested.has(theme.id))
  : themes;

for (const theme of selectedThemes) {
  capture(chrome, tempDir, {
    id: `theme-${theme.id}`,
    html: themeHtml(theme),
    outputPath: join(outputDir, `theme-${theme.id}.png`),
    width: 1280,
    height: 780,
  });
}

if (requested.size === 0 || requested.has("agents")) {
  capture(chrome, tempDir, {
    id: "agents-md-draft",
    html: agentsHtml("draft"),
    outputPath: join(outputDir, "agents-md-draft.jpg"),
    width: 1020,
    height: 720,
    jpeg: true,
  });

  capture(chrome, tempDir, {
    id: "agents-md-ready",
    html: agentsHtml("ready"),
    outputPath: join(outputDir, "agents-md-ready.jpg"),
    width: 1020,
    height: 720,
    jpeg: true,
  });
}
