/**
 * Side Panel — renders plan-mode todos, the post-plan action menu, and active
 * subagent runs into the right margin created by max-width (transcript capped at
 * 95 cols). The sidebar is never a permanent fixture: with no pending menu, no
 * executing todos, and no active runs it publishes `panel: null` and the margin
 * is exactly as blank as without this extension.
 *
 * How it works:
 * - plan-mode publishes todos/menu to the Symbol.for bus (./bus.ts); this
 *   extension renders them into `bus.panel` lines; max-width splices those
 *   lines into the margin at render time (regular mode: into the padded
 *   transcript lines; fullscreen: into the composited screen rows).
 * - `bus.capable` (this extension owns it) is true when the margin is at least
 *   MIN_MARGIN cols (terminal ≳ 122 wide). plan-mode keys its widget
 *   suppression and menu routing off it, so narrow terminals get today's stock
 *   behavior. A resize below the threshold while a menu is pending auto-resolves
 *   "stay" so the menu can never be stuck invisible-but-capturing.
 * - The pi-subagents fleet is read from disk (deep imports aren't in the
 *   package's exports): status.json files under
 *   $PI_SUBAGENTS_TEMP_ROOT || $TMPDIR/pi-subagents-<scope>/async-subagent-runs,
 *   using the .active-runs index with a directory-scan fallback, mtime-cached,
 *   filtered to runs owned by the current session.
 *
 * Interaction (fleet-status pattern — passive by default):
 * - Menu pending: it takes precedence. Up/Down move, Enter chooses, Esc is
 *   "Stay in plan mode" (resolves undefined, matching the select-cancel path).
 *   Only arrows/Enter/Esc are captured — letters pass through so typing keeps
 *   working while deciding.
 * - Otherwise: Right arrow with an empty editor enters inspect mode for the
 *   Agents section; Up/Down/j/k select a run; Enter opens a detail overlay
 *   (live status fields + tail of the run's sessionFile transcript); Esc/Left
 *   backs out; any other key deactivates and passes through.
 *
 * Known limitations (v1): plain foreground subagent runs keep state in memory
 * inside pi-subagents and never touch the disk reader, so only async/workflow
 * runs appear; nested child-of-child runs may not each appear; on narrow
 * terminals there is no subagent status line (Ctrl+Alt+F inspector unaffected).
 */

import { closeSync, fstatSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, Key, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { getBus, onBusChange, publishBus } from "./bus.ts";

// Layout constants. MAX_WIDTH must match max-width.ts's cap; the panel is
// spliced at column MAX_WIDTH + SPLICE_GAP and leaves the terminal's last
// column alone (the fullscreen scrollbar lives there).
const MAX_WIDTH = 95;
const SPLICE_GAP = 2;
const MIN_MARGIN = 26;
const MAX_PANEL_WIDTH = 40;
const TOP_PADDING = 1;
const REFRESH_MS = 500;
const WIDGET_KEY = "side-panel-capture";

type UiContext = ExtensionContext;
type Theme = ExtensionContext["ui"]["theme"];

/** Minimal structural view of pi-subagents' status.json (AsyncStatus). */
interface RunStepLite {
	agent?: string;
	label?: string;
	status?: string;
	currentTool?: string;
	currentPath?: string;
	sessionFile?: string;
	startedAt?: number;
	tokens?: { total?: number };
}

interface RunStatusLite {
	runId: string;
	state: string;
	mode?: string;
	sessionId?: string;
	startedAt?: number;
	cwd?: string;
	currentTool?: string;
	currentPath?: string;
	sessionFile?: string;
	error?: string;
	steps?: RunStepLite[];
}

interface AgentRow {
	id: string;
	state: string;
	label: string;
	activity?: string;
	startedAt: number;
	statusPath: string;
	status: RunStatusLite;
}

// ---------------------------------------------------------------------------
// pi-subagents disk reader
// ---------------------------------------------------------------------------

function sanitizeScopeSegment(value: string): string {
	return value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

/** Mirror of pi-subagents' resolveTempScopeId (uid, then username, then home). */
function tempScopeId(): string {
	const uid = process.getuid?.();
	if (uid !== undefined) return `uid-${uid}`;
	for (const key of ["USERNAME", "USER", "LOGNAME"] as const) {
		const value = process.env[key];
		if (value) return `user-${sanitizeScopeSegment(value)}`;
	}
	const home = process.env.USERPROFILE ?? process.env.HOME;
	if (home) return `home-${sanitizeScopeSegment(home)}`;
	return "shared";
}

function asyncRunsRoot(): string {
	const configured = process.env.PI_SUBAGENTS_TEMP_ROOT?.trim();
	const root = configured ? resolve(configured) : join(tmpdir(), `pi-subagents-${tempScopeId()}`);
	return join(root, "async-subagent-runs");
}

const statusCache = new Map<string, { mtimeMs: number; size: number; status: RunStatusLite | null }>();

/** Read a run's status.json, cached by mtime+size. Tolerates unreadable/malformed files. */
function readRunStatus(statusPath: string): RunStatusLite | null {
	let stat;
	try {
		stat = statSync(statusPath);
	} catch {
		statusCache.delete(statusPath);
		return null;
	}
	const cached = statusCache.get(statusPath);
	if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.status;
	let status: RunStatusLite | null = null;
	try {
		status = JSON.parse(readFileSync(statusPath, "utf-8")) as RunStatusLite;
	} catch {
		status = null; // missing mid-rename or partial write — retry next tick
	}
	if (statusCache.size > 256) statusCache.clear();
	statusCache.set(statusPath, { mtimeMs: stat.mtimeMs, size: stat.size, status });
	return status;
}

/**
 * Active runs owned by this session. Primary source: the .active-runs index
 * (empty marker files named by run id). Fallback: scan the async root for run
 * dirs when the index doesn't exist. A run matches when its sessionId equals
 * this session's file path OR bare id (pi-subagents records whichever exists).
 */
function listActiveRuns(sessionKeys: string[]): AgentRow[] {
	const root = asyncRunsRoot();
	let names: string[] | undefined;
	try {
		names = readdirSync(join(root, ".active-runs"), { withFileTypes: true })
			.filter((e) => e.isFile())
			.map((e) => e.name);
	} catch {
		names = undefined;
	}
	if (!names) {
		try {
			names = readdirSync(root, { withFileTypes: true })
				.filter((e) => e.isDirectory() && !e.name.startsWith("."))
				.map((e) => e.name);
		} catch {
			return [];
		}
	}
	const rows: AgentRow[] = [];
	for (const name of names) {
		const statusPath = join(root, name, "status.json");
		const status = readRunStatus(statusPath);
		if (!status) continue;
		if (status.state !== "queued" && status.state !== "running") continue;
		if (sessionKeys.length > 0 && !sessionKeys.includes(status.sessionId ?? "")) continue;
		rows.push(toAgentRow(status, statusPath));
	}
	return rows.sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
}

function toAgentRow(status: RunStatusLite, statusPath: string): AgentRow {
	const steps = status.steps ?? [];
	const running = steps.filter((s) => s.status === "running");
	const done = steps.filter((s) => s.status === "complete" || s.status === "completed");
	let label: string;
	if (status.mode === "workflow") {
		label = `workflow ${done.length}/${steps.length}`;
	} else if (steps.length === 1) {
		label = steps[0]?.label ?? steps[0]?.agent ?? status.mode ?? "subagent";
	} else if (steps.length > 1) {
		label = `${status.mode ?? "run"} (${running.length} active)`;
	} else {
		label = status.mode ?? "subagent";
	}
	const src = running[0] ?? status;
	const activity = src.currentTool
		? `tool ${src.currentTool}`
		: src.currentPath
			? basename(src.currentPath)
			: undefined;
	return {
		id: status.runId,
		state: status.state,
		label,
		activity,
		startedAt: status.startedAt ?? 0,
		statusPath,
		status,
	};
}

/** Read the last maxBytes of a file, dropping the first partial line. "" on error. */
function readTail(path: string, maxBytes: number): string {
	let fd: number | undefined;
	try {
		fd = openSync(path, "r");
		const size = fstatSync(fd).size;
		const start = Math.max(0, size - maxBytes);
		const buf = Buffer.alloc(size - start);
		readSync(fd, buf, 0, buf.length, start);
		const text = buf.toString("utf-8");
		return start > 0 ? text.slice(text.indexOf("\n") + 1) : text;
	} catch {
		return "";
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

function oneLine(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/** Parse a pi session JSONL tail into plain transcript lines (roles + tool calls). */
function transcriptLines(sessionFile: string): string[] {
	const text = readTail(sessionFile, 64 * 1024);
	if (!text) return [];
	const out: string[] = [];
	for (const line of text.split("\n")) {
		let entry: { type?: string; message?: Record<string, unknown> };
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}
		if (entry?.type !== "message" || !entry.message) continue;
		const msg = entry.message as {
			role?: string;
			content?: unknown;
			toolName?: string;
			isError?: boolean;
		};
		if (msg.role === "user") {
			const content = msg.content;
			const text =
				typeof content === "string"
					? content
					: Array.isArray(content)
						? content
								.filter((b) => (b as { type?: string })?.type === "text")
								.map((b) => (b as { text?: string }).text ?? "")
								.join(" ")
						: "";
			if (text.trim()) out.push(`user: ${oneLine(text)}`);
		} else if (msg.role === "assistant" && Array.isArray(msg.content)) {
			for (const block of msg.content) {
				const b = block as { type?: string; text?: string; name?: string; arguments?: unknown; input?: unknown };
				if (b.type === "text" && b.text?.trim()) {
					out.push(`agent: ${oneLine(b.text)}`);
				} else if (b.type === "toolCall") {
					const args = oneLine(JSON.stringify(b.arguments ?? b.input ?? "")).slice(0, 100);
					out.push(`  (tool) ${b.name ?? "?"} ${args}`);
				}
			}
		} else if (msg.role === "toolResult") {
			out.push(`  -> ${msg.toolName ?? "tool"}${msg.isError ? " (error)" : ""}`);
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// Panel rendering
// ---------------------------------------------------------------------------

function elapsed(now: number, startedAt: number): string {
	return `${Math.max(0, Math.round((now - startedAt) / 1000))}s`;
}

function menuLines(theme: Theme, title: string, options: string[], selected: number): string[] {
	const lines = [theme.fg("accent", title)];
	for (let i = 0; i < options.length; i++) {
		lines.push(
			i === selected
				? theme.fg("accent", `> ${options[i]}`)
				: theme.fg("muted", `  ${options[i]}`),
		);
	}
	return lines;
}

function todoLines(theme: Theme, items: Array<{ text: string; completed: boolean }>): string[] {
	const lines = [theme.fg("accent", "Plan")];
	for (const item of items) {
		lines.push(
			item.completed
				? theme.fg("success", "☑ ") + theme.fg("muted", theme.strikethrough(item.text))
				: `${theme.fg("muted", "☐ ")}${item.text}`,
		);
	}
	return lines;
}

function agentLines(theme: Theme, rows: AgentRow[], now: number, selectedIndex: number, inspecting: boolean): string[] {
	const lines = [theme.fg("accent", "Agents")];
	for (let i = 0; i < rows.length; i++) {
		const row = rows[i]!;
		const glyph = row.state === "running" ? theme.fg("accent", "●") : theme.fg("muted", "◦");
		const detail = [row.state, row.activity, elapsed(now, row.startedAt)].filter(Boolean).join(" · ");
		const marker = inspecting && i === selectedIndex ? theme.fg("accent", ">") : " ";
		lines.push(`${marker}${glyph} ${theme.fg("muted", row.label)} ${theme.fg("dim", detail)}`);
	}
	return lines;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function sidePanelExtension(pi: ExtensionAPI): void {
	let ui: UiContext | undefined;
	let tui: { requestRender(): void } | undefined;
	let timer: ReturnType<typeof setInterval> | undefined;
	let inputUnsubscribe: (() => void) | undefined;
	let busUnsubscribe: (() => void) | undefined;
	let agentRows: AgentRow[] = [];
	let menuIndex = 0;
	let lastMenu: unknown;
	let agentIndex = 0;
	let inspecting = false;
	let overlayOpen = false;
	let lastPanelJson = "";

	function panelWidth(): number {
		const margin = (process.stdout.columns || 0) - MAX_WIDTH;
		return Math.max(1, Math.min(MAX_PANEL_WIDTH, margin - SPLICE_GAP - 1));
	}

	function measureCapable(): boolean {
		try {
			if (!ui?.hasUI) return false;
		} catch {
			return false;
		}
		return (process.stdout.columns || 0) - MAX_WIDTH >= MIN_MARGIN;
	}

	/** Current session identity in both forms pi-subagents may record. */
	function sessionKeys(): string[] {
		const sm = ui?.sessionManager;
		if (!sm) return [];
		try {
			return [sm.getSessionFile(), sm.getSessionId()].filter((v): v is string => Boolean(v));
		} catch {
			return [];
		}
	}

	function buildPanel(): { lines: string[]; width: number } | null {
		if (!ui) return null;
		const bus = getBus();
		const width = panelWidth();
		const theme = ui.ui.theme;
		const sections: string[][] = [];
		if (bus.menu) {
			if (bus.menu !== lastMenu) {
				lastMenu = bus.menu;
				menuIndex = 0;
			}
			sections.push(menuLines(theme, bus.menu.title, bus.menu.options, menuIndex));
		} else {
			lastMenu = undefined;
			menuIndex = 0;
		}
		if (bus.todos && bus.todos.items.length > 0) {
			sections.push(todoLines(theme, bus.todos.items));
		}
		if (agentRows.length > 0) {
			if (agentIndex >= agentRows.length) agentIndex = agentRows.length - 1;
			sections.push(agentLines(theme, agentRows, Date.now(), agentIndex, inspecting));
		}
		if (sections.length === 0) return null;
		const lines = sections.flatMap((s, i) => (i === 0 ? s : ["", ...s]));
		return { lines: [...Array(TOP_PADDING).fill(""), ...lines.flatMap((l) => wrapTextWithAnsi(l, width))], width };
	}

	function rebuildPanel(): void {
		const bus = getBus();
		const next = bus.capable ? buildPanel() : null;
		const nextJson = JSON.stringify(next);
		if (nextJson === lastPanelJson) return;
		lastPanelJson = nextJson;
		bus.panel = next;
		tui?.requestRender();
	}

	function refresh(): void {
		const bus = getBus();
		const wasCapable = bus.capable;
		bus.capable = measureCapable();
		// Resized narrow while a menu is pending: resolve "stay" so the menu can
		// never be stuck invisible-but-capturing; plan-mode's stock select returns.
		if (wasCapable && !bus.capable && bus.menu) {
			const menu = bus.menu;
			publishBus({ menu: null });
			menu.resolve(undefined);
			try {
				ui?.ui.notify("Terminal too narrow for the side panel — staying in plan mode.", "info");
			} catch {
				// stale ctx during shutdown — nothing to notify
			}
		}
		agentRows = bus.capable ? listActiveRuns(sessionKeys()) : agentRows;
		rebuildPanel();
	}

	// -------------------------------------------------------------------
	// Interaction: menu keys, inspect mode, detail overlay
	// -------------------------------------------------------------------

	function editorIsEmpty(): boolean {
		try {
			return ui?.ui.getEditorText() === "";
		} catch {
			return false; // stale ctx — treat as non-empty so we never capture keys
		}
	}

	/** Best transcript target for a run: top-level sessionFile, else the first
	 * running step's (workflow children keep their own session files). */
	function detailSessionFile(status: RunStatusLite): string | undefined {
		if (status.sessionFile) return status.sessionFile;
		const steps = status.steps ?? [];
		return (steps.find((s) => s.status === "running") ?? steps[0])?.sessionFile;
	}

	async function openDetail(row: AgentRow): Promise<void> {
		if (!ui || overlayOpen) return;
		overlayOpen = true;
		try {
			await ui.ui.custom(
				(overlayTui, theme, _kb, done) => {
					let status: RunStatusLite = readRunStatus(row.statusPath) ?? row.status;
					let body = transcriptLines(detailSessionFile(status) ?? "");
					let offset = Number.POSITIVE_INFINITY; // tail-follow until the user scrolls
					let cached: string[] | undefined;
					const liveTimer = setInterval(() => {
						status = readRunStatus(row.statusPath) ?? status;
						body = transcriptLines(detailSessionFile(status) ?? "");
						cached = undefined;
						overlayTui.requestRender();
					}, 1000);
					liveTimer.unref?.();

					function header(): string[] {
						const pairs: Array<[string, string | undefined]> = [
							["run", row.id],
							["state", status.state],
							["mode", status.mode],
							["elapsed", status.startedAt ? elapsed(Date.now(), status.startedAt) : undefined],
							["tool", status.currentTool],
							["path", status.currentPath],
							["error", status.error],
							["session", detailSessionFile(status)],
						];
						return pairs
							.filter((p): p is [string, string] => Boolean(p[1]))
							.map(([k, v]) => `${theme.fg("muted", `${k}:`)} ${v}`);
					}

					function render(width: number): string[] {
						if (!cached) {
							const hdr = header();
							const totalRows = Math.max(8, Math.floor((process.stdout.rows || 40) * 0.8));
							const bodyRows = Math.max(3, totalRows - hdr.length - 3);
							const maxOffset = Math.max(0, body.length - bodyRows);
							offset = Math.min(offset, maxOffset);
							const visible = body.slice(offset, offset + bodyRows);
							const position = body.length > bodyRows ? ` · ${offset + 1}-${offset + visible.length}/${body.length}` : "";
							cached = [
								...hdr,
								theme.fg("dim", "─".repeat(Math.min(width, 60))),
								...(visible.length > 0 ? visible : [theme.fg("dim", "(no transcript on disk)")]),
								theme.fg("dim", `↑↓/jk scroll · pgup/pgdn · esc close${position}`),
							];
						}
						return cached.map((l) => truncateToWidth(l, width));
					}

					function scrollBy(delta: number): void {
						offset = Math.max(0, offset + delta); // clamped against maxOffset in render
						cached = undefined;
						overlayTui.requestRender();
					}

					return {
						render,
						invalidate: () => {
							cached = undefined;
						},
						handleInput: (data: string) => {
							if (matchesKey(data, "escape") || matchesKey(data, Key.enter)) {
								done(undefined);
							} else if (matchesKey(data, "up") || matchesKey(data, "k")) {
								scrollBy(-1);
							} else if (matchesKey(data, "down") || matchesKey(data, "j")) {
								scrollBy(1);
							} else if (matchesKey(data, "pageUp")) {
								scrollBy(-10);
							} else if (matchesKey(data, "pageDown")) {
								scrollBy(10);
							}
						},
						dispose: () => clearInterval(liveTimer),
					};
				},
				{
					overlay: true,
					overlayOptions: { width: Math.min(110, (process.stdout.columns || 80) - 4), maxHeight: "80%" },
				},
			);
		} finally {
			overlayOpen = false;
		}
	}

	function handleTerminalInput(data: string): { consume?: boolean } | undefined {
		if (isKeyRelease(data) || overlayOpen) return undefined;
		const bus = getBus();

		// Menu pending takes precedence. Only arrows/Enter/Esc are captured;
		// letters pass through so editor typing keeps working while deciding.
		if (bus.menu && bus.capable) {
			if (matchesKey(data, "up")) {
				menuIndex = Math.max(0, menuIndex - 1);
				rebuildPanel();
				return { consume: true };
			}
			if (matchesKey(data, "down")) {
				menuIndex = Math.min(bus.menu.options.length - 1, menuIndex + 1);
				rebuildPanel();
				return { consume: true };
			}
			if (matchesKey(data, Key.enter) || matchesKey(data, "escape")) {
				const menu = bus.menu;
				const choice = matchesKey(data, Key.enter) ? menu.options[menuIndex] : undefined;
				// Clear before resolving so the menu can't linger if the publisher's
				// resolve closure doesn't (plan-mode's does too — double clear is a no-op).
				publishBus({ menu: null });
				menu.resolve(choice);
				return { consume: true };
			}
			return undefined;
		}

		// Inspect mode for the Agents section.
		if (!bus.capable || agentRows.length === 0) {
			if (inspecting) {
				inspecting = false;
				rebuildPanel();
			}
			return undefined;
		}
		if (!inspecting) {
			if (!matchesKey(data, "right") || !editorIsEmpty()) return undefined;
			inspecting = true;
			agentIndex = 0;
			rebuildPanel();
			return { consume: true };
		}
		if (matchesKey(data, "down") || matchesKey(data, "j")) {
			agentIndex = Math.min(agentRows.length - 1, agentIndex + 1);
			rebuildPanel();
			return { consume: true };
		}
		if (matchesKey(data, "up") || matchesKey(data, "k")) {
			agentIndex = Math.max(0, agentIndex - 1);
			rebuildPanel();
			return { consume: true };
		}
		if (matchesKey(data, "escape") || matchesKey(data, "left")) {
			inspecting = false;
			rebuildPanel();
			return { consume: true };
		}
		if (matchesKey(data, Key.enter)) {
			const row = agentRows[agentIndex];
			if (row) void openDetail(row);
			return { consume: true };
		}
		// Any other key deactivates and passes through.
		inspecting = false;
		rebuildPanel();
		return undefined;
	}

	function dispose(): void {
		if (timer) clearInterval(timer);
		timer = undefined;
		const unsubInput = inputUnsubscribe;
		const unsubBus = busUnsubscribe;
		const oldUi = ui;
		inputUnsubscribe = undefined;
		busUnsubscribe = undefined;
		ui = undefined;
		tui = undefined;
		agentRows = [];
		lastPanelJson = "";
		try {
			unsubInput?.();
		} catch {
			// stale ctx across /reload — already dead
		}
		unsubBus?.();
		try {
			oldUi?.ui.setWidget(WIDGET_KEY, undefined);
		} catch {
			// stale ctx across /reload — the widget dies with the old UI
		}
		const bus = getBus();
		bus.panel = null;
		bus.capable = false;
	}

	pi.on("session_start", (_event, ctx) => {
		// /reload re-entry: the previous module instance's listeners/timer/widget are
		// reachable only through the surviving bus record — dispose before re-registering.
		const bus = getBus();
		bus.dispose?.();
		bus.dispose = dispose;

		if (!ctx.hasUI) return;
		ui = ctx;

		// Zero-line widget purely to capture the real renderer (for requestRender);
		// belowEditor placement adds no spacer rows, so this renders as nothing.
		ctx.ui.setWidget(
			WIDGET_KEY,
			(captured) => {
				tui = captured;
				return { render: () => [], invalidate: () => {} };
			},
			{ placement: "belowEditor" },
		);

		if (typeof ctx.ui.onTerminalInput === "function") {
			inputUnsubscribe = ctx.ui.onTerminalInput((data) => handleTerminalInput(data));
		}
		busUnsubscribe = onBusChange(() => rebuildPanel());
		timer = setInterval(refresh, REFRESH_MS);
		timer.unref?.();
		refresh();
	});

	pi.on("session_shutdown", () => {
		const bus = getBus();
		bus.dispose?.();
		bus.dispose = undefined;
	});
}
