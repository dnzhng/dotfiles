/**
 * tmux OSC 52 passthrough — fixes pi copies never reaching the local clipboard
 * on the remote box.
 *
 * pi emits a bare OSC 52 (`ESC ] 52 ; c ; <b64> BEL`) for select-to-copy
 * ("Copied!" flash) and /copy. tmux 3.5a on bento parses it (it lands in tmux
 * paste buffers) but never re-forwards it to the attached client, so WezTerm
 * never sets the clipboard. Verified: bare OSC 52 fails under both
 * `set-clipboard on` and `external`; DCS passthrough works.
 *
 * The reliable route is DCS passthrough (`ESC P tmux; ... ESC \`), forwarded
 * verbatim by tmux when `allow-passthrough on` (set in tmux/tmux.conf). This
 * wraps process.stdout.write — the single funnel for both pi-tui's selection
 * copy (ProcessTerminal.write) and utils/clipboard.js emitOsc52 — and rewrites
 * bare OSC 52 into passthrough form when running under tmux.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Bare OSC 52, BEL- or ST-terminated. The lookbehind skips sequences already
// wrapped in tmux passthrough (doubled ESC), so this stays harmless if pi
// ever adds its own wrapping.
const OSC52 = /(?<!\x1b)\x1b\]52;[a-z];[A-Za-z0-9+/=]*(?:\x07|\x1b\\)/g;

// /reload re-runs extension factories in the same process; mark the stream so
// wrappers never stack (stacked wrappers would double-wrap the sequence).
const INSTALLED = Symbol.for("pi.tmux-osc52-passthrough");

export default function (_pi: ExtensionAPI) {
	const stdout = process.stdout as unknown as Record<symbol, boolean>;
	if (stdout[INSTALLED]) return;
	stdout[INSTALLED] = true;

	const original = process.stdout.write.bind(process.stdout);
	process.stdout.write = function (chunk: unknown, ...rest: unknown[]): boolean {
		if (typeof chunk === "string" && process.env.TMUX && chunk.includes("\x1b]52;")) {
			// Inside DCS passthrough every ESC byte must be doubled for tmux.
			chunk = chunk.replace(OSC52, (seq) => `\x1bPtmux;${seq.replace(/\x1b/g, "\x1b\x1b")}\x1b\\`);
		}
		return (original as (...args: unknown[]) => boolean)(chunk, ...rest);
	} as typeof process.stdout.write;
}
