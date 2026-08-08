/**
 * Ocean Terminal — base16-ocean immersion for pi, isolated to pi's tmux pane.
 *
 * Two modes:
 * - Inside tmux: everything is per-pane. `window-style` fills the pane's
 *   default cells with ocean bg/fg (explicit bg = opaque in WezTerm), and
 *   `pane-colours` remaps the 16 ANSI slots just for this pane. Nothing
 *   terminal-wide is emitted, so sibling panes/windows keep stock colors.
 * - Outside tmux: terminal-wide OSC palette swap (ports vimrc's VimEnter/
 *   VimLeave block). Colors only — the UI stays translucent there, since
 *   per-pane opacity is a tmux trick and the window-wide alternative (a
 *   wezterm.lua user-var handler) was deliberately removed.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { closeSync, openSync, writeSync } from "node:fs";

// base16-ocean, in ANSI slot order (same palette as vimrc's OSC 4 block).
const PALETTE = [
	"#2b303b", "#bf616a", "#a3be8c", "#ebcb8b", "#8fa1b3", "#b48ead", "#96b5b4", "#c0c5ce",
	"#65737e", "#bf616a", "#a3be8c", "#ebcb8b", "#8fa1b3", "#b48ead", "#96b5b4", "#eff1f5",
];

// Non-tmux path: OSC 4 sets the 16 ANSI slots, 10/11/12 set fg/bg/cursor.
const OCEAN =
	"\x1b]4;0;#2b303b;1;#bf616a;2;#a3be8c;3;#ebcb8b;4;#8fa1b3;5;#b48ead" +
	";6;#96b5b4;7;#c0c5ce;8;#65737e;9;#bf616a;10;#a3be8c;11;#ebcb8b" +
	";12;#8fa1b3;13;#b48ead;14;#96b5b4;15;#eff1f5\x07" +
	"\x1b]10;#c0c5ce\x07\x1b]11;#2b303b\x07\x1b]12;#c0c5ce\x07";

// OSC 104/110/111/112 restore palette + fg/bg/cursor to terminal defaults.
const RESET = "\x1b]104\x07\x1b]110\x07\x1b]111\x07\x1b]112\x07";

// Pane isolation (tmux path): window-style bg is what makes the pane opaque
// (verified: tmux emits SGR 48;2;43;48;59 on the wire), fg sets default text.
const PANE_STYLE = "bg=#2b303b,fg=#c0c5ce";

function tmux(args: string[]): void {
	try {
		execFileSync("tmux", args, { stdio: "ignore" });
	} catch {
		// tmux server gone or pane closed — nothing to do.
	}
}

/** Ocean-ify one pane: default fg/bg fill + the 16 ANSI slots. */
function paneApply(pane: string): void {
	tmux(["set", "-p", "-t", pane, "window-style", PANE_STYLE]);
	PALETTE.forEach((color, i) => tmux(["set", "-p", "-t", pane, `pane-colours[${i}]`, color]));
}

function paneClear(pane: string): void {
	tmux(["set", "-pu", "-t", pane, "window-style"]);
	tmux(["set", "-pu", "-t", pane, "pane-colours"]);
}

/** Write raw escape bytes to the controlling terminal; no-op without a tty. */
function emit(seq: string): void {
	// Inside tmux, wrap in DCS passthrough so the codes reach the outer
	// terminal; every embedded ESC must be doubled (allow-passthrough is on).
	const payload = process.env.TMUX
		? `\x1bPtmux;${seq.replace(/\x1b/g, "\x1b\x1b")}\x1b\\`
		: seq;
	try {
		const fd = openSync("/dev/tty", "w");
		writeSync(fd, payload);
		closeSync(fd);
	} catch {
		// No controlling terminal (piped/headless) — nothing to theme.
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", () => {
		const pane = process.env.TMUX ? process.env.TMUX_PANE : undefined;
		if (pane) {
			paneApply(pane);
			// Stay isolated: reset any terminal-wide palette previously swapped
			// by the non-tmux path (or older versions of this extension).
			emit(RESET);
		} else {
			emit(OCEAN);
		}
	});
	// Restore only on quit: new/resume/fork/reload are followed immediately by
	// another session_start (which re-applies everything), so restoring there
	// would just flash the old palette for a frame.
	pi.on("session_shutdown", (event) => {
		if (event.reason !== "quit") return;
		const pane = process.env.TMUX ? process.env.TMUX_PANE : undefined;
		if (pane) paneClear(pane);
		emit(RESET);
	});
}
