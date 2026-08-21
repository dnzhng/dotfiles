/**
 * Tmux splits — /vim and /lazygit commands that open the tool in an 85% tmux
 * split above the pi pane. Direct execution: pi checks extension commands
 * before anything LLM-side, so these run instantly with no model round trip.
 *
 * Replaces the old vim/lazygit skills (~/.claude/skills), which cost a skill
 * file read plus a bash call for what is one tmux command. Both commands are
 * thin wrappers around ai/shared/bin/tmux-split-window in the dotfiles repo —
 * the single source of truth for the split behavior, also callable directly
 * from other harnesses (e.g. `! tmux-split-window lazygit` in Claude Code).
 *
 * Repo root: $DOTFILES_DIR, else the first of ~/Code/dotfiles, ~/dotfiles
 * with a .git (same env-override-then-convention pattern as $PI_AGENT_STORE
 * in memory.ts/plan-mode).
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

function scriptPath(): string | undefined {
	const candidates = [
		process.env.DOTFILES_DIR,
		join(homedir(), "Code", "dotfiles"),
		join(homedir(), "dotfiles"),
	];
	for (const root of candidates) {
		if (root && existsSync(join(root, ".git"))) {
			return join(root, "ai", "shared", "bin", "tmux-split-window");
		}
	}
	return undefined;
}

function openSplit(tool: "vim" | "lazygit", args: string, ctx: ExtensionCommandContext): void {
	if (!process.env.TMUX) {
		ctx.ui.notify("Not inside tmux — splits require tmux", "error");
		return;
	}
	const script = scriptPath();
	if (!script || !existsSync(script)) {
		ctx.ui.notify("tmux-split-window not found — is the dotfiles repo present?", "error");
		return;
	}
	const path = args.trim();
	execFile(script, path ? [tool, path] : [tool], (error, _stdout, stderr) => {
		if (error) {
			ctx.ui.notify(`Failed to open ${tool}: ${stderr.trim() || error.message}`, "error");
		}
		// On success the new pane is the feedback; no notify needed.
	});
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("vim", {
		description: "Open vim in an 85% tmux split above (optional file arg)",
		handler: async (args, ctx) => openSplit("vim", args, ctx),
	});
	pi.registerCommand("lazygit", {
		description: "Open lazygit in an 85% tmux split above (optional dir arg)",
		handler: async (args, ctx) => openSplit("lazygit", args, ctx),
	});
}
