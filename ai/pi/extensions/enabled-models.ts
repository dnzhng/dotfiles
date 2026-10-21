/**
 * Enabled Models — keep pi's scoped-model list (`enabledModels` in
 * ~/.pi/agent/settings.json) in sync with the private dotfiles overlay, so a
 * Gohan pi update can't widen it and edits follow you across machines. All
 * sync logic lives in private/ai/shared/pi/apply-models.sh.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dotfilesDir } from "./dotfiles.ts";

const SCRIPT_REL = join("private", "ai", "shared", "pi", "apply-models.sh");
const LEVEL_SUFFIX = /:(off|minimal|low|medium|high|xhigh|max)$/;

function applyScript(): string | undefined {
	const root = dotfilesDir();
	if (!root) return undefined;
	const script = join(root, SCRIPT_REL);
	const overlay = join(dirname(script), "models.json");
	return existsSync(script) && existsSync(overlay) ? script : undefined;
}

function run(script: string, args: string[], input?: string): { out?: string; error?: string } {
	try {
		return { out: execFileSync("bash", [script, ...args], { encoding: "utf8", timeout: 10_000, input }) };
	} catch (error) {
		const stderr = (error as { stderr?: string }).stderr?.trim().split("\n").pop();
		return { error: stderr || String((error as Error).message).split("\n")[0] };
	}
}

function scopeRefs(scoped: ExtensionContext["scopedModels"]): string[] {
	return scoped.map(({ model, thinkingLevel }) =>
		thinkingLevel ? `${model.provider}/${model.id}:${thinkingLevel}` : `${model.provider}/${model.id}`,
	);
}

/** Model set ignoring thinking levels: pi's own scope edits drop them, so a
 * level-only difference is not a scope change. */
function modelKey(refs: string[]): string {
	return refs.map((ref) => ref.replace(LEVEL_SUFFIX, "").toLowerCase()).sort().join(",");
}

function overlayRefs(script: string): string[] {
	try {
		const overlay = JSON.parse(readFileSync(join(dirname(script), "models.json"), "utf8"));
		return Array.isArray(overlay.enabledModels) ? overlay.enabledModels : [];
	} catch {
		return [];
	}
}

/** True when the session runs models the overlay doesn't list — the signature
 * of a scope read before a restore (Gohan's widened list). Overlay entries
 * that don't resolve here (no provider auth, VPN off) are not staleness. */
function runsOutsideOverlay(startRefs: string[], overlay: string[]): boolean {
	const known = new Set(overlay.map((ref) => modelKey([ref])));
	return startRefs.some((ref) => !known.has(modelKey([ref])));
}

export default function (pi: ExtensionAPI) {
	let startRefs: string[] = [];
	let stale = false;

	pi.on("session_start", (_event, ctx) => {
		startRefs = scopeRefs(ctx.scopedModels);
		stale = false;
		const script = applyScript();
		if (!script) return;
		stale = runsOutsideOverlay(startRefs, overlayRefs(script));
		const { error } = run(script, []);
		if (error) {
			ctx.ui.notify(`Scoped models: apply-models.sh failed — ${error}`, "warning");
			stale = true;
			return;
		}
		if (stale) ctx.ui.notify("Scoped models restored from the dotfiles list — restart pi to apply", "info");
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (stale) return;
		const script = applyScript();
		if (!script) return;
		const current = scopeRefs(ctx.scopedModels);
		if (modelKey(current) === modelKey(startRefs)) return;
		const { error } = run(script, ["--save"], JSON.stringify({ start: startRefs, current }));
		if (error) ctx.ui.notify(`Scoped models: could not save — ${error}`, "warning");
	});
}
