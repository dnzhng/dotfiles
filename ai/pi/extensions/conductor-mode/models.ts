import { getSupportedThinkingLevels, type Api, type Model, type ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { ExtensionContext, ScopedModel } from "@earendil-works/pi-coding-agent";

export interface WorkerTarget {
	provider: string;
	id: string;
	thinkingLevel: ModelThinkingLevel;
}

export interface CatalogModel {
	provider: string;
	id: string;
	name: string;
	levels: ModelThinkingLevel[];
	scoped: boolean;
}

function modelKey(model: Pick<Model<Api>, "provider" | "id">): string {
	return `${model.provider}/${model.id}`;
}

export function modelCatalog(ctx: ExtensionContext, query = "", limit = 60): CatalogModel[] {
	const all = ctx.modelRegistry.getAvailable();
	const scoped = new Set((ctx.scopedModels as readonly ScopedModel[]).map(({ model }) => modelKey(model)));
	const needle = query.trim().toLocaleLowerCase();
	const matches = all
		.filter((model) => !needle || `${model.provider}/${model.id} ${model.name}`.toLocaleLowerCase().includes(needle))
		.map((model) => ({ model, scoped: scoped.has(modelKey(model)) }))
		.sort((a, b) => Number(b.scoped) - Number(a.scoped));
	return matches.slice(0, Math.max(1, Math.min(limit, 100))).map(({ model, scoped: isScoped }) => ({
		provider: model.provider,
		id: model.id,
		name: model.name,
		levels: getSupportedThinkingLevels(model),
		scoped: isScoped,
	}));
}

export function parseTarget(ctx: ExtensionContext, selector: string): WorkerTarget | undefined {
	const colon = selector.lastIndexOf(":");
	const slash = selector.indexOf("/");
	if (slash <= 0 || colon <= slash + 1 || colon === selector.length - 1) return undefined;
	const target = {
		provider: selector.slice(0, slash),
		id: selector.slice(slash + 1, colon),
		thinkingLevel: selector.slice(colon + 1) as ModelThinkingLevel,
	};
	return isTargetAvailable(ctx, target) ? target : undefined;
}

export function targetAvailabilityReason(ctx: ExtensionContext, target: WorkerTarget): string | undefined {
	const model = ctx.modelRegistry.getAvailable().find((candidate) => candidate.provider === target.provider && candidate.id === target.id);
	if (!model) return `${target.provider}/${target.id} is not in the available model catalog`;
	if (!getSupportedThinkingLevels(model).includes(target.thinkingLevel)) {
		return `${target.provider}/${target.id} does not support ${target.thinkingLevel} thinking`;
	}
	return undefined;
}

export function isTargetAvailable(ctx: ExtensionContext, target: WorkerTarget): boolean {
	return targetAvailabilityReason(ctx, target) === undefined;
}

export const SPEED_TARGET: WorkerTarget = { provider: "instacart-openai", id: "gpt-6-luna", thinkingLevel: "low" };
