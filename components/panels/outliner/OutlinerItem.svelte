<script lang="ts">
	import { untrack } from 'svelte';
	import { appState } from '$lib/golden_ui/store/workbench.svelte';
	import type { NodeId, UiNodeDto } from '$lib/golden_ui/types';
	import Self from './OutlinerItem.svelte';
	import { getContainerColorForNode, getIconURLForNode } from '$lib/golden_ui/store/node-types';
	import { slide } from 'svelte/transition';
	import NodeWarningBadge from '$lib/golden_ui/components/common/NodeWarningBadge.svelte';
	import EnableButton from '../../common/EnableButton.svelte';
	import { beginDashboardNodeDrag } from '../dashboard/dashboard-drag';

	const EMPTY_AUTO_EXPAND_ANCESTORS: ReadonlySet<NodeId> = new Set<NodeId>();

	let {
		node,
		level = 0,
		maxLevels = undefined,
		mode = 'outliner',
		initiallyExpandedDepth = 5,
		transitionDurationMs = 150,
		focusedNodeId = null,
		autoExpandAncestorNodeIds = EMPTY_AUTO_EXPAND_ANCESTORS,
		nodeFilter = (_candidate: UiNodeDto) => true,
		nodeSelectable = (_candidate: UiNodeDto) => true,
		onSelectNode = null
	} = $props<{
		node: UiNodeDto | null;
		level?: number;
		maxLevels?: number;
		mode?: 'outliner' | 'tree';
		initiallyExpandedDepth?: number;
		transitionDurationMs?: number;
		focusedNodeId?: number | null;
		autoExpandAncestorNodeIds?: ReadonlySet<NodeId>;
		nodeFilter?: (candidate: UiNodeDto) => boolean;
		nodeSelectable?: (candidate: UiNodeDto) => boolean;
		onSelectNode?: ((next: UiNodeDto, event: MouseEvent) => void) | null;
	}>();

	let session = $derived(appState.session);
	let mainGraphState = $derived(session?.graph.state ?? null);
	let meta = $derived(node?.meta ?? null);
	let isOutlinerMode = $derived(mode === 'outliner');
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

	let isExpanded = $state(false);
	let didInitExpanded = $state(false);

	$effect.pre(() => {
		if (didInitExpanded) {
			return;
		}
		const shouldAutoExpandToTarget = node !== null && autoExpandAncestorNodeIds.has(node.node_id);
		isExpanded = level < initiallyExpandedDepth || shouldAutoExpandToTarget;
		didInitExpanded = true;
	});

	$effect(() => {
		if (node === null || !autoExpandAncestorNodeIds.has(node.node_id)) {
			return;
		}
		isExpanded = true;
	});

	let isSelected = $derived(session?.isNodeSelected(node?.node_id ?? -1) ?? false);
	let hasArrow = $derived(Boolean(node?.children && node.children.length > 0));
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
	let isCurrentReference = $derived(
		focusedNodeId !== null && node !== null && node.node_id === focusedNodeId
	);
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
	<div class="outliner-item">
		{#if showRow}
			<div
				class="outliner-item-content"
				role="group"
				class:selected={!onSelectNode && isSelected}
				class:has-arrow={hasArrow}
				class:current-reference={isCurrentReference}
				data-node-id={node.node_id}
				class:non-selectable={!rowSelectable}
				style="--node-accent-color: {accentColor}"
				onpointerenter={handlePointerEnter}
				onpointerleave={handlePointerLeave}>
				{#if hasArrow}
					<div
						class="outliner-expand arrow {isExpanded ? 'down' : ''}"
						aria-hidden="true"
						onclick={() => (isExpanded = !isExpanded)}>
					</div>
				{/if}
				<img class="outliner-item-icon" src={iconURL} alt="" aria-hidden="true" />
				{#if isOutlinerMode && meta?.can_be_disabled}
					<EnableButton {node} />
				{/if}
				<button
					class="outliner-item-label"
					class:non-selectable={!rowSelectable}
					draggable={rowSelectable && isOutlinerMode}
					type="button"
					disabled={!rowSelectable}
					ondragstart={(event) => {
						beginDashboardNodeDrag(event, node);
					}}
					onclick={(event) => selectNode(node, event)}>{meta?.label ?? ''}</button>
				{#if isOutlinerMode}
					<NodeWarningBadge {warnings} />
				{/if}
				<span class="outliner-item-spacer"></span>
				{#if isOutlinerMode}
					<span class="outliner-item-type">{node.node_type}</span>
				{/if}
			</div>
		{/if}

		{#if isExpanded && hasArrow && (maxLevels == undefined || level < maxLevels)}
			<div class="outliner-children" transition:slide|local={{ duration: transitionDurationMs }}>
				{#each node.children as child}
					<Self
						node={mainGraphState?.nodesById.get(child) ?? null}
						level={level + 1}
						{maxLevels}
						{mode}
						{initiallyExpandedDepth}
						{transitionDurationMs}
						{focusedNodeId}
						{autoExpandAncestorNodeIds}
						{nodeFilter}
						{nodeSelectable}
						{onSelectNode} />
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
		padding: 0.05rem 0 0.05rem 0.25rem;
		gap: 0.25rem;
		border-left: solid 0.1rem rgba(from var(--node-accent-color) r g b / 0.45);
		border-radius: 0.3rem;
	}

	.outliner-item-content.non-selectable {
		opacity: 0.55;
	}

	.outliner-item-content.current-reference .outliner-item-label {
		outline: solid 0.08rem color-mix(in srgb, var(--gc-color-selection) 82%, white 18%);
		background-color: color-mix(in srgb, var(--gc-color-selection) 16%, transparent);
		border-radius: 0.3rem;
	}

	.outliner-item-content.has-arrow {
		margin-left: -0.5rem;
	}

	.outliner-expand {
		width: 1rem;
		height: 1rem;
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
		cursor: grab;
		outline: solid 1px transparent;
		border-radius: 0.3rem;
		transition:
			background-color 0.1s ease,
			outline 0.1s ease;
	}

	.outliner-item-label.non-selectable {
		cursor: default;
	}

	.outliner-item-label:active {
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
		border-left: 0.025rem dashed var(--gc-color-outliner-border);
	}
</style>
