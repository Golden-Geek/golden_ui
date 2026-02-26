import type { Snippet } from 'svelte';
import type { UiNodeDto } from '$lib/golden_ui/types';
import ScriptNodeInspector from './nodes/ScriptNodeInspector.svelte';

export type NodeInspectorOrder = 'first' | 'last' | 'solo' | '';

export interface NodeInspectorComponentProps {
	node: UiNodeDto;
	level: number;
	order: NodeInspectorOrder;
	collapsed?: boolean;
	hasChildren?: boolean;
	toggleCollapsed?: () => void;
	setCollapsed?: (collapsed: boolean) => void;
	defaultHeader?: Snippet<[Snippet?]>;
	defaultChildren?: Snippet;
}

export interface NodeInspectorEntry {
	component: any;
}

export type NodeInspectorRegistry = Record<string, NodeInspectorEntry>;

const builtinNodeInspectorRegistry: NodeInspectorRegistry = {
	script: { component: ScriptNodeInspector }
};

const customNodeInspectorRegistry = new Map<string, NodeInspectorEntry>();

const normalizeNodeType = (nodeType: string): string => nodeType.trim();

export const registerNodeInspector = (nodeType: string, entry: NodeInspectorEntry): void => {
	const normalizedNodeType = normalizeNodeType(nodeType);
	if (!normalizedNodeType) {
		throw new Error('Node inspector registration requires a non-empty node type.');
	}
	customNodeInspectorRegistry.set(normalizedNodeType, entry);
};

export const registerNodeInspectors = (entries: NodeInspectorRegistry): void => {
	for (const [nodeType, entry] of Object.entries(entries)) {
		registerNodeInspector(nodeType, entry);
	}
};

export const unregisterNodeInspector = (nodeType: string): void => {
	customNodeInspectorRegistry.delete(normalizeNodeType(nodeType));
};

export const clearCustomNodeInspectors = (): void => {
	customNodeInspectorRegistry.clear();
};

export const resolveNodeInspector = (nodeType: string): NodeInspectorEntry | null => {
	const normalizedNodeType = normalizeNodeType(nodeType);
	if (!normalizedNodeType) {
		return null;
	}
	return (
		customNodeInspectorRegistry.get(normalizedNodeType) ??
		builtinNodeInspectorRegistry[normalizedNodeType] ??
		null
	);
};
