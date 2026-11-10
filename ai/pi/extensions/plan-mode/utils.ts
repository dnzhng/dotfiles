/**
 * Pure utility functions for plan mode.
 * Extracted for testability.
 */

const cmdWords = (...words: string[]): RegExp[] =>
	words.map((word) => new RegExp(`(?<![\\w.-])(?:${word})(?![\\w./-])`, "i"));

// Destructive commands blocked in plan mode
const DESTRUCTIVE_PATTERNS = [
	...cmdWords("rm", "rmdir", "mv", "cp", "mkdir", "touch", "chmod", "chown", "chgrp", "ln", "tee", "truncate", "dd", "shred"),
	/@P\s*\}/,
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
	...cmdWords("sudo", "su", "kill", "pkill", "killall"),
	/\breboot\b/i,
	/\bshutdown\b/i,
	/\bsystemctl\s+(start|stop|restart|enable|disable)/i,
	/\bservice\s+\S+\s+(start|stop|restart)/i,
	...cmdWords("vi", "vim", "nano", "emacs", "code", "subl"),
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
	/^\s*read\b/,
	/^\s*(?:test\b|\[\s)/,
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
	/^\s*git(?:\s+-C\s+\S+)*\s+(status|log|diff|show|branch|remote|grep|blame|rev-parse|describe|shortlog|worktree\s+list|config\s+--get)/,
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

function isSafeSegment(segment: string): boolean {
	let command = segment.trim();
	while (/^(?:(?:if|then|else|elif|do|while|until)\b|!)\s*/.test(command)) {
		command = command.replace(/^(?:(?:if|then|else|elif|do|while|until)\b|!)\s*/, "");
	}
	command = command.replace(/^\{\s*/, "").trim();
	if (!command || /^["'<>$]+$/.test(command) || /^(?:done|fi|esac|})\s*$/.test(command)) return true;
	if (/^cd(?:\s|$)/.test(command) || /^for\s+\w+\s+in\b/.test(command)) return true;
	if (command.match(/^\S+/)?.[0].includes("/")) return false;
	if (/^\s*read\b/.test(command) && /[\[$`]/.test(command)) return false;
	return SAFE_PATTERNS.some((pattern) => pattern.test(command));
}

export function isSafeCommand(command: string): boolean {
	if (!command.trim() || /(?<!<)<<(?!<)/.test(command)) return false;
	const unquoted = command.replace(/['"\\]/g, "");
	if (
		/\$\{!|\(\(|\$\[|\$\{[^}]*\[|\$\{[^}]*:(?![-=?+])/.test(command) ||
		/(?:\btest|\[)(?=\s)[^;&|\n]*-v/.test(unquoted) ||
		/(?<![\w.-])printf\b[^;&|\n]*-v/.test(command) ||
		/(?<![\w.-])read\b[^;&|\n]*['"\\\[$`]/.test(command)
	) return false;
	// Benign redirects (stderr to stdout, anything to /dev/null) write no files — strip before matching
	const sanitized = command
		.replace(/[12&]?>{1,2}\s*(?:&[12]|\/dev\/null)\b/g, "")
		.replace(/[12&]?>{1,2}\s*\/tmp\/(?![^\s;|&]*\.\.)[\w./-]+(?=$|[\s;|&)<])/g, "");
	const isDestructive = DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(sanitized));
	if (isDestructive) return false;

	let hasMultilineQuote = false;
	let hasComplexSubstitution = false;
	const masked = sanitized.replace(/\$'(?:[^'\\]|\\[\s\S])*'|'[^']*'|"(?:[^"\\]|\\[\s\S])*"|\\[\s\S]/g, (match) => {
		if (match.includes("\n")) hasMultilineQuote = true;
		if (match.startsWith('"') && /\$\(|`/.test(match)) {
			if (!/^"(?:[^"\\$`]|\\.|\$(?!\()|\$\([^()"`]*\))*"$/.test(match)) hasComplexSubstitution = true;
			return match;
		}
		return "_".repeat(match.length);
	});
	if (hasMultilineQuote || hasComplexSubstitution || /(^|\s)#/.test(masked)) return false;
	const segments = masked.split(/[;&|\n()`]+/);
	return segments.length > 0 && segments.every(isSafeSegment);
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
	return cleaned;
}

export function extractTodoItems(message: string): TodoItem[] {
	const items: TodoItem[] = [];
	// Header line: "Plan:" bare, "**Plan:**", or a markdown header ("## Plan" / "## Plan:") —
	// the colon is optional because models harmonize it with the surrounding ## sections.
	const headerMatch = message.match(/^\s{0,3}(?:#{1,6}\s*)?\*{0,2}Plan:?\*{0,2}[ \t]*$/im);
	if (!headerMatch) return items;

	let planSection = message.slice(message.indexOf(headerMatch[0]) + headerMatch[0].length);
	// The plan section ends at the next markdown header or rule — numbered lists in later
	// sections (## Verification, etc.) are not plan steps.
	const sectionEnd = planSection.search(/^#{1,6}\s|^[ \t]*-{3,}[ \t]*$/m);
	if (sectionEnd >= 0) planSection = planSection.slice(0, sectionEnd);
	const numberedPattern = /^\s*(\d+)[.)]\s+(.+)$/gm;

	for (const match of planSection.matchAll(numberedPattern)) {
		const text = match[2].trim();
		if (text.length > 5 && !text.startsWith("/") && !text.startsWith("-")) {
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
	for (const match of message.matchAll(/\[DONE\s*:?\s*(\d+)\]/gi)) {
		steps.push(Number(match[1]));
	}
	for (const match of message.matchAll(/(?<!\bnot\s+)\bDone\s*:\s*(\d+)\b/gi)) {
		steps.push(Number(match[1]));
	}
	for (const match of message.matchAll(
		/(?:^|[.!?]\s+)\s*(?:[-*]\s+)?Step\s*(\d+)\s+(?:is\s+)?(?:done|complete|completed|finished)(?=[.!](?:\s|$)|\s*$)/gim,
	)) {
		steps.push(Number(match[1]));
	}
	return [...new Set(steps)];
}

export function markCompletedSteps(text: string, items: TodoItem[]): number {
	const doneSteps = extractDoneSteps(text);
	let marked = 0;
	for (const step of doneSteps) {
		const item = items.find((t) => t.step === step && !t.completed);
		if (item) {
			item.completed = true;
			marked++;
		}
	}
	return marked;
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

/** Creation date parsed from a plan filename (YYYYMMDD-HHMMSS-<slug>.md, local time); undefined for non-plan files (e.g. README.md). */
export function planFileDate(name: string): Date | undefined {
	const match = name.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-.+\.md$/);
	if (!match) return undefined;
	return new Date(
		Number(match[1]),
		Number(match[2]) - 1,
		Number(match[3]),
		Number(match[4]),
		Number(match[5]),
		Number(match[6]),
	);
}

/** True when the plan's frontmatter carries `permanent: true` (exempt from age-based cleanup). */
export function isPermanentPlan(content: string): boolean {
	const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
	return frontmatter?.[1] ? /^permanent:[ \t]*true[ \t]*$/m.test(frontmatter[1]) : false;
}

/** Mark a plan permanent by adding `permanent: true` to its frontmatter (created if absent). */
export function markPlanPermanent(content: string): string {
	const frontmatter = content.match(/^(---\n[\s\S]*?\n)---\n?/);
	if (frontmatter?.[1]) {
		return content.replace(frontmatter[0], `${frontmatter[1]}permanent: true\n---\n`);
	}
	return `---\npermanent: true\n---\n\n${content}`;
}

/** Sortable, collision-resistant plan filename: YYYYMMDD-HHMMSS-<slug>.md (local time). */
export function planFileName(title: string, date: Date): string {
	const pad = (n: number): string => String(n).padStart(2, "0");
	const stamp =
		`${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
		`-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
	return `${stamp}-${slugify(title)}.md`;
}
