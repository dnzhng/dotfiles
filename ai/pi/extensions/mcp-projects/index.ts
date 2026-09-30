/**
 * Registers project-scoped MCP servers with pi's built-in MCP support. The
 * canonical dotfiles store is split by the store's install.sh: global servers
 * go to ~/.pi/agent/mcp.json (read by builtin:mcp), project-keyed servers to
 * ~/.pi/agent/mcp-projects.json, which this extension reads on every
 * session_start. Keys match by dash-joined trailing path segments ("carrot"
 * matches anywhere inside a .../carrot/ tree, including graft worktrees), and
 * matches are registered with pi.registerMcpServer(). $PI_MCP_PROJECTS
 * overrides the path.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, McpServerConfig } from "@earendil-works/pi-coding-agent";

interface ProjectsFile {
	projects?: Record<string, Record<string, McpServerConfig>>;
}

function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/** Same matching as the store's install.sh: key dashes -> slashes, trailing segment. */
function projectMatches(key: string, cwd: string): boolean {
	const keyPath = key.replace(/-/g, "/");
	return (cwd.endsWith("/") ? cwd : `${cwd}/`).includes(`/${keyPath}/`);
}

function findProjectsFile(): string | undefined {
	const envPath = process.env.PI_MCP_PROJECTS;
	if (envPath && existsSync(envPath)) return envPath;
	const conventional = join(homedir(), ".pi/agent/mcp-projects.json");
	return existsSync(conventional) ? conventional : undefined;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		const path = findProjectsFile();
		if (!path) return;
		let parsed: ProjectsFile;
		try {
			parsed = JSON.parse(readFileSync(path, "utf8")) as ProjectsFile;
		} catch (err) {
			ctx.ui.notify(`MCP projects: failed to parse ${path}: ${errMsg(err)}`, "error");
			return;
		}
		for (const [key, servers] of Object.entries(parsed.projects ?? {})) {
			if (!projectMatches(key, ctx.cwd)) continue;
			for (const [name, config] of Object.entries(servers)) {
				try {
					pi.registerMcpServer(name, config);
				} catch (err) {
					ctx.ui.notify(`MCP projects: ${name}: ${errMsg(err)}`, "error");
				}
			}
		}
	});
}
