<script lang="ts">
	import type { PanelProps, PanelState } from '../../../dockview/panel-types';
	import type { UiNodeDto } from '../../../types';
	import { appState } from '$lib/golden_ui/store/workbench.svelte';
	import { tick } from 'svelte';
	import OutlinerItem from './OutlinerItem.svelte';
	import { collectOutlinerAncestorNodeIds, scrollOutlinerNodeIntoView } from './navigation';

	let { panelId, panelType, title, params }: PanelProps = $props();
	let panel = $state<PanelState>({
		panelId: '',
		panelType: '',
		title: '',
		params: {}
	});

	$effect(() => {
		panel = {
			panelId,
			panelType,
			title,
			params
		};
	});

	export const setPanelState = (next: PanelState): void => {
		panel = next;
	};

	let mainGraphState = $derived(appState.session?.graph.state);
	let selectedNodeId = $derived(appState.session?.selectedNodeId ?? null);
	let autoExpandAncestorNodeIds = $derived.by(() =>
		collectOutlinerAncestorNodeIds(mainGraphState ?? null, selectedNodeId)
	);
	let query = $state('');
	let treeElement = $state<HTMLDivElement | null>(null);

	let rootNode = $derived(mainGraphState?.nodesById.get(mainGraphState?.rootId ?? 0) ?? null);

	const nodeFilter = (candidate: UiNodeDto): boolean => {
		const normalizedQuery = query.trim().toLowerCase();
		if (normalizedQuery.length === 0) {
			return true;
		}
		const haystack =
			`${candidate.meta.label} ${candidate.meta.short_name} ${candidate.node_type}`.toLowerCase();
		return haystack.includes(normalizedQuery);
	};

	$effect(() => {
		query;
		if (!treeElement || selectedNodeId === null) {
			return;
		}

		let cancelled = false;
		let frameId: number | null = null;
		let attempts = 0;
		const maxAttempts = 8;

		const revealSelectedNode = (): void => {
			if (cancelled) {
				return;
			}
			if (scrollOutlinerNodeIntoView(treeElement, selectedNodeId)) {
				return;
			}
			if (attempts >= maxAttempts || typeof requestAnimationFrame === 'undefined') {
				return;
			}
			attempts += 1;
			frameId = requestAnimationFrame(revealSelectedNode);
		};

		void tick().then(() => {
			revealSelectedNode();
		});

		return () => {
			cancelled = true;
			if (frameId !== null && typeof cancelAnimationFrame !== 'undefined') {
				cancelAnimationFrame(frameId);
			}
		};
	});
</script>

{#if rootNode}
	<div class="outliner-panel">
		<div class="outliner-header">
			<input type="text" placeholder="Search..." class="outliner-search" bind:value={query} />
		</div>
		<div class="outliner-content" bind:this={treeElement}>
			<div class="outliner-tree">
				<OutlinerItem
					node={rootNode}
					initiallyExpandedDepth={3}
					{autoExpandAncestorNodeIds}
					{nodeFilter} />
			</div>
		</div>
	</div>
{/if}

<style>
	.outliner-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
	}
	.outliner-header {
		box-sizing: border-box;
	}

	.outliner-search {
		width: 100%;
		padding: 0.25rem;
		box-sizing: border-box;
	}
	.outliner-content {
		flex: 1;
		overflow: auto;
		scrollbar-gutter: stable;
		padding: 0.5rem;
	}
</style>
