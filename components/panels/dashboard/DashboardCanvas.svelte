<script lang="ts">
	import { onDestroy } from 'svelte';
	import { registerCommandHandler } from '$lib/golden_ui/store/commands.svelte';
	import { appState } from '$lib/golden_ui/store/workbench.svelte';
	import { createUiEditSession, sendSetParamIntent } from '$lib/golden_ui/store/ui-intents';
	import type { NodeId, ParamValue, UiNodeDto } from '$lib/golden_ui/types';
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

	import {
		bindDashboardGenericWidgetTarget,
		bindDashboardNodeWidgetTarget,
		createDashboardGenericWidget,
		createDashboardNodeWidget
	} from './dashboard-actions';
	import { readDashboardDragPayload, type DashboardDragPayload } from './dashboard-drag';
	import {
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
		type DashboardLayoutKind
	} from './dashboard-model';

	let { node, editMode = false } = $props<{ node: UiNodeDto; editMode?: boolean }>();

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
	let pageViewportSize = $state({ width: 0, height: 0 });

	type FreeLayoutInteractionMode = 'move' | 'resize';
	type FreeLayoutResizeEdges = {
		left: boolean;
		right: boolean;
		top: boolean;
		bottom: boolean;
	};
	type FreeLayoutPreview = {
		position: { x: CssValueData; y: CssValueData };
		size: { width: CssValueData; height: CssValueData };
	};
	type FreeLayoutInteraction = {
		pointerId: number;
		mode: FreeLayoutInteractionMode;
		resizeEdges: FreeLayoutResizeEdges | null;
		startClient: [number, number];
		startPosition: { x: CssValueData; y: CssValueData };
		startSize: { width: CssValueData; height: CssValueData };
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

	let freeLayoutInteraction = $state<FreeLayoutInteraction | null>(null);
	let freeLayoutPreview = $state<FreeLayoutPreview | null>(null);
	let pageView = $state<DashboardPageViewState>({
		pointerId: null,
		lastClient: null,
		panX: 0,
		panY: 0,
		zoom: 1
	});

	const minFreeWidgetWidthRem = 6.5;
	const minFreeWidgetHeightRem = 2.8;
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
	let pendingFreeLayoutCommit: FreeLayoutPreview | null = null;
	let lastCommittedFreeLayoutPreview: FreeLayoutPreview | null = null;
	let freeLayoutEditSession: ReturnType<typeof createUiEditSession> | null = null;

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
		const layoutWidth = surface instanceof HTMLElement ? Math.max(surface.clientWidth, 1) : Math.max(rect.width, 1);
		const layoutHeight = surface instanceof HTMLElement ? Math.max(surface.clientHeight, 1) : Math.max(rect.height, 1);
		return {
			width: Math.max(layoutWidth, rootRemPx),
			height: Math.max(layoutHeight, rootRemPx),
			scaleX: Math.max(rect.width, 1) / layoutWidth,
			scaleY: Math.max(rect.height, 1) / layoutHeight
		};
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

	const cloneFreeLayoutPreview = (preview: FreeLayoutPreview): FreeLayoutPreview => ({
		position: {
			x: { ...preview.position.x },
			y: { ...preview.position.y }
		},
		size: {
			width: { ...preview.size.width },
			height: { ...preview.size.height }
		}
	});

	const currentPlacementPreview = (): FreeLayoutPreview => ({
		position: {
			x: { ...placement.position.x },
			y: { ...placement.position.y }
		},
		size: {
			width: { ...placement.size.width },
			height: { ...placement.size.height }
		}
	});

	const sameCssValue = (left: CssValueData, right: CssValueData): boolean =>
		left.value === right.value && left.unit === right.unit;

	const isSameFreeLayoutPreview = (left: FreeLayoutPreview | null, right: FreeLayoutPreview | null): boolean => {
		if (!left || !right) {
			return left === right;
		}
		return (
			sameCssValue(left.position.x, right.position.x) &&
			sameCssValue(left.position.y, right.position.y) &&
			sameCssValue(left.size.width, right.size.width) &&
			sameCssValue(left.size.height, right.size.height)
		);
	};

	const snapToGridPx = (valuePx: number, snapPx: number): number => {
		if (!(snapPx > 0)) {
			return valuePx;
		}
		return Math.round(valuePx / snapPx) * snapPx;
	};

	const clampPageZoom = (zoom: number): number => Math.min(maxPageZoom, Math.max(minPageZoom, zoom));

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
		if (activeTabNodeId !== null && childWidgets.some((candidate) => candidate.node_id === activeTabNodeId)) {
			return;
		}
		activeTabNodeId = childWidgets[0]?.node_id ?? null;
	});

	$effect(() => {
		if (layoutKind !== 'accordion') {
			return;
		}
		const availableIds = new Set(childWidgets.map((candidate) => candidate.node_id));
		let nextOpenAccordionNodeIds = openAccordionNodeIds.filter((nodeId) => availableIds.has(nodeId));
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
		homePageView();
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
			pageViewportSize = {
				width: Math.max(entry.contentRect.width, 1),
				height: Math.max(entry.contentRect.height, 1)
			};
		});
		observer.observe(pageViewportElement);
		return () => {
			observer.disconnect();
		};
	});

	const selectWidgetNode = (): void => {
		if (!editMode) {
			return;
		}
		session?.selectNode(liveNode.node_id, 'REPLACE');
	};

	const selectWidgetNodeFromKeyboard = (event: KeyboardEvent): void => {
		if (event.key !== 'Enter' && event.key !== ' ') {
			return;
		}
		event.preventDefault();
		selectWidgetNode();
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

	const handleSurfaceDragEnter = (event: DragEvent): void => {
		const payload = readDashboardDragPayload(event);
		if (!canCreateFromDrop(payload)) {
			return;
		}
		event.preventDefault();
		surfaceDragDepth += 1;
	};

	const handleSurfaceDragOver = (event: DragEvent): void => {
		const payload = readDashboardDragPayload(event);
		if (!canCreateFromDrop(payload)) {
			return;
		}
		event.preventDefault();
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'copy';
		}
	};

	const handleSurfaceDragLeave = (): void => {
		surfaceDragDepth = Math.max(0, surfaceDragDepth - 1);
	};

	const handleSurfaceDrop = async (event: DragEvent): Promise<void> => {
		const payload = readDashboardDragPayload(event);
		surfaceDragDepth = 0;
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
			await createDashboardGenericWidget(getGraph, liveNode.node_id, targetNode);
			return;
		}
		await createDashboardNodeWidget(getGraph, liveNode.node_id, targetNode);
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

	const setCssParamValue = async (declId: string, value: CssValueData): Promise<void> => {
		const paramNode = getDirectParamNode(graph, liveNode, declId);
		if (!paramNode || paramNode.data.kind !== 'parameter') {
			return;
		}
		await sendSetParamIntent(
			paramNode.node_id,
			{ kind: 'css_value', value: value.value, unit: value.unit },
			paramNode.data.param.event_behaviour
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

	const sendFreeLayoutPreview = async (preview: FreeLayoutPreview): Promise<void> => {
		const compareTo = lastCommittedFreeLayoutPreview ?? currentPlacementPreview();
		const operations: Promise<void>[] = [];
		if (!sameCssValue(preview.position.x, compareTo.position.x)) {
			operations.push(setCssParamValue('position_x', preview.position.x));
		}
		if (!sameCssValue(preview.position.y, compareTo.position.y)) {
			operations.push(setCssParamValue('position_y', preview.position.y));
		}
		if (!sameCssValue(preview.size.width, compareTo.size.width)) {
			operations.push(setCssParamValue('width', preview.size.width));
		}
		if (!sameCssValue(preview.size.height, compareTo.size.height)) {
			operations.push(setCssParamValue('height', preview.size.height));
		}
		if (operations.length === 0) {
			lastCommittedFreeLayoutPreview = cloneFreeLayoutPreview(preview);
			return;
		}
		await Promise.all(operations);
		lastCommittedFreeLayoutPreview = cloneFreeLayoutPreview(preview);
	};

	const flushFreeLayoutCommitQueue = async (): Promise<void> => {
		if (freeLayoutCommitInFlight) {
			return;
		}
		freeLayoutCommitInFlight = true;
		try {
			while (pendingFreeLayoutCommit) {
				const nextPreview = cloneFreeLayoutPreview(pendingFreeLayoutCommit);
				pendingFreeLayoutCommit = null;
				await sendFreeLayoutPreview(nextPreview);
			}
		} finally {
			freeLayoutCommitInFlight = false;
		}
	};

	const scheduleFreeLayoutCommit = (preview: FreeLayoutPreview): void => {
		pendingFreeLayoutCommit = cloneFreeLayoutPreview(preview);
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

	const finalizeFreeLayoutInteraction = async (preview: FreeLayoutPreview | null): Promise<void> => {
		if (preview) {
			scheduleFreeLayoutCommit(preview);
			await flushFreeLayoutCommitQueue();
		}
		await finishFreeLayoutEditSession();
	};

	const beginFreeLayoutMove = (event: PointerEvent): void => {
		if (!editMode || !supportsFreePlacement) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		selectWidgetNode();
		freeLayoutEditSession = createUiEditSession('Move dashboard widget', 'dashboard-free-layout');
		void freeLayoutEditSession.begin();
		const rootRemPx = getRootRemPixels();
		const surfaceMetrics = getClosestSurfaceMetrics(event.currentTarget, rootRemPx);
		lastCommittedFreeLayoutPreview = currentPlacementPreview();
		pendingFreeLayoutCommit = null;
		freeLayoutInteraction = {
			pointerId: event.pointerId,
			mode: 'move',
			resizeEdges: null,
			startClient: [event.clientX, event.clientY],
			startPosition: {
				x: { ...placement.position.x },
				y: { ...placement.position.y }
			},
			startSize: {
				width: { ...placement.size.width },
				height: { ...placement.size.height }
			},
			rootRemPx,
			surfaceWidthPx: surfaceMetrics.width,
			surfaceHeightPx: surfaceMetrics.height,
			surfaceScaleX: surfaceMetrics.scaleX,
			surfaceScaleY: surfaceMetrics.scaleY,
			viewportWidthPx: getViewportWidthPx(),
			viewportHeightPx: getViewportHeightPx()
		};
		freeLayoutPreview = {
			position: {
				x: { ...placement.position.x },
				y: { ...placement.position.y }
			},
			size: {
				width: { ...placement.size.width },
				height: { ...placement.size.height }
			}
		};
	};

	const beginFreeLayoutResize = (
		event: PointerEvent,
		resizeEdges: FreeLayoutResizeEdges
	): void => {
		if (!editMode || !supportsFreePlacement) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		selectWidgetNode();
		freeLayoutEditSession = createUiEditSession('Resize dashboard widget', 'dashboard-free-layout');
		void freeLayoutEditSession.begin();
		const rootRemPx = getRootRemPixels();
		const surfaceMetrics = getClosestSurfaceMetrics(event.currentTarget, rootRemPx);
		lastCommittedFreeLayoutPreview = currentPlacementPreview();
		pendingFreeLayoutCommit = null;
		freeLayoutInteraction = {
			pointerId: event.pointerId,
			mode: 'resize',
			resizeEdges,
			startClient: [event.clientX, event.clientY],
			startPosition: {
				x: { ...placement.position.x },
				y: { ...placement.position.y }
			},
			startSize: {
				width: { ...placement.size.width },
				height: { ...placement.size.height }
			},
			rootRemPx,
			surfaceWidthPx: surfaceMetrics.width,
			surfaceHeightPx: surfaceMetrics.height,
			surfaceScaleX: surfaceMetrics.scaleX,
			surfaceScaleY: surfaceMetrics.scaleY,
			viewportWidthPx: getViewportWidthPx(),
			viewportHeightPx: getViewportHeightPx()
		};
		freeLayoutPreview = {
			position: {
				x: { ...placement.position.x },
				y: { ...placement.position.y }
			},
			size: {
				width: { ...placement.size.width },
				height: { ...placement.size.height }
			}
		};
	};

	const handleWidgetPointerDown = (event: PointerEvent): void => {
		if (!editMode || event.button !== 0) {
			return;
		}
		if (supportsFreePlacement) {
			beginFreeLayoutMove(event);
			return;
		}
		event.stopPropagation();
		selectWidgetNode();
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
			const xContext = createCssUnitContext(freeLayoutInteraction, 'x');
			const yContext = createCssUnitContext(freeLayoutInteraction, 'y');
			const minWidthPx = minFreeWidgetWidthRem * freeLayoutInteraction.rootRemPx;
			const minHeightPx = minFreeWidgetHeightRem * freeLayoutInteraction.rootRemPx;
			const snapPx = parentSnapGrid.enabled ? parentSnapGrid.step * freeLayoutInteraction.rootRemPx : 0;
			if (freeLayoutInteraction.mode === 'move') {
				const nextX = snapToGridPx(
					cssValueToPx(freeLayoutInteraction.startPosition.x, 'x', xContext) + deltaXPx,
					snapPx
				);
				const nextY = snapToGridPx(
					cssValueToPx(freeLayoutInteraction.startPosition.y, 'y', yContext) + deltaYPx,
					snapPx
				);
				freeLayoutPreview = {
					position: {
						x: pxToCssValue(nextX, freeLayoutInteraction.startPosition.x, 'x', xContext),
						y: pxToCssValue(nextY, freeLayoutInteraction.startPosition.y, 'y', yContext)
					},
					size: {
						width: { ...freeLayoutInteraction.startSize.width },
						height: { ...freeLayoutInteraction.startSize.height }
					}
				};
				scheduleFreeLayoutCommit(freeLayoutPreview);
				return;
			}
			const resizeEdges = freeLayoutInteraction.resizeEdges;
			if (!resizeEdges) {
				return;
			}
			let nextPositionPxX = cssValueToPx(freeLayoutInteraction.startPosition.x, 'x', xContext);
			let nextPositionPxY = cssValueToPx(freeLayoutInteraction.startPosition.y, 'y', yContext);
			let nextWidthPx = cssValueToPx(freeLayoutInteraction.startSize.width, 'x', xContext);
			let nextHeightPx = cssValueToPx(freeLayoutInteraction.startSize.height, 'y', yContext);

			if (resizeEdges.left) {
				const appliedDeltaX = Math.min(
					Math.max(deltaXPx, -nextPositionPxX),
					nextWidthPx - minWidthPx
				);
				nextPositionPxX += appliedDeltaX;
				nextWidthPx -= appliedDeltaX;
			}
			if (resizeEdges.right) {
				nextWidthPx = Math.max(minWidthPx, nextWidthPx + deltaXPx);
			}
			if (resizeEdges.top) {
				const appliedDeltaY = Math.min(
					Math.max(deltaYPx, -nextPositionPxY),
					nextHeightPx - minHeightPx
				);
				nextPositionPxY += appliedDeltaY;
				nextHeightPx -= appliedDeltaY;
			}
			if (resizeEdges.bottom) {
				nextHeightPx = Math.max(minHeightPx, nextHeightPx + deltaYPx);
			}
			if (snapPx > 0) {
				nextPositionPxX = snapToGridPx(nextPositionPxX, snapPx);
				nextPositionPxY = snapToGridPx(nextPositionPxY, snapPx);
				nextWidthPx = Math.max(minWidthPx, snapToGridPx(nextWidthPx, snapPx));
				nextHeightPx = Math.max(minHeightPx, snapToGridPx(nextHeightPx, snapPx));
			}
			freeLayoutPreview = {
				position: {
					x: pxToCssValue(nextPositionPxX, freeLayoutInteraction.startPosition.x, 'x', xContext),
					y: pxToCssValue(nextPositionPxY, freeLayoutInteraction.startPosition.y, 'y', yContext)
				},
				size: {
					width: pxToCssValue(nextWidthPx, freeLayoutInteraction.startSize.width, 'x', xContext),
					height: pxToCssValue(nextHeightPx, freeLayoutInteraction.startSize.height, 'y', yContext)
				}
			};
			scheduleFreeLayoutCommit(freeLayoutPreview);
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
								: freeLayoutInteraction.resizeEdges?.left || freeLayoutInteraction.resizeEdges?.right
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

	onDestroy(() => {
		if (typeof window !== 'undefined' && freeLayoutCommitFrame !== null) {
			window.cancelAnimationFrame(freeLayoutCommitFrame);
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
	let supportsStackSizing = $derived(editMode && (parentLayoutKind === 'horizontal' || parentLayoutKind === 'vertical'));
	let supportsOrdering = $derived(editMode && (parentLayoutKind === 'grid' || parentLayoutKind === 'horizontal' || parentLayoutKind === 'vertical'));
	let pageSize = $derived(getDashboardPageSize(graph, liveNode));
	let parentSnapGrid = $derived(getDashboardSnapGrid(graph, parentNode));
	let widgetShellStyle = $derived.by(() => {
		if (!editMode || !supportsFreePlacement || !freeLayoutPreview) {
			return '';
		}
		const context = {
			rootRemPx: getRootRemPixels(),
			surfaceWidthPx: getViewportWidthPx(),
			surfaceHeightPx: getViewportHeightPx(),
			viewportWidthPx: getViewportWidthPx(),
			viewportHeightPx: getViewportHeightPx()
		};
		const deltaX =
			cssValueToPx(freeLayoutPreview.position.x, 'x', createCssUnitContext(context, 'x')) -
			cssValueToPx(placement.position.x, 'x', createCssUnitContext(context, 'x'));
		const deltaY =
			cssValueToPx(freeLayoutPreview.position.y, 'y', createCssUnitContext(context, 'y')) -
			cssValueToPx(placement.position.y, 'y', createCssUnitContext(context, 'y'));
		return `transform: translate(${deltaX}px, ${deltaY}px); inline-size: max(${formatCssValue(freeLayoutPreview.size.width)}, 6.5rem); block-size: max(${formatCssValue(freeLayoutPreview.size.height)}, 2.8rem); z-index: 4;`;
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
			maxExtent = Math.max(
				maxExtent,
				cssValueToPx(childPlacement.position.y, 'y', createCssUnitContext(surfaceContext, 'y')) +
					cssValueToPx(childPlacement.size.height, 'y', createCssUnitContext(surfaceContext, 'y')) +
					cssValueToPx(gap.y, 'y', createCssUnitContext(surfaceContext, 'y')) +
					2 * rootRemPx
			);
		}
		return maxExtent;
	});

	const surfaceStyle = $derived.by((): string => {
		const gapStyle = `--dashboard-gap-x: ${formatCssValue(gap.x)}; --dashboard-gap-y: ${formatCssValue(gap.y)};`;
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
	const pageSizeContext = $derived.by((): Pick<
		FreeLayoutInteraction,
		'rootRemPx' | 'surfaceWidthPx' | 'surfaceHeightPx' | 'viewportWidthPx' | 'viewportHeightPx'
	> => ({
		rootRemPx: getRootRemPixels(),
		surfaceWidthPx: pageViewportWidthPx,
		surfaceHeightPx: pageViewportHeightPx,
		viewportWidthPx: getViewportWidthPx(),
		viewportHeightPx: getViewportHeightPx()
	}));
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
		return Math.min(pageViewportWidthPx / pageLogicalWidthPx, pageViewportHeightPx / pageLogicalHeightPx);
	});
	const pageFrameStyle = $derived.by(() => {
		const baseWidth = pageSize.enabled ? pageLogicalWidthPx * pageFitScale : pageViewportWidthPx;
		const baseHeight = pageSize.enabled ? pageLogicalHeightPx * pageFitScale : pageViewportHeightPx;
		return `inline-size: ${baseWidth}px; block-size: ${baseHeight}px; transform: translate(${pageView.panX}px, ${pageView.panY}px) scale(${pageView.zoom});`;
	});

	const slotStyle = (child: UiNodeDto): string => {
		const childPlacement = getDashboardPlacement(graph, child);
		if (layoutKind === 'free') {
			return `left: ${formatCssValue(childPlacement.position.x)}; top: ${formatCssValue(childPlacement.position.y)}; inline-size: max(${formatCssValue(childPlacement.size.width)}, 6.5rem); block-size: max(${formatCssValue(childPlacement.size.height)}, 2.8rem);`;
		}
		if (layoutKind === 'grid') {
			return `grid-column: span ${childPlacement.columnSpan}; grid-row: span ${childPlacement.rowSpan}; min-block-size: max(${formatCssValue(childPlacement.size.height)}, 3.25rem);`;
		}
		const basis = layoutKind === 'horizontal' ? childPlacement.size.width : childPlacement.size.height;
		if (layoutKind === 'horizontal') {
			return `flex: 1 1 auto; flex-basis: max(${formatCssValue(basis)}, 6.5rem); min-inline-size: max(${formatCssValue(childPlacement.size.width)}, 6.5rem); min-block-size: max(${formatCssValue(childPlacement.size.height)}, 2.8rem);`;
		}
		return `inline-size: 100%; min-block-size: max(${formatCssValue(childPlacement.size.height)}, 2.8rem);`;
	};

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
	let boundParam = $derived(boundParamNode?.data.kind === 'parameter' ? boundParamNode.data.param : null);

	const textConfig = $derived(textParam?.value.kind === 'str' ? textParam.value.value : '');
	const placeholderConfig = $derived(placeholderParam?.value.kind === 'str' ? placeholderParam.value.value : '');
	const valueRange = $derived(
		valueRangeParam?.value.kind === 'vec2' ? valueRangeParam.value.value : [0, 1]
	);
	const sliderStep = $derived(stepParam?.value.kind === 'float' ? stepParam.value.value : 0.01);
	const multiline = $derived(multilineParam?.value.kind === 'bool' ? multilineParam.value.value : false);
	const defaultChecked = $derived(defaultCheckedParam?.value.kind === 'bool' ? defaultCheckedParam.value.value : false);
	const requestedDisplayMode = $derived.by(() => {
		if (displayModeParam?.value.kind === 'enum' || displayModeParam?.value.kind === 'str') {
			return displayModeParam.value.value;
		}
		return 'auto';
	});
	const includeChildren = $derived(includeChildrenParam?.value.kind === 'bool' ? includeChildrenParam.value.value : true);
	const resolvedNodeWidgetDisplayMode = $derived.by(() =>
		boundNode ? resolveDashboardNodeWidgetDisplayMode(boundNode, requestedDisplayMode) : null
	);
	const NodeWidgetDisplayComponent = $derived(resolvedNodeWidgetDisplayMode?.component ?? null);

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
		await sendSetParamIntent(boundParamNode.node_id, value, boundParamNode.data.param.event_behaviour);
	};

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
		if (boundParam.value.kind === 'str' || boundParam.value.kind === 'file' || boundParam.value.kind === 'enum') {
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

	const widgetNodeIdWithinPage = (candidateNodeId: NodeId | null | undefined): NodeId | null => {
		if (!graph || candidateNodeId === null || candidateNodeId === undefined) {
			return null;
		}
		let currentNodeId: NodeId | undefined = candidateNodeId;
		while (currentNodeId !== undefined) {
			const parentId = graph.parentById.get(currentNodeId);
			if (parentId === liveNode.node_id) {
				return currentNodeId;
			}
			currentNodeId = parentId;
		}
		return null;
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
		const selectedWidgetNodeId = widgetNodeIdWithinPage(session?.selectedNodeId);
		if (selectedWidgetNodeId === null) {
			homePageView();
			return true;
		}
		const widgetElement = pageViewportElement.querySelector<HTMLElement>(`[data-node-id="${selectedWidgetNodeId}"]`);
		if (!widgetElement) {
			homePageView();
			return true;
		}
		const viewportRect = pageViewportElement.getBoundingClientRect();
		const widgetRect = widgetElement.getBoundingClientRect();
		const localLeft =
			(widgetRect.left - viewportRect.left - viewportRect.width * 0.5 - pageView.panX) / pageView.zoom;
		const localRight =
			(widgetRect.right - viewportRect.left - viewportRect.width * 0.5 - pageView.panX) / pageView.zoom;
		const localTop =
			(widgetRect.top - viewportRect.top - viewportRect.height * 0.5 - pageView.panY) / pageView.zoom;
		const localBottom =
			(widgetRect.bottom - viewportRect.top - viewportRect.height * 0.5 - pageView.panY) / pageView.zoom;
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
		<div class="dashboard-page-scene">
			<div class="dashboard-page-frame" style={pageFrameStyle}>
				<div
					class="dashboard-surface dashboard-page {layoutKind}"
					class:surface-target-active={surfaceDragDepth > 0}
					class:edit-bleed-visible={editMode && pageSize.enabled}
					role="region"
					aria-label="Dashboard page surface"
					style={surfaceStyle}
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
								{@const activeChild = childWidgets.find((candidate) => candidate.node_id === activeTabNodeId) ?? null}
								{#if activeChild}
									<div class="dashboard-slot"><div class="dashboard-slot-fill"><DashboardCanvasSelf node={activeChild} {editMode} /></div></div>
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
										<div class="dashboard-slot accordion-slot"><div class="dashboard-slot-fill"><DashboardCanvasSelf node={child} {editMode} /></div></div>
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
						</div>
					{/if}

					{#if childWidgets.length === 0}
						<div class="dashboard-empty-state">
							<span class="eyebrow">Dashboard Page</span>
							<h3>Drop a node or parameter here</h3>
							<p>Outliner drags create node widgets. Inspector parameter-label drags create generic widgets.</p>
						</div>
					{/if}

					{#if surfaceDragDepth > 0}
						<div class="dashboard-drop-indicator">Drop to create a widget</div>
					{/if}
				</div>
			</div>
			{#if editMode && pageSize.enabled}
				<div class="dashboard-page-visibility-overlay" style={pageFrameStyle} aria-hidden="true"></div>
			{/if}
		</div>
	</div>
	{:else if isContainerWidget}
	<section
		class="dashboard-widget-shell dashboard-container"
		class:selected={isSelected}
		class:free-layout-active={freeLayoutInteraction !== null}
		class:editable-free={supportsFreePlacement}
		data-node-id={liveNode.node_id}
		style={widgetShellStyle}
		role="button"
		tabindex={editMode ? 0 : -1}
		onpointerdown={handleWidgetPointerDown}
		onclick={selectWidgetNode}
		onkeydown={selectWidgetNodeFromKeyboard}>
		{#if editMode && supportsFreePlacement}
			{#each freeLayoutResizeZones as resizeZone}
				<div
					class="dashboard-resize-zone {resizeZone.name}"
					aria-hidden="true"
					onpointerdown={(event) => {
						beginFreeLayoutResize(event, resizeZone.edges);
					}}></div>
			{/each}
		{/if}
		<div
			class="dashboard-surface dashboard-container-surface {layoutKind}"
			class:surface-target-active={surfaceDragDepth > 0}
			role="group"
			aria-label="Dashboard container surface"
			style={surfaceStyle}
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
						{@const activeChild = childWidgets.find((candidate) => candidate.node_id === activeTabNodeId) ?? null}
						{#if activeChild}
							<div class="dashboard-slot"><div class="dashboard-slot-fill"><DashboardCanvasSelf node={activeChild} {editMode} /></div></div>
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
								<div class="dashboard-slot accordion-slot"><div class="dashboard-slot-fill"><DashboardCanvasSelf node={child} {editMode} /></div></div>
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
				</div>
			{/if}

			{#if childWidgets.length === 0}
				<div class="dashboard-empty-inline">Drop widgets here or use the add menu.</div>
			{/if}

			{#if surfaceDragDepth > 0}
				<div class="dashboard-drop-indicator">Drop to add a child widget</div>
			{/if}
		</div>
	</section>
{:else if isNodeWidget}
	<section
		class="dashboard-widget-shell dashboard-node-widget"
		class:selected={isSelected}
		class:binding-active={bindingDragDepth > 0}
		class:free-layout-active={freeLayoutInteraction !== null}
		class:editable-free={supportsFreePlacement}
		data-node-id={liveNode.node_id}
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
		onclick={selectWidgetNode}
		onkeydown={selectWidgetNodeFromKeyboard}>
		{#if editMode && supportsFreePlacement}
			{#each freeLayoutResizeZones as resizeZone}
				<div
					class="dashboard-resize-zone {resizeZone.name}"
					aria-hidden="true"
					onpointerdown={(event) => {
						beginFreeLayoutResize(event, resizeZone.edges);
					}}></div>
			{/each}
		{/if}
		<div class="dashboard-widget-content inspector-body">
			{#if boundNode}
				<div class="dashboard-live-content" class:inert-mode={editMode} inert={editMode}>
					{#if NodeWidgetDisplayComponent}
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
		data-node-id={liveNode.node_id}
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
		onclick={selectWidgetNode}
		onkeydown={selectWidgetNodeFromKeyboard}>
		{#if editMode && supportsFreePlacement}
			{#each freeLayoutResizeZones as resizeZone}
				<div
					class="dashboard-resize-zone {resizeZone.name}"
					aria-hidden="true"
					onpointerdown={(event) => {
						beginFreeLayoutResize(event, resizeZone.edges);
					}}></div>
			{/each}
		{/if}
		<div class="dashboard-widget-content generic-body">
			<div class="dashboard-live-content" class:inert-mode={editMode} inert={editMode}>
			{#if widgetKind === 'button'}
				<button type="button" class="generic-button" onclick={() => {
					void triggerGenericAction();
				}} disabled={editMode}>{textConfig || boundParamNode?.meta.label || 'Trigger'}</button>
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
						disabled={editMode || !boundParam || (boundParam.value.kind !== 'float' && boundParam.value.kind !== 'int')}
						oninput={(event) => {
							void applySliderValue((event.target as HTMLInputElement).value);
						}} />
					<div class="generic-readout">{boundParam ? formatParamValue(boundParam.value) : 'Unbound'}</div>
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
						disabled={
							editMode ||
							!boundParam ||
							(boundParam.value.kind !== 'str' && boundParam.value.kind !== 'file' && boundParam.value.kind !== 'enum' && boundParam.value.kind !== 'css_value')
						}
						onchange={(event) => {
							void applyStringValue((event.target as HTMLTextAreaElement).value);
						}}>{boundParam ? boundParam.value.kind === 'css_value' ? formatCssValue(boundParam.value) : boundParam.value.kind === 'str' || boundParam.value.kind === 'file' || boundParam.value.kind === 'enum' ? boundParam.value.value : textConfig : textConfig}</textarea>
				{:else}
					<input
						type="text"
						value={boundParam ? boundParam.value.kind === 'css_value' ? formatCssValue(boundParam.value) : boundParam.value.kind === 'str' || boundParam.value.kind === 'file' || boundParam.value.kind === 'enum' ? boundParam.value.value : textConfig : textConfig}
						placeholder={placeholderConfig}
						disabled={
							editMode ||
							!boundParam ||
							(boundParam.value.kind !== 'str' && boundParam.value.kind !== 'file' && boundParam.value.kind !== 'enum' && boundParam.value.kind !== 'css_value')
						}
						onchange={(event) => {
							void applyStringValue((event.target as HTMLInputElement).value);
						}} />
				{/if}
			{:else}
				<div class="generic-text-display">{genericDisplayValue || 'Drop a parameter or set static text.'}</div>
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
		border-radius: 0.9rem;
		background:
			radial-gradient(circle at top right, rgb(from var(--gc-color-selection) r g b / 0.08), transparent 42%),
			linear-gradient(180deg, rgb(from var(--gc-color-panel-outline) r g b / 0.2), transparent 38%),
			var(--gc-color-panel);
		border: solid 0.06rem rgb(from var(--gc-color-panel-outline) r g b / 0.55);
		overflow: hidden;
	}

	.dashboard-page.edit-bleed-visible,
	.dashboard-page.edit-bleed-visible .dashboard-layout {
		overflow: visible;
	}

	.dashboard-page {
		min-block-size: 100%;
		padding: 0.55rem;
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

	.dashboard-page-scene {
		position: relative;
		display: grid;
		place-items: center;
		inline-size: 100%;
		block-size: 100%;
		min-block-size: 0;
		overflow: hidden;
		padding: 0.2rem;
	}

	.dashboard-page-frame {
		position: relative;
		grid-area: 1 / 1;
		flex: 0 0 auto;
		overflow: visible;
		transform-origin: center center;
		transition: box-shadow 120ms ease;
	}

	.dashboard-page-visibility-overlay {
		grid-area: 1 / 1;
		position: relative;
		pointer-events: none;
		border-radius: 0.9rem;
		box-shadow: 0 0 0 100vmax rgb(from var(--gc-color-background) r g b / 0.42);
		border: solid 0.06rem rgb(from var(--gc-color-selection) r g b / 0.26);
		transform-origin: center center;
		z-index: 2;
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
		gap: var(--dashboard-gap-y) var(--dashboard-gap-x);
	}

	.dashboard-surface.horizontal .dashboard-layout {
		flex-direction: row;
		flex-wrap: wrap;
		align-items: stretch;
	}

	.dashboard-surface.vertical .dashboard-layout {
		flex-direction: column;
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

	.dashboard-surface.vertical .dashboard-slot,
	.dashboard-surface.grid .dashboard-slot,
	.dashboard-accordion .dashboard-slot {
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
		border-radius: 0.8rem;
		background:
			linear-gradient(180deg, rgb(from var(--gc-color-header) r g b / 0.52), rgb(from var(--gc-color-panel) r g b / 0.94));
		border: solid 0.06rem rgb(from var(--gc-color-panel-outline) r g b / 0.55);
		box-shadow: 0 0.35rem 0.9rem rgb(from var(--gc-color-background) r g b / 0.22);
		overflow: hidden;
		transition:
			border-color 120ms ease,
			box-shadow 120ms ease,
			background 120ms ease;
	}

	.dashboard-widget-shell.editable-free {
		cursor: grab;
	}

	.dashboard-widget-shell.editable-free.free-layout-active {
		cursor: grabbing;
	}

	.dashboard-widget-shell:hover {
		border-color: rgb(from var(--gc-color-panel-outline) r g b / 0.82);
	}

	.dashboard-widget-shell.selected {
		border-color: rgb(from var(--gc-color-selection) r g b / 0.8);
		box-shadow:
			0 0 0 0.08rem rgb(from var(--gc-color-selection) r g b / 0.35),
			0 0.45rem 1rem rgb(from var(--gc-color-selection) r g b / 0.14);
	}

	.dashboard-widget-shell.binding-active {
		border-color: rgb(from var(--gc-color-focus) r g b / 0.84);
		box-shadow: 0 0 0 0.08rem rgb(from var(--gc-color-focus) r g b / 0.28);
	}

	.dashboard-widget-shell.free-layout-active {
		box-shadow:
			0 0 0 0.08rem rgb(from var(--gc-color-focus) r g b / 0.34),
			0 0.75rem 1.5rem rgb(from var(--gc-color-background) r g b / 0.28);
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
		overflow: auto;
	}

	.dashboard-live-content {
		position: relative;
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
		padding: 0.35rem;
		border: none;
		background: transparent;
		box-shadow: none;
		min-block-size: 4rem;
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
			linear-gradient(135deg, rgb(from var(--gc-color-selection) r g b / 0.32), rgb(from var(--gc-color-binding) r g b / 0.18)),
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