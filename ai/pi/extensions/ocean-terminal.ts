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
 *
 * Ownership (tmux path): $TMUX_PANE is inherited by any pi spawned from the
 * pane (agent-run `pi -p` smoke tests, manual nesting), and an unconditional
 * clear-on-quit let such a nested pi wipe the still-running outer pi's
 * styling. Instead the first pi to style a pane claims it via the
 * @ocean-terminal-pid pane option; a quitting pi clears only its own claim.
 * Stale markers self-heal on the next session_start: an owner that is dead
 * (killed -9) — or alive but not a pi process, i.e. its pid was recycled and
 * the pane's own shell is the classic impostor — is retaken. The non-tmux
 * OSC path has no equivalent guard (no per-pane state to key on).
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

const OWNER_OPTION = "@ocean-terminal-pid";

/** PID recorded as owning the pane's styling, if the marker is set. */
function paneOwner(pane: string): number | undefined {
	try {
		const out = execFileSync("tmux", ["show", "-pqv", "-t", pane, OWNER_OPTION], {
			encoding: "utf8",
		}).trim();
		const pid = Number(out);
		return Number.isInteger(pid) && pid > 0 ? pid : undefined;
	} catch {
		return undefined;
	}
}

function pidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		// EPERM = exists but owned by another user; ESRCH = gone.
		return (err as { code?: string }).code === "EPERM";
	}
}

/**
 * True when pid is a live pi process, not just any live process. Pids get
 * recycled: a stale marker can end up naming a living non-pi process (the
 * pane's own shell, respawned with a dead pi's pid, is the classic case),
 * and a plain liveness check would let that impostor hold the pane forever —
 * session_start never retakes it and session_shutdown never clears, so the
 * pane stays ocean after quit. Matching the command keeps the nested-pi
 * guard (a living pi owner is still respected) while letting recycled
 * markers self-heal.
 */
function isRunningPi(pid: number): boolean {
	if (!pidAlive(pid)) return false;
	try {
		const cmd = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
			encoding: "utf8",
		}).trim();
		// "node …/bin/pi …" (normal launch) or a bare "pi" argv; the pane's
		// shell (fish/zsh/bash) and other recycled-pid processes don't match.
		return /(?:^|[/\s])pi(?:\s|$)/.test(cmd);
	} catch {
		// ps unavailable/failed — fall back to respecting the live owner.
		return true;
	}
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
			paneApply(pane); // idempotent — safe even when another pi owns the pane
			// Claim the pane unless a living pi already owns it (nested pi case).
			// A marker naming a dead or non-pi process is stale (pid recycled) —
			// retake it, or quit-time cleanup stays disabled for this pane.
			const owner = paneOwner(pane);
			if (owner === undefined || owner === process.pid || !isRunningPi(owner)) {
				tmux(["set", "-p", "-t", pane, OWNER_OPTION, String(process.pid)]);
			}
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
		if (pane) {
			// Clear only when we own the pane: a nested pi (inherited $TMUX_PANE)
			// must not wipe the still-running outer pi's styling. No marker means
			// a pre-marker session — we applied, so we clean up.
			const owner = paneOwner(pane);
			if (owner === undefined || owner === process.pid) {
				paneClear(pane);
				tmux(["set", "-pu", "-t", pane, OWNER_OPTION]);
			}
		}
		emit(RESET);
	});
}
