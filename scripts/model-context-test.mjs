#!/usr/bin/env node
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";

const DEFAULT_AGENT_DIR = path.join(os.homedir(), ".pi", "agent");
const SUPPORTED_APIS = new Set(["openai-completions", "anthropic-messages"]);

function parseArgs(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args.set(key, next);
      i += 1;
    } else {
      args.set(key, "true");
    }
  }
  return args;
}

function readPositiveInteger(args, name, fallback) {
  const raw = args.get(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`--${name} must be a positive integer.`);
  }
  return value;
}

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function envKeyName(provider) {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
}

function makeNeedleDoc(words) {
  const dictionary = [
    "matrix", "signal", "terminal", "operator", "vector", "kernel", "thread", "context",
    "prompt", "token", "agent", "route", "memory", "cache", "branch", "compile",
  ];
  const needles = [
    `MATRIX-START-${words}-red-pill`,
    `MATRIX-MIDDLE-${words}-white-rabbit`,
    `MATRIX-END-${words}-no-spoon`,
  ];
  const slots = new Map([
    [Math.max(16, Math.floor(words * 0.05)), needles[0]],
    [Math.max(32, Math.floor(words * 0.5)), needles[1]],
    [Math.max(48, Math.floor(words * 0.95)), needles[2]],
  ]);
  const parts = [];
  for (let i = 0; i < words; i += 1) {
    if (slots.has(i)) parts.push(`\n<needle>${slots.get(i)}</needle>\n`);
    parts.push(dictionary[i % dictionary.length]);
  }
  return { text: parts.join(" "), needles };
}

function extractText(json) {
  return json?.choices?.[0]?.message?.content
    ?? json?.choices?.[0]?.text
    ?? json?.content?.map?.((block) => block?.text ?? "").join("")
    ?? json?.reply
    ?? json?.output_text
    ?? JSON.stringify(json).slice(0, 2000);
}

function isBusinessOk(api, json) {
  if (api === "anthropic-messages") {
    return Array.isArray(json?.content) && json.content.length > 0 && !json?.error;
  }
  return Array.isArray(json?.choices) && json.choices.length > 0 && !json?.error;
}

function joinEndpoint(baseUrl, api) {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (api === "anthropic-messages") {
    if (trimmed.endsWith("/v1/messages")) return trimmed;
    if (trimmed.endsWith("/anthropic")) return `${trimmed}/v1/messages`;
    return `${trimmed}/messages`;
  }
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

function resolveConfig(args) {
  const agentDir = args.get("agent-dir")
    ?? process.env.PI_CODING_AGENT_DIR
    ?? process.env.PI_AGENT_DIR
    ?? DEFAULT_AGENT_DIR;
  const modelsConfig = readJsonIfExists(path.join(agentDir, "models.json"));
  const authConfig = readJsonIfExists(path.join(agentDir, "auth.json"));

  const provider = args.get("provider") ?? args.get("p");
  if (!provider) {
    throw new Error("Missing --provider. Example: --provider deepseek --model deepseek-v4-pro");
  }

  const providerConfig = modelsConfig.providers?.[provider] ?? {};
  const providerModel = providerConfig.models?.find?.((item) => {
    const requested = args.get("model") ?? args.get("m");
    return requested ? item.id === requested || item.name === requested : false;
  }) ?? {};
  const model = args.get("model") ?? args.get("m") ?? providerModel.id;
  if (!model) {
    throw new Error("Missing --model. Example: --model deepseek-v4-pro");
  }

  const api = args.get("api") ?? providerModel.api ?? providerConfig.api ?? "openai-completions";
  if (!SUPPORTED_APIS.has(api)) {
    throw new Error(`Unsupported API "${api}". This context test currently supports: ${Array.from(SUPPORTED_APIS).join(", ")}.`);
  }
  const defaultBaseUrl = provider === "deepseek" ? "https://api.deepseek.com" : "";
  const baseUrl = args.get("base-url") ?? args.get("url") ?? providerConfig.baseUrl ?? defaultBaseUrl;
  if (!baseUrl) {
    throw new Error("Missing provider base URL. Pass --base-url or configure it in models.json.");
  }

  const envName = args.get("api-key-env") ?? envKeyName(provider);
  const apiKey = process.env[envName] ?? providerConfig.apiKey ?? authConfig[provider]?.key;
  if (!apiKey) {
    throw new Error(`Missing API key. Set ${envName}, models.json providers.${provider}.apiKey, or auth.json ${provider}.key.`);
  }

  return {
    agentDir,
    provider,
    model,
    api,
    endpoint: joinEndpoint(baseUrl, api),
    apiKey,
  };
}

function makeBody(api, model, prompt, args) {
  const maxTokens = Number(args.get("max-tokens") ?? "1024");
  if (api === "anthropic-messages") {
    return {
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      stream: false,
    };
  }
  return {
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    stream: false,
  };
}

function authHeaders(api, apiKey) {
  if (api === "anthropic-messages") {
    return {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    };
  }
  return { "Authorization": `Bearer ${apiKey}` };
}

function postJson(endpoint, payload, apiKey, api, timeoutMs) {
  const parsed = new URL(endpoint);
  const serialized = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = https.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: `${parsed.pathname}${parsed.search}`,
      method: "POST",
      headers: {
        ...authHeaders(api, apiKey),
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(serialized),
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({
        httpOk: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        text: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    });
    req.on("error", reject);
    req.write(serialized);
    req.end();
  });
}

function usageFrom(json) {
  return json?.usage ?? null;
}

function promptTokenCount(usage) {
  const value = usage?.prompt_tokens
    ?? usage?.input_tokens
    ?? usage?.promptTokens
    ?? usage?.inputTokens
    ?? null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function failureReasons(response, businessOk, found, usagePromptTokens) {
  const reasons = [];
  if (!response.httpOk) reasons.push(`HTTP status ${response.status}`);
  if (!businessOk) reasons.push("API response did not include a completion choice/content block");
  const missing = Object.entries(found).filter(([, ok]) => !ok).map(([needle]) => needle);
  if (missing.length > 0) reasons.push(`Missing needles: ${missing.join(", ")}`);
  if (!usagePromptTokens || usagePromptTokens <= 0) reasons.push("Missing non-zero prompt token usage");
  return reasons;
}

const args = parseArgs(process.argv.slice(2));
const started = Date.now();
let testContext = {
  provider: args.get("provider") ?? args.get("p") ?? null,
  model: args.get("model") ?? args.get("m") ?? null,
  api: args.get("api") ?? null,
  endpoint: null,
  agentDir: null,
  targetWords: null,
  approximateChars: null,
  expected: [],
};

try {
  const targetWords = args.has("tokens")
    ? readPositiveInteger(args, "tokens", 8192)
    : readPositiveInteger(args, "words", 8192);
  const timeoutMs = readPositiveInteger(args, "timeout-ms", 600000);
  testContext = { ...testContext, targetWords };
  const { agentDir, provider, model, api, endpoint, apiKey } = resolveConfig(args);
  const { text, needles } = makeNeedleDoc(targetWords);
  const prompt = [
    "You are testing long-context retrieval. The following document contains exactly three XML <needle> values.",
    "Return only a compact JSON object with keys start, middle, end. Do not add explanation.",
    "",
    text,
  ].join("\n");
  const body = makeBody(api, model, prompt, args);
  testContext = {
    provider,
    model,
    api,
    endpoint,
    agentDir,
    targetWords,
    approximateChars: prompt.length,
    expected: needles,
  };
  const response = await postJson(endpoint, body, apiKey, api, timeoutMs);
  const raw = response.text;
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    json = { raw: raw.slice(0, 2000) };
  }

  const businessOk = isBusinessOk(api, json);
  const answer = extractText(json);
  const found = Object.fromEntries(needles.map((needle) => [needle, answer.includes(needle)]));
  const usage = usageFrom(json);
  const usagePromptTokens = promptTokenCount(usage);
  const failures = failureReasons(response, businessOk, found, usagePromptTokens);
  const passed = failures.length === 0;
  console.log(JSON.stringify({
    ok: passed,
    httpOk: response.httpOk,
    status: response.status,
    businessOk,
    needlesFound: Object.values(found).every(Boolean),
    usagePromptTokens,
    ...testContext,
    elapsedMs: Date.now() - started,
    found,
    failures,
    answer,
    usage,
    error: passed ? null : json,
  }, null, 2));
  if (!passed) process.exitCode = 1;
} catch (error) {
  console.log(JSON.stringify({
    ok: false,
    httpOk: false,
    status: null,
    businessOk: false,
    needlesFound: false,
    usagePromptTokens: null,
    ...testContext,
    elapsedMs: Date.now() - started,
    found: Object.fromEntries(testContext.expected.map((needle) => [needle, false])),
    failures: [error instanceof Error ? error.message : String(error)],
    answer: null,
    usage: null,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
}
