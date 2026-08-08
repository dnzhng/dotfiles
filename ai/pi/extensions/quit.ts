/**
 * Quit — type "quit" (no slash) to exit pi, matching other agent harnesses.
 *
 * Intercepts the exact input "quit" from the interactive editor and shuts
 * down gracefully via ctx.shutdown() — the same path as /quit (per pi's
 * interactive-mode comment: "Ctrl+D, Ctrl+C, /quit, extension shutdown()"),
 * so session_shutdown fires and extensions like ocean-terminal clean up.
 * Exact match only: "quit please", "Quit", or RPC/extension-injected input
 * all pass through to the LLM untouched.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.on("input", (event, ctx) => {
		if (event.source !== "interactive") return;
		if (event.text.trim() !== "quit") return;
		ctx.shutdown();
		return { action: "handled" as const };
	});
}
