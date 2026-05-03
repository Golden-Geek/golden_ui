<script lang="ts">
	import { untrack, type Component } from 'svelte';
	import { appState } from '../../../store/workbench.svelte';
	import type { NodeId, UiNodeDto } from '../../../types';
	import Self from './OutlinerItem.svelte';
	import { getContainerColorForNode, getIconURLForNode } from '../../../store/node-types';
	import { slide } from 'svelte/transition';
	import NodeWarningBadge from '../../common/NodeWarningBadge.svelte';
	import EnableButton from '../../common/EnableButton.svelte';
	import { beginDashboardNodeDrag, beginDashboardParameterDrag } from '../dashboard/dashboard-drag';
	import Arrow from '../../common/Arrow.svelte';
	import type { OutlinerDropTarget } from './drag-drop';
	import { resolveOutlinerRowSupplement } from './outliner-row-registry';

	const EMPTY_AUTO_EXPAND_ANCESTORS: ReadonlySet<NodeId> = new Set<NodeId>();

	let {
		node,
		level = 0,
		maxLevels = undefined,
		mode = 'outliner',
		rowSupplementComponent: RowSupplementComponent = null,
		canRenderNodeChildren = (_candidate: UiNodeDto) => true,
		initiallyExpandedDepth = 5,
		transitionDurationMs = 150,
		focusedNodeId = null,
		autoExpandAncestorNodeIds = EMPTY_AUTO_EXPAND_ANCESTORS,
		opennessByNodeId = null,
		nodeFilter = (_candidate: UiNodeDto) => true,
		nodeSelectable = (_candidate: UiNodeDto) => true,
		nodeDraggable = (_candidate: UiNodeDto) => false,
		activeDragNodeId = null,
		dropTarget = null,
		onNodeOpennessChange = null,
		onSelectNode = null,
		onNodeDragStart = null,
		onNodeDragOver = null,
		onNodeDrop = null,
		onNodeDragEnd = null
	} = $props<{
		node: UiNodeDto | null;
		level?: number;
		maxLevels?: number;
		mode?: 'outliner' | 'tree';
		rowSupplementComponent?: Component<{ node: UiNodeDto }> | null;
		canRenderNodeChildren?: (candidate: UiNodeDto) => boolean;
		initiallyExpandedDepth?: number;
		transitionDurationMs?: number;
		focusedNodeId?: number | null;
		autoExpandAncestorNodeIds?: ReadonlySet<NodeId>;
		opennessByNodeId?: Readonly<Record<string, boolean>> | null;
		nodeFilter?: (candidate: UiNodeDto) => boolean;
		nodeSelectable?: (candidate: UiNodeDto) => boolean;
		nodeDraggable?: (candidate: UiNodeDto) => boolean;
		activeDragNodeId?: NodeId | null;
		dropTarget?: OutlinerDropTarget | null;
		onNodeOpennessChange?: ((nodeId: NodeId, expanded: boolean) => void) | null;
		onSelectNode?: ((next: UiNodeDto, event: MouseEvent) => void) | null;
		onNodeDragStart?: ((node: UiNodeDto, event: DragEvent) => void) | null;
		onNodeDragOver?: ((node: UiNodeDto, event: DragEvent) => void) | null;
		onNodeDrop?: ((node: UiNodeDto, event: DragEvent) => void | Promise<void>) | null;
		onNodeDragEnd?: ((node: UiNodeDto, event: DragEvent) => void) | null;
	}>();

	let session = $derived(appState.session);
	let mainGraphState = $derived(session?.graph.state ?? null);
	let meta = $derived(node?.meta ?? null);
	let isOutlinerMode = $derived(mode === 'outliner');
	let ResolvedRowSupplementComponent = $derived(
		RowSupplementComponent ?? resolveOutlinerRowSupplement(node)?.component ?? null
	);
	let iconURL = $derived(getIconURLForNode(node));
	let accentColor = $derived(node ? getContainerColorForNode(node) : 'rgba(124, 138, 162, 1)');

	const selectNode = (next: UiNodeDto, event: MouseEvent): void => {
		if (!nodeSelectable(next)) {
			return;
		}
		if (onSelectNode) {
			onSelectNode(next, event);
			return;
		}
		session?.selectNode(
			next.node_id,
			event.ctrlKey || event.metaKey
				? 'TOGGLE'
				: event.shiftKey
					? 'ADD'
					: event.altKey
						? 'REMOVE'
						: 'REPLACE'
		);
	};

	const defaultExpandedForNode = (candidate: UiNodeDto | null): boolean => {
		if (candidate === null) {
			return false;
		}
		return level < initiallyExpandedDepth || autoExpandAncestorNodeIds.has(candidate.node_id);
	};

	const explicitExpandedForNode = (candidate: UiNodeDto | null): boolean | null => {
		if (candidate === null || opennessByNodeId === null) {
			return null;
		}
		const expanded = opennessByNodeId[String(candidate.node_id)];
		return typeof expanded === 'boolean' ? expanded : null;
	};

	let localIsExpanded = $state(false);
	let localExpansionNodeId = $state<NodeId | null>(null);

	$effect.pre(() => {
		if (opennessByNodeId !== null) {
			return;
		}
		const nodeId = node?.node_id ?? null;
		if (nodeId === null) {
			localIsExpanded = false;
			localExpansionNodeId = null;
			return;
		}
		if (localExpansionNodeId === nodeId) {
			return;
		}
		localIsExpanded = defaultExpandedForNode(node);
		localExpansionNodeId = nodeId;
	});

	const setExpanded = (nextExpanded: boolean): void => {
		if (node === null) {
			return;
		}
		if (opennessByNodeId !== null) {
			if (explicitExpandedForNode(node) === nextExpanded) {
				return;
			}
			onNodeOpennessChange?.(node.node_id, nextExpanded);
			return;
		}
		localIsExpanded = nextExpanded;
	};

	let isExpanded = $derived.by(() => {
		const explicitExpanded = explicitExpandedForNode(node);
		if (explicitExpanded !== null) {
			return explicitExpanded;
		}
		if (opennessByNodeId !== null) {
			return defaultExpandedForNode(node);
		}
		return localIsExpanded;
	});

	$effect(() => {
		if (node === null || !autoExpandAncestorNodeIds.has(node.node_id)) {
			return;
		}
		if (opennessByNodeId !== null) {
			if (explicitExpandedForNode(node) === true) {
				return;
			}
			setExpanded(true);
			return;
		}
		if (localIsExpanded) {
			return;
		}
		setExpanded(true);
	});

	let isSelected = $derived(session?.isNodeSelected(node?.node_id ?? -1) ?? false);
	let hasChildren = $derived(Boolean(node?.children && node.children.length > 0));
	let canRenderChildren = $derived(
		hasChildren &&
			node !== null &&
			canRenderNodeChildren(node) &&
			(maxLevels === undefined || level < maxLevels)
	);
	let hasArrow = $derived(canRenderChildren);
	let canHaveVisibleWarnings = $derived.by((): boolean => {
		if (!node) {
			return false;
		}
		const presentation = node.meta.presentation;
		if (!presentation) {
			return false;
		}
		if (Array.isArray(presentation.warnings) && presentation.warnings.length > 0) {
			return true;
		}
		return Number(presentation.show_child_warnings_max_depth ?? 0) > 0;
	});
	let warnings = $derived(
		node && canHaveVisibleWarnings ? (session?.getNodeVisibleWarnings(node.node_id) ?? []) : []
	);

	const passesFilter = (candidate: UiNodeDto | null): boolean => {
		if (!candidate) {
			return false;
		}
		return nodeFilter(candidate);
	};

	const isSelectable = (candidate: UiNodeDto | null): boolean => {
		if (!candidate) {
			return false;
		}
		return nodeSelectable(candidate);
	};

	const subtreeHasVisibleNode = (candidate: UiNodeDto | null): boolean => {
		if (!candidate) {
			return false;
		}
		if (passesFilter(candidate)) {
			return true;
		}
		for (const childId of candidate.children ?? []) {
			const childNode = mainGraphState?.nodesById.get(childId) ?? null;
			if (subtreeHasVisibleNode(childNode)) {
				return true;
			}
		}
		return false;
	};

	let isVisible = $derived(subtreeHasVisibleNode(node));
	let showRow = $derived(node !== null);
	let rowSelectable = $derived(isSelectable(node));
	let rowMoveDraggable = $derived(Boolean(node && isOutlinerMode && nodeDraggable(node)));
	let rowDashboardDraggable = $derived(
		Boolean(node && isOutlinerMode && mainGraphState?.rootId !== node.node_id)
	);
	let rowDraggable = $derived(rowMoveDraggable || rowDashboardDraggable);
	let isCurrentReference = $derived(
		focusedNodeId !== null && node !== null && node.node_id === focusedNodeId
	);
	let isDragSource = $derived(Boolean(node && activeDragNodeId === node.node_id));
	let activeDropZone = $derived.by(() => {
		if (!node || dropTarget?.hoverNodeId !== node.node_id) {
			return null;
		}
		return dropTarget.zone;
	});
	const footerHoverToken = Symbol('outliner-item-footer-hover');
	let rowHovered = $state(false);

	const handlePointerEnter = (): void => {
		rowHovered = true;
	};

	const handlePointerLeave = (): void => {
		rowHovered = false;
	};

	$effect(() => {
		if (!rowHovered || !node) {
			untrack(() => {
				session?.clearFooterHover(footerHoverToken);
			});
			return;
		}
		untrack(() => {
			session?.setFooterHover(footerHoverToken, node.node_id);
		});
		return () => {
			untrack(() => {
				session?.clearFooterHover(footerHoverToken);
			});
		};
	});
</script>

{#if node && isVisible}
	<div class="outliner-item" style="--node-accent-color: {accentColor}">
		{#if showRow}
			<div
				class="outliner-item-content"
				role="group"
				class:selected={!onSelectNode && isSelected}
				class:has-arrow={hasArrow}
				class:current-reference={isCurrentReference}
				class:drag-source={isDragSource}
				class:drop-before={activeDropZone === 'before'}
				class:drop-inside={activeDropZone === 'inside'}
				class:drop-after={activeDropZone === 'after'}
				data-node-id={node.node_id}
				class:non-selectable={!rowSelectable}
				onpointerenter={handlePointerEnter}
				onpointerleave={handlePointerLeave}
				ondragover={(event) => {
					onNodeDragOver?.(node, event);
				}}
				ondrop={(event) => {
					void onNodeDrop?.(node, event);
				}}>
				{#if hasArrow}
					<div aria-hidden="true" onclick={() => setExpanded(!isExpanded)}>
						<Arrow direction={isExpanded ? 'down' : 'right'} color={accentColor} />
					</div>
				{/if}
				{#if meta?.can_be_disabled}
					<EnableButton {node} />
				{/if}
				<img class="outliner-item-icon" src={iconURL} alt="" aria-hidden="true" />

				<button
					class="outliner-item-label"
					class:draggable={rowDraggable}
					class:non-selectable={!rowSelectable}
					draggable={rowDraggable}
					type="button"
					disabled={!rowSelectable}
					ondragstart={(event) => {
						if (node.data.kind === 'parameter') {
							beginDashboardParameterDrag(event, node);
						} else {
							beginDashboardNodeDrag(event, node);
						}
						if (rowMoveDraggable) {
							onNodeDragStart?.(node, event);
						}
					}}
					ondragend={(event) => {
						if (rowMoveDraggable) {
							onNodeDragEnd?.(node, event);
						}
					}}
					onclick={(event) => selectNode(node, event)}>{meta?.label ?? ''}</button>
				{#if isOutlinerMode}
					<NodeWarningBadge {warnings} />
				{/if}

				{#if ResolvedRowSupplementComponent}
					<ResolvedRowSupplementComponent {node} />
				{:else}
					<span class="outliner-item-spacer"></span>
				{/if}

				{#if isOutlinerMode}
					<span class="outliner-item-type">{node.node_type}</span>
				{/if}
			</div>
		{/if}

		{#if isExpanded && canRenderChildren}
			<div class="outliner-children" transition:slide|local={{ duration: transitionDurationMs }}>
				{#each node.children as child (child)}
					<Self
						node={mainGraphState?.nodesById.get(child) ?? null}
						level={level + 1}
						{maxLevels}
						{mode}
						rowSupplementComponent={RowSupplementComponent}
						{canRenderNodeChildren}
						{initiallyExpandedDepth}
						{transitionDurationMs}
						{focusedNodeId}
						{autoExpandAncestorNodeIds}
						{opennessByNodeId}
						{nodeFilter}
						{nodeSelectable}
						{nodeDraggable}
						{activeDragNodeId}
						{dropTarget}
						{onNodeOpennessChange}
						{onSelectNode}
						{onNodeDragStart}
						{onNodeDragOver}
						{onNodeDrop}
						{onNodeDragEnd} />
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	.outliner-item {
		padding-left: 0rem;
		/* padding-top: 0.25rem; */
		font-size: 0.8rem;
		width: 100%;
	}

	.outliner-item-content {
		display: flex;
		align-items: center;
		padding: 0.05rem 0 0.05rem 0.05rem;
		gap: 0.25rem;
		position: relative;
		border-radius: 0.35rem;
	}

	.outliner-item-content.non-selectable {
		opacity: 0.55;
	}

	.outliner-item-content.current-reference .outliner-item-label {
		outline: solid 0.08rem color-mix(in srgb, var(--gc-color-selection) 82%, white 18%);
		background-color: color-mix(in srgb, var(--gc-color-selection) 16%, transparent);
		border-radius: 0.3rem;
	}

	.outliner-item-content.drag-source {
		opacity: 0.55;
	}

	.outliner-item-content.drop-inside {
		background-color: rgb(from var(--gc-color-selection) r g b / 0.12);
		outline: solid 0.08rem rgb(from var(--gc-color-selection) r g b / 0.55);
	}

	.outliner-item-content.drop-before::before,
	.outliner-item-content.drop-after::after {
		content: '';
		position: absolute;
		inset-inline: 0;
		border-block-start: solid 0.12rem rgb(from var(--gc-color-selection) r g b / 0.88);
		pointer-events: none;
	}

	.outliner-item-content.drop-before::before {
		inset-block-start: -0.08rem;
	}

	.outliner-item-content.drop-after::after {
		inset-block-end: -0.08rem;
	}

	.outliner-item-content.has-arrow {
		margin-left: -0.5rem;
	}

	.outliner-item-content:not(.has-arrow) {
		border-left: solid 0.1rem rgba(from var(--node-accent-color) r g b / 0.45);
		border-radius: 0.3rem;
		padding-left: 0.6rem;
	}

	.outliner-item-icon {
		display: block;
		width: 1.2rem;
		height: 1.2rem;
		flex: 0 0 auto;
		filter: drop-shadow(0 0 0.2rem rgba(from var(--node-accent-color) r g b / 0.28));
	}

	.outliner-item-label {
		color: var(--gc-color-text);
		background: transparent;
		border: none;
		padding: 0.1rem 0.2rem;
		margin: 0;
		font: inherit;
		text-align: left;
		cursor: pointer;
		outline: solid 1px transparent;
		border-radius: 0.3rem;
		transition:
			background-color 0.1s ease,
			outline 0.1s ease;
	}

	.outliner-item-label.draggable {
		cursor: grab;
	}

	.outliner-item-label.non-selectable {
		cursor: default;
	}

	.outliner-item-label.draggable:active {
		cursor: grabbing;
	}

	.outliner-item-label:hover {
		background-color: rgba(200, 200, 200, 0.15);
	}

	.selected .outliner-item-label {
		background-color: rgba(from var(--gc-color-selection) r g b / 0.2);
		outline: solid 1px rgba(from var(--gc-color-selection) r g b / 0.6);
		border-radius: 0.3rem;
	}

	.outliner-item-type {
		opacity: 0.6;
	}

	.outliner-item-spacer {
		flex: 1 1 auto;
	}

	.outliner-children {
		padding-left: 0.7rem;
		border-left: 0.025rem dashed var(--node-accent-color);
	}
</style>
