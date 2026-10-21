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

function refs(scope: readonly Scope[]): string[] {
	return scope.map(({ provider, id, thinkingLevel }) =>
		thinkingLevel ? `${provider}/${id}:${thinkingLevel}` : `${provider}/${id}`,
	);
}

function live(context: { scopedModels: readonly { model: Scope; thinkingLevel?: string }[] }): string[] {
	return refs(
		context.scopedModels.map(({ model, thinkingLevel }) => ({
			...model,
			thinkingLevel: thinkingLevel ?? model.thinkingLevel,
		})),
	);
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
		writeOverlay: (saved: string[]) =>
			writeFileSync(join(piDir, "models.json"), JSON.stringify({ enabledModels: saved }, null, 2)),
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
	const ctx = (scope: Scope[], options: { available?: Scope[]; snapshot?: boolean } = {}) => {
		const entries = scope.map((model) => ({ model, thinkingLevel: model.thinkingLevel }));
		const available = (options.available ?? AVAILABLE).map(({ provider, id }) => ({ provider, id }));
		return {
			get scopedModels() {
				return options.snapshot ? entries.map((entry) => ({ ...entry })) : entries;
			},
			modelRegistry: { getAvailable: () => available },
			ui: { notify: (message: string) => notices.push(message) },
		};
	};
	return { fires, notices, ctx };
}

const SAVED = ["open-weights/deepseek-v4p1-flash-priority:high", "vertex-proxy/gemini-3.8-flash:high"];
const WIDE = ["a/one:high", "b/two", "c/three:high"];
const KIMI = "open-weights/kimi-k3-priority";
const FIREWORKS = "open-weights/accounts/fireworks/models/deepseek-v4p1-flash-1017";
const AVAILABLE = scoped(...SAVED, ...WIDE, KIMI, FIREWORKS);

afterAll(() => {
	process.env.HOME = env.HOME;
	process.env.DOTFILES_DIR = env.DOTFILES_DIR;
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe("enabled-models", () => {
	test("restores the saved scope into the running session", async () => {
		const f = fixture(SAVED, { enabledModels: WIDE });
		const { fires, notices, ctx } = await handlers();
		const c = ctx(scoped(...WIDE));
		fires.session_start!({ reason: "startup" }, c);
		expect(f.settings().enabledModels).toEqual(SAVED);
		expect(live(c)).toEqual(SAVED);
		expect(notices).toEqual(["Scoped models restored from the dotfiles list"]);
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
		const c = ctx(scoped(...SAVED));
		fires.session_start!({ reason: "startup" }, c);
		fires.session_shutdown!({ reason: "quit" }, c);
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
		const c = ctx(scoped(...SAVED));
		fires.session_start!({ reason: "startup" }, c);
		const session = scoped("open-weights/deepseek-v4p1-flash-priority:high", KIMI);
		writeFileSync(join(process.env.HOME!, ".pi", "agent", "settings.json"), JSON.stringify({ enabledModels: WIDE }));
		fires.session_shutdown!({ reason: "quit" }, ctx(session));
		expect(f.overlay()).toEqual(["open-weights/deepseek-v4p1-flash-priority:high", KIMI]);
	});

	test("keeps thinking levels when pi's bare-id scope edit removes them", async () => {
		const f = fixture(SAVED);
		const { fires, ctx } = await handlers();
		const bare = scoped("open-weights/deepseek-v4p1-flash-priority", "vertex-proxy/gemini-3.8-flash");
		fires.session_start!({ reason: "startup" }, ctx(scoped(...SAVED)));
		fires.session_shutdown!({ reason: "quit" }, ctx([...bare, ...scoped(KIMI)]));
		expect(f.overlay()).toEqual([...SAVED, KIMI]);
	});

	test("keeps entries this machine cannot resolve", async () => {
		const f = fixture([...SAVED, "instacart-anthropic/claude-opus-5-5@default:high"]);
		const { fires, ctx } = await handlers();
		const c = ctx(scoped(...SAVED));
		fires.session_start!({ reason: "startup" }, c);
		fires.session_shutdown!({ reason: "quit" }, ctx(scoped(SAVED[0]!)));
		expect(f.overlay()).toEqual([SAVED[0]!, "instacart-anthropic/claude-opus-5-5@default:high"]);
	});

	test("accepts model ids containing slashes", async () => {
		const f = fixture(SAVED);
		const { fires, ctx } = await handlers();
		fires.session_start!({ reason: "startup" }, ctx(scoped(...SAVED)));
		fires.session_shutdown!({ reason: "quit" }, ctx(scoped(...SAVED, FIREWORKS)));
		expect(f.overlay()).toEqual([...SAVED, FIREWORKS]);
	});

	test("restores a scope containing a slash model id", async () => {
		const f = fixture([...SAVED, FIREWORKS], { enabledModels: WIDE });
		const { fires, notices, ctx } = await handlers();
		const c = ctx(scoped(...WIDE));
		fires.session_start!({ reason: "startup" }, c);
		expect(f.settings().enabledModels).toEqual([...SAVED, FIREWORKS]);
		expect(live(c)).toEqual([...SAVED, FIREWORKS]);
		expect(notices.some((notice) => notice.includes("failed"))).toBe(false);
	});

	test("a session restored live saves later scope changes", async () => {
		const f = fixture(SAVED, { enabledModels: WIDE });
		const { fires, ctx } = await handlers();
		const c = ctx(scoped(...WIDE));
		fires.session_start!({ reason: "startup" }, c);
		expect(live(c)).toEqual(SAVED);

		fires.session_shutdown!({ reason: "quit" }, ctx(scoped(...SAVED, KIMI)));
		expect(f.overlay()).toEqual([...SAVED, KIMI]);
	});

	test("reload applies an edited overlay without restarting", async () => {
		const f = fixture(SAVED);
		const { fires, notices, ctx } = await handlers();
		const c = ctx(scoped(...SAVED));
		fires.session_start!({ reason: "startup" }, c);
		expect(notices).toEqual([]);

		f.writeOverlay([...SAVED, KIMI]);
		fires.session_shutdown!({ reason: "reload" }, c);
		fires.session_start!({ reason: "reload" }, c);
		expect(live(c)).toEqual([...SAVED, KIMI]);
		expect(f.overlay()).toEqual([...SAVED, KIMI]);
		expect(notices).toEqual(["Scoped models restored from the dotfiles list"]);
	});

	test("a level-only difference is not a scope change", async () => {
		const f = fixture(SAVED);
		const { fires, notices, ctx } = await handlers();
		const bare = scoped("open-weights/deepseek-v4p1-flash-priority", "vertex-proxy/gemini-3.8-flash");
		const c = ctx(bare);
		fires.session_start!({ reason: "startup" }, c);
		expect(live(c)).toEqual(refs(bare));
		expect(notices).toEqual([]);
	});

	test("an explicit --models flag keeps the CLI scope", async () => {
		const f = fixture(SAVED, { enabledModels: WIDE });
		process.argv.push("--models");
		try {
			const { fires, notices, ctx } = await handlers();
			const c = ctx(scoped(...WIDE));
			fires.session_start!({ reason: "startup" }, c);
			expect(live(c)).toEqual(WIDE);
			expect(notices[0]).toContain("restart pi");
			expect(f.settings().enabledModels).toEqual(SAVED);
		} finally {
			process.argv.splice(process.argv.lastIndexOf("--models"), 1);
		}
	});

	test("a scope that cannot be adopted keeps the restart notice and blocks saving", async () => {
		const f = fixture(SAVED, { enabledModels: WIDE });
		const before = f.rawOverlay();
		const { fires, notices, ctx } = await handlers();
		const c = ctx(scoped(...WIDE), { snapshot: true });
		fires.session_start!({ reason: "startup" }, c);
		expect(live(c)).toEqual(WIDE);
		expect(notices[0]).toContain("restart pi");

		fires.session_shutdown!({ reason: "quit" }, ctx(scoped("a/one:high")));
		expect(f.rawOverlay()).toBe(before);
	});

	test("keeps an overlay model the catalogue no longer resolves", async () => {
		const f = fixture(["a/one:high", "b/two"], { enabledModels: WIDE });
		const { fires, notices, ctx } = await handlers();
		const c = ctx(scoped(...WIDE), { available: scoped("a/one", "c/three") });
		fires.session_start!({ reason: "startup" }, c);
		expect(live(c)).toEqual(["a/one:high", "b/two"]);
		expect(notices).toEqual(["Scoped models restored from the dotfiles list"]);
	});

	test("an unresolvable overlay leaves the scope alone", async () => {
		const f = fixture(["ghost/nope:high"], { enabledModels: WIDE });
		const { fires, notices, ctx } = await handlers();
		const c = ctx(scoped(...WIDE));
		fires.session_start!({ reason: "startup" }, c);
		expect(live(c)).toEqual(WIDE);
		expect(notices[0]).toContain("restart pi");
		expect(f.settings().enabledModels).toEqual(["ghost/nope:high"]);
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
		next.fires.session_start!({ reason: "startup" }, next.ctx(scoped(...WIDE)));
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
