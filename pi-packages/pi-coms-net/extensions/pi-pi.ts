import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_EXPERT_DIR = path.join(PACKAGE_DIR, "agents", "pi-pi");
const MAX_OUTPUT_CHARS = 12_000;
const DEFAULT_MODEL = process.env.PI_PI_MODEL;
const PI_BIN = process.env.PI_WEB_PI_BIN || process.env.PI_BIN || "pi";

interface ExpertDef {
	name: string;
	description: string;
	tools: string;
	systemPrompt: string;
	file: string;
}

interface ExpertResult {
	expert: string;
	question: string;
	status: "done" | "error";
	elapsed_ms: number;
	exit_code: number;
	output: string;
	stderr: string;
}

function parseFrontmatter(raw: string): { frontmatter: Record<string, string>; body: string } {
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
	if (!match) return { frontmatter: {}, body: raw };
	const frontmatter: Record<string, string> = {};
	for (const line of match[1].split(/\r?\n/)) {
		const idx = line.indexOf(":");
		if (idx > 0) {
			const key = line.slice(0, idx).trim();
			let value = line.slice(idx + 1).trim();
			if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
				value = value.slice(1, -1);
			}
			frontmatter[key] = value;
		}
	}
	return { frontmatter, body: match[2].trim() };
}

function parseExpertFile(filePath: string): ExpertDef | null {
	try {
		const { frontmatter, body } = parseFrontmatter(fs.readFileSync(filePath, "utf8"));
		if (!frontmatter.name) return null;
		return {
			name: frontmatter.name,
			description: frontmatter.description || "",
			tools: frontmatter.tools || "read,grep,find,ls",
			systemPrompt: body,
			file: filePath,
		};
	} catch {
		return null;
	}
}

function displayName(name: string): string {
	return name
		.split("-")
		.map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
		.join(" ");
}

function candidateExpertDirs(cwd: string): string[] {
	return [
		path.join(cwd, ".pi", "agents", "pi-pi"),
		DEFAULT_EXPERT_DIR,
	];
}

function loadExperts(cwd: string): { experts: Map<string, ExpertDef>; orchestrator: string } {
	const experts = new Map<string, ExpertDef>();
	let orchestrator = "";
	for (const dir of candidateExpertDirs(cwd)) {
		if (!fs.existsSync(dir)) continue;
		for (const file of fs.readdirSync(dir)) {
			if (!file.endsWith(".md")) continue;
			const fullPath = path.join(dir, file);
			const raw = fs.readFileSync(fullPath, "utf8");
			const parsed = parseFrontmatter(raw);
			if (file === "pi-orchestrator.md") {
				if (!orchestrator) orchestrator = parsed.body || raw;
				continue;
			}
			const def = parseExpertFile(fullPath);
			if (def && !experts.has(def.name.toLowerCase())) experts.set(def.name.toLowerCase(), def);
		}
	}
	return { experts, orchestrator };
}

function modelId(ctx: ExtensionContext): string {
	if (DEFAULT_MODEL) return DEFAULT_MODEL;
	return ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "openrouter/google/gemini-3-flash-preview";
}

function collectTextDelta(event: unknown): string {
	const obj = event && typeof event === "object" ? event as Record<string, unknown> : {};
	const delta = obj.assistantMessageEvent && typeof obj.assistantMessageEvent === "object"
		? obj.assistantMessageEvent as Record<string, unknown>
		: {};
	if (delta.type === "text_delta" && typeof delta.delta === "string") return delta.delta;
	return "";
}

function runExpert(def: ExpertDef, question: string, ctx: ExtensionContext, signal?: AbortSignal): Promise<ExpertResult> {
	const started = Date.now();
	const args = [
		"--mode", "json",
		"-p",
		"--no-session",
		"--no-extensions",
		"--model", modelId(ctx),
		"--tools", def.tools,
		"--thinking", "off",
		"--append-system-prompt", def.systemPrompt,
		question,
	];

	return new Promise((resolve) => {
		const text: string[] = [];
		const stderr: string[] = [];
		const proc = spawn(PI_BIN, args, {
			cwd: ctx.cwd,
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env },
		});
		let stdoutBuffer = "";
		let settled = false;

		function settle(exitCode: number, extraError?: string) {
			if (settled) return;
			settled = true;
			resolve({
				expert: def.name,
				question,
				status: exitCode === 0 && !extraError ? "done" : "error",
				elapsed_ms: Date.now() - started,
				exit_code: exitCode,
				output: text.join("").trim() || extraError || "",
				stderr: stderr.join("").trim(),
			});
		}

		signal?.addEventListener("abort", () => {
			proc.kill("SIGTERM");
			settle(1, "aborted");
		}, { once: true });

		proc.stdout.setEncoding("utf8");
		proc.stdout.on("data", (chunk: string) => {
			stdoutBuffer += chunk;
			const lines = stdoutBuffer.split(/\r?\n/);
			stdoutBuffer = lines.pop() || "";
			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					const event = JSON.parse(line);
					text.push(collectTextDelta(event));
				} catch {}
			}
		});

		proc.stderr.setEncoding("utf8");
		proc.stderr.on("data", (chunk: string) => stderr.push(chunk));
		proc.on("error", (error) => settle(1, `Error spawning ${PI_BIN}: ${error.message}`));
		proc.on("close", (code) => {
			if (stdoutBuffer.trim()) {
				try {
					text.push(collectTextDelta(JSON.parse(stdoutBuffer)));
				} catch {}
			}
			settle(code ?? 1);
		});
	});
}

export default function piPiExtension(pi: ExtensionAPI) {
	let expertState = loadExperts(process.cwd());

	pi.registerCommand("experts", {
		description: "List available Pi Pi experts",
		handler: async (_args, ctx) => {
			expertState = loadExperts(ctx.cwd);
			const lines = [...expertState.experts.values()]
				.map((expert) => `${expert.name}: ${expert.description}`)
				.join("\n");
			ctx.ui.notify(lines || "No Pi Pi experts found.", lines ? "info" : "warning");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		expertState = loadExperts(ctx.cwd);
		if (ctx.hasUI) ctx.ui.setStatus("pi-pi", `Pi Pi: ${expertState.experts.size} experts`);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		expertState = loadExperts(ctx.cwd);
		if (!expertState.orchestrator || expertState.experts.size === 0) return undefined;

		const expertCatalog = [...expertState.experts.values()]
			.map((expert) => `### ${displayName(expert.name)}\n**Query as:** \`${expert.name}\`\n${expert.description}`)
			.join("\n\n");
		const expertNames = [...expertState.experts.values()].map((expert) => displayName(expert.name)).join(", ");
		const instructions = expertState.orchestrator
			.replaceAll("{{EXPERT_COUNT}}", String(expertState.experts.size))
			.replaceAll("{{EXPERT_NAMES}}", expertNames)
			.replaceAll("{{EXPERT_CATALOG}}", expertCatalog);

		return {
			systemPrompt: `${event.systemPrompt}\n\n${instructions}`,
		};
	});

	pi.registerTool(defineTool({
		name: "query_experts",
		label: "Query Pi Pi experts",
		description: "Query one or more Pi domain experts in parallel. Experts are read-only researchers; use their answers to build or modify Pi packages, extensions, skills, prompts, config, or agents.",
		parameters: Type.Object({
			queries: Type.Array(Type.Object({
				expert: Type.String({ description: "Expert name, for example ext-expert, config-expert, agent-expert, skill-expert, prompt-expert, tui-expert, or cli-expert." }),
				question: Type.String({ description: "Specific research question for the expert." }),
			})),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			expertState = loadExperts(ctx.cwd);
			const queries = params.queries ?? [];
			if (queries.length === 0) {
				return {
					content: [{ type: "text", text: "No expert queries provided." }],
					details: { results: [] },
				};
			}
			if (onUpdate) {
				onUpdate({
					content: [{ type: "text", text: `Querying ${queries.length} Pi Pi experts in parallel...` }],
					details: { status: "researching", queries },
				});
			}

			const results = await Promise.all(queries.map(async (query): Promise<ExpertResult> => {
				const def = expertState.experts.get(query.expert.toLowerCase());
				if (!def) {
					return {
						expert: query.expert,
						question: query.question,
						status: "error",
						elapsed_ms: 0,
						exit_code: 1,
						output: `Unknown expert "${query.expert}". Available: ${[...expertState.experts.keys()].join(", ")}`,
						stderr: "",
					};
				}
				return runExpert(def, query.question, ctx, signal);
			}));

			const sections = results.map((result) => {
				const output = result.output.length > MAX_OUTPUT_CHARS
					? `${result.output.slice(0, MAX_OUTPUT_CHARS)}\n\n... [truncated]`
					: result.output;
				const icon = result.status === "done" ? "OK" : "ERROR";
				return `## [${icon}] ${displayName(result.expert)} (${Math.round(result.elapsed_ms / 1000)}s)\n\n${output || result.stderr || "(no output)"}`;
			});

			return {
				content: [{ type: "text", text: sections.join("\n\n---\n\n") }],
				details: {
					status: results.every((result) => result.status === "done") ? "done" : "partial",
					results,
				},
				isError: results.every((result) => result.status === "error"),
			};
		},
	}));
}
