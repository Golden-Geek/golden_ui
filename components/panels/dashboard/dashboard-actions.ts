import type { GraphState } from '../../../store/graph.svelte';
import type {
	NodeId,
	ParamValue,
	UiCreateUserItemInitialParam,
	UiNodeDto,
	UiParamDto
} from '../../../types';
import {
	createUiEditSession,
	sendCreateUserItemByTypeIntent,
	sendDuplicateNodeIntent,
	sendMoveNodeIntent,
	sendPatchMetaIntent,
	sendSetParamIntent
} from '../../../store/ui-intents';
import { cssValueToPx, type CssUnitConversionContext, type CssValueData } from '../../../css-value';

import {
	createReferenceValue,
	formatParamValue,
	getDashboardLayoutKind,
	getDashboardPlacement,
	getDirectItemChildren,
	getDirectParamNode,
	type DashboardAnchor,
	type DashboardLayoutKind
} from './dashboard-model';

type GraphGetter = () => GraphState | null;
export type DashboardGenericWidgetKind = 'text' | 'button' | 'slider' | 'textInput' | 'checkbox';

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
	sizeEnabled?: { width: boolean; height: boolean };
}

interface DashboardWidgetPlacementOptions {
	centerPx?: { x: number; y: number };
	snapPx?: number;
}

interface DashboardWidgetCreationOptions {
	placement?: DashboardWidgetCreationPlacement;
	targetIndex?: number;
}

export interface DashboardContainerWidgetCreationOptions {
	label?: string;
	placement?: DashboardWidgetCreationPlacement;
	layoutKind?: DashboardLayoutKind;
	targetIndex?: number;
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

export interface DashboardWidgetOrderingState {
	currentIndex: number;
	itemCount: number;
}

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

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

	return {
		anchor: 'top-left',
		position: {
			x: snappedLeft,
			y: snappedTop
		},
		size
	};
};

const getDefaultSizingContext = (): DashboardWidgetSizingContext => ({
	rootRemPx: 16,
	surfaceWidthPx: 1280,
	surfaceHeightPx: 720,
	viewportWidthPx: 1280,
	viewportHeightPx: 720
});

const getContainerDefaultSize = (): { width: CssValueData; height: CssValueData } => ({
	width: remValue(12),
	height: remValue(8)
});

const getNodeWidgetDefaultSize = (
	targetNode: UiNodeDto
): { width: CssValueData; height: CssValueData } => {
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
): DashboardWidgetCreationPlacement =>
	createPlacement(getNodeWidgetDefaultSize(targetNode), context, options);

export const getDashboardContainerCreationDefaults = (
	context: DashboardWidgetSizingContext,
	options?: DashboardWidgetPlacementOptions
): DashboardWidgetCreationPlacement => createPlacement(getContainerDefaultSize(), context, options);

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
				estimateTextWidthRem(
					`${label} ${'x'.repeat(Math.min(contentLength, 80))}`,
					15,
					0.08,
					15,
					26
				)
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

const genericWidgetKindForParam = (
	param: UiParamDto
): 'text' | 'button' | 'slider' | 'textInput' | 'checkbox' => {
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

const setWidgetParamEnabled = async (
	getGraph: GraphGetter,
	widgetNodeId: NodeId,
	declId: string,
	enabled: boolean
): Promise<boolean> => {
	const target = await waitForDirectParam(getGraph, widgetNodeId, declId);
	if (!target) {
		return false;
	}
	return sendPatchMetaIntent(target.node.node_id, { enabled });
};

const applyDashboardWidgetSizingMode = async (
	getGraph: GraphGetter,
	widgetNodeId: NodeId,
	parentId: NodeId,
	sizeEnabled?: { width: boolean; height: boolean }
): Promise<void> => {
	const graph = getGraph();
	const parentNode = graph?.nodesById.get(parentId) ?? null;
	if (!parentNode) {
		return;
	}

	const parentLayoutKind = getDashboardLayoutKind(graph, parentNode, 'free');
	if (parentLayoutKind === 'free') {
		await setWidgetParamEnabled(getGraph, widgetNodeId, 'width', true);
		await setWidgetParamEnabled(getGraph, widgetNodeId, 'height', true);
		return;
	}
	if (parentLayoutKind === 'horizontal') {
		await setWidgetParamEnabled(getGraph, widgetNodeId, 'width', sizeEnabled?.width ?? false);
		return;
	}
	if (parentLayoutKind === 'vertical') {
		await setWidgetParamEnabled(getGraph, widgetNodeId, 'height', sizeEnabled?.height ?? false);
	}
};

const createInitialParam = (decl_id: string, value: ParamValue): UiCreateUserItemInitialParam => ({
	decl_id,
	value
});

export const getNextAvailableChildLabel = (
	graph: GraphState | null,
	parentId: NodeId,
	preferredLabel: string
): string => {
	const fallbackLabel = preferredLabel.trim().length > 0 ? preferredLabel.trim() : 'Item';
	const parent = graph?.nodesById.get(parentId);
	if (!parent) {
		return fallbackLabel;
	}

	const usedLabels = new Set<string>();
	for (const childId of parent.children) {
		const child = graph?.nodesById.get(childId);
		if (!child) {
			continue;
		}
		const label = child.meta.label.trim();
		if (label.length > 0) {
			usedLabels.add(label);
		}
	}

	if (!usedLabels.has(fallbackLabel)) {
		return fallbackLabel;
	}

	let suffix = 2;
	let candidate = `${fallbackLabel} ${suffix}`;
	while (usedLabels.has(candidate)) {
		suffix += 1;
		candidate = `${fallbackLabel} ${suffix}`;
	}
	return candidate;
};

const buildDashboardWidgetPlacementInitialParams = (
	graph: GraphState | null,
	parentId: NodeId,
	placement: DashboardWidgetCreationPlacement
): UiCreateUserItemInitialParam[] => {
	const parentNode = graph?.nodesById.get(parentId) ?? null;
	const parentLayoutKind = getDashboardLayoutKind(graph, parentNode, 'free');
	const params: UiCreateUserItemInitialParam[] = [];

	if (parentLayoutKind === 'free' || parentLayoutKind === 'horizontal') {
		params.push(
			createInitialParam('layout/width', {
				kind: 'css_value',
				value: placement.size.width.value,
				unit: placement.size.width.unit
			})
		);
	}

	if (parentLayoutKind === 'free' || parentLayoutKind === 'vertical') {
		params.push(
			createInitialParam('layout/height', {
				kind: 'css_value',
				value: placement.size.height.value,
				unit: placement.size.height.unit
			})
		);
	}

	if (parentLayoutKind === 'free') {
		params.push(
			createInitialParam('layout/anchor', {
				kind: 'enum',
				value: placement.anchor
			}),
			createInitialParam('layout/position', {
				kind: 'vec2',
				value: [placement.position.x, placement.position.y]
			})
		);
	}

	return params;
};

const buildDashboardContainerWidgetInitialParams = (
	graph: GraphState | null,
	parentId: NodeId,
	placement: DashboardWidgetCreationPlacement,
	layoutKind?: DashboardLayoutKind
): UiCreateUserItemInitialParam[] => {
	const params = buildDashboardWidgetPlacementInitialParams(graph, parentId, placement);
	if (layoutKind) {
		params.push(
			createInitialParam('layout/layout_kind', {
				kind: 'enum',
				value: layoutKind
			})
		);
	}
	return params;
};

const buildDashboardNodeWidgetInitialParams = (
	graph: GraphState | null,
	parentId: NodeId,
	targetNode: UiNodeDto,
	placement: DashboardWidgetCreationPlacement
): UiCreateUserItemInitialParam[] => [
	createInitialParam('widget/target_node', createReferenceValue(graph, targetNode)),
	...buildDashboardWidgetPlacementInitialParams(graph, parentId, placement)
];

const buildDashboardGenericWidgetInitialParams = (
	graph: GraphState | null,
	parentId: NodeId,
	targetNode: UiNodeDto,
	placement: DashboardWidgetCreationPlacement
): UiCreateUserItemInitialParam[] => {
	const defaults = getGenericWidgetDefaults(targetNode, getDefaultSizingContext());
	const params: UiCreateUserItemInitialParam[] = [
		createInitialParam('binding/target_param', createReferenceValue(graph, targetNode)),
		createInitialParam('content/widget_kind', {
			kind: 'enum',
			value: defaults.widgetKind
		})
	];

	if (defaults.text !== undefined) {
		params.push(
			createInitialParam('content/text', {
				kind: 'str',
				value: defaults.text
			})
		);
	}

	if (defaults.valueRange) {
		const [min, max] = defaults.valueRange;
		params.push(
			createInitialParam('content/value_range', {
				kind: 'vec2',
				value: [min, max]
			})
		);
	}

	if (defaults.step !== undefined) {
		params.push(
			createInitialParam('content/step', {
				kind: 'float',
				value: defaults.step
			})
		);
	}

	if (defaults.placeholder !== undefined) {
		params.push(
			createInitialParam('content/placeholder', {
				kind: 'str',
				value: defaults.placeholder
			})
		);
	}

	if (defaults.multiline !== undefined) {
		params.push(
			createInitialParam('content/multiline', {
				kind: 'bool',
				value: defaults.multiline
			})
		);
	}

	if (defaults.defaultChecked !== undefined) {
		params.push(
			createInitialParam('content/default_checked', {
				kind: 'bool',
				value: defaults.defaultChecked
			})
		);
	}

	params.push(...buildDashboardWidgetPlacementInitialParams(graph, parentId, placement));
	return params;
};

export const bindDashboardNodeWidgetTarget = async (
	getGraph: GraphGetter,
	widgetNodeId: NodeId,
	targetNode: UiNodeDto
): Promise<boolean> => {
	const graph = getGraph();
	return setWidgetParamValue(
		getGraph,
		widgetNodeId,
		'target_node',
		createReferenceValue(graph, targetNode)
	);
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
	const bound = await setWidgetParamValue(
		getGraph,
		widgetNodeId,
		'target_param',
		createReferenceValue(graph, targetNode)
	);
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
): Promise<boolean> => {
	const graph = getGraph();
	const parent = graph?.nodesById.get(parentId);
	if (!parent) {
		return false;
	}
	const knownChildIds = new Set(parent.children);
	const editSession = createUiEditSession('Create dashboard node widget', 'dashboard-create');
	await editSession.begin();
	try {
		const placement =
			options?.placement ??
			getDashboardNodeWidgetCreationDefaults(targetNode, getDefaultSizingContext());
		const created = await sendCreateUserItemByTypeIntent(
			parentId,
			'dashboard_node_widget',
			targetNode.meta.label,
			{
				initial_params: buildDashboardNodeWidgetInitialParams(
					graph,
					parentId,
					targetNode,
					placement
				)
			}
		);
		if (!created.success) {
			return false;
		}
		const createdWidget = await waitForDirectItemChild(
			getGraph,
			parentId,
			knownChildIds,
			(child) => child.node_type === 'dashboard_node_widget'
		);
		if (createdWidget) {
			if (typeof options?.targetIndex === 'number') {
				await sendMoveNodeIntent(
					createdWidget.node_id,
					parentId,
					resolvePrevSiblingForParentItemIndex(
						getGraph(),
						parentId,
						options.targetIndex,
						createdWidget.node_id
					)
				);
			}
			await applyDashboardWidgetSizingMode(getGraph, createdWidget.node_id, parentId);
		}
		return true;
	} finally {
		await editSession.end();
	}
};

export const createDashboardGenericWidget = async (
	getGraph: GraphGetter,
	parentId: NodeId,
	targetNode: UiNodeDto,
	options?: DashboardWidgetCreationOptions
): Promise<boolean> => {
	if (targetNode.data.kind !== 'parameter') {
		return false;
	}
	const graph = getGraph();
	const parent = graph?.nodesById.get(parentId);
	if (!parent) {
		return false;
	}
	const knownChildIds = new Set(parent.children);
	const editSession = createUiEditSession('Create dashboard parameter widget', 'dashboard-create');
	await editSession.begin();
	try {
		const placement =
			options?.placement ??
			getDashboardGenericWidgetCreationDefaults(targetNode, getDefaultSizingContext()).placement;
		const created = await sendCreateUserItemByTypeIntent(
			parentId,
			'dashboard_generic_widget',
			targetNode.meta.label,
			{
				initial_params: buildDashboardGenericWidgetInitialParams(
					graph,
					parentId,
					targetNode,
					placement
				)
			}
		);
		if (!created.success) {
			return false;
		}
		const createdWidget = await waitForDirectItemChild(
			getGraph,
			parentId,
			knownChildIds,
			(child) => child.node_type === 'dashboard_generic_widget'
		);
		if (createdWidget) {
			if (typeof options?.targetIndex === 'number') {
				await sendMoveNodeIntent(
					createdWidget.node_id,
					parentId,
					resolvePrevSiblingForParentItemIndex(
						getGraph(),
						parentId,
						options.targetIndex,
						createdWidget.node_id
					)
				);
			}
			await applyDashboardWidgetSizingMode(getGraph, createdWidget.node_id, parentId);
		}
		return true;
	} finally {
		await editSession.end();
	}
};

const waitForDirectItemChild = async (
	getGraph: GraphGetter,
	parentId: NodeId,
	knownChildIds: ReadonlySet<NodeId>,
	predicate: (child: UiNodeDto) => boolean,
	timeoutMs = 1200
): Promise<UiNodeDto | null> => {
	return waitFor(() => {
		const graph = getGraph();
		const parent = graph?.nodesById.get(parentId);
		if (!graph || !parent) {
			return null;
		}

		for (const childId of parent.children) {
			if (knownChildIds.has(childId)) {
				continue;
			}
			const child = graph.nodesById.get(childId);
			if (!child || child.user_role !== 'itemRoot') {
				continue;
			}
			if (predicate(child)) {
				return child;
			}
		}

		return null;
	}, timeoutMs);
};

export const createDashboardContainerWidget = async (
	getGraph: GraphGetter,
	parentId: NodeId,
	options?: DashboardContainerWidgetCreationOptions
): Promise<NodeId | null> => {
	const graph = getGraph();
	const parent = graph?.nodesById.get(parentId);
	if (!parent) {
		return null;
	}

	const knownChildIds = new Set(parent.children);
	const editSession = createUiEditSession('Create dashboard container', 'dashboard-create');
	await editSession.begin();
	try {
		const placement =
			options?.placement ?? getDashboardContainerCreationDefaults(getDefaultSizingContext());
		const label = options?.label?.trim().length
			? options.label.trim()
			: getNextAvailableChildLabel(graph, parentId, 'Container');
		const created = await sendCreateUserItemByTypeIntent(
			parentId,
			'dashboard_widget_container',
			label,
			{
				initial_params: buildDashboardContainerWidgetInitialParams(
					graph,
					parentId,
					placement,
					options?.layoutKind
				)
			}
		);
		if (!created.success) {
			return null;
		}

		const container = await waitForDirectItemChild(
			getGraph,
			parentId,
			knownChildIds,
			(child) => child.node_type === 'dashboard_widget_container'
		);
		if (container) {
			if (typeof options?.targetIndex === 'number') {
				await sendMoveNodeIntent(
					container.node_id,
					parentId,
					resolvePrevSiblingForParentItemIndex(
						getGraph(),
						parentId,
						options.targetIndex,
						container.node_id
					)
				);
			}
			await applyDashboardWidgetSizingMode(getGraph, container.node_id, parentId);
		}
		return container?.node_id ?? null;
	} finally {
		await editSession.end();
	}
};

const resolveLastDashboardItemChildId = (
	graph: GraphState | null,
	parentId: NodeId,
	excludedNodeId?: NodeId
): NodeId | undefined => {
	const children = getDirectItemChildren(graph, graph?.nodesById.get(parentId) ?? null);
	for (let index = children.length - 1; index >= 0; index -= 1) {
		const child = children[index];
		if (child && child.node_id !== excludedNodeId) {
			return child.node_id;
		}
	}
	return undefined;
};

const getParentOrderingLists = (
	graph: GraphState | null,
	parentId: NodeId,
	excludedNodeId?: NodeId
): { orderedSiblings: UiNodeDto[]; itemSiblings: UiNodeDto[] } | null => {
	if (!graph) {
		return null;
	}

	const parent = graph.nodesById.get(parentId);
	if (!parent) {
		return null;
	}

	const orderedSiblings = parent.children
		.map((childId) => graph.nodesById.get(childId))
		.filter((child): child is UiNodeDto => child !== undefined && child.node_id !== excludedNodeId);
	return {
		orderedSiblings,
		itemSiblings: orderedSiblings.filter((child) => child.user_role === 'itemRoot')
	};
};

const resolvePrevSiblingForParentItemIndex = (
	graph: GraphState | null,
	parentId: NodeId,
	targetIndex: number,
	excludedNodeId?: NodeId
): NodeId | undefined => {
	const ordering = getParentOrderingLists(graph, parentId, excludedNodeId);
	if (!ordering) {
		return undefined;
	}

	const nextIndex = Math.max(0, Math.min(ordering.itemSiblings.length, targetIndex));
	if (nextIndex === 0) {
		const firstItemId = ordering.itemSiblings[0]?.node_id;
		if (firstItemId !== undefined) {
			const firstItemIndex = ordering.orderedSiblings.findIndex(
				(child) => child.node_id === firstItemId
			);
			return firstItemIndex > 0 ? ordering.orderedSiblings[firstItemIndex - 1]?.node_id : undefined;
		}
		return ordering.orderedSiblings.at(-1)?.node_id;
	}

	return ordering.itemSiblings[nextIndex - 1]?.node_id;
};

const applyDashboardWidgetPlacement = async (
	getGraph: GraphGetter,
	widgetNodeId: NodeId,
	parentId: NodeId,
	placement: DashboardWidgetCreationPlacement
): Promise<boolean> => {
	const graph = getGraph();
	const parentNode = graph?.nodesById.get(parentId) ?? null;
	if (!parentNode) {
		return false;
	}

	const parentLayoutKind = getDashboardLayoutKind(graph, parentNode, 'free');
	let success = true;

	if (parentLayoutKind === 'free' || parentLayoutKind === 'horizontal') {
		success =
			(await setWidgetParamValue(getGraph, widgetNodeId, 'width', {
				kind: 'css_value',
				value: placement.size.width.value,
				unit: placement.size.width.unit
			})) && success;
	}

	if (parentLayoutKind === 'free' || parentLayoutKind === 'vertical') {
		success =
			(await setWidgetParamValue(getGraph, widgetNodeId, 'height', {
				kind: 'css_value',
				value: placement.size.height.value,
				unit: placement.size.height.unit
			})) && success;
	}

	if (parentLayoutKind === 'free') {
		success =
			(await setWidgetParamValue(getGraph, widgetNodeId, 'anchor', {
				kind: 'enum',
				value: placement.anchor
			})) && success;
		success =
			(await setWidgetParamValue(getGraph, widgetNodeId, 'position', {
				kind: 'vec2',
				value: [placement.position.x, placement.position.y]
			})) && success;
	}

	await applyDashboardWidgetSizingMode(getGraph, widgetNodeId, parentId, placement.sizeEnabled);

	return success;
};

export const moveDashboardWidgetToSurface = async (
	getGraph: GraphGetter,
	widgetNodeId: NodeId,
	newParentId: NodeId,
	placement?: DashboardWidgetCreationPlacement,
	targetIndex?: number
): Promise<boolean> => {
	const graph = getGraph();
	const widget = graph?.nodesById.get(widgetNodeId);
	const newParent = graph?.nodesById.get(newParentId);
	if (!widget || !newParent) {
		return false;
	}

	const editSession = createUiEditSession('Move dashboard widget', 'dashboard-move');
	await editSession.begin();
	try {
		const sourceParentId = graph?.parentById.get(widgetNodeId);
		const currentOrderingState = getDashboardWidgetOrderingState(graph, widgetNodeId);
		const normalizedTargetIndex =
			typeof targetIndex === 'number' ? Math.max(0, Math.round(targetIndex)) : undefined;
		const needsMove =
			sourceParentId !== newParentId ||
			(normalizedTargetIndex !== undefined &&
				normalizedTargetIndex !== currentOrderingState?.currentIndex);

		if (needsMove) {
			const moved = await sendMoveNodeIntent(
				widgetNodeId,
				newParentId,
				normalizedTargetIndex === undefined
					? resolveLastDashboardItemChildId(getGraph(), newParentId, widgetNodeId)
					: resolvePrevSiblingForParentItemIndex(
							getGraph(),
							newParentId,
							normalizedTargetIndex,
							widgetNodeId
						)
			);
			if (!moved) {
				return false;
			}
		}
		if (!placement) {
			return needsMove;
		}
		return applyDashboardWidgetPlacement(getGraph, widgetNodeId, newParentId, placement);
	} finally {
		await editSession.end();
	}
};

interface DashboardWidgetOrderingContext {
	parentId: NodeId;
	orderedSiblings: UiNodeDto[];
	itemSiblings: UiNodeDto[];
	currentIndex: number;
}

const getDashboardWidgetOrderingContext = (
	graph: GraphState | null,
	widgetNodeId: NodeId
): DashboardWidgetOrderingContext | null => {
	const parentId = graph?.parentById.get(widgetNodeId);
	if (!graph || parentId === undefined) {
		return null;
	}

	const parent = graph.nodesById.get(parentId);
	if (!parent) {
		return null;
	}

	const orderedSiblings = parent.children
		.map((childId) => graph.nodesById.get(childId))
		.filter((child): child is UiNodeDto => child !== undefined);
	const itemSiblings = orderedSiblings.filter((child) => child.user_role === 'itemRoot');
	const currentIndex = itemSiblings.findIndex((child) => child.node_id === widgetNodeId);
	if (currentIndex < 0) {
		return null;
	}

	return {
		parentId,
		orderedSiblings,
		itemSiblings,
		currentIndex
	};
};

const resolvePrevSiblingForItemIndex = (
	context: DashboardWidgetOrderingContext,
	widgetNodeId: NodeId,
	targetIndex: number
): NodeId | undefined => {
	const siblingsWithoutNode = context.orderedSiblings.filter(
		(child) => child.node_id !== widgetNodeId
	);
	const itemSiblingsWithoutNode = context.itemSiblings.filter(
		(child) => child.node_id !== widgetNodeId
	);

	if (targetIndex === 0) {
		const firstItemId = itemSiblingsWithoutNode[0]?.node_id;
		if (firstItemId !== undefined) {
			const firstItemIndex = siblingsWithoutNode.findIndex(
				(child) => child.node_id === firstItemId
			);
			return firstItemIndex > 0 ? siblingsWithoutNode[firstItemIndex - 1]?.node_id : undefined;
		}
		return siblingsWithoutNode.at(-1)?.node_id;
	}

	return itemSiblingsWithoutNode[targetIndex - 1]?.node_id;
};

export const getDashboardWidgetOrderingState = (
	graph: GraphState | null,
	widgetNodeId: NodeId
): DashboardWidgetOrderingState | null => {
	const context = getDashboardWidgetOrderingContext(graph, widgetNodeId);
	if (!context) {
		return null;
	}
	return {
		currentIndex: context.currentIndex,
		itemCount: context.itemSiblings.length
	};
};

export const moveDashboardWidgetToIndex = async (
	getGraph: GraphGetter,
	widgetNodeId: NodeId,
	targetIndex: number
): Promise<boolean> => {
	const context = getDashboardWidgetOrderingContext(getGraph(), widgetNodeId);
	if (!context) {
		return false;
	}

	const nextIndex = Math.max(0, Math.min(context.itemSiblings.length - 1, targetIndex));
	if (nextIndex === context.currentIndex) {
		return false;
	}

	return sendMoveNodeIntent(
		widgetNodeId,
		context.parentId,
		resolvePrevSiblingForItemIndex(context, widgetNodeId, nextIndex)
	);
};

export const moveDashboardWidgetByDelta = async (
	getGraph: GraphGetter,
	widgetNodeId: NodeId,
	delta: number
): Promise<boolean> => {
	if (delta === 0) {
		return false;
	}

	const orderingState = getDashboardWidgetOrderingState(getGraph(), widgetNodeId);
	if (!orderingState) {
		return false;
	}

	return moveDashboardWidgetToIndex(getGraph, widgetNodeId, orderingState.currentIndex + delta);
};

export const moveDashboardWidgetToFront = async (
	getGraph: GraphGetter,
	widgetNodeId: NodeId
): Promise<boolean> => {
	const orderingState = getDashboardWidgetOrderingState(getGraph(), widgetNodeId);
	if (!orderingState) {
		return false;
	}
	return moveDashboardWidgetToIndex(getGraph, widgetNodeId, orderingState.itemCount - 1);
};

export const moveDashboardWidgetToBack = async (
	getGraph: GraphGetter,
	widgetNodeId: NodeId
): Promise<boolean> => {
	return moveDashboardWidgetToIndex(getGraph, widgetNodeId, 0);
};

export const duplicateDashboardWidget = async (
	getGraph: GraphGetter,
	widgetNodeId: NodeId,
	label?: string
): Promise<boolean> => {
	const graph = getGraph();
	const parentId = graph?.parentById.get(widgetNodeId);
	if (!graph || parentId === undefined) {
		return false;
	}

	return sendDuplicateNodeIntent(widgetNodeId, parentId, widgetNodeId, label);
};

export const wrapDashboardWidgetInContainer = async (
	getGraph: GraphGetter,
	widgetNodeId: NodeId
): Promise<boolean> => {
	const graph = getGraph();
	const widget = graph?.nodesById.get(widgetNodeId);
	const parentId = graph?.parentById.get(widgetNodeId);
	if (!graph || !widget || parentId === undefined) {
		return false;
	}

	const parent = graph.nodesById.get(parentId);
	if (!parent) {
		return false;
	}

	const widgetChildIndex = parent.children.findIndex((childId) => childId === widgetNodeId);
	if (widgetChildIndex < 0) {
		return false;
	}

	const originalPrevSibling =
		widgetChildIndex > 0 ? parent.children[widgetChildIndex - 1] : undefined;
	const widgetPlacement = getDashboardPlacement(graph, widget);
	const containerPlacement: DashboardWidgetCreationPlacement = {
		anchor: widgetPlacement.anchor,
		position: { ...widgetPlacement.position },
		size: {
			width: { ...widgetPlacement.size.width },
			height: { ...widgetPlacement.size.height }
		}
	};
	const preferredLabel =
		widget.meta.label.trim().length > 0 ? `${widget.meta.label.trim()} Container` : 'Container';
	const containerLabel = getNextAvailableChildLabel(graph, parentId, preferredLabel);

	const editSession = createUiEditSession('Wrap dashboard widget in container', 'dashboard-wrap');
	await editSession.begin();
	try {
		const containerId = await createDashboardContainerWidget(getGraph, parentId, {
			label: containerLabel,
			placement: containerPlacement,
			layoutKind: 'vertical'
		});
		if (containerId === null) {
			return false;
		}

		const positioned = await sendMoveNodeIntent(containerId, parentId, originalPrevSibling);
		if (!positioned) {
			return false;
		}

		return sendMoveNodeIntent(widgetNodeId, containerId);
	} finally {
		await editSession.end();
	}
};
