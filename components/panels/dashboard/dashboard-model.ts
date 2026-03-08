import type { GraphState } from '$lib/golden_ui/store/graph.svelte';
import type { NodeId, ParamValue, UiNodeDto, UiParamDto, UiParamValueProjection } from '$lib/golden_ui/types';
import { cssValueFromParamValue, formatCssValue, type CssValueData } from '$lib/golden_ui/css-value';

export type DashboardLayoutKind =
	| 'free'
	| 'horizontal'
	| 'vertical'
	| 'grid'
	| 'accordion'
	| 'tabs';

export interface DashboardPlacement {
	titleVisible: boolean;
	position: { x: CssValueData; y: CssValueData };
	size: { width: CssValueData; height: CssValueData };
	columnSpan: number;
	rowSpan: number;
}

export interface DashboardGap {
	x: CssValueData;
	y: CssValueData;
}

export const getLiveNode = (graph: GraphState | null, node: UiNodeDto): UiNodeDto => {
	return graph?.nodesById.get(node.node_id) ?? node;
};

export const getDirectChildren = (graph: GraphState | null, node: UiNodeDto | null): UiNodeDto[] => {
	if (!graph || !node) {
		return [];
	}
	return node.children.map((childId) => graph.nodesById.get(childId)).filter((child): child is UiNodeDto => child !== undefined);
};

export const getDirectItemChildren = (graph: GraphState | null, node: UiNodeDto | null, nodeType?: string): UiNodeDto[] => {
	return getDirectChildren(graph, node).filter((child) => {
		if (child.user_role !== 'itemRoot') {
			return false;
		}
		if (!nodeType) {
			return true;
		}
		return child.node_type === nodeType;
	});
};

export const getDirectParamNode = (graph: GraphState | null, node: UiNodeDto | null, declId: string): UiNodeDto | null => {
	return (
		getDirectChildren(graph, node).find(
			(child) => child.data.kind === 'parameter' && child.decl_id === declId
		) ?? null
	);
};

export const getDirectParam = (graph: GraphState | null, node: UiNodeDto | null, declId: string): UiParamDto | null => {
	const paramNode = getDirectParamNode(graph, node, declId);
	if (!paramNode || paramNode.data.kind !== 'parameter') {
		return null;
	}
	return paramNode.data.param;
};

export const getDashboardLayoutKind = (
	graph: GraphState | null,
	node: UiNodeDto | null,
	fallback: DashboardLayoutKind = 'free'
): DashboardLayoutKind => {
	const param = getDirectParam(graph, node, 'layout_kind');
	if (!param || param.value.kind !== 'enum') {
		return fallback;
	}
	const value = param.value.value as DashboardLayoutKind;
	if (
		value === 'free' ||
		value === 'horizontal' ||
		value === 'vertical' ||
		value === 'grid' ||
		value === 'accordion' ||
		value === 'tabs'
	) {
		return value;
	}
	return fallback;
};

const asNumber = (value: ParamValue | undefined, fallback: number): number => {
	if (!value) {
		return fallback;
	}
	if (value.kind === 'float' || value.kind === 'int') {
		return Number(value.value);
	}
	return fallback;
};

const asBool = (value: ParamValue | undefined, fallback: boolean): boolean => {
	if (!value || value.kind !== 'bool') {
		return fallback;
	}
	return value.value;
};

export const getDashboardPlacement = (graph: GraphState | null, node: UiNodeDto | null): DashboardPlacement => {
	return {
		titleVisible: asBool(getDirectParam(graph, node, 'title_visible')?.value, true),
		position: {
			x: cssValueFromParamValue(getDirectParam(graph, node, 'position_x')?.value, { value: 0, unit: 'rem' }),
			y: cssValueFromParamValue(getDirectParam(graph, node, 'position_y')?.value, { value: 0, unit: 'rem' })
		},
		size: {
			width: cssValueFromParamValue(getDirectParam(graph, node, 'width')?.value, { value: 12, unit: 'rem' }),
			height: cssValueFromParamValue(getDirectParam(graph, node, 'height')?.value, { value: 4, unit: 'rem' })
		},
		columnSpan: Math.max(1, Math.round(asNumber(getDirectParam(graph, node, 'column_span')?.value, 1))),
		rowSpan: Math.max(1, Math.round(asNumber(getDirectParam(graph, node, 'row_span')?.value, 1)))
	};
};

export const getGap = (
	graph: GraphState | null,
	node: UiNodeDto | null,
	fallback: DashboardGap = {
		x: { value: 1, unit: 'rem' },
		y: { value: 1, unit: 'rem' }
	}
): DashboardGap => {
	return {
		x: cssValueFromParamValue(getDirectParam(graph, node, 'gap_x')?.value, fallback.x),
		y: cssValueFromParamValue(getDirectParam(graph, node, 'gap_y')?.value, fallback.y)
	};
};

export const getGridColumns = (graph: GraphState | null, node: UiNodeDto | null, fallback = 12): number => {
	return Math.max(1, Math.round(asNumber(getDirectParam(graph, node, 'grid_columns')?.value, fallback)));
};

export const formatParamValue = (value: ParamValue | null | undefined): string => {
	if (!value) {
		return 'Unbound';
	}

	switch (value.kind) {
		case 'trigger':
			return 'Trigger';
		case 'int':
		case 'float':
			return String(value.value);
		case 'str':
		case 'file':
		case 'enum':
			return value.value;
		case 'bool':
			return value.value ? 'True' : 'False';
		case 'css_value':
			return formatCssValue(value);
		case 'vec2':
			return `${value.value[0]}, ${value.value[1]}`;
		case 'vec3':
			return `${value.value[0]}, ${value.value[1]}, ${value.value[2]}`;
		case 'color':
			return `${value.value.map((channel) => channel.toFixed(2)).join(', ')}`;
		case 'reference':
			return value.cached_name?.trim() || value.uuid.slice(0, 8);
	}
};

export const findNodeByUuid = (graph: GraphState | null, uuid: string): UiNodeDto | null => {
	if (!graph || uuid.length === 0) {
		return null;
	}
	for (const candidate of graph.nodesById.values()) {
		if (candidate.uuid === uuid) {
			return candidate;
		}
	}
	return null;
};

export const resolveReferenceTarget = (graph: GraphState | null, value: ParamValue | null | undefined): UiNodeDto | null => {
	if (!graph || !value || value.kind !== 'reference') {
		return null;
	}
	if (typeof value.cached_id === 'number') {
		const byId = graph.nodesById.get(value.cached_id);
		if (byId) {
			return byId;
		}
	}
	return findNodeByUuid(graph, value.uuid);
};

export const nodePathFromRoot = (graph: GraphState | null, targetNodeId: NodeId): string[] => {
	if (!graph || graph.rootId === null) {
		return [];
	}
	if (targetNodeId === graph.rootId) {
		return [];
	}

	const reversed: string[] = [];
	let current: NodeId | undefined = targetNodeId;
	while (current !== undefined) {
		if (current === graph.rootId) {
			reversed.reverse();
			return reversed;
		}
		const currentNode = graph.nodesById.get(current);
		if (!currentNode) {
			return [];
		}
		reversed.push(currentNode.decl_id);
		current = graph.parentById.get(current);
	}

	return [];
};

export const createReferenceValue = (graph: GraphState | null, targetNode: UiNodeDto, projection?: UiParamValueProjection): ParamValue => {
	return {
		kind: 'reference',
		uuid: targetNode.uuid,
		projection,
		cached_id: targetNode.node_id,
		cached_name: targetNode.meta.label,
		relative_path_from_root: nodePathFromRoot(graph, targetNode.node_id)
	};
};

