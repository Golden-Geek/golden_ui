<script lang="ts">
	import { appState } from '$lib/golden_ui/store/workbench.svelte';
	import type { UiNodeDto } from '$lib/golden_ui/types';
	import Self from './OutlinerItem.svelte';
	import { getIconURLForNode } from '$lib/golden_ui/store/node-types';
	import { slide } from 'svelte/transition';
	import NodeWarningBadge from '$lib/golden_ui/components/common/NodeWarningBadge.svelte';

	let {
		node,
		level = 0,
		maxLevels = undefined
	} = $props<{
		node: UiNodeDto | null;
		level?: number;
		maxLevels?: number;
	}>();

	let session = $derived(appState.session);
	let mainGraphState = $derived(session?.graph.state);
	let meta = $derived(node.meta);

	let iconURL = $derived(getIconURLForNode(node));

	const selectNode = (next: UiNodeDto, event: MouseEvent): void => {
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

	let isExpanded = $state(level < 5); // auto-expand first 2 levels

	let isSelected = $derived(session?.isNodeSelected(node?.node_id ?? -1) ?? false);

	let hasArrow = $derived(node.children && node.children.length > 0);
	let warnings = $derived(session?.getNodeVisibleWarnings(node.node_id));
	let warningCount = $derived(node ? (warnings?.length ?? 0) : 0);
</script>

{#if node}
	<div class="outliner-item">
		<div class="outliner-item-content" class:selected={isSelected} class:has-arrow={hasArrow}>
			{#if hasArrow}
				<div
					class="outliner-expand arrow {isExpanded ? 'down' : ''}"
					aria-hidden="true"
					onclick={() => (isExpanded = !isExpanded)}>
				</div>
			{/if}
			<img class="outliner-item-icon" src={iconURL} alt="" aria-hidden="true" />
			<button class="outliner-item-label" type="button" onclick={(event) => selectNode(node, event)}
				>{meta.label}</button>
			<NodeWarningBadge {warnings} />
			<span class="outliner-item-spacer"></span>
			<span class="outliner-item-type">{node.node_type}</span>
		</div>

		{#if isExpanded && hasArrow && (maxLevels == undefined || level < maxLevels)}
			<div class="outliner-children" transition:slide|local={{ duration: 200 }}>
				{#each node.children as child}
					<Self node={mainGraphState?.nodesById.get(child) ?? null} level={level + 1} {maxLevels} />
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
