import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { WorkerTarget } from "./models.ts";

export const WORKER = "conductor-worker";
const RPC = "subagents:rpc:v1";
export type RunOperation = "spawn" | "resume";
export interface RunRef {
	requestId: string;
	operation: RunOperation;
	runId?: string;
	asyncId?: string;
	target: WorkerTarget;
	status: "pending" | "running" | "unknown";
	lifecycleState?: string;
	resumeDisposition?: ProcessTerminal["resumeDisposition"];
}
export interface NativeState {
	enabled: boolean;
	run?: RunRef;
	retained?: RunRef;
	owner?: string;
}
export class RpcError extends Error {
	constructor(message: string, readonly code?: string) { super(message); }
}
interface ProcessTerminal { state?: string; runId?: string; resumeDisposition?: "resumable" | "non-resumable" | "unavailable" }
interface StatusDetails {
	text?: string;
	runId?: string;
	asyncId?: string;
	toolCallId?: string;
	lifecycleStatus?: { processTerminal?: ProcessTerminal };
}
export interface RpcReply {
	success?: boolean;
	data?: { details?: StatusDetails; text?: string; asyncSnapshot?: { runs?: { id?: string; state?: string }[] } };
	error?: { code?: string; message?: string };
}
interface RuntimeAgentDefinition {
	description: string;
	systemPrompt: string;
	tools: string[];
	model: string;
	acceptanceRole: "writer";
	defaultAcceptance: { level: "none"; reason: string };
	extensions: string[];
	subagentOnlyExtensions: string[];
	inheritProjectContext: true;
	inheritGlobalContext: true;
	inheritSkills: false;
	allowNestedSubagents: false;
	defaultAsync: true;
}
interface RuntimeAgentRequest {
	version: 1;
	name: string;
	definition: RuntimeAgentDefinition;
	result?: { ok: true; registration: { dispose(): void } } | { ok: false; error: Error };
}

export function rpc(
	pi: ExtensionAPI,
	method: string,
	params: Record<string, unknown>,
	requestId: string,
	timeout = 30000,
): Promise<RpcReply> {
	return new Promise((resolve, reject) => {
		let unsubscribe: (() => void) | undefined;
		const timer = setTimeout(() => {
			unsubscribe?.();
			reject(new Error(`RPC ${method} timed out`));
		}, timeout);
		unsubscribe = pi.events.on(`${RPC}:reply:${requestId}`, (value) => {
			clearTimeout(timer);
			unsubscribe?.();
			const reply = value as RpcReply;
			if (reply?.success) resolve(reply);
			else reject(new RpcError(reply?.error?.message ?? `RPC ${method} failed`, reply?.error?.code));
		});
		pi.events.emit(`${RPC}:request`, { version: 1, requestId, method, params });
	});
}

export function registerWorker(pi: ExtensionAPI): (() => void) | undefined {
	const request: RuntimeAgentRequest = {
		version: 1,
		name: WORKER,
		definition: {
			description: "In-place Conductor worker",
			systemPrompt: [
				"Implement only the supplied self-contained task. Use the launch checkout by default unless the task brief specifies another checkout or worktree.",
				"Follow the inherited project/global instructions.",
				"Unless the task brief explicitly directs otherwise, do not commit, push, create or switch branches, or create linked worktrees.",
				"Do not delegate. Git status/diff inspection is allowed.",
				"Report changed paths, exact check commands, and outcomes.",
			].join(" "),
			tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
			model: "inherit",
			acceptanceRole: "writer",
			defaultAcceptance: { level: "none", reason: "Director verifies evidence" },
			extensions: [],
			subagentOnlyExtensions: [],
			inheritProjectContext: true,
			inheritGlobalContext: true,
			inheritSkills: false,
			allowNestedSubagents: false,
			defaultAsync: true,
		},
	};
	pi.events.emit("pi-subagents:runtime-agent-register:v1", request);
	if (!request.result || !request.result.ok) return undefined;
	return () => request.result?.ok && request.result.registration.dispose();
}

export async function launch(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	task: string,
	target: WorkerTarget,
	run: RunRef,
): Promise<RpcReply> {
	return rpc(pi, "spawn", {
		agent: WORKER,
		task,
		cwd: ctx.cwd,
		worktree: false,
		async: true,
		context: "fresh",
		model: `${target.provider}/${target.id}:${target.thinkingLevel}`,
	}, run.requestId, 120000);
}

export function requestSelector(run: RunRef): string {
	return run.runId ?? run.asyncId ?? `rpc-spawn-${run.requestId}`;
}

export async function status(pi: ExtensionAPI, run: RunRef): Promise<RpcReply> {
	return rpc(pi, "status", { id: requestSelector(run) }, crypto.randomUUID());
}

export async function control(
	pi: ExtensionAPI,
	method: "steer" | "stop" | "resume",
	run: RunRef,
	message?: string,
	requestId: string = crypto.randomUUID(),
): Promise<RpcReply> {
	return rpc(pi, method, { id: requestSelector(run), ...(message ? { message } : {}) }, requestId);
}

export function terminalState(reply: RpcReply): string | undefined {
	const details = reply.data?.details;
	return reply.data?.text?.match(/(?:^|\n)State:\s*([\w-]+)/)?.[1]?.toLowerCase()
		?? details?.text?.match(/(?:^|\n)State:\s*([\w-]+)/)?.[1]?.toLowerCase();
}

export function hasTerminalProof(reply: RpcReply, runId: string | undefined): boolean {
	const processTerminal = reply.data?.details?.lifecycleStatus?.processTerminal;
	if (!runId || processTerminal?.runId !== runId) return false;
	const state = terminalState(reply);
	if (processTerminal.state === "observed") return ["complete", "completed", "failed", "stopped", "paused"].includes(state ?? "");
	return processTerminal.state === "not-started" && state === "failed";
}

export function eligibleForResume(run: RunRef): boolean {
	return ["paused", "complete", "completed", "failed"].includes(run.lifecycleState ?? "")
		&& run.resumeDisposition === "resumable";
}
