/**
 * Splash — centered startup header for new sessions.
 *
 * Uses the public ctx.ui.setHeader() API to replace the built-in startup
 * header with a two-column splash: the block-letter pi logo in the theme
 * accent color above session info (version / model / branch / cwd) on the
 * left, loaded resources (context / skills / prompts / extensions / themes)
 * on the right — equal-width columns separated by a thin vertical divider. The resource lists are
 * gathered from ~/.pi/agent + settings.json (pi's resourceLoader isn't
 * extension-visible); themes come from ctx.ui.getAllThemes(). Stacks to one
 * column on narrow terminals. Designed to pair with "Quiet startup" in settings, which hides
 * pi's own resources list so it isn't duplicated below the splash. Applied
 * on startup, new, and reload; skipped on resume/fork.
 */

import { VERSION, type ExtensionAPI, type Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Block-letter pi logo.
const LOGO = [
	"████████████    ",
	"████████████    ",
	"████    ████    ",
	"████    ████    ",
	"████████    ████",
	"████████    ████",
	"████        ████",
	"████        ████",
];

const DIVIDER_GAP = 2; // spaces on each side of the │ column divider
const MIN_TWO_COLUMN_WIDTH = 64;
const RIGHT_COLUMN_MAX = 52;
// Vertical fill target: leave room for the editor/footer dock plus slack so
// the end-following scroll view never clips the logo.
const DOCK_RESERVE = 9;

interface SplashInfo {
	version: string;
	model: string;
	cwd: string;
	branch: string | null;
	sections: [string, string[]][];
}

const centerPad = (lineWidth: number, width: number): string =>
	" ".repeat(Math.max(0, Math.floor((width - lineWidth) / 2)));

/** Word-wrap "a, b, c" into lines of at most width visible columns. */
function wrapList(text: string, width: number): string[] {
	const words = text.split(" ");
	const lines: string[] = [];
	let current = "";
	for (const word of words) {
		const candidate = current ? `${current} ${word}` : word;
		if (visibleWidth(candidate) > width && current) {
			lines.push(current);
			current = word;
		} else {
			current = candidate;
		}
	}
	if (current) lines.push(current);
	return lines.length ? lines : [""];
}

/** Names of entries in dir, following symlinks, ext stripped. mode selects dirs, files, or both. */
function entryNames(dir: string, mode: "dirs" | "files" | "both" = "files"): string[] {
	try {
		return readdirSync(dir)
			.filter((name) => {
				try {
					const isDir = statSync(join(dir, name)).isDirectory(); // follows symlinks
					return mode === "both" ? true : mode === "dirs" ? isDir : !isDir;
				} catch {
					return false;
				}
			})
			.map((name) => name.replace(/\.(ts|md|json)$/, ""));
	} catch {
		return [];
	}
}

function gatherSections(cwd: string, home: string, themeNames: string[]): [string, string[]][] {
	const piDir = join(home, ".pi", "agent");
	let settings: { packages?: string[]; skills?: string[] } = {};
	try {
		settings = JSON.parse(readFileSync(join(piDir, "settings.json"), "utf8"));
	} catch {
		// no settings yet — show what we can
	}
	const packages = (settings.packages ?? []).map((p) => p.replace(/^npm:/, ""));
	const skillDirs = (settings.skills ?? []).map((d) => d.replace(/^~/, home));

	const context: string[] = [];
	if (existsSync(join(piDir, "AGENTS.md"))) context.push("~/.pi/agent/AGENTS.md");
	if (existsSync(join(cwd, "AGENTS.md"))) context.push("./AGENTS.md");

	const skills = new Set<string>();
	for (const base of [join(piDir, "skills"), ...skillDirs]) {
		for (const name of entryNames(base, "dirs")) skills.add(name);
	}
	for (const pkg of packages) {
		for (const name of entryNames(join(piDir, "npm", "node_modules", pkg, "skills"), "dirs")) {
			skills.add(name);
		}
	}

	const prompts = new Set<string>();
	for (const name of entryNames(join(piDir, "prompts"))) prompts.add(`/${name}`);
	for (const pkg of packages) {
		for (const name of entryNames(join(piDir, "npm", "node_modules", pkg, "prompts"))) {
			prompts.add(`/${name}`);
		}
	}

	const extensions = [...entryNames(join(piDir, "extensions"), "both"), ...packages].sort();

	return [
		["Context", context],
		["Skills", [...skills].sort()],
		["Prompts", [...prompts].sort()],
		["Extensions", extensions],
		["Themes", themeNames],
	];
}

function gitBranch(cwd: string): string | null {
	try {
		return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
			cwd,
			stdio: ["ignore", "pipe", "ignore"],
		}).toString().trim() || null;
	} catch {
		return null;
	}
}

export class SplashHeader {
	private cachedWidth?: number;
	private cachedRows?: number;
	private cachedLines?: string[];

	constructor(
		private theme: Theme,
		private info: SplashInfo,
		private getRows: () => number,
	) {}

	invalidate(): void {
		this.cachedWidth = this.cachedRows = this.cachedLines = undefined;
	}

	private infoLines(): { styled: string[]; plain: string[] } {
		const { theme, info } = this;
		const dim = (s: string) => theme.fg("dim", s);
		const muted = (s: string) => theme.fg("muted", s);
		const pairs: [string, string][] = [
			["version", info.version],
			["model", info.model],
			...(info.branch ? [["branch", info.branch] as [string, string]] : []),
			["cwd", info.cwd],
		];
		const labelW = Math.max(...pairs.map(([k]) => k.length));
		return {
			styled: pairs.map(([k, v]) => dim(k.padStart(labelW)) + "  " + muted(v)),
			plain: pairs.map(([k, v]) => `${k.padStart(labelW)}  ${v}`),
		};
	}

	private sectionLines(colWidth: number): string[] {
		const { theme, info } = this;
		const heading = (s: string) => theme.fg("mdHeading", s);
		const dim = (s: string) => theme.fg("dim", s);
		const lines: string[] = [];
		for (const [name, items] of info.sections) {
			lines.push(heading(`[${name}]`));
			const body = items.length ? items.join(", ") : "—";
			for (const wrapped of wrapList(body, colWidth - 2)) {
				lines.push(dim(`  ${wrapped}`));
			}
		}
		return lines;
	}

	render(width: number): string[] {
		const rows = this.getRows();
		if (this.cachedLines && this.cachedWidth === width && this.cachedRows === rows) {
			return this.cachedLines;
		}
		const { theme } = this;
		const accent = (s: string) => theme.bold(theme.fg("accent", s));
		const dim = (s: string) => theme.fg("dim", s);

		const info = this.infoLines();
		const infoW = Math.max(...info.plain.map((l) => l.length));
		const logoW = Math.max(...LOGO.map((row) => visibleWidth(row)));
		const dividerW = 1 + DIVIDER_GAP * 2;
		// Equal-width columns: the left column grows past its content width up
		// to RIGHT_COLUMN_MAX so both sides match; its content stays centered.
		const minLeftW = Math.max(logoW, infoW);
		const leftW = Math.max(minLeftW, Math.min(RIGHT_COLUMN_MAX, Math.floor((width - dividerW) / 2)));
		const rightW = Math.min(leftW, Math.max(20, width - leftW - dividerW));
		const twoCol = width >= MIN_TWO_COLUMN_WIDTH && leftW + dividerW + 20 <= width;

		// Left column: logo and session-info block centered within the column.
		// In two-column mode the eye measures padding to the divider, not the
		// nominal column edge, so center against the column plus the gap left
		// of the divider; round biases any odd remainder left so the right pad
		// never reads larger. Clamped so full-width content can't overflow.
		const visualLeftW = twoCol ? leftW + DIVIDER_GAP : leftW;
		const logoPad = " ".repeat(Math.min(Math.round((visualLeftW - logoW) / 2), leftW - logoW));
		const infoPad = " ".repeat(Math.min(Math.round((visualLeftW - infoW) / 2), leftW - infoW));
		const leftLines = [...LOGO.map((row) => logoPad + accent(row)), "", ...info.styled.map((line) => infoPad + line)];

		const content: string[] = [];
		if (twoCol) {
			const sections = this.sectionLines(rightW);
			const blockW = leftW + dividerW + rightW;
			const left = centerPad(blockW, width);
			const rowCount = Math.max(leftLines.length, sections.length);
			// Vertically center the left column against the taller sections list.
			const leftTop = Math.max(0, Math.floor((rowCount - leftLines.length) / 2));
			for (let i = 0; i < rowCount; i++) {
				const li = i - leftTop;
				const leftCell =
					li >= 0 && li < leftLines.length
						? leftLines[li]! + " ".repeat(Math.max(0, leftW - visibleWidth(leftLines[li]!)))
						: " ".repeat(leftW);
				const right = sections[i] ?? "";
				content.push(left + leftCell + " ".repeat(DIVIDER_GAP) + dim("│") + " ".repeat(DIVIDER_GAP) + right);
			}
		} else {
			const sections = this.sectionLines(Math.min(RIGHT_COLUMN_MAX, Math.max(20, width - 4)));
			const blockW = Math.max(leftW, RIGHT_COLUMN_MAX);
			const left = centerPad(blockW, width);
			for (const line of leftLines) content.push(left + line);
			content.push("");
			for (const line of sections) content.push(left + line);
		}

		// Vertically center within the estimated viewport (terminal minus the
		// editor/footer dock). Emit no bottom fill: the end-following scroll
		// view shows the header from the top, and the blank space below is the
		// empty chat area anyway.
		const viewport = Math.max(content.length, rows - DOCK_RESERVE);
		const topPad = Math.max(0, Math.floor((viewport - content.length) / 2));
		const result: string[] = [...Array.from({ length: topPad }, () => ""), ...content];

		this.cachedWidth = width;
		this.cachedRows = rows;
		this.cachedLines = result;
		return result;
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (event, ctx) => {
		if (event.reason === "resume" || event.reason === "fork") return;

		const cwd = ctx.sessionManager.getCwd();
		const home = homedir();
		const themeNames = ctx.ui
			.getAllThemes()
			.map((t) => t.name)
			.filter((n) => n !== "dark" && n !== "light")
			.sort();
		const info: SplashInfo = {
			version: `v${VERSION}`,
			model: ctx.model ? `${ctx.model.id} (${ctx.model.provider})` : "no model",
			cwd: cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd,
			branch: gitBranch(cwd),
			sections: gatherSections(cwd, home, themeNames),
		};
		ctx.ui.setHeader(
			(tui, theme) => new SplashHeader(theme, info, () => tui.terminal.rows),
		);
	});
}
