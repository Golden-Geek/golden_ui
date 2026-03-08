import type { GraphState } from '$lib/golden_ui/store/graph.svelte';
import type { NodeId, ParamValue, UiEditIntent, UiNodeDto, UiParamDto } from '$lib/golden_ui/types';
import {
	createUiEditSession,
	sendCreateUserItemByTypeIntent,
	sendMoveNodeIntent,
	sendSetParamIntent,
	sendUiIntentBatch
} from '$lib/golden_ui/store/ui-intents';
import {
	cssValueToPx,
	type CssUnitConversionContext,
	type CssValueData
} from '$lib/golden_ui/css-value';

import {
	createReferenceValue,
	formatParamValue,
	getDashboardLayoutKind,
	getDirectParamNode,
	type DashboardAnchor
} from './dashboard-model';

type GraphGetter = () => GraphState | null;
type DashboardGenericWidgetKind = 'text' | 'button' | 'slider' | 'textInput' | 'checkbox';

export interface DashboardWidgetSizingContext {
	rootRemPx: number;
	surfaceWidthPx: number;
	surfaceHeightPx: number;
	viewportWidthPx: number;
	viewportHeightPx: number;
}

export interface DashboardWidgetCreationPlacement {
	anchor: DashboardAnchor;
	position: { x: number; y: number };
	size: { width: CssValueData; height: CssValueData };
	columnSpan: number;
	rowSpan: number;
}

interface DashboardWidgetPlacementOptions {
	centerPx?: { x: number; y: number };
	snapPx?: number;
}

interface DashboardWidgetCreationOptions {
	placement?: DashboardWidgetCreationPlacement;
}

interface DashboardGenericWidgetCreationDefaults {
	placement: DashboardWidgetCreationPlacement;
	widgetKind: DashboardGenericWidgetKind;
	text?: string;
	placeholder?: string;
	multiline?: boolean;
	valueRange?: [number, number];
	step?: number;
	defaultChecked?: boolean;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const roundToHundredth = (value: number): number => Math.round(value * 100) / 100;

const remValue = (value: number): CssValueData => ({
	value: roundToHundredth(value),
	unit: 'rem'
});

const createCssContext = (
	context: DashboardWidgetSizingContext,
	axis: 'x' | 'y'
): CssUnitConversionContext => ({
	rootRemPx: context.rootRemPx,
	axisBasePx: axis === 'x' ? context.surfaceWidthPx : context.surfaceHeightPx,
	viewportWidthPx: context.viewportWidthPx,
	viewportHeightPx: context.viewportHeightPx
});

const cssSizeToPx = (
	value: CssValueData,
	axis: 'x' | 'y',
	context: DashboardWidgetSizingContext
): number => Math.max(0, cssValueToPx(value, axis, createCssContext(context, axis)));

const snapPixel = (value: number, snapPx: number | undefined): number => {
	if (!(snapPx && snapPx > 0)) {
		return value;
	}
	return Math.round(value / snapPx) * snapPx;
};

const estimateTextWidthRem = (
	text: string,
	baseRem: number,
	perCharacterRem: number,
	minRem: number,
	maxRem: number
): number => {
	const normalizedLength = text.trim().length;
	return clamp(baseRem + normalizedLength * perCharacterRem, minRem, maxRem);
};

const paramContentLength = (param: UiParamDto): number => {
	const rendered = formatParamValue(param.value);
	return rendered.trim().length;
};

const createPlacement = (
	size: { width: CssValueData; height: CssValueData },
	context: DashboardWidgetSizingContext,
	options?: DashboardWidgetPlacementOptions
): DashboardWidgetCreationPlacement => {
	const widthPx = cssSizeToPx(size.width, 'x', context);
	const heightPx = cssSizeToPx(size.height, 'y', context);
	const centerPx = options?.centerPx ?? { x: widthPx * 0.5, y: heightPx * 0.5 };
	const snappedLeft = snapPixel(centerPx.x - widthPx * 0.5, options?.snapPx);
	const snappedTop = snapPixel(centerPx.y - heightPx * 0.5, options?.snapPx);
	const widthRem = widthPx / Math.max(context.rootRemPx, 1e-6);
	const heightRem = heightPx / Math.max(context.rootRemPx, 1e-6);

	return {
		anchor: 'top-left',
		position: {
			x: snappedLeft,
			y: snappedTop
		},
		size,
		columnSpan: clamp(Math.round(widthRem / 6), 1, 12),
		rowSpan: clamp(Math.round(heightRem / 4), 1, 12)
	};
};

const getDefaultSizingContext = (): DashboardWidgetSizingContext => ({
	rootRemPx: 16,
	surfaceWidthPx: 1280,
	surfaceHeightPx: 720,
	viewportWidthPx: 1280,
	viewportHeightPx: 720
});

const getNodeWidgetDefaultSize = (targetNode: UiNodeDto): { width: CssValueData; height: CssValueData } => {
	if (targetNode.data.kind === 'parameter') {
		const label = targetNode.meta.label;
		const contentLength = paramContentLength(targetNode.data.param);
		switch (targetNode.data.param.value.kind) {
			case 'trigger':
			case 'bool':
				return {
					width: remValue(estimateTextWidthRem(label, 10.5, 0.18, 10.5, 16)),
					height: remValue(3.8)
				};
			case 'int':
			case 'float':
				return {
					width: remValue(estimateTextWidthRem(label, 13, 0.22, 13, 18)),
					height: remValue(4.6)
				};
			case 'str':
			case 'file':
			case 'enum':
			case 'css_value': {
				const multiline = contentLength > 40;
				return {
					width: remValue(
						estimateTextWidthRem(`${label} ${'x'.repeat(contentLength)}`, 15, 0.1, 15, 24)
					),
					height: remValue(multiline ? 7.5 : 4.8)
				};
			}
			default:
				return {
					width: remValue(estimateTextWidthRem(label, 14, 0.18, 14, 20)),
					height: remValue(4.4)
				};
		}
	}

	const labelLength = targetNode.meta.label.trim().length;
	const childCount = targetNode.children.length;
	return {
		width: remValue(clamp(15 + labelLength * 0.1 + childCount * 0.38, 15, 26)),
		height: remValue(clamp(6 + Math.min(childCount, 18) * 0.55, 6, 18))
	};
};

export const getDashboardNodeWidgetCreationDefaults = (
	targetNode: UiNodeDto,
	context: DashboardWidgetSizingContext,
	options?: DashboardWidgetPlacementOptions
): DashboardWidgetCreationPlacement => createPlacement(getNodeWidgetDefaultSize(targetNode), context, options);

const getGenericWidgetDefaults = (
	targetNode: UiNodeDto,
	context: DashboardWidgetSizingContext,
	options?: DashboardWidgetPlacementOptions
): DashboardGenericWidgetCreationDefaults => {
	const param = targetNode.data.kind === 'parameter' ? targetNode.data.param : null;
	const label = targetNode.meta.label;
	if (!param) {
		const size = {
			width: remValue(estimateTextWidthRem(label, 11, 0.18, 11, 18)),
			height: remValue(3.2)
		};
		return {
			placement: createPlacement(size, context, options),
			widgetKind: 'text',
			text: label
		};
	}

	const formattedValue = formatParamValue(param.value);
	const contentLength = formattedValue.trim().length;
	const widgetKind = genericWidgetKindForParam(param);

	if (widgetKind === 'button') {
		const size = {
			width: remValue(estimateTextWidthRem(label, 9.5, 0.18, 9.5, 18)),
			height: remValue(3.25)
		};
		return {
			placement: createPlacement(size, context, options),
			widgetKind,
			text: label
		};
	}

	if (widgetKind === 'checkbox') {
		const size = {
			width: remValue(estimateTextWidthRem(label, 11.5, 0.18, 11.5, 20)),
			height: remValue(3.2)
		};
		return {
			placement: createPlacement(size, context, options),
			widgetKind,
			text: label,
			defaultChecked: param.value.kind === 'bool' ? param.value.value : false
		};
	}

	if (widgetKind === 'slider') {
		const size = {
			width: remValue(estimateTextWidthRem(`${label} ${formattedValue}`, 15, 0.12, 15, 24)),
			height: remValue(4.8)
		};
		return {
			placement: createPlacement(size, context, options),
			widgetKind,
			valueRange: sliderRangeForParam(param),
			step: param.value.kind === 'int' ? 1 : 0.01
		};
	}

	if (widgetKind === 'textInput') {
		const multiline = formattedValue.includes('\n') || contentLength > 48;
		const size = {
			width: remValue(
				estimateTextWidthRem(`${label} ${'x'.repeat(Math.min(contentLength, 80))}`, 15, 0.08, 15, 26)
			),
			height: remValue(multiline ? 8 : 3.6)
		};
		return {
			placement: createPlacement(size, context, options),
			widgetKind,
			placeholder: label,
			multiline
		};
	}

	const size = {
		width: remValue(estimateTextWidthRem(`${label} ${formattedValue}`, 10.5, 0.14, 10.5, 22)),
		height: remValue(3.2)
	};
	return {
		placement: createPlacement(size, context, options),
		widgetKind,
		text: label
	};
};

export const getDashboardGenericWidgetCreationDefaults = (
	targetNode: UiNodeDto,
	context: DashboardWidgetSizingContext,
	options?: DashboardWidgetPlacementOptions
): DashboardGenericWidgetCreationDefaults => getGenericWidgetDefaults(targetNode, context, options);

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
		case 'css_value':
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

const applyDashboardWidgetPlacement = async (
	getGraph: GraphGetter,
	parentId: NodeId,
	widgetNodeId: NodeId,
	placement: DashboardWidgetCreationPlacement
): Promise<void> => {
	const graph = getGraph();
	const parentNode = graph?.nodesById.get(parentId) ?? null;
	const parentLayoutKind = getDashboardLayoutKind(graph, parentNode, 'free');
	const operations: Promise<boolean>[] = [
		setWidgetParamValue(getGraph, widgetNodeId, 'width', {
			kind: 'css_value',
			value: placement.size.width.value,
			unit: placement.size.width.unit
		}),
		setWidgetParamValue(getGraph, widgetNodeId, 'height', {
			kind: 'css_value',
			value: placement.size.height.value,
			unit: placement.size.height.unit
		})
	];

	if (parentLayoutKind === 'free') {
		operations.push(
			setWidgetParamValue(getGraph, widgetNodeId, 'anchor', {
				kind: 'enum',
				value: placement.anchor
			}),
			setWidgetParamValue(getGraph, widgetNodeId, 'position', {
				kind: 'vec2',
				value: [placement.position.x, placement.position.y]
			})
		);
	}

	if (parentLayoutKind === 'grid') {
		operations.push(
			setWidgetParamValue(getGraph, widgetNodeId, 'column_span', {
				kind: 'int',
				value: placement.columnSpan
			}),
			setWidgetParamValue(getGraph, widgetNodeId, 'row_span', {
				kind: 'int',
				value: placement.rowSpan
			})
		);
	}

	await Promise.all(operations);
};

const applyDashboardWidgetPlacementBatched = async (
	getGraph: GraphGetter,
	parentId: NodeId,
	widgetNodeId: NodeId,
	placement: DashboardWidgetCreationPlacement
): Promise<boolean> => {
	const graph = getGraph();
	const parentNode = graph?.nodesById.get(parentId) ?? null;
	const parentLayoutKind = getDashboardLayoutKind(graph, parentNode, 'free');
	const widthTarget = await waitForDirectParam(getGraph, widgetNodeId, 'width');
	const heightTarget = await waitForDirectParam(getGraph, widgetNodeId, 'height');
	if (!widthTarget || !heightTarget) {
		return false;
	}

	const intents: UiEditIntent[] = [
		{
			kind: 'setParam' as const,
			node: widthTarget.node.node_id,
			value: {
				kind: 'css_value' as const,
				value: placement.size.width.value,
				unit: placement.size.width.unit
			},
			behaviour: widthTarget.param.event_behaviour
		},
		{
			kind: 'setParam' as const,
			node: heightTarget.node.node_id,
			value: {
				kind: 'css_value' as const,
				value: placement.size.height.value,
				unit: placement.size.height.unit
			},
			behaviour: heightTarget.param.event_behaviour
		}
	];

	if (parentLayoutKind === 'free') {
		const anchorTarget = await waitForDirectParam(getGraph, widgetNodeId, 'anchor');
		const positionTarget = await waitForDirectParam(getGraph, widgetNodeId, 'position');
		if (!anchorTarget || !positionTarget) {
			return false;
		}
		intents.push(
			{
				kind: 'setParam',
				node: anchorTarget.node.node_id,
				value: { kind: 'enum', value: placement.anchor },
				behaviour: anchorTarget.param.event_behaviour
			},
			{
				kind: 'setParam',
				node: positionTarget.node.node_id,
				value: { kind: 'vec2', value: [placement.position.x, placement.position.y] },
				behaviour: positionTarget.param.event_behaviour
			}
		);
	}

	if (parentLayoutKind === 'grid') {
		const columnSpanTarget = await waitForDirectParam(getGraph, widgetNodeId, 'column_span');
		const rowSpanTarget = await waitForDirectParam(getGraph, widgetNodeId, 'row_span');
		if (!columnSpanTarget || !rowSpanTarget) {
			return false;
		}
		intents.push(
			{
				kind: 'setParam',
				node: columnSpanTarget.node.node_id,
				value: { kind: 'int', value: placement.columnSpan },
				behaviour: columnSpanTarget.param.event_behaviour
			},
			{
				kind: 'setParam',
				node: rowSpanTarget.node.node_id,
				value: { kind: 'int', value: placement.rowSpan },
				behaviour: rowSpanTarget.param.event_behaviour
			}
		);
	}

	const result = await sendUiIntentBatch(intents);
	return result.success;
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

	const defaults = getGenericWidgetDefaults(targetNode, getDefaultSizingContext());
	const widgetKind = defaults.widgetKind;
	const graph = getGraph();
	const bound = await setWidgetParamValue(getGraph, widgetNodeId, 'target_param', createReferenceValue(graph, targetNode));
	if (!bound) {
		return false;
	}

	await setWidgetParamValue(getGraph, widgetNodeId, 'widget_kind', {
		kind: 'enum',
		value: widgetKind
	});

	if (defaults.text !== undefined) {
		await setWidgetParamValue(getGraph, widgetNodeId, 'text', {
			kind: 'str',
			value: defaults.text
		});
	}

	if (defaults.valueRange) {
		const [min, max] = defaults.valueRange;
		await setWidgetParamValue(getGraph, widgetNodeId, 'value_range', {
			kind: 'vec2',
			value: [min, max]
		});
	}

	if (defaults.step !== undefined) {
		await setWidgetParamValue(getGraph, widgetNodeId, 'step', {
			kind: 'float',
			value: defaults.step
		});
	}

	if (defaults.placeholder !== undefined) {
		await setWidgetParamValue(getGraph, widgetNodeId, 'placeholder', {
			kind: 'str',
			value: defaults.placeholder
		});
	}

	if (defaults.multiline !== undefined) {
		await setWidgetParamValue(getGraph, widgetNodeId, 'multiline', {
			kind: 'bool',
			value: defaults.multiline
		});
	}

	if (defaults.defaultChecked !== undefined) {
		await setWidgetParamValue(getGraph, widgetNodeId, 'default_checked', {
			kind: 'bool',
			value: defaults.defaultChecked
		});
	}

	return true;
};

export const createDashboardNodeWidget = async (
	getGraph: GraphGetter,
	parentId: NodeId,
	targetNode: UiNodeDto,
	options?: DashboardWidgetCreationOptions
): Promise<UiNodeDto | null> => {
	const parent = getGraph()?.nodesById.get(parentId);
	if (!parent) {
		return null;
	}
	const editSession = createUiEditSession('Create dashboard node widget', 'dashboard-create');
	await editSession.begin();
	try {
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
	const placementApplied = await applyDashboardWidgetPlacementBatched(
		getGraph,
		parentId,
		widgetNode.node_id,
		options?.placement ?? getDashboardNodeWidgetCreationDefaults(targetNode, getDefaultSizingContext())
	);
	if (!placementApplied) {
		await applyDashboardWidgetPlacement(
			getGraph,
			parentId,
			widgetNode.node_id,
			options?.placement ?? getDashboardNodeWidgetCreationDefaults(targetNode, getDefaultSizingContext())
		);
	}
	return widgetNode;
	} finally {
		await editSession.end();
	}
};

export const createDashboardGenericWidget = async (
	getGraph: GraphGetter,
	parentId: NodeId,
	targetNode: UiNodeDto,
	options?: DashboardWidgetCreationOptions
): Promise<UiNodeDto | null> => {
	if (targetNode.data.kind !== 'parameter') {
		return null;
	}
	const parent = getGraph()?.nodesById.get(parentId);
	if (!parent) {
		return null;
	}
	const editSession = createUiEditSession('Create dashboard parameter widget', 'dashboard-create');
	await editSession.begin();
	try {
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
	const placementApplied = await applyDashboardWidgetPlacementBatched(
		getGraph,
		parentId,
		widgetNode.node_id,
		options?.placement ?? getDashboardGenericWidgetCreationDefaults(targetNode, getDefaultSizingContext()).placement
	);
	if (!placementApplied) {
		await applyDashboardWidgetPlacement(
			getGraph,
			parentId,
			widgetNode.node_id,
			options?.placement ??
				getDashboardGenericWidgetCreationDefaults(targetNode, getDefaultSizingContext()).placement
		);
	}
	return widgetNode;
	} finally {
		await editSession.end();
	}
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