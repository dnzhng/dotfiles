/**
 * Side Panel bus — shared state channel between the side-panel, plan-mode, and
 * max-width extensions.
 *
 * pi loads each extension through jiti with moduleCache: false, so every
 * importer of this module gets a FRESH module instance — module-level state is
 * not shared. The only cross-extension channel is a Symbol.for global; this
 * module is therefore side-effect-free and idempotent: getBus() returns the
 * surviving record across /reload cycles and across module instances.
 *
 * Contract:
 * - capable: set by side-panel (present AND terminal wide enough, margin >= 26).
 *   plan-mode keys its widget suppression and menu routing off this, so a narrow
 *   terminal falls back to today's stock behavior with no flash.
 * - todos: published by plan-mode on every updateStatus/persistState; null when
 *   there's nothing to show.
 * - menu: published by plan-mode's agent_end instead of ctx.ui.select when
 *   capable; side-panel renders it and calls resolve(choice | undefined) —
 *   undefined matches the select-cancel path ("stay in plan mode").
 * - panel: the rendered sidebar lines consumed by max-width's margin splice.
 *   null whenever there's no content — the sidebar is never a permanent fixture.
 * - dispose: side-panel's cleanup hook, invoked by its own session_start on
 *   /reload re-entry so only one input handler/timer is ever live.
 */

export interface SidePanelTodoItem {
	step: number;
	text: string;
	completed: boolean;
}

export interface SidePanelTodos {
	items: SidePanelTodoItem[];
	executing: boolean;
}

export interface SidePanelMenu {
	title: string;
	options: string[];
	resolve: (choice: string | undefined) => void;
}

export interface SidePanelContent {
	/** Pre-rendered lines (ANSI styling included), each <= width visible cols. */
	lines: string[];
	/** Visible width budget the lines were rendered to. */
	width: number;
}

export interface SidePanelBus {
	capable: boolean;
	todos: SidePanelTodos | null;
	menu: SidePanelMenu | null;
	panel: SidePanelContent | null;
	/** side-panel owned: cleanup for /reload re-entry. Not part of the data contract. */
	dispose?: () => void;
}

const BUS_KEY = Symbol.for("dotfiles.side-panel.v1");
const LISTENERS_KEY = Symbol.for("dotfiles.side-panel.v1.listeners");

type BusHolder = Record<PropertyKey, unknown>;

/** The shared bus record, created on first use and surviving /reload. */
export function getBus(): SidePanelBus {
	const g = globalThis as BusHolder;
	let bus = g[BUS_KEY] as SidePanelBus | undefined;
	if (!bus) {
		bus = { capable: false, todos: null, menu: null, panel: null };
		g[BUS_KEY] = bus;
	}
	return bus;
}

/** Subscribe to bus changes. Returns an unsubscribe function. */
export function onBusChange(listener: () => void): () => void {
	const g = globalThis as BusHolder;
	let listeners = g[LISTENERS_KEY] as Set<() => void> | undefined;
	if (!listeners) {
		listeners = new Set();
		g[LISTENERS_KEY] = listeners;
	}
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** Notify subscribers after mutating the bus (publishers mutate then notify). */
export function notifyBusChange(): void {
	const listeners = (globalThis as BusHolder)[LISTENERS_KEY] as Set<() => void> | undefined;
	if (!listeners) return;
	for (const listener of [...listeners]) {
		try {
			listener();
		} catch {
			// A broken listener must not break publishers or other listeners.
		}
	}
}

/** Convenience: apply a partial update to the bus and notify subscribers. */
export function publishBus(patch: Partial<Omit<SidePanelBus, "dispose">>): void {
	Object.assign(getBus(), patch);
	notifyBusChange();
}
