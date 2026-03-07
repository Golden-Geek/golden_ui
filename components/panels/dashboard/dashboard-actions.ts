import type { GraphState } from '$lib/golden_ui/store/graph.svelte';
import type { NodeId, ParamValue, UiNodeDto, UiParamDto } from '$lib/golden_ui/types';
import { sendCreateUserItemByTypeIntent, sendMoveNodeIntent, sendSetParamIntent } from '$lib/golden_ui/store/ui-intents';

import { createReferenceValue, getDirectParamNode } from './dashboard-model';

type GraphGetter = () => GraphState | null;

const wait = async (ms: number): Promise<void> => {
	await new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
};

const waitFor = async <T>(resolveValue: () => T | null, timeoutMs = 800): Promise<T | null> => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() <= deadline) {
		const resolved = resolveValue();
		if (resolved !== null) {
			return resolved;
		}
		await wait(16);
	}
	return null;
};

const waitForCreatedChild = async (
	getGraph: GraphGetter,
	parentId: NodeId,
	knownChildren: Set<NodeId>,
	expectedNodeType: string
): Promise<UiNodeDto | null> => {
	return waitFor(() => {
		const graph = getGraph();
		const parent = graph?.nodesById.get(parentId);
		if (!graph || !parent) {
			return null;
		}

		for (const childId of parent.children) {
			if (knownChildren.has(childId)) {
				continue;
			}
			const child = graph.nodesById.get(childId);
			if (!child || child.node_type !== expectedNodeType) {
				continue;
			}
			return child;
		}

		return null;
	});
};

const waitForDirectParam = async (
	getGraph: GraphGetter,
	parentId: NodeId,
	declId: string
): Promise<{ node: UiNodeDto; param: UiParamDto } | null> => {
	return waitFor(() => {
		const graph = getGraph();
		const parent = graph?.nodesById.get(parentId);
		const paramNode = getDirectParamNode(graph, parent ?? null, declId);
		if (!paramNode || paramNode.data.kind !== 'parameter') {
			return null;
		}
		return { node: paramNode, param: paramNode.data.param };
	});
};

const sliderRangeForParam = (param: UiParamDto): [number, number] => {
	const current =
		param.value.kind === 'float' || param.value.kind === 'int' ? Number(param.value.value) : 0;
	const range = param.constraints.range;
	if (range?.kind === 'uniform') {
		return [range.min ?? Math.min(0, current), range.max ?? Math.max(1, current)];
	}
	if (current >= 0 && current <= 1) {
		return [0, 1];
	}
	return [Math.min(0, current), Math.max(1, current)];
};

const genericWidgetKindForParam = (param: UiParamDto): 'text' | 'button' | 'slider' | 'textInput' | 'checkbox' => {
	switch (param.value.kind) {
		case 'trigger':
			return 'button';
		case 'bool':
			return 'checkbox';
		case 'int':
		case 'float':
			return 'slider';
		case 'str':
		case 'file':
		case 'enum':
			return 'textInput';
		default:
			return 'text';
	}
};

const setWidgetParamValue = async (
	getGraph: GraphGetter,
	widgetNodeId: NodeId,
	declId: string,
	value: ParamValue
): Promise<boolean> => {
	const target = await waitForDirectParam(getGraph, widgetNodeId, declId);
	if (!target) {
		return false;
	}
	return sendSetParamIntent(target.node.node_id, value, target.param.event_behaviour);
};

export const bindDashboardNodeWidgetTarget = async (
	getGraph: GraphGetter,
	widgetNodeId: NodeId,
	targetNode: UiNodeDto
): Promise<boolean> => {
	const graph = getGraph();
	return setWidgetParamValue(getGraph, widgetNodeId, 'target_node', createReferenceValue(graph, targetNode));
};

export const bindDashboardGenericWidgetTarget = async (
	getGraph: GraphGetter,
	widgetNodeId: NodeId,
	targetNode: UiNodeDto
): Promise<boolean> => {
	if (targetNode.data.kind !== 'parameter') {
		return false;
	}

	const widgetKind = genericWidgetKindForParam(targetNode.data.param);
	const graph = getGraph();
	const bound = await setWidgetParamValue(getGraph, widgetNodeId, 'target_param', createReferenceValue(graph, targetNode));
	if (!bound) {
		return false;
	}

	await setWidgetParamValue(getGraph, widgetNodeId, 'widget_kind', {
		kind: 'enum',
		value: widgetKind
	});

	if (widgetKind === 'button' || widgetKind === 'text') {
		await setWidgetParamValue(getGraph, widgetNodeId, 'text', {
			kind: 'str',
			value: targetNode.meta.label
		});
	}

	if (widgetKind === 'slider') {
		const [min, max] = sliderRangeForParam(targetNode.data.param);
		await setWidgetParamValue(getGraph, widgetNodeId, 'value_range', {
			kind: 'vec2',
			value: [min, max]
		});
	}

	return true;
};

export const createDashboardNodeWidget = async (
	getGraph: GraphGetter,
	parentId: NodeId,
	targetNode: UiNodeDto
): Promise<UiNodeDto | null> => {
	const parent = getGraph()?.nodesById.get(parentId);
	if (!parent) {
		return null;
	}
	const knownChildren = new Set(parent.children);
	const created = await sendCreateUserItemByTypeIntent(parentId, 'dashboard_node_widget', targetNode.meta.label);
	if (!created) {
		return null;
	}
	const widgetNode = await waitForCreatedChild(getGraph, parentId, knownChildren, 'dashboard_node_widget');
	if (!widgetNode) {
		return null;
	}
	await bindDashboardNodeWidgetTarget(getGraph, widgetNode.node_id, targetNode);
	return widgetNode;
};

export const createDashboardGenericWidget = async (
	getGraph: GraphGetter,
	parentId: NodeId,
	targetNode: UiNodeDto
): Promise<UiNodeDto | null> => {
	if (targetNode.data.kind !== 'parameter') {
		return null;
	}
	const parent = getGraph()?.nodesById.get(parentId);
	if (!parent) {
		return null;
	}
	const knownChildren = new Set(parent.children);
	const created = await sendCreateUserItemByTypeIntent(parentId, 'dashboard_generic_widget', targetNode.meta.label);
	if (!created) {
		return null;
	}
	const widgetNode = await waitForCreatedChild(getGraph, parentId, knownChildren, 'dashboard_generic_widget');
	if (!widgetNode) {
		return null;
	}
	await bindDashboardGenericWidgetTarget(getGraph, widgetNode.node_id, targetNode);
	return widgetNode;
};

export const moveDashboardWidgetByDelta = async (
	getGraph: GraphGetter,
	widgetNodeId: NodeId,
	delta: number
): Promise<boolean> => {
	if (delta === 0) {
		return false;
	}

	const graph = getGraph();
	const parentId = graph?.parentById.get(widgetNodeId);
	if (!graph || parentId === undefined) {
		return false;
	}

	const parent = graph.nodesById.get(parentId);
	if (!parent) {
		return false;
	}

	const orderedSiblings = parent.children
		.map((childId) => graph.nodesById.get(childId))
		.filter((child): child is UiNodeDto => child !== undefined);
	const itemSiblings = orderedSiblings.filter((child) => child.user_role === 'itemRoot');
	const currentIndex = itemSiblings.findIndex((child) => child.node_id === widgetNodeId);
	if (currentIndex < 0) {
		return false;
	}

	const nextIndex = Math.max(0, Math.min(itemSiblings.length - 1, currentIndex + delta));
	if (nextIndex === currentIndex) {
		return false;
	}

	const siblingsWithoutNode = orderedSiblings.filter((child) => child.node_id !== widgetNodeId);
	const itemSiblingsWithoutNode = itemSiblings.filter((child) => child.node_id !== widgetNodeId);

	let newPrevSibling: NodeId | undefined;
	if (nextIndex === 0) {
		const firstItemId = itemSiblingsWithoutNode[0]?.node_id;
		if (firstItemId !== undefined) {
			const firstItemIndex = siblingsWithoutNode.findIndex((child) => child.node_id === firstItemId);
			newPrevSibling = firstItemIndex > 0 ? siblingsWithoutNode[firstItemIndex - 1]?.node_id : undefined;
		} else {
			newPrevSibling = siblingsWithoutNode.at(-1)?.node_id;
		}
	} else {
		newPrevSibling = itemSiblingsWithoutNode[nextIndex - 1]?.node_id;
	}

	return sendMoveNodeIntent(widgetNodeId, parentId, newPrevSibling);
};