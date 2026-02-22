<script lang="ts">
	import { appState } from '$lib/golden_ui/store/workbench.svelte';
	import type { UiNodeDto } from '$lib/golden_ui/types';
	import Self from './OutlinerItem.svelte';
	import { getIconURLForNode } from '$lib/golden_ui/store/node-types';
	import { slide } from 'svelte/transition';
	import NodeWarningBadge from '$lib/golden_ui/components/common/NodeWarningBadge.svelte';
	import EnableButton from '../../common/EnableButton.svelte';

	let {
		node,
		level = 0,
		maxLevels = undefined,
		mode = 'outliner',
		initiallyExpandedDepth = 5,
		transitionDurationMs = 150,
		focusedNodeId = null,
		autoExpandToNodeId = null,
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
		autoExpandToNodeId?: number | null;
		nodeFilter?: (candidate: UiNodeDto) => boolean;
		nodeSelectable?: (candidate: UiNodeDto) => boolean;
		onSelectNode?: ((next: UiNodeDto, event: MouseEvent) => void) | null;
	}>();

	let session = $derived(appState.session);
	let mainGraphState = $derived(session?.graph.state ?? null);
	let meta = $derived(node?.meta ?? null);
	let isOutlinerMode = $derived(mode === 'outliner');
	let iconURL = $derived(getIconURLForNode(node));

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

	const subtreeContainsNodeId = (candidate: UiNodeDto | null, targetNodeId: number): boolean => {
		if (!candidate) {
			return false;
		}
		if (candidate.node_id === targetNodeId) {
			return true;
		}
		for (const childId of candidate.children ?? []) {
			const childNode = mainGraphState?.nodesById.get(childId) ?? null;
			if (subtreeContainsNodeId(childNode, targetNodeId)) {
				return true;
			}
		}
		return false;
	};

	let isExpanded = $state(false);
	let didInitExpanded = $state(false);

	$effect.pre(() => {
		if (didInitExpanded) {
			return;
		}
		const shouldAutoExpandToTarget =
			autoExpandToNodeId !== null &&
			node !== null &&
			node.node_id !== autoExpandToNodeId &&
			subtreeContainsNodeId(node, autoExpandToNodeId);
		isExpanded = level < initiallyExpandedDepth || shouldAutoExpandToTarget;
		didInitExpanded = true;
	});

	let isSelected = $derived(session?.isNodeSelected(node?.node_id ?? -1) ?? false);
	let hasArrow = $derived(Boolean(node?.children && node.children.length > 0));
	let warnings = $derived(node ? session?.getNodeVisibleWarnings(node.node_id) ?? [] : []);

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
</script>

{#if node && isVisible}
	<div class="outliner-item">
		{#if showRow}
			<div
				class="outliner-item-content"
				class:selected={!onSelectNode && isSelected}
				class:has-arrow={hasArrow}
				class:current-reference={isCurrentReference}
				data-node-id={node.node_id}
				class:non-selectable={!rowSelectable}>
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
					type="button"
					disabled={!rowSelectable}
					onclick={(event) => selectNode(node, event)}
					>{meta?.label ?? ''}</button>
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
						{autoExpandToNodeId}
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
		padding-top: 0.25rem;
		font-size: 0.8rem;
		width: 100%;
	}

	.outliner-item-content {
		display: flex;
		align-items: center;
		gap: 0.25rem;
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
		transition:
			background-color 0.1s ease,
			outline 0.1s ease;
	}

	.outliner-item-label.non-selectable {
		cursor: default;
	}

	.outliner-item-label:hover {
		background-color: rgba(200, 200, 200, 0.2);
		border-radius: 0.3rem;
	}

	.selected .outliner-item-label {
		background-color: rgba(200, 200, 200, 0.2);
		outline: solid 1px var(--gc-color-selection);
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
