/**
 * Max Width — constrain the chat transcript to a left-justified column of
 * MAX_WIDTH in both regular and fullscreen TUI modes.
 *
 * pi has no native max-content-width (theme tokens are colors-only, there is
 * no layout hook), so this patches two internal chokepoints:
 *
 * Regular mode: TuiBase's render(width), which doRender() calls each frame
 * and which renders every child (chat, editor, footer) at the given width.
 * The wrapper renders the transcript at min(width, MAX_WIDTH) and pads the
 * lines back out with blank margin on the right.
 *
 * Fullscreen mode: TuiAltScreen overrides render() and routes layout through
 * renderLayoutFrame(), which sizes the transcript viewport via
 * ScrollView.getContentWidth(). The wrapper caps that to MAX_WIDTH for the
 * PRIMARY scroll view only (pi marks the transcript `primary: true`); the
 * layout engine pads composited lines out to full width, the dock stays
 * full-width, and the scrollbar keeps its home at the terminal's right edge.
 *
 * Side-panel splice: when the side-panel extension publishes panel lines on the
 * Symbol.for("dotfiles.side-panel.v1") bus (./side-panel/bus.ts), they are
 * spliced into the blank margin at column MAX_WIDTH+2 — regular mode: into the
 * wrapper's padding, pinned to the top of the visible transcript rows and never
 * past the transcript/dock boundary; fullscreen: in a compositeOverlays wrapper
 * (TuiAltScreen.prototype — ScrollView.render is NOT on the fullscreen layout
 * path: renderLayoutFrame only calls getContentWidth + the child's render),
 * pinned to screen rows 0..viewportHeight-1 so the dock can never be covered.
 * With no bus content (side-panel absent, or nothing to show) output is
 * byte-identical to before. If you change MAX_WIDTH, also change it in
 * side-panel/index.ts — the panel width math keys off it.
 *
 * The patches go on PROTOTYPES, not instances: extensions only ever see pi's
 * renderer through a proxy (createInteractiveTuiReference) that forwards
 * method calls but swallows property writes, so instance patching is
 * impossible. TuiMainScreen inherits render() from TuiBase; TuiAltScreen
 * overrides it — hence the second patch on ScrollView.
 *
 * Scope: only the chat transcript is capped — the regular-mode layout mounts
 * documentContainer as the first TUI child, followed by pending/status/
 * widget/editor/footer containers, which all stay full-width; fullscreen
 * docks those same containers below the transcript scroll view. Content is
 * left-justified (padding goes on the right). If the child structure ever
 * changes, the regular-mode wrapper falls back to the stock render unchanged.
 *
 * Fragile by design: private-API monkey-patch. If a pi update changes the
 * internals, the guards decline to patch and pi renders normally — it should
 * never break a session. Idempotent via Symbol guards; safe across /reload.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ScrollView, TuiAltScreen, TuiMainScreen, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { getBus } from "./side-panel/bus.ts";

// Column cap in terminal columns. Content is left-justified; the transcript
// is padded out to full width on the right. On /reload the running session
// picks up edits to this value (the patch record is updated in place).
const MAX_WIDTH = 95;

const PATCHED = Symbol.for("pi.maxwidth.patched");
const SCROLL_PATCHED = Symbol.for("pi.maxwidth.scrollview.patched");
const ALT_COMPOSITE_PATCHED = Symbol.for("pi.maxwidth.altscreen.composite.patched");

// Side-panel splice layout. The panel starts SPLICE_GAP columns after the cap;
// the splice only runs when the margin is at least MIN_MARGIN columns (matches
// side-panel/index.ts's capable threshold, ~122+ cols total).
const SPLICE_GAP = 2;
const MIN_MARGIN = 26;
const LINE_RESET = "\x1b[0m";

type RenderFn = (this: unknown, width: number) => string[];
type CompositeFn = (this: unknown, lines: string[], termWidth: number, termHeight: number) => string[];
type PatchState = { maxWidth: number };

/** ANSI-safe margin splice: base is cut/padded to `col`, then the panel line
 * (pre-truncated by side-panel to its width budget) is appended after a reset
 * so transcript styling can't bleed into the panel. The result is re-padded to
 * full width — regular mode writes rows without erase-line, so a shorter
 * spliced line would leave stale cells from the previous frame behind. The
 * panel line is also clipped to never reach the last column, which keeps a
 * stale-wide panel (terminal narrowed between publish and render) from
 * wrapping a row in regular mode. */
function splicePanelLine(base: string, panelLine: string, col: number, width: number): string {
	const clipped = truncateToWidth(panelLine, Math.max(0, width - col - 1));
	const out = truncateToWidth(base, col, "", true) + LINE_RESET + clipped;
	return out + " ".repeat(Math.max(0, width - visibleWidth(out)));
}

/** Wrap TuiBase.prototype.render (regular mode) and ScrollView.prototype
 * getContentWidth (fullscreen mode) to cap the transcript at MAX_WIDTH. */
export function patchMaxWidth(maxWidth: number = MAX_WIDTH): boolean {
	const tuiBase = Object.getPrototypeOf(TuiMainScreen);
	const baseProto = tuiBase?.prototype as Record<PropertyKey, unknown> | undefined;
	if (!baseProto) return false;
	const scrollProto = ScrollView.prototype as Record<PropertyKey, unknown>;

	// One state object backs both wrappers; on /reload the re-executed module
	// finds the surviving record and just updates the cap in place.
	const state = ((baseProto[PATCHED] ?? scrollProto[SCROLL_PATCHED]) as PatchState | undefined) ?? { maxWidth };
	state.maxWidth = maxWidth;

	let ok = true;

	if (!baseProto[PATCHED]) {
		const orig = baseProto.render as RenderFn | undefined;
		if (typeof orig !== "function") {
			ok = false;
		} else {
			baseProto.render = function (this: unknown, width: number): string[] {
				const children =
					(this as { children?: Array<{ render: (w: number) => string[] }> }).children ?? [];
				const first = children[0];
				// Regular mode mounts documentContainer (chat transcript) first; editor
				// and footer come later and stay full-width. Unexpected structure →
				// stock render, no capping at all.
				if (first?.constructor?.name !== "Container") {
					return orig.call(this, width);
				}
				const target = Math.min(width, state.maxWidth);
				const lines: string[] = [];
				let transcriptLines = 0;
				for (let i = 0; i < children.length; i++) {
					const cap = i === 0;
					for (const line of children[i]!.render(cap ? target : width)) {
						// Left-justified: capped lines are padded out to full width on the right.
						lines.push(cap ? line + " ".repeat(Math.max(0, width - visibleWidth(line))) : line);
					}
					if (cap) transcriptLines = lines.length;
				}
				// Side-panel splice (regular mode): pin the panel to the top of the
				// visible transcript rows — the terminal shows the last terminal.rows
				// lines, and the dock lives after transcriptLines, so splicing stops
				// there and can never cover the editor.
				const panel = getBus().panel;
				if (panel && width - state.maxWidth >= MIN_MARGIN + SPLICE_GAP) {
					const termRows = (this as { terminal?: { rows?: number } }).terminal?.rows ?? 0;
					const start = Math.max(0, lines.length - termRows);
					const col = state.maxWidth + SPLICE_GAP;
					for (let i = 0; i < panel.lines.length; i++) {
						const row = start + i;
						if (row >= transcriptLines) break;
						lines[row] = splicePanelLine(lines[row]!, panel.lines[i]!, col, width);
					}
				}
				return lines;
			} as RenderFn;
			baseProto[PATCHED] = state;
		}
	}

	if (!scrollProto[SCROLL_PATCHED]) {
		const origContentWidth = ScrollView.prototype.getContentWidth;
		if (typeof origContentWidth !== "function") {
			ok = false;
		} else {
			ScrollView.prototype.getContentWidth = function (this: ScrollView, width: number): number {
				// Fullscreen sizes the transcript viewport through the primary
				// scroll view; everything else (autocomplete, dialogs, dock)
				// keeps full width. The layout engine pads the shorter lines
				// back out during compositing, so no manual padding here.
				const capped = this.primary ? Math.min(width, state.maxWidth) : width;
				return origContentWidth.call(this, capped);
			};
			scrollProto[SCROLL_PATCHED] = state;
		}
	}

	// Fullscreen side-panel splice. renderLayoutFrame never calls
	// ScrollView.render (it renders the scroll view's child directly), so the
	// only post-layout chokepoint on the prototype chain is compositeOverlays —
	// called by TuiAltScreen.doRender with the full-height screen rows. The
	// wrapper splices panel lines into rows 0..viewportHeight-1, so the dock
	// below the transcript viewport can never be covered. Patched on
	// TuiAltScreen.prototype specifically — TuiMainScreen (regular mode) keeps
	// the stock composite.
	const altProto = TuiAltScreen.prototype as Record<PropertyKey, unknown>;
	if (!altProto[ALT_COMPOSITE_PATCHED]) {
		const origComposite = altProto.compositeOverlays as CompositeFn | undefined;
		if (typeof origComposite !== "function") {
			ok = false;
		} else {
			altProto.compositeOverlays = function (this: unknown, lines: string[], termWidth: number, termHeight: number): string[] {
				// Splice FIRST (on a copy), then let real overlays composite on top —
				// a pi overlay (search bar, selector) wins over the panel where they
				// overlap, never the other way around.
				const panel = getBus().panel;
				if (!panel || termWidth - state.maxWidth < MIN_MARGIN + SPLICE_GAP) {
					return origComposite.call(this, lines, termWidth, termHeight);
				}
				const viewportHeight =
					(this as { getPrimaryScrollView?: () => { viewportHeight?: number } | undefined }).getPrimaryScrollView?.()
					?.viewportHeight ?? 0;
				const col = state.maxWidth + SPLICE_GAP;
				const spliced = [...lines];
				for (let i = 0; i < Math.min(panel.lines.length, viewportHeight); i++) {
					spliced[i] = splicePanelLine(spliced[i] ?? "", panel.lines[i]!, col, termWidth);
				}
				return origComposite.call(this, spliced, termWidth, termHeight);
			};
			altProto[ALT_COMPOSITE_PATCHED] = state;
		}
	}

	return ok;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (!patchMaxWidth()) {
			ctx.ui.notify("max-width: could not patch renderer (internals changed?)", "warning");
		}
	});
}
