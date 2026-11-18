import { describe, expect, mock, test } from "bun:test";

interface FakeModel { provider: string; id: string; name: string; levels: string[] }
interface RpcReply { success?: boolean; data?: { text?: string; details?: Record<string, unknown> }; error?: { code?: string; message?: string } }
mock.module("typebox", () => ({ Type: new Proxy({}, { get: (_target, key) => (...args: unknown[]) => ({ key, args }) }) }));
mock.module("@earendil-works/pi-ai", () => ({ getSupportedThinkingLevels: (model: FakeModel) => model.levels }));

interface FakeContext {
	cwd: string;
	hasUI: boolean;
	mode: "tui";
	scopedModels: { model: FakeModel }[];
	modelRegistry: { getAvailable(): FakeModel[] };
	sessionManager: { getSessionId(): string; getEntries(): FakeEntry[] };
	ui: {
		select(title: string, options: string[]): Promise<string | undefined>;
		notify(message: string, type?: string): void;
		setStatus(name: string, value: string | undefined): void;
		theme: { fg(color: string, text: string): string };
	};
}
interface FakeEntry { type: string; customType?: string; data?: Record<string, unknown> }
interface FakeRequest { version: 1; requestId: string; method: string; params: Record<string, unknown> }
interface RuntimeRegistration { version: 1; name: string; definition: Record<string, unknown>; result?: unknown }
interface FakeTool { name: string; exposure?: string; defaultActive?: boolean; execute(...args: unknown[]): Promise<FakeToolResult> }
interface FakeToolResult { content: { type: string; text: string }[]; details?: Record<string, unknown> }
type EventHandler = (value: unknown) => void;
type ExtensionHandler = (event: unknown, ctx: FakeContext) => unknown;
interface Harness {
	pi: Record<string, unknown>;
	ctx: FakeContext;
	handlers: Map<string, ExtensionHandler[]>;
	commands: Map<string, (args: string | undefined, ctx: FakeContext) => unknown>;
	tools: Map<string, FakeTool>;
	entries: FakeEntry[];
	requests: FakeRequest[];
	runtimeDefinition?: Record<string, unknown>;
	activeTools(): string[];
	originalTools: string[];
	setModels(models: FakeModel[]): void;
	setScope(models: FakeModel[]): void;
	setSelect(handler: FakeContext["ui"]["select"]): void;
	setStatusReply(reply: RpcReply): void;
	setControlReply(reply: RpcReply): void;
	setSpawnReply(reply: RpcReply | "transport-error"): void;
	setOwner(owner: string): void;
	emitProcessTerminal(runId: string): void;
}

const speedModel: FakeModel = { provider: "instacart-openai", id: "gpt-6-luna", name: "GPT-6 Luna", levels: ["low"] };
const qualityModel: FakeModel = { provider: "p", id: "quality", name: "Quality Model", levels: ["low", "high"] };
const baseTools = ["read", "bash", "edit", "write", "codemode", "tool_search"];
const registeredTools = [...baseTools, "grep", "find", "ls", "subagent_supervisor"];

function makeHarness(): Harness {
	const listeners = new Map<string, EventHandler[]>();
	const requests: FakeRequest[] = [];
	const entries: FakeEntry[] = [];
	const handlers = new Map<string, ExtensionHandler[]>();
	const commands = new Map<string, (args: string | undefined, ctx: FakeContext) => unknown>();
	const tools = new Map<string, FakeTool>();
	let runtimeDefinition: Record<string, unknown> | undefined;
	let models = [speedModel, qualityModel];
	let owner = "owner-1";
	let spawnReply: RpcReply | "transport-error" = {
		success: true,
		data: { text: "Spawn accepted", details: { runId: "run-1", asyncId: "run-1", toolCallId: "rpc-spawn-request" } },
	};
	let statusReply: RpcReply = { success: true, data: { text: "State: running", details: { runId: "run-1" } } };
	let controlReply: RpcReply = { success: true, data: { text: "Accepted", details: { runId: "run-1", asyncId: "run-1" } } };
	let active = [...baseTools];
	const originalTools = [...active];
	const events = {
		on(channel: string, handler: EventHandler): () => void {
			listeners.set(channel, [...(listeners.get(channel) ?? []), handler]);
			return () => listeners.set(channel, (listeners.get(channel) ?? []).filter((item) => item !== handler));
		},
		emit(channel: string, value: unknown): void {
			if (channel === "pi-subagents:runtime-agent-register:v1") {
				const request = value as RuntimeRegistration;
				runtimeDefinition = request.definition;
				request.result = { ok: true, registration: { dispose() {} } };
				return;
			}
			if (channel === "subagent:process-terminal") {
				listeners.get(channel)?.forEach((handler) => handler(value));
				return;
			}
			if (channel !== "subagents:rpc:v1:request") return;
			const request = value as FakeRequest;
			requests.push(request);
			const replyChannel = `subagents:rpc:v1:reply:${request.requestId}`;
			const reply = request.method === "spawn" ? spawnReply : request.method === "status" ? statusReply : controlReply;
			if (reply === "transport-error") throw new Error("transport failure");
			queueMicrotask(() => listeners.get(replyChannel)?.forEach((handler) => handler({ ...reply, version: 1, requestId: request.requestId })));
		},
	};
	const ctx: FakeContext = {
		cwd: "/tmp/project",
		hasUI: true,
		mode: "tui",
		scopedModels: [],
		modelRegistry: { getAvailable: () => models },
		sessionManager: { getSessionId: () => owner, getEntries: () => entries },
		ui: {
			select: async (_title, options) => options.find((option) => option.startsWith("Quality —")),
			notify: () => undefined,
			setStatus: () => undefined,
			theme: { fg: (_color, text) => text },
		},
	};
	const pi = {
		events,
		registerTool(tool: FakeTool) { tools.set(tool.name, tool); },
		registerCommand(name: string, definition: { handler(args: string | undefined, ctx: FakeContext): unknown }) {
			commands.set(name, definition.handler);
		},
		registerShortcut() {},
		registerFlag() {},
		getFlag() { return undefined; },
		getActiveTools() { return [...active]; },
		setActiveTools(names: string[]) { active = [...names]; },
		getAllTools() { return [...new Set([...registeredTools, ...tools.keys()])].map((name) => ({ name })); },
		appendEntry(customType: string, data: Record<string, unknown>) { entries.push({ type: "custom", customType, data }); },
		on(name: string, handler: ExtensionHandler) {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
			return () => undefined;
		},
	};
	return {
		pi,
		ctx,
		handlers,
		commands,
		tools,
		entries,
		requests,
		get runtimeDefinition() { return runtimeDefinition; },
		activeTools: () => active,
		originalTools,
		setModels: (next) => { models = next; },
		setScope: (next) => { ctx.scopedModels = next.map((model) => ({ model })); },
		setSelect: (handler) => { ctx.ui.select = handler; },
		setStatusReply: (reply) => { statusReply = reply; },
		setControlReply: (reply) => { controlReply = reply; },
		setSpawnReply: (reply) => { spawnReply = reply; },
		setOwner: (next) => { owner = next; },
		emitProcessTerminal: (runId) => listeners.get("subagent:process-terminal")?.forEach((handler) => handler({ runId })),
	};
}

async function setup(h = makeHarness()): Promise<Harness> {
	const extension = (await import("../extensions/conductor-mode/index.ts")).default;
	extension(h.pi as never);
	await h.handlers.get("session_start")?.[0]?.({}, h.ctx);
	await h.commands.get("conductor")?.(undefined, h.ctx);
	return h;
}

function worker(h: Harness): FakeTool {
	const tool = h.tools.get("conductor_worker");
	if (!tool) throw new Error("conductor_worker was not registered");
	return tool;
}

async function execute(h: Harness, params: Record<string, unknown>): Promise<FakeToolResult> {
	return worker(h).execute("tool-call", params, undefined, undefined, h.ctx);
}

function nativeStatus(
	state: string,
	runId: string,
	proof?: { state: string; runId: string; resumeDisposition?: "resumable" | "non-resumable" | "unavailable" },
): RpcReply {
	return {
		success: true,
		data: {
			text: `State: ${state}`,
			details: { runId, ...(proof ? { lifecycleStatus: { processTerminal: proof } } : {}) },
		},
	};
}

describe("conductor-mode", () => {
	test("registers an inactive model-only wrapper, keeps normal tools active, and inherits worker policy", async () => {
		const h = makeHarness();
		const extension = (await import("../extensions/conductor-mode/index.ts")).default;
		extension(h.pi as never);
		const registered = worker(h);
		expect(registered.defaultActive).toBe(false);
		expect(registered.exposure).toBe("model-only");
		await h.handlers.get("session_start")?.[0]?.({}, h.ctx);
		await h.commands.get("conductor")?.(undefined, h.ctx);
		expect(h.activeTools()).toEqual([...baseTools, "conductor_worker"]);
		expect(h.runtimeDefinition).toMatchObject({
			inheritProjectContext: true,
			inheritGlobalContext: true,
			allowNestedSubagents: false,
			defaultAcceptance: { level: "none", reason: "Director verifies evidence" },
		});
		expect(h.runtimeDefinition?.systemPrompt).toContain("Unless the task brief explicitly directs otherwise, do not commit, push, create or switch branches");
	});

	test("removes only the Conductor tool on exit", async () => {
		const h = await setup();
		expect(h.activeTools()).toEqual([...baseTools, "conductor_worker"]);
		await h.commands.get("conductor")?.(undefined, h.ctx);
		expect(h.activeTools()).toEqual(h.originalTools);
	});

	test("preserves tools activated mid-session across the next agent turn", async () => {
		const h = await setup();
		(h.pi.setActiveTools as (names: string[]) => void)([...h.activeTools(), "subagent_supervisor"]);
		const event = { systemPromptOptions: { sections: {} as Record<string, string> } };
		await h.handlers.get("before_agent_start")?.[0]?.(event, h.ctx);
		expect(h.activeTools()).toContain("subagent_supervisor");
		expect(h.activeTools()).toContain("conductor_worker");
		await h.commands.get("conductor")?.(undefined, h.ctx);
		expect(h.activeTools()).toContain("subagent_supervisor");
		expect(h.activeTools()).not.toContain("conductor_worker");
	});

	test("refuses Conductor activation while same-session plan mode or execution is persisted", async () => {
		for (const planState of [{ enabled: true }, { executing: true }]) {
			const h = makeHarness();
			h.entries.push({ type: "custom", customType: "plan-mode", data: planState });
			const extension = (await import("../extensions/conductor-mode/index.ts")).default;
			extension(h.pi as never);
			await h.handlers.get("session_start")?.[0]?.({}, h.ctx);
			await h.commands.get("conductor")?.(undefined, h.ctx);
			expect(h.activeTools()).toEqual(h.originalTools);
			expect(h.entries.filter((entry) => entry.customType === "conductor-mode")).toHaveLength(0);
		}
	});

	test("does not append conductor entries in unused sessions", async () => {
		const h = makeHarness();
		const extension = (await import("../extensions/conductor-mode/index.ts")).default;
		extension(h.pi as never);
		await h.handlers.get("session_start")?.[0]?.({}, h.ctx);
		expect(h.entries.filter((entry) => entry.customType === "conductor-mode")).toHaveLength(0);
	});

	test("starts Speed with the exact selector and no route dialog", async () => {
		const h = await setup();
		h.setSelect(async () => { throw new Error("Speed must not open a route dialog"); });
		const result = await execute(h, { action: "start", task: "Fix the focused bug", priority: "Speed" });
		const request = h.requests.find((item) => item.method === "spawn");
		expect(result.content[0]?.text).toContain("Spawn accepted");
		expect(request?.params).toMatchObject({
			model: "instacart-openai/gpt-6-luna:low",
			task: "Fix the focused bug",
			cwd: "/tmp/project",
			worktree: false,
			async: true,
			context: "fresh",
		});
	});

	test("Quality launches only the exact approved selector with the complete task", async () => {
		const h = await setup();
		const result = await execute(h, {
			action: "start",
			task: "Replace the public endpoint carefully",
			priority: "Quality",
			model: "p/quality:high",
			rationale: "The API boundary is uncertain",
		});
		const request = h.requests.find((item) => item.method === "spawn");
		expect(result.content[0]?.text).toContain("Spawn accepted");
		expect(request?.params).toMatchObject({
			model: "p/quality:high",
			task: "Replace the public endpoint carefully",
			cwd: "/tmp/project",
			worktree: false,
			async: true,
			context: "fresh",
		});
	});

	test("reserves Quality route in memory before confirmation and starts nothing on Cancel", async () => {
		const h = await setup();
		let resolveChoice: ((choice: string) => void) | undefined;
		h.setSelect(() => new Promise((resolve) => { resolveChoice = resolve; }));
		const pending = execute(h, {
			action: "start",
			task: "Needs a deliberate route",
			priority: "Quality",
			model: "p/quality:high",
			rationale: "Uncertain API contract",
		});
		await Promise.resolve();
		expect(h.requests.some((item) => item.method === "spawn")).toBe(false);
		const duplicate = await execute(h, { action: "start", task: "Duplicate", priority: "Speed" });
		expect(duplicate.content[0]?.text).toContain("already unresolved");
		expect(h.entries.at(-1)?.data?.run).toBeUndefined();
		resolveChoice?.("Cancel");
		expect((await pending).content[0]?.text).toContain("Cancelled");
		expect(h.requests.some((item) => item.method === "spawn")).toBe(false);
	});

	test("Quality confirmation shows exact scoped selector, rationale, and viable route labels", async () => {
		const h = await setup();
		h.setScope([qualityModel]);
		h.setSelect(async (title, options) => {
			expect(title).toContain("The API boundary is uncertain");
			expect(title).toContain("choose Speed");
			expect(options).toEqual(["Speed — instacart-openai/gpt-6-luna:low", "Quality — p/quality:high", "Cancel"]);
			return "Quality — p/quality:high";
		});
		await execute(h, {
			action: "start",
			task: "Use the proposed model",
			priority: "Quality",
			model: "p/quality:high",
			rationale: "The API boundary is uncertain",
		});
	});

	test("stale Quality model after dialog starts nothing", async () => {
		const h = await setup();
		h.setSelect(async (_title, options) => {
			h.setModels([]);
			return options.find((option) => option.startsWith("Quality —"));
		});
		const result = await execute(h, {
			action: "start",
			task: "Use the selected interface",
			priority: "Quality",
			model: "p/quality:high",
			rationale: "Interface is risky",
		});
		expect(result.content[0]?.text).toContain("approved target is unavailable");
		expect(h.requests.some((item) => item.method === "spawn")).toBe(false);
	});

	test("model catalog search is scoped-first and searches before the display cap", async () => {
		const h = await setup();
		const extra = Array.from({ length: 70 }, (_, index): FakeModel => ({
			provider: "p",
			id: `model-${index}`,
			name: `Model ${index}`,
			levels: ["low", "high"],
		}));
		h.setModels([...extra, speedModel, qualityModel]);
		h.setScope([qualityModel]);
		const first = await execute(h, { action: "models" });
		expect(first.content[0]?.text.split("\n")[0]).toContain("p/quality [low, high] (scoped)");
		const late = await execute(h, { action: "models", query: "p/model-69" });
		expect(late.content[0]?.text).toContain("p/model-69 [low, high]");
		const exact = await execute(h, {
			action: "start",
			task: "Use late model",
			priority: "Quality",
			model: "p/model-69:high",
			rationale: "Specific model is needed",
		});
		expect(exact.content[0]?.text).toContain("Spawn accepted");
	});

	test("refuses unsupported thinking and unavailable Speed with an explanation", async () => {
		const h = await setup();
		const unsupported = await execute(h, {
			action: "start",
			task: "Try unsupported level",
			priority: "Quality",
			model: "p/quality:xhigh",
			rationale: "Model wants an unsupported level",
		});
		expect(unsupported.content[0]?.text).toContain("exact available");
		h.setModels([qualityModel]);
		h.setSelect(async (title, options) => {
			expect(options).not.toContain("Speed — instacart-openai/gpt-6-luna:low");
			expect(title).not.toContain("choose Speed");
			expect(title).toContain("not in the available model catalog");
			return "Cancel";
		});
		const noSpeed = await execute(h, {
			action: "start",
			task: "Quality without Speed",
			priority: "Quality",
			model: "p/quality:high",
			rationale: "Luna unavailable",
		});
		expect(noSpeed.content[0]?.text).toContain("Cancelled");
		const speed = await execute(h, { action: "start", task: "Unavailable Speed", priority: "Speed" });
		expect(speed.content[0]?.text).toContain("unavailable");
		expect(h.requests.some((item) => item.method === "spawn")).toBe(false);
	});

	test("stop acknowledgement does not release the slot", async () => {
		const h = await setup();
		await execute(h, { action: "start", task: "Implement", priority: "Speed" });
		const stopped = await execute(h, { action: "stop" });
		expect(stopped.content[0]?.text).toContain("slot remains reserved");
		h.setStatusReply(nativeStatus("stopping", "run-1", { state: "pending", runId: "run-1" }));
		expect((await execute(h, { action: "status" })).content[0]?.text).toContain("remains unresolved");
		h.setStatusReply(nativeStatus("stopped", "run-1", { state: "observed", runId: "run-1", resumeDisposition: "non-resumable" }));
		expect((await execute(h, { action: "status" })).content[0]?.text).toContain("slot released");
	});

	test("a runner failure with native not-started proof releases the slot", async () => {
		const h = await setup();
		h.setSpawnReply({ success: false, error: { code: "execution_failed", message: "runner did not start" } });
		h.setStatusReply(nativeStatus("failed", "run-1", { state: "not-started", runId: "run-1" }));
		const failure = await execute(h, { action: "start", task: "Start failed", priority: "Speed" });
		expect(failure.content[0]?.text).toContain("slot released");
		expect(h.entries.at(-1)?.data?.run).toBeUndefined();
	});

	test("received native pre-admission rejection releases its reservation", async () => {
		const h = await setup();
		h.setSpawnReply({ success: false, error: { code: "invalid_params", message: "invalid model selector" } });
		const result = await execute(h, { action: "start", task: "Rejected before admission", priority: "Speed" });
		expect(result.content[0]?.text).toContain("definitively rejected");
		expect(h.entries.at(-1)?.data?.run).toBeUndefined();
		expect(h.requests.some((item) => item.method === "status")).toBe(false);
	});

	test("definitive resume rejection restores the retained run", async () => {
		const h = await setup();
		await execute(h, { action: "start", task: "Initial", priority: "Speed" });
		h.setStatusReply(nativeStatus("failed", "run-1", { state: "observed", runId: "run-1", resumeDisposition: "resumable" }));
		await execute(h, { action: "status" });
		h.setControlReply({ success: false, error: { code: "invalid_params", message: "invalid resume request" } });
		const result = await execute(h, { action: "resume", message: "Continue" });
		expect(result.content[0]?.text).toContain("definitively rejected");
		expect(h.entries.at(-1)?.data?.run).toBeUndefined();
		expect(h.entries.at(-1)?.data?.retained).toMatchObject({ runId: "run-1", lifecycleState: "failed" });
	});

	test("native executor failure without independent no-start evidence remains ambiguous", async () => {
		const h = await setup();
		h.setSpawnReply({ success: false, error: { code: "execution_failed", message: "executor failed" } });
		h.setStatusReply({ success: false, error: { code: "not_found", message: "no status artifact" } });
		const failure = await execute(h, { action: "start", task: "Executor failure", priority: "Speed" });
		expect(failure.content[0]?.text).toContain("no retry was made");
		expect(h.entries.at(-1)?.data?.run).toMatchObject({ status: "unknown" });
		expect(h.requests.filter((item) => item.method === "spawn")).toHaveLength(1);
	});

	test("transport failure and missing status do not release the reserved slot", async () => {
		const h = await setup();
		h.setSpawnReply("transport-error");
		h.setStatusReply({ success: false, error: { code: "not_found", message: "no status artifact" } });
		const failure = await execute(h, { action: "start", task: "Potentially launched", priority: "Speed" });
		expect(failure.content[0]?.text).toContain("no retry was made");
		expect(h.entries.at(-1)?.data?.run).toMatchObject({ status: "unknown" });
		expect(h.requests.find((item) => item.method === "status")?.params.id).toContain("rpc-spawn-");
	});

	test("terminal status requires matching proof, and retains exact run for follow-up", async () => {
		const h = await setup();
		await execute(h, { action: "start", task: "Finish safely", priority: "Speed" });
		h.setStatusReply(nativeStatus("completed", "run-1", { state: "observed", runId: "different-run" }));
		expect((await execute(h, { action: "status" })).content[0]?.text).toContain("remains unresolved");
		h.setStatusReply(nativeStatus("completed", "run-1", { state: "observed", runId: "run-1", resumeDisposition: "resumable" }));
		expect((await execute(h, { action: "status" })).content[0]?.text).toContain("slot released");
		expect(h.entries.at(-1)?.data?.retained).toMatchObject({
			runId: "run-1",
			target: { provider: "instacart-openai", id: "gpt-6-luna" },
		});
	});

	test("resume after terminal uses a new request and tracks the new exact run", async () => {
		const h = await setup();
		await execute(h, { action: "start", task: "Initial", priority: "Speed" });
		h.setStatusReply(nativeStatus("completed", "run-1", { state: "observed", runId: "run-1", resumeDisposition: "resumable" }));
		await execute(h, { action: "status" });
		h.setControlReply({ success: true, data: { text: "State: running", details: { runId: "run-2", asyncId: "run-2" } } });
		h.setStatusReply(nativeStatus("running", "run-2"));
		const result = await execute(h, { action: "resume", message: "Continue the same task" });
		const resume = h.requests.find((item) => item.method === "resume");
		expect(result.content[0]?.text).toContain("State: running");
		expect(resume?.params.id).toBe("run-1");
		expect(resume?.requestId).not.toBe(h.requests.find((item) => item.method === "spawn")?.requestId);
		expect(h.entries.at(-1)?.data?.run).toMatchObject({
			runId: "run-2",
			target: { provider: "instacart-openai", id: "gpt-6-luna" },
		});
	});

	test("ambiguous resume cannot reconcile the old run or dispatch another resume", async () => {
		const h = await setup();
		await execute(h, { action: "start", task: "Initial", priority: "Speed" });
		h.setStatusReply(nativeStatus("failed", "run-1", { state: "observed", runId: "run-1", resumeDisposition: "resumable" }));
		await execute(h, { action: "status" });
		h.setControlReply({ success: false, error: { code: "execution_failed", message: "resume result uncertain" } });
		const statusCount = h.requests.filter((item) => item.method === "status").length;
		const result = await execute(h, { action: "resume", message: "Retry context" });
		expect(result.content[0]?.text).toContain("old run will not be used");
		expect(h.requests.filter((item) => item.method === "resume")).toHaveLength(1);
		expect(h.requests.filter((item) => item.method === "status")).toHaveLength(statusCount);
	});

	test("restores unresolved ownership without disabling Conductor or auto-dispatching", async () => {
		const h = makeHarness();
		h.entries.push({
			type: "custom",
			customType: "conductor-mode",
			data: {
				enabled: true,
				owner: "owner-1",
				run: {
					operation: "spawn",
					requestId: "ambiguous",
					runId: "run-1",
					target: { provider: "instacart-openai", id: "gpt-6-luna", thinkingLevel: "low" },
					status: "unknown",
				},
			},
		});
		const extension = (await import("../extensions/conductor-mode/index.ts")).default;
		extension(h.pi as never);
		await h.handlers.get("session_start")?.[0]?.({}, h.ctx);
		expect(h.activeTools()).toContain("conductor_worker");
		expect(h.activeTools()).toContain("edit");
		expect(h.requests.some((item) => item.method === "spawn")).toBe(false);
		expect((await execute(h, { action: "status" })).content[0]?.text).toContain("remains unresolved");
	});

	test("restores same-session ownership, repairs stale pending state, and does not inherit a fork", async () => {
		const h = makeHarness();
		h.entries.push({
			type: "custom",
			customType: "conductor-mode",
			data: {
				enabled: true,
				owner: "owner-1",
				run: {
					operation: "spawn",
					requestId: "old",
					target: { provider: "instacart-openai", id: "gpt-6-luna", thinkingLevel: "low" },
					status: "pending",
				},
			},
		});
		const extension = (await import("../extensions/conductor-mode/index.ts")).default;
		extension(h.pi as never);
		await h.handlers.get("session_start")?.[0]?.({}, h.ctx);
		expect(h.entries.at(-1)?.data?.run).toBeUndefined();
		expect(h.requests.some((item) => item.method === "spawn")).toBe(false);
		h.setOwner("fork-session");
		await h.handlers.get("session_start")?.[0]?.({}, h.ctx);
		expect((await execute(h, { action: "status" })).content[0]?.text).toContain("No active or retained worker");
		expect(h.requests.some((item) => item.method === "spawn")).toBe(false);
	});

	test("unresolved ownership refuses Conductor exit and session switch, fork, and tree changes", async () => {
		const h = await setup();
		await execute(h, { action: "start", task: "Still running", priority: "Speed" });
		await h.commands.get("conductor")?.(undefined, h.ctx);
		expect(h.activeTools()).toContain("conductor_worker");
		for (const name of ["session_before_switch", "session_before_fork", "session_before_tree"]) {
			const result = await h.handlers.get(name)?.[0]?.({}, h.ctx);
			expect(result).toMatchObject({ cancel: true });
		}
	});

	test("process-terminal event reconciles a matching late completion", async () => {
		const h = await setup();
		await execute(h, { action: "start", task: "Quick worker", priority: "Speed" });
		h.setStatusReply(nativeStatus("completed", "run-1", { state: "observed", runId: "run-1" }));
		h.emitProcessTerminal("run-1");
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(h.entries.at(-1)?.data?.run).toBeUndefined();
	});

	test("blocks only nested coordination calls", async () => {
		const h = await setup();
		const invoke = h.handlers.get("tool_call")?.[0];
		expect(await invoke?.({ toolName: "subagent_supervisor" }, h.ctx)).toBeUndefined();
		expect(await invoke?.({ toolName: "subagent_supervisor", parentToolCallId: "outer/1" }, h.ctx)).toMatchObject({ block: true });
		expect(await invoke?.({ toolName: "bash" }, h.ctx)).toBeUndefined();
	});

	test("injects director guidance as an active prompt section and removes it on toggle off", async () => {
		const h = await setup();
		const handler = h.handlers.get("before_agent_start")?.[0];
		const event = { systemPromptOptions: { sections: {} as Record<string, string> } };
		await handler?.(event, h.ctx);
		expect(event.systemPromptOptions.sections["conductor-director"]).toContain("reply to an exact pending ask");
		expect(event.systemPromptOptions.sections["conductor-director"]).toContain("git (branch/commit/push)");
		expect(event.systemPromptOptions.sections["conductor-director"]).not.toContain("All other tool calls are blocked");
		expect(event.systemPromptOptions.sections["conductor-director"]).toContain("conductor_worker action=start with priority=Quality");
		expect(event.systemPromptOptions.sections["conductor-director"]).toContain("native pre-launch confirmation");
		expect(event.systemPromptOptions.sections["conductor-director"]).toContain("Do not ask for a separate chat confirmation");
		expect(event.systemPromptOptions.sections["conductor-director"]).toContain("subagent_supervisor");
		await h.commands.get("conductor")?.(undefined, h.ctx);
		await handler?.(event, h.ctx);
		expect(event.systemPromptOptions.sections["conductor-director"]).toBeUndefined();
	});

	test("allows normal and dynamically exposed tools while blocking nested coordination", async () => {
		const h = await setup();
		const invoke = h.handlers.get("tool_call")?.[0];
		expect(await invoke?.({ toolName: "bash", parentToolCallId: "outer/1" }, h.ctx)).toBeUndefined();
		expect(await invoke?.({ toolName: "codemode" }, h.ctx)).toBeUndefined();
		expect(await invoke?.({ toolName: "tool_search" }, h.ctx)).toBeUndefined();
		expect(await invoke?.({ toolName: "conductor_worker", parentToolCallId: "outer/1" }, h.ctx)).toMatchObject({ block: true });
		expect(h.handlers.has("user_bash")).toBe(false);
	});
});
