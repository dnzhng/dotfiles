/**
 * MCP — connects pi to MCP servers defined in a JSON config at
 * ~/.pi/agent/mcp-servers.json ($PI_MCP_SERVERS overrides). The dotfiles
 * MCP install script symlinks the canonical store to that path; this
 * extension is machine-agnostic and contains no dotfiles-specific paths.
 *
 * Config format:
 *   { "global": { name: { type: "http", url } | { command, args } },
 *     "projects": { "dash-joined-key": { name: ... } } }
 *
 * Design:
 * - Config is re-read on every session_start, so /reload picks up edits.
 *   {{MCP_USHER_PORT}} in URLs is resolved like the dotfiles install script
 *   does (usher config.toml, then bento/mac defaults); project keys match
 *   the session cwd by dash-joined trailing path segments ("carrot" matches
 *   anywhere inside a .../carrot/ tree, including graft worktrees).
 * - MCP tools register as mcp__<server>__<tool> but stay INACTIVE: with ~7
 *   servers the full tool set would swamp the context. The always-active
 *   mcp_search tool finds and enables matches mid-turn (pi's dynamic tool
 *   loading); enabled tools stay active for the rest of the session.
 * - Connections are session-scoped: opened in the background on
 *   session_start (startup never blocks on usher/VPN), closed on
 *   session_shutdown. A failed call triggers one transparent reconnect.
 * - /mcp shows a status table (TUI-only entry, not sent to the LLM);
 *   /mcp reconnect [server] retries failed connections.
 *
 * Requires: npm install in this directory (@modelcontextprotocol/sdk).
 */

import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Type } from "typebox";

type ServerDef = { type?: string; url?: string; command?: string; args?: string[] };

interface ServersFile {
	global?: Record<string, ServerDef>;
	projects?: Record<string, Record<string, ServerDef>>;
}

interface ToolMeta {
	piName: string;
	server: string;
	mcpName: string;
	description: string;
}

interface ServerState {
	name: string;
	def: ServerDef;
	transportKind: "http" | "stdio";
	status: "connecting" | "connected" | "error";
	error?: string;
	client?: Client;
	tools: ToolMeta[];
}

const CONNECT_TIMEOUT_HTTP_MS = 15_000;
const CONNECT_TIMEOUT_STDIO_MS = 30_000; // uvx may cold-start
const CALL_TIMEOUT_MS = 120_000;

function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/** Port install.sh's {{MCP_USHER_PORT}} resolution. */
function resolveUsherPort(): string {
	try {
		const toml = readFileSync(join(homedir(), ".config/mcp-usher/config.toml"), "utf8");
		const m = toml.match(/^port\s*=\s*"?(\d+)"?/m);
		if (m) return m[1];
	} catch {}
	return existsSync("/home/bento") ? "15246" : "15245";
}

/** Port install.sh's project matching: key dashes -> slashes, trailing-segment match. */
function projectMatches(key: string, cwd: string): boolean {
	const keyPath = key.replace(/-/g, "/");
	return (cwd.endsWith("/") ? cwd : `${cwd}/`).includes(`/${keyPath}/`);
}

function sanitize(part: string): string {
	return part.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export default function (pi: ExtensionAPI) {
	let servers: ServerState[] = [];
	const toolIndex = new Map<string, ToolMeta>();
	// pi auto-activates newly registered tools (see _refreshToolRegistry), so
	// registration alone doesn't keep MCP tools out of context — we sweep them
	// back to inactive after every registration. mcp_search marks its picks
	// here so the sweeps leave them alone.
	const explicitlyEnabled = new Set<string>();
	let sessionCtx: ExtensionContext | undefined;
	let configPath: string | undefined;
	let configError: string | undefined;

	// ---------------------------------------------------------------- config

	function findServersFile(): string | undefined {
		const envPath = process.env.PI_MCP_SERVERS;
		if (envPath && existsSync(envPath)) return envPath;
		const conventional = join(homedir(), ".pi/agent/mcp-servers.json");
		if (existsSync(conventional)) return conventional;
		return undefined;
	}

	function loadServerDefs(cwd: string): Record<string, ServerDef> {
		configPath = findServersFile();
		configError = undefined;
		if (!configPath) return {};
		let parsed: ServersFile;
		try {
			const raw = readFileSync(configPath, "utf8").replaceAll("{{MCP_USHER_PORT}}", resolveUsherPort());
			parsed = JSON.parse(raw);
		} catch (err) {
			configError = errMsg(err);
			return {};
		}
		const defs: Record<string, ServerDef> = { ...(parsed.global ?? {}) };
		for (const [key, projectServers] of Object.entries(parsed.projects ?? {})) {
			if (projectMatches(key, cwd)) Object.assign(defs, projectServers);
		}
		return defs;
	}

	// ------------------------------------------------------------ connection

	async function connectServer(state: ServerState): Promise<void> {
		state.status = "connecting";
		state.error = undefined;
		state.client = undefined;
		let stderrBuf = "";
		const controller = new AbortController();
		const timeoutMs = state.transportKind === "stdio" ? CONNECT_TIMEOUT_STDIO_MS : CONNECT_TIMEOUT_HTTP_MS;
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const client = new Client({ name: "pi-mcp", version: "0.1.0" });
			let transport;
			if (state.transportKind === "http") {
				transport = new StreamableHTTPClientTransport(new URL(state.def.url!));
			} else {
				transport = new StdioClientTransport({
					command: state.def.command!,
					args: state.def.args ?? [],
					stderr: "pipe",
				});
				transport.stderr?.on("data", (chunk) => {
					stderrBuf = (stderrBuf + String(chunk)).slice(-4000);
				});
			}
			await client.connect(transport, { signal: controller.signal });
			// listTools can paginate
			const tools: Array<{ name: string; description?: string; inputSchema?: unknown }> = [];
			let cursor: string | undefined;
			do {
				const page = await client.listTools(cursor ? { cursor } : undefined);
				tools.push(...(page.tools ?? []));
				cursor = page.nextCursor;
			} while (cursor);
			state.client = client;
			state.status = "connected";
			registerServerTools(state, tools);
			deactivateMcpTools();
		} catch (err) {
			state.status = "error";
			const lastStderr = stderrBuf.trim().split("\n").pop()?.trim();
			state.error = lastStderr ? `${errMsg(err)} — ${lastStderr}` : errMsg(err);
			try {
				await state.client?.close();
			} catch {}
			state.client = undefined;
		} finally {
			clearTimeout(timer);
		}
	}

	function closeAll(): void {
		for (const state of servers) {
			try {
				void state.client?.close();
			} catch {}
			state.client = undefined;
		}
		servers = [];
		toolIndex.clear();
	}

	// ----------------------------------------------------------------- tools

	function uniquePiName(serverName: string, toolName: string): string {
		const base = `mcp__${sanitize(serverName)}__${sanitize(toolName)}`;
		let name = base.slice(0, 64);
		for (let i = 2; toolIndex.has(name); i++) name = `${base.slice(0, 60)}_${i}`;
		return name;
	}

	function deactivateMcpTools(): void {
		const active = pi.getActiveTools();
		const filtered = active.filter((n) => !n.startsWith("mcp__") || explicitlyEnabled.has(n));
		if (filtered.length !== active.length) pi.setActiveTools(filtered);
	}

	function registerServerTools(
		state: ServerState,
		tools: Array<{ name: string; description?: string; inputSchema?: unknown }>,
	): void {
		// On reconnect, drop this server's stale entries before re-registering.
		// pi itself has no unregisterTool; a tool the server removed lingers
		// (inactive) until the next session — harmless.
		for (const tool of state.tools) toolIndex.delete(tool.piName);
		state.tools = [];
		for (const tool of tools) {
			const piName = uniquePiName(state.name, tool.name);
			const meta: ToolMeta = { piName, server: state.name, mcpName: tool.name, description: tool.description ?? "" };
			toolIndex.set(piName, meta);
			state.tools.push(meta);
			const schema = (tool.inputSchema ?? { type: "object", properties: {} }) as Record<string, unknown>;
			if (typeof schema.type !== "string") schema.type = "object";
			delete schema.$schema;
			pi.registerTool({
				name: piName,
				label: `MCP ${state.name}`,
				description: `[${state.name}] ${meta.description || tool.name}`,
				// Plain JSON schema passthrough — pi validates non-TypeBox schemas
				// via its JSON-schema coercion path (see validateToolArguments).
				parameters: schema as never,
				async execute(_toolCallId, params, signal) {
					return callServerTool(meta.server, meta.mcpName, params as Record<string, unknown>, signal);
				},
			});
		}
	}

	async function callServerTool(serverName: string, mcpName: string, args: Record<string, unknown>, signal?: AbortSignal) {
		const state = servers.find((s) => s.name === serverName);
		if (!state) throw new Error(`MCP server "${serverName}" is not configured`);
		if (state.status !== "connected" || !state.client) {
			await connectServer(state);
			updateStatus();
			if (state.status !== "connected" || !state.client) {
				throw new Error(`MCP server "${serverName}" is unavailable: ${state.error ?? "not connected"}`);
			}
		}
		let result: Record<string, any>;
		try {
			result = await state.client.callTool({ name: mcpName, arguments: args }, undefined, {
				signal,
				timeout: CALL_TIMEOUT_MS,
			});
		} catch (err) {
			if (signal?.aborted) throw err;
			// Transport may have died (usher restart, laptop sleep) — reconnect
			// once and retry before giving up.
			await connectServer(state);
			updateStatus();
			if (state.status !== "connected" || !state.client) {
				throw new Error(`MCP server "${serverName}" is unavailable: ${state.error ?? errMsg(err)}`);
			}
			result = await state.client.callTool({ name: mcpName, arguments: args }, undefined, {
				signal,
				timeout: CALL_TIMEOUT_MS,
			});
		}
		return mapResult(result);
	}

	async function mapResult(result: Record<string, any>) {
		if (result?.isError) {
			const text = extractText(result);
			throw new Error(text || "MCP tool reported an error");
		}
		const images: Array<{ type: "image"; data: string; mimeType: string }> = [];
		const texts: string[] = [];
		for (const block of result?.content ?? []) {
			if (block.type === "text" && typeof block.text === "string") {
				texts.push(block.text);
			} else if (block.type === "image" && typeof block.data === "string") {
				images.push({ type: "image", data: block.data, mimeType: block.mimeType ?? "image/png" });
			} else if (block.type === "resource") {
				const resource = block.resource;
				if (typeof resource?.text === "string") texts.push(resource.text);
				else texts.push(`[resource: ${resource?.uri ?? "unknown"}]`);
			} else if (block.type !== "text") {
				texts.push(`[unsupported ${block.type} content omitted]`);
			}
		}
		if (texts.length === 0 && result?.structuredContent) {
			texts.push(JSON.stringify(result.structuredContent, null, 2));
		}
		let text = texts.join("\n");
		const truncation = truncateHead(text, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
		if (truncation.truncated) {
			const file = join(tmpdir(), `pi-mcp-${Date.now()}.txt`);
			await writeFile(file, text, "utf8");
			text =
				truncation.content +
				`\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines` +
				` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).` +
				` Full output saved to: ${file}]`;
		}
		const content = [...(text ? [{ type: "text" as const, text }] : []), ...images];
		if (content.length === 0) content.push({ type: "text" as const, text: "(no content)" });
		return { content };
	}

	function extractText(result: Record<string, any>): string {
		return (result?.content ?? [])
			.filter((block: any) => block.type === "text" && typeof block.text === "string")
			.map((block: any) => block.text)
			.join("\n");
	}

	// ------------------------------------------------------------ status / UI

	function updateStatus(): void {
		if (!sessionCtx) return;
		if (servers.length === 0) {
			sessionCtx.ui.setStatus("mcp", undefined);
			return;
		}
		const connected = servers.filter((s) => s.status === "connected").length;
		const connecting = servers.some((s) => s.status === "connecting");
		const text = connecting
			? `mcp: connecting ${connected}/${servers.length}`
			: `mcp: ${connected}/${servers.length} servers · ${toolIndex.size} tools`;
		if (sessionCtx.mode !== "tui") {
			sessionCtx.ui.setStatus("mcp", text);
			return;
		}
		// The footer renders status text raw (no dim like its other rows), so
		// pre-style: health-colored dot + dim text to match.
		const theme = sessionCtx.ui.theme;
		const dot = connecting
			? theme.fg("warning", "◌")
			: connected === servers.length
				? theme.fg("success", "●")
				: theme.fg("error", "●");
		sessionCtx.ui.setStatus("mcp", `${dot} ${theme.fg("dim", text)}`);
	}

	function showStatusEntry(ctx: ExtensionCommandContext): void {
		pi.appendEntry("mcp-status", {
			configPath,
			configError,
			servers: servers.map((s) => ({
				name: s.name,
				transport: s.transportKind,
				status: s.status,
				error: s.error,
				toolCount: s.tools.length,
			})),
		});
		ctx.ui.notify("MCP status posted above", "info");
	}

	// ------------------------------------------------------------- lifecycle

	pi.on("session_start", async (_event, ctx) => {
		sessionCtx = ctx;
		toolIndex.clear();
		explicitlyEnabled.clear();
		servers = [];
		const defs = loadServerDefs(ctx.cwd);
		const names = Object.keys(defs);
		if (names.length === 0) {
			updateStatus();
			if (configError) ctx.ui.notify(`MCP: failed to parse servers.json: ${configError}`, "error");
			return;
		}
		// MCP tools stay inactive until mcp_search enables them mid-turn.
		const active = pi.getActiveTools().filter((n) => !n.startsWith("mcp__"));
		pi.setActiveTools([...new Set([...active, "mcp_search"])]);
		servers = names.map((name) => {
			const def = defs[name]!;
			return { name, def, transportKind: def.url ? ("http" as const) : ("stdio" as const), status: "connecting" as const, tools: [] };
		});
		updateStatus();
		// Connect in the background — never block session startup on network.
		void Promise.allSettled(servers.map((s) => connectServer(s))).then(() => {
			updateStatus();
			const failed = servers.filter((s) => s.status === "error");
			if (failed.length > 0 && ctx.hasUI) {
				ctx.ui.notify(`MCP: ${failed.length}/${servers.length} servers failed to connect — /mcp for details`, "warning");
			}
		});
	});

	pi.on("session_shutdown", () => {
		closeAll();
		sessionCtx = undefined;
	});

	// -------------------------------------------------------------- mcp_search

	pi.registerTool({
		name: "mcp_search",
		label: "MCP Search",
		description:
			"Search tools provided by connected MCP servers (e.g. company knowledge, issue trackers, browser automation) and enable the matching ones. Enabled MCP tools can then be called directly for the rest of the session.",
		promptSnippet: "Search and enable tools from connected MCP servers",
		promptGuidelines: [
			"Use mcp_search when a task needs a capability not currently available (searching company knowledge, issue trackers, documents, or browser automation); it enables matching MCP tools so you can call them directly afterwards.",
		],
		parameters: Type.Object({
			query: Type.String({ description: "Capability or task to search for" }),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: "Max tools to return (default 5)" })),
		}),
		async execute(_toolCallId, params) {
			const terms = params.query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
			const scored = [...toolIndex.values()]
				.map((meta) => ({
					meta,
					score: terms.reduce(
						(acc, term) => acc + (`${meta.server} ${meta.mcpName} ${meta.description}`.toLowerCase().includes(term) ? 1 : 0),
						0,
					),
				}))
				.filter((m) => m.score > 0)
				.sort((a, b) => b.score - a.score)
				.slice(0, params.limit ?? 5);
			const errored = servers.filter((s) => s.status === "error").map((s) => `${s.name} (${s.error})`);
			if (scored.length === 0) {
				let text = `No MCP tools matched "${params.query}".`;
				if (toolIndex.size === 0 && servers.some((s) => s.status === "connecting")) {
					text += " Servers are still connecting — try again shortly.";
				}
				if (errored.length > 0) text += ` Unavailable servers: ${errored.join(", ")}.`;
				return { content: [{ type: "text", text }] };
			}
			const active = pi.getActiveTools();
			const added = scored.map((m) => m.meta.piName).filter((n) => !active.includes(n));
			for (const m of scored) explicitlyEnabled.add(m.meta.piName);
			if (added.length > 0) pi.setActiveTools([...new Set([...active, ...added])]);
			const lines = scored.map((m) => `- ${m.meta.piName}: ${m.meta.description.split("\n")[0].slice(0, 200)}`);
			const header = added.length > 0 ? `Enabled ${added.length} tool(s).` : "Matching tools were already enabled.";
			return { content: [{ type: "text", text: `${header} You can now call:\n${lines.join("\n")}` }] };
		},
	});

	// ------------------------------------------------------------------- /mcp

	pi.registerCommand("mcp", {
		description: "MCP server status; /mcp reconnect [server] retries failed connections",
		getArgumentCompletions: (prefix) => {
			const items = [
				{ value: "reconnect", label: "reconnect all failed" },
				...servers.map((s) => ({ value: `reconnect ${s.name}`, label: `reconnect ${s.name}` })),
			].filter((i) => i.value.startsWith(prefix));
			return items.length > 0 ? items : null;
		},
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/).filter(Boolean);
			if (parts[0] !== "reconnect") {
				showStatusEntry(ctx);
				return;
			}
			const targets = parts[1]
				? servers.filter((s) => s.name === parts[1])
				: servers.filter((s) => s.status !== "connected");
			if (targets.length === 0) {
				ctx.ui.notify(parts[1] ? `MCP: no server named "${parts[1]}"` : "MCP: nothing to reconnect", "warning");
				return;
			}
			ctx.ui.notify(`MCP: reconnecting ${targets.map((t) => t.name).join(", ")}…`, "info");
			updateStatus();
			await Promise.allSettled(targets.map((t) => connectServer(t)));
			updateStatus();
			showStatusEntry(ctx);
		},
	});

	pi.registerEntryRenderer("mcp-status", (entry, _options, theme) => {
		const data = entry.data as {
			configPath?: string;
			configError?: string;
			servers: Array<{ name: string; transport: string; status: string; error?: string; toolCount: number }>;
		};
		if (!data.configPath) {
			return new Text(theme.fg("muted", "MCP: no config found (expected ~/.pi/agent/mcp-servers.json or $PI_MCP_SERVERS)"), 0, 0);
		}
		if (data.configError) {
			return new Text(theme.fg("error", `MCP: failed to parse ${data.configPath}: ${data.configError}`), 0, 0);
		}
		const lines = data.servers.map((s) => {
			const dot =
				s.status === "connected" ? theme.fg("success", "●") : s.status === "connecting" ? theme.fg("warning", "◌") : theme.fg("error", "●");
			let line = `${dot} ${theme.bold(s.name)} ${theme.fg("dim", s.transport)}`;
			if (s.status === "connected") line += theme.fg("dim", ` · ${s.toolCount} tools`);
			if (s.error) line += ` ${theme.fg("error", s.error)}`;
			return line;
		});
		return new Text(`${theme.bold("MCP servers")} ${theme.fg("dim", `(${data.configPath})`)}\n${lines.join("\n")}`, 0, 0);
	});
}
