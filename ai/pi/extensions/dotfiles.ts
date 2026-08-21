/**
 * Dotfiles — startup out-of-date check + /sync command for the dotfiles repo.
 *
 * Repo root: $DOTFILES_DIR, else the first of ~/Code/dotfiles, ~/dotfiles
 * with a .git (same env-override-then-convention pattern as $PI_AGENT_STORE
 * in memory.ts/plan-mode).
 *
 * On session_start (skipped for resume/fork, like splash): fetches both repos
 * (main + private/, best-effort with a 15s timeout so offline/VPN-less
 * startup never blocks), then flags anything actionable — uncommitted
 * changes, unpushed or behind commits, and AGENTS.md drift (an installed
 * destination that no longer byte-matches the merged base+private build,
 * i.e. a Gohan overwrite). One warning line lists the issues; a select then
 * offers "Run sync now". Sync itself lives in sync.sh at the repo root
 * (commit -> pull --rebase -> push -> re-run every install.sh); "Run sync
 * now" and /sync both run it async and notify on completion.
 */

import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Dotfiles repo root: $DOTFILES_DIR, else ~/Code/dotfiles or ~/dotfiles (first with a .git). */
export function dotfilesDir(): string | undefined {
	const env = process.env.DOTFILES_DIR;
	if (env && existsSync(join(env, ".git"))) return env;
	for (const candidate of [join(homedir(), "Code", "dotfiles"), join(homedir(), "dotfiles")]) {
		if (existsSync(join(candidate, ".git"))) return candidate;
	}
	return undefined;
}

function git(dir: string, args: string[]): string {
	return execFileSync("git", ["-C", dir, ...args], { stdio: ["ignore", "pipe", "ignore"] })
		.toString()
		.trim();
}

/** dirty/ahead/behind for one repo; undefined if git errors (not a repo, etc). */
function repoState(dir: string): { dirty: boolean; ahead: number; behind: number } | undefined {
	try {
		const dirty = git(dir, ["status", "--porcelain"]) !== "";
		let ahead = 0;
		let behind = 0;
		try {
			const counts = git(dir, ["rev-list", "--left-right", "--count", "HEAD...@{u}"]);
			[ahead, behind] = counts.split(/\s+/).map(Number);
		} catch {
			// no upstream configured — local state only
		}
		return { dirty, ahead, behind };
	} catch {
		return undefined;
	}
}

// Mirrors ai/shared/install.sh's DESTINATIONS.
const AGENTS_DESTINATIONS = [
	".claude/AGENTS.md",
	".config/opencode/AGENTS.md",
	".pi/agent/AGENTS.md",
	".gemini/AGENTS.md",
];

/** Installed AGENTS.md destinations that don't match the merged base+private build. */
function driftedAgentsFiles(root: string): string[] {
	const base = join(root, "ai", "shared", "AGENTS.md");
	if (!existsSync(base)) return [];
	let expected = readFileSync(base, "utf8");
	const privateLayer = join(root, "private", "ai", "shared", "AGENTS.md");
	if (existsSync(privateLayer)) expected += `\n${readFileSync(privateLayer, "utf8")}`;
	const drifted: string[] = [];
	for (const rel of AGENTS_DESTINATIONS) {
		const dest = join(homedir(), rel);
		if (!existsSync(dest)) continue; // harness not installed here
		try {
			if (readFileSync(dest, "utf8") !== expected) drifted.push(`~/${rel}`);
		} catch {
			// unreadable — skip
		}
	}
	return drifted;
}

/** One string per actionable issue ("dotfiles: uncommitted changes, 2 behind", ...). */
function collectIssues(root: string): string[] {
	const issues: string[] = [];
	for (const { dir, label } of [
		{ dir: root, label: "dotfiles" },
		{ dir: join(root, "private"), label: "dotfiles-private" },
	]) {
		if (!existsSync(join(dir, ".git"))) continue;
		const state = repoState(dir);
		if (!state) continue;
		const bits: string[] = [];
		if (state.dirty) bits.push("uncommitted changes");
		if (state.ahead > 0) bits.push(`${state.ahead} unpushed`);
		if (state.behind > 0) bits.push(`${state.behind} behind`);
		if (bits.length > 0) issues.push(`${label}: ${bits.join(", ")}`);
	}
	for (const dest of driftedAgentsFiles(root)) {
		issues.push(`${dest} drifted (Gohan overwrite?)`);
	}
	return issues;
}

/** Best-effort git fetch; always resolves (offline, slow VPN, no remote — all fine). */
function fetchRepo(dir: string): Promise<void> {
	return new Promise((resolve) => {
		execFile("git", ["-C", dir, "fetch", "--quiet"], { timeout: 15000 }, () => resolve());
	});
}

function runSync(root: string, ctx: ExtensionContext, noPush = false): void {
	ctx.ui.notify(noPush ? "Pulling & reinstalling dotfiles (no push)…" : "Syncing dotfiles…", "info");
	execFile("bash", [join(root, "sync.sh"), ...(noPush ? ["--no-push"] : [])], { timeout: 120_000 }, (error, _stdout, stderr) => {
		if (error) {
			const tail = (stderr || "sync.sh failed").trim().split("\n").slice(-5).join("\n");
			ctx.ui.notify(`Dotfiles sync failed:\n${tail}`, "error");
		} else {
			ctx.ui.notify(noPush ? "Dotfiles pulled & reinstalled (no push)" : "Dotfiles synced and reinstalled", "info");
		}
	});
}

export default function (pi: ExtensionAPI) {
	let promptOpen = false;

	pi.on("session_start", async (event, ctx) => {
		if (event.reason === "resume" || event.reason === "fork") return;
		const root = dotfilesDir();
		if (!root) return;
		const repos = [root, join(root, "private")].filter((d) => existsSync(join(d, ".git")));
		await Promise.all(repos.map(fetchRepo));
		const issues = collectIssues(root);
		if (issues.length === 0 || promptOpen) return;
		ctx.ui.notify(`Dotfiles out of date: ${issues.join("; ")} — run dotfiles-sync or /sync`, "warning");
		promptOpen = true;
		try {
			const choice = await ctx.ui.select("Dotfiles out of date — run sync?", [
				"Run sync now",
				"Pull & reinstall (no push)",
				"Later",
			]);
			if (choice === "Run sync now") runSync(root, ctx);
			else if (choice === "Pull & reinstall (no push)") runSync(root, ctx, true);
		} finally {
			promptOpen = false;
		}
	});

	pi.registerCommand("sync", {
		description: "Sync dotfiles: commit, push, pull, then re-run install scripts (sync.sh). Pass `local` to pull & reinstall without pushing (keeps private/ local).",
		getArgumentCompletions: (prefix: string) => {
			const items = [{ value: "local", label: "local", description: "Pull & reinstall, no push" }];
			const filtered = items.filter((i) => i.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const root = dotfilesDir();
			if (!root) {
				ctx.ui.notify(
					"No dotfiles repo found (set $DOTFILES_DIR; looked in ~/Code/dotfiles and ~/dotfiles)",
					"warning",
				);
				return;
			}
			const noPush = args.trim().toLowerCase() === "local" || args.includes("--no-push");
			runSync(root, ctx, noPush);
		},
	});
}
