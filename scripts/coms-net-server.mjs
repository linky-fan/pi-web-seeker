#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const HOST = process.env.PI_COMS_NET_HOST ?? "127.0.0.1";
const PORT = Number(process.env.PI_COMS_NET_PORT ?? 0);
const PUBLIC_URL = process.env.PI_COMS_NET_PUBLIC_URL;
const PROJECT = process.env.PI_COMS_NET_PROJECT ?? "default";
const ENV_TOKEN = process.env.PI_COMS_NET_AUTH_TOKEN;
const REG_ROOT = path.join(os.homedir(), ".pi", "coms-net");
const HEARTBEAT_MS = Number(process.env.PI_COMS_NET_HEARTBEAT_MS ?? 10_000);
const MESSAGE_TTL_MS = Number(process.env.PI_COMS_NET_MESSAGE_TTL_MS ?? 1_800_000);
const MAX_INBOX = Number(process.env.PI_COMS_NET_MAX_INBOX ?? 100);
const STALE_AFTER_MS = Number(process.env.PI_COMS_NET_STALE_AFTER_MS ?? 30_000);
const OFFLINE_AFTER_MS = Number(process.env.PI_COMS_NET_OFFLINE_AFTER_MS ?? 60_000);
const MAX_HOPS = Number(process.env.PI_COMS_NET_MAX_HOPS ?? 5);

const serverId = crypto.randomUUID();
const startedAt = new Date().toISOString();
let token = ENV_TOKEN ?? "";
let ownsTokenFile = false;

const state = {
  projects: new Map(),
};

function nowIso() {
  return new Date().toISOString();
}

function projectState(project) {
  let p = state.projects.get(project);
  if (!p) {
    p = {
      agents: new Map(),
      nameIndex: new Map(),
      messages: new Map(),
      streams: new Map(),
      awaiters: new Map(),
    };
    state.projects.set(project, p);
  }
  return p;
}

function json(res, status, body, headers = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
    ...headers,
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 2_000_000) {
        reject(new Error("body_too_large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}

function authed(req) {
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const got = header.slice("Bearer ".length);
  const a = Buffer.from(got);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sseFrame(event, data, id) {
  const lines = [`event: ${event}`];
  if (id !== undefined) lines.push(`id: ${id}`);
  const text = JSON.stringify(data);
  for (const line of text.split("\n")) lines.push(`data: ${line}`);
  return `${lines.join("\n")}\n\n`;
}

function entryToCard(entry) {
  const card = { ...entry };
  delete card.last_seen_at;
  delete card.registered_at;
  return card;
}

function emit(project, event, data) {
  const p = projectState(project);
  for (const stream of p.streams.values()) stream.send(event, data);
}

function sendTo(project, sessionId, event, data) {
  projectState(project).streams.get(sessionId)?.send(event, data);
}

function resolveName(project, desired, ignoreSessionId) {
  const p = projectState(project);
  const taken = p.nameIndex.get(desired);
  if (!taken || taken.size === 0 || (taken.size === 1 && taken.has(ignoreSessionId))) return desired;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${desired}-${i}`;
    const set = p.nameIndex.get(candidate);
    if (!set || set.size === 0) return candidate;
  }
  return `${desired}-${crypto.randomBytes(3).toString("hex")}`;
}

function indexName(project, name, sid) {
  const p = projectState(project);
  const set = p.nameIndex.get(name) ?? new Set();
  set.add(sid);
  p.nameIndex.set(name, set);
}

function unindexName(project, name, sid) {
  const p = projectState(project);
  const set = p.nameIndex.get(name);
  if (!set) return;
  set.delete(sid);
  if (set.size === 0) p.nameIndex.delete(name);
}

async function registerAgent(req, res) {
  const body = await readBody(req);
  const project = String(body.project || PROJECT);
  const p = projectState(project);
  const sid = String(body.session_id || "");
  if (!sid) return json(res, 400, { ok: false, error: "session_id_required" });

  const existing = p.agents.get(sid);
  if (existing) unindexName(project, existing.name, sid);
  const name = resolveName(project, String(body.name || `agent-${sid.slice(-6)}`), sid);
  const entry = {
    session_id: sid,
    name,
    purpose: String(body.purpose || ""),
    model: String(body.model || "unknown"),
    provider: typeof body.provider === "string" ? body.provider : undefined,
    color: String(body.color || "#72F1B8"),
    cwd: String(body.cwd || ""),
    project,
    explicit: body.explicit === true,
    started_at: String(body.started_at || existing?.started_at || nowIso()),
    context_used_pct: 0,
    queue_depth: 0,
    status: "online",
    registered_at: existing?.registered_at ?? nowIso(),
    last_seen_at: nowIso(),
  };
  p.agents.set(sid, entry);
  indexName(project, name, sid);
  emit(project, existing ? "agent_updated" : "agent_joined", { project, agent: entryToCard(entry) });
  json(res, 200, {
    ok: true,
    agent: entryToCard(entry),
    heartbeat_interval_ms: HEARTBEAT_MS,
    sse_url: `/v1/events?project=${encodeURIComponent(project)}&session_id=${encodeURIComponent(sid)}`,
  });
}

function handleEvents(req, res, url) {
  const project = url.searchParams.get("project") || PROJECT;
  const sid = url.searchParams.get("session_id") || "";
  const p = projectState(project);
  const entry = p.agents.get(sid);
  if (!entry) return json(res, 404, { ok: false, error: "agent_not_registered" });

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  let id = 0;
  const stream = {
    send(event, data) {
      res.write(sseFrame(event, data, ++id));
    },
  };
  p.streams.set(sid, stream);
  stream.send("hello", { server_id: serverId, server_time: nowIso() });
  stream.send("pool_snapshot", {
    project,
    agents: [...p.agents.values()].filter((a) => a.session_id !== sid && !a.explicit).map(entryToCard),
  });
  const keepAlive = setInterval(() => res.write(": keepalive\n\n"), 15_000);
  req.on("close", () => {
    clearInterval(keepAlive);
    if (p.streams.get(sid) === stream) p.streams.delete(sid);
  });
}

async function heartbeat(req, res, project, sid) {
  const body = await readBody(req);
  const p = projectState(project);
  const entry = p.agents.get(sid);
  if (!entry) return json(res, 404, { ok: false, error: "agent_not_registered" });
  entry.last_seen_at = nowIso();
  entry.status = body.status === "stale" || body.status === "offline" ? body.status : "online";
  entry.context_used_pct = Number(body.context_used_pct ?? entry.context_used_pct) || 0;
  entry.queue_depth = Number(body.queue_depth ?? entry.queue_depth) || 0;
  if (typeof body.model === "string") entry.model = body.model;
  emit(project, "agent_updated", { project, agent: entryToCard(entry) });
  json(res, 200, { ok: true });
}

function unregister(res, project, sid) {
  const p = projectState(project);
  const entry = p.agents.get(sid);
  if (entry) {
    p.agents.delete(sid);
    unindexName(project, entry.name, sid);
    emit(project, "agent_left", { project, session_id: sid });
  }
  json(res, 200, { ok: true });
}

function listAgents(res, url) {
  const project = url.searchParams.get("project") || PROJECT;
  const includeExplicit = url.searchParams.get("include_explicit") === "1";
  const agents = [...projectState(project).agents.values()]
    .filter((agent) => includeExplicit || !agent.explicit)
    .map(entryToCard);
  json(res, 200, { agents });
}

function targetAgent(p, body) {
  if (body.target_session) return p.agents.get(String(body.target_session)) ?? null;
  const target = String(body.target || "");
  const direct = p.agents.get(target);
  if (direct) return direct;
  const bag = p.nameIndex.get(target);
  if (!bag || bag.size !== 1) return null;
  return p.agents.get([...bag][0]) ?? null;
}

async function sendMessage(req, res) {
  const body = await readBody(req);
  const project = String(body.project || PROJECT);
  const p = projectState(project);
  const sender = p.agents.get(String(body.sender_session || ""));
  if (!sender) return json(res, 404, { ok: false, error: "sender_not_registered" });
  const target = targetAgent(p, body);
  if (!target) return json(res, 404, { ok: false, error: "target_not_found_or_ambiguous" });
  const hops = Number(body.hops ?? 0) || 0;
  if (hops > MAX_HOPS) return json(res, 400, { ok: false, error: "hop_limit" });
  const depth = [...p.messages.values()].filter((m) => m.target_session === target.session_id && m.status === "queued").length;
  if (depth >= MAX_INBOX) return json(res, 429, { ok: false, error: "target_inbox_full" });

  const msg = {
    msg_id: crypto.randomUUID(),
    project,
    sender_session: sender.session_id,
    target_session: target.session_id,
    prompt: String(body.prompt || ""),
    conversation_id: typeof body.conversation_id === "string" ? body.conversation_id : null,
    response_schema: body.response_schema && typeof body.response_schema === "object" ? body.response_schema : null,
    hops,
    status: "queued",
    response: null,
    error: null,
    created_at: nowIso(),
    expires_at: new Date(Date.now() + MESSAGE_TTL_MS).toISOString(),
  };
  p.messages.set(msg.msg_id, msg);
  sendTo(project, target.session_id, "prompt", {
    msg_id: msg.msg_id,
    project,
    prompt: msg.prompt,
    hops,
    sender: { session_id: sender.session_id, name: sender.name, cwd: sender.cwd },
    response_schema: msg.response_schema,
  });
  if (p.streams.has(target.session_id)) {
    msg.status = "delivered";
    msg.delivered_at = nowIso();
  }
  sendTo(project, sender.session_id, "message_status", { msg_id: msg.msg_id, status: msg.status, target_session: target.session_id });
  json(res, 200, { ok: true, msg_id: msg.msg_id, status: msg.status, target_session: target.session_id });
}

function getMessage(res, msgId) {
  for (const p of state.projects.values()) {
    const msg = p.messages.get(msgId);
    if (msg) return json(res, 200, msg);
  }
  json(res, 404, { ok: false, error: "unknown_msg_id" });
}

function awaitMessage(req, res, msgId, url) {
  const timeoutMs = Math.max(1, Math.min(Number(url.searchParams.get("timeout_ms") ?? 30_000), MESSAGE_TTL_MS));
  for (const p of state.projects.values()) {
    const msg = p.messages.get(msgId);
    if (!msg) continue;
    if (msg.status === "complete" || msg.status === "error" || msg.status === "timeout") return json(res, 200, msg);
    const set = p.awaiters.get(msgId) ?? new Set();
    p.awaiters.set(msgId, set);
    const awaiter = {
      resolve: (m) => json(res, 200, m),
      timer: setTimeout(() => {
        set.delete(awaiter);
        if (set.size === 0) p.awaiters.delete(msgId);
        json(res, 200, { ...msg, status: "timeout", response: null, error: "timeout" });
      }, timeoutMs),
    };
    set.add(awaiter);
    req.on("close", () => {
      clearTimeout(awaiter.timer);
      set.delete(awaiter);
    });
    return;
  }
  json(res, 404, { ok: false, error: "unknown_msg_id" });
}

async function submitResponse(req, res, msgId) {
  const body = await readBody(req);
  for (const p of state.projects.values()) {
    const msg = p.messages.get(msgId);
    if (!msg) continue;
    msg.status = body.error ? "error" : "complete";
    msg.response = body.response ?? null;
    msg.error = typeof body.error === "string" ? body.error : null;
    msg.completed_at = nowIso();
    sendTo(msg.project, msg.sender_session, "response", { msg_id: msgId, response: msg.response, error: msg.error });
    sendTo(msg.project, msg.sender_session, "message_status", { msg_id: msgId, status: msg.status });
    const awaiters = p.awaiters.get(msgId);
    if (awaiters) {
      for (const a of awaiters) {
        clearTimeout(a.timer);
        a.resolve(msg);
      }
      p.awaiters.delete(msgId);
    }
    return json(res, 200, { ok: true });
  }
  json(res, 404, { ok: false, error: "unknown_msg_id" });
}

async function route(req, res) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  try {
    if (url.pathname === "/health" && req.method === "GET") {
      return json(res, 200, { ok: true, server_id: serverId, started_at: startedAt });
    }
    if (url.pathname.startsWith("/v1/") && !authed(req)) {
      return json(res, 401, { ok: false, error: "unauthorized" }, { "www-authenticate": 'Bearer realm="coms-net"' });
    }
    if (url.pathname === "/v1/agents/register" && req.method === "POST") return registerAgent(req, res);
    if (url.pathname === "/v1/events" && req.method === "GET") return handleEvents(req, res, url);
    if (url.pathname === "/v1/agents" && req.method === "GET") return listAgents(res, url);
    if (url.pathname === "/v1/messages" && req.method === "POST") return sendMessage(req, res);
    const agentMatch = url.pathname.match(/^\/v1\/agents\/([^/]+)(?:\/(heartbeat))?$/);
    if (agentMatch && agentMatch[2] === "heartbeat" && req.method === "POST") return heartbeat(req, res, url.searchParams.get("project") || PROJECT, decodeURIComponent(agentMatch[1]));
    if (agentMatch && !agentMatch[2] && req.method === "DELETE") return unregister(res, url.searchParams.get("project") || PROJECT, decodeURIComponent(agentMatch[1]));
    const msgMatch = url.pathname.match(/^\/v1\/messages\/([^/]+)(?:\/(await|response))?$/);
    if (msgMatch && !msgMatch[2] && req.method === "GET") return getMessage(res, decodeURIComponent(msgMatch[1]));
    if (msgMatch && msgMatch[2] === "await" && req.method === "GET") return awaitMessage(req, res, decodeURIComponent(msgMatch[1]), url);
    if (msgMatch && msgMatch[2] === "response" && req.method === "POST") return submitResponse(req, res, decodeURIComponent(msgMatch[1]));
    return json(res, 404, { ok: false, error: "not_found" });
  } catch (error) {
    return json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

function writeJsonAtomic(filePath, data, mode) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode });
  fs.renameSync(tmp, filePath);
  if (mode) fs.chmodSync(filePath, mode);
}

function prepareToken() {
  if (token) return;
  const loopback = HOST === "127.0.0.1" || HOST === "localhost" || HOST === "::1";
  if (!loopback) {
    console.error("PI_COMS_NET_AUTH_TOKEN is required when binding coms-net outside loopback.");
    process.exit(1);
  }
  token = crypto.randomBytes(32).toString("base64url");
  ownsTokenFile = true;
}

prepareToken();
const server = http.createServer(route);
server.listen(PORT, HOST, () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : PORT;
  const localUrl = `http://${HOST}:${port}`;
  const projectDir = path.join(REG_ROOT, "projects", PROJECT);
  writeJsonAtomic(path.join(projectDir, "server.json"), {
    version: 1,
    project: PROJECT,
    pid: process.pid,
    host: HOST,
    port,
    local_url: localUrl,
    public_url: PUBLIC_URL,
    started_at: startedAt,
  }, 0o644);
  if (ownsTokenFile) writeJsonAtomic(path.join(projectDir, "server.secret.json"), { token }, 0o600);
  console.log(`coms-net hub ${serverId}`);
  console.log(`project: ${PROJECT}`);
  console.log(`url: ${PUBLIC_URL || localUrl}`);
  console.log(ENV_TOKEN ? "token: from PI_COMS_NET_AUTH_TOKEN" : `token: ${path.join(projectDir, "server.secret.json")}`);
});

setInterval(() => {
  const now = Date.now();
  for (const [project, p] of state.projects) {
    for (const [sid, agent] of [...p.agents]) {
      const age = now - Date.parse(agent.last_seen_at);
      if (age > OFFLINE_AFTER_MS) {
        p.agents.delete(sid);
        unindexName(project, agent.name, sid);
        emit(project, "agent_left", { project, session_id: sid });
      } else if (age > STALE_AFTER_MS && agent.status !== "stale") {
        agent.status = "stale";
        emit(project, "agent_stale", { project, session_id: sid });
      }
    }
    for (const [id, msg] of [...p.messages]) {
      if (Date.parse(msg.expires_at) < now) {
        msg.status = "timeout";
        msg.error = "timeout";
        const awaiters = p.awaiters.get(id);
        if (awaiters) {
          for (const a of awaiters) {
            clearTimeout(a.timer);
            a.resolve(msg);
          }
          p.awaiters.delete(id);
        }
      }
    }
  }
}, 5_000).unref?.();

function cleanup() {
  const projectDir = path.join(REG_ROOT, "projects", PROJECT);
  try { fs.unlinkSync(path.join(projectDir, "server.json")); } catch {}
  if (ownsTokenFile) {
    try { fs.unlinkSync(path.join(projectDir, "server.secret.json")); } catch {}
  }
}

process.on("SIGINT", () => { cleanup(); process.exit(0); });
process.on("SIGTERM", () => { cleanup(); process.exit(0); });
