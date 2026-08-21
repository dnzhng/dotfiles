/**
 * Pure utility functions for plan mode.
 * Extracted for testability.
 */

// Destructive commands blocked in plan mode
const DESTRUCTIVE_PATTERNS = [
	/\brm\b/i,
	/\brmdir\b/i,
	/\bmv\b/i,
	/\bcp\b/i,
	/\bmkdir\b/i,
	/\btouch\b/i,
	/\bchmod\b/i,
	/\bchown\b/i,
	/\bchgrp\b/i,
	/\bln\b/i,
	/\btee\b/i,
	/\btruncate\b/i,
	/\bdd\b/i,
	/\bshred\b/i,
	/(^|[^<])>(?!>)/,
	/>>/,
	/\bnpm\s+(install|uninstall|update|ci|link|publish)/i,
	/\byarn\s+(add|remove|install|publish)/i,
	/\bpnpm\s+(add|remove|install|publish)/i,
	/\bpip\s+(install|uninstall)/i,
	/\bapt(-get)?\s+(install|remove|purge|update|upgrade)/i,
	/\bbrew\s+(install|uninstall|upgrade)/i,
	/\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|branch\s+-[dD]|stash(?!\s+(list|show)\b)|cherry-pick|revert|tag|init|clone)/i,
	/\bgh\s+api\b[^|;&]*(-[fFX]\b|--field|--raw-field|--input|--method)/i,
	/\bsudo\b/i,
	/\bsu\b/i,
	/\bkill\b/i,
	/\bpkill\b/i,
	/\bkillall\b/i,
	/\breboot\b/i,
	/\bshutdown\b/i,
	/\bsystemctl\s+(start|stop|restart|enable|disable)/i,
	/\bservice\s+\S+\s+(start|stop|restart)/i,
	/\b(vim?|nano|emacs|code|subl)\b/i,
];

// Safe read-only commands allowed in plan mode
const SAFE_PATTERNS = [
	/^\s*cat\b/,
	/^\s*head\b/,
	/^\s*tail\b/,
	/^\s*less\b/,
	/^\s*more\b/,
	/^\s*grep\b/,
	/^\s*find\b/,
	/^\s*ls\b/,
	/^\s*pwd\b/,
	/^\s*echo\b/,
	/^\s*printf\b/,
	/^\s*wc\b/,
	/^\s*sort\b/,
	/^\s*uniq\b/,
	/^\s*diff\b/,
	/^\s*file\b/,
	/^\s*stat\b/,
	/^\s*du\b/,
	/^\s*df\b/,
	/^\s*tree\b/,
	/^\s*which\b/,
	/^\s*whereis\b/,
	/^\s*type\b/,
	/^\s*env\b/,
	/^\s*printenv\b/,
	/^\s*uname\b/,
	/^\s*whoami\b/,
	/^\s*id\b/,
	/^\s*date\b/,
	/^\s*cal\b/,
	/^\s*uptime\b/,
	/^\s*ps\b/,
	/^\s*top\b/,
	/^\s*htop\b/,
	/^\s*free\b/,
	/^\s*git(?:\s+-C\s+\S+)*\s+(status|log|diff|show|branch|remote|config\s+--get)/,
	/^\s*git(?:\s+-C\s+\S+)*\s+ls-/,
	/^\s*git(?:\s+-C\s+\S+)*\s+stash\s+(list|show)\b/,
	/^\s*gh\s+(pr\s+(view|list|diff|checks|status)\b|issue\s+(view|list|status)\b|release\s+(view|list)\b|repo\s+(view|list)\b|run\s+(list|view)\b|workflow\s+(list|view)\b|search\b|api\b|status\b|auth\s+status\b)/i,
	/^\s*npm\s+(list|ls|view|info|search|outdated|audit)/i,
	/^\s*yarn\s+(list|info|why|audit)/i,
	/^\s*node\s+--version/i,
	/^\s*python\s+--version/i,
	/^\s*curl\s/i,
	/^\s*wget\s+-O\s*-/i,
	/^\s*jq\b/,
	/^\s*sed\s+-n/i,
	/^\s*awk\b/,
	/^\s*rg\b/,
	/^\s*fd\b/,
	/^\s*bat\b/,
	/^\s*eza\b/,
	/^\s*cut\b/,
	/^\s*column\b/,
	/^\s*tr\b/,
	/^\s*paste\b/,
	/^\s*nl\b/,
	/^\s*comm\b/,
	/^\s*strings\b/,
	/^\s*readlink\b/,
	/^\s*realpath\b/,
	/^\s*basename\b/,
	/^\s*dirname\b/,
];

export function isSafeCommand(command: string): boolean {
	// Benign redirects (stderr to stdout, anything to /dev/null) write no files — strip before matching
	const sanitized = command.replace(/[12&]?>{1,2}\s*(?:&[12]|\/dev\/null)\b/g, "");
	const isDestructive = DESTRUCTIVE_PATTERNS.some((p) => p.test(sanitized));
	const isSafe = SAFE_PATTERNS.some((p) => p.test(sanitized));
	return !isDestructive && isSafe;
}

export interface TodoItem {
	step: number;
	text: string;
	completed: boolean;
}

export function cleanStepText(text: string): string {
	let cleaned = text
		.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1") // Remove bold/italic
		.replace(/`([^`]+)`/g, "$1") // Remove code
		.replace(
			/^(Use|Run|Execute|Create|Write|Read|Check|Verify|Update|Modify|Add|Remove|Delete|Install)\s+(the\s+)?/i,
			"",
		)
		.replace(/\s+/g, " ")
		.trim();

	if (cleaned.length > 0) {
		cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
	}
	if (cleaned.length > 50) {
		cleaned = `${cleaned.slice(0, 47)}...`;
	}
	return cleaned;
}

export function extractTodoItems(message: string): TodoItem[] {
	const items: TodoItem[] = [];
	const headerMatch = message.match(/\*{0,2}Plan:\*{0,2}\s*\n/i);
	if (!headerMatch) return items;

	let planSection = message.slice(message.indexOf(headerMatch[0]) + headerMatch[0].length);
	// The plan section ends at the next markdown header or rule — numbered lists in later
	// sections (## Verification, etc.) are not plan steps.
	const sectionEnd = planSection.search(/^#{1,6}\s|^[ \t]*-{3,}[ \t]*$/m);
	if (sectionEnd >= 0) planSection = planSection.slice(0, sectionEnd);
	const numberedPattern = /^\s*(\d+)[.)]\s+\*{0,2}([^*\n]+)/gm;

	for (const match of planSection.matchAll(numberedPattern)) {
		const text = match[2]
			.trim()
			.replace(/\*{1,2}$/, "")
			.trim();
		if (text.length > 5 && !text.startsWith("`") && !text.startsWith("/") && !text.startsWith("-")) {
			const cleaned = cleanStepText(text);
			if (cleaned.length > 3) {
				items.push({ step: items.length + 1, text: cleaned, completed: false });
			}
		}
	}
	return items;
}

export function extractDoneSteps(message: string): number[] {
	const steps: number[] = [];
	for (const match of message.matchAll(/\[DONE:(\d+)\]/gi)) {
		const step = Number(match[1]);
		if (Number.isFinite(step)) steps.push(step);
	}
	return steps;
}

export function markCompletedSteps(text: string, items: TodoItem[]): number {
	const doneSteps = extractDoneSteps(text);
	for (const step of doneSteps) {
		const item = items.find((t) => t.step === step);
		if (item) item.completed = true;
	}
	return doneSteps.length;
}

/**
 * Extract the plan title from a "Title: ..." line (tolerates markdown bold); undefined if absent.
 * The title names the actual work, so it's a better filename slug than the raw user request.
 */
export function extractPlanTitle(message: string): string | undefined {
	const match = message.match(/^\s*(?:\*\*)?Title:(?:\*\*)?\s+(.+)$/im);
	const title = match?.[1]?.replace(/\*+$/, "").trim();
	return title ? title : undefined;
}

/** Kebab-case slug from free text (first 6 words, <=50 chars); "plan" if nothing usable. */
export function slugify(text: string): string {
	const slug = text
		.toLowerCase()
		.replace(/['"]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.split("-")
		.filter(Boolean)
		.slice(0, 6)
		.join("-")
		.slice(0, 50)
		.replace(/-+$/g, "");
	return slug || "plan";
}

/** Sortable, collision-resistant plan filename: YYYYMMDD-HHMMSS-<slug>.md (local time). */
export function planFileName(title: string, date: Date): string {
	const pad = (n: number): string => String(n).padStart(2, "0");
	const stamp =
		`${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
		`-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
	return `${stamp}-${slugify(title)}.md`;
}
