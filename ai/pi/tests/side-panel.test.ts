import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getBus, publishBus } from "../extensions/side-panel/bus.ts";

function mockPiTui(): void {
	mock.module("@earendil-works/pi-tui", () => ({
		isKeyRelease: () => false,
		Key: { enter: "enter", ctrlAlt: (key: string) => `ctrl-alt-${key}`, ctrlShift: (key: string) => `ctrl-shift-${key}` },
		matchesKey: (input: string, key: string) => input === key,
		truncateToWidth: (text: string, width: number) => text.slice(0, width),
		visibleWidth: (text: string) => text.length,
		wrapTextWithAnsi: (text: string, width: number) => width === 25
			? text.match(/.{1,25}/g) ?? [""]
			: [text],
	}));
}

interface RunStep {
	label: string;
	status: string;
	progressText?: string;
	progressUpdatedAt?: number;
}

interface RunStatus {
	runId: string;
	state: string;
	mode: string;
	sessionId: string;
	startedAt: number;
	steps: RunStep[];
}

interface CapturedWidget {
	render(width: number): string[];
	invalidate(): void;
	handleInput?(data: string): void;
}

const runningTimers: Array<() => void> = [];
const originalSetInterval = globalThis.setInterval;
const originalColumns = Object.getOwnPropertyDescriptor(process.stdout, "columns");
const originalRows = Object.getOwnPropertyDescriptor(process.stdout, "rows");
const originalTempRoot = process.env.PI_SUBAGENTS_TEMP_ROOT;

function setTerminalSize(columns: number, rows = 40): void {
	Object.defineProperty(process.stdout, "columns", { configurable: true, value: columns });
	Object.defineProperty(process.stdout, "rows", { configurable: true, value: rows });
}

function writeStatus(root: string, status: RunStatus): void {
	const runDir = join(root, "async-subagent-runs", status.runId);
	mkdirSync(runDir, { recursive: true });
	writeFileSync(join(runDir, "status.json"), JSON.stringify(status));
	writeFileSync(join(root, "async-subagent-runs", ".active-runs", status.runId), "");
}

function occurrences(text: string, value: string): number {
	return text.split(value).length - 1;
}

afterEach(() => {
	globalThis.setInterval = originalSetInterval;
	if (originalColumns) Object.defineProperty(process.stdout, "columns", originalColumns);
	else Reflect.deleteProperty(process.stdout, "columns");
	if (originalRows) Object.defineProperty(process.stdout, "rows", originalRows);
	else Reflect.deleteProperty(process.stdout, "rows");
	if (originalTempRoot === undefined) delete process.env.PI_SUBAGENTS_TEMP_ROOT;
	else process.env.PI_SUBAGENTS_TEMP_ROOT = originalTempRoot;
	runningTimers.length = 0;
	const bus = getBus();
	bus.panel = null;
	bus.capable = false;
	bus.todos = null;
	bus.menu = null;
	bus.dispose = undefined;
});

describe("side panel", () => {
	test("shows worker progress across resizes and navigates the compact plan", async () => {
		const tempRoot = mkdtempSync(join(tmpdir(), "side-panel-test-"));
		const runsRoot = join(tempRoot, "async-subagent-runs");
		mkdirSync(join(runsRoot, ".active-runs"), { recursive: true });
		process.env.PI_SUBAGENTS_TEMP_ROOT = tempRoot;
		setTerminalSize(130);

		globalThis.setInterval = ((callback: () => void) => {
			runningTimers.push(callback);
			return 1 as unknown as ReturnType<typeof setInterval>;
		}) as typeof setInterval;

		const now = Date.now();
		const sessionId = "/tmp/side-panel-session.jsonl";
		const workflow: RunStatus = {
			runId: "parallel-lanes",
			state: "running",
			mode: "workflow",
			sessionId,
			startedAt: now - 60_000,
			steps: [
				{ label: "Alpha", status: "running", progressText: "routing setup", progressUpdatedAt: now - 18_000 },
				{ label: "Beta", status: "running", progressText: "writing tests", progressUpdatedAt: now - 12_000 },
				{ label: "Idle", status: "running" },
			],
		};
		writeStatus(tempRoot, workflow);

		let widget: CapturedWidget | undefined;
		let overlay: CapturedWidget | undefined;
		let press: ((key: string) => { consume?: boolean } | undefined) | undefined;
		let editorText = "";
		let renderRequests = 0;
		const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
		const pi = {
			on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
				handlers.set(event, handler);
			},
		};
		const theme = {
			fg: (_color: string, text: string) => text,
			italic: (text: string) => text,
			strikethrough: (text: string) => text,
		};
		const ctx = {
			hasUI: true,
			sessionManager: { getSessionFile: () => sessionId, getSessionId: () => "session-id" },
			ui: {
				theme,
				setWidget: (_key: string, factory: (tui: { requestRender(): void }) => CapturedWidget | string[]) => {
					const result = factory({ requestRender: () => renderRequests++ });
					if (!Array.isArray(result)) widget = result;
				},
				notify: () => {},
				getEditorText: () => editorText,
				onTerminalInput: (handler: typeof press) => {
					press = handler;
					return () => { press = undefined; };
				},
				custom: (factory: (tui: { requestRender(): void }, overlayTheme: typeof theme, kb: undefined, done: () => void) => CapturedWidget) => new Promise<void>((resolve) => {
					overlay = factory({ requestRender: () => renderRequests++ }, theme, undefined, () => {
						overlay = undefined;
						resolve();
					});
				}),
			},
		};

		try {
			mockPiTui();
			const extension = (await import("../extensions/side-panel/index.ts")).default;
			extension(pi as never);
			await handlers.get("session_start")?.({}, ctx);

			const wideLines = getBus().panel?.lines.join("\n") ?? "";
			expect(wideLines).toContain("Alpha");
			expect(wideLines).toContain("routing setup");
			expect(wideLines).toMatch(/1[89]s ago/);
			expect(wideLines).toContain("writing tests");
			expect(wideLines).toMatch(/1[23]s ago/);
			expect(wideLines).toContain("Idle");
			expect(wideLines).not.toContain("undefined");
			const idleWideLine = wideLines.split("\n").find((line) => line.includes("Idle")) ?? "";
			expect(idleWideLine).not.toContain("ago");
			expect(idleWideLine).not.toContain("undefined");

			workflow.steps[0] = { label: "Alpha", status: "running", progressText: "routing changed", progressUpdatedAt: Date.now() - 3_000 };
			writeStatus(tempRoot, workflow);
			const requestsBeforeResize = renderRequests;
			setTerminalSize(100);
			runningTimers[0]?.();

			const narrowLines = widget?.render(100).join("\n") ?? "";
			expect(getBus().panel).toBeNull();
			expect(narrowLines).toContain("routing changed");
			expect(narrowLines).toMatch(/3s ago/);
			expect(narrowLines).not.toContain("routing setup");
			expect(occurrences(narrowLines, "routing changed")).toBe(1);
			expect(narrowLines).toContain("writing tests");
			expect(narrowLines).toContain("Idle");
			const idleNarrowLine = narrowLines.split("\n").find((line) => line.includes("Idle")) ?? "";
			expect(idleNarrowLine).not.toContain("ago");
			expect(idleNarrowLine).not.toContain("undefined");
			expect(renderRequests).toBeGreaterThan(requestsBeforeResize);
			expect(widget?.render(20).every((line) => line.length <= 20)).toBe(true);

			setTerminalSize(130);
			runningTimers[0]?.();
			const resizedWideLines = getBus().panel?.lines.join("\n") ?? "";
			expect(resizedWideLines).toContain("routing changed");
			expect(resizedWideLines).not.toContain("routing setup");
			expect(occurrences(resizedWideLines, "routing changed")).toBe(1);
			expect(widget?.render(130)).toEqual([]);

			const items = Array.from({ length: 12 }, (_, index) => ({
				step: index + 1,
				text: `Step ${index + 1} ${"long todo ".repeat(30)}`,
				completed: false,
				detail: `${"Long details. ".repeat(60)}\nVerify: check the tail`,
			}));
			publishBus({ todos: { items, executing: true } });
			expect(press?.("right")?.consume).toBe(true);
			expect(press?.("tab")?.consume).toBe(true);
			for (let i = 0; i < 11; i++) expect(press?.("down")?.consume).toBe(true);
			const planLines = getBus().panel?.lines.join("\n") ?? "";
			expect(planLines).toContain("> ○ Step 12");
			expect(planLines).not.toContain("○ Step 1 ");
			expect(planLines).toContain("Alpha");
			expect(planLines).not.toContain("Verify: check the tail");
			expect(press?.("enter")?.consume).toBe(true);
			expect(overlay?.render(25).join("\n")).not.toContain("Verify: check the tail");
			overlay?.handleInput?.("pageDown");
			expect(overlay?.render(25).join("\n")).toContain("Verify: check the tail");
			overlay?.handleInput?.("escape");
			await Promise.resolve();
			expect(overlay).toBeUndefined();
			expect(press?.("tab")?.consume).toBe(true);
			expect(press?.("x")).toBeUndefined();
			expect(press?.("down")).toBeUndefined();
			editorText = "draft";
			expect(press?.("right")).toBeUndefined();
		} finally {
			handlers.get("session_shutdown")?.({}, ctx);
			rmSync(tempRoot, { recursive: true, force: true });
		}
	});
});
