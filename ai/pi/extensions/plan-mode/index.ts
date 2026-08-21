/**
 * Plan Mode Extension
 *
 * Read-only exploration mode for safe code analysis.
 * When enabled, built-in write tools are disabled.
 *
 * Features:
 * - /plan command or Ctrl+Alt+P to toggle
 * - Bash restricted to allowlisted read-only commands
 * - Extracts numbered plan steps from "Plan:" sections
 * - [DONE:n] markers to complete steps during execution
 * - Progress tracking widget during execution
 * - Interactive questionnaire tool: ask the user clarifying questions mid-plan
 *   (options + free-form answers) so context lands before the final plan
 * - Structured plan format (Title / Context / Approach / Multi-Agent Team Structure / Plan /
 *   Verification / Files touched) with subagent orchestration guidance adapted from the
 *   user's Claude planning setup (ai/claude/CLAUDE.md)
 * - Saves each plan as a timestamped .md to the shared plans store, named from the plan's
 *   Title line (the actual work, not the request wording); one file per plan-mode session —
 *   revisions update it in place
 * - "Execute in a fresh session" (menu option / /plan-exec-fresh): clears context and executes
 *   off the plan file alone — seeds execution state into a replacement session via
 *   ctx.newSession, which is only available on command contexts (agent_end queues the
 *   command as a follow-up user message)
 *
 * Plans are saved as timestamped markdown files (one per plan-mode session; revisions
 * overwrite the session's file) to the shared plans store: ~/.pi/agent/memory/.plans — inside the
 * memory-store symlink (private/ai/shared/memory/agent/.plans; the dot-prefix
 * sorts it above the per-project memory folders); $PI_AGENT_STORE points at
 * the shared store root, resolved as <root>/memory/agent/.plans. The extension writes these
 * itself (plan-mode tool restrictions only gate the agent's tools), so plans
 * stay referenceable across sessions and harnesses without living in context.
 *
 * Planning style follows the user's Working Principles (~/.pi/agent/AGENTS.md):
 * state assumptions, surface interpretations, simplicity first, surgical
 * changes, and a verify check per plan step.
 */

import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { registerQuestionnaireTool } from "./questionnaire.ts";
import {
	extractPlanTitle,
	extractTodoItems,
	isSafeCommand,
	markCompletedSteps,
	planFileName,
	type TodoItem,
} from "./utils.ts";

// Tools
const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls", "questionnaire", "subagent"];
const NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write"];
const PLAN_MODE_DISABLED_TOOLS = new Set<string>(["edit", "write"]);
const PLAN_MANAGED_TOOLS = new Set<string>([...PLAN_MODE_TOOLS, ...NORMAL_MODE_TOOLS]);
// Prefix of the user message sent by the "Refine the plan" flow — signals an in-place plan update
const REFINE_MARKER = "[PLAN MODE - REFINE THE PLAN]";

interface PlanModeState {
	enabled: boolean;
	todos?: TodoItem[];
	executing?: boolean;
	toolsBeforePlanMode?: string[];
	lastPlanFile?: string;
}

// Type guard for assistant messages
function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
	return m.role === "assistant" && Array.isArray(m.content);
}

// Extract text content from an assistant message
function getTextContent(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

// Extract text content from a user message (string or block content)
function getUserText(message: AgentMessage): string | undefined {
	if (message.role !== "user") return undefined;
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter((block): block is TextContent => (block as { type?: string }).type === "text")
			.map((block) => block.text)
			.join("\n");
	}
	return undefined;
}

/** Plans store: $PI_AGENT_STORE/memory/agent/.plans, else ~/.pi/agent/memory/.plans; undefined if neither exists. */
function plansDir(): string | undefined {
	const shared = process.env.PI_AGENT_STORE;
	if (shared) {
		const dir = join(shared, "memory", "agent", ".plans");
		if (existsSync(dir)) return dir;
	}
	const conventional = join(homedir(), ".pi/agent/memory/.plans");
	if (existsSync(conventional)) return conventional;
	return undefined;
}

/**
 * Save the plan as a timestamped markdown file; with existingPath (a refinement), overwrite
 * that file instead of creating a new one. Returns the path, or undefined when unsaved.
 */
function writePlanFile(
	planText: string,
	slugSource: string,
	cwd: string,
	ctx: ExtensionContext,
	existingPath?: string,
): string | undefined {
	const dir = existingPath ? undefined : plansDir();
	const path = existingPath ?? (dir ? join(dir, planFileName(slugSource, new Date())) : undefined);
	if (!path) {
		ctx.ui.notify("Plan not saved: no plans store (run ai/pi/install.sh or set $PI_AGENT_STORE)", "warning");
		return undefined;
	}
	const content = `---\ncreated: ${new Date().toISOString()}\ncwd: ${cwd}\n---\n\n${planText.trim()}\n`;
	try {
		writeFileSync(path, content);
	} catch (err) {
		ctx.ui.notify(`Plan not saved: ${err}`, "warning");
		return undefined;
	}
	ctx.ui.notify(`Plan ${existingPath ? "updated" : "saved"}: ${path.replace(homedir(), "~")}`, "info");
	return path;
}

const PLAN_MODE_PROMPT = `[PLAN MODE ACTIVE]
You are in plan mode - a read-only exploration mode for safe code analysis and planning.

Restrictions:
- Built-in edit and write tools are disabled
- Other currently active tools remain available
- Bash is restricted to an allowlist of read-only commands (read-only git/gh inspection included)
- Do NOT attempt to make changes - just describe what you would do
- Read-only bash succeeding (git status, gh pr view, ls) does NOT mean plan mode is off. If a write command is blocked, do not retry it or work around it - finish presenting the plan; the user chooses when to execute.

Before planning:
- Read the repo's AGENTS.md / CLAUDE.md if the task touches an area you haven't worked in.
- State assumptions explicitly. If multiple interpretations exist, surface them — do not silently pick one.
- Explore enough of the codebase that every step names real files/symbols, not placeholders.

Asking the user (interactive planning):
- Use the questionnaire tool when intent, scope, or approach is genuinely ambiguous, or a decision is worth confirming before the plan is final. Ask EARLY — after initial exploration, before presenting the plan — so answers shape the plan instead of causing refine cycles.
- Batch related questions into ONE questionnaire call (up to 4), each with 2-4 concrete options, recommended option first. The user can always pick "Type something" to answer free-form.
- If the user cancels the questionnaire, do not re-ask the same questions — proceed with stated assumptions. If the tool errors (no interactive UI), ask in plain text in your response instead.

Plan design (multi-agent):
- For genuinely ambiguous or cross-cutting work, launch 3 planning subagents in parallel via the
  subagent tool — each gets the same context (exploration results, requirements, constraints)
  and designs a full plan independently, with no communication between them. Planning is
  read-only: subagents propose plans, they do not implement.
- Amalgamate the proposals into the final plan: take the strongest ideas from each, and say why
  the chosen approach beats the alternatives.
- Right-size: skip the 3-subagent design phase for small changes (< ~50 LOC or single-file) —
  design solo.

Planning style (user preferences):
- Simplicity first: minimum changes that solve the problem; no speculative features, abstractions, or configurability.
- Surgical: touch only what the request requires; no drive-by refactors, comment tweaks, or formatting.
- Goal-driven: turn the task into verifiable goals. Each step gets a verify check (test command, typecheck, lint, or manual check) so completion is provable.
- Respect repo rules: no commits unless explicitly asked; DB migrations land separately before implementation.

Output format:

Title: Short descriptive title naming the actual work (describe the change, not the request
wording: "Add signup gate for XRS", not "I want a plan for gating signup")

## Context
Current state, the problem, and the goal after the change. Brief.

## Approach
The design decision and why; alternatives considered, briefly. For amalgamated plans, credit
which proposal each key idea came from.

## Multi-Agent Team Structure
How execution will be coordinated (omit this section for small plans a single agent executes):
- Independent chunks (no file overlap, no sequential deps) — each gets a parallel implementation
  agent in its own worktree; list them explicitly so the coordination flow is unambiguous
- Sequential chunks — run in order in one worktree
- Quality pass after implementation (parallel): code review, silent-failure hunt, test-coverage
  analysis, lint/format of changed files
- Cleanup (sequential): simplify the implementation, then a final staff-level review of the diff

Plan:
1. First step description (files touched) — verify: <check>
2. Second step description — verify: <check>
...

## Verification
End-to-end checks after all steps land (manual flows, full test suite, typecheck).

## Files touched
- New: ...
- Modified: ...
- Intentionally unchanged: ...`;

export default function planModeExtension(pi: ExtensionAPI): void {
	let planModeEnabled = false;
	let executionMode = false;
	let todoItems: TodoItem[] = [];
	let toolsBeforePlanMode: string[] | undefined;
	let lastPlanFile: string | undefined;

	registerQuestionnaireTool(pi);

	pi.registerFlag("plan", {
		description: "Start in plan mode (read-only exploration)",
		type: "boolean",
		default: false,
	});

	function updateStatus(ctx: ExtensionContext): void {
		// Footer status
		if (executionMode && todoItems.length > 0) {
			const completed = todoItems.filter((t) => t.completed).length;
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("accent", `📋 ${completed}/${todoItems.length}`));
		} else if (planModeEnabled) {
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "⏸ plan"));
		} else {
			ctx.ui.setStatus("plan-mode", undefined);
		}

		// Widget showing todo list
		if (executionMode && todoItems.length > 0) {
			const lines = todoItems.map((item) => {
				if (item.completed) {
					return (
						ctx.ui.theme.fg("success", "☑ ") + ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(item.text))
					);
				}
				return `${ctx.ui.theme.fg("muted", "☐ ")}${item.text}`;
			});
			ctx.ui.setWidget("plan-todos", lines);
		} else {
			ctx.ui.setWidget("plan-todos", undefined);
		}
	}

	function uniqueToolNames(toolNames: string[]): string[] {
		return [...new Set(toolNames)];
	}

	function getPlanModeTools(activeToolNames: string[]): string[] {
		return uniqueToolNames([
			...activeToolNames.filter((name) => !PLAN_MODE_DISABLED_TOOLS.has(name)),
			...PLAN_MODE_TOOLS,
		]);
	}

	function getNormalModeTools(activeToolNames: string[]): string[] {
		return uniqueToolNames([
			...NORMAL_MODE_TOOLS,
			...activeToolNames.filter((name) => !PLAN_MANAGED_TOOLS.has(name)),
		]);
	}

	function enablePlanModeTools(): void {
		if (toolsBeforePlanMode === undefined) {
			toolsBeforePlanMode = pi.getActiveTools();
		}
		pi.setActiveTools(getPlanModeTools(toolsBeforePlanMode));
	}

	function restoreNormalModeTools(): void {
		pi.setActiveTools(toolsBeforePlanMode ?? getNormalModeTools(pi.getActiveTools()));
		toolsBeforePlanMode = undefined;
	}

	function persistState(): void {
		pi.appendEntry("plan-mode", {
			enabled: planModeEnabled,
			todos: todoItems,
			executing: executionMode,
			toolsBeforePlanMode,
			lastPlanFile,
		});
	}

	function togglePlanMode(ctx: ExtensionContext): void {
		planModeEnabled = !planModeEnabled;
		executionMode = false;
		todoItems = [];
		lastPlanFile = undefined;

		if (planModeEnabled) {
			enablePlanModeTools();
			ctx.ui.notify("Plan mode enabled. Built-in write tools disabled.");
		} else {
			restoreNormalModeTools();
			ctx.ui.notify("Plan mode disabled. Full access restored.");
		}
		updateStatus(ctx);
		persistState();
	}

	pi.registerCommand("plan", {
		description: "Toggle plan mode (read-only exploration)",
		handler: async (_args, ctx) => togglePlanMode(ctx),
	});

	// Execute the current plan in a fresh session whose only context is the plan file.
	// Also the target of the "Execute in a fresh session" menu option — ctx.newSession is
	// only available on command contexts, so agent_end queues this as a follow-up message.
	pi.registerCommand("plan-exec-fresh", {
		description: "Execute the current plan in a fresh session (clears context)",
		handler: async (_args, ctx) => {
			if (executionMode) {
				ctx.ui.notify("Already executing the plan.", "info");
				return;
			}
			if (todoItems.length === 0) {
				ctx.ui.notify("No plan to execute — create one in plan mode first (/plan).", "info");
				return;
			}
			if (!lastPlanFile) {
				ctx.ui.notify("Plan isn't saved to disk — fresh-session execution needs the plan file.", "warning");
				return;
			}

			// Plain data only — captured session-bound objects are stale after replacement.
			const todos = todoItems.map((t) => ({ ...t }));
			const planFile = lastPlanFile;
			const parentSession = ctx.sessionManager.getSessionFile();
			const kickoff = [
				`Execute the plan saved at: ${planFile}`,
				"",
				"Read the plan file first — it has the context, approach, and full step detail. Then execute the steps in order, keeping changes surgical.",
				"After completing a step, run its verify check, then include a [DONE:n] tag in your response.",
				"Delegation: follow the plan's Multi-Agent Team Structure section if it has one — parallel implementation agents in separate worktrees for independent chunks, a parallel quality pass after implementation, then simplify + final review. Small plans: implement inline, then the quality pass.",
				"Do not commit anything unless the user explicitly asks.",
			].join("\n");

			const result = await ctx.newSession({
				parentSession,
				setup: async (sm) => {
					// Seed execution state so the fresh extension instance's session_start restores
					// todos/progress tracking (plan mode itself stays off in the new session).
					sm.appendCustomEntry("plan-mode", {
						enabled: false,
						todos,
						executing: true,
						lastPlanFile: planFile,
					});
				},
				withSession: async (freshCtx) => {
					await freshCtx.sendUserMessage(kickoff);
				},
			});
			if (result.cancelled) {
				ctx.ui.notify("Fresh-session execute cancelled — staying in plan mode.", "info");
			}
		},
	});

	pi.registerCommand("todos", {
		description: "Show current plan todo list (/todos clear to dismiss)",
		handler: async (args, ctx) => {
			if (args?.trim() === "clear") {
				if (todoItems.length === 0) {
					ctx.ui.notify("No todos to dismiss.", "info");
					return;
				}
				todoItems = [];
				executionMode = false;
				updateStatus(ctx);
				persistState();
				ctx.ui.notify("Plan todos dismissed.", "info");
				return;
			}
			if (todoItems.length === 0) {
				ctx.ui.notify("No todos. Create a plan first with /plan", "info");
				return;
			}
			const list = todoItems.map((item, i) => `${i + 1}. ${item.completed ? "✓" : "○"} ${item.text}`).join("\n");
			ctx.ui.notify(`Plan Progress:\n${list}\n\n(/todos clear to dismiss)`, "info");
		},
	});

	pi.registerShortcut(Key.ctrlAlt("p"), {
		description: "Toggle plan mode",
		handler: async (ctx) => togglePlanMode(ctx),
	});

	// Block destructive bash commands in plan mode
	pi.on("tool_call", async (event) => {
		if (!planModeEnabled || event.toolName !== "bash") return;

		const command = event.input.command as string;
		if (!isSafeCommand(command)) {
			return {
				block: true,
				reason: `Plan mode: command blocked (not allowlisted). Use /plan to disable plan mode first.\nCommand: ${command}`,
			};
		}
	});

	// Filter out stale plan mode context when not in plan mode
	pi.on("context", async (event) => {
		if (planModeEnabled) return;

		return {
			messages: event.messages.filter((m) => {
				const msg = m as AgentMessage & { customType?: string };
				if (msg.customType === "plan-mode-context") return false;
				if (msg.role !== "user") return true;

				const content = msg.content;
				if (typeof content === "string") {
					return !content.includes("[PLAN MODE ACTIVE]");
				}
				if (Array.isArray(content)) {
					return !content.some(
						(c) => c.type === "text" && (c as TextContent).text?.includes("[PLAN MODE ACTIVE]"),
					);
				}
				return true;
			}),
		};
	});

	// Inject plan/execution context before agent starts
	pi.on("before_agent_start", async () => {
		if (planModeEnabled) {
			return {
				message: {
					customType: "plan-mode-context",
					content: PLAN_MODE_PROMPT,
					display: false,
				},
			};
		}

		if (executionMode && todoItems.length > 0) {
			const remaining = todoItems.filter((t) => !t.completed);
			const todoList = remaining.map((t) => `${t.step}. ${t.text}`).join("\n");
			const planFileLine = lastPlanFile ? `\nFull plan file: ${lastPlanFile}` : "";
			return {
				message: {
					customType: "plan-execution-context",
					content: `[EXECUTING PLAN - Full tool access enabled]

Remaining steps:
${todoList}

Execute each step in order. Keep changes surgical — only what the step requires.
After completing a step, run its verify check, then include a [DONE:n] tag in your response.
Follow the plan's Multi-Agent Team Structure section when it has one: parallel implementation
subagents in separate worktrees for independent chunks, then a parallel quality pass (review,
silent-failure hunt, test coverage, lint/format), then simplify + a final staff-level review.
Small plans without that section: implement inline, then the quality pass.
Do not commit anything unless the user explicitly asks.${planFileLine}`,
					display: false,
				},
			};
		}
	});

	// Track progress after each turn
	pi.on("turn_end", async (event, ctx) => {
		if (!executionMode || todoItems.length === 0) return;
		if (!isAssistantMessage(event.message)) return;

		const text = getTextContent(event.message);
		if (markCompletedSteps(text, todoItems) > 0) {
			updateStatus(ctx);
		}
		persistState();
	});

	// Handle plan completion and plan mode UI
	pi.on("agent_end", async (event, ctx) => {
		// Check if execution is complete
		if (executionMode && todoItems.length > 0) {
			if (todoItems.every((t) => t.completed)) {
				const completedList = todoItems.map((t) => `~~${t.text}~~`).join("\n");
				pi.sendMessage(
					{ customType: "plan-complete", content: `**Plan Complete!** ✓\n\n${completedList}`, display: true },
					{ triggerTurn: false },
				);
				executionMode = false;
				todoItems = [];
				updateStatus(ctx);
				persistState(); // Save cleared state so resume doesn't restore old execution mode
			}
			return;
		}

		if (!planModeEnabled || !ctx.hasUI) return;

		// Extract todos from last assistant message
		const lastAssistant = [...event.messages].reverse().find(isAssistantMessage);
		if (lastAssistant) {
			const planText = getTextContent(lastAssistant);
			const extracted = extractTodoItems(planText);
			if (extracted.length > 0) {
				todoItems = extracted;
				const lastUser = [...event.messages].reverse().find((m) => m.role === "user");
				const userText = (lastUser && getUserText(lastUser)) || undefined;
				// One file per plan-mode session: any revised plan (the Refine flow or free-form
				// feedback) updates the original file in place. Toggling plan mode resets
				// lastPlanFile, so the next session starts a fresh file.
				if (lastPlanFile) {
					lastPlanFile = writePlanFile(planText, "", ctx.cwd, ctx, lastPlanFile) ?? lastPlanFile;
				} else {
					// Slug from the plan's Title line (the actual work), not the request wording
					const requestText = userText?.startsWith(REFINE_MARKER) ? undefined : userText;
					const slugSource = extractPlanTitle(planText) || requestText || extracted[0]?.text || "plan";
					lastPlanFile = writePlanFile(planText, slugSource, ctx.cwd, ctx) ?? lastPlanFile;
				}
			}
		}

		if (todoItems.length === 0) return;
		persistState();

		const choice = await ctx.ui.select("Plan mode - what next?", [
			"Execute the plan (track progress)",
			"Execute in a fresh session (clear context)",
			"Stay in plan mode",
			"Refine the plan",
		]);

		if (choice?.startsWith("Execute in a fresh")) {
			// The fresh session operates off the plan file alone — require it to exist on disk.
			if (!lastPlanFile) {
				ctx.ui.notify("Plan isn't saved to disk — fresh-session execution needs the plan file.", "warning");
				return;
			}
			pi.sendUserMessage("/plan-exec-fresh", { deliverAs: "followUp" });
			return;
		}

		if (choice?.startsWith("Execute")) {
			const firstTodoItem = todoItems[0];
			if (!firstTodoItem) return;

			planModeEnabled = false;
			executionMode = true;
			restoreNormalModeTools();
			updateStatus(ctx);
			persistState();

			const remainingList = todoItems.map((t) => `${t.step}. ${t.text}`).join("\n");
			const planFileLine = lastPlanFile ? `\nFull plan file: ${lastPlanFile}` : "";
			const execMessage = `Execute the plan.

Remaining steps:
${remainingList}

Start with: ${firstTodoItem.text}
After completing a step, run its verify check, then include a [DONE:n] tag in your response.
Delegation: follow the plan's Multi-Agent Team Structure section (full plan file below) — parallel
implementation agents in separate worktrees for independent chunks, a parallel quality pass after
implementation, then simplify + final review. Small plans: implement inline, then the quality pass.${planFileLine}`;
			pi.sendMessage(
				{ customType: "plan-mode-execute", content: execMessage, display: true },
				{ triggerTurn: true, deliverAs: "followUp" },
			);
		} else if (choice === "Refine the plan") {
			const refinement = await ctx.ui.editor("Refine the plan:", "");
			if (refinement?.trim()) {
				// One self-contained message: a bare checklist delivered on its own reads as
				// "approved, execute" (and followUp-triggered runs get no fresh [PLAN MODE
				// ACTIVE] injection), so the refine instruction must carry the context.
				pi.sendUserMessage(
					[
						REFINE_MARKER,
						"The user reviewed the plan and wants changes. You are STILL in plan mode:",
						"do not execute any steps and do not call edit/write tools - produce a revised plan only.",
						"",
						"Feedback:",
						refinement.trim(),
						"",
						'Respond with the complete revised plan in the same output format (Title, Context, Approach, Multi-Agent Team Structure, Plan, Verification, Files touched) — update the Title line if the scope changed.',
					].join("\n"),
					{ deliverAs: "followUp" },
				);
			}
		}
	});

	// Restore state on session start/resume
	pi.on("session_start", async (_event, ctx) => {
		if (pi.getFlag("plan") === true) {
			planModeEnabled = true;
		}

		const entries = ctx.sessionManager.getEntries();

		// Restore persisted state
		const planModeEntry = entries
			.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "plan-mode")
			.pop() as { data?: PlanModeState } | undefined;

		if (planModeEntry?.data) {
			planModeEnabled = planModeEntry.data.enabled ?? planModeEnabled;
			todoItems = planModeEntry.data.todos ?? todoItems;
			executionMode = planModeEntry.data.executing ?? executionMode;
			toolsBeforePlanMode = planModeEntry.data.toolsBeforePlanMode ?? toolsBeforePlanMode;
			lastPlanFile = planModeEntry.data.lastPlanFile ?? lastPlanFile;
		}

		// On resume: re-scan messages to rebuild completion state
		// Only scan messages AFTER the last "plan-mode-execute" to avoid picking up [DONE:n] from previous plans
		const isResume = planModeEntry !== undefined;
		if (isResume && executionMode && todoItems.length > 0) {
			// Find the index of the last plan-mode-execute entry (marks when current execution started)
			let executeIndex = -1;
			for (let i = entries.length - 1; i >= 0; i--) {
				const entry = entries[i] as { type: string; customType?: string };
				if (entry.customType === "plan-mode-execute") {
					executeIndex = i;
					break;
				}
			}

			// Only scan messages after the execute marker
			const messages: AssistantMessage[] = [];
			for (let i = executeIndex + 1; i < entries.length; i++) {
				const entry = entries[i];
				if (entry.type === "message" && "message" in entry && isAssistantMessage(entry.message as AgentMessage)) {
					messages.push(entry.message as AssistantMessage);
				}
			}
			const allText = messages.map(getTextContent).join("\n");
			markCompletedSteps(allText, todoItems);
		}

		if (planModeEnabled) {
			enablePlanModeTools();
		}
		updateStatus(ctx);
	});
}
