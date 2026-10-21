import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = join(import.meta.dir, "..", "..", "..");
const scriptSrc = join(repo, "private", "ai", "shared", "pi", "apply-models.sh");

const roots: string[] = [];
const env = { HOME: process.env.HOME, DOTFILES_DIR: process.env.DOTFILES_DIR };

interface Scope {
	provider: string;
	id: string;
	thinkingLevel?: string;
}

function scoped(...refs: string[]): Scope[] {
	return refs.map((ref) => {
		const slash = ref.indexOf("/");
		const provider = ref.slice(0, slash);
		const rest = ref.slice(slash + 1);
		const colon = rest.lastIndexOf(":");
		if (colon === -1) return { provider, id: rest };
		return { provider, id: rest.slice(0, colon), thinkingLevel: rest.slice(colon + 1) };
	});
}

function fixture(saved: string[], settings: Record<string, unknown> | null = { enabledModels: saved }) {
	const root = mkdtempSync(join(tmpdir(), "enabled-models-test-"));
	roots.push(root);
	const home = join(root, "home");
	const dotfiles = join(root, "dotfiles");
	const piDir = join(dotfiles, "private", "ai", "shared", "pi");
	mkdirSync(join(home, ".pi", "agent"), { recursive: true });
	mkdirSync(join(dotfiles, ".git"), { recursive: true });
	mkdirSync(piDir, { recursive: true });
	cpSync(scriptSrc, join(piDir, "apply-models.sh"));
	writeFileSync(join(piDir, "models.json"), JSON.stringify({ enabledModels: saved }, null, 2));
	if (settings) writeFileSync(join(home, ".pi", "agent", "settings.json"), JSON.stringify(settings, null, 2));
	process.env.HOME = home;
	process.env.DOTFILES_DIR = dotfiles;
	return {
		overlay: () => JSON.parse(readFileSync(join(piDir, "models.json"), "utf8")).enabledModels as string[],
		rawOverlay: () => readFileSync(join(piDir, "models.json"), "utf8"),
		settings: () => JSON.parse(readFileSync(join(home, ".pi", "agent", "settings.json"), "utf8")) as Record<string, unknown>,
		rawSettings: () => readFileSync(join(home, ".pi", "agent", "settings.json"), "utf8"),
	};
}

async function handlers() {
	const { default: register } = await import("../extensions/enabled-models.ts?fresh=" + Math.random());
	const fires: Record<string, (event: unknown, ctx: unknown) => unknown> = {};
	const notices: string[] = [];
	register({
		on: (name: string, fn: (event: unknown, ctx: unknown) => unknown) => {
			fires[name] = fn;
		},
	} as never);
	const ctx = (scope: Scope[]) => ({
		scopedModels: scope.map((model) => ({ model, thinkingLevel: model.thinkingLevel })),
		ui: { notify: (message: string) => notices.push(message) },
	});
	return { fires, notices, ctx };
}

const SAVED = ["open-weights/deepseek-v4p1-flash-priority:high", "vertex-proxy/gemini-3.8-flash:high"];
const WIDE = ["a/one:high", "b/two", "c/three:high"];

afterAll(() => {
	process.env.HOME = env.HOME;
	process.env.DOTFILES_DIR = env.DOTFILES_DIR;
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe("enabled-models", () => {
	test("restores the saved scope and warns that a restart is needed", async () => {
		const f = fixture(SAVED, { enabledModels: WIDE });
		const { fires, notices, ctx } = await handlers();
		fires.session_start!({ reason: "startup" }, ctx(scoped(...WIDE)));
		expect(f.settings().enabledModels).toEqual(SAVED);
		expect(notices[0]).toContain("restart pi");
	});

	test("does not write when the scope already matches", async () => {
		const f = fixture(SAVED);
		const before = f.rawSettings();
		const { fires, notices, ctx } = await handlers();
		fires.session_start!({ reason: "startup" }, ctx(scoped(...SAVED)));
		expect(f.rawSettings()).toBe(before);
		expect(notices).toEqual([]);
	});

	test("leaves everything alone when the overlay is missing", async () => {
		const f = fixture(SAVED, { enabledModels: WIDE });
		rmSync(join(process.env.DOTFILES_DIR!, "private", "ai", "shared", "pi", "models.json"));
		const { fires, notices, ctx } = await handlers();
		fires.session_start!({ reason: "startup" }, ctx(scoped(...WIDE)));
		expect(f.settings().enabledModels).toEqual(WIDE);
		expect(notices).toEqual([]);
	});

	test("an unchanged scope is not captured", async () => {
		const f = fixture(SAVED);
		const before = f.rawOverlay();
		const { fires, ctx } = await handlers();
		fires.session_start!({ reason: "startup" }, ctx(scoped(...SAVED)));
		fires.session_shutdown!({ reason: "quit" }, ctx(scoped(...SAVED)));
		expect(f.rawOverlay()).toBe(before);
	});

	test("a session-only scope change is captured", async () => {
		const f = fixture(SAVED);
		const { fires, ctx } = await handlers();
		fires.session_start!({ reason: "startup" }, ctx(scoped(...SAVED)));
		fires.session_shutdown!({ reason: "quit" }, ctx(scoped(...WIDE)));
		expect(f.overlay()).toEqual(WIDE);
	});

	test("saves the delta, not an externally rewritten settings.json", async () => {
		const f = fixture(SAVED);
		const { fires, ctx } = await handlers();
		fires.session_start!({ reason: "startup" }, ctx(scoped(...SAVED)));
		const session = scoped("open-weights/deepseek-v4p1-flash-priority:high", "open-weights/kimi-k3-priority:high");
		writeFileSync(join(process.env.HOME!, ".pi", "agent", "settings.json"), JSON.stringify({ enabledModels: WIDE }));
		fires.session_shutdown!({ reason: "quit" }, ctx(session));
		expect(f.overlay()).toEqual([
			"open-weights/deepseek-v4p1-flash-priority:high",
			"open-weights/kimi-k3-priority:high",
		]);
	});

	test("keeps thinking levels when pi's bare-id scope edit removes them", async () => {
		const f = fixture(SAVED);
		const { fires, ctx } = await handlers();
		const bare = scoped("open-weights/deepseek-v4p1-flash-priority", "vertex-proxy/gemini-3.8-flash");
		fires.session_start!({ reason: "startup" }, ctx(scoped(...SAVED)));
		fires.session_shutdown!({ reason: "quit" }, ctx([...bare, ...scoped("open-weights/kimi-k3-priority")]));
		expect(f.overlay()).toEqual([...SAVED, "open-weights/kimi-k3-priority"]);
	});

	test("keeps entries this machine cannot resolve", async () => {
		const f = fixture([...SAVED, "instacart-anthropic/claude-opus-5-5@default:high"]);
		const { fires, ctx } = await handlers();
		const session = scoped(...SAVED);
		fires.session_start!({ reason: "startup" }, ctx(session));
		fires.session_shutdown!({ reason: "quit" }, ctx(scoped(SAVED[0]!)));
		expect(f.overlay()).toEqual([SAVED[0]!, "instacart-anthropic/claude-opus-5-5@default:high"]);
	});

	test("accepts model ids containing slashes", async () => {
		const fireworks = "open-weights/accounts/fireworks/models/deepseek-v4p1-flash-1017:high";
		const f = fixture(SAVED);
		const { fires, ctx } = await handlers();
		fires.session_start!({ reason: "startup" }, ctx(scoped(...SAVED)));
		fires.session_shutdown!({ reason: "quit" }, ctx(scoped(...SAVED, fireworks)));
		expect(f.overlay()).toEqual([...SAVED, fireworks]);
	});

	test("restores a scope containing a slash model id", async () => {
		const fireworks = "open-weights/accounts/fireworks/models/deepseek-v4p1-flash-1017:high";
		const f = fixture([...SAVED, fireworks], { enabledModels: WIDE });
		const { fires, notices, ctx } = await handlers();
		fires.session_start!({ reason: "startup" }, ctx(scoped(...WIDE)));
		expect(f.settings().enabledModels).toEqual([...SAVED, fireworks]);
		expect(notices.some((notice) => notice.includes("failed"))).toBe(false);
	});

	test("a session that had to be restored never saves over the overlay", async () => {
		const f = fixture(SAVED, { enabledModels: WIDE });
		const before = f.rawOverlay();
		const { fires, ctx } = await handlers();
		fires.session_start!({ reason: "startup" }, ctx(scoped(...WIDE)));
		fires.session_shutdown!({ reason: "quit" }, ctx(scoped("a/one:high")));
		expect(f.rawOverlay()).toBe(before);
	});

	test("clearing the scope saves an empty list", async () => {
		const f = fixture(SAVED);
		const { fires, ctx } = await handlers();
		fires.session_start!({ reason: "startup" }, ctx(scoped(...SAVED)));
		fires.session_shutdown!({ reason: "quit" }, ctx([]));
		expect(f.overlay()).toEqual([]);
	});

	test("a saved change is in settings.json for the next session", async () => {
		const f = fixture(SAVED);
		const { fires, ctx } = await handlers();
		fires.session_start!({ reason: "startup" }, ctx(scoped(...SAVED)));
		fires.session_shutdown!({ reason: "quit" }, ctx(scoped(...WIDE)));
		expect(f.settings().enabledModels).toEqual(WIDE);

		const next = await handlers();
		next.fires.session_start!({ reason: "startup" }, ctx(scoped(...WIDE)));
		expect(next.notices).toEqual([]);
	});

	test("malformed settings.json is not overwritten, and the failure is surfaced", async () => {
		const f = fixture(SAVED);
		writeFileSync(join(process.env.HOME!, ".pi", "agent", "settings.json"), "{ nope");
		const { fires, notices, ctx } = await handlers();
		fires.session_start!({ reason: "startup" }, ctx(scoped(...WIDE)));
		expect(f.rawSettings()).toBe("{ nope");
		expect(notices[0]).toContain("failed");
	});
});
