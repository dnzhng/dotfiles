import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	control,
	eligibleForResume,
	hasTerminalProof,
	launch,
	registerWorker,
	rpc,
	RpcError,
	status,
	terminalState,
	type NativeState,
	type RunRef,
} from "./native.ts";
import { modelCatalog, parseTarget, targetAvailabilityReason, SPEED_TARGET, type WorkerTarget } from "./models.ts";

const COORDINATION_TOOLS = ["subagent_supervisor"] as const;
const RPC_ERROR_NO_ADMISSION = new Set(["invalid_request", "invalid_params", "no_active_session"]);
const DIRECTOR_PROMPT = [
	"[CONDUCTOR MODE — DIRECTOR]",
	"",
	"Role: route implementation through the worker by default; you may run commands, git (branch/commit/push), edits, and subagents yourself when appropriate. Avoid branch switches or checkout mutations while a worker is running in the same checkout.",
	"Assess the actual task's worker fit before routing and honor an explicit user priority.",
	"For a routine, well-scoped edit or focused check, Speed uses instacart-openai/gpt-6-luna:low.",
	"Start Speed without another route dialog when it clearly fits.",
	"For Quality, state a task-specific rationale and use conductor_worker action=start with priority=Quality; that opens the native pre-launch confirmation. Do not ask for a separate chat confirmation.",
	"Offer Speed only when available.",
	"Cancel starts nothing. There is no classifier call.",
	"",
	"Give the worker the complete self-contained brief and required project context. The brief may explicitly authorize git/worktree actions for the worker.",
	"Use subagent_supervisor only for coordination: inspect status/pending/list and reply to an exact pending ask.",
	"Read the exact ask. Reply to harmless confirmations and known decisions; never approve out-of-scope writes.",
	"If an ask requires materially new authority, ask the user. The worker should use contact_supervisor need_decision only when truly blocked; never make routine asks, and use native completion to finish.",
	"Verify its changed paths, exact check commands, and outcomes.",
	"Parent model and thinking remain unchanged.",
	"",
].join("\n");
const TargetSchema = Type.Object({
	action: Type.Union([
		Type.Literal("start"),
		Type.Literal("models"),
		Type.Literal("status"),
		Type.Literal("steer"),
		Type.Literal("stop"),
		Type.Literal("resume"),
	]),
	task: Type.Optional(Type.String()),
	priority: Type.Optional(Type.Union([Type.Literal("Speed"), Type.Literal("Quality")])),
	model: Type.Optional(Type.String()),
	rationale: Type.Optional(Type.String()),
	query: Type.Optional(Type.String()),
	message: Type.Optional(Type.String()),
});
interface StoredEntry { type: string; customType?: string; data?: NativeState }
interface ToolResult { content: { type: "text"; text: string }[]; details: Record<string, unknown> }

function textResult(text: string, details: Record<string, unknown> = {}): ToolResult {
	return { content: [{ type: "text", text }], details };
}

function planActive(ctx: ExtensionContext): boolean {
	const entries = ctx.sessionManager.getEntries() as StoredEntry[];
	const plan = entries
		.filter((entry) => entry.type === "custom" && entry.customType === "plan-mode")
		.at(-1)?.data as { enabled?: boolean; executing?: boolean } | undefined;
	return plan?.enabled === true || plan?.executing === true;
}

function entryFor(state: NativeState, owner: string): NativeState & { owner: string } {
	return { ...state, owner };
}

export default function conductor(pi: ExtensionAPI): void {
	let state: NativeState = { enabled: false };
	let owner = "";
	let registration: (() => void) | undefined;
	let nativeReady = false;
	let terminalUnsubscribe: (() => void) | undefined;
	const persist = () => pi.appendEntry("conductor-mode", entryFor(state, owner));

	function setTools(enabled: boolean): string[] {
		const current = pi.getActiveTools();
		if (!enabled) {
			const tools = current.filter((name) => name !== "conductor_worker");
			pi.setActiveTools(tools);
			return tools;
		}
		const registered = new Set(pi.getAllTools().map((tool) => tool.name));
		const tools = [...new Set([...current, "conductor_worker"])].filter((name) => registered.has(name));
		pi.setActiveTools(tools);
		return tools;
	}

	function blocked(reason: string): ToolResult {
		return textResult(reason, { ok: false });
	}

	function release(run: RunRef, lifecycle: string): void {
		if (state.run !== run) return;
		run.lifecycleState = lifecycle;
		state.retained = { ...run };
		state.run = undefined;
		persist();
	}

	async function reconcile(run: RunRef): Promise<string> {
		if (run.operation === "spawn" && run.status === "pending" && !run.runId && !run.asyncId) {
			return "Route approval is pending; the in-memory reservation is retained and no spawn was sent.";
		}
		if (run.operation === "resume" && !run.runId && !run.asyncId) {
				return [
				"Resume reply is ambiguous; no new-run request alias exists.",
				"Keep the slot reserved and do not retry or use the previous run as a substitute.",
			].join(" ");
		}
		let reply;
		try {
			reply = await status(pi, run);
		} catch (error) {
			if (state.run === run) {
				run.status = "unknown";
				persist();
			}
			return `Worker status is unknown; slot retained: ${String(error)}`;
		}
		if (state.run !== run && state.retained !== run) return "Worker ownership changed during status lookup; newer state was left untouched.";
		const details = reply.data?.details;
		run.runId ??= details?.runId;
		run.asyncId ??= details?.asyncId;
		const lifecycle = terminalState(reply);
		if (lifecycle) run.lifecycleState = lifecycle;
		const resumeDisposition = details?.lifecycleStatus?.processTerminal?.resumeDisposition;
		if (resumeDisposition) run.resumeDisposition = resumeDisposition;
		if (hasTerminalProof(reply, run.runId)) {
			if (state.run === run) {
				release(run, lifecycle ?? "terminal");
				return `Worker reached ${lifecycle} with matching native terminal proof; slot released and exact run retained.`;
			}
			state.retained = { ...run, lifecycleState: lifecycle ?? "terminal" };
			persist();
			return `Retained run remains ${lifecycle} with matching native terminal proof.`;
		}
		if (state.run === run) {
			run.status = "unknown";
			persist();
		} else {
			state.retained = { ...run, status: "unknown" };
			persist();
		}
		return `Worker remains unresolved; slot retained. ${reply.data?.text ?? "Native status lacks matching terminal/no-start proof."}`;
	}

	function definitiveNoAdmission(error: unknown): error is RpcError {
		return error instanceof RpcError && RPC_ERROR_NO_ADMISSION.has(error.code ?? "");
	}

	async function dispatch(ctx: ExtensionContext, task: string, target: WorkerTarget): Promise<ToolResult> {
		const run: RunRef = { operation: "spawn", requestId: crypto.randomUUID(), target, status: "pending" };
		state.run = run;
		persist();
		run.status = "unknown";
		persist();
		try {
			const reply = await launch(pi, ctx, task, target, run);
			const details = reply.data?.details;
			run.runId = details?.runId;
			run.asyncId = details?.asyncId;
			run.status = run.runId || run.asyncId ? "running" : "unknown";
			persist();
			const lifecycle = await reconcile(run);
			return textResult(`Worker launch reply received. ${reply.data?.text ?? ""}\n${lifecycle}`, { runId: run.runId, asyncId: run.asyncId });
		} catch (error) {
			if (state.run !== run) {
				return blocked("Worker ownership changed while launch was in flight; inspect native status before any new dispatch.");
			}
			if (definitiveNoAdmission(error)) {
				state.run = undefined;
				persist();
				return blocked(`Native RPC definitively rejected the spawn before admission (${error.code}): ${error.message}`);
			}
			run.status = "unknown";
			persist();
			const resolution = await reconcile(run);
			return blocked(`Spawn reply was ambiguous; no retry was made. ${resolution}`);
		}
	}

	async function startResume(ctx: ExtensionContext, message: string): Promise<ToolResult> {
		const previous = state.retained;
		if (state.run) return blocked(`A worker is already unresolved. ${await reconcile(state.run)}`);
		if (!previous || !eligibleForResume(previous)) {
			return blocked("No inactive retained worker with resumable native session evidence is eligible for native resume.");
		}
		const targetError = targetAvailabilityReason(ctx, previous.target);
		if (targetError) return blocked(`The retained worker's exact model is unavailable: ${targetError}; no resume was sent.`);
		const run: RunRef = {
			operation: "resume",
			requestId: crypto.randomUUID(),
			target: previous.target,
			status: "pending",
		};
		state.run = run;
		persist();
		run.status = "unknown";
		persist();
		try {
			const reply = await control(pi, "resume", previous, message, run.requestId);
			const details = reply.data?.details;
			run.runId = details?.runId;
			run.asyncId = details?.asyncId;
			run.status = run.runId || run.asyncId ? "running" : "unknown";
			state.retained = run.runId || run.asyncId ? undefined : previous;
			persist();
			if (run.runId || run.asyncId) await reconcile(run);
			const summary = reply.data?.text ?? `New exact run: ${run.runId ?? run.asyncId ?? "unknown"}.`;
			return textResult(`Native resume reply received. ${summary}`, { runId: run.runId, asyncId: run.asyncId });
		} catch (error) {
			if (state.run !== run) return blocked("Worker ownership changed while resume was in flight; inspect the active exact run.");
			if (definitiveNoAdmission(error)) {
				state.run = undefined;
				state.retained = previous;
				persist();
				return blocked(`Native RPC definitively rejected the resume before admission (${error.code}): ${error.message}`);
			}
			run.status = "unknown";
			persist();
			return blocked("Resume reply was ambiguous; the old run will not be used to reconcile the possible new run. No retry was made.");
		}
	}

	function qualityOptions(
		ctx: ExtensionContext,
		target: WorkerTarget,
	): { options: string[]; speedAvailable: boolean; speedReason?: string; qualityLabel: string } {
		const scoped = new Set(ctx.scopedModels.map(({ model }) => `${model.provider}/${model.id}`));
		const key = `${target.provider}/${target.id}`;
		const selector = `${key}:${target.thinkingLevel}`;
		const qualityLabel = `Quality — ${selector}${scoped.has(key) ? "" : " (out of scope)"}`;
		const speedReason = targetAvailabilityReason(ctx, SPEED_TARGET);
		const speedAvailable = speedReason === undefined;
		return {
			options: [
				...(speedAvailable ? [`Speed — ${SPEED_TARGET.provider}/${SPEED_TARGET.id}:${SPEED_TARGET.thinkingLevel}`] : []),
				qualityLabel,
				"Cancel",
			],
			speedAvailable,
			...(speedReason ? { speedReason } : {}),
			qualityLabel,
		};
	}

	pi.registerTool({
		name: "conductor_worker",
		label: "Conductor worker",
		description: "Inspect the bounded model catalog; start, status, steer, stop, or resume the one owned Conductor worker.",
		exposure: "model-only",
		defaultActive: false,
		parameters: TargetSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!nativeReady) return blocked("Native worker service is unavailable; no worker action was taken.");
			if (params.action !== "status" && !state.enabled) return blocked("Conductor is inactive.");
			if (params.action === "models") {
				const models = modelCatalog(ctx, params.query ?? "", 60);
				const lines = models.map((model) =>
					`${model.provider}/${model.id} [${model.levels.join(", ")}]${model.scoped ? " (scoped)" : " (out of scope)"}`,
				);
				return textResult(
					lines.length ? lines.join("\n") : "No available models matched the search.",
					{ count: models.length, limit: 60, query: params.query ?? "" },
				);
			}
			if (params.action === "status") {
				const run = state.run ?? state.retained;
				return textResult(
					run ? await reconcile(run) : "No active or retained worker.",
					{ runId: run?.runId, asyncId: run?.asyncId, enabled: state.enabled },
				);
			}
			if (params.action === "start") {
				if (!state.enabled) return blocked("Conductor is inactive.");
				if (state.run) return blocked(`A worker is already unresolved. ${await reconcile(state.run)}`);
				if (!params.task?.trim()) return blocked("Start requires the complete self-contained task brief.");
				if (params.priority !== "Speed" && params.priority !== "Quality") return blocked("Start requires explicit Speed or Quality priority.");
				const proposed = params.priority === "Speed" ? { ...SPEED_TARGET } : parseTarget(ctx, params.model ?? "");
				if (!proposed || (params.priority === "Quality" && !params.rationale?.trim())) {
					return blocked("Quality requires an exact available provider/model:thinking selector and task-specific rationale.");
				}
				const targetError = targetAvailabilityReason(ctx, proposed);
				if (targetError) return blocked(`The selected exact model is unavailable: ${targetError}; no worker was started.`);
				if (params.priority === "Speed") return dispatch(ctx, params.task, proposed);
				state.run = { operation: "spawn", requestId: crypto.randomUUID(), target: proposed, status: "pending" };
				const offered = qualityOptions(ctx, proposed);
				let choice: string | undefined;
				try {
					const routeOffer = offered.speedAvailable
						? "Choose Speed, confirm Quality, or Cancel."
						: `Confirm Quality or Cancel. Speed is unavailable because ${offered.speedReason}.`;
					choice = await ctx.ui.select(
						`Quality recommendation: ${proposed.provider}/${proposed.id}:${proposed.thinkingLevel}. ${params.rationale} ${routeOffer}`,
						offered.options,
					);
				} catch {
					state.run = undefined;
					return blocked("Quality confirmation was unavailable; no worker was started.");
				}
				if (!choice || choice === "Cancel") {
					state.run = undefined;
					return textResult("Cancelled; no worker was started.");
				}
				const selected = choice.startsWith("Speed —") ? { ...SPEED_TARGET } : choice === offered.qualityLabel ? proposed : undefined;
				const selectionError = selected ? targetAvailabilityReason(ctx, selected) : "the selected route is invalid";
				if (!selected || selectionError) {
					state.run = undefined;
					return blocked(`The approved target is unavailable: ${selectionError}; no worker was started.`);
				}
				state.run = undefined;
				return dispatch(ctx, params.task, selected);
			}
			if (params.action === "resume") {
				if (!state.enabled) return blocked("Conductor is inactive.");
				if (!params.message?.trim()) return blocked("Resume requires a non-empty follow-up message.");
				return startResume(ctx, params.message);
			}
			if (!state.enabled && !state.run) return blocked("Conductor is inactive.");
			if (!state.run) return blocked("No active worker exists for this control action.");
			if (state.run.status === "pending" && !state.run.runId && !state.run.asyncId) {
				return blocked("Route approval is pending; worker controls are unavailable until dispatch.");
			}
			if (state.run.operation === "resume" && !state.run.runId && !state.run.asyncId) {
				return blocked("Resume is ambiguous; only its new exact run can be controlled or reconciled.");
			}
			if (params.action === "stop") {
				try {
					const reply = await control(pi, "stop", state.run);
					return textResult(
						`Stop acknowledged; the slot remains reserved pending native terminal proof. ${reply.data?.text ?? ""}`,
						{ runId: state.run.runId },
					);
				} catch (error) {
					return blocked(`Stop result is uncertain; the slot remains reserved: ${String(error)}`);
				}
			}
			if (!params.message?.trim()) return blocked("Steer requires a non-empty message.");
			try {
				const reply = await control(pi, "steer", state.run, params.message);
				return textResult(reply.data?.text ?? "Steer accepted by native RPC.", { runId: state.run.runId });
			} catch (error) {
				return blocked(`Steer result is uncertain; the slot remains reserved: ${String(error)}`);
			}
		},
	});

	pi.registerCommand("conductor", {
		description: "Toggle director mode; /conductor status reports owned worker state",
		handler: async (args, ctx) => {
			if (args?.trim() === "status") {
				const run = state.run ?? state.retained;
				const status = run ? await reconcile(run) : "no worker owned";
				ctx.ui.notify(`Conductor ${state.enabled ? "active" : "inactive"}; ${status}`);
				return;
			}
			if (!state.enabled && planActive(ctx)) {
				ctx.ui.notify("Conductor cannot start while plan mode or plan execution is active.", "warning");
				return;
			}
			if (state.enabled && state.run) {
				ctx.ui.notify(`Cannot exit while a worker is unresolved. ${await reconcile(state.run)}`, "warning");
				return;
			}
			state.enabled = !state.enabled;
			setTools(state.enabled);
			ctx.ui.setStatus("conductor", state.enabled ? ctx.ui.theme.fg("accent", "🎛 conductor") : undefined);
			persist();
		},
	});

	pi.on("tool_call", async (event) => {
		if (!state.enabled) return;
		if ((event.toolName === "conductor_worker" || COORDINATION_TOOLS.includes(event.toolName as typeof COORDINATION_TOOLS[number])) && event.parentToolCallId) {
			return { block: true, reason: "Nested Conductor coordination calls are blocked." };
		}
	});
	pi.on("before_agent_start", async (event, _ctx) => {
		if (!state.enabled) {
			delete event.systemPromptOptions.sections["conductor-director"];
			return;
		}
		setTools(true);
		event.systemPromptOptions.sections["conductor-director"] = DIRECTOR_PROMPT;
	});
	pi.on("context", async (event) => ({
		messages: event.messages.filter((message) => state.enabled || (message as { customType?: string }).customType !== "conductor-context"),
	}));
	pi.on("session_start", async (_event, ctx) => {
		const sessionOwner = ctx.sessionManager.getSessionId();
		if (owner && owner !== sessionOwner) {
			setTools(false);
			state = { enabled: false };
		}
		owner = sessionOwner;
		const entries = ctx.sessionManager.getEntries() as StoredEntry[];
		const previous = entries
			.filter((entry) => entry.type === "custom" && entry.customType === "conductor-mode" && entry.data?.owner === owner)
			.at(-1)?.data;
		const oldRun = previous?.run;
		state = previous ? { ...previous } : { enabled: false };
		let repairedState = false;
		if (oldRun?.status === "pending" && !oldRun.runId && !oldRun.asyncId) {
			state.run = undefined;
			repairedState = true;
		}
		if (state.run && !state.enabled) {
			state.enabled = true;
			repairedState = true;
		}
		registration?.();
		registration = registerWorker(pi);
		nativeReady = false;
		try { await rpc(pi, "ping", {}, crypto.randomUUID(), 5000); nativeReady = !!registration; } catch { nativeReady = false; }
		if (state.enabled) setTools(true);

		terminalUnsubscribe?.();
		terminalUnsubscribe = pi.events.on("subagent:process-terminal", (event) => {
			const proof = event as { runId?: string };
			const run = state.run;
			if (!run || (proof.runId && proof.runId !== run.runId && proof.runId !== run.asyncId)) return;
			void reconcile(run);
		});
		ctx.ui.setStatus("conductor", state.enabled ? ctx.ui.theme.fg("accent", "🎛 conductor") : undefined);
		if (repairedState) persist();
	});
	const unresolved = () => state.run !== undefined;
	pi.on("session_before_switch", async (_event, ctx) => {
		if (!unresolved()) return;
		ctx.ui.notify("Cannot switch sessions while Conductor owns an unresolved worker.", "warning");
		return { cancel: true };
	});
	pi.on("session_before_fork", async (_event, ctx) => {
		if (!unresolved()) return;
		ctx.ui.notify("Cannot fork while Conductor owns an unresolved worker.", "warning");
		return { cancel: true };
	});
	pi.on("session_before_tree", async (_event, ctx) => {
		if (!unresolved()) return;
		ctx.ui.notify("Cannot change the session tree while Conductor owns an unresolved worker.", "warning");
		return { cancel: true };
	});
	pi.on("session_shutdown", async () => {
		registration?.();
		registration = undefined;
		terminalUnsubscribe?.();
		terminalUnsubscribe = undefined;
	});
}
