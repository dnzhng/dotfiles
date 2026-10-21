import { afterAll, describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface FakeModel {
	provider: string;
	id: string;
	reasoning?: boolean;
	levels?: string[];
}

const plansRoot = mkdtempSync(join(tmpdir(), "plan-mode-test-"));
mkdirSync(join(plansRoot, "memory", "agent", ".plans"), { recursive: true });
process.env.PI_AGENT_STORE = plansRoot;

mock.module("@earendil-works/pi-tui", () => ({
	Key: { ctrlAlt: (key: string) => `ctrl-alt-${key}`, ctrlShift: (key: string) => `ctrl-shift-${key}` },
	matchesKey: () => false,
	visibleWidth: (text: string) => text.length,
	wrapTextWithAnsi: (text: string) => [text],
	Editor: class {},
	Text: class {},
}));

mock.module("@earendil-works/pi-ai", () => ({
	getSupportedThinkingLevels: (model: FakeModel) =>
		model.levels ?? (model.reasoning ? ["off", "low", "medium", "high"] : ["off"]),
}));

mock.module("typebox", () => ({ Type: new Proxy({}, { get: () => () => ({}) }) }));

const PLAN_TEXT = [
	"Title: Harness plan",
	"",
	"## Plan",
	"1. Do the first thing",
	"2. Do the second thing",
].join("\n");

const EXECUTE_ACTION = "Execute the plan (track progress)";
const CONFIGURE_ACTION = "Configure execution model & thinking";
const CONFIGURE_REVIEW_ACTION = "Configure review model & thinking";
const STAY_ACTION = "Stay in plan mode";
const RESET_LABEL = "(reset to the pre-plan model)";
const REVIEW_RESET_LABEL = "(reset to agent defaults)";
const REVIEW_LINE = 'model "p/exec:high"';

const planModel: FakeModel = { provider: "p", id: "planner", reasoning: true };
const prePlanModel: FakeModel = { provider: "p", id: "pre-plan", reasoning: true };
const execModel: FakeModel = { provider: "p", id: "exec", reasoning: true };
const noThinkingModel: FakeModel = { provider: "p", id: "plain", levels: ["off"] };

interface Harness {
	commands: Map<string, (args: string | undefined, ctx: unknown) => Promise<void>>;
	handlers: Map<string, ((event: unknown, ctx: unknown) => Promise<unknown>)[]>;
	entries: { type: string; customType?: string; data?: Record<string, unknown> }[];
	sentMessages: { customType?: string; content?: string }[];
	sentUserMessages: { content: unknown; options?: Record<string, unknown> }[];
	events: string[];
	setModelResult: boolean;
}

async function loadExtension(): Promise<Harness> {
	const commands = new Map<string, (args: string | undefined, ctx: unknown) => Promise<void>>();
	const handlers = new Map<string, ((event: unknown, ctx: unknown) => Promise<unknown>)[]>();
	const entries: Harness["entries"] = [];
	const sentMessages: Harness["sentMessages"] = [];
	const sentUserMessages: Harness["sentUserMessages"] = [];
	const events: string[] = [];
	const harness: Harness = {
		commands,
		handlers,
		entries,
		sentMessages,
		sentUserMessages,
		events,
		setModelResult: true,
	};
	let activeTools: string[] = ["read", "bash", "edit", "write"];

	const pi = {
		registerTool: () => {},
		registerFlag: () => {},
		registerShortcut: () => {},
		registerCommand: (name: string, def: { handler: Harness["commands"] extends Map<string, infer H> ? H : never }) => {
			commands.set(name, def.handler);
		},
		on: (event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
			return () => {};
		},
		getFlag: () => false,
		getActiveTools: () => [...activeTools],
		setActiveTools: (names: string[]) => {
			activeTools = [...names];
		},
		setModel: async (model: FakeModel) => {
			events.push(`setModel:${model.provider}/${model.id}`);
			return harness.setModelResult;
		},
		setThinkingLevel: (level: string) => {
			events.push(`setThinking:${level}`);
		},
		appendEntry: (customType: string, data: Record<string, unknown>) => {
			entries.push({ type: "custom", customType, data });
		},
		sendMessage: (message: { customType?: string }) => {
			sentMessages.push(message);
		},
		sendUserMessage: (content: unknown, options?: Record<string, unknown>) => {
			sentUserMessages.push({ content, options });
		},
	};

	const factory = (await import("../extensions/plan-mode/index.ts")).default;
	factory(pi as never);
	return harness;
}

interface CtxOptions {
	models?: FakeModel[];
	availableModels?: FakeModel[];
	currentModel?: FakeModel;
	entries?: Harness["entries"];
	selects?: (string | undefined)[];
	editor?: string | undefined;
	scopedModels?: { model: FakeModel }[];
}

function makeCtx(options: CtxOptions = {}) {
	const models = options.models ?? [planModel, prePlanModel, execModel, noThinkingModel];
	const selects = [...(options.selects ?? [])];
	const selectCalls: { title: string; options: string[] }[] = [];
	const notifications: { message: string; type?: string }[] = [];

	const ui = {
		theme: {
			fg: (_color: string, text: string) => text,
			bg: (_color: string, text: string) => text,
			bold: (text: string) => text,
			strikethrough: (text: string) => text,
		},
		select: async (title: string, options: string[]) => {
			selectCalls.push({ title, options });
			return selects.shift();
		},
		notify: (message: string, type?: string) => {
			notifications.push({ message, type });
		},
		editor: async () => options.editor,
		custom: async () => undefined,
		setStatus: () => {},
		setWidget: () => {},
	};

	return {
		ui,
		mode: "tui",
		hasUI: true,
		cwd: plansRoot,
		sessionManager: { getEntries: () => options.entries ?? [], getSessionFile: () => "/tmp/session.jsonl" },
		modelRegistry: {
			find: (provider: string, id: string) => models.find((m) => m.provider === provider && m.id === id),
			getAvailable: () => options.availableModels ?? models,
		},
		model: options.currentModel ?? prePlanModel,
		scopedModels: options.scopedModels ?? [],
		isIdle: () => true,
		isProjectTrusted: () => true,
		signal: undefined,
		abort: () => {},
		hasPendingMessages: () => false,
		shutdown: () => {},
		getContextUsage: () => undefined,
		compact: () => {},
		getSystemPrompt: () => "",
		selectCalls,
		notifications,
	};
}

type Ctx = ReturnType<typeof makeCtx>;

async function runAgentEnd(h: Harness, ctx: Ctx): Promise<void> {
	const handler = h.handlers.get("agent_end")?.[0];
	if (!handler) throw new Error("agent_end handler not registered");
	await handler({ messages: [{ role: "assistant", content: [{ type: "text", text: PLAN_TEXT }] }] }, ctx);
}

async function runSessionStart(h: Harness, ctx: Ctx, reason: string): Promise<void> {
	const handler = h.handlers.get("session_start")?.[0];
	if (!handler) throw new Error("session_start handler not registered");
	await handler({ type: "session_start", reason }, ctx);
}

async function runBeforeAgentStart(h: Harness): Promise<{ message?: { customType?: string; content?: string } } | undefined> {
	const handler = h.handlers.get("before_agent_start")?.[0];
	if (!handler) throw new Error("before_agent_start handler not registered");
	return (await handler({}, undefined)) as { message?: { customType?: string; content?: string } } | undefined;
}

async function enterPlanMode(h: Harness, ctx: Ctx): Promise<void> {
	const handler = h.commands.get("plan");
	if (!handler) throw new Error("/plan command not registered");
	await handler(undefined, ctx);
}

function lastEntry(h: Harness): Record<string, unknown> {
	const data = h.entries.at(-1)?.data;
	if (!data) throw new Error("no plan-mode entry persisted");
	return data;
}

afterAll(() => {
	rmSync(plansRoot, { recursive: true, force: true });
	delete process.env.PI_AGENT_STORE;
});

describe("execution target persistence", () => {
	test("applies the configured model and thinking level when executing", async () => {
		const h = await loadExtension();
		const ctx = makeCtx({ selects: [CONFIGURE_ACTION, "p/exec", "high", EXECUTE_ACTION] });
		await enterPlanMode(h, ctx);

		await runAgentEnd(h, ctx);

		expect(h.events).toEqual(["setModel:p/exec", "setThinking:high"]);
		expect(h.sentMessages.at(-1)?.customType).toBe("plan-mode-execute");
		expect(lastEntry(h).enabled).toBe(false);
		expect(lastEntry(h).executing).toBe(true);
		expect(lastEntry(h).executionConfig).toEqual({ provider: "p", id: "exec", thinkingLevel: "high" });
	});

	test("uses the pre-plan model when no target is configured", async () => {
		const h = await loadExtension();
		const ctx = makeCtx({ selects: [EXECUTE_ACTION] });
		await enterPlanMode(h, ctx);
		ctx.model = planModel; // the planning model is active by the time the plan is ready

		await runAgentEnd(h, ctx);

		expect(h.events).toEqual(["setModel:p/pre-plan"]);
		expect(h.sentMessages.at(-1)?.customType).toBe("plan-mode-execute");
	});

	test("carries the target through a resume and still executes with it", async () => {
		const h = await loadExtension();
		const entries = [
			{
				type: "custom",
				customType: "plan-mode",
				data: {
					enabled: true,
					todos: [],
					executing: false,
					modelBeforePlanMode: { provider: "p", id: "pre-plan" },
					executionConfig: { provider: "p", id: "exec", thinkingLevel: "low" },
				},
			},
		];
		const ctx = makeCtx({ entries, selects: [EXECUTE_ACTION] });
		await runSessionStart(h, ctx, "resume");

		await runAgentEnd(h, ctx);

		expect(h.events).toEqual(["setModel:p/exec", "setThinking:low"]);
	});

	test("tolerates older entries without an execution config", async () => {
		const h = await loadExtension();
		const entries = [
			{
				type: "custom",
				customType: "plan-mode",
				data: { enabled: true, todos: [], executing: false, modelBeforePlanMode: { provider: "p", id: "pre-plan" } },
			},
		];
		const ctx = makeCtx({ entries, selects: [EXECUTE_ACTION], currentModel: planModel });
		await runSessionStart(h, ctx, "resume");

		await runAgentEnd(h, ctx);

		expect(h.events).toEqual(["setModel:p/pre-plan"]);
	});

	test("clears the target when plan mode is toggled off", async () => {
		const h = await loadExtension();
		const ctx = makeCtx({ selects: [CONFIGURE_ACTION, "p/exec", "high", STAY_ACTION] });
		await enterPlanMode(h, ctx);
		await runAgentEnd(h, ctx);
		expect(lastEntry(h).executionConfig).toEqual({ provider: "p", id: "exec", thinkingLevel: "high" });

		await enterPlanMode(h, ctx);

		expect(lastEntry(h).executionConfig).toBeUndefined();
	});
});

describe("configure flow", () => {
	test("commits model and level only after both dialogs, leaving the planning model alone", async () => {
		const h = await loadExtension();
		const ctx = makeCtx({ selects: [CONFIGURE_ACTION, "p/exec", "high", STAY_ACTION] });
		await enterPlanMode(h, ctx);

		await runAgentEnd(h, ctx);

		expect(h.events).toEqual([]);
		expect(lastEntry(h).executionConfig).toEqual({ provider: "p", id: "exec", thinkingLevel: "high" });
		expect(ctx.selectCalls.at(-1)?.title).toContain("p/exec @ high");
	});

	test("offers only the thinking levels the chosen model supports", async () => {
		const h = await loadExtension();
		const ctx = makeCtx({ selects: [CONFIGURE_ACTION, "p/plain", "off", STAY_ACTION] });
		await enterPlanMode(h, ctx);

		await runAgentEnd(h, ctx);

		const levelDialog = ctx.selectCalls.find((call) => call.title.startsWith("Thinking level"));
		expect(levelDialog?.options).toEqual(["off"]);
		expect(lastEntry(h).executionConfig).toEqual({ provider: "p", id: "plain", thinkingLevel: "off" });
	});

	test("cancelling the thinking dialog keeps the previous target", async () => {
		const h = await loadExtension();
		const ctx = makeCtx({
			selects: [CONFIGURE_ACTION, "p/exec", "high", CONFIGURE_ACTION, "p/plain", undefined, STAY_ACTION],
		});
		await enterPlanMode(h, ctx);

		await runAgentEnd(h, ctx);

		expect(lastEntry(h).executionConfig).toEqual({ provider: "p", id: "exec", thinkingLevel: "high" });
	});

	test("cancelling the model dialog keeps the previous target", async () => {
		const h = await loadExtension();
		const ctx = makeCtx({ selects: [CONFIGURE_ACTION, undefined, EXECUTE_ACTION] });
		await enterPlanMode(h, ctx);
		ctx.model = planModel;

		await runAgentEnd(h, ctx);

		expect(h.events).toEqual(["setModel:p/pre-plan"]);
	});

	test("reset clears the target", async () => {
		const h = await loadExtension();
		const ctx = makeCtx({ selects: [CONFIGURE_ACTION, "p/exec", "high", CONFIGURE_ACTION, RESET_LABEL, STAY_ACTION] });
		await enterPlanMode(h, ctx);

		await runAgentEnd(h, ctx);

		expect(lastEntry(h).executionConfig).toBeUndefined();
		expect(ctx.selectCalls.at(-1)?.title).toContain("pre-plan model");
	});
});

describe("unusable targets", () => {
	test("does not execute when the configured model is gone", async () => {
		const h = await loadExtension();
		const entries = [
			{
				type: "custom",
				customType: "plan-mode",
				data: {
					enabled: true,
					todos: [],
					executing: false,
					executionConfig: { provider: "p", id: "deleted", thinkingLevel: "high" },
				},
			},
		];
		const ctx = makeCtx({ entries, selects: [EXECUTE_ACTION] });
		await runSessionStart(h, ctx, "resume");

		await runAgentEnd(h, ctx);

		expect(h.events).toEqual([]);
		expect(h.sentMessages).toEqual([]);
		expect(lastEntry(h).enabled).toBe(true);
		expect(ctx.notifications.some((n) => n.message.includes("Execution model not found"))).toBe(true);
	});

	test("does not execute when the model has no usable credentials", async () => {
		const h = await loadExtension();
		const entries = [
			{
				type: "custom",
				customType: "plan-mode",
				data: {
					enabled: true,
					todos: [],
					executing: false,
					executionConfig: { provider: "p", id: "exec", thinkingLevel: "high" },
				},
			},
		];
		// Registered but not selectable: find() resolves it, getAvailable() does not.
		const ctx = makeCtx({ entries, selects: [EXECUTE_ACTION], availableModels: [planModel, prePlanModel] });
		await runSessionStart(h, ctx, "resume");

		await runAgentEnd(h, ctx);

		expect(h.events).toEqual([]);
		expect(h.sentMessages).toEqual([]);
		expect(lastEntry(h).enabled).toBe(true);
		expect(ctx.notifications.some((n) => n.message.includes("unavailable"))).toBe(true);
	});

	test("does not execute when the saved thinking level is unsupported", async () => {
		const h = await loadExtension();
		const entries = [
			{
				type: "custom",
				customType: "plan-mode",
				data: {
					enabled: true,
					todos: [],
					executing: false,
					executionConfig: { provider: "p", id: "plain", thinkingLevel: "high" },
				},
			},
		];
		const ctx = makeCtx({ entries, selects: [EXECUTE_ACTION] });
		await runSessionStart(h, ctx, "resume");

		await runAgentEnd(h, ctx);

		expect(h.events).toEqual([]);
		expect(h.sentMessages).toEqual([]);
		expect(ctx.notifications.some((n) => n.message.includes("no longer supports thinking level"))).toBe(true);
	});

	test("stays in plan mode when the model switch fails", async () => {
		const h = await loadExtension();
		const ctx = makeCtx({ selects: [CONFIGURE_ACTION, "p/exec", "high", EXECUTE_ACTION] });
		await enterPlanMode(h, ctx);
		h.setModelResult = false;

		await runAgentEnd(h, ctx);

		expect(h.events).toEqual(["setModel:p/exec"]);
		expect(h.sentMessages).toEqual([]);
		expect(lastEntry(h).enabled).toBe(true);
	});

	test("does not execute when the review model is gone, even with a valid execution target", async () => {
		const h = await loadExtension();
		const entries = [
			{
				type: "custom",
				customType: "plan-mode",
				data: {
					enabled: true,
					todos: [],
					executing: false,
					executionConfig: { provider: "p", id: "exec", thinkingLevel: "high" },
					reviewConfig: { provider: "p", id: "deleted", thinkingLevel: "high" },
				},
			},
		];
		const ctx = makeCtx({ entries, selects: [EXECUTE_ACTION] });
		await runSessionStart(h, ctx, "resume");

		await runAgentEnd(h, ctx);

		expect(h.events).toEqual([]);
		expect(h.sentMessages).toEqual([]);
		expect(lastEntry(h).enabled).toBe(true);
		expect(ctx.notifications.some((n) => n.message.includes("Review model not found"))).toBe(true);
	});
});

describe("fresh-session execution", () => {
	async function runFreshExecute(h: Harness, ctx: Ctx) {
		const handler = h.commands.get("plan-exec-fresh");
		if (!handler) throw new Error("/plan-exec-fresh command not registered");
		await handler(undefined, ctx);
	}

	function makeFreshCtx(base: Ctx, seeded: Harness["entries"], kickoff: string[]) {
		return Object.assign(base, {
			newSession: async (options: {
				setup?: (sm: { appendCustomEntry: (type: string, data: Record<string, unknown>) => void }) => Promise<void>;
				withSession?: (freshCtx: { sendUserMessage: (content: unknown) => Promise<void> }) => Promise<void>;
			}) => {
				await options.setup?.({
					appendCustomEntry: (customType, data) => {
						seeded.push({ type: "custom", customType, data });
					},
				});
				await options.withSession?.({
					sendUserMessage: async (content) => {
						kickoff.push(String(content));
					},
				});
				return { cancelled: false };
			},
		});
	}

	test("seeds the target and applies it in the replacement session", async () => {
		const h = await loadExtension();
		const ctx = makeCtx({ selects: [CONFIGURE_ACTION, "p/exec", "high", STAY_ACTION] });
		await enterPlanMode(h, ctx);
		await runAgentEnd(h, ctx);

		const seeded: Harness["entries"] = [];
		const kickoff: string[] = [];
		await runFreshExecute(h, makeFreshCtx(ctx, seeded, kickoff));

		expect(kickoff).toHaveLength(1);
		expect(seeded.at(-1)?.data?.executionConfig).toEqual({ provider: "p", id: "exec", thinkingLevel: "high" });

		// Replacement instance: session_start runs before the kickoff is sent.
		const fresh = await loadExtension();
		const freshCtx = makeCtx({ entries: seeded });
		await runSessionStart(fresh, freshCtx, "new");

		expect(fresh.events).toEqual(["setModel:p/exec", "setThinking:high"]);
	});

	test("aborts before replacing the session when the target lacks credentials", async () => {
		const h = await loadExtension();
		const entries = [
			{
				type: "custom",
				customType: "plan-mode",
				data: {
					enabled: true,
					todos: [{ step: 1, text: "Do the first thing", completed: false }],
					executing: false,
					lastPlanFile: join(plansRoot, "memory", "agent", ".plans", "plan.md"),
					executionConfig: { provider: "p", id: "exec", thinkingLevel: "high" },
				},
			},
		];
		const ctx = makeCtx({ entries, availableModels: [planModel, prePlanModel] });
		await runSessionStart(h, ctx, "resume");

		const seeded: Harness["entries"] = [];
		const kickoff: string[] = [];
		await runFreshExecute(h, makeFreshCtx(ctx, seeded, kickoff));

		expect(seeded).toEqual([]);
		expect(kickoff).toEqual([]);
		expect(ctx.notifications.some((n) => n.message.includes("unavailable"))).toBe(true);
	});

	test("aborts before replacing the session when the target is unusable", async () => {
		const h = await loadExtension();
		const entries = [
			{
				type: "custom",
				customType: "plan-mode",
				data: {
					enabled: true,
					todos: [{ step: 1, text: "Do the first thing", completed: false }],
					executing: false,
					lastPlanFile: join(plansRoot, "memory", "agent", ".plans", "plan.md"),
					executionConfig: { provider: "p", id: "deleted", thinkingLevel: "high" },
				},
			},
		];
		const ctx = makeCtx({ entries });
		await runSessionStart(h, ctx, "resume");

		const seeded: Harness["entries"] = [];
		const kickoff: string[] = [];
		await runFreshExecute(h, makeFreshCtx(ctx, seeded, kickoff));

		expect(seeded).toEqual([]);
		expect(kickoff).toEqual([]);
		expect(ctx.notifications.some((n) => n.message.includes("Execution model not found"))).toBe(true);
	});

	test("does not re-apply the target when the executing session is resumed", async () => {
		const h = await loadExtension();
		const entries = [
			{
				type: "custom",
				customType: "plan-mode",
				data: {
					enabled: false,
					todos: [{ step: 1, text: "Do the first thing", completed: false }],
					executing: true,
					executionConfig: { provider: "p", id: "exec", thinkingLevel: "high" },
				},
			},
		];
		const ctx = makeCtx({ entries });
		await runSessionStart(h, ctx, "resume");

		expect(h.events).toEqual([]);
	});

	test("seeds the review target and includes it in both kickoffs", async () => {
		const h = await loadExtension();
		const ctx = makeCtx({ selects: [CONFIGURE_REVIEW_ACTION, "p/exec", "high", STAY_ACTION] });
		await enterPlanMode(h, ctx);
		await runAgentEnd(h, ctx);

		const seeded: Harness["entries"] = [];
		const kickoff: string[] = [];
		await runFreshExecute(h, makeFreshCtx(ctx, seeded, kickoff));

		expect(kickoff).toHaveLength(1);
		expect(kickoff[0]).toContain(REVIEW_LINE);
		expect(seeded.at(-1)?.data?.reviewConfig).toEqual({ provider: "p", id: "exec", thinkingLevel: "high" });

		const fresh = await loadExtension();
		const freshCtx = makeCtx({ entries: seeded });
		await runSessionStart(fresh, freshCtx, "new");

		expect(fresh.events).toEqual([]);
		const context = await runBeforeAgentStart(fresh);
		expect(context?.message?.customType).toBe("plan-execution-context");
		expect(context?.message?.content).toContain(REVIEW_LINE);
	});

	test("aborts before replacing the session when the review target is unusable", async () => {
		const h = await loadExtension();
		const entries = [
			{
				type: "custom",
				customType: "plan-mode",
				data: {
					enabled: true,
					todos: [{ step: 1, text: "Do the first thing", completed: false }],
					executing: false,
					lastPlanFile: join(plansRoot, "memory", "agent", ".plans", "plan.md"),
					reviewConfig: { provider: "p", id: "deleted", thinkingLevel: "high" },
				},
			},
		];
		const ctx = makeCtx({ entries });
		await runSessionStart(h, ctx, "resume");

		const seeded: Harness["entries"] = [];
		const kickoff: string[] = [];
		await runFreshExecute(h, makeFreshCtx(ctx, seeded, kickoff));

		expect(seeded).toEqual([]);
		expect(kickoff).toEqual([]);
		expect(ctx.notifications.some((n) => n.message.includes("Review model not found"))).toBe(true);
	});
});

describe("review target", () => {
	test("configures and persists without switching models", async () => {
		const h = await loadExtension();
		const ctx = makeCtx({ selects: [CONFIGURE_REVIEW_ACTION, "p/exec", "high", STAY_ACTION] });
		await enterPlanMode(h, ctx);

		await runAgentEnd(h, ctx);

		expect(h.events).toEqual([]);
		expect(lastEntry(h).reviewConfig).toEqual({ provider: "p", id: "exec", thinkingLevel: "high" });
		expect(lastEntry(h).executionConfig).toBeUndefined();
		expect(ctx.selectCalls.at(-1)?.title).toContain("review with p/exec @ high");
	});

	test("reset clears the review target", async () => {
		const h = await loadExtension();
		const ctx = makeCtx({
			selects: [CONFIGURE_REVIEW_ACTION, "p/exec", "high", CONFIGURE_REVIEW_ACTION, REVIEW_RESET_LABEL, STAY_ACTION],
		});
		await enterPlanMode(h, ctx);

		await runAgentEnd(h, ctx);

		expect(lastEntry(h).reviewConfig).toBeUndefined();
		expect(ctx.selectCalls.at(-1)?.title).toContain("review with agent defaults");
	});

	test("cancelling the thinking dialog keeps the previous review target", async () => {
		const h = await loadExtension();
		const ctx = makeCtx({
			selects: [CONFIGURE_REVIEW_ACTION, "p/exec", "high", CONFIGURE_REVIEW_ACTION, "p/plain", undefined, STAY_ACTION],
		});
		await enterPlanMode(h, ctx);

		await runAgentEnd(h, ctx);

		expect(lastEntry(h).reviewConfig).toEqual({ provider: "p", id: "exec", thinkingLevel: "high" });
	});

	test("cancelling the model dialog keeps the previous review target", async () => {
		const h = await loadExtension();
		const ctx = makeCtx({ selects: [CONFIGURE_REVIEW_ACTION, "p/exec", "high", CONFIGURE_REVIEW_ACTION, undefined, STAY_ACTION] });
		await enterPlanMode(h, ctx);

		await runAgentEnd(h, ctx);

		expect(lastEntry(h).reviewConfig).toEqual({ provider: "p", id: "exec", thinkingLevel: "high" });
	});

	test("clears the review target when plan mode is toggled off", async () => {
		const h = await loadExtension();
		const ctx = makeCtx({ selects: [CONFIGURE_REVIEW_ACTION, "p/exec", "high", STAY_ACTION] });
		await enterPlanMode(h, ctx);
		await runAgentEnd(h, ctx);
		expect(lastEntry(h).reviewConfig).toEqual({ provider: "p", id: "exec", thinkingLevel: "high" });

		await enterPlanMode(h, ctx);

		expect(lastEntry(h).reviewConfig).toBeUndefined();
	});

	test("includes the review line in the execute kickoff and the running context", async () => {
		const h = await loadExtension();
		const ctx = makeCtx({ selects: [CONFIGURE_REVIEW_ACTION, "p/exec", "high", EXECUTE_ACTION] });
		await enterPlanMode(h, ctx);
		ctx.model = planModel;

		await runAgentEnd(h, ctx);

		expect(h.sentMessages.at(-1)?.content).toContain(REVIEW_LINE);
		const context = await runBeforeAgentStart(h);
		expect(context?.message?.customType).toBe("plan-execution-context");
		expect(context?.message?.content).toContain(REVIEW_LINE);
	});

	test("omits the review line when no review target is configured", async () => {
		const h = await loadExtension();
		const ctx = makeCtx({ selects: [EXECUTE_ACTION] });
		await enterPlanMode(h, ctx);
		ctx.model = planModel;

		await runAgentEnd(h, ctx);

		expect(h.sentMessages.at(-1)?.content).not.toContain("Review model:");
		const context = await runBeforeAgentStart(h);
		expect(context?.message?.content).not.toContain("Review model:");
	});
});

describe("model picker ordering", () => {
	test("lists scoped models first, deduped, skipping unavailable ones", async () => {
		const h = await loadExtension();
		const ctx = makeCtx({
			selects: [CONFIGURE_ACTION, undefined, STAY_ACTION],
			// execModel is scoped but not available (no credentials): it must not be offered.
			availableModels: [planModel, prePlanModel, noThinkingModel],
			scopedModels: [
				{ model: noThinkingModel },
				{ model: execModel },
				{ model: noThinkingModel },
				{ model: { provider: "q", id: "ghost" } },
			],
		});
		await enterPlanMode(h, ctx);

		await runAgentEnd(h, ctx);

		expect(ctx.selectCalls[1]?.options).toEqual([RESET_LABEL, "p/plain", "p/planner", "p/pre-plan"]);
	});

	test("uses the same ordering for the review picker", async () => {
		const h = await loadExtension();
		const ctx = makeCtx({
			selects: [CONFIGURE_REVIEW_ACTION, undefined, STAY_ACTION],
			scopedModels: [{ model: execModel }],
		});
		await enterPlanMode(h, ctx);

		await runAgentEnd(h, ctx);

		expect(ctx.selectCalls[1]?.options).toEqual([
			REVIEW_RESET_LABEL,
			"p/exec",
			"p/planner",
			"p/pre-plan",
			"p/plain",
		]);
	});
});
