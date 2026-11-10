import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const piDir = join(import.meta.dir, "..");
const baseSettings = JSON.parse(readFileSync(join(piDir, "settings.base.json"), "utf8"));

const roots: string[] = [];

function tempRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "pi-self-update-"));
	roots.push(root);
	return root;
}

afterAll(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

test("base settings route pi update through gohan", () => {
	expect(baseSettings.selfUpdateCommand).toEqual(["gohan", "update", "pi"]);
});

test("install merge adds selfUpdateCommand and preserves machine-local settings", () => {
	const repo = tempRoot();
	const piApp = join(repo, "ai", "pi");
	mkdirSync(piApp, { recursive: true });
	cpSync(join(piDir, "install.sh"), join(piApp, "install.sh"));
	cpSync(join(piDir, "settings.base.json"), join(piApp, "settings.base.json"));

	const home = join(repo, "home");
	mkdirSync(join(home, ".pi", "agent"), { recursive: true });
	const settingsPath = join(home, ".pi", "agent", "settings.json");
	writeFileSync(
		settingsPath,
		JSON.stringify({
			defaultProvider: "open-weights",
			defaultModel: "accounts/fireworks/models/test",
			lastChangelogVersion: "1.5.1",
			enabledModels: ["open-weights/test:high"],
			selfUpdateCommand: ["old", "command"],
			packages: ["npm:pi-web-access@1.2.3", "npm:pi-subagents"],
		}),
	);

	for (let run = 0; run < 2; run++) {
		const result = spawnSync("bash", [join(piApp, "install.sh")], {
			encoding: "utf8",
			env: { ...process.env, HOME: home },
		});
		if (result.status !== 0) {
			throw new Error(`install.sh failed (${result.status}): ${result.stderr || result.stdout}`);
		}
	}

	const merged = JSON.parse(readFileSync(settingsPath, "utf8"));
	expect(merged.$schema).toBe("https://pi.dev/schemas/settings.schema.json");
	expect(merged.selfUpdateCommand).toEqual(["gohan", "update", "pi"]);
	expect(merged.defaultProvider).toBe("open-weights");
	expect(merged.defaultModel).toBe("accounts/fireworks/models/test");
	expect(merged.lastChangelogVersion).toBe("1.5.1");
	expect(merged.enabledModels).toEqual(["open-weights/test:high"]);
	expect(merged.packages).toEqual(["npm:pi-web-access@1.2.3", "npm:pi-subagents"]);
});
