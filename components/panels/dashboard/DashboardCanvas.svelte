<script lang="ts">
	import { onDestroy } from 'svelte';
	import { registerCommandHandler } from '$lib/golden_ui/store/commands.svelte';
	import { appState, type SelectionMode } from '$lib/golden_ui/store/workbench.svelte';
	import { createUiEditSession, sendSetParamIntent } from '$lib/golden_ui/store/ui-intents';
	import type { NodeId, ParamEventBehaviour, ParamValue, UiNodeDto } from '$lib/golden_ui/types';
	import {
		cssValueToPx,
		formatCssValue,
		parseCssValue,
		pxToCssValue,
		type CssUnitConversionContext,
		type CssValueData
	} from '$lib/golden_ui/css-value';
	import DashboardCanvasSelf from './DashboardCanvas.svelte';
	import { resolveDashboardNodeWidgetDisplayMode } from './dashboard-node-widget-registry';
	import DashboardNodeWidgetParameterEditorContent from './DashboardNodeWidgetParameterEditorContent.svelte';

	import {
		bindDashboardGenericWidgetTarget,
		bindDashboardNodeWidgetTarget,
		createDashboardGenericWidget,
		createDashboardNodeWidget,
		getDashboardGenericWidgetCreationDefaults,
		getDashboardNodeWidgetCreationDefaults,
		type DashboardWidgetCreationPlacement
	} from './dashboard-actions';
	import { readDashboardDragPayload, type DashboardDragPayload } from './dashboard-drag';
	import {
		type DashboardAnchor,
		formatParamValue,
		getDashboardLayoutKind,
		getDashboardPageSize,
		getDashboardPlacement,
		getDashboardSnapGrid,
		getDirectItemChildren,
		getDirectParam,
		getDirectParamNode,
		getLiveNode,
		getGap,
		getGridColumns,
		resolveReferenceTarget,
		type DashboardPlacement,
		type DashboardLayoutKind
	} from './dashboard-model';

	type DashboardPersistedPageView = {
		panX: number;
		panY: number;
		zoom: number;
	};

	type DashboardPersistedPageViewChangeHandler = (
		pageNodeId: NodeId,
		nextPageView: DashboardPersistedPageView
	) => void;

	type SurfaceDropPreview = {
		label: string;
		targetKind: DashboardDragPayload['kind'];
		placement: DashboardWidgetCreationPlacement;
	};

	let {
		node,
		editMode = false,
		persistedPageView = null,
		onPersistedPageViewChange = null
	} = $props<{
		node: UiNodeDto;
		editMode?: boolean;
		persistedPageView?: DashboardPersistedPageView | null;
		onPersistedPageViewChange?: DashboardPersistedPageViewChangeHandler | null;
	}>();

	let session = $derived(appState.session);
	let graph = $derived(session?.graph.state ?? null);
	let liveNode = $derived(getLiveNode(graph, node));
	let isSelected = $derived(session?.isNodeSelected(liveNode.node_id) ?? false);
	let isPage = $derived(liveNode.node_type === 'dashboard_page');
	let isContainerWidget = $derived(liveNode.node_type === 'dashboard_widget_container');
	let isNodeWidget = $derived(liveNode.node_type === 'dashboard_node_widget');
	let isGenericWidget = $derived(liveNode.node_type === 'dashboard_generic_widget');
	let isLayoutSurface = $derived(isPage || isContainerWidget);

	let placement = $derived(getDashboardPlacement(graph, liveNode));
	let parentNode = $derived.by(() => {
		const parentId = graph?.parentById.get(liveNode.node_id);
		if (parentId === undefined || !graph) {
			return null;
		}
		return graph.nodesById.get(parentId) ?? null;
	});
	let parentLayoutKind = $derived(getDashboardLayoutKind(graph, parentNode, 'free'));
	let layoutKind = $derived(getDashboardLayoutKind(graph, liveNode, isPage ? 'free' : 'vertical'));
	let gap = $derived(getGap(graph, liveNode));
	let gridColumns = $derived(getGridColumns(graph, liveNode, 12));
	let childWidgets = $derived(getDirectItemChildren(graph, liveNode));

	let activeTabNodeId = $state<NodeId | null>(null);
	let openAccordionNodeIds = $state<NodeId[]>([]);
	let surfaceDragDepth = $state(0);
	let bindingDragDepth = $state(0);
	let isPageViewportFocused = $state(false);
	let pageViewportElement = $state<HTMLDivElement | null>(null);
	let widgetShellElement = $state<HTMLElement | null>(null);
	let pageViewportSize = $state({ width: 0, height: 0 });
	let pageViewportResizeFrame = $state<number | null>(null);
	let surfaceDropPreview = $state<SurfaceDropPreview | null>(null);
	let pendingPersistedPageView = $state<DashboardPersistedPageView | null>(null);
	let appliedPersistedPageView = $state<DashboardPersistedPageView | null>(null);
	type ObservedAnchorPlacement = {
		nodeId: NodeId;
		anchor: DashboardAnchor;
		position: { x: number; y: number };
		size: { width: CssValueData; height: CssValueData };
	};
	type AnchorGuideAxis = 'horizontal' | 'vertical';
	type AnchorGuideDirection = 'left' | 'right' | 'up' | 'down';
	type AnchorGuide = {
		axis: AnchorGuideAxis;
		direction: AnchorGuideDirection;
		style: string;
	};

	type FreeLayoutInteractionMode = 'move' | 'resize';
	type FreeLayoutResizeEdges = {
		left: boolean;
		right: boolean;
		top: boolean;
		bottom: boolean;
	};
	type FreeLayoutPreview = {
		position: { x: number; y: number };
		size: { width: CssValueData; height: CssValueData };
	};
	type FreeLayoutTarget = {
		nodeId: NodeId;
		anchor: DashboardAnchor;
		positionParamNodeId: NodeId | null;
		positionParamBehaviour: ParamEventBehaviour | null;
		widthParamNodeId: NodeId | null;
		widthParamBehaviour: ParamEventBehaviour | null;
		heightParamNodeId: NodeId | null;
		heightParamBehaviour: ParamEventBehaviour | null;
		startPreview: FreeLayoutPreview;
		startRect: FreeLayoutRect;
	};
	type FreeLayoutTargetPreview = {
		target: FreeLayoutTarget;
		preview: FreeLayoutPreview;
	};
	type FreeLayoutPreviewSet = {
		primaryNodeId: NodeId;
		previews: FreeLayoutTargetPreview[];
	};
	type FreeLayoutInteraction = {
		pointerId: number;
		mode: FreeLayoutInteractionMode;
		resizeEdges: FreeLayoutResizeEdges | null;
		primaryNodeId: NodeId;
		selectionRect: FreeLayoutRect;
		targets: FreeLayoutTarget[];
		startClient: [number, number];
		rootRemPx: number;
		surfaceWidthPx: number;
		surfaceHeightPx: number;
		surfaceScaleX: number;
		surfaceScaleY: number;
		viewportWidthPx: number;
		viewportHeightPx: number;
	};
	type SurfaceMetrics = {
		width: number;
		height: number;
		scaleX: number;
		scaleY: number;
	};
	type FreeLayoutRect = {
		left: number;
		top: number;
		width: number;
		height: number;
	};
	type DashboardPageViewState = {
		pointerId: number | null;
		lastClient: [number, number] | null;
		panX: number;
		panY: number;
		zoom: number;
	};
	type FreeLayoutResizeZone = {
		name: string;
		edges: FreeLayoutResizeEdges;
	};
	type MarqueeSelectionState = {
		pointerId: number;
		surfaceNodeId: NodeId;
		surfaceElement: HTMLElement;
		startClient: [number, number];
		currentClient: [number, number];
		baseSelection: NodeId[];
		selectionMode: SelectionMode;
	};

	let freeLayoutInteraction = $state<FreeLayoutInteraction | null>(null);
	let freeLayoutPreview = $state<FreeLayoutPreviewSet | null>(null);
	let marqueeSelection = $state<MarqueeSelectionState | null>(null);
	let pageView = $state<DashboardPageViewState>({
		pointerId: null,
		lastClient: null,
		panX: 0,
		panY: 0,
		zoom: 1
	});

	const minFreeWidgetWidthRem = 0.5;
	const minFreeWidgetHeightRem = 0.5;
	const freeLayoutResizeZones: FreeLayoutResizeZone[] = [
		{ name: 'north-west', edges: { left: true, right: false, top: true, bottom: false } },
		{ name: 'north', edges: { left: false, right: false, top: true, bottom: false } },
		{ name: 'north-east', edges: { left: false, right: true, top: true, bottom: false } },
		{ name: 'east', edges: { left: false, right: true, top: false, bottom: false } },
		{ name: 'south-east', edges: { left: false, right: true, top: false, bottom: true } },
		{ name: 'south', edges: { left: false, right: false, top: false, bottom: true } },
		{ name: 'south-west', edges: { left: true, right: false, top: false, bottom: true } },
		{ name: 'west', edges: { left: true, right: false, top: false, bottom: false } }
	];
	const minPageZoom = 0.25;
	const maxPageZoom = 4;
	let freeLayoutCommitFrame: number | null = null;
	let freeLayoutCommitInFlight = false;
	let pendingFreeLayoutCommit: FreeLayoutPreviewSet | null = null;
	let lastCommittedFreeLayoutPreview: FreeLayoutPreviewSet | null = null;
	let freeLayoutEditSession: ReturnType<typeof createUiEditSession> | null = null;
	let observedAnchorPlacementCache: ObservedAnchorPlacement | null = null;

	const getGraph = () => appState.session?.graph.state ?? null;

	const getRootRemPixels = (): number => {
		if (typeof window === 'undefined') {
			return 16;
		}
		const fontSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize);
		return Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 16;
	};

	const getViewportWidthPx = (): number =>
		typeof window === 'undefined' ? 1280 : Math.max(window.innerWidth, 1);

	const getViewportHeightPx = (): number =>
		typeof window === 'undefined' ? 720 : Math.max(window.innerHeight, 1);

	const getClosestSurfaceMetrics = (
		target: EventTarget | null,
		rootRemPx: number
	): SurfaceMetrics => {
		if (!(target instanceof Element)) {
			return { width: getViewportWidthPx(), height: 20 * rootRemPx, scaleX: 1, scaleY: 1 };
		}
		const surface = target.closest('.dashboard-surface');
		if (!surface) {
			return { width: getViewportWidthPx(), height: 20 * rootRemPx, scaleX: 1, scaleY: 1 };
		}
		const rect = surface.getBoundingClientRect();
		const layoutWidth =
			surface instanceof HTMLElement ? Math.max(surface.clientWidth, 1) : Math.max(rect.width, 1);
		const layoutHeight =
			surface instanceof HTMLElement ? Math.max(surface.clientHeight, 1) : Math.max(rect.height, 1);
		return {
			width: Math.max(layoutWidth, rootRemPx),
			height: Math.max(layoutHeight, rootRemPx),
			scaleX: Math.max(rect.width, 1) / layoutWidth,
			scaleY: Math.max(rect.height, 1) / layoutHeight
		};
	};

	const getElementSurfaceMetrics = (element: HTMLElement, rootRemPx: number): SurfaceMetrics => {
		const rect = element.getBoundingClientRect();
		const layoutWidth = Math.max(element.clientWidth, 1);
		const layoutHeight = Math.max(element.clientHeight, 1);
		return {
			width: Math.max(layoutWidth, rootRemPx),
			height: Math.max(layoutHeight, rootRemPx),
			scaleX: Math.max(rect.width, 1) / layoutWidth,
			scaleY: Math.max(rect.height, 1) / layoutHeight
		};
	};

	const getDirectDashboardLayoutElement = (surface: EventTarget | null): HTMLElement | null => {
		if (!(surface instanceof HTMLElement)) {
			return null;
		}
		for (const child of Array.from(surface.children)) {
			if (child instanceof HTMLElement && child.classList.contains('dashboard-layout')) {
				return child;
			}
		}
		return null;
	};

	const selectionModeFromEvent = (
		event: Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>
	): SelectionMode => {
		if (event.ctrlKey || event.metaKey) {
			return 'TOGGLE';
		}
		if (event.shiftKey) {
			return 'ADD';
		}
		return 'REPLACE';
	};

	const isInteractiveSurfaceTarget = (target: EventTarget | null): boolean => {
		if (!(target instanceof Element)) {
			return false;
		}
		return Boolean(
			target.closest(
				'button, input, textarea, select, option, label, a, [contenteditable="true"], [role="button"]'
			)
		);
	};

	const normalizeClientRect = (
		startClient: [number, number],
		currentClient: [number, number]
	): FreeLayoutRect => {
		const left = Math.min(startClient[0], currentClient[0]);
		const top = Math.min(startClient[1], currentClient[1]);
		return {
			left,
			top,
			width: Math.abs(currentClient[0] - startClient[0]),
			height: Math.abs(currentClient[1] - startClient[1])
		};
	};

	const rectsIntersect = (
		left: DOMRect | FreeLayoutRect,
		right: DOMRect | FreeLayoutRect
	): boolean => {
		return (
			left.left < right.left + right.width &&
			left.left + left.width > right.left &&
			left.top < right.top + right.height &&
			left.top + left.height > right.top
		);
	};

	const collectMarqueeNodeIds = (selection: MarqueeSelectionState): NodeId[] => {
		const childNodeIdByString = new Map(
			childWidgets.map((child) => [String(child.node_id), child.node_id])
		);
		const selector = `.dashboard-widget-shell[data-dashboard-surface-id="${String(selection.surfaceNodeId)}"]`;
		const selectionRect = normalizeClientRect(selection.startClient, selection.currentClient);
		const nodeIds: NodeId[] = [];
		for (const element of selection.surfaceElement.querySelectorAll<HTMLElement>(selector)) {
			const nodeId = childNodeIdByString.get(element.dataset.nodeId ?? '');
			if (nodeId === undefined) {
				continue;
			}
			const rect = element.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0) {
				continue;
			}
			if (!rectsIntersect(selectionRect, rect)) {
				continue;
			}
			nodeIds.push(nodeId);
		}
		return nodeIds;
	};

	const applyMarqueeSelection = (selection: MarqueeSelectionState): void => {
		const intersectingNodeIds = collectMarqueeNodeIds(selection);
		let nextSelection = intersectingNodeIds;
		if (selection.selectionMode === 'ADD') {
			nextSelection = [...selection.baseSelection];
			for (const nodeId of intersectingNodeIds) {
				if (!nextSelection.includes(nodeId)) {
					nextSelection.push(nodeId);
				}
			}
		} else if (selection.selectionMode === 'TOGGLE') {
			const toggled = new Set(selection.baseSelection);
			for (const nodeId of intersectingNodeIds) {
				if (toggled.has(nodeId)) {
					toggled.delete(nodeId);
				} else {
					toggled.add(nodeId);
				}
			}
			nextSelection = Array.from(toggled);
		}
		session?.selectNodes(nextSelection, 'REPLACE');
	};

	const canScrollAxis = (element: HTMLElement, axis: 'x' | 'y', delta: number): boolean => {
		if (delta === 0) {
			return false;
		}
		const style = window.getComputedStyle(element);
		const overflowValue = axis === 'x' ? style.overflowX : style.overflowY;
		if (!['auto', 'scroll', 'overlay'].includes(overflowValue)) {
			return false;
		}
		const scrollOffset = axis === 'x' ? element.scrollLeft : element.scrollTop;
		const scrollExtent =
			axis === 'x'
				? element.scrollWidth - element.clientWidth
				: element.scrollHeight - element.clientHeight;
		if (scrollExtent <= 1) {
			return false;
		}
		return delta < 0 ? scrollOffset > 1 : scrollOffset < scrollExtent - 1;
	};

	const wheelTargetsScrollableContent = (event: WheelEvent): boolean => {
		if (!(event.target instanceof Element) || !pageViewportElement) {
			return false;
		}
		let current: Element | null = event.target;
		while (current && current !== pageViewportElement) {
			if (
				current instanceof HTMLElement &&
				(canScrollAxis(current, 'y', event.deltaY) || canScrollAxis(current, 'x', event.deltaX))
			) {
				return true;
			}
			current = current.parentElement;
		}
		return false;
	};

	const normalizeWheelDeltaY = (event: WheelEvent): number => {
		if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
			return event.deltaY * getRootRemPixels();
		}
		if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
			return event.deltaY * pageViewportHeightPx;
		}
		return event.deltaY;
	};

	const createCssUnitContext = (
		interaction: Pick<
			FreeLayoutInteraction,
			'rootRemPx' | 'surfaceWidthPx' | 'surfaceHeightPx' | 'viewportWidthPx' | 'viewportHeightPx'
		>,
		axis: 'x' | 'y'
	): CssUnitConversionContext => ({
		rootRemPx: interaction.rootRemPx,
		axisBasePx: axis === 'x' ? interaction.surfaceWidthPx : interaction.surfaceHeightPx,
		viewportWidthPx: interaction.viewportWidthPx,
		viewportHeightPx: interaction.viewportHeightPx
	});

	const sameNodeIdList = (left: NodeId[], right: NodeId[]): boolean => {
		if (left.length !== right.length) {
			return false;
		}
		for (let index = 0; index < left.length; index += 1) {
			if (left[index] !== right[index]) {
				return false;
			}
		}
		return true;
	};

	const isFreeLayoutTransformableWidget = (candidate: UiNodeDto): boolean => {
		return (
			candidate.node_type === 'dashboard_widget_container' ||
			candidate.node_type === 'dashboard_node_widget' ||
			candidate.node_type === 'dashboard_generic_widget'
		);
	};

	const cloneFreeLayoutPreview = (preview: FreeLayoutPreview): FreeLayoutPreview => ({
		position: {
			x: preview.position.x,
			y: preview.position.y
		},
		size: {
			width: { ...preview.size.width },
			height: { ...preview.size.height }
		}
	});

	const cloneFreeLayoutPreviewSet = (previewSet: FreeLayoutPreviewSet): FreeLayoutPreviewSet => ({
		primaryNodeId: previewSet.primaryNodeId,
		previews: previewSet.previews.map((entry) => ({
			target: entry.target,
			preview: cloneFreeLayoutPreview(entry.preview)
		}))
	});

	const resolveFreeLayoutPreview = (
		previewSet: FreeLayoutPreviewSet | null,
		nodeId: NodeId
	): FreeLayoutPreview | null => {
		if (!previewSet) {
			return null;
		}
		for (const entry of previewSet.previews) {
			if (entry.target.nodeId === nodeId) {
				return entry.preview;
			}
		}
		return null;
	};

	const buildPreviewSetFromTargets = (
		primaryNodeId: NodeId,
		targets: FreeLayoutTarget[]
	): FreeLayoutPreviewSet => ({
		primaryNodeId,
		previews: targets.map((target) => ({
			target,
			preview: cloneFreeLayoutPreview(target.startPreview)
		}))
	});

	const currentPlacementPreview = (): FreeLayoutPreview => ({
		position: {
			x: placement.position.x,
			y: placement.position.y
		},
		size: {
			width: { ...placement.size.width },
			height: { ...placement.size.height }
		}
	});

	const sameCssValue = (left: CssValueData, right: CssValueData): boolean =>
		left.value === right.value && left.unit === right.unit;

	const samePosition = (left: { x: number; y: number }, right: { x: number; y: number }): boolean =>
		left.x === right.x && left.y === right.y;

	const samePlacementSize = (
		left: { width: CssValueData; height: CssValueData },
		right: { width: CssValueData; height: CssValueData }
	): boolean => sameCssValue(left.width, right.width) && sameCssValue(left.height, right.height);

	const snapToGridPx = (valuePx: number, snapPx: number): number => {
		if (!(snapPx > 0)) {
			return valuePx;
		}
		return Math.round(valuePx / snapPx) * snapPx;
	};

	const anchorXFromAnchor = (anchor: DashboardAnchor): 'left' | 'center' | 'right' => {
		if (anchor.endsWith('right')) {
			return 'right';
		}
		if (anchor === 'center' || anchor.endsWith('center')) {
			return 'center';
		}
		return 'left';
	};

	const anchorYFromAnchor = (anchor: DashboardAnchor): 'top' | 'center' | 'bottom' => {
		if (anchor.startsWith('bottom')) {
			return 'bottom';
		}
		if (anchor === 'center' || anchor.startsWith('center')) {
			return 'center';
		}
		return 'top';
	};

	const anchorBasePx = (
		anchor: 'left' | 'center' | 'right' | 'top' | 'center' | 'bottom',
		axisExtentPx: number
	): number => {
		if (anchor === 'center') {
			return axisExtentPx * 0.5;
		}
		if (anchor === 'right' || anchor === 'bottom') {
			return axisExtentPx;
		}
		return 0;
	};

	const anchorOffsetPx = (
		anchor: 'left' | 'center' | 'right' | 'top' | 'center' | 'bottom',
		sizePx: number
	): number => {
		if (anchor === 'center') {
			return sizePx * 0.5;
		}
		if (anchor === 'right' || anchor === 'bottom') {
			return sizePx;
		}
		return 0;
	};

	const anchorBaseExpression = (
		anchor: 'left' | 'center' | 'right' | 'top' | 'center' | 'bottom'
	): string => {
		if (anchor === 'center') {
			return '50%';
		}
		if (anchor === 'right' || anchor === 'bottom') {
			return '100%';
		}
		return '0px';
	};

	const freeLayoutRectFromPlacement = (
		placementLike: {
			position: { x: number; y: number };
			size: { width: CssValueData; height: CssValueData };
			anchor: DashboardAnchor;
		},
		interaction: Pick<
			FreeLayoutInteraction,
			'surfaceWidthPx' | 'surfaceHeightPx' | 'rootRemPx' | 'viewportWidthPx' | 'viewportHeightPx'
		>
	): FreeLayoutRect => {
		const xContext = createCssUnitContext(interaction, 'x');
		const yContext = createCssUnitContext(interaction, 'y');
		const widthPx = Math.max(0, cssValueToPx(placementLike.size.width, 'x', xContext));
		const heightPx = Math.max(0, cssValueToPx(placementLike.size.height, 'y', yContext));
		const anchorX = anchorXFromAnchor(placementLike.anchor);
		const anchorY = anchorYFromAnchor(placementLike.anchor);
		const anchorPointXPx =
			anchorBasePx(anchorX, interaction.surfaceWidthPx) + placementLike.position.x;
		const anchorPointYPx =
			anchorBasePx(anchorY, interaction.surfaceHeightPx) + placementLike.position.y;
		return {
			left: anchorPointXPx - anchorOffsetPx(anchorX, widthPx),
			top: anchorPointYPx - anchorOffsetPx(anchorY, heightPx),
			width: widthPx,
			height: heightPx
		};
	};

	const freeLayoutPreviewFromRect = (
		rect: FreeLayoutRect,
		anchor: DashboardAnchor,
		interaction: Pick<
			FreeLayoutInteraction,
			'surfaceWidthPx' | 'surfaceHeightPx' | 'rootRemPx' | 'viewportWidthPx' | 'viewportHeightPx'
		>,
		positionTemplate: { x: number; y: number },
		sizeTemplate: { width: CssValueData; height: CssValueData }
	): FreeLayoutPreview => {
		const xContext = createCssUnitContext(interaction, 'x');
		const yContext = createCssUnitContext(interaction, 'y');
		const anchorX = anchorXFromAnchor(anchor);
		const anchorY = anchorYFromAnchor(anchor);
		const anchorPointXPx = rect.left + anchorOffsetPx(anchorX, rect.width);
		const anchorPointYPx = rect.top + anchorOffsetPx(anchorY, rect.height);
		return {
			position: {
				x: anchorPointXPx - anchorBasePx(anchorX, interaction.surfaceWidthPx),
				y: anchorPointYPx - anchorBasePx(anchorY, interaction.surfaceHeightPx)
			},
			size: {
				width: pxToCssValue(rect.width, sizeTemplate.width, 'x', xContext),
				height: pxToCssValue(rect.height, sizeTemplate.height, 'y', yContext)
			}
		};
	};

	const clampPageZoom = (zoom: number): number =>
		Math.min(maxPageZoom, Math.max(minPageZoom, zoom));

	const resolveSelectedFreeLayoutWidgets = (): UiNodeDto[] => {
		if (!graph || !parentNode || !session) {
			return [];
		}
		const selectedNodeIds = new Set(session.selectedNodesIds);
		return getDirectItemChildren(graph, parentNode).filter(
			(candidate) =>
				selectedNodeIds.has(candidate.node_id) && isFreeLayoutTransformableWidget(candidate)
		);
	};

	const resolveTransformNodes = (): UiNodeDto[] => {
		const selectedWidgets = resolveSelectedFreeLayoutWidgets();
		if (isSelected && selectedWidgets.length > 1) {
			return selectedWidgets;
		}
		return [liveNode];
	};

	const buildFreeLayoutTargets = (
		nodes: UiNodeDto[],
		interaction: Pick<
			FreeLayoutInteraction,
			'rootRemPx' | 'surfaceWidthPx' | 'surfaceHeightPx' | 'viewportWidthPx' | 'viewportHeightPx'
		>
	): FreeLayoutTarget[] => {
		if (!graph) {
			return [];
		}
		const targets: FreeLayoutTarget[] = [];
		for (const targetNode of nodes) {
			const targetPlacement = getDashboardPlacement(graph, targetNode);
			const positionParamNode = getDirectParamNode(graph, targetNode, 'position');
			const widthParamNode = getDirectParamNode(graph, targetNode, 'width');
			const heightParamNode = getDirectParamNode(graph, targetNode, 'height');
			targets.push({
				nodeId: targetNode.node_id,
				anchor: targetPlacement.anchor,
				positionParamNodeId: positionParamNode?.data.kind === 'parameter' ? positionParamNode.node_id : null,
				positionParamBehaviour:
					positionParamNode?.data.kind === 'parameter'
						? positionParamNode.data.param.event_behaviour
						: null,
				widthParamNodeId: widthParamNode?.data.kind === 'parameter' ? widthParamNode.node_id : null,
				widthParamBehaviour:
					widthParamNode?.data.kind === 'parameter'
						? widthParamNode.data.param.event_behaviour
						: null,
				heightParamNodeId: heightParamNode?.data.kind === 'parameter' ? heightParamNode.node_id : null,
				heightParamBehaviour:
					heightParamNode?.data.kind === 'parameter'
						? heightParamNode.data.param.event_behaviour
						: null,
				startPreview: {
					position: {
						x: targetPlacement.position.x,
						y: targetPlacement.position.y
					},
					size: {
						width: { ...targetPlacement.size.width },
						height: { ...targetPlacement.size.height }
					}
				},
				startRect: freeLayoutRectFromPlacement(targetPlacement, interaction)
			});
		}
		return targets;
	};

	const buildSelectionRect = (targets: FreeLayoutTarget[]): FreeLayoutRect | null => {
		if (targets.length === 0) {
			return null;
		}
		let left = Number.POSITIVE_INFINITY;
		let top = Number.POSITIVE_INFINITY;
		let right = Number.NEGATIVE_INFINITY;
		let bottom = Number.NEGATIVE_INFINITY;
		for (const target of targets) {
			left = Math.min(left, target.startRect.left);
			top = Math.min(top, target.startRect.top);
			right = Math.max(right, target.startRect.left + target.startRect.width);
			bottom = Math.max(bottom, target.startRect.top + target.startRect.height);
		}
		return {
			left,
			top,
			width: Math.max(0, right - left),
			height: Math.max(0, bottom - top)
		};
	};

	const buildFreeLayoutMovePreview = (
		interaction: FreeLayoutInteraction,
		deltaXPx: number,
		deltaYPx: number,
		snapPx: number
	): FreeLayoutPreviewSet => {
		const primaryTarget =
			interaction.targets.find((target) => target.nodeId === interaction.primaryNodeId) ??
			interaction.targets[0];
		let appliedDeltaX = deltaXPx;
		let appliedDeltaY = deltaYPx;
		if (snapPx > 0) {
			appliedDeltaX =
				snapToGridPx(primaryTarget.startRect.left + appliedDeltaX, snapPx) -
				primaryTarget.startRect.left;
			appliedDeltaY =
				snapToGridPx(primaryTarget.startRect.top + appliedDeltaY, snapPx) -
				primaryTarget.startRect.top;
		}
		return {
			primaryNodeId: interaction.primaryNodeId,
			previews: interaction.targets.map((target) => ({
				target,
				preview: freeLayoutPreviewFromRect(
					{
						...target.startRect,
						left: target.startRect.left + appliedDeltaX,
						top: target.startRect.top + appliedDeltaY
					},
					target.anchor,
					interaction,
					target.startPreview.position,
					target.startPreview.size
				)
			}))
		};
	};

	const buildFreeLayoutResizePreview = (
		interaction: FreeLayoutInteraction,
		deltaXPx: number,
		deltaYPx: number,
		snapPx: number
	): FreeLayoutPreviewSet | null => {
		const resizeEdges = interaction.resizeEdges;
		if (!resizeEdges) {
			return null;
		}
		const minWidthPx = minFreeWidgetWidthRem * interaction.rootRemPx;
		const minHeightPx = minFreeWidgetHeightRem * interaction.rootRemPx;
		const startRect = interaction.selectionRect;
		let requiredScaleX = 0;
		let requiredScaleY = 0;
		for (const target of interaction.targets) {
			requiredScaleX = Math.max(
				requiredScaleX,
				target.startRect.width > 1e-6 ? minWidthPx / target.startRect.width : 1
			);
			requiredScaleY = Math.max(
				requiredScaleY,
				target.startRect.height > 1e-6 ? minHeightPx / target.startRect.height : 1
			);
		}
		const groupMinWidthPx = Math.max(minWidthPx, startRect.width * Math.max(requiredScaleX, 1e-6));
		const groupMinHeightPx = Math.max(
			minHeightPx,
			startRect.height * Math.max(requiredScaleY, 1e-6)
		);
		let nextLeftPx = startRect.left;
		let nextTopPx = startRect.top;
		let nextWidthPx = startRect.width;
		let nextHeightPx = startRect.height;

		if (resizeEdges.left) {
			const appliedDeltaX = Math.min(deltaXPx, nextWidthPx - groupMinWidthPx);
			nextLeftPx += appliedDeltaX;
			nextWidthPx -= appliedDeltaX;
		}
		if (resizeEdges.right) {
			nextWidthPx = Math.max(groupMinWidthPx, nextWidthPx + deltaXPx);
		}
		if (resizeEdges.top) {
			const appliedDeltaY = Math.min(deltaYPx, nextHeightPx - groupMinHeightPx);
			nextTopPx += appliedDeltaY;
			nextHeightPx -= appliedDeltaY;
		}
		if (resizeEdges.bottom) {
			nextHeightPx = Math.max(groupMinHeightPx, nextHeightPx + deltaYPx);
		}
		if (snapPx > 0) {
			nextLeftPx = snapToGridPx(nextLeftPx, snapPx);
			nextTopPx = snapToGridPx(nextTopPx, snapPx);
			nextWidthPx = Math.max(groupMinWidthPx, snapToGridPx(nextWidthPx, snapPx));
			nextHeightPx = Math.max(groupMinHeightPx, snapToGridPx(nextHeightPx, snapPx));
		}
		const scaleX = startRect.width > 1e-6 ? nextWidthPx / startRect.width : 1;
		const scaleY = startRect.height > 1e-6 ? nextHeightPx / startRect.height : 1;
		return {
			primaryNodeId: interaction.primaryNodeId,
			previews: interaction.targets.map((target) => {
				const nextRect: FreeLayoutRect = {
					left: nextLeftPx + (target.startRect.left - startRect.left) * scaleX,
					top: nextTopPx + (target.startRect.top - startRect.top) * scaleY,
					width: Math.max(minWidthPx, target.startRect.width * scaleX),
					height: Math.max(minHeightPx, target.startRect.height * scaleY)
				};
				return {
					target,
					preview: freeLayoutPreviewFromRect(
						nextRect,
						target.anchor,
						interaction,
						target.startPreview.position,
						target.startPreview.size
					)
				};
			})
		};
	};

	const sanitizePersistedPageView = (
		candidate: DashboardPersistedPageView | null | undefined
	): DashboardPersistedPageView => {
		const panX = Number(candidate?.panX);
		const panY = Number(candidate?.panY);
		const zoom = Number(candidate?.zoom);
		return {
			panX: Number.isFinite(panX) ? panX : 0,
			panY: Number.isFinite(panY) ? panY : 0,
			zoom: clampPageZoom(Number.isFinite(zoom) && zoom > 0 ? zoom : 1)
		};
	};

	const samePersistedPageView = (
		left: DashboardPersistedPageView | null | undefined,
		right: DashboardPersistedPageView | null | undefined
	): boolean => {
		return (
			(left?.panX ?? 0) === (right?.panX ?? 0) &&
			(left?.panY ?? 0) === (right?.panY ?? 0) &&
			(left?.zoom ?? 1) === (right?.zoom ?? 1)
		);
	};

	const currentPersistedPageView = (): DashboardPersistedPageView => ({
		panX: pageView.panX,
		panY: pageView.panY,
		zoom: clampPageZoom(pageView.zoom)
	});

	const homePageView = (): void => {
		pageView = {
			pointerId: null,
			lastClient: null,
			panX: 0,
			panY: 0,
			zoom: 1
		};
	};

	$effect(() => {
		if (layoutKind !== 'tabs') {
			return;
		}
		if (childWidgets.length === 0) {
			activeTabNodeId = null;
			return;
		}
		if (
			activeTabNodeId !== null &&
			childWidgets.some((candidate) => candidate.node_id === activeTabNodeId)
		) {
			return;
		}
		activeTabNodeId = childWidgets[0]?.node_id ?? null;
	});

	$effect(() => {
		if (layoutKind !== 'accordion') {
			return;
		}
		const availableIds = new Set(childWidgets.map((candidate) => candidate.node_id));
		let nextOpenAccordionNodeIds = openAccordionNodeIds.filter((nodeId) =>
			availableIds.has(nodeId)
		);
		if (nextOpenAccordionNodeIds.length === 0 && childWidgets.length > 0) {
			nextOpenAccordionNodeIds = [childWidgets[0].node_id];
		}
		if (sameNodeIdList(openAccordionNodeIds, nextOpenAccordionNodeIds)) {
			return;
		}
		openAccordionNodeIds = nextOpenAccordionNodeIds;
	});

	$effect(() => {
		void liveNode.node_id;
		pendingPersistedPageView = null;
		appliedPersistedPageView = null;
	});

	$effect(() => {
		if (!isPage) {
			return;
		}
		const nextPageView = sanitizePersistedPageView(persistedPageView);
		if (appliedPersistedPageView && samePersistedPageView(nextPageView, appliedPersistedPageView)) {
			return;
		}
		appliedPersistedPageView = nextPageView;
		if (pendingPersistedPageView && samePersistedPageView(nextPageView, pendingPersistedPageView)) {
			pendingPersistedPageView = null;
			return;
		}
		if (pageView.pointerId !== null || pendingPersistedPageView) {
			return;
		}
		pageView = {
			pointerId: null,
			lastClient: null,
			panX: nextPageView.panX,
			panY: nextPageView.panY,
			zoom: nextPageView.zoom
		};
	});

	$effect(() => {
		if (!isPage || !onPersistedPageViewChange || pageView.pointerId !== null) {
			return;
		}
		const nextPageView = currentPersistedPageView();
		if (samePersistedPageView(nextPageView, sanitizePersistedPageView(persistedPageView))) {
			pendingPersistedPageView = null;
			return;
		}
		if (pendingPersistedPageView && samePersistedPageView(nextPageView, pendingPersistedPageView)) {
			return;
		}
		pendingPersistedPageView = nextPageView;
		onPersistedPageViewChange(liveNode.node_id, nextPageView);
	});

	$effect(() => {
		if (!pageViewportElement || typeof ResizeObserver === 'undefined') {
			return;
		}
		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (!entry) {
				return;
			}
			const nextWidth = Math.max(entry.contentRect.width, 1);
			const nextHeight = Math.max(entry.contentRect.height, 1);
			if (pageViewportResizeFrame !== null && typeof window !== 'undefined') {
				window.cancelAnimationFrame(pageViewportResizeFrame);
			}
			pageViewportResizeFrame =
				typeof window === 'undefined'
					? null
					: window.requestAnimationFrame(() => {
						pageViewportResizeFrame = null;
						if (
							pageViewportSize.width === nextWidth &&
							pageViewportSize.height === nextHeight
						) {
							return;
						}
						pageViewportSize = {
							width: nextWidth,
							height: nextHeight
						};
					});
		});
		observer.observe(pageViewportElement);
		return () => {
			if (pageViewportResizeFrame !== null && typeof window !== 'undefined') {
				window.cancelAnimationFrame(pageViewportResizeFrame);
				pageViewportResizeFrame = null;
			}
			observer.disconnect();
		};
	});

	const selectWidgetNode = (selectionMode: SelectionMode = 'REPLACE'): void => {
		if (!editMode) {
			return;
		}
		session?.selectNode(liveNode.node_id, selectionMode);
	};

	const selectWidgetNodeFromKeyboard = (event: KeyboardEvent): void => {
		if (event.key !== 'Enter' && event.key !== ' ') {
			return;
		}
		event.preventDefault();
		selectWidgetNode(selectionModeFromEvent(event));
	};

	const resolveDraggedNode = (payload: DashboardDragPayload | null): UiNodeDto | null => {
		if (!payload) {
			return null;
		}
		return getGraph()?.nodesById.get(payload.nodeId) ?? null;
	};

	const resolveDraggedParameterNode = (payload: DashboardDragPayload | null): UiNodeDto | null => {
		const candidate = resolveDraggedNode(payload);
		if (!candidate || candidate.data.kind !== 'parameter') {
			return null;
		}
		return candidate;
	};

	const canCreateFromDrop = (payload: DashboardDragPayload | null): boolean => {
		if (!editMode) {
			return false;
		}
		if (!isLayoutSurface) {
			return false;
		}
		if (!payload) {
			return false;
		}
		if (payload.kind === 'node') {
			return resolveDraggedNode(payload) !== null;
		}
		return resolveDraggedParameterNode(payload) !== null;
	};

	const canBindNodeWidget = (payload: DashboardDragPayload | null): boolean => {
		return editMode && resolveDraggedNode(payload) !== null;
	};

	const canBindGenericWidget = (payload: DashboardDragPayload | null): boolean => {
		return editMode && resolveDraggedParameterNode(payload) !== null;
	};

	const buildSurfaceDropPreview = (
		event: DragEvent,
		payload: DashboardDragPayload | null
	): SurfaceDropPreview | null => {
		if (layoutKind !== 'free' || !payload) {
			return null;
		}
		const targetNode =
			payload.kind === 'parameter'
				? resolveDraggedParameterNode(payload)
				: resolveDraggedNode(payload);
		if (!targetNode) {
			return null;
		}
		const layoutElement = getDirectDashboardLayoutElement(event.currentTarget);
		if (!layoutElement) {
			return null;
		}
		const rootRemPx = getRootRemPixels();
		const metrics = getElementSurfaceMetrics(layoutElement, rootRemPx);
		const rect = layoutElement.getBoundingClientRect();
		const centerPx = {
			x: (event.clientX - rect.left) / Math.max(metrics.scaleX, 1e-6),
			y: (event.clientY - rect.top) / Math.max(metrics.scaleY, 1e-6)
		};
		const context = {
			rootRemPx,
			surfaceWidthPx: metrics.width,
			surfaceHeightPx: metrics.height,
			viewportWidthPx: getViewportWidthPx(),
			viewportHeightPx: getViewportHeightPx()
		};
		const snapPx = surfaceSnapGrid.enabled ? surfaceSnapGrid.step * rootRemPx : 0;
		const placement =
			payload.kind === 'parameter'
				? getDashboardGenericWidgetCreationDefaults(targetNode, context, { centerPx, snapPx })
						.placement
				: getDashboardNodeWidgetCreationDefaults(targetNode, context, { centerPx, snapPx });
		return {
			label: targetNode.meta.label,
			targetKind: payload.kind,
			placement
		};
	};

	const handleSurfaceDragEnter = (event: DragEvent): void => {
		const payload = readDashboardDragPayload(event);
		if (!canCreateFromDrop(payload)) {
			surfaceDropPreview = null;
			return;
		}
		event.preventDefault();
		surfaceDragDepth += 1;
		surfaceDropPreview = buildSurfaceDropPreview(event, payload);
	};

	const handleSurfaceDragOver = (event: DragEvent): void => {
		const payload = readDashboardDragPayload(event);
		if (!canCreateFromDrop(payload)) {
			surfaceDropPreview = null;
			return;
		}
		event.preventDefault();
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'copy';
		}
		surfaceDropPreview = buildSurfaceDropPreview(event, payload);
	};

	const handleSurfaceDragLeave = (): void => {
		const nextDepth = Math.max(0, surfaceDragDepth - 1);
		surfaceDragDepth = nextDepth;
		if (nextDepth === 0) {
			surfaceDropPreview = null;
		}
	};

	const handleSurfaceDrop = async (event: DragEvent): Promise<void> => {
		const payload = readDashboardDragPayload(event);
		const dropPreview = buildSurfaceDropPreview(event, payload);
		surfaceDragDepth = 0;
		surfaceDropPreview = null;
		if (!canCreateFromDrop(payload)) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		const targetNode = resolveDraggedNode(payload);
		if (!targetNode) {
			return;
		}
		if (payload?.kind === 'parameter') {
			await createDashboardGenericWidget(getGraph, liveNode.node_id, targetNode, {
				placement: dropPreview?.placement
			});
			return;
		}
		await createDashboardNodeWidget(getGraph, liveNode.node_id, targetNode, {
			placement: dropPreview?.placement
		});
	};

	const handleBindingDragEnter = (
		event: DragEvent,
		predicate: (payload: DashboardDragPayload | null) => boolean
	): void => {
		const payload = readDashboardDragPayload(event);
		if (!predicate(payload)) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		bindingDragDepth += 1;
	};

	const handleBindingDragOver = (
		event: DragEvent,
		predicate: (payload: DashboardDragPayload | null) => boolean
	): void => {
		const payload = readDashboardDragPayload(event);
		if (!predicate(payload)) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'copy';
		}
	};

	const handleBindingDragLeave = (): void => {
		bindingDragDepth = Math.max(0, bindingDragDepth - 1);
	};

	const handleNodeWidgetBindingDrop = async (event: DragEvent): Promise<void> => {
		const payload = readDashboardDragPayload(event);
		bindingDragDepth = 0;
		if (!canBindNodeWidget(payload)) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		const targetNode = resolveDraggedNode(payload);
		if (!targetNode) {
			return;
		}
		await bindDashboardNodeWidgetTarget(getGraph, liveNode.node_id, targetNode);
	};

	const handleGenericWidgetBindingDrop = async (event: DragEvent): Promise<void> => {
		const payload = readDashboardDragPayload(event);
		bindingDragDepth = 0;
		if (!canBindGenericWidget(payload)) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		const targetNode = resolveDraggedParameterNode(payload);
		if (!targetNode) {
			return;
		}
		await bindDashboardGenericWidgetTarget(getGraph, liveNode.node_id, targetNode);
	};

	const sendCssParamValue = async (
		paramNodeId: NodeId | null,
		behaviour: ParamEventBehaviour | null,
		value: CssValueData
	): Promise<void> => {
		if (paramNodeId === null || behaviour === null) {
			return;
		}
		await sendSetParamIntent(
			paramNodeId,
			{ kind: 'css_value', value: value.value, unit: value.unit },
			behaviour
		);
	};

	const withStoppedPropagation = (event: Event): void => {
		event.stopPropagation();
	};

	const finishFreeLayoutEditSession = async (): Promise<void> => {
		const sessionToEnd = freeLayoutEditSession;
		freeLayoutEditSession = null;
		await sessionToEnd?.end();
	};

	const sendFreeLayoutPreview = async (previewSet: FreeLayoutPreviewSet): Promise<void> => {
		const operations: Promise<unknown>[] = [];
		for (const entry of previewSet.previews) {
			const compareTo =
				lastCommittedFreeLayoutPreview?.previews.find(
					(candidate) => candidate.target.nodeId === entry.target.nodeId
				)?.preview ?? entry.target.startPreview;
			if (!samePosition(entry.preview.position, compareTo.position)) {
				if (
					entry.target.positionParamNodeId !== null &&
					entry.target.positionParamBehaviour !== null
				) {
					operations.push(
						sendSetParamIntent(
							entry.target.positionParamNodeId,
							{
								kind: 'vec2',
								value: [entry.preview.position.x, entry.preview.position.y]
							},
							entry.target.positionParamBehaviour
						)
					);
				}
			}
			if (!sameCssValue(entry.preview.size.width, compareTo.size.width)) {
				operations.push(
					sendCssParamValue(
						entry.target.widthParamNodeId,
						entry.target.widthParamBehaviour,
						entry.preview.size.width
					)
				);
			}
			if (!sameCssValue(entry.preview.size.height, compareTo.size.height)) {
				operations.push(
					sendCssParamValue(
						entry.target.heightParamNodeId,
						entry.target.heightParamBehaviour,
						entry.preview.size.height
					)
				);
			}
		}
		if (operations.length === 0) {
			lastCommittedFreeLayoutPreview = cloneFreeLayoutPreviewSet(previewSet);
			return;
		}
		await Promise.all(operations);
		lastCommittedFreeLayoutPreview = cloneFreeLayoutPreviewSet(previewSet);
	};

	const flushFreeLayoutCommitQueue = async (): Promise<void> => {
		if (freeLayoutCommitInFlight) {
			return;
		}
		freeLayoutCommitInFlight = true;
		try {
			while (pendingFreeLayoutCommit) {
				const nextPreview = cloneFreeLayoutPreviewSet(pendingFreeLayoutCommit);
				pendingFreeLayoutCommit = null;
				await sendFreeLayoutPreview(nextPreview);
			}
		} finally {
			freeLayoutCommitInFlight = false;
		}
	};

	const scheduleFreeLayoutCommit = (preview: FreeLayoutPreviewSet): void => {
		pendingFreeLayoutCommit = cloneFreeLayoutPreviewSet(preview);
		if (typeof window === 'undefined') {
			void flushFreeLayoutCommitQueue();
			return;
		}
		if (freeLayoutCommitFrame !== null) {
			return;
		}
		freeLayoutCommitFrame = window.requestAnimationFrame(() => {
			freeLayoutCommitFrame = null;
			void flushFreeLayoutCommitQueue();
		});
	};

	const finalizeFreeLayoutInteraction = async (
		preview: FreeLayoutPreviewSet | null
	): Promise<void> => {
		if (preview) {
			scheduleFreeLayoutCommit(preview);
			await flushFreeLayoutCommitQueue();
		}
		await finishFreeLayoutEditSession();
	};

	const beginFreeLayoutMove = (event: PointerEvent, transformNodes: UiNodeDto[]): void => {
		if (!editMode || !supportsFreePlacement) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		selectWidgetNode('REPLACE');
		freeLayoutEditSession = createUiEditSession('Move dashboard widget', 'dashboard-free-layout');
		void freeLayoutEditSession.begin();
		const rootRemPx = getRootRemPixels();
		const surfaceMetrics = getClosestSurfaceMetrics(event.currentTarget, rootRemPx);
		const interactionMetrics = {
			rootRemPx,
			surfaceWidthPx: surfaceMetrics.width,
			surfaceHeightPx: surfaceMetrics.height,
			viewportWidthPx: getViewportWidthPx(),
			viewportHeightPx: getViewportHeightPx()
		};
		const targets = buildFreeLayoutTargets(transformNodes, interactionMetrics);
		const selectionRect = buildSelectionRect(targets);
		if (targets.length === 0 || !selectionRect) {
			return;
		}
		lastCommittedFreeLayoutPreview = buildPreviewSetFromTargets(liveNode.node_id, targets);
		pendingFreeLayoutCommit = null;
		freeLayoutInteraction = {
			pointerId: event.pointerId,
			mode: 'move',
			resizeEdges: null,
			primaryNodeId: liveNode.node_id,
			selectionRect,
			targets,
			startClient: [event.clientX, event.clientY],
			rootRemPx,
			surfaceWidthPx: surfaceMetrics.width,
			surfaceHeightPx: surfaceMetrics.height,
			surfaceScaleX: surfaceMetrics.scaleX,
			surfaceScaleY: surfaceMetrics.scaleY,
			viewportWidthPx: getViewportWidthPx(),
			viewportHeightPx: getViewportHeightPx()
		};
		freeLayoutPreview = buildPreviewSetFromTargets(liveNode.node_id, targets);
	};

	const beginFreeLayoutResize = (
		event: PointerEvent,
		resizeEdges: FreeLayoutResizeEdges,
		transformNodes: UiNodeDto[]
	): void => {
		if (!editMode || !supportsFreePlacement) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		selectWidgetNode('REPLACE');
		freeLayoutEditSession = createUiEditSession('Resize dashboard widget', 'dashboard-free-layout');
		void freeLayoutEditSession.begin();
		const rootRemPx = getRootRemPixels();
		const surfaceMetrics = getClosestSurfaceMetrics(event.currentTarget, rootRemPx);
		const interactionMetrics = {
			rootRemPx,
			surfaceWidthPx: surfaceMetrics.width,
			surfaceHeightPx: surfaceMetrics.height,
			viewportWidthPx: getViewportWidthPx(),
			viewportHeightPx: getViewportHeightPx()
		};
		const targets = buildFreeLayoutTargets(transformNodes, interactionMetrics);
		const selectionRect = buildSelectionRect(targets);
		if (targets.length === 0 || !selectionRect) {
			return;
		}
		lastCommittedFreeLayoutPreview = buildPreviewSetFromTargets(liveNode.node_id, targets);
		pendingFreeLayoutCommit = null;
		freeLayoutInteraction = {
			pointerId: event.pointerId,
			mode: 'resize',
			resizeEdges,
			primaryNodeId: liveNode.node_id,
			selectionRect,
			targets,
			startClient: [event.clientX, event.clientY],
			rootRemPx,
			surfaceWidthPx: surfaceMetrics.width,
			surfaceHeightPx: surfaceMetrics.height,
			surfaceScaleX: surfaceMetrics.scaleX,
			surfaceScaleY: surfaceMetrics.scaleY,
			viewportWidthPx: getViewportWidthPx(),
			viewportHeightPx: getViewportHeightPx()
		};
		freeLayoutPreview = buildPreviewSetFromTargets(liveNode.node_id, targets);
	};

	const handleWidgetPointerDown = (event: PointerEvent): void => {
		if (!editMode || event.button !== 0) {
			return;
		}
		const selectionMode = selectionModeFromEvent(event);
		if (supportsFreePlacement) {
			if (selectionMode !== 'REPLACE') {
				event.stopPropagation();
				selectWidgetNode(selectionMode);
				return;
			}
			if (!isSelected) {
				selectWidgetNode('REPLACE');
			}
			beginFreeLayoutMove(event, resolveTransformNodes());
			return;
		}
		event.stopPropagation();
		selectWidgetNode(selectionMode);
	};

	const handleSurfacePointerDown = (event: PointerEvent): void => {
		if (!editMode || !isLayoutSurface || event.button !== 0) {
			return;
		}
		if (freeLayoutInteraction || marqueeSelection) {
			return;
		}
		if (!(event.currentTarget instanceof HTMLElement)) {
			return;
		}
		const ownerWidgetShell = event.currentTarget.closest('.dashboard-widget-shell');
		const childWidgetShell =
			event.target instanceof Element ? event.target.closest('.dashboard-widget-shell') : null;
		if (
			(childWidgetShell !== null && childWidgetShell !== ownerWidgetShell) ||
			isInteractiveSurfaceTarget(event.target)
		) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		const selection: MarqueeSelectionState = {
			pointerId: event.pointerId,
			surfaceNodeId: liveNode.node_id,
			surfaceElement: event.currentTarget,
			startClient: [event.clientX, event.clientY],
			currentClient: [event.clientX, event.clientY],
			baseSelection: [...(session?.selectedNodesIds ?? [])],
			selectionMode: selectionModeFromEvent(event)
		};
		marqueeSelection = selection;
		applyMarqueeSelection(selection);
	};

	const handlePageScenePointerDown = (event: PointerEvent): void => {
		pageViewportElement?.focus();
		if (!isPage || !editMode || event.button !== 0) {
			return;
		}
		if (freeLayoutInteraction || marqueeSelection) {
			return;
		}
		if (!(event.currentTarget instanceof HTMLElement)) {
			return;
		}
		const sceneElement = event.currentTarget.parentElement;
		if (!(sceneElement instanceof HTMLElement)) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		const selection: MarqueeSelectionState = {
			pointerId: event.pointerId,
			surfaceNodeId: liveNode.node_id,
			surfaceElement: sceneElement,
			startClient: [event.clientX, event.clientY],
			currentClient: [event.clientX, event.clientY],
			baseSelection: [...(session?.selectedNodesIds ?? [])],
			selectionMode: selectionModeFromEvent(event)
		};
		marqueeSelection = selection;
		applyMarqueeSelection(selection);
	};

	$effect(() => {
		if (!freeLayoutInteraction) {
			return;
		}

		const handlePointerMove = (event: PointerEvent): void => {
			if (!freeLayoutInteraction || event.pointerId !== freeLayoutInteraction.pointerId) {
				return;
			}
			event.preventDefault();
			const deltaXPx =
				(event.clientX - freeLayoutInteraction.startClient[0]) /
				Math.max(freeLayoutInteraction.surfaceScaleX, 1e-6);
			const deltaYPx =
				(event.clientY - freeLayoutInteraction.startClient[1]) /
				Math.max(freeLayoutInteraction.surfaceScaleY, 1e-6);
			const minWidthPx = minFreeWidgetWidthRem * freeLayoutInteraction.rootRemPx;
			const minHeightPx = minFreeWidgetHeightRem * freeLayoutInteraction.rootRemPx;
			const snapPx = parentSnapGrid.enabled
				? parentSnapGrid.step * freeLayoutInteraction.rootRemPx
				: 0;
			if (freeLayoutInteraction.mode === 'move') {
				freeLayoutPreview = buildFreeLayoutMovePreview(
					freeLayoutInteraction,
					deltaXPx,
					deltaYPx,
					snapPx
				);
				scheduleFreeLayoutCommit(freeLayoutPreview);
				return;
			}
			const nextPreview = buildFreeLayoutResizePreview(
				freeLayoutInteraction,
				deltaXPx,
				deltaYPx,
				snapPx
			);
			if (!nextPreview) {
				return;
			}
			freeLayoutPreview = nextPreview;
			scheduleFreeLayoutCommit(nextPreview);
		};

		const finishInteraction = (event: PointerEvent): void => {
			if (!freeLayoutInteraction || event.pointerId !== freeLayoutInteraction.pointerId) {
				return;
			}
			const preview = freeLayoutPreview;
			freeLayoutInteraction = null;
			freeLayoutPreview = null;
			void finalizeFreeLayoutInteraction(preview);
		};

		window.addEventListener('pointermove', handlePointerMove);
		window.addEventListener('pointerup', finishInteraction);
		window.addEventListener('pointercancel', finishInteraction);

		const previousCursor = document.body.style.cursor;
		const previousUserSelect = document.body.style.userSelect;
		document.body.style.cursor =
			freeLayoutInteraction.mode === 'move'
				? 'grabbing'
				: freeLayoutInteraction.resizeEdges?.left && freeLayoutInteraction.resizeEdges?.top
					? 'nwse-resize'
					: freeLayoutInteraction.resizeEdges?.right && freeLayoutInteraction.resizeEdges?.bottom
						? 'nwse-resize'
						: freeLayoutInteraction.resizeEdges?.right && freeLayoutInteraction.resizeEdges?.top
							? 'nesw-resize'
							: freeLayoutInteraction.resizeEdges?.left && freeLayoutInteraction.resizeEdges?.bottom
								? 'nesw-resize'
								: freeLayoutInteraction.resizeEdges?.left ||
									  freeLayoutInteraction.resizeEdges?.right
									? 'ew-resize'
									: 'ns-resize';
		document.body.style.userSelect = 'none';

		return () => {
			window.removeEventListener('pointermove', handlePointerMove);
			window.removeEventListener('pointerup', finishInteraction);
			window.removeEventListener('pointercancel', finishInteraction);
			document.body.style.cursor = previousCursor;
			document.body.style.userSelect = previousUserSelect;
		};
	});

	$effect(() => {
		if (!marqueeSelection) {
			return;
		}

		const handlePointerMove = (event: PointerEvent): void => {
			if (!marqueeSelection || event.pointerId !== marqueeSelection.pointerId) {
				return;
			}
			event.preventDefault();
			const nextSelection = {
				...marqueeSelection,
				currentClient: [event.clientX, event.clientY] as [number, number]
			};
			marqueeSelection = nextSelection;
			applyMarqueeSelection(nextSelection);
		};

		const finishSelection = (event: PointerEvent): void => {
			if (!marqueeSelection || event.pointerId !== marqueeSelection.pointerId) {
				return;
			}
			const completedSelection = {
				...marqueeSelection,
				currentClient: [event.clientX, event.clientY] as [number, number]
			};
			applyMarqueeSelection(completedSelection);
			marqueeSelection = null;
		};

		window.addEventListener('pointermove', handlePointerMove);
		window.addEventListener('pointerup', finishSelection);
		window.addEventListener('pointercancel', finishSelection);

		const previousCursor = document.body.style.cursor;
		const previousUserSelect = document.body.style.userSelect;
		document.body.style.cursor = 'crosshair';
		document.body.style.userSelect = 'none';

		return () => {
			window.removeEventListener('pointermove', handlePointerMove);
			window.removeEventListener('pointerup', finishSelection);
			window.removeEventListener('pointercancel', finishSelection);
			document.body.style.cursor = previousCursor;
			document.body.style.userSelect = previousUserSelect;
		};
	});

	onDestroy(() => {
		if (typeof window !== 'undefined' && freeLayoutCommitFrame !== null) {
			window.cancelAnimationFrame(freeLayoutCommitFrame);
		}
		if (typeof window !== 'undefined' && pageViewportResizeFrame !== null) {
			window.cancelAnimationFrame(pageViewportResizeFrame);
		}
		void finishFreeLayoutEditSession();
	});

	$effect(() => {
		if (pageView.pointerId === null) {
			return;
		}

		const handlePointerMove = (event: PointerEvent): void => {
			if (pageView.pointerId !== event.pointerId || !pageView.lastClient) {
				return;
			}
			event.preventDefault();
			pageView = {
				...pageView,
				lastClient: [event.clientX, event.clientY],
				panX: pageView.panX + (event.clientX - pageView.lastClient[0]),
				panY: pageView.panY + (event.clientY - pageView.lastClient[1])
			};
		};

		const finishPan = (event: PointerEvent): void => {
			if (pageView.pointerId !== event.pointerId) {
				return;
			}
			pageView = {
				...pageView,
				pointerId: null,
				lastClient: null
			};
		};

		window.addEventListener('pointermove', handlePointerMove);
		window.addEventListener('pointerup', finishPan);
		window.addEventListener('pointercancel', finishPan);

		return () => {
			window.removeEventListener('pointermove', handlePointerMove);
			window.removeEventListener('pointerup', finishPan);
			window.removeEventListener('pointercancel', finishPan);
		};
	});

	let supportsFreePlacement = $derived(editMode && parentLayoutKind === 'free');
	let supportsGridPlacement = $derived(editMode && parentLayoutKind === 'grid');
	let supportsStackSizing = $derived(
		editMode && (parentLayoutKind === 'horizontal' || parentLayoutKind === 'vertical')
	);
	let supportsOrdering = $derived(
		editMode &&
			(parentLayoutKind === 'grid' ||
				parentLayoutKind === 'horizontal' ||
				parentLayoutKind === 'vertical')
	);
	let pageSize = $derived(getDashboardPageSize(graph, liveNode));
	let parentSnapGrid = $derived(getDashboardSnapGrid(graph, parentNode));
	let surfaceSnapGrid = $derived(getDashboardSnapGrid(graph, liveNode));
	let snapGridVisible = $derived(editMode && surfaceSnapGrid.enabled && layoutKind === 'free');
	let currentNodeFreeLayoutPreview = $derived.by(() =>
		resolveFreeLayoutPreview(freeLayoutPreview, liveNode.node_id)
	);
	let marqueeStyle = $derived.by(() => {
		if (!marqueeSelection) {
			return '';
		}
		const rect = normalizeClientRect(marqueeSelection.startClient, marqueeSelection.currentClient);
		return `left: ${rect.left}px; top: ${rect.top}px; inline-size: ${rect.width}px; block-size: ${rect.height}px;`;
	});
	let widgetShellStyle = $derived.by(() => {
		if (!editMode || !supportsFreePlacement || !currentNodeFreeLayoutPreview) {
			return '';
		}
		const context = freeLayoutInteraction ?? {
			rootRemPx: getRootRemPixels(),
			surfaceWidthPx: getViewportWidthPx(),
			surfaceHeightPx: getViewportHeightPx(),
			surfaceScaleX: 1,
			surfaceScaleY: 1,
			viewportWidthPx: getViewportWidthPx(),
			viewportHeightPx: getViewportHeightPx()
		};
		const currentRect = freeLayoutRectFromPlacement(
			{ position: placement.position, size: placement.size, anchor: placement.anchor },
			context
		);
		const previewRect = freeLayoutRectFromPlacement(
			{
				position: currentNodeFreeLayoutPreview.position,
				size: currentNodeFreeLayoutPreview.size,
				anchor: placement.anchor
			},
			context
		);
		return `transform: translate(${previewRect.left - currentRect.left}px, ${previewRect.top - currentRect.top}px); inline-size: ${previewRect.width}px; block-size: ${previewRect.height}px; z-index: 4;`;
	});

	const freeSurfaceHeightPx = $derived.by(() => {
		if (layoutKind !== 'free' || isPage) {
			return 20 * getRootRemPixels();
		}
		const rootRemPx = getRootRemPixels();
		const surfaceContext = {
			rootRemPx,
			surfaceWidthPx: getViewportWidthPx(),
			surfaceHeightPx: getViewportHeightPx(),
			viewportWidthPx: getViewportWidthPx(),
			viewportHeightPx: getViewportHeightPx()
		};
		let maxExtent = 18 * rootRemPx;
		for (const child of childWidgets) {
			const childPlacement = getDashboardPlacement(graph, child);
			const childRect = freeLayoutRectFromPlacement(
				childPlacement,
				surfaceContext as FreeLayoutInteraction
			);
			maxExtent = Math.max(
				maxExtent,
				childRect.top +
					childRect.height +
					cssValueToPx(gap.y, 'y', createCssUnitContext(surfaceContext, 'y')) +
					2 * rootRemPx
			);
		}
		return maxExtent;
	});

	const surfaceStyle = $derived.by((): string => {
		const snapStepPx = surfaceSnapGrid.enabled ? surfaceSnapGrid.step * getRootRemPixels() : 0;
		const gapStyle = `--dashboard-gap-x: ${formatCssValue(gap.x)}; --dashboard-gap-y: ${formatCssValue(gap.y)}; --dashboard-snap-grid-step: ${snapStepPx}px;`;
		if (layoutKind === 'free') {
			if (isPage) {
				return `${gapStyle} inline-size: 100%; block-size: 100%; min-block-size: 0;`;
			}
			return `${gapStyle} min-block-size: ${freeSurfaceHeightPx}px;`;
		}
		if (layoutKind === 'grid') {
			return `${gapStyle} --dashboard-grid-columns: ${gridColumns};`;
		}
		return gapStyle;
	});

	const pageViewportWidthPx = $derived(Math.max(pageViewportSize.width, 1));
	const pageViewportHeightPx = $derived(Math.max(pageViewportSize.height, 1));
	const pageEditBleedPx = $derived.by(() => {
		if (!editMode || !pageSize.enabled) {
			return 0;
		}
		const rootRemPx = getRootRemPixels();
		const viewportMinExtent = Math.min(pageViewportWidthPx, pageViewportHeightPx);
		return Math.max(minFreeWidgetWidthRem * rootRemPx, viewportMinExtent * 0.12);
	});
	const pageSceneStyle = $derived.by(() => `padding: ${pageEditBleedPx}px;`);
	const pageSizeContext = $derived.by(
		(): Pick<
			FreeLayoutInteraction,
			'rootRemPx' | 'surfaceWidthPx' | 'surfaceHeightPx' | 'viewportWidthPx' | 'viewportHeightPx'
		> => ({
			rootRemPx: getRootRemPixels(),
			surfaceWidthPx: pageViewportWidthPx,
			surfaceHeightPx: pageViewportHeightPx,
			viewportWidthPx: getViewportWidthPx(),
			viewportHeightPx: getViewportHeightPx()
		})
	);
	const pageLogicalWidthPx = $derived.by(() =>
		Math.max(1, cssValueToPx(pageSize.width, 'x', createCssUnitContext(pageSizeContext, 'x')))
	);
	const pageLogicalHeightPx = $derived.by(() =>
		Math.max(1, cssValueToPx(pageSize.height, 'y', createCssUnitContext(pageSizeContext, 'y')))
	);
	const pageFitScale = $derived.by(() => {
		if (!pageSize.enabled) {
			return 1;
		}
		const availableWidthPx = Math.max(1, pageViewportWidthPx - 2 * pageEditBleedPx);
		const availableHeightPx = Math.max(1, pageViewportHeightPx - 2 * pageEditBleedPx);
		return Math.min(availableWidthPx / pageLogicalWidthPx, availableHeightPx / pageLogicalHeightPx);
	});
	const pageFrameStyle = $derived.by(() => {
		const baseWidth = pageSize.enabled ? pageLogicalWidthPx * pageFitScale : pageViewportWidthPx;
		const baseHeight = pageSize.enabled ? pageLogicalHeightPx * pageFitScale : pageViewportHeightPx;
		return `inline-size: ${baseWidth}px; block-size: ${baseHeight}px; transform: translate(${pageView.panX}px, ${pageView.panY}px) scale(${pageView.zoom});`;
	});
	const pageBleedFrameStyle = $derived.by(() => {
		const baseWidth = pageSize.enabled ? pageLogicalWidthPx * pageFitScale : pageViewportWidthPx;
		const baseHeight = pageSize.enabled ? pageLogicalHeightPx * pageFitScale : pageViewportHeightPx;
		return `inline-size: ${baseWidth}px; block-size: ${baseHeight}px; transform: translate(${pageView.panX}px, ${pageView.panY}px) scale(${pageView.zoom}); z-index: 0;`;
	});

	const placementStyle = (
		childPlacement: DashboardPlacement | DashboardWidgetCreationPlacement
	): string => {
		if (layoutKind === 'free') {
			const width = `max(${formatCssValue(childPlacement.size.width)}, ${minFreeWidgetWidthRem}rem)`;
			const height = `max(${formatCssValue(childPlacement.size.height)}, ${minFreeWidgetHeightRem}rem)`;
			const anchorX = anchorXFromAnchor(childPlacement.anchor);
			const anchorY = anchorYFromAnchor(childPlacement.anchor);
			const left =
				anchorX === 'left'
					? `${childPlacement.position.x}px`
					: anchorX === 'center'
						? `calc(${anchorBaseExpression(anchorX)} + ${childPlacement.position.x}px - (${width} / 2))`
						: `calc(${anchorBaseExpression(anchorX)} + ${childPlacement.position.x}px - ${width})`;
			const top =
				anchorY === 'top'
					? `${childPlacement.position.y}px`
					: anchorY === 'center'
						? `calc(${anchorBaseExpression(anchorY)} + ${childPlacement.position.y}px - (${height} / 2))`
						: `calc(${anchorBaseExpression(anchorY)} + ${childPlacement.position.y}px - ${height})`;
			return `left: ${left}; top: ${top}; inline-size: ${width}; block-size: ${height};`;
		}
		if (layoutKind === 'grid') {
			return `grid-column: span ${childPlacement.columnSpan}; grid-row: span ${childPlacement.rowSpan}; min-block-size: max(${formatCssValue(childPlacement.size.height)}, 3.25rem);`;
		}
		const basis =
			layoutKind === 'horizontal' ? childPlacement.size.width : childPlacement.size.height;
		if (layoutKind === 'horizontal') {
			return `flex: 0 0 max(${formatCssValue(basis)}, 6.5rem); inline-size: max(${formatCssValue(childPlacement.size.width)}, 6.5rem); block-size: 100%; min-inline-size: 0; min-block-size: 0;`;
		}
		return `flex: 0 0 max(${formatCssValue(basis)}, 2.8rem); inline-size: 100%; block-size: max(${formatCssValue(childPlacement.size.height)}, 2.8rem); min-inline-size: 0; min-block-size: 0;`;
	};

	const displayedWidgetPlacement = $derived.by(() => ({
		...placement,
		position: currentNodeFreeLayoutPreview ? currentNodeFreeLayoutPreview.position : placement.position,
		size: currentNodeFreeLayoutPreview ? currentNodeFreeLayoutPreview.size : placement.size
	}));

	const anchorGuides = $derived.by((): AnchorGuide[] => {
		if (!editMode || !supportsFreePlacement || !isSelected) {
			return [];
		}
		const anchorX = anchorXFromAnchor(displayedWidgetPlacement.anchor);
		const anchorY = anchorYFromAnchor(displayedWidgetPlacement.anchor);
		const anchorInline = anchorX === 'left' ? '0%' : anchorX === 'center' ? '50%' : '100%';
		const anchorBlock = anchorY === 'top' ? '0%' : anchorY === 'center' ? '50%' : '100%';
		const guides: AnchorGuide[] = [];

		const pushHorizontalGuide = (direction: 'left' | 'right', lengthPx: number): void => {
			if (!(lengthPx > 0.5)) {
				return;
			}
			const start =
				direction === 'left'
					? `calc(${anchorInline} - ${lengthPx}px)`
					: anchorInline;
			guides.push({
				axis: 'horizontal',
				direction,
				style: `inset-inline-start: ${start}; inset-block-start: calc(${anchorBlock} - 0.04rem); inline-size: ${lengthPx}px;`
			});
		};

		const pushVerticalGuide = (direction: 'up' | 'down', lengthPx: number): void => {
			if (!(lengthPx > 0.5)) {
				return;
			}
			const start =
				direction === 'up'
					? `calc(${anchorBlock} - ${lengthPx}px)`
					: anchorBlock;
			guides.push({
				axis: 'vertical',
				direction,
				style: `inset-inline-start: calc(${anchorInline} - 0.04rem); inset-block-start: ${start}; block-size: ${lengthPx}px;`
			});
		};

		if (anchorX === 'left') {
			pushHorizontalGuide('left', Math.max(0, displayedWidgetPlacement.position.x));
		} else if (anchorX === 'right') {
			pushHorizontalGuide('right', Math.max(0, -displayedWidgetPlacement.position.x));
		} else if (displayedWidgetPlacement.position.x !== 0) {
			pushHorizontalGuide(
				displayedWidgetPlacement.position.x > 0 ? 'left' : 'right',
				Math.abs(displayedWidgetPlacement.position.x)
			);
		}

		if (anchorY === 'top') {
			pushVerticalGuide('up', Math.max(0, displayedWidgetPlacement.position.y));
		} else if (anchorY === 'bottom') {
			pushVerticalGuide('down', Math.max(0, -displayedWidgetPlacement.position.y));
		} else if (displayedWidgetPlacement.position.y !== 0) {
			pushVerticalGuide(
				displayedWidgetPlacement.position.y > 0 ? 'up' : 'down',
				Math.abs(displayedWidgetPlacement.position.y)
			);
		}

		return guides;
	});

	const slotStyle = (child: UiNodeDto): string =>
		placementStyle(getDashboardPlacement(graph, child));

	const widgetKind = $derived.by(() => {
		const widgetKindParam = getDirectParam(graph, liveNode, 'widget_kind');
		return widgetKindParam?.value.kind === 'enum' ? widgetKindParam.value.value : 'text';
	});
	let textParam = $derived(getDirectParam(graph, liveNode, 'text'));
	let placeholderParam = $derived(getDirectParam(graph, liveNode, 'placeholder'));
	let valueRangeParam = $derived(getDirectParam(graph, liveNode, 'value_range'));
	let stepParam = $derived(getDirectParam(graph, liveNode, 'step'));
	let multilineParam = $derived(getDirectParam(graph, liveNode, 'multiline'));
	let defaultCheckedParam = $derived(getDirectParam(graph, liveNode, 'default_checked'));
	let targetNodeParam = $derived(getDirectParam(graph, liveNode, 'target_node'));
	let targetParamParam = $derived(getDirectParam(graph, liveNode, 'target_param'));
	let displayModeParam = $derived(getDirectParam(graph, liveNode, 'display_mode'));
	let includeChildrenParam = $derived(getDirectParam(graph, liveNode, 'include_children'));

	let boundNode = $derived(resolveReferenceTarget(graph, targetNodeParam?.value ?? null));
	let boundParamNode = $derived(resolveReferenceTarget(graph, targetParamParam?.value ?? null));
	let boundParam = $derived(
		boundParamNode?.data.kind === 'parameter' ? boundParamNode.data.param : null
	);

	const textConfig = $derived(textParam?.value.kind === 'str' ? textParam.value.value : '');
	const placeholderConfig = $derived(
		placeholderParam?.value.kind === 'str' ? placeholderParam.value.value : ''
	);
	const valueRange = $derived(
		valueRangeParam?.value.kind === 'vec2' ? valueRangeParam.value.value : [0, 1]
	);
	const sliderStep = $derived(stepParam?.value.kind === 'float' ? stepParam.value.value : 0.01);
	const multiline = $derived(
		multilineParam?.value.kind === 'bool' ? multilineParam.value.value : false
	);
	const defaultChecked = $derived(
		defaultCheckedParam?.value.kind === 'bool' ? defaultCheckedParam.value.value : false
	);
	const requestedDisplayMode = $derived.by(() => {
		if (displayModeParam?.value.kind === 'enum' || displayModeParam?.value.kind === 'str') {
			return displayModeParam.value.value;
		}
		return 'auto';
	});
	const includeChildren = $derived(
		includeChildrenParam?.value.kind === 'bool' ? includeChildrenParam.value.value : true
	);
	const resolvedNodeWidgetDisplayMode = $derived.by(() =>
		boundNode ? resolveDashboardNodeWidgetDisplayMode(boundNode, requestedDisplayMode) : null
	);
	const NodeWidgetDisplayComponent = $derived(resolvedNodeWidgetDisplayMode?.component ?? null);
	const showsNodeWidgetEditor = $derived(
		resolvedNodeWidgetDisplayMode?.id === 'editor' && boundNode?.data.kind === 'parameter'
	);

	const genericDisplayValue = $derived.by(() => {
		if (widgetKind === 'text' && boundParam) {
			return formatParamValue(boundParam.value);
		}
		return textConfig;
	});

	const applyGenericParamValue = async (value: ParamValue): Promise<void> => {
		if (!boundParamNode || boundParamNode.data.kind !== 'parameter') {
			return;
		}
		await sendSetParamIntent(
			boundParamNode.node_id,
			value,
			boundParamNode.data.param.event_behaviour
		);
	};


	$effect(() => {
		const isWidget = isContainerWidget || isNodeWidget || isGenericWidget;
		if (!isWidget) {
			observedAnchorPlacementCache = null;
			return;
		}

		const currentPlacement: ObservedAnchorPlacement = {
			nodeId: liveNode.node_id,
			anchor: placement.anchor,
			position: { ...placement.position },
			size: { width: { ...placement.size.width }, height: { ...placement.size.height } }
		};

		if (!editMode || !supportsFreePlacement || freeLayoutInteraction) {
			observedAnchorPlacementCache = currentPlacement;
			return;
		}

		const previousPlacement = observedAnchorPlacementCache;
		observedAnchorPlacementCache = currentPlacement;

		if (
			!previousPlacement ||
			previousPlacement.nodeId !== currentPlacement.nodeId ||
			previousPlacement.anchor === currentPlacement.anchor
		) {
			return;
		}

		const rootRemPx = getRootRemPixels();
		const surfaceMetrics = widgetShellElement
			? getClosestSurfaceMetrics(widgetShellElement, rootRemPx)
			: {
				width: getViewportWidthPx(),
				height: getViewportHeightPx(),
				scaleX: 1,
				scaleY: 1
			};
		const placementContext = {
			rootRemPx,
			surfaceWidthPx: surfaceMetrics.width,
			surfaceHeightPx: surfaceMetrics.height,
			viewportWidthPx: getViewportWidthPx(),
			viewportHeightPx: getViewportHeightPx()
		};
		const previousRect = freeLayoutRectFromPlacement(previousPlacement, placementContext);
		const nextPlacement = freeLayoutPreviewFromRect(
			previousRect,
			currentPlacement.anchor,
			placementContext,
			currentPlacement.position,
			currentPlacement.size
		);
		if (samePosition(nextPlacement.position, currentPlacement.position)) {
			return;
		}

		observedAnchorPlacementCache = {
			...currentPlacement,
			position: { ...nextPlacement.position }
		};

		const positionParamNode = getDirectParamNode(graph, liveNode, 'position');
		if (!positionParamNode || positionParamNode.data.kind !== 'parameter') {
			return;
		}
		void sendSetParamIntent(
			positionParamNode.node_id,
			{ kind: 'vec2', value: [nextPlacement.position.x, nextPlacement.position.y] },
			positionParamNode.data.param.event_behaviour
		);
	});
	const triggerGenericAction = async (): Promise<void> => {
		if (boundParam?.value.kind === 'trigger') {
			await applyGenericParamValue({ kind: 'trigger' });
			return;
		}
		if (boundParam?.value.kind === 'bool') {
			await applyGenericParamValue({
				kind: 'bool',
				value: !boundParam.value.value
			});
		}
	};

	const applySliderValue = async (raw: string): Promise<void> => {
		if (!boundParam) {
			return;
		}
		const numericValue = Number(raw);
		if (!Number.isFinite(numericValue)) {
			return;
		}
		if (boundParam.value.kind === 'int') {
			await applyGenericParamValue({ kind: 'int', value: Math.round(numericValue) });
			return;
		}
		if (boundParam.value.kind === 'float') {
			await applyGenericParamValue({ kind: 'float', value: numericValue });
		}
	};

	const applyStringValue = async (raw: string): Promise<void> => {
		if (!boundParam) {
			return;
		}
		if (boundParam.value.kind === 'css_value') {
			const parsed = parseCssValue(raw, boundParam.value.unit);
			if (!parsed) {
				return;
			}
			await applyGenericParamValue({ kind: 'css_value', value: parsed.value, unit: parsed.unit });
			return;
		}
		if (
			boundParam.value.kind === 'str' ||
			boundParam.value.kind === 'file' ||
			boundParam.value.kind === 'enum'
		) {
			await applyGenericParamValue({ kind: boundParam.value.kind, value: raw });
		}
	};

	const toggleAccordionNode = (nodeId: NodeId): void => {
		if (openAccordionNodeIds.includes(nodeId)) {
			openAccordionNodeIds = openAccordionNodeIds.filter((candidate) => candidate !== nodeId);
			return;
		}
		openAccordionNodeIds = [...openAccordionNodeIds, nodeId];
	};

	const zoomPageAtClientPoint = (clientX: number, clientY: number, factor: number): void => {
		if (!pageViewportElement) {
			return;
		}
		const rect = pageViewportElement.getBoundingClientRect();
		const nextZoom = clampPageZoom(pageView.zoom * factor);
		if (Math.abs(nextZoom - pageView.zoom) <= 1e-9) {
			return;
		}
		const pointX = clientX - rect.left - rect.width * 0.5;
		const pointY = clientY - rect.top - rect.height * 0.5;
		pageView = {
			...pageView,
			zoom: nextZoom,
			panX: pointX - ((pointX - pageView.panX) / pageView.zoom) * nextZoom,
			panY: pointY - ((pointY - pageView.panY) / pageView.zoom) * nextZoom
		};
	};

	const frameSelectedWidgets = (): boolean => {
		if (!pageViewportElement) {
			return false;
		}
		const viewportElement = pageViewportElement;
		const selectedWidgetElements = (session?.selectedNodesIds ?? [])
			.map((nodeId) =>
				viewportElement.querySelector<HTMLElement>(`[data-node-id="${String(nodeId)}"]`)
			)
			.filter((element): element is HTMLElement => element !== null);
		if (selectedWidgetElements.length === 0) {
			homePageView();
			return true;
		}
		const viewportRect = viewportElement.getBoundingClientRect();
		let localLeft = Number.POSITIVE_INFINITY;
		let localRight = Number.NEGATIVE_INFINITY;
		let localTop = Number.POSITIVE_INFINITY;
		let localBottom = Number.NEGATIVE_INFINITY;
		for (const widgetElement of selectedWidgetElements) {
			const widgetRect = widgetElement.getBoundingClientRect();
			localLeft = Math.min(
				localLeft,
				(widgetRect.left - viewportRect.left - viewportRect.width * 0.5 - pageView.panX) /
					pageView.zoom
			);
			localRight = Math.max(
				localRight,
				(widgetRect.right - viewportRect.left - viewportRect.width * 0.5 - pageView.panX) /
					pageView.zoom
			);
			localTop = Math.min(
				localTop,
				(widgetRect.top - viewportRect.top - viewportRect.height * 0.5 - pageView.panY) /
					pageView.zoom
			);
			localBottom = Math.max(
				localBottom,
				(widgetRect.bottom - viewportRect.top - viewportRect.height * 0.5 - pageView.panY) /
					pageView.zoom
			);
		}
		const localWidth = Math.max(1, localRight - localLeft);
		const localHeight = Math.max(1, localBottom - localTop);
		const nextZoom = clampPageZoom(
			Math.min((viewportRect.width * 0.78) / localWidth, (viewportRect.height * 0.78) / localHeight)
		);
		const localCenterX = (localLeft + localRight) * 0.5;
		const localCenterY = (localTop + localBottom) * 0.5;
		pageView = {
			pointerId: null,
			lastClient: null,
			zoom: nextZoom,
			panX: -localCenterX * nextZoom,
			panY: -localCenterY * nextZoom
		};
		return true;
	};

	const handlePageViewportPointerDown = (event: PointerEvent): void => {
		pageViewportElement?.focus();
		if (event.button !== 1) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		pageView = {
			...pageView,
			pointerId: event.pointerId,
			lastClient: [event.clientX, event.clientY]
		};
	};

	const handlePageViewportWheel = (event: WheelEvent): void => {
		if (wheelTargetsScrollableContent(event)) {
			return;
		}
		event.preventDefault();
		const normalizedDelta = Math.max(-480, Math.min(480, normalizeWheelDeltaY(event)));
		const factor = Math.exp(-normalizedDelta / 1800);
		zoomPageAtClientPoint(event.clientX, event.clientY, factor);
	};

	$effect(() => {
		if (!isPage) {
			return;
		}
		const unregisterHandlers = [
			registerCommandHandler(
				'view.frame',
				() => {
					if (!isPageViewportFocused) {
						return false;
					}
					return frameSelectedWidgets();
				},
				{ priority: 200 }
			),
			registerCommandHandler(
				'view.home',
				() => {
					if (!isPageViewportFocused) {
						return false;
					}
					homePageView();
					return true;
				},
				{ priority: 200 }
			)
		];

		return () => {
			for (const unregister of unregisterHandlers) {
				unregister();
			}
		};
	});
</script>

{#if isPage}
	<div
		class="dashboard-page-viewport"
		bind:this={pageViewportElement}
		tabindex="-1"
		role="region"
		aria-label="Dashboard page viewer"
		onfocusin={() => {
			isPageViewportFocused = true;
		}}
		onfocusout={() => {
			isPageViewportFocused = false;
		}}
		onwheel={handlePageViewportWheel}
		onpointerdown={handlePageViewportPointerDown}>
		<div class="dashboard-page-scene" style={pageSceneStyle}>
			<div
				class="dashboard-page-scene-hitbox"
				role="presentation"
				aria-hidden="true"
				onpointerdown={handlePageScenePointerDown}></div>
			<div class="dashboard-page-frame" style={pageFrameStyle}>
				<div
					class="dashboard-surface dashboard-page {layoutKind}"
					class:surface-target-active={surfaceDragDepth > 0}
					class:edit-bleed-visible={editMode && pageSize.enabled}
					class:snap-grid-visible={snapGridVisible}
					role="region"
					aria-label="Dashboard page surface"
					style={surfaceStyle}
					onpointerdown={handleSurfacePointerDown}
					ondragenter={handleSurfaceDragEnter}
					ondragover={handleSurfaceDragOver}
					ondragleave={handleSurfaceDragLeave}
					ondrop={(event) => {
						void handleSurfaceDrop(event);
					}}>
					{#if layoutKind === 'tabs'}
						<div class="dashboard-tab-strip">
							{#each childWidgets as child}
								<button
									type="button"
									class:selected={activeTabNodeId === child.node_id}
									onpointerdown={withStoppedPropagation}
									onclick={() => {
										activeTabNodeId = child.node_id;
									}}>{child.meta.label}</button>
							{/each}
						</div>
						<div class="dashboard-tab-body">
							{#if activeTabNodeId !== null}
								{@const activeChild =
									childWidgets.find((candidate) => candidate.node_id === activeTabNodeId) ?? null}
								{#if activeChild}
									<div class="dashboard-slot">
										<div class="dashboard-slot-fill">
											<DashboardCanvasSelf node={activeChild} {editMode} />
										</div>
									</div>
								{/if}
							{/if}
						</div>
					{:else if layoutKind === 'accordion'}
						<div class="dashboard-accordion">
							{#each childWidgets as child}
								<section class="dashboard-accordion-item">
									<button
										type="button"
										class:selected={openAccordionNodeIds.includes(child.node_id)}
										onpointerdown={withStoppedPropagation}
										onclick={() => {
											toggleAccordionNode(child.node_id);
										}}>{child.meta.label}</button>
									{#if openAccordionNodeIds.includes(child.node_id)}
										<div class="dashboard-slot accordion-slot">
											<div class="dashboard-slot-fill">
												<DashboardCanvasSelf node={child} {editMode} />
											</div>
										</div>
									{/if}
								</section>
							{/each}
						</div>
					{:else}
						<div class="dashboard-layout">
							{#each childWidgets as child}
								<div class="dashboard-slot" style={slotStyle(child)}>
									<div class="dashboard-slot-fill">
										<DashboardCanvasSelf node={child} {editMode} />
									</div>
								</div>
							{/each}
							{#if surfaceDropPreview && layoutKind === 'free'}
								<div
									class="dashboard-slot dashboard-drop-preview"
									style={placementStyle(surfaceDropPreview.placement)}
									aria-hidden="true">
									<div class="dashboard-slot-fill">
										<div class="dashboard-drop-preview-fill">
											<span class="dashboard-drop-preview-kind"
												>{surfaceDropPreview.targetKind === 'parameter'
													? 'Parameter Widget'
													: 'Node Widget'}</span>
											<strong>{surfaceDropPreview.label}</strong>
										</div>
									</div>
								</div>
							{/if}
						</div>
					{/if}

					{#if childWidgets.length === 0}
						<div class="dashboard-empty-state">
							<span class="eyebrow">Dashboard Page</span>
							<h3>Drop a node or parameter here</h3>
							<p>
								Outliner drags create node widgets. Inspector parameter-label drags create generic
								widgets.
							</p>
						</div>
					{/if}

					{#if surfaceDragDepth > 0 && (!surfaceDropPreview || layoutKind !== 'free')}
						<div class="dashboard-drop-indicator">Drop to create a widget</div>
					{/if}
				</div>
			</div>
			{#if editMode && pageSize.enabled}
				<div
					class="dashboard-page-visibility-overlay"
					style={pageBleedFrameStyle}
					aria-hidden="true">
				</div>
			{/if}
			{#if marqueeSelection}
				<div class="dashboard-marquee-selection" style={marqueeStyle} aria-hidden="true"></div>
			{/if}
		</div>
	</div>
{:else if isContainerWidget}
	<section
		class="dashboard-widget-shell dashboard-container"
		class:selected={isSelected}
		class:free-layout-active={freeLayoutInteraction !== null}
		class:editable-free={supportsFreePlacement}
		class:run-mode={!editMode}
		data-node-id={liveNode.node_id}
		data-dashboard-surface-id={String(parentNode?.node_id ?? '')}
		bind:this={widgetShellElement}
		style={widgetShellStyle}
		role="button"
		tabindex={editMode ? 0 : -1}
		onpointerdown={handleWidgetPointerDown}
		onkeydown={selectWidgetNodeFromKeyboard}>
		{#if editMode && supportsFreePlacement}
			{#each freeLayoutResizeZones as resizeZone}
				<div
					class="dashboard-resize-zone {resizeZone.name}"
					aria-hidden="true"
					onpointerdown={(event) => {
						if (!isSelected) {
							selectWidgetNode('REPLACE');
						}
						beginFreeLayoutResize(event, resizeZone.edges, resolveTransformNodes());
					}}>
				</div>
			{/each}
		{/if}
		{#if anchorGuides.length > 0}
			<div class="dashboard-anchor-guides" aria-hidden="true">
				{#each anchorGuides as guide}
					<div class="dashboard-anchor-guide {guide.axis} {guide.direction}" style={guide.style}></div>
				{/each}
			</div>
		{/if}
		<div
			class="dashboard-surface dashboard-container-surface {layoutKind}"
			class:surface-target-active={surfaceDragDepth > 0}
			class:snap-grid-visible={snapGridVisible}
			role="group"
			aria-label="Dashboard container surface"
			style={surfaceStyle}
			onpointerdown={handleSurfacePointerDown}
			ondragenter={handleSurfaceDragEnter}
			ondragover={handleSurfaceDragOver}
			ondragleave={handleSurfaceDragLeave}
			ondrop={(event) => {
				void handleSurfaceDrop(event);
			}}>
			{#if layoutKind === 'tabs'}
				<div class="dashboard-tab-strip compact">
					{#each childWidgets as child}
						<button
							type="button"
							class:selected={activeTabNodeId === child.node_id}
							onpointerdown={withStoppedPropagation}
							onclick={() => {
								activeTabNodeId = child.node_id;
							}}>{child.meta.label}</button>
					{/each}
				</div>
				<div class="dashboard-tab-body compact">
					{#if activeTabNodeId !== null}
						{@const activeChild =
							childWidgets.find((candidate) => candidate.node_id === activeTabNodeId) ?? null}
						{#if activeChild}
							<div class="dashboard-slot">
								<div class="dashboard-slot-fill">
									<DashboardCanvasSelf node={activeChild} {editMode} />
								</div>
							</div>
						{/if}
					{/if}
				</div>
			{:else if layoutKind === 'accordion'}
				<div class="dashboard-accordion compact">
					{#each childWidgets as child}
						<section class="dashboard-accordion-item">
							<button
								type="button"
								class:selected={openAccordionNodeIds.includes(child.node_id)}
								onpointerdown={withStoppedPropagation}
								onclick={() => {
									toggleAccordionNode(child.node_id);
								}}>{child.meta.label}</button>
							{#if openAccordionNodeIds.includes(child.node_id)}
								<div class="dashboard-slot accordion-slot">
									<div class="dashboard-slot-fill">
										<DashboardCanvasSelf node={child} {editMode} />
									</div>
								</div>
							{/if}
						</section>
					{/each}
				</div>
			{:else}
				<div class="dashboard-layout">
					{#each childWidgets as child}
						<div class="dashboard-slot" style={slotStyle(child)}>
							<div class="dashboard-slot-fill"><DashboardCanvasSelf node={child} {editMode} /></div>
						</div>
					{/each}
					{#if surfaceDropPreview && layoutKind === 'free'}
						<div
							class="dashboard-slot dashboard-drop-preview"
							style={placementStyle(surfaceDropPreview.placement)}
							aria-hidden="true">
							<div class="dashboard-slot-fill">
								<div class="dashboard-drop-preview-fill">
									<span class="dashboard-drop-preview-kind"
										>{surfaceDropPreview.targetKind === 'parameter'
											? 'Parameter Widget'
											: 'Node Widget'}</span>
									<strong>{surfaceDropPreview.label}</strong>
								</div>
							</div>
						</div>
					{/if}
				</div>
			{/if}

			{#if childWidgets.length === 0}
				<div class="dashboard-empty-inline">Drop widgets here or use the add menu.</div>
			{/if}

			{#if surfaceDragDepth > 0 && (!surfaceDropPreview || layoutKind !== 'free')}
				<div class="dashboard-drop-indicator">Drop to add a child widget</div>
			{/if}
		</div>
		{#if marqueeSelection}
			<div class="dashboard-marquee-selection" style={marqueeStyle} aria-hidden="true"></div>
		{/if}
	</section>
{:else if isNodeWidget}
	<section
		class="dashboard-widget-shell dashboard-node-widget"
		class:selected={isSelected}
		class:binding-active={bindingDragDepth > 0}
		class:free-layout-active={freeLayoutInteraction !== null}
		class:editable-free={supportsFreePlacement}
		class:run-mode={!editMode}
		data-node-id={liveNode.node_id}
		data-dashboard-surface-id={String(parentNode?.node_id ?? '')}
		bind:this={widgetShellElement}
		style={widgetShellStyle}
		role="button"
		tabindex={editMode ? 0 : -1}
		ondragenter={(event) => {
			handleBindingDragEnter(event, canBindNodeWidget);
		}}
		ondragover={(event) => {
			handleBindingDragOver(event, canBindNodeWidget);
		}}
		ondragleave={handleBindingDragLeave}
		ondrop={(event) => {
			void handleNodeWidgetBindingDrop(event);
		}}
		onpointerdown={handleWidgetPointerDown}
		onkeydown={selectWidgetNodeFromKeyboard}>
		{#if editMode && supportsFreePlacement}
			{#each freeLayoutResizeZones as resizeZone}
				<div
					class="dashboard-resize-zone {resizeZone.name}"
					aria-hidden="true"
					onpointerdown={(event) => {
						if (!isSelected) {
							selectWidgetNode('REPLACE');
						}
						beginFreeLayoutResize(event, resizeZone.edges, resolveTransformNodes());
					}}>
				</div>
			{/each}
		{/if}
		{#if anchorGuides.length > 0}
			<div class="dashboard-anchor-guides" aria-hidden="true">
				{#each anchorGuides as guide}
					<div class="dashboard-anchor-guide {guide.axis} {guide.direction}" style={guide.style}></div>
				{/each}
			</div>
		{/if}
		<div class="dashboard-widget-content inspector-body">
			{#if boundNode}
				<div class="dashboard-live-content" class:inert-mode={editMode} inert={editMode}>
					{#if showsNodeWidgetEditor}
						<DashboardNodeWidgetParameterEditorContent
							widgetNode={liveNode}
							targetNode={boundNode} />
					{:else if NodeWidgetDisplayComponent}
						<NodeWidgetDisplayComponent targetNode={boundNode} {includeChildren} {editMode} />
					{:else}
						<div class="dashboard-empty-inline">No display mode is available for this node.</div>
					{/if}
				</div>
			{:else}
				<div class="dashboard-empty-inline">This widget is not bound yet.</div>
			{/if}
		</div>
	</section>
{:else if isGenericWidget}
	<section
		class="dashboard-widget-shell dashboard-generic-widget"
		class:selected={isSelected}
		class:binding-active={bindingDragDepth > 0}
		class:free-layout-active={freeLayoutInteraction !== null}
		class:editable-free={supportsFreePlacement}
		class:run-mode={!editMode}
		data-node-id={liveNode.node_id}
		data-dashboard-surface-id={String(parentNode?.node_id ?? '')}
		bind:this={widgetShellElement}
		style={widgetShellStyle}
		role="button"
		tabindex={editMode ? 0 : -1}
		ondragenter={(event) => {
			handleBindingDragEnter(event, canBindGenericWidget);
		}}
		ondragover={(event) => {
			handleBindingDragOver(event, canBindGenericWidget);
		}}
		ondragleave={handleBindingDragLeave}
		ondrop={(event) => {
			void handleGenericWidgetBindingDrop(event);
		}}
		onpointerdown={handleWidgetPointerDown}
		onkeydown={selectWidgetNodeFromKeyboard}>
		{#if editMode && supportsFreePlacement}
			{#each freeLayoutResizeZones as resizeZone}
				<div
					class="dashboard-resize-zone {resizeZone.name}"
					aria-hidden="true"
					onpointerdown={(event) => {
						if (!isSelected) {
							selectWidgetNode('REPLACE');
						}
						beginFreeLayoutResize(event, resizeZone.edges, resolveTransformNodes());
					}}>
				</div>
			{/each}
		{/if}
		{#if anchorGuides.length > 0}
			<div class="dashboard-anchor-guides" aria-hidden="true">
				{#each anchorGuides as guide}
					<div class="dashboard-anchor-guide {guide.axis} {guide.direction}" style={guide.style}></div>
				{/each}
			</div>
		{/if}
		<div class="dashboard-widget-content generic-body">
			<div class="dashboard-live-content" class:inert-mode={editMode} inert={editMode}>
				{#if widgetKind === 'button'}
					<button
						type="button"
						class="generic-button"
						onclick={() => {
							void triggerGenericAction();
						}}
						disabled={editMode}>{textConfig || boundParamNode?.meta.label || 'Trigger'}</button>
				{:else if widgetKind === 'slider'}
					<div class="generic-slider-wrap">
						<input
							type="range"
							min={String(valueRange[0])}
							max={String(valueRange[1])}
							step={String(sliderStep)}
							value={String(
								boundParam?.value.kind === 'float' || boundParam?.value.kind === 'int'
									? boundParam.value.value
									: valueRange[0]
							)}
							disabled={editMode ||
								!boundParam ||
								(boundParam.value.kind !== 'float' && boundParam.value.kind !== 'int')}
							oninput={(event) => {
								void applySliderValue((event.target as HTMLInputElement).value);
							}} />
						<div class="generic-readout">
							{boundParam ? formatParamValue(boundParam.value) : 'Unbound'}
						</div>
					</div>
				{:else if widgetKind === 'checkbox'}
					<label class="generic-checkbox">
						<input
							type="checkbox"
							checked={boundParam?.value.kind === 'bool' ? boundParam.value.value : defaultChecked}
							disabled={editMode || boundParam?.value.kind !== 'bool'}
							onchange={(event) => {
								void applyGenericParamValue({
									kind: 'bool',
									value: (event.target as HTMLInputElement).checked
								});
							}} />
						<span>{textConfig || boundParamNode?.meta.label || 'Enabled'}</span>
					</label>
				{:else if widgetKind === 'textInput'}
					{#if multiline}
						<textarea
							rows="4"
							placeholder={placeholderConfig}
							disabled={editMode ||
								!boundParam ||
								(boundParam.value.kind !== 'str' &&
									boundParam.value.kind !== 'file' &&
									boundParam.value.kind !== 'enum' &&
									boundParam.value.kind !== 'css_value')}
							onchange={(event) => {
								void applyStringValue((event.target as HTMLTextAreaElement).value);
							}}
							>{boundParam
								? boundParam.value.kind === 'css_value'
									? formatCssValue(boundParam.value)
									: boundParam.value.kind === 'str' ||
										  boundParam.value.kind === 'file' ||
										  boundParam.value.kind === 'enum'
										? boundParam.value.value
										: textConfig
								: textConfig}</textarea>
					{:else}
						<input
							type="text"
							value={boundParam
								? boundParam.value.kind === 'css_value'
									? formatCssValue(boundParam.value)
									: boundParam.value.kind === 'str' ||
										  boundParam.value.kind === 'file' ||
										  boundParam.value.kind === 'enum'
										? boundParam.value.value
										: textConfig
								: textConfig}
							placeholder={placeholderConfig}
							disabled={editMode ||
								!boundParam ||
								(boundParam.value.kind !== 'str' &&
									boundParam.value.kind !== 'file' &&
									boundParam.value.kind !== 'enum' &&
									boundParam.value.kind !== 'css_value')}
							onchange={(event) => {
								void applyStringValue((event.target as HTMLInputElement).value);
							}} />
					{/if}
				{:else}
					<div class="generic-text-display">
						{genericDisplayValue || 'Drop a parameter or set static text.'}
					</div>
				{/if}
			</div>
		</div>
	</section>
{/if}

<style>
	.dashboard-surface {
		position: relative;
		inline-size: 100%;
		block-size: auto;
		min-block-size: 8rem;
		border-radius: 0.5rem;
		background: rgb(from var(--gc-color-background) r g b / 0.45);
		border: dashed 0.06rem rgb(from var(--gc-color-panel-outline) r g b / 0.55);
	}

	.dashboard-surface.snap-grid-visible::before {
		content: '';
		position: absolute;
		inset: 0;
		pointer-events: none;
		background-image:
			linear-gradient(
				to right,
				rgb(from var(--gc-color-panel-outline) r g b / 0.16) 0.06rem,
				transparent 0.06rem
			),
			linear-gradient(
				to bottom,
				rgb(from var(--gc-color-panel-outline) r g b / 0.16) 0.06rem,
				transparent 0.06rem
			);
		background-size: var(--dashboard-snap-grid-step) var(--dashboard-snap-grid-step);
		background-position: 0 0;
		z-index: 0;
	}

	.dashboard-page.edit-bleed-visible,
	.dashboard-page.edit-bleed-visible .dashboard-layout {
		overflow: visible;
	}

	.dashboard-page {
		box-sizing: border-box;
		block-size: 100%;
		min-block-size: 100%;
		padding: 0;
	}

	.dashboard-container-surface {
		box-sizing: border-box;
		block-size: 100%;
	}

	.dashboard-page-viewport {
		position: relative;
		display: flex;
		flex-direction: column;
		inline-size: 100%;
		block-size: 100%;
		min-block-size: 0;
		overflow: hidden;
	}

	.dashboard-page-viewport:focus,
	.dashboard-page-viewport:focus-visible {
		outline: none;
	}

	.dashboard-page-scene {
		position: relative;
		display: grid;
		place-items: center;
		inline-size: 100%;
		block-size: 100%;
		min-block-size: 0;
		overflow: visible;
		box-sizing: border-box;
	}

	.dashboard-page-scene-hitbox {
		position: absolute;
		inset: 0;
		z-index: 0;
	}

	.dashboard-page-frame {
		position: relative;
		grid-area: 1 / 1;
		flex: 0 0 auto;
		overflow: visible;
		z-index: 1;
		transform-origin: center center;
		transition: box-shadow 120ms ease;
	}

	.dashboard-page-visibility-overlay {
		grid-area: 1 / 1;
		position: relative;
		pointer-events: none;
		border-radius: 0.9rem;
		box-shadow:
			0 0 0 100vmax rgb(from var(--gc-color-background) r g b / 0.2),
			0 0.8rem 2rem rgb(from var(--gc-color-background) r g b / 0.1);
		border: solid 0.06rem rgb(from var(--gc-color-selection) r g b / 0.2);
		transform-origin: center center;
	}

	.dashboard-page.surface-target-active,
	.dashboard-container-surface.surface-target-active {
		border-color: rgb(from var(--gc-color-focus) r g b / 0.86);
		box-shadow: 0 0 0 0.08rem rgb(from var(--gc-color-focus) r g b / 0.28);
	}

	.dashboard-surface.free .dashboard-layout {
		position: relative;
		inline-size: 100%;
		block-size: 100%;
		min-block-size: inherit;
		z-index: 1;
	}

	.dashboard-surface.free .dashboard-slot {
		position: absolute;
		min-inline-size: 0;
		min-block-size: 0;
	}

	.dashboard-surface.grid .dashboard-layout {
		display: grid;
		grid-template-columns: repeat(var(--dashboard-grid-columns), minmax(0, 1fr));
		grid-auto-rows: minmax(5rem, auto);
		gap: var(--dashboard-gap-y) var(--dashboard-gap-x);
	}

	.dashboard-surface.horizontal .dashboard-layout,
	.dashboard-surface.vertical .dashboard-layout {
		display: flex;
		flex: 1 1 auto;
		gap: var(--dashboard-gap-y) var(--dashboard-gap-x);
		inline-size: 100%;
		block-size: 100%;
		min-inline-size: 0;
		min-block-size: 0;
	}

	.dashboard-surface.horizontal {
		overflow-x: auto;
		overflow-y: hidden;
	}

	.dashboard-surface.vertical {
		overflow-x: hidden;
		overflow-y: auto;
	}

	.dashboard-surface.horizontal .dashboard-layout {
		flex-direction: row;
		flex-wrap: nowrap;
		align-items: stretch;
		align-content: flex-start;
	}

	.dashboard-surface.vertical .dashboard-layout {
		flex-direction: column;
		align-items: stretch;
		justify-content: flex-start;
	}

	.dashboard-tab-strip {
		display: flex;
		gap: 0.45rem;
		padding: 0.3rem 0.3rem 0.7rem;
		flex-wrap: wrap;
	}

	.dashboard-tab-strip.compact {
		padding: 0 0 0.65rem;
	}

	.dashboard-tab-strip button,
	.dashboard-accordion-item > button {
		border-radius: 999rem;
		padding: 0.35rem 0.75rem;
		background: rgb(from var(--gc-color-background) r g b / 0.45);
		border: solid 0.06rem rgb(from var(--gc-color-panel-outline) r g b / 0.55);
		color: var(--gc-color-text);
		font-size: 0.74rem;
	}

	.dashboard-tab-strip button {
		cursor: pointer;
	}

	.dashboard-tab-strip button.selected,
	.dashboard-accordion-item > button.selected {
		background: rgb(from var(--gc-color-selection) r g b / 0.24);
		border-color: rgb(from var(--gc-color-selection) r g b / 0.7);
		color: white;
	}

	.dashboard-tab-body,
	.dashboard-accordion {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.dashboard-tab-body.compact {
		block-size: 100%;
	}

	.dashboard-accordion-item {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	.dashboard-slot {
		display: flex;
		min-inline-size: 0;
		min-block-size: 0;
	}

	.dashboard-slot-fill {
		display: flex;
		flex: 1 1 auto;
		inline-size: 100%;
		block-size: 100%;
		min-inline-size: 0;
		min-block-size: 0;
	}

	.dashboard-slot.accordion-slot {
		padding-inline-start: 0.1rem;
	}

	.dashboard-surface.horizontal .dashboard-slot,
	.dashboard-tab-body .dashboard-slot,
	.dashboard-tab-body.compact .dashboard-slot {
		block-size: 100%;
	}

	.dashboard-surface.horizontal .dashboard-slot {
		flex: 0 0 auto;
		align-self: stretch;
		block-size: 100%;
	}

	.dashboard-surface.vertical .dashboard-slot,
	.dashboard-surface.grid .dashboard-slot,
	.dashboard-accordion .dashboard-slot {
		inline-size: 100%;
	}

	.dashboard-surface.vertical .dashboard-slot {
		flex: 0 0 auto;
		inline-size: 100%;
	}

	.dashboard-widget-shell {
		position: relative;
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		inline-size: 100%;
		block-size: 100%;
		align-self: stretch;
		min-inline-size: 0;
		min-block-size: 0;
		border-radius: 0.5rem;
		background: rgb(from var(--gc-color-background) r g b / 0);
		border: dashed 0.06rem rgb(from var(--gc-color-panel-outline) r g b / 0.28);
		box-shadow: none;
		overflow: hidden;
		transition:
			border-color 120ms ease,
			border-style 120ms ease,
			box-shadow 120ms ease,
			background 120ms ease;
	}

	.dashboard-widget-shell.editable-free {
		cursor: grab;
	}

	.dashboard-widget-shell.editable-free.free-layout-active {
		cursor: grabbing;
	}

	.dashboard-widget-shell:not(.run-mode):hover {
		border-style: solid;
		border-color: rgb(from var(--gc-color-panel-outline) r g b / 0.82);
		background: rgb(from var(--gc-color-background) r g b / 0.08);
	}

	.dashboard-widget-shell.selected {
		border-style: solid;
		border-color: rgb(from var(--gc-color-selection) r g b / 0.8);
		box-shadow:
			0 0 0 0.08rem rgb(from var(--gc-color-selection) r g b / 0.35),
			0 0.45rem 1rem rgb(from var(--gc-color-selection) r g b / 0.14);
	}

	.dashboard-widget-shell.selected.editable-free {
		overflow: visible;
	}

	.dashboard-widget-shell.binding-active {
		border-style: solid;
		border-color: rgb(from var(--gc-color-focus) r g b / 0.84);
		box-shadow: 0 0 0 0.08rem rgb(from var(--gc-color-focus) r g b / 0.28);
	}

	.dashboard-widget-shell.free-layout-active {
		box-shadow:
			0 0 0 0.08rem rgb(from var(--gc-color-focus) r g b / 0.34),
			0 0 0.9rem rgb(from var(--gc-color-background) r g b / 0.2);
	}

	.dashboard-widget-shell.run-mode {
		border-color: transparent;
		border-style: solid;
		box-shadow: none;
		background: transparent;
	}

	.dashboard-resize-zone {
		position: absolute;
		background: transparent;
		z-index: 3;
	}

	.dashboard-resize-zone.north,
	.dashboard-resize-zone.south {
		inset-inline: 0.75rem;
		block-size: 0.5rem;
	}

	.dashboard-resize-zone.east,
	.dashboard-resize-zone.west {
		inset-block: 0.75rem;
		inline-size: 0.5rem;
	}

	.dashboard-resize-zone.north {
		inset-block-start: 0;
		cursor: ns-resize;
	}

	.dashboard-resize-zone.south {
		inset-block-end: 0;
		cursor: ns-resize;
	}

	.dashboard-resize-zone.east {
		inset-inline-end: 0;
		cursor: ew-resize;
	}

	.dashboard-resize-zone.west {
		inset-inline-start: 0;
		cursor: ew-resize;
	}

	.dashboard-resize-zone.north-west,
	.dashboard-resize-zone.north-east,
	.dashboard-resize-zone.south-east,
	.dashboard-resize-zone.south-west {
		inline-size: 0.9rem;
		block-size: 0.9rem;
	}

	.dashboard-resize-zone.north-west {
		inset-inline-start: 0;
		inset-block-start: 0;
		cursor: nwse-resize;
	}

	.dashboard-resize-zone.north-east {
		inset-inline-end: 0;
		inset-block-start: 0;
		cursor: nesw-resize;
	}

	.dashboard-resize-zone.south-east {
		inset-inline-end: 0;
		inset-block-end: 0;
		cursor: nwse-resize;
	}

	.dashboard-resize-zone.south-west {
		inset-inline-start: 0;
		inset-block-end: 0;
		cursor: nesw-resize;
	}

	.dashboard-drop-indicator,
	.dashboard-drop-preview-kind,
	.dashboard-empty-state .eyebrow {
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-size: 0.62rem;
		opacity: 0.7;
	}

	.dashboard-widget-content {
		display: flex;
		flex: 1 1 auto;
		padding: 0;
		min-inline-size: 0;
		min-block-size: 0;
		overflow: hidden;
	}

	.dashboard-widget-content.inspector-body {
		display: flex;
		flex: 1 1 auto;
		position: relative;
		overflow: auto;
	}

	.dashboard-widget-shell:not(.run-mode) .dashboard-widget-content::after {
		content: '';
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 2;
		background: rgb(from var(--gc-color-background) r g b / 0.12);
		opacity: 0;
		transition:
			opacity 120ms ease,
			background 120ms ease;
	}

	.dashboard-widget-shell:not(.run-mode):hover .dashboard-widget-content::after,
	.dashboard-widget-shell.selected .dashboard-widget-content::after,
	.dashboard-widget-shell.binding-active .dashboard-widget-content::after {
		background: rgb(from var(--gc-color-background) r g b / 0.16);
		opacity: 1;
	}

	.dashboard-widget-shell.run-mode .dashboard-widget-content::after {
		display: none;
	}

	.dashboard-live-content {
		position: relative;
		z-index: 1;
		display: flex;
		flex: 1 1 auto;
		inline-size: 100%;
		block-size: 100%;
		min-inline-size: 0;
		min-block-size: 0;
		overflow: auto;
	}

	.dashboard-live-content.inert-mode {
		pointer-events: none;
		user-select: none;
	}

	.dashboard-container-surface {
		padding: 0;
		border: none;
		background: transparent;
		box-shadow: none;
		min-block-size: 4rem;
	}

	.dashboard-anchor-guides {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 5;
		overflow: visible;
	}

	.dashboard-anchor-guide {
		position: absolute;
		pointer-events: none;
		background: rgb(from var(--gc-color-selection) r g b / 0.42);
		box-shadow: 0 0 0.3rem rgb(from var(--gc-color-selection) r g b / 0.15);
	}

	.dashboard-anchor-guide.horizontal {
		block-size: 0.08rem;
	}

	.dashboard-anchor-guide.vertical {
		inline-size: 0.08rem;
	}

	.dashboard-anchor-guide::after {
		content: '';
		position: absolute;
		inline-size: 0.34rem;
		block-size: 0.34rem;
		background: rgb(from var(--gc-color-selection) r g b / 0.58);
		clip-path: polygon(50% 0%, 100% 100%, 0% 100%);
	}

	.dashboard-anchor-guide.horizontal.left::after {
		inset-inline-start: -0.18rem;
		inset-block-start: calc(50% - 0.17rem);
		transform: rotate(-90deg);
	}

	.dashboard-anchor-guide.horizontal.right::after {
		inset-inline-end: -0.18rem;
		inset-block-start: calc(50% - 0.17rem);
		transform: rotate(90deg);
	}

	.dashboard-anchor-guide.vertical.up::after {
		inset-inline-start: calc(50% - 0.17rem);
		inset-block-start: -0.18rem;
		transform: rotate(0deg);
	}

	.dashboard-anchor-guide.vertical.down::after {
		inset-inline-start: calc(50% - 0.17rem);
		inset-block-end: -0.18rem;
		transform: rotate(180deg);
	}

	.dashboard-marquee-selection {
		position: fixed;
		pointer-events: none;
		z-index: 1000;
		border: solid 0.08rem rgb(from var(--gc-color-selection) r g b / 0.92);
		background: rgb(from var(--gc-color-selection) r g b / 0.16);
		box-shadow: inset 0 0 0 0.04rem rgb(from var(--gc-color-selection) r g b / 0.24);
		border-radius: 0.2rem;
	}

	.dashboard-empty-state,
	.dashboard-empty-inline,
	.dashboard-drop-indicator {
		display: flex;
		align-items: center;
		justify-content: center;
		text-align: center;
		color: var(--gc-color-text);
	}

	.dashboard-empty-state {
		position: absolute;
		inset: 0.8rem;
		border-radius: 0.8rem;
		flex-direction: column;
		gap: 0.4rem;
		border: dashed 0.08rem rgb(from var(--gc-color-panel-outline) r g b / 0.6);
		background: rgb(from var(--gc-color-background) r g b / 0.16);
	}

	.dashboard-empty-state h3 {
		margin: 0;
		font-size: 1.05rem;
		color: #eef4ff;
	}

	.dashboard-empty-state p,
	.dashboard-empty-inline {
		margin: 0;
		font-size: 0.76rem;
		line-height: 1.45;
		opacity: 0.78;
	}

	.dashboard-empty-inline {
		min-block-size: 4.25rem;
		border-radius: 0.75rem;
		border: dashed 0.06rem rgb(from var(--gc-color-panel-outline) r g b / 0.45);
		background: rgb(from var(--gc-color-background) r g b / 0.22);
		padding: 0.55rem;
	}

	.dashboard-drop-indicator {
		position: absolute;
		inset: 0.7rem;
		border-radius: 0.8rem;
		border: dashed 0.08rem rgb(from var(--gc-color-focus) r g b / 0.9);
		background: rgb(from var(--gc-color-focus) r g b / 0.16);
		color: white;
		pointer-events: none;
	}

	.dashboard-drop-preview {
		pointer-events: none;
		z-index: 2;
	}

	.dashboard-drop-preview-fill {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 0.35rem;
		inline-size: 100%;
		block-size: 100%;
		padding: 0.75rem 0.85rem;
		box-sizing: border-box;
		border-radius: 0.8rem;
		border: dashed 0.08rem rgb(from var(--gc-color-focus) r g b / 0.92);
		background:
			linear-gradient(
				180deg,
				rgb(from var(--gc-color-focus) r g b / 0.18),
				rgb(from var(--gc-color-selection) r g b / 0.1)
			),
			rgb(from var(--gc-color-background) r g b / 0.62);
		box-shadow: 0 0.4rem 1rem rgb(from var(--gc-color-background) r g b / 0.2);
		color: white;
		overflow: hidden;
	}

	.dashboard-drop-preview-fill strong {
		font-size: 0.78rem;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.dashboard-drop-preview-kind {
		opacity: 0.72;
	}

	.generic-body {
		display: flex;
		flex: 1 1 auto;
		align-items: stretch;
		justify-content: stretch;
		padding: 0;
		min-block-size: 0;
	}

	.generic-button,
	.generic-text-display,
	.generic-slider-wrap,
	.generic-checkbox,
	.generic-body input[type='text'],
	.generic-body input[type='range'],
	.generic-body textarea {
		inline-size: 100%;
		block-size: 100%;
	}

	.generic-button {
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 0.7rem;
		padding: 0.55rem 0.8rem;
		background:
			linear-gradient(
				135deg,
				rgb(from var(--gc-color-selection) r g b / 0.32),
				rgb(from var(--gc-color-binding) r g b / 0.18)
			),
			rgb(from var(--gc-color-background) r g b / 0.7);
		border: solid 0.06rem rgb(from var(--gc-color-selection) r g b / 0.6);
		color: #f2f5ff;
		font-size: 0.76rem;
		font-weight: 600;
	}

	.generic-text-display,
	.generic-slider-wrap,
	.generic-checkbox,
	.generic-body input[type='text'],
	.generic-body textarea {
		border-radius: 0.7rem;
		background: rgb(from var(--gc-color-background) r g b / 0.48);
		border: solid 0.06rem rgb(from var(--gc-color-panel-outline) r g b / 0.48);
		padding: 0.5rem 0.65rem;
		box-sizing: border-box;
	}

	.generic-slider-wrap {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		gap: 0.5rem;
	}

	.generic-text-display {
		display: flex;
		align-items: center;
		justify-content: center;
		text-align: center;
	}

	.generic-readout {
		font-size: 0.72rem;
		opacity: 0.76;
	}

	.generic-checkbox {
		display: flex;
		flex: 1 1 auto;
		gap: 0.6rem;
		align-items: center;
	}

	.generic-checkbox input {
		flex: 0 0 auto;
	}

	.generic-body textarea {
		resize: none;
		min-block-size: 0;
	}
</style>
