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
import { ScrollView, TuiMainScreen, visibleWidth } from "@earendil-works/pi-tui";

// Column cap in terminal columns. Content is left-justified; the transcript
// is padded out to full width on the right. On /reload the running session
// picks up edits to this value (the patch record is updated in place).
const MAX_WIDTH = 95;

const PATCHED = Symbol.for("pi.maxwidth.patched");
const SCROLL_PATCHED = Symbol.for("pi.maxwidth.scrollview.patched");

type RenderFn = (this: unknown, width: number) => string[];
type PatchState = { maxWidth: number };

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
				for (let i = 0; i < children.length; i++) {
					const cap = i === 0;
					for (const line of children[i]!.render(cap ? target : width)) {
						// Left-justified: capped lines are padded out to full width on the right.
						lines.push(cap ? line + " ".repeat(Math.max(0, width - visibleWidth(line))) : line);
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

	return ok;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (!patchMaxWidth()) {
			ctx.ui.notify("max-width: could not patch renderer (internals changed?)", "warning");
		}
	});
}
