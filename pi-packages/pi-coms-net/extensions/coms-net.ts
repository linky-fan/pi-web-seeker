import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

const COMS_NET_DIR = path.join(os.homedir(), ".pi", "coms-net");
const DEFAULT_PROJECT = process.env.PI_COMS_NET_PROJECT ?? "default";
const DEFAULT_TIMEOUT_MS = Number(process.env.PI_COMS_NET_MESSAGE_TTL_MS ?? 1_800_000);
const MAX_HOPS = Number(process.env.PI_COMS_NET_MAX_HOPS ?? 5);
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 10_000;
const CONFIG_POLL_MS = Number(process.env.PI_COMS_NET_CONFIG_POLL_MS ?? 1_000);
const CONFIG_RECONNECT_DEBOUNCE_MS = 250;
const SHARED_RUNTIME_KEY = "__piWebComsNetRuntime";

type AgentStatus = "online" | "stale" | "offline";
type MessageStatus = "queued" | "delivered" | "complete" | "error" | "timeout";
type AgentMessageLike = { role?: string; content?: unknown };
type JsonObject = Record<string, unknown>;

interface AgentCard {
	session_id: string;
	name: string;
	purpose: string;
	model: string;
	provider?: string;
	color: string;
	cwd: string;
	project: string;
	explicit: boolean;
	started_at: string;
	context_used_pct: number;
	queue_depth: number;
	status: AgentStatus;
}

interface MessageRecord {
	msg_id: string;
	project: string;
	sender_session: string;
	target_session: string;
	status: MessageStatus;
	response: unknown;
	error: string | null;
	created_at: string;
	completed_at?: string;
}

interface ServerJson {
	local_url: string;
	public_url?: string;
	project?: string;
}

interface ClientJson {
	server_url?: string;
	project?: string;
}

interface PendingReply {
	resolve(value: unknown): void;
	reject(error: Error): void;
	promise: Promise<unknown>;
	target?: string;
	prompt?: string;
	result?: unknown;
	error?: string | null;
}

interface InboundPrompt {
	msg_id: string;
	project: string;
	prompt: string;
	hops: number;
	sender: {
		session_id: string;
		name: string;
		cwd: string;
	};
	response_schema?: object | null;
}

type VisibleComsNetMessage = {
	customType: string;
	content: string;
	display: boolean;
	details?: unknown;
};

type ToolResult = {
	content: { type: "text"; text: string }[];
	details?: unknown;
	isError?: boolean;
};

interface SharedComsNetMethods {
	reconnect(ctx: ExtensionContext): Promise<void>;
	list(params: { include_explicit?: boolean }): Promise<ToolResult>;
	send(params: {
		target: string;
		prompt: string;
		target_session?: string;
		conversation_id?: string;
		response_schema?: unknown;
		hops?: number;
	}, ctx: ExtensionContext): Promise<ToolResult>;
	get(params: { msg_id: string }): Promise<ToolResult>;
	awaitResponse(params: { msg_id: string; timeout_ms?: number }, ctx: ExtensionContext): Promise<ToolResult>;
	isReady(): boolean;
	status(): string | undefined;
}

interface SharedComsNetRuntime {
	sessionId: string;
	owner: symbol | null;
	contexts: Map<symbol, ExtensionContext>;
	methods: SharedComsNetMethods | null;
	status: string | undefined;
	localAgentName: string;
}

declare global {
	// One relay per pi-web process. In standalone pi-agent this simply behaves as the single session runtime.
	var __piWebComsNetRuntime: SharedComsNetRuntime | undefined;
}

function getSharedRuntime(): SharedComsNetRuntime {
	if (!globalThis[SHARED_RUNTIME_KEY]) {
		globalThis[SHARED_RUNTIME_KEY] = {
			sessionId: crypto.randomUUID(),
			owner: null,
			contexts: new Map(),
			methods: null,
			status: undefined,
			localAgentName: "",
		};
	}
	return globalThis[SHARED_RUNTIME_KEY];
}

function readJson<T>(filePath: string): T | null {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
	} catch {
		return null;
	}
}

function isPrivateFile(filePath: string): boolean {
	try {
		if (process.platform === "win32") return true;
		const mode = fs.statSync(filePath).mode & 0o777;
		return (mode & 0o077) === 0;
	} catch {
		return false;
	}
}

function flagString(pi: ExtensionAPI, name: string): string | undefined {
	const value = pi.getFlag(name);
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function flagBool(pi: ExtensionAPI, name: string): boolean {
	return pi.getFlag(name) === true;
}

function discoverServer(project: string): { serverUrl?: string; authToken?: string } {
	const projectDir = path.join(COMS_NET_DIR, "projects", project);
	const client = readJson<ClientJson>(path.join(projectDir, "client.json"));
	const clientSecretPath = path.join(projectDir, "client.secret.json");
	const clientSecret = isPrivateFile(clientSecretPath) ? readJson<{ token?: string }>(clientSecretPath) : null;
	const server = readJson<ServerJson>(path.join(projectDir, "server.json"));
	const secretPath = path.join(projectDir, "server.secret.json");
	const secret = isPrivateFile(secretPath) ? readJson<{ token?: string }>(secretPath) : null;
	return {
		serverUrl: client?.server_url || server?.public_url || server?.local_url,
		authToken: clientSecret?.token || secret?.token,
	};
}

function fallbackName(cwd: string): string {
	for (const entries of Object.values(os.networkInterfaces())) {
		for (const entry of entries ?? []) {
			if (entry.family === "IPv4" && !entry.internal) return entry.address;
		}
	}
	return os.hostname() || path.basename(cwd || process.cwd()) || "pi-agent";
}

function fallbackColor(seed: string): string {
	const palette = ["#72F1B8", "#36F9F6", "#FF7EDB", "#FEDE5D", "#C792EA", "#FF8B39", "#4D9DE0"];
	const h = crypto.createHash("sha256").update(seed).digest("hex").slice(0, 8);
	return palette[Number(BigInt(`0x${h}`)) % palette.length];
}

function asObject(value: unknown): JsonObject {
	return value && typeof value === "object" ? value as JsonObject : {};
}

function parseInboundPrompt(value: unknown): InboundPrompt | null {
	const body = asObject(value);
	const sender = asObject(body.sender);
	if (
		typeof body.msg_id !== "string" ||
		typeof body.project !== "string" ||
		typeof body.prompt !== "string" ||
		typeof body.hops !== "number" ||
		typeof sender.session_id !== "string" ||
		typeof sender.name !== "string" ||
		typeof sender.cwd !== "string"
	) {
		return null;
	}
	return {
		msg_id: body.msg_id,
		project: body.project,
		prompt: body.prompt,
		hops: body.hops,
		sender: {
			session_id: sender.session_id,
			name: sender.name,
			cwd: sender.cwd,
		},
		response_schema: body.response_schema && typeof body.response_schema === "object"
			? body.response_schema as object
			: null,
	};
}

function textFromMessage(message: AgentMessageLike): string {
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			if (typeof part === "string") return part;
			const obj = asObject(part);
			if (obj.type === "text" && typeof obj.text === "string") return obj.text;
			return "";
		})
		.filter(Boolean)
		.join("");
}

function latestAssistantText(messages: AgentMessageLike[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === "assistant") {
			const text = textFromMessage(messages[i]).trim();
			if (text) return text;
		}
	}
	return "";
}

async function httpJson<T>(serverUrl: string, token: string, pathName: string, init: RequestInit = {}): Promise<T> {
	const res = await fetch(new URL(pathName, serverUrl), {
		...init,
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${token}`,
			...(init.headers ?? {}),
		},
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : `HTTP ${res.status}`);
	return body as T;
}

async function readSse(
	serverUrl: string,
	token: string,
	pathName: string,
	signal: AbortSignal,
	onEvent: (event: string, data: unknown) => void,
) {
	const res = await fetch(new URL(pathName, serverUrl), {
		headers: { authorization: `Bearer ${token}` },
		signal,
	});
	if (!res.ok || !res.body) throw new Error(`SSE failed: HTTP ${res.status}`);

	const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
	let buffer = "";
	while (!signal.aborted) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += value;
		let splitAt = buffer.indexOf("\n\n");
		while (splitAt >= 0) {
			const frame = buffer.slice(0, splitAt);
			buffer = buffer.slice(splitAt + 2);
			let event = "message";
			const dataLines: string[] = [];
			for (const line of frame.split(/\r?\n/)) {
				if (line.startsWith("event:")) event = line.slice("event:".length).trim();
				else if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trimStart());
			}
			if (dataLines.length > 0) {
				try {
					onEvent(event, JSON.parse(dataLines.join("\n")));
				} catch {
					onEvent(event, dataLines.join("\n"));
				}
			}
			splitAt = buffer.indexOf("\n\n");
		}
	}
}

export default function comsNetExtension(pi: ExtensionAPI) {
	pi.registerFlag("cname", { type: "string", description: "Name advertised to coms-net peers" });
	pi.registerFlag("purpose", { type: "string", description: "Short purpose shown to coms-net peers" });
	pi.registerFlag("project", { type: "string", description: "coms-net project namespace" });
	pi.registerFlag("color", { type: "string", description: "Hex color shown to coms-net peers" });
	pi.registerFlag("explicit", { type: "boolean", description: "Hide this agent from default coms-net list output" });
	pi.registerFlag("server-url", { type: "string", description: "coms-net hub URL" });
	pi.registerFlag("auth-token", { type: "string", description: "coms-net hub bearer token" });

	const instanceId = Symbol("coms-net-extension");
	const sharedRuntime = getSharedRuntime();
	const sessionId = sharedRuntime.sessionId;
	let serverUrl = "";
	let authToken = "";
	let project = DEFAULT_PROJECT;
	let heartbeatMs = 10_000;
	let abortSse: AbortController | null = null;
	let heartbeatTimer: NodeJS.Timeout | null = null;
	let reconnectTimer: NodeJS.Timeout | null = null;
	let configReconnectTimer: NodeJS.Timeout | null = null;
	let configPollTimer: NodeJS.Timeout | null = null;
	let staleMonitorTimer: NodeJS.Timeout | null = null;
	let configWatchers: fs.FSWatcher[] = [];
	let watchedProject: string | null = null;
	let configSignature = "";
	let reconnectAttempt = 0;
	let ready = false;
	let shuttingDown = false;
	let localAgentName = "";
	let lastCtx: ExtensionContext | null = null;
	let activeInbound: InboundPrompt | null = null;
	const pendingReplies = new Map<string, PendingReply>();
	const peers = new Map<string, AgentCard>();

	function configured() {
		if (!ready || !serverUrl || !authToken) throw new Error("coms-net is not connected. Start npm run coms-net:server or pass --server-url/--auth-token.");
	}

	function isOwner() {
		return sharedRuntime.owner === instanceId;
	}

	function delegate(): SharedComsNetMethods | null {
		return !isOwner() ? sharedRuntime.methods : null;
	}

	function setStatus(ctx: ExtensionContext, status: string | undefined) {
		sharedRuntime.status = status;
		try {
			if (ctx.hasUI) ctx.ui.setStatus("coms-net", status);
		} catch {
			// Contexts become stale during session replacement/disposal.
		}
	}

	function notify(ctx: ExtensionContext, message: string, level: "info" | "warning") {
		try {
			if (ctx.hasUI) ctx.ui.notify(message, level);
		} catch {
			// Contexts become stale during session replacement/disposal.
		}
	}

	function projectDirFor(projectName: string) {
		return path.join(COMS_NET_DIR, "projects", projectName);
	}

	function currentConfigSignature(projectName: string) {
		const discovered = discoverServer(projectName);
		return JSON.stringify({
			project: projectName,
			serverUrl: discovered.serverUrl ?? "",
			hasToken: Boolean(discovered.authToken),
		});
	}

	function clearConfigWatchers() {
		for (const watcher of configWatchers) watcher.close();
		configWatchers = [];
		if (configPollTimer) clearInterval(configPollTimer);
		configPollTimer = null;
		if (configReconnectTimer) clearTimeout(configReconnectTimer);
		configReconnectTimer = null;
		watchedProject = null;
	}

	function isContextActive(ctx: ExtensionContext) {
		try {
			void ctx.mode;
			return true;
		} catch {
			return false;
		}
	}

	function stopStaleMonitor() {
		if (staleMonitorTimer) clearInterval(staleMonitorTimer);
		staleMonitorTimer = null;
	}

	function stopConnection() {
		abortSse?.abort();
		abortSse = null;
		if (heartbeatTimer) clearInterval(heartbeatTimer);
		heartbeatTimer = null;
	}

	function cleanupRuntime(ctx?: ExtensionContext) {
		if (!isOwner()) return;
		if (ctx && lastCtx !== ctx) return;
		shuttingDown = true;
		ready = false;
		stopConnection();
		if (reconnectTimer) clearTimeout(reconnectTimer);
		reconnectTimer = null;
		clearConfigWatchers();
		stopStaleMonitor();
		lastCtx = null;
		sharedRuntime.owner = null;
		sharedRuntime.methods = null;
		sharedRuntime.status = undefined;
	}

	function startStaleMonitor(ctx: ExtensionContext) {
		stopStaleMonitor();
		staleMonitorTimer = setInterval(() => {
			if (!isContextActive(ctx)) cleanupRuntime(ctx);
		}, 1_000);
		staleMonitorTimer.unref?.();
	}

	function scheduleConfigReconnect() {
		if (!lastCtx || shuttingDown) return;
		const ctx = lastCtx;
		if (configReconnectTimer) clearTimeout(configReconnectTimer);
		configReconnectTimer = setTimeout(() => {
			configReconnectTimer = null;
			if (shuttingDown || lastCtx !== ctx) return;
			void connect(ctx).catch((error) => {
				if (shuttingDown || lastCtx !== ctx) return;
				ready = false;
				setStatus(ctx, "coms-net: offline");
				notify(ctx, `coms-net reconnect failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
			});
		}, CONFIG_RECONNECT_DEBOUNCE_MS);
		configReconnectTimer.unref?.();
	}

	function isRelevantConfigFile(fileName: string | Buffer | null) {
		if (!fileName) return true;
		const name = fileName.toString();
		return name === watchedProject ||
			name === "client.json" ||
			name === "client.secret.json" ||
			name === "server.json" ||
			name === "server.secret.json";
	}

	function watchConfigTarget(target: string) {
		try {
			if (!fs.existsSync(target)) return;
			const watcher = fs.watch(target, { persistent: false }, (_event, fileName) => {
				if (isRelevantConfigFile(fileName)) scheduleConfigReconnect();
			});
			configWatchers.push(watcher);
		} catch {
			// Polling below is the cross-platform fallback.
		}
	}

	function ensureConfigWatcher(projectName: string) {
		if (watchedProject === projectName) return;
		clearConfigWatchers();
		watchedProject = projectName;
		configSignature = currentConfigSignature(projectName);
		const projectDir = projectDirFor(projectName);
		watchConfigTarget(path.dirname(projectDir));
		watchConfigTarget(projectDir);
		configPollTimer = setInterval(() => {
			const nextSignature = currentConfigSignature(projectName);
			if (nextSignature === configSignature) return;
			configSignature = nextSignature;
			scheduleConfigReconnect();
		}, CONFIG_POLL_MS);
		configPollTimer.unref?.();
	}

	function scheduleReconnect() {
		if (!isOwner() || !lastCtx || reconnectTimer || shuttingDown) return;
		const ctx = lastCtx;
		const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempt, RECONNECT_MAX_MS);
		reconnectAttempt += 1;
		reconnectTimer = setTimeout(() => {
			reconnectTimer = null;
			if (!shuttingDown && lastCtx === ctx) void connect(ctx).catch(() => scheduleReconnect());
		}, delay);
	}

	function recordVisibleMessage(ctx: ExtensionContext, message: VisibleComsNetMessage) {
		const manager = ctx.sessionManager as unknown as {
			appendCustomMessageEntry?: (customType: string, content: VisibleComsNetMessage["content"], display: boolean, details?: unknown) => void;
		};
		if (manager.appendCustomMessageEntry) {
			manager.appendCustomMessageEntry(message.customType, message.content, message.display, message.details);
			return;
		}
		pi.sendMessage(message, { deliverAs: ctx.isIdle() ? "nextTurn" : "followUp" });
	}

	async function submitResponse(ctx: ExtensionContext, prompt: InboundPrompt, response: unknown, error: string | null) {
		await httpJson(serverUrl, authToken, `/v1/messages/${encodeURIComponent(prompt.msg_id)}/response`, {
			method: "POST",
			body: JSON.stringify({
				project,
				responder_session: sessionId,
				response,
				error,
			}),
		});
		recordVisibleMessage(
			ctx,
			{
				customType: "coms-net-response-sent",
				display: true,
				content: error
					? `Failed to answer ${prompt.sender.name}: ${error}`
					: `Answered ${prompt.sender.name}`,
				details: {
					msg_id: prompt.msg_id,
					project,
					target: prompt.sender,
					response,
					error,
				},
			}
		);
	}

	function handlePrompt(ctx: ExtensionContext, prompt: InboundPrompt) {
		if (prompt.hops >= MAX_HOPS) {
			void submitResponse(ctx, prompt, null, "hop_limit");
			return;
		}
		activeInbound = prompt;
		const schemaText = prompt.response_schema ? `\nResponse schema requested by sender:\n${JSON.stringify(prompt.response_schema, null, 2)}\n` : "";
		pi.sendMessage(
			{
				customType: "coms-net-inbound",
				display: true,
				content: `coms-net request from ${prompt.sender.name}: ${prompt.prompt}`,
				details: prompt,
			},
			{ deliverAs: "followUp", triggerTurn: true },
		);
		pi.sendUserMessage(
			`A coms-net peer named "${prompt.sender.name}" asked for help.\n\nRequest:\n${prompt.prompt}\n${schemaText}\nAnswer the peer directly. Do not call coms_net_send for this same request unless the user explicitly asks you to delegate it further.`,
			{ deliverAs: ctx.isIdle() ? "followUp" : "followUp" },
		);
	}

	function rememberPeer(agent: AgentCard) {
		if (agent.session_id === sessionId) {
			peers.delete(agent.session_id);
			return;
		}
		peers.set(agent.session_id, agent);
	}

	function handleEvent(ctx: ExtensionContext, event: string, data: unknown) {
		const body = asObject(data);
		if (event === "pool_snapshot" && Array.isArray(body.agents)) {
			peers.clear();
			for (const agent of body.agents as AgentCard[]) rememberPeer(agent);
		} else if ((event === "agent_joined" || event === "agent_updated") && body.agent && typeof body.agent === "object") {
			const agent = body.agent as AgentCard;
			rememberPeer(agent);
		} else if ((event === "agent_left" || event === "agent_stale") && body.session_id) {
			const session = String(body.session_id);
			const agent = peers.get(session);
			if (agent && event === "agent_stale") agent.status = "stale";
			else peers.delete(session);
		} else if (event === "prompt" && typeof body.msg_id === "string") {
			const prompt = parseInboundPrompt(body);
			if (prompt) handlePrompt(ctx, prompt);
		} else if (event === "response" && typeof body.msg_id === "string") {
			const pending = pendingReplies.get(body.msg_id);
			if (pending) {
				pending.result = body.response;
				pending.error = typeof body.error === "string" ? body.error : null;
				recordVisibleMessage(
					ctx,
					{
						customType: "coms-net-response-received",
						display: true,
						content: pending.error
							? `coms-net response failed: ${pending.error}`
							: `coms-net response received from ${pending.target ?? "peer"}`,
						details: {
							msg_id: body.msg_id,
							project,
							target: pending.target,
							prompt: pending.prompt,
							response: body.response,
							error: pending.error,
						},
					}
				);
				if (pending.error) pending.reject(new Error(pending.error));
				else pending.resolve(body.response);
			}
		}
	}

	async function connect(ctx: ExtensionContext) {
		sharedRuntime.contexts.set(instanceId, ctx);
		if (sharedRuntime.owner && sharedRuntime.owner !== instanceId && sharedRuntime.methods) {
			setStatus(ctx, sharedRuntime.status ?? "coms-net: shared relay");
			return;
		}
		sharedRuntime.owner = instanceId;
		shuttingDown = false;
		lastCtx = ctx;
		startStaleMonitor(ctx);
		stopConnection();

		project = flagString(pi, "project") ?? process.env.PI_COMS_NET_PROJECT ?? DEFAULT_PROJECT;
		ensureConfigWatcher(project);
		const discovered = discoverServer(project);
		serverUrl = flagString(pi, "server-url") ?? process.env.PI_COMS_NET_SERVER_URL ?? discovered.serverUrl ?? "";
		authToken = flagString(pi, "auth-token") ?? process.env.PI_COMS_NET_AUTH_TOKEN ?? discovered.authToken ?? "";
		configSignature = currentConfigSignature(project);
		if (!serverUrl || !authToken) {
			ready = false;
			setStatus(ctx, "coms-net: offline");
			return;
		}

		const name = flagString(pi, "cname") ?? process.env.PI_COMS_NET_NAME ?? fallbackName(ctx.cwd);
		localAgentName = name;
		sharedRuntime.localAgentName = name;
		const purpose = flagString(pi, "purpose") ?? process.env.PI_COMS_NET_PURPOSE ?? "";
		const color = flagString(pi, "color") ?? fallbackColor(sessionId);
		const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "unknown";
		const register = await httpJson<{ agent: AgentCard; heartbeat_interval_ms?: number; sse_url: string }>(
			serverUrl,
			authToken,
			"/v1/agents/register",
			{
				method: "POST",
				body: JSON.stringify({
					project,
					session_id: sessionId,
					name,
					purpose,
					model,
					provider: ctx.model?.provider,
					color,
					cwd: ctx.cwd,
					explicit: flagBool(pi, "explicit"),
				}),
			},
		);
		heartbeatMs = register.heartbeat_interval_ms ?? heartbeatMs;
		ready = true;
		reconnectAttempt = 0;
		setStatus(ctx, `coms-net: ${register.agent.name}`);
		sharedRuntime.methods = {
			reconnect: async () => {
				if (!lastCtx) throw new Error("coms-net relay has no inbox session");
				await connect(lastCtx);
			},
			list: listAgents,
			send: sendMessage,
			get: getMessage,
			awaitResponse,
			isReady: () => ready,
			status: () => sharedRuntime.status,
		};

		heartbeatTimer = setInterval(() => {
			if (!isContextActive(ctx)) {
				cleanupRuntime(ctx);
				return;
			}
			const usage = ctx.getContextUsage();
			void httpJson(serverUrl, authToken, `/v1/agents/${encodeURIComponent(sessionId)}/heartbeat?project=${encodeURIComponent(project)}`, {
				method: "POST",
				body: JSON.stringify({
					project,
					context_used_pct: usage?.percent ?? 0,
					queue_depth: activeInbound ? 1 : 0,
					model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
					status: "online",
				}),
			}).catch(() => scheduleReconnect());
		}, heartbeatMs);
		heartbeatTimer.unref?.();

		const sseController = new AbortController();
		abortSse = sseController;
		void readSse(serverUrl, authToken, register.sse_url, sseController.signal, (event, data) => handleEvent(ctx, event, data))
			.catch(() => {
				if (!sseController.signal.aborted && abortSse === sseController) scheduleReconnect();
			});
	}

	pi.on("session_start", async (_event, ctx) => {
		shuttingDown = false;
		await connect(ctx).catch((error) => {
			ready = false;
			setStatus(ctx, "coms-net: offline");
			notify(ctx, `coms-net connection failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
		});
	});

	pi.on("session_shutdown", async () => {
		sharedRuntime.contexts.delete(instanceId);
		if (!isOwner()) return;
		const wasReady = ready;
		cleanupRuntime();
		if (wasReady) {
			await httpJson(serverUrl, authToken, `/v1/agents/${encodeURIComponent(sessionId)}?project=${encodeURIComponent(project)}`, {
				method: "DELETE",
			}).catch(() => {});
		}
	});

	pi.on("agent_end", async (event, ctx) => {
		if (!isOwner() || !activeInbound || !ready) return;
		const inbound = activeInbound;
		activeInbound = null;
		const response = latestAssistantText(event.messages);
		await submitResponse(ctx, inbound, response || null, response ? null : "no_assistant_response").catch(() => {});
	});

	pi.registerCommand("coms-net-connect", {
		description: "Reconnect this session to the configured coms-net hub.",
		handler: async (_args, ctx) => {
			const delegated = delegate();
			if (delegated) {
				await delegated.reconnect(ctx);
				notify(ctx, delegated.isReady() ? "coms-net relay reconnected" : "coms-net is not configured", delegated.isReady() ? "info" : "warning");
				return;
			}
			await connect(ctx);
			notify(ctx, ready ? "coms-net reconnected" : "coms-net is not configured", ready ? "info" : "warning");
		},
	});

	async function listAgents(params: { include_explicit?: boolean }): Promise<ToolResult> {
		configured();
		const include = params.include_explicit ? "&include_explicit=1" : "";
		const res = await httpJson<{ agents: AgentCard[] }>(serverUrl, authToken, `/v1/agents?project=${encodeURIComponent(project)}${include}`);
		const agents = res.agents.filter((agent) => agent.session_id !== sessionId);
		for (const agent of agents) rememberPeer(agent);
		return {
			content: [{ type: "text", text: JSON.stringify(agents, null, 2) }],
			details: { ...res, agents },
		};
	}

	async function sendMessage(params: {
		target: string;
		prompt: string;
		target_session?: string;
		conversation_id?: string;
		response_schema?: unknown;
		hops?: number;
	}, ctx: ExtensionContext): Promise<ToolResult> {
		configured();
		const selfNames = new Set([sessionId, localAgentName, sharedRuntime.localAgentName].filter(Boolean));
		if (params.target_session === sessionId || selfNames.has(params.target)) {
			throw new Error("cannot_send_to_self");
		}
		const hops = Number(params.hops ?? 0);
		if (hops > MAX_HOPS) throw new Error("hop_limit");
		const reply = {} as PendingReply;
		reply.target = params.target;
		reply.prompt = params.prompt;
		reply.promise = new Promise((resolve, reject) => {
			reply.resolve = resolve;
			reply.reject = reject;
		});
		const res = await httpJson<{ msg_id: string; status: MessageStatus; target_session: string }>(serverUrl, authToken, "/v1/messages", {
			method: "POST",
			body: JSON.stringify({
				project,
				sender_session: sessionId,
				target: params.target,
				target_session: params.target_session ?? null,
				prompt: params.prompt,
				conversation_id: params.conversation_id ?? null,
				response_schema: params.response_schema ?? null,
				hops,
			}),
		});
		pendingReplies.set(res.msg_id, reply);
		recordVisibleMessage(
			ctx,
			{
				customType: "coms-net-outbound",
				display: true,
				content: `Sent coms-net request to ${params.target}: ${params.prompt}`,
				details: {
					...res,
					project,
					target: params.target,
					target_session: res.target_session,
					prompt: params.prompt,
					conversation_id: params.conversation_id ?? null,
				},
			}
		);
		return {
			content: [{ type: "text", text: `Sent coms-net message ${res.msg_id} (${res.status}). Call coms_net_await with this msg_id for the response.` }],
			details: res,
		};
	}

	async function getMessage(params: { msg_id: string }): Promise<ToolResult> {
		configured();
		const pending = pendingReplies.get(params.msg_id);
		if (pending?.result !== undefined || pending?.error) {
			return {
				content: [{ type: "text", text: pending.error ? `Error: ${pending.error}` : JSON.stringify(pending.result, null, 2) }],
				details: { msg_id: params.msg_id, response: pending.result, error: pending.error },
				isError: Boolean(pending.error),
			};
		}
		const res = await httpJson<MessageRecord>(serverUrl, authToken, `/v1/messages/${encodeURIComponent(params.msg_id)}`);
		return {
			content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
			details: res,
			isError: Boolean(res.error),
		};
	}

	async function awaitResponse(params: { msg_id: string; timeout_ms?: number }, ctx: ExtensionContext): Promise<ToolResult> {
		configured();
		const timeout = Math.max(1, Math.min(Number(params.timeout_ms ?? 120_000), DEFAULT_TIMEOUT_MS));
		const pending = pendingReplies.get(params.msg_id);
		const serverAwait = httpJson<MessageRecord>(
			serverUrl,
			authToken,
			`/v1/messages/${encodeURIComponent(params.msg_id)}/await?timeout_ms=${encodeURIComponent(String(timeout))}`,
		).then((message) => {
			if (message.error) throw new Error(message.error);
			return message.response;
		});
		const response = await (pending ? Promise.race([pending.promise, serverAwait]) : serverAwait);
		if (!pending) {
			recordVisibleMessage(
				ctx,
				{
					customType: "coms-net-response-received",
					display: true,
					content: `coms-net response received for ${params.msg_id}`,
					details: {
						msg_id: params.msg_id,
						project,
						response,
						error: null,
					},
				}
			);
		}
		return {
			content: [{ type: "text", text: typeof response === "string" ? response : JSON.stringify(response, null, 2) }],
			details: { msg_id: params.msg_id, response },
		};
	}

	pi.registerTool(defineTool({
		name: "coms_net_list",
		label: "List coms-net agents",
		description: "List Pi agents currently connected to the same coms-net project.",
		parameters: Type.Object({
			include_explicit: Type.Optional(Type.Boolean({ description: "Include agents that opted into explicit-only visibility." })),
		}),
		async execute(_id, params) {
			return (delegate() ?? sharedRuntime.methods)?.list(params) ?? listAgents(params);
		},
	}));

	pi.registerTool(defineTool({
		name: "coms_net_send",
		label: "Send coms-net request",
		description: "Send a prompt to another Pi agent on coms-net. Use coms_net_await to wait for the answer.",
		parameters: Type.Object({
			target: Type.String({ description: "Target agent name or session id." }),
			prompt: Type.String({ description: "The request to send to the target agent." }),
			target_session: Type.Optional(Type.String({ description: "Exact target session id when names are ambiguous." })),
			conversation_id: Type.Optional(Type.String({ description: "Optional caller-managed conversation id." })),
			response_schema: Type.Optional(Type.Any({ description: "Optional JSON schema describing the desired answer shape." })),
			hops: Type.Optional(Type.Number({ description: "Delegation hop count. Defaults to 0." })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			return (delegate() ?? sharedRuntime.methods)?.send(params, ctx) ?? sendMessage(params, ctx);
		},
	}));

	pi.registerTool(defineTool({
		name: "coms_net_get",
		label: "Get coms-net message",
		description: "Get the current status and response for a coms-net message id.",
		parameters: Type.Object({
			msg_id: Type.String({ description: "Message id returned by coms_net_send." }),
		}),
		async execute(_id, params) {
			return (delegate() ?? sharedRuntime.methods)?.get(params) ?? getMessage(params);
		},
	}));

	pi.registerTool(defineTool({
		name: "coms_net_await",
		label: "Await coms-net response",
		description: "Wait for a coms-net response until the timeout expires.",
		parameters: Type.Object({
			msg_id: Type.String({ description: "Message id returned by coms_net_send." }),
			timeout_ms: Type.Optional(Type.Number({ description: "Timeout in milliseconds." })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			return (delegate() ?? sharedRuntime.methods)?.awaitResponse(params, ctx) ?? awaitResponse(params, ctx);
		},
	}));
}
