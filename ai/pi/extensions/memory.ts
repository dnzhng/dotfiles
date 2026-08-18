/**
 * Memory — injects the current project's long-term memory index (MEMORY.md)
 * into the system prompt, mirroring Claude Code's per-project auto-memory.
 *
 * Store: ~/.pi/agent/memory (symlinked to the dotfiles store at
 * private/ai/shared/memory/agent by ai/pi/install.sh; $PI_AGENT_STORE
 * points at the shared store root, resolved as <root>/memory/agent).
 * One subdir per project, each a Claude Code auto-memory dir:
 * a MEMORY.md index (one line per memory, global section inlined) plus one
 * file per memory. Only the index is ever injected — linked files are read
 * on demand — so cost per session is the index alone.
 *
 * cwd → project matching mirrors ai/claude/install.sh: trailing path
 * segments dash-joined (slug suffix, longest name wins), plus an
 * interior-segment fallback so graft worktrees (~/grafts/carrot/<slug>)
 * resolve to their repo. No match → nothing injected (zero token cost).
 * Subagent sessions load ambient extensions and fire their own
 * before_agent_start with their own cwd, so children working in another
 * repo get that repo's index automatically.
 *
 * The block is appended to the system prompt on every before_agent_start,
 * wrapped in <!-- pi-memory: <project> --> markers: any previously injected
 * block is stripped and replaced with a freshly read one, so resumed
 * sessions (which restore a snapshotted system prompt) never go stale and
 * compaction can't strand it. The index is additionally re-read whenever
 * MEMORY.md's mtime changes, so memories written mid-session show up
 * without a restart. /memory shows the current match.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function storeDir(): string | undefined {
	const shared = process.env.PI_AGENT_STORE;
	if (shared) {
		const store = join(shared, "memory", "agent");
		if (existsSync(store)) return store;
	}
	const conventional = join(homedir(), ".pi/agent/memory");
	if (existsSync(conventional)) return conventional;
	return undefined;
}

/** Project subdirs that have an index. */
function listProjects(store: string): string[] {
	try {
		return readdirSync(store, { withFileTypes: true })
			.filter((d) => d.isDirectory() && existsSync(join(store, d.name, "MEMORY.md")))
			.map((d) => d.name);
	} catch {
		return [];
	}
}

function matchProject(cwd: string, names: string[]): string | undefined {
	// Same rule as ai/claude/install.sh: cwd slug ends with "-<name>", longest wins
	// (~/dotfiles/private → dotfiles-private, ~/dotfiles → dotfiles, ~ → bento).
	const slug = cwd.replace(/\//g, "-");
	let best: string | undefined;
	for (const n of names) {
		if (slug.endsWith(`-${n}`) && n.length > (best?.length ?? 0)) best = n;
	}
	if (best) return best;
	// Graft worktrees: the repo dir is an interior segment (~/grafts/carrot/<slug>).
	const home = homedir();
	const rel = cwd.startsWith(`${home}/`) ? cwd.slice(home.length + 1) : cwd;
	const segments = new Set(rel.split("/"));
	for (const n of [...names].sort((a, b) => b.length - a.length)) {
		if (segments.has(n)) return n;
	}
	return undefined;
}

/** Strip the managed global-memory markers and excess blank lines. */
function cleanIndex(raw: string): string {
	return raw
		.split("\n")
		.filter((l) => !/^<!-- \/?global-memory -->$/.test(l.trim()))
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function buildBlock(store: string, project: string, index: string): string {
	const display = store.replace(homedir(), "~");
	return (
		`\n\n<!-- pi-memory: ${project} -->\n# Memory index (${project})\n\n` +
		index +
		`\n\n_Long-term memory index for this project — read a linked file under ` +
		`${display}/${project}/ only when a line looks relevant. Other projects: ` +
		`${display}/<project>/MEMORY.md. Save new memories per "Agent memories" in AGENTS.md._` +
		`\n<!-- /pi-memory -->`
	);
}

/** Remove a previously injected block (resumed sessions restore the old prompt). */
function stripBlock(systemPrompt: string): string {
	return systemPrompt.replace(/\n*<!-- pi-memory:[^\n]*-->[\s\S]*?<!-- \/pi-memory -->/, "");
}

interface Cache {
	key: string;
	mtimeMs: number;
	block: string;
}

export default function (pi: ExtensionAPI) {
	let cache: Cache | undefined;

	function currentBlock(cwd: string): { project: string; block: string } | undefined {
		const store = storeDir();
		if (!store) return undefined;
		const project = matchProject(cwd, listProjects(store));
		if (!project) {
			cache = undefined;
			return undefined;
		}
		const indexPath = join(store, project, "MEMORY.md");
		let mtimeMs: number;
		try {
			mtimeMs = statSync(indexPath).mtimeMs;
		} catch {
			return undefined;
		}
		const key = `${store}::${project}`;
		if (!cache || cache.key !== key || cache.mtimeMs !== mtimeMs) {
			const block = buildBlock(store, project, cleanIndex(readFileSync(indexPath, "utf8")));
			cache = { key, mtimeMs, block };
		}
		return { project, block: cache.block };
	}

	pi.on("session_start", () => {
		cache = undefined;
	});

	pi.on("before_agent_start", (event, ctx) => {
		const stripped = stripBlock(event.systemPrompt);
		const current = currentBlock(ctx.cwd);
		if (!current) {
			// No project match: drop any stale block a restored session carried in.
			return stripped === event.systemPrompt ? undefined : { systemPrompt: stripped };
		}
		return { systemPrompt: stripped + current.block };
	});

	pi.registerCommand("memory", {
		description: "Show the project memory index matched for this session",
		handler: async (_args, ctx) => {
			const store = storeDir();
			if (!store) {
				ctx.ui.notify("Memory: no store found (expected ~/.pi/agent/memory or $PI_AGENT_STORE/memory/agent)", "warning");
				return;
			}
			const project = matchProject(ctx.cwd, listProjects(store));
			if (!project) {
				ctx.ui.notify(`Memory: no project matches ${ctx.cwd}`, "info");
				return;
			}
			const indexPath = join(store, project, "MEMORY.md");
			const raw = readFileSync(indexPath, "utf8");
			const lines = raw.split("\n").filter((l) => l.startsWith("- [")).length;
			const injected = ctx.getSystemPrompt().includes(`# Memory index (${project})`);
			ctx.ui.notify(
				`Memory: ${project} — ${lines} index lines, ${raw.length} chars\n` +
					`${indexPath}\n` +
					`In system prompt: ${injected ? "yes" : "not yet (injects on next prompt)"}`,
				"info",
			);
		},
	});
}
