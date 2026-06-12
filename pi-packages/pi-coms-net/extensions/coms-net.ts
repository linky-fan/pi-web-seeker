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
	const base = path.basename(cwd || process.cwd()) || "pi-agent";
	const suffix = crypto.randomBytes(2).toString("hex");
	return `${base}-${suffix}`;
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

	const sessionId = crypto.randomUUID();
	let serverUrl = "";
	let authToken = "";
	let project = DEFAULT_PROJECT;
	let heartbeatMs = 10_000;
	let abortSse: AbortController | null = null;
	let heartbeatTimer: NodeJS.Timeout | null = null;
	let reconnectTimer: NodeJS.Timeout | null = null;
	let reconnectAttempt = 0;
	let ready = false;
	let lastCtx: ExtensionContext | null = null;
	let activeInbound: InboundPrompt | null = null;
	const pendingReplies = new Map<string, PendingReply>();
	const peers = new Map<string, AgentCard>();

	function configured() {
		if (!ready || !serverUrl || !authToken) throw new Error("coms-net is not connected. Start npm run coms-net:server or pass --server-url/--auth-token.");
	}

	function setStatus(ctx: ExtensionContext, status: string | undefined) {
		if (ctx.hasUI) ctx.ui.setStatus("coms-net", status);
	}

	function scheduleReconnect() {
		if (!lastCtx || reconnectTimer) return;
		const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempt, RECONNECT_MAX_MS);
		reconnectAttempt += 1;
		reconnectTimer = setTimeout(() => {
			reconnectTimer = null;
			void connect(lastCtx!);
		}, delay);
	}

	async function submitResponse(prompt: InboundPrompt, response: unknown, error: string | null) {
		await httpJson(serverUrl, authToken, `/v1/messages/${encodeURIComponent(prompt.msg_id)}/response`, {
			method: "POST",
			body: JSON.stringify({
				project,
				responder_session: sessionId,
				response,
				error,
			}),
		});
	}

	function handlePrompt(ctx: ExtensionContext, prompt: InboundPrompt) {
		if (prompt.hops >= MAX_HOPS) {
			void submitResponse(prompt, null, "hop_limit");
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

	function handleEvent(ctx: ExtensionContext, event: string, data: unknown) {
		const body = asObject(data);
		if (event === "pool_snapshot" && Array.isArray(body.agents)) {
			peers.clear();
			for (const agent of body.agents as AgentCard[]) peers.set(agent.session_id, agent);
		} else if ((event === "agent_joined" || event === "agent_updated") && body.agent && typeof body.agent === "object") {
			const agent = body.agent as AgentCard;
			peers.set(agent.session_id, agent);
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
				if (pending.error) pending.reject(new Error(pending.error));
				else pending.resolve(body.response);
			}
		}
	}

	async function connect(ctx: ExtensionContext) {
		lastCtx = ctx;
		abortSse?.abort();
		abortSse = null;
		if (heartbeatTimer) clearInterval(heartbeatTimer);
		heartbeatTimer = null;

		project = flagString(pi, "project") ?? process.env.PI_COMS_NET_PROJECT ?? DEFAULT_PROJECT;
		const discovered = discoverServer(project);
		serverUrl = flagString(pi, "server-url") ?? process.env.PI_COMS_NET_SERVER_URL ?? discovered.serverUrl ?? "";
		authToken = flagString(pi, "auth-token") ?? process.env.PI_COMS_NET_AUTH_TOKEN ?? discovered.authToken ?? "";
		if (!serverUrl || !authToken) {
			ready = false;
			setStatus(ctx, "coms-net: offline");
			return;
		}

		const name = flagString(pi, "cname") ?? process.env.PI_COMS_NET_NAME ?? fallbackName(ctx.cwd);
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

		heartbeatTimer = setInterval(() => {
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

		abortSse = new AbortController();
		void readSse(serverUrl, authToken, register.sse_url, abortSse.signal, (event, data) => handleEvent(ctx, event, data))
			.catch(() => {
				if (!abortSse?.signal.aborted) scheduleReconnect();
			});
	}

	pi.on("session_start", async (_event, ctx) => {
		await connect(ctx).catch((error) => {
			ready = false;
			setStatus(ctx, "coms-net: offline");
			if (ctx.hasUI) ctx.ui.notify(`coms-net connection failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
		});
	});

	pi.on("session_shutdown", async () => {
		abortSse?.abort();
		if (heartbeatTimer) clearInterval(heartbeatTimer);
		if (reconnectTimer) clearTimeout(reconnectTimer);
		if (ready) {
			await httpJson(serverUrl, authToken, `/v1/agents/${encodeURIComponent(sessionId)}?project=${encodeURIComponent(project)}`, {
				method: "DELETE",
			}).catch(() => {});
		}
	});

	pi.on("agent_end", async (event) => {
		if (!activeInbound || !ready) return;
		const inbound = activeInbound;
		activeInbound = null;
		const response = latestAssistantText(event.messages);
		await submitResponse(inbound, response || null, response ? null : "no_assistant_response").catch(() => {});
	});

	pi.registerTool(defineTool({
		name: "coms_net_list",
		label: "List coms-net agents",
		description: "List Pi agents currently connected to the same coms-net project.",
		parameters: Type.Object({
			include_explicit: Type.Optional(Type.Boolean({ description: "Include agents that opted into explicit-only visibility." })),
		}),
		async execute(_id, params) {
			configured();
			const include = params.include_explicit ? "&include_explicit=1" : "";
			const res = await httpJson<{ agents: AgentCard[] }>(serverUrl, authToken, `/v1/agents?project=${encodeURIComponent(project)}${include}`);
			for (const agent of res.agents) peers.set(agent.session_id, agent);
			return {
				content: [{ type: "text", text: JSON.stringify(res.agents, null, 2) }],
				details: res,
			};
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
		async execute(_id, params) {
			configured();
			const hops = Number(params.hops ?? 0);
			if (hops > MAX_HOPS) throw new Error("hop_limit");
			const reply = {} as PendingReply;
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
			return {
				content: [{ type: "text", text: `Sent coms-net message ${res.msg_id} (${res.status}). Call coms_net_await with this msg_id for the response.` }],
				details: res,
			};
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
		async execute(_id, params) {
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
			return {
				content: [{ type: "text", text: typeof response === "string" ? response : JSON.stringify(response, null, 2) }],
				details: { msg_id: params.msg_id, response },
			};
		},
	}));
}
