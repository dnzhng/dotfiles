/**
 * Notification — rings the terminal bell when pi is waiting on you: the final
 * reply of a run, or a questionnaire dialog.
 *
 * The normal case rings from `message_end` because plan-mode's `agent_end`
 * handler blocks on its post-plan menu, so a bell at settle time would arrive
 * only after the menu was answered. The `agent_settled` handler covers runs
 * that end without a normal reply — a provider error or an unrecovered
 * truncation still leaves pi waiting, and settling is the first point where
 * retries and compaction are known to be done. Non-"stop" endings are skipped
 * earlier because a recoverable truncation is retried and dropped from history.
 *
 * The tui guard keeps subagent children (in-process sessions with mode "print")
 * and other headless runs silent; `/notification [on|off]` toggles the
 * machine-local flag.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const STATE_FILE = join(homedir(), ".pi", "agent", "notification.json");

function load(): boolean {
	try {
		const parsed = JSON.parse(readFileSync(STATE_FILE, "utf8")) as { enabled?: unknown };
		return typeof parsed.enabled === "boolean" ? parsed.enabled : true;
	} catch {
		return true;
	}
}

function save(enabled: boolean): boolean {
	try {
		writeFileSync(STATE_FILE, `${JSON.stringify({ enabled }, null, 2)}\n`);
		return true;
	} catch {
		return false;
	}
}

function ring(): void {
	process.stdout.write("\x07");
}

export default function (pi: ExtensionAPI) {
	let enabled = true;
	let lastStop: string | undefined;

	pi.on("session_start", () => {
		enabled = load();
	});

	pi.on("message_end", (event, ctx) => {
		if (event.message.role !== "assistant") return;
		lastStop = event.message.stopReason;
		if (!enabled || ctx.mode !== "tui") return;
		if (event.message.stopReason !== "stop") return;
		ring();
	});

	pi.on("agent_settled", (event, ctx) => {
		const stop = lastStop;
		lastStop = undefined;
		if (!enabled || ctx.mode !== "tui" || event.aborted) return;
		if (stop === "stop") return;
		ring();
	});

	pi.on("tool_execution_start", (event, ctx) => {
		if (!enabled || ctx.mode !== "tui") return;
		if (event.toolName !== "questionnaire") return;
		ring();
	});

	pi.registerCommand("notification", {
		description: "Toggle the notification sound (on|off)",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			if (arg !== "" && arg !== "on" && arg !== "off") {
				ctx.ui.notify("Usage: /notification [on|off]", "warning");
				return;
			}
			enabled = arg === "on" ? true : arg === "off" ? false : !enabled;
			const saved = save(enabled);
			const suffix = saved ? "" : " (couldn't save — this session only)";
			ctx.ui.notify(`Notification sound ${enabled ? "on" : "off"}${suffix}`, saved ? "info" : "warning");
		},
	});
}
