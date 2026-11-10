import { describe, expect, test } from "bun:test";
import {
	extractDoneSteps,
	extractTodoItems,
	markCompletedSteps,
	type TodoItem,
} from "../extensions/plan-mode/utils.ts";

const FULL_STEP =
	"**Investigate** the `plan-mode` parser path for steps that contain **bold**, `code`, and a long verify command — verify: bun test ai/pi/tests/plan-mode-progress.test.ts";
const FULL_STEP_TEXT =
	"Investigate the plan-mode parser path for steps that contain bold, code, and a long verify command — verify: bun test ai/pi/tests/plan-mode-progress.test.ts";

const makeTodos = (): TodoItem[] => [
	{ step: 1, text: "First step", completed: false },
	{ step: 2, text: "Second step", completed: false },
];

describe("extractTodoItems", () => {
	test("keeps full formatted step text", () => {
		const items = extractTodoItems(["## Plan", `1. ${FULL_STEP}`, "2. Document the parser change"].join("\n"));

		expect(items.map((item) => item.text)).toEqual([FULL_STEP_TEXT, "Document the parser change"]);
		expect(items[0]?.text.endsWith("...")).toBe(false);
	});

	test("cleans formatting that closes at the end of a step", () => {
		const items = extractTodoItems(
			["Plan:", "1. **Investigate the parser change**", "2. Verify the **parser behavior**"].join("\n"),
		);

		expect(items.map((item) => item.text)).toEqual(["Investigate the parser change", "Parser behavior"]);
	});

	test("reads a markdown Plan header without a colon", () => {
		const items = extractTodoItems(
			["## Plan", "1. Implement the parser change", "2. Document the parser change"].join("\n"),
		);

		expect(items.map((item) => item.text)).toEqual(["Implement the parser change", "Document the parser change"]);
	});

	test("stops at the next section boundary", () => {
		const items = extractTodoItems(
			[
				"## Plan",
				"1. Implement the parser change",
				"",
				"## Verification",
				"1. Run the full test suite",
				"",
				"---",
				"1. Document the result",
			].join("\n"),
		);

		expect(items.map((item) => item.text)).toEqual(["Implement the parser change"]);
	});

	test("keeps steps that start with inline code", () => {
		const items = extractTodoItems(["Plan:", "1. `src/foo.ts` needs a parser guard"].join("\n"));

		expect(items.map((item) => item.text)).toEqual(["Src/foo.ts needs a parser guard"]);
	});
});

describe("extractDoneSteps", () => {
	test("recognizes bracket and plain-text marker variants", () => {
		expect(extractDoneSteps("[DONE:1] [DONE: 2] [DONE 3] [Done:4] Done: 5")).toEqual([1, 2, 3, 4, 5]);
	});

	test("recognizes affirmative Step variants", () => {
		expect(
			extractDoneSteps("Step 6 is complete. Step 7 done. Step 8 finished. Step 9 completed. Step 10 is done."),
		).toEqual([6, 7, 8, 9, 10]);
	});

	test("deduplicates repeated markers", () => {
		expect(extractDoneSteps("[DONE:1] [DONE 1] [Done: 1] Done: 1 Step 1 is complete")).toEqual([1]);
	});

	test("ignores negative phrasing", () => {
		const text =
			"Step 1 is not done. Step 2 incomplete. Step 3 is not complete. Step 4 isn't finished. Not done: 5.";
		expect(extractDoneSteps(text)).toEqual([]);
	});

	test.each([
		"Once Step 1 is complete, continue to the next step.",
		"If Step 1 is complete, start step 2.",
		"Not Step 1 done.",
		"Step 1 is complete?",
		"Step 1 is complete, except for verification.",
		"The example says `Step 1 is complete`.",
	])("ignores non-affirmative step references: %s", (text) => {
		expect(extractDoneSteps(text)).toEqual([]);
	});

	test("ignores markers that are not completion tags", () => {
		expect(extractDoneSteps("[DONE] [DONE:x] [TODO:1] DONE 1")).toEqual([]);
	});
});

describe("markCompletedSteps", () => {
	test("marks each step once even when completion is reported repeatedly", () => {
		const todos = makeTodos();

		expect(markCompletedSteps("[DONE:1] [DONE 1] Done: 1 Step 1 is complete", todos)).toBe(1);
		expect(todos[0]?.completed).toBe(true);
		expect(markCompletedSteps("Step 1 is complete", todos)).toBe(0);
	});

	test("ignores markers for steps that are not in the plan", () => {
		const todos = makeTodos();

		expect(markCompletedSteps("[DONE:99] Done: 42", todos)).toBe(0);
		expect(todos.every((item) => !item.completed)).toBe(true);
	});

	test("does not mark steps on negative phrasing", () => {
		const todos = makeTodos();

		expect(markCompletedSteps("Step 1 is not done. Step 2 incomplete. Not done: 1.", todos)).toBe(0);
		expect(todos.every((item) => !item.completed)).toBe(true);
	});
});
