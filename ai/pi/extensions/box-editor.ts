/**
 * Box Editor — restyle the input editor as a borderless dark panel instead of
 * the default two horizontal rules.
 *
 * Subclasses CustomEditor and post-processes super.render(): the editor is
 * rendered narrower (OUTER_MARGIN blank cols each side), every line is filled
 * with a dark background (EDITOR_BG, re-applied after embedded SGR resets so
 * the fake cursor doesn't punch holes in it), and the top/bottom border lines
 * become blank padding rows. A half-block ▌ accent bar runs down the left of
 * every row — padding rows included, so it continues through the
 * autocomplete menu — colored with this.borderColor (quiet at rest,
 * thinking-level/bash colors when active). Scroll-indicator borders keep
 * only their "↑ N more" text.
 */

import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const stripAnsi = (s: string): string => s.replace(ANSI_RE, "");
// Top/bottom border lines in super.render() output: a run of ─, or the
// scroll-indicator variant ("─── ↑ 3 more ─────").
const isBorderLine = (s: string): boolean =>
	/^[─ ]+$/.test(stripAnsi(s)) || /^─+ [↑↓] \d+ more ─+$/.test(stripAnsi(s));

// Layout knobs: blank cols on each side of the panel (screen edge), blank
// cols between panel edge and text, and the panel background (#1c222b — well
// below the pane's base00 #2b303b; for a near-black panel try 22;26;32).
const OUTER_MARGIN = 2;
const INNER_PAD = 1;
const EDITOR_BG = "\x1b[48;2;28;34;43m";
const BG_RESET = "\x1b[49m";

/** Apply EDITOR_BG across a line, re-applying after any embedded SGR reset
 *  (the fake cursor emits \x1b[0m, which would otherwise clear the bg). */
const withBg = (s: string): string =>
	EDITOR_BG + s.replace(/(\x1b\[(?:0|39|49)m)/g, `$1${EDITOR_BG}`) + BG_RESET;

/** Restyle super.render() output as a borderless dark panel. Exported for testing. */
export function boxifyLines(
	lines: string[],
	boxWidth: number,
	border: (s: string) => string,
): string[] {
	const bar = border("▌"); // left accent bar, thinking-level/bash colored
	const textWidth = boxWidth - 1 - INNER_PAD * 2; // -1 for the bar
	const margin = " ".repeat(OUTER_MARGIN);
	const padIn = " ".repeat(INNER_PAD);
	const padTo = (s: string): string => s + " ".repeat(Math.max(0, textWidth - visibleWidth(s)));
	const blankRow = withBg(bar + " ".repeat(boxWidth - 1));

	// Border lines become blank padding rows, except scroll indicators,
	// which keep just their "↑ N more" text (borderColor = thinking tint).
	const borderRow = (line: string): string => {
		const m = stripAnsi(line).match(/([↑↓]) (\d+) more/);
		if (!m) return blankRow;
		return withBg(bar + padIn + padTo(border(`${m[1]} ${m[2]} more`)) + padIn);
	};

	// The input area's bottom border = last border-shaped line. Any lines
	// after it are the autocomplete menu; add one trailing padding row so the
	// panel closes with the same spacing it opened with.
	let bottomIdx = -1;
	for (let i = lines.length - 1; i > 0; i--) {
		if (isBorderLine(lines[i]!)) {
			bottomIdx = i;
			break;
		}
	}
	const hasMenu = bottomIdx > 0 && bottomIdx < lines.length - 1;

	// When the menu is open, the input's bottom border becomes a horizontal
	// rule separating input from menu options.
	const dividerRow = withBg(bar + padIn + border("─".repeat(textWidth)) + padIn);

	const out = lines.map((line, i) => {
		let row: string;
		if (i === bottomIdx && hasMenu) row = dividerRow;
		else if (isBorderLine(line)) row = borderRow(line);
		else row = withBg(bar + padIn + padTo(line) + padIn);
		return margin + row + margin;
	});
	if (hasMenu) out.push(margin + blankRow + margin);
	return out;
}

export class BoxEditor extends CustomEditor {
	render(width: number): string[] {
		const boxWidth = width - OUTER_MARGIN * 2;
		if (boxWidth < 8) return super.render(width); // too narrow for a panel

		const textWidth = boxWidth - 1 - INNER_PAD * 2; // -1 for the accent bar
		const lines = super.render(textWidth);
		return boxifyLines(lines, boxWidth, (s) => this.borderColor(s));
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setEditorComponent(
			(tui, theme, keybindings) => new BoxEditor(tui, theme, keybindings),
		);
	});
}
